import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { StreamEvent } from "@/lib/types";

const bodySchema = z.object({
  chatId: z.string().uuid(),
  requestId: z.string().uuid(),
});

const PLANNING_PROMPT = `You are the planning stage of a senior software engineering agent with access to a Linux sandbox.
Given the conversation, produce a concise engineering plan in markdown with these sections:
1. Understanding — restate the request in one or two lines.
2. Assumptions — what you are assuming.
3. Approaches — at least two options with tradeoffs.
4. Chosen approach — and why.
5. Plan — numbered concrete implementation steps (use tools like write_file, run_command if available).
6. Risks & edge cases.
Keep it under 300 words. Do not write the final answer or full code here.`;

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
        const { chatId, requestId } = parsed.data;

        const { db, audit } = await import("@/lib/db.server");
        const { buildModel } = await import("@/lib/ai.server");
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

        const { data: history } = await db
          .from("messages")
          .select("role, content")
          .eq("chat_id", chatId)
          .order("seq", { ascending: true })
          .limit(60);

        const skillBlock = (skills ?? [])
          .map((s) => `### ${s.name}\n${s.instructions}`)
          .join("\n\n");

        const { getE2BKey } = await import("@/lib/e2b.server");
        const e2bKey = await getE2BKey();

        const systemPrompt = `You are an expert autonomous AI coding agent operating inside a real developer workspace.
You reason first, then act. Be precise, concrete and honest about limitations.
Never reveal API keys, tokens, or environment variable values.
Format code with fenced blocks that include the language.

## Tool integrity rules
- Tool results exist only when you actually call a provided tool in this turn. Never invent, quote, or imply command output that is not returned by a tool call.
- For coding, debugging, file inspection, build, test, network checks, or any request about the sandbox, you MUST use the sandbox tools instead of narrating hypothetical commands.
- Inspect existing files before editing. After changes, run the relevant build or tests and report only the real result.
- For web applications, finish by starting the development server on host 0.0.0.0 and port 5173 in the background so the Preview tab can display the result.
- If a tool fails or the selected model/provider cannot call tools, say so directly. Never fabricate success.
- Keep acting until the task is implemented and verified; do not stop after merely proposing steps.

## Sandbox
${
  e2bKey
    ? `A real E2B Linux sandbox is connected at /home/user/project. The tools write_file, read_file,
list_files and run_command are active. Use them whenever the request involves code or execution.
Every factual claim about files, commands, tests, networking, or runtime behavior must be backed by a tool result from this turn.`
    : `No sandbox is configured, so you cannot execute code. Answer with code blocks and tell the user
they can enable execution by adding an E2B API key in Settings → E2B.`
}

## Active skills
${skillBlock || "(none enabled)"}`;

        const messages = (history ?? []).map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));


        const encoder = new TextEncoder();
        let cancelled = false;
        request.signal.addEventListener("abort", () => {
          cancelled = true;
        });

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: StreamEvent) => {
              try {
                controller.enqueue(encoder.encode(sse(event)));
              } catch {
                /* client disconnected */
              }
            };

            let planning = "";
            let thinking = "";
            let answer = "";
            const events: StreamEvent[] = [];

            try {
              // ---- planning phase (streamed live) ----
              send({ type: "planning-start" });
              const planStream = streamText({
                model: buildModel(provider, modelRow.model_id),
                system: PLANNING_PROMPT,
                messages,
                abortSignal: request.signal,
              });
              for await (const delta of planStream.textStream) {
                planning += delta;
                send({ type: "planning-update", text: delta });
              }
              send({ type: "planning-finish" });

              // ---- answer phase (with sandbox tools when E2B is configured) ----
              let tools: Record<string, unknown> | undefined;
              if (e2bKey) {
                const { buildAgentTools } = await import("@/lib/agent-tools.server");
                tools = buildAgentTools({
                  chatId,
                  apiKey: e2bKey,
                  send,
                  record: (event) => events.push(event),
                });
              }

              const mainOptions = {
                model: buildModel(provider, modelRow.model_id),
                system: `${systemPrompt}\n\n## Plan agreed for this turn\n${planning}`,
                messages,
                abortSignal: request.signal,
                ...(tools ? { tools, stopWhen: stepCountIs(50) } : {}),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
              const main = streamText(mainOptions);



              let thinkingOpen = false;
              for await (const part of main.fullStream) {
                if (part.type === "reasoning-delta") {
                  if (!thinkingOpen) {
                    thinkingOpen = true;
                    send({ type: "thinking-start" });
                  }
                  thinking += part.text;
                  send({ type: "thinking-update", text: part.text });
                } else if (part.type === "text-delta") {
                  if (thinkingOpen) {
                    thinkingOpen = false;
                    send({ type: "thinking-finish" });
                  }
                  answer += part.text;
                  send({ type: "assistant-delta", text: part.text });
                } else if (part.type === "error") {
                  throw part.error instanceof Error ? part.error : new Error(String(part.error));
                }
              }
              if (thinkingOpen) send({ type: "thinking-finish" });

              const { data: saved } = await db
                .from("messages")
                .insert({
                  chat_id: chatId,
                  role: "assistant",
                  content: answer,
                  planning,
                  thinking: thinking || null,
                  events: events as never,
                  model_ref: `${provider.name}:${modelRow.model_id}`,
                  request_id: requestId,
                  status: cancelled ? "cancelled" : "complete",
                } as never)
                .select("id")
                .single();

              await db
                .from("chats")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", chatId);
              await audit("chat.generate", "chats", chatId, {
                model: modelRow.model_id,
                cancelled,
              });

              if (cancelled) send({ type: "cancelled" });
              send({ type: "assistant-finish", messageId: saved?.id ?? requestId });
            } catch (error) {
              const aborted =
                cancelled ||
                (error instanceof Error && /abort|cancel/i.test(error.name + error.message));
              if (aborted) {
                if (answer || planning) {
                  await db.from("messages").insert({
                    chat_id: chatId,
                    role: "assistant",
                    content: answer,
                    planning,
                    thinking: thinking || null,
                    model_ref: `${provider.name}:${modelRow.model_id}`,
                    request_id: requestId,
                    status: "cancelled",
                  } as never);
                }
                send({ type: "cancelled" });
              } else {
                const message = error instanceof Error ? error.message : "Generation failed";
                console.error("[chat] generation failed:", message);
                await db.from("messages").insert({
                  chat_id: chatId,
                  role: "assistant",
                  content: answer,
                  planning,
                  thinking: thinking || null,
                  model_ref: `${provider.name}:${modelRow.model_id}`,
                  request_id: requestId,
                  status: "error",
                  error: message.slice(0, 800),
                } as never);
                send({ type: "error", message: message.slice(0, 800) });
              }
            } finally {
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
