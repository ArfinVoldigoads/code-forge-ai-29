import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "e2b";
import { db } from "@/lib/db.server";
import {
  getChatEnv,
  getSandboxForChat,
  isRecoverableShellFailure,
  recreateSandboxForChat,
  resolvePath,
  runShell,
  syncEnvFile,
  WORKDIR,
} from "@/lib/e2b.server";
import type { Json, StreamEvent } from "@/lib/types";

type Ctx = {
  chatId: string;
  apiKey: string;
  send: (event: StreamEvent) => void;
  record: (event: StreamEvent) => void;
};

const MAX_OUT = 8000;
const clip = (text: string) =>
  text.length > MAX_OUT ? `${text.slice(0, MAX_OUT)}\n…truncated` : text;

const SHOT_DIR = "/home/user/.agentkit";

export function buildAgentTools(ctx: Ctx) {
  let session: { sandbox: Sandbox; sessionId: string } | null = null;
  let lastMark = Date.now();

  const sandbox = async () => {
    if (!session) {
      session = await getSandboxForChat(ctx.chatId, ctx.apiKey);
      await syncEnvFile(session.sandbox, ctx.chatId).catch(() => []);
    }
    return session;
  };


  const logExecution = async (
    name: string,
    input: Json,
    started: number,
    output: Json,
    error?: string,
  ) => {
    await db.from("tool_executions").insert({
      chat_id: ctx.chatId,
      tool_name: name,
      input: input as never,
      output: output as never,
      status: error ? "error" : "done",
      error: error ?? null,
      duration_ms: Date.now() - started,
    } as never);
  };

  const run = async <T extends Json>(
    name: string,
    input: Json,
    fn: (toolId: string) => Promise<T>,
  ): Promise<Json> => {
    const id = crypto.randomUUID();
    const started = Date.now();
    const startEvent: StreamEvent = { type: "tool-start", id, name, input };
    ctx.send(startEvent);
    ctx.record(startEvent);
    try {
      const output = await fn(id);
      const done: StreamEvent = { type: "tool-result", id, output };
      ctx.send(done);
      ctx.record(done);
      await logExecution(name, input, started, output);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: StreamEvent = { type: "tool-result", id, output: null, error: message };
      ctx.send(failed);
      ctx.record(failed);
      await logExecution(name, input, started, null, message);
      return { error: message };
    }
  };

  /** Shell helper that logs into the shared console feed and injects chat secrets. */
  const shell = async (
    command: string,
    opts: { toolId?: string; timeoutMs?: number; stream?: boolean } = {},
  ) => {
    const started = Date.now();
    let active = await sandbox();
    const envs = await getChatEnv(ctx.chatId);
    let stdout = "";
    let stderr = "";
    const emit = (streamName: "stdout" | "stderr", text: string) => {
      if (!opts.stream || !opts.toolId) return;
      const event: StreamEvent = { type: "command-output", id: opts.toolId, stream: streamName, text };
      ctx.send(event);
      ctx.record(event);
    };
    const execute = () =>
      runShell(active.sandbox, command, {
        cwd: WORKDIR,
        timeoutMs: opts.timeoutMs ?? 180_000,
        envs,
        onStdout: (text) => {
          stdout += text;
          emit("stdout", text);
        },
        onStderr: (text) => {
          stderr += text;
          emit("stderr", text);
        },
      });
    let result = await execute();
    let recovered = false;
    if (isRecoverableShellFailure(result)) {
      emit("stderr", "\n[agentkit] Sandbox shell unhealthy; creating a clean session and retrying once.\n");
      active = await recreateSandboxForChat(ctx.chatId, ctx.apiKey);
      session = active;
      await syncEnvFile(active.sandbox, ctx.chatId).catch(() => []);
      stdout = "";
      stderr = "";
      result = await execute();
      recovered = true;
    }
    if (!stdout) stdout = result.stdout;
    if (!stderr) stderr = result.stderr;
    await db
      .from("command_outputs")
      .insert({
        chat_id: ctx.chatId,
        source: "agent",
        duration_ms: Date.now() - started,
        sandbox_session_id: active.sessionId || null,
        command,
        stdout: clip(stdout),
        stderr: clip(stderr),
        exit_code: result.exitCode,
      } as never);
    return {
      exitCode: result.exitCode,
      stdout: clip(stdout),
      stderr: clip(stderr),
      ...(recovered ? { recovered: true } : {}),
    };
  };

  return {
    /* ------------------------------ reasoning --------------------------- */

    think: tool({
      description:
        "Think privately before you act. Write your real deliberation in ENGLISH: what you know, what is still unknown, hypotheses, which file/command answers it, why you choose this approach, and what you will try if it fails. Required before your first action, after every failed or surprising tool result, before changing strategy, and before you conclude. This tool does nothing else — it never touches the sandbox.",
      inputSchema: z.object({
        thought: z.string(),
        phase: z
          .enum([
            "understanding",
            "discovery",
            "planning",
            "execution",
            "debugging",
            "testing",
            "verification",
            "completed",
          ])
          .optional(),
      }),
      execute: async ({ thought, phase }) => {
        const id = crypto.randomUUID();
        const durationMs = Math.max(0, Date.now() - lastMark);
        const start: StreamEvent = { type: "thought-start", id };
        const delta: StreamEvent = { type: "thought-delta", id, text: thought };
        const end: StreamEvent = { type: "thought-end", id, durationMs };
        for (const event of [start, delta, end]) {
          ctx.send(event);
          ctx.record(event);
        }
        if (phase) {
          const phaseEvent: StreamEvent = {
            type: "phase",
            phase,
            message: thought.split("\n")[0]?.slice(0, 140) ?? "",
          };
          ctx.send(phaseEvent);
          ctx.record(phaseEvent);
        }
        lastMark = Date.now();
        return { ok: true, note: "Thought recorded. Now take the next action immediately." };
      },
    }),

    set_phase: tool({
      description:
        "Announce the phase you are entering so the user sees live progress (understanding, discovery, planning, execution, debugging, testing, verification, completed).",
      inputSchema: z.object({
        phase: z.enum([
          "understanding",
          "discovery",
          "planning",
          "execution",
          "debugging",
          "testing",
          "verification",
          "completed",
        ]),
        message: z.string(),
      }),
      execute: async ({ phase, message }) => {
        const event: StreamEvent = { type: "phase", phase, message };
        ctx.send(event);
        ctx.record(event);
        lastMark = Date.now();
        return { ok: true };
      },
    }),

    /* ------------------------------ files ------------------------------ */


    write_file: tool({
      description: `Create or overwrite a file in the sandbox project (${WORKDIR}). Use relative paths.`,
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) =>
        run("write_file", { path }, async () => {
          const { sandbox: sbx } = await sandbox();
          await sbx.files.write(resolvePath(path), content);
          const change: StreamEvent = { type: "file-change", path, action: "write" };
          ctx.send(change);
          ctx.record(change);
          return { path, bytes: content.length };
        }),
    }),

    read_file: tool({
      description:
        "Read a file from the sandbox project. Optionally limit to a line range (1-based, inclusive).",
      inputSchema: z.object({
        path: z.string(),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
      execute: async ({ path, startLine, endLine }) =>
        run("read_file", { path, startLine: startLine ?? null, endLine: endLine ?? null }, async () => {
          const { sandbox: sbx } = await sandbox();
          const content = await sbx.files.read(resolvePath(path));
          if (!startLine && !endLine) return { path, content: clip(content) };
          const lines = content.split("\n");
          const from = (startLine ?? 1) - 1;
          const to = endLine ?? lines.length;
          return {
            path,
            from: from + 1,
            to,
            content: clip(
              lines
                .slice(from, to)
                .map((line, i) => `${from + i + 1}: ${line}`)
                .join("\n"),
            ),
          };
        }),
    }),

    apply_patch: tool({
      description:
        "Edit part of an existing file by replacing an exact snippet. Safer than rewriting the whole file. `find` must appear exactly once.",
      inputSchema: z.object({ path: z.string(), find: z.string(), replace: z.string() }),
      execute: async ({ path, find, replace }) =>
        run("apply_patch", { path }, async () => {
          const { sandbox: sbx } = await sandbox();
          const full = resolvePath(path);
          const content = await sbx.files.read(full);
          const occurrences = content.split(find).length - 1;
          if (occurrences === 0) throw new Error("Snippet not found — read the file again.");
          if (occurrences > 1)
            throw new Error(`Snippet appears ${occurrences} times — include more context.`);
          const next = content.replace(find, replace);
          await sbx.files.write(full, next);
          const change: StreamEvent = { type: "file-change", path, action: "patch" };
          ctx.send(change);
          ctx.record(change);
          return { path, replaced: true, bytes: next.length };
        }),
    }),

    list_files: tool({
      description: "List files in a sandbox directory (defaults to the project root).",
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path }) =>
        run("list_files", { path: path ?? "." }, async () => {
          const { sandbox: sbx } = await sandbox();
          const entries = await sbx.files.list(resolvePath(path ?? "."));
          return { entries: entries.map((e) => ({ name: e.name, type: e.type ?? "file" })) };
        }),
    }),

    project_tree: tool({
      description:
        "Show the project structure (skips node_modules, .git, dist). Use this first to orient yourself.",
      inputSchema: z.object({ depth: z.number().int().min(1).max(6).optional() }),
      execute: async ({ depth }) =>
        run("project_tree", { depth: depth ?? 3 }, async () => {
          const d = depth ?? 3;
          const out = await shell(
            `find . -maxdepth ${d} \\( -name node_modules -o -name .git -o -name dist -o -name .next -o -name build \\) -prune -o -print | head -300`,
            { timeoutMs: 30_000 },
          );
          return { tree: out.stdout || "(empty project)" };
        }),
    }),

    search_files: tool({
      description:
        "Search file contents in the project (grep -rn). Use to find symbols, imports or usages.",
      inputSchema: z.object({ query: z.string(), path: z.string().optional() }),
      execute: async ({ query, path }) =>
        run("search_files", { query, path: path ?? "." }, async () => {
          const target = path ? JSON.stringify(path) : ".";
          const out = await shell(
            `grep -rnI --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -- ${JSON.stringify(query)} ${target} | head -100`,
            { timeoutMs: 45_000 },
          );
          return { matches: out.stdout || "(no matches)" };
        }),
    }),

    glob_files: tool({
      description: "Find files by name pattern, e.g. '*.tsx' or 'Button*'.",
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) =>
        run("glob_files", { pattern }, async () => {
          const out = await shell(
            `find . -path ./node_modules -prune -o -path ./.git -prune -o -name ${JSON.stringify(pattern)} -print | head -200`,
            { timeoutMs: 30_000 },
          );
          return { paths: out.stdout || "(no files)" };
        }),
    }),

    delete_path: tool({
      description: "Delete a file or directory inside the project.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) =>
        run("delete_path", { path }, async () => {
          const out = await shell(`rm -rf ${JSON.stringify(resolvePath(path))}`, {
            timeoutMs: 20_000,
          });
          const change: StreamEvent = { type: "file-change", path, action: "delete" };
          ctx.send(change);
          ctx.record(change);
          return { path, exitCode: out.exitCode };
        }),
    }),

    /* ----------------------------- execution ---------------------------- */

    run_command: tool({
      description:
        "Run a shell command inside the sandbox project directory. Use this to install packages, build, or run tests.",
      inputSchema: z.object({ command: z.string(), timeoutSeconds: z.number().optional() }),
      execute: async ({ command, timeoutSeconds }) =>
        run("run_command", { command }, async (toolId) =>
          shell(command, {
            toolId,
            stream: true,
            timeoutMs: Math.min((timeoutSeconds ?? 120) * 1000, 300_000),
          }),
        ),
    }),

    start_dev_server: tool({
      description:
        "Start the project's dev server as a managed background process on 0.0.0.0 and return the public preview URL. Always use this instead of appending '&' to run_command.",
      inputSchema: z.object({ port: z.number().int().min(1024).max(65535).optional() }),
      execute: async ({ port }) =>
        run("start_dev_server", { port: port ?? 5173 }, async () => {
          const p = port ?? 5173;
          const { sandbox: sbx } = await sandbox();
          const { shellCommand } = await import("@/lib/e2b.server");
          const envs = await getChatEnv(ctx.chatId);
          const alive = await shell(`curl -fsS --max-time 2 http://127.0.0.1:${p} >/dev/null`, {
            timeoutMs: 10_000,
          });
          if (alive.exitCode !== 0) {
            const command = `if [ -f package.json ]; then\n  if [ -f bun.lockb ] || [ -f bun.lock ]; then bun run dev -- --host 0.0.0.0 --port ${p};\n  elif [ -f pnpm-lock.yaml ]; then pnpm dev -- --host 0.0.0.0 --port ${p};\n  else npm run dev -- --host 0.0.0.0 --port ${p}; fi\nelif [ -f index.html ]; then python3 -m http.server ${p} --bind 0.0.0.0;\nelse echo 'No web project found' >&2; exit 1; fi`;
            await sbx.commands.run(shellCommand(command), {
              cwd: WORKDIR,
              background: true,
              ...(Object.keys(envs).length ? { envs } : {}),
            });
            const ready = await shell(
              `for i in $(seq 1 20); do curl -fsS --max-time 2 http://127.0.0.1:${p} >/dev/null && exit 0; sleep 1; done; exit 1`,
              { timeoutMs: 30_000 },
            );
            if (ready.exitCode !== 0) {
              throw new Error(`Dev server did not become ready on port ${p}. Inspect its console output, fix the startup error, and retry.`);
            }
          }
          return { url: `https://${sbx.getHost(p)}`, port: p, alreadyRunning: alive.exitCode === 0 };
        }),
    }),

    check_preview: tool({
      description:
        "Check whether the dev server responds on a port. Returns the HTTP status and the first bytes of HTML.",
      inputSchema: z.object({ port: z.number().int().min(1024).max(65535).optional() }),
      execute: async ({ port }) =>
        run("check_preview", { port: port ?? 5173 }, async () => {
          const p = port ?? 5173;
          const out = await shell(
            `curl -s -o /tmp/preview.html -w '%{http_code}' --max-time 10 http://127.0.0.1:${p}/ ; echo; head -c 500 /tmp/preview.html`,
            { timeoutMs: 20_000 },
          );
          return { port: p, response: out.stdout || out.stderr };
        }),
    }),

    screenshot: tool({
      description:
        "Take a real screenshot of the running app with headless Chromium and attach it to the chat. Also returns console errors. Start the dev server first.",
      inputSchema: z.object({
        port: z.number().int().min(1024).max(65535).optional(),
        path: z.string().optional(),
        caption: z.string().optional(),
      }),
      execute: async ({ port, path, caption }) =>
        run("screenshot", { port: port ?? 5173, path: path ?? "/" }, async (toolId) => {
          const p = port ?? 5173;
          const target = `http://127.0.0.1:${p}${path && path.startsWith("/") ? path : `/${path ?? ""}`}`;
          const { sandbox: sbx } = await sandbox();
          await sbx.setTimeout(900_000).catch(() => undefined);

          const preview = await shell(
            `curl -fsS --max-time 5 ${JSON.stringify(target)} >/dev/null`,
            { timeoutMs: 10_000 },
          );
          if (preview.exitCode !== 0) {
            throw new Error(`Cannot take a screenshot because no preview is responding at ${target}. Call start_dev_server first and use the same port.`);
          }

          const install = await shell(
            `mkdir -p ${SHOT_DIR} && cd ${SHOT_DIR} && if [ ! -d node_modules/playwright ]; then npm init -y >/dev/null 2>&1; npm i playwright@1.49.1 >/dev/null 2>&1 && npx playwright install --with-deps chromium >/dev/null 2>&1; fi && echo ready`,
            { toolId, stream: true, timeoutMs: 300_000 },
          );
          if (!install.stdout.includes("ready")) {
            throw new Error(`Could not prepare the browser: ${install.stderr || install.stdout}`);
          }

          const script = `const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], timeout: 20000 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  let status = 0;
  try {
    const res = await page.goto(${JSON.stringify(target)}, { waitUntil: 'domcontentloaded', timeout: 20000 });
    status = res ? res.status() : 0;
  } catch (e) { errors.push(String(e)); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: '${SHOT_DIR}/shot.png' });
  await browser.close();
  console.log(JSON.stringify({ status, errors: errors.slice(0, 20) }));
})();`;
          await sbx.files.write(`${SHOT_DIR}/shot.cjs`, script);
          const shot = await shell(`cd ${SHOT_DIR} && rm -f shot.png && node shot.cjs`, {
            toolId,
            stream: true,
            timeoutMs: 60_000,
          });
          if (shot.exitCode !== 0) {
            throw new Error(`Screenshot browser failed: ${shot.stderr || shot.stdout}`);
          }

          const bytes = (await sbx.files.read(`${SHOT_DIR}/shot.png`, {
            format: "bytes",
          })) as unknown as Uint8Array;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const key = `${ctx.chatId}/${Date.now()}.png`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("screenshots")
            .upload(key, bytes, { contentType: "image/png", upsert: true });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
          const { data: signed } = await supabaseAdmin.storage
            .from("screenshots")
            .createSignedUrl(key, 60 * 60 * 24 * 30);

          let meta: { status?: number; errors?: string[] } = {};
          const line = shot.stdout.trim().split("\n").pop() ?? "";
          try {
            meta = JSON.parse(line) as { status?: number; errors?: string[] };
          } catch {
            /* keep raw output below */
          }

          if (signed?.signedUrl) {
            const image: StreamEvent = {
              type: "image",
              id: crypto.randomUUID(),
              url: signed.signedUrl,
              ...(caption ? { caption } : { caption: target }),
            };
            ctx.send(image);
            ctx.record(image);
          }

          return {
            url: signed?.signedUrl ?? null,
            target,
            httpStatus: meta.status ?? null,
            consoleErrors: meta.errors ?? [],
            raw: meta.status ? undefined : clip(shot.stdout + shot.stderr),
          } as Json;
        }),
    }),

    /* ------------------------------ skills ------------------------------ */

    list_skills: tool({
      description: "List the enabled agent skills available in this workspace.",
      inputSchema: z.object({}),
      execute: async () =>
        run("list_skills", {}, async () => {
          const { data } = await db
            .from("agent_skills")
            .select("slug, name")
            .eq("enabled", true)
            .order("sort_order", { ascending: true });
          return { skills: (data ?? []).map((s) => ({ slug: s.slug, name: s.name })) };
        }),
    }),

    read_skill: tool({
      description: "Read the full instructions of one skill by slug before applying it.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) =>
        run("read_skill", { slug }, async () => {
          const { data } = await db
            .from("agent_skills")
            .select("slug, name, instructions")
            .eq("slug", slug)
            .maybeSingle();
          if (!data) throw new Error(`Skill "${slug}" not found`);
          return { slug: data.slug, name: data.name, instructions: data.instructions };
        }),
    }),

    /* ------------------------------ research ---------------------------- */

    web_search: tool({
      description:
        "Search the web for current information, docs or error messages. Returns titles, URLs and snippets.",
      inputSchema: z.object({ query: z.string(), maxResults: z.number().int().min(1).max(10).optional() }),
      execute: async ({ query, maxResults }) =>
        run("web_search", { query }, async () => {
          const { webSearch } = await import("@/lib/search.server");
          const results = await webSearch(query, maxResults ?? 6);
          return { query, results };
        }),
    }),

    fetch_url: tool({
      description: "Fetch a web page or raw file and return its readable text. Use after web_search.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) =>
        run("fetch_url", { url }, async () => {
          const { fetchUrlText } = await import("@/lib/search.server");
          return { url, text: await fetchUrlText(url) };
        }),
    }),

    /* ------------------------------ secrets ----------------------------- */

    list_secrets: tool({
      description:
        "List the secret/env names available for this project. Values are never exposed; they are injected into commands automatically.",
      inputSchema: z.object({}),
      execute: async () =>
        run("list_secrets", {}, async () => {
          const { data } = await db
            .from("project_secrets")
            .select("name, status")
            .eq("chat_id", ctx.chatId);
          return { secrets: (data ?? []).map((s) => ({ name: s.name, status: s.status })) };
        }),
    }),

    request_secret: tool({
      description:
        "Ask the user for API keys or env values you need. Shows a secure form in the chat. After calling this, stop and wait for the user to fill it in.",
      inputSchema: z.object({
        reason: z.string(),
        keys: z.array(z.object({ name: z.string(), description: z.string().optional() })).min(1).max(8),
      }),
      execute: async ({ reason, keys }) =>
        run("request_secret", { reason, keys: keys as unknown as Json }, async () => {
          for (const key of keys) {
            await db.from("project_secrets").upsert(
              {
                chat_id: ctx.chatId,
                name: key.name,
                description: key.description ?? null,
                status: "pending",
                updated_at: new Date().toISOString(),
              } as never,
              { onConflict: "chat_id,name" },
            );
          }
          const event: StreamEvent = {
            type: "secret-request",
            id: crypto.randomUUID(),
            reason,
            keys: keys.map((k) => ({ name: k.name, ...(k.description ? { description: k.description } : {}) })),
          };
          ctx.send(event);
          ctx.record(event);
          return {
            asked: keys.map((k) => k.name),
            note: "A secure form is now shown to the user. Stop here and ask them to fill it in.",
          };
        }),
    }),
  };
}
