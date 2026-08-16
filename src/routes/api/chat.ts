import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { StreamEvent } from "@/lib/types";

const bodySchema = z.object({
  chatId: z.string().uuid(),
  requestId: z.string().uuid(),
  cancel: z.boolean().optional(),
});

// Runs keep going even when the browser navigates away or the tab closes.
// Only an explicit cancel request aborts them.
const activeRuns = new Map<string, AbortController>();

function isDirectAnswerRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const asksQuestion =
    normalized.includes("?") ||
    /^(?:hem\s+)?(?:apa|apakah|kenapa|mengapa|gimana|bagaimana|siapa|kapan|di\s*mana|dimana|emang|memang|kok|klok|kalau)\b/.test(
      normalized,
    );
  const requestsAction =
    /\b(?:tolong|coba|cek|periksa|jalankan|run|buat(?:kan)?|bikin|ubah|ganti|perbaiki|fix|implement|install|pasang|naikkan|naikan|resize|restart|deploy|push|download|ekstrak|ambil|cari|scrape|scrap|test|uji)\b/.test(
      normalized,
    );

  // A word can name the subject without requesting the action (for example
  // "scrap APK itu sama seperti scrap web kah?"). Explicit question endings
  // win unless the user also gave a clear imperative.
  const conceptualEnding = /\b(?:apa|apakah|gimana|bagaimana|kenapa|kah)\s*\?*$/.test(normalized);
  return asksQuestion && (!requestsAction || conceptualEnding);
}

const THINKING_RULES = `## Thinking protocol (mandatory, repeated)
- You have a \`think\` tool. Calling it produces a private "Thought for Ns" block in the timeline.
- Write every thought in ENGLISH, first person, as real deliberation — what you know, what is unknown,
  hypotheses, which file or command would answer it, why this approach, what you try if it fails.
  A thought is NOT a draft of your answer and NOT a summary for the user.
- Visible replies to the user use the language the user wrote in (Indonesian stays Indonesian).
- You MUST call \`think\` at these moments:
  1. before your first action in a turn (understanding + plan),
  2. after any tool that failed or returned something unexpected,
  3. before switching strategy,
  4. before you declare the task done or blocked.
- After a thought, immediately act. Never end your turn right after thinking.

## Decision cycle (observe → decide → act → verify → repeat)
- After every tool result: read the real output, decide the next single action, run it, verify it.
- Use set_phase to announce phases (understanding, discovery, planning, execution, debugging, testing,
  verification, completed) so the user sees live progress.
- Plan internally and keep going: never ask "boleh saya lanjut?", "approve the plan?", or wait for the
  user after planning, after listing files, after one command, or after finding an error. Continue
  automatically until the task is implemented and verified.
- Only stop for the user when the action is destructive, irreversible, needs a credential you must
  request with request_secret, or deploys to production.
- When work is done, run verification (build/typecheck/tests, start_dev_server + check_preview +
  screenshot for web apps), fix what fails, and only then summarize what changed.`;

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireUnlocked } = await import("@/lib/gate.server");
        try {
          await requireUnlocked();
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }

        const parsed = bodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const { chatId, requestId, cancel } = parsed.data;

        if (cancel) {
          activeRuns.get(requestId)?.abort();
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }

        const { db, audit } = await import("@/lib/db.server");
        const { buildModel, isLovableGateway } = await import("@/lib/ai.server");
        const { streamText, stepCountIs } = await import("ai");

        // Idempotency: never generate the same assistant message twice.
        const { data: dupe } = await db
          .from("messages")
          .select("id")
          .eq("request_id", requestId)
          .maybeSingle();
        if (dupe) {
          return new Response(sse({ type: "assistant-finish", messageId: dupe.id }), {
            headers: { "content-type": "text/event-stream" },
          });
        }

        const { data: chat } = await db
          .from("chats")
          .select("id, model_id")
          .eq("id", chatId)
          .maybeSingle();
        if (!chat) return new Response("Chat not found", { status: 404 });

        let modelQuery = db.from("models").select("*, providers(*)").eq("enabled", true);
        modelQuery = chat.model_id
          ? modelQuery.eq("id", chat.model_id)
          : modelQuery.eq("is_default", true);
        const { data: modelRow } = await modelQuery.maybeSingle();

        if (!modelRow?.providers) {
          return new Response(
            sse({
              type: "error",
              message:
                "No usable model is configured. Add a provider and model in Settings, then pick one in the composer.",
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        const provider = modelRow.providers as {
          id: string;
          name: string;
          type: string;
          api_key: string | null;
          base_url: string | null;
          org_id: string | null;
          enabled: boolean;
        };
        if (!provider.enabled) {
          return new Response(
            sse({
              type: "error",
              message: `Provider "${provider.name}" is disabled. Enable it in Settings → Providers.`,
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }

        const { data: skills } = await db
          .from("agent_skills")
          .select("name, instructions")
          .eq("enabled", true)
          .order("sort_order", { ascending: true });

        // Fetch the newest messages, not the oldest ones. The old ascending
        // limit silently dropped the user's current message after a long chat,
        // which made answers appear unrelated.
        const { data: newestHistory } = await db
          .from("messages")
          .select(
            "role, content, message_attachments(file_name, mime_type, storage_path, extracted_text)",
          )
          .eq("chat_id", chatId)
          .order("seq", { ascending: false })
          .limit(16);
        const history = (newestHistory ?? []).reverse();

        const latestUserText =
          [...history]
            .reverse()
            .find((message) => message.role === "user")
            ?.content?.trim() ?? "";
        const directAnswerMode = isDirectAnswerRequest(latestUserText);

        const skillBlock = (skills ?? [])
          .map((s) => `### ${s.name}\n${s.instructions}`)
          .join("\n\n");

        const { getSandboxApiKey } = await import("@/lib/daytona.server");
        const sandboxKey = await getSandboxApiKey();

        const systemPrompt = `You are an expert autonomous AI coding agent operating inside a real developer workspace.
You reason first, then act. Be precise, concrete and honest about limitations.
Never reveal API keys, tokens, or environment variable values.
Format code with fenced blocks that include the language.
- The CURRENT REQUEST below is the only task you are answering now. Answer it directly.
- Earlier messages are context only. Never continue an older task when the latest user message changed the subject.
- For a simple question or conversation, answer immediately without inspecting files or starting the sandbox.

## CURRENT REQUEST (highest priority; do not reinterpret it as an older topic)
<current_request>
${latestUserText}
</current_request>

${
  directAnswerMode
    ? `## Direct-answer mode
- This is a conceptual or conversational question, not an instruction to operate the sandbox.
- Answer the exact question in the first sentence.
- Do not inspect the environment, discuss setup requirements, continue a previous task, or offer unrelated next steps.
- Keep the answer concise unless the user asks for detail.`
    : THINKING_RULES
}

## How to work (interleaved)
Work in short cycles: think, write one or two sentences saying what you are about to do, call the tool,
then react to the real result in the next sentences, then act again. Never dump one long answer
at the end — narrate as you go, in between tool calls.

## Tool integrity rules
- Tool results exist only when you actually call a provided tool in this turn. Never invent, quote, or imply command output that is not returned by a tool call.
- For coding, debugging, file inspection, build, test, network checks, or any request about the sandbox, you MUST use the sandbox tools instead of narrating hypothetical commands.
- Explore before you edit: project_tree, search_files/glob_files, then read_file. Prefer apply_patch over rewriting whole files.
- After changes, run the relevant build or tests and report only the real result.
- If a tool fails or the selected model/provider cannot call tools, say so directly. Never fabricate success.
- When a sandbox infrastructure error is recoverable, the tool retries once with a clean session. React to the retry result and continue the task; do not stop at diagnosis or suggest manual work when recovery succeeded.
- Only ask the user to intervene after automatic recovery failed, and quote the actual final tool error rather than speculating about the platform.
- Keep acting until the task is implemented and verified; do not stop after merely proposing steps.
- Never start a persistent process with run_command plus '&', nohup, or a shell background job; that keeps command streams open and times out. Use start_dev_server for previews.

## Persistence rules (do not give up)
- An error is a data point, not a conclusion. Never end your turn with "it failed" as the outcome while untried options remain.
- On any failure you MUST attempt at least 3 materially different fixes before reporting a blocker. Repeating the same command counts as zero attempts.
- Escalation ladder for a failing approach: (1) read the real error/exit code and stderr, (2) inspect the relevant file/response with read_file, run_command or fetch_url, (3) change the technique — different library, different flag, different parser, different endpoint, (4) web_search the exact error string or the target's docs and apply what you find, (5) only then report.
- Scraping/network specifics: if a fetch is blocked or empty, try in order — different user-agent and headers, follow redirects, plain HTTP client (curl/requests) vs library, the site's JSON/API endpoint or sitemap/RSS, a rendered fetch via the headless browser already installed for screenshots, then a search-engine cache/alternative source. Log which ones you tried.
- Missing dependency, tool or binary is never a stopping point: install it (npm/pip/apt-get) and continue.
- Do not ask the user for permission to keep trying, and do not ask questions you can answer with a tool.
- When you truly stop, list exactly what you attempted, the real error for each, and the single specific thing you need from the user.

## Verifying web apps yourself
- Start the app with start_dev_server (it binds 0.0.0.0 and returns the public preview URL).
- Use the exact port returned by start_dev_server for check_preview and screenshot. Never guess port 3000.
- Only call screenshot after check_preview confirms an HTTP response; a screenshot cannot start a missing preview.
- If the screenshot or console shows a problem, fix it and screenshot again before claiming success.

## Research (deep search)
- deep_research is the primary research tool: one call expands the question into several queries, searches them all, opens the best pages and returns numbered sources with excerpts. Use it whenever the answer depends on external facts (unknown API, unfamiliar error, deploy config, library version).
- web_search + fetch_url remain available for a single targeted lookup or to open one more page a deep_research source pointed to.
- Search never becomes unavailable: with a provider key it uses that provider, otherwise a keyless fallback chain. Never claim search is off — call it.
- Do not conclude from snippets alone. Read at least 2 sources before making a claim, and cite the URLs you used in your reply.
- If the first round is thin or contradictory, run a second deep_research with a differently worded question before answering.

## Deployment (GitHub / Vercel / Cloudflare)
- Accounts are connected once by the user in Settings → Integrations. Call integration_status first and use the connected account — NEVER ask the user for a token, username, repo owner or account id that the integration already provides.
- If an integration is not connected, say exactly which one and point the user to Settings → Integrations. Do not invent a workaround with a personal token in a command.
- Push to GitHub: github_create_repo (idempotent) then github_push. Deploy to Vercel: vercel_deploy (use vercel_list_projects when the user names an existing project). Deploy to Cloudflare: cloudflare_deploy_worker, then cloudflare_tail to inspect runtime errors.
- "Push to GitHub and deploy" means do both, in that order, in the same turn, without stopping for approval in between.
- Deploy failures are normal and fixable. On failure: read the build output, think about the real cause (missing build command, wrong entry file, missing dependency, wrong framework preset, missing env var), fix it in the sandbox, and deploy again. Make at least 3 materially different attempts before reporting that it cannot be done.
- If the failure is a missing env var or API key, call request_secret instead of guessing a value.
- Always end a deployment by reporting the live URL and confirming it responds (check_preview or fetch_url on the deployed URL).
- Never print tokens; the tools already redact them.



## Skills
- Use list_skills / read_skill to load workspace playbooks before starting a task that matches one.

## Secrets and env
- If the task needs an API key or env value, call request_secret with the exact env var names and a short reason. A secure form appears in the chat; stop and wait for the user.
- Stored secrets are injected automatically as environment variables into every command and mirrored to .env. Use list_secrets to see which names exist. Never print their values.

## Asking the user (ask_user)
- When the request is genuinely ambiguous in a way that changes the result (stack, framework, language, target platform, design direction), call ask_user ONCE with 1-4 short questions, each with 2-4 concrete options plus a short keterangan. The user can also skip.
- Never use ask_user for things you can decide or discover yourself, and never ask twice about the same thing. If the user skips, pick the most sensible default and continue without asking again.

## Progress (set_progress)
- For any task with more than ~3 steps, call set_progress at the start with the planned steps, then update it whenever a step starts or finishes. Keep step titles short and in the user's language.

## Attachments
- Files the user uploads arrive as images or as extracted text in the conversation. Use them as the source of truth; when a binary file must be used inside the sandbox, download it with run_command + curl from the provided URL.


## Sandbox
${
  sandboxKey
    ? `A real Daytona Linux sandbox is connected at /home/daytona/project. All sandbox tools are active.
Every factual claim about files, commands, tests, networking, or runtime behavior must be backed by a tool result from this turn.
The sandbox is yours to manage: use sandbox_info when things feel slow or a build is killed, sandbox_resize to give
yourself more CPU/RAM/disk, sandbox_restart when the shell is wedged, and sandbox_network_check when downloads fail.
Never assume "out of memory" or "no internet" — verify with these tools, fix it yourself, and continue.
Preview URLs from start_dev_server are public HTTPS links you can share with the user and open yourself.
For GUI work (real browser testing, desktop apps) call desktop_start, then desktop_screenshot and desktop_input.
You may only manage the sandbox of this chat; never touch other sandboxes or projects.`
    : `No sandbox is configured, so you cannot execute code. Answer with code blocks and tell the user
they can enable execution by adding a Daytona API key in Settings → Sandbox.`
}

## Active skills
${skillBlock || "(none enabled)"}`;

        // User uploads: images go in as vision parts, text-ish files as extracted text.
        const attachmentPaths = history.flatMap((m) =>
          (
            (m as { message_attachments?: { storage_path: string }[] }).message_attachments ?? []
          ).map((a) => a.storage_path),
        );
        const signedMap = new Map<string, string>();
        if (attachmentPaths.length) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: signed } = await supabaseAdmin.storage
            .from("attachments")
            .createSignedUrls(attachmentPaths.slice(0, 50), 60 * 60);
          for (const s of signed ?? [])
            if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
        }

        const messages = history
          .map((m, index) => {
            const files =
              (
                m as {
                  message_attachments?: {
                    file_name: string;
                    mime_type: string;
                    storage_path: string;
                    extracted_text: string | null;
                  }[];
                }
              ).message_attachments ?? [];
            const rawText = (m.content ?? "").trim();
            // Keep the latest exchange intact while bounding old verbose agent
            // narration so every tool step does not resend a huge stale prompt.
            const isRecent = index >= history.length - 4;
            const text =
              isRecent || rawText.length <= 6000
                ? rawText
                : `${rawText.slice(0, 2500)}\n[older message truncated]`;
            if (m.role !== "user" || files.length === 0) {
              return text.length > 0
                ? { role: m.role as "user" | "assistant" | "system", content: text }
                : null;
            }
            const parts: Array<{ type: "text"; text: string } | { type: "image"; image: URL }> = [];
            if (text) parts.push({ type: "text", text });
            for (const f of files) {
              const url = signedMap.get(f.storage_path);
              if (f.mime_type.startsWith("image/") && url) {
                parts.push({ type: "image", image: new URL(url) });
              } else if (f.extracted_text) {
                parts.push({
                  type: "text",
                  text: `Attached file ${f.file_name} (${f.mime_type}):\n${f.extracted_text}`,
                });
              } else {
                parts.push({
                  type: "text",
                  text: `Attached file ${f.file_name} (${f.mime_type}) is available${url ? ` at ${url}` : ""}. Download it into the sandbox with run_command + curl when you need it.`,
                });
              }
            }
            return parts.length ? { role: "user" as const, content: parts } : null;
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);

        const encoder = new TextEncoder();
        let cancelled = false;
        const runAbort = new AbortController();
        activeRuns.set(requestId, runAbort);
        runAbort.signal.addEventListener("abort", () => {
          cancelled = true;
        });

        // Persist a placeholder immediately so the message never disappears
        // when the user switches chats or reloads mid-generation.
        const { data: placeholder } = await db
          .from("messages")
          .insert({
            chat_id: chatId,
            role: "assistant",
            content: "",
            model_ref: `${provider.name}:${modelRow.model_id}`,
            request_id: requestId,
            status: "streaming",
          } as never)
          .select("id")
          .single();
        const messageId = (placeholder as { id: string } | null)?.id ?? null;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: StreamEvent) => {
              try {
                controller.enqueue(encoder.encode(sse(event)));
              } catch {
                /* client disconnected — generation keeps running */
              }
            };

            let planning = "";
            let thinking = "";
            let answer = "";
            const events: StreamEvent[] = [];

            const persist = async (status: string, error?: string) => {
              if (!messageId) return;
              await db
                .from("messages")
                .update({
                  content: answer,
                  planning,
                  thinking: thinking || null,
                  events: events as never,
                  status,
                  ...(error ? { error: error.slice(0, 800) } : {}),
                } as never)
                .eq("id", messageId);
            };

            // Serialize database writes. Previously an older fire-and-forget
            // "streaming" write could finish after the final "complete" write
            // and erase the last timeline events or revert the status.
            let persistChain = Promise.resolve();
            const queuePersist = (status: string, error?: string) => {
              persistChain = persistChain.then(() => persist(status, error));
              return persistChain;
            };

            let lastSave = Date.now();
            const saveSoon = () => {
              if (Date.now() - lastSave < 2000) return;
              lastSave = Date.now();
              void queuePersist("streaming");
            };

            try {
              // ---- single autonomous loop: think → act → verify → repeat ----
              let tools: Record<string, unknown> | undefined;
              if (sandboxKey && !directAnswerMode) {
                const { buildAgentTools } = await import("@/lib/agent-tools.server");
                tools = buildAgentTools({
                  chatId,
                  apiKey: sandboxKey,
                  send,
                  record: (event) => events.push(event),
                });
              }

              const lovableProviderOptions =
                isLovableGateway(provider) && modelRow.model_id === "openai/gpt-5.4"
                  ? {
                      lovable: {
                        reasoningEffort: "none",
                        service_tier: "priority",
                      },
                    }
                  : undefined;
              const mainOptions = {
                model: buildModel(provider, modelRow.model_id),
                system: systemPrompt,
                messages,
                abortSignal: runAbort.signal,
                ...(lovableProviderOptions ? { providerOptions: lovableProviderOptions } : {}),
                ...(tools ? { tools, stopWhen: stepCountIs(120) } : {}),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
              const main = streamText(mainOptions);

              // Native reasoning (GPT-5/Gemini) renders as the same inline thought block
              // as the `think` tool, so every model looks identical in the timeline.
              let nativeThoughtId: string | null = null;
              let nativeStartedAt = 0;
              const closeNativeThought = () => {
                if (!nativeThoughtId) return;
                const end: StreamEvent = {
                  type: "thought-end",
                  id: nativeThoughtId,
                  durationMs: Date.now() - nativeStartedAt,
                };
                send(end);
                events.push(end);
                nativeThoughtId = null;
              };

              let segment = "";
              const flushSegment = () => {
                if (segment.trim()) events.push({ type: "step-text", text: segment });
                segment = "";
              };
              for await (const part of main.fullStream) {
                if (part.type === "reasoning-delta") {
                  if (!nativeThoughtId) {
                    nativeThoughtId = crypto.randomUUID();
                    nativeStartedAt = Date.now();
                    const start: StreamEvent = { type: "thought-start", id: nativeThoughtId };
                    send(start);
                    events.push(start);
                  }
                  thinking += part.text;
                  const delta: StreamEvent = {
                    type: "thought-delta",
                    id: nativeThoughtId,
                    text: part.text,
                  };
                  send(delta);
                  events.push(delta);
                } else if (part.type === "text-delta") {
                  closeNativeThought();
                  answer += part.text;
                  segment += part.text;
                  send({ type: "assistant-delta", text: part.text });
                } else if (part.type === "tool-call") {
                  closeNativeThought();
                  flushSegment();
                } else if (part.type === "error") {
                  throw part.error instanceof Error ? part.error : new Error(String(part.error));
                }
                saveSoon();
              }

              flushSegment();
              closeNativeThought();

              planning =
                events
                  .filter(
                    (e): e is Extract<StreamEvent, { type: "thought-delta" }> =>
                      e.type === "thought-delta",
                  )
                  .map((e) => e.text)
                  .join("\n\n")
                  .slice(0, 4000) || "";

              await queuePersist(cancelled ? "cancelled" : "complete");

              await db
                .from("chats")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", chatId);
              await audit("chat.generate", "chats", chatId, {
                model: modelRow.model_id,
                cancelled,
              });

              if (cancelled) send({ type: "cancelled" });
              send({ type: "assistant-finish", messageId: messageId ?? requestId });
            } catch (error) {
              const aborted =
                cancelled ||
                (error instanceof Error && /abort|cancel/i.test(error.name + error.message));
              if (aborted) {
                await queuePersist("cancelled");
                send({ type: "cancelled" });
              } else {
                const message = error instanceof Error ? error.message : "Generation failed";
                console.error("[chat] generation failed:", message);
                await queuePersist("error", message);
                send({ type: "error", message: message.slice(0, 800) });
              }
            } finally {
              activeRuns.delete(requestId);
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
