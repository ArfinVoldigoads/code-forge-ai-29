import { tool } from "ai";
import { z } from "zod";
import type { SandboxHandle } from "@/lib/daytona.server";
import { db } from "@/lib/db.server";
import {
  getChatEnv,
  getSandboxForChat,
  isDeadSandboxError,
  isRecoverableShellFailure,
  recreateSandboxForChat,
  resolvePath,
  runShell,
  syncEnvFile,
  WORKDIR,
} from "@/lib/daytona.server";
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

const SHOT_DIR = "/home/daytona/.agentkit";

/** Strip a credential out of any command output before it reaches the model or UI. */
const redact = (text: string, ...secrets: (string | null | undefined)[]) =>
  secrets.reduce<string>(
    (acc, s) => (s && s.length > 6 ? acc.split(s).join("***") : acc),
    text,
  );

const ghHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "agentkit",
});


export function buildAgentTools(ctx: Ctx) {
  let session: { sandbox: SandboxHandle; sessionId: string } | null = null;
  let lastMark = Date.now();

  const sandbox = async () => {
    if (!session) {
      session = await getSandboxForChat(ctx.chatId, ctx.apiKey);
      await syncEnvFile(session.sandbox, ctx.chatId).catch(() => []);
      return session;
    }
    // Refresh the lease on every tool call so a long run never expires mid-task.
    try {
      await session.sandbox.refreshLease();
    } catch {
      session = await getSandboxForChat(ctx.chatId, ctx.apiKey);
      await syncEnvFile(session.sandbox, ctx.chatId).catch(() => []);
    }
    return session;
  };

  /** Rebuild the sandbox and keep going when the lease died mid-operation. */
  const respawn = async () => {
    const fresh = await recreateSandboxForChat(ctx.chatId, ctx.apiKey);
    session = fresh;
    await syncEnvFile(fresh.sandbox, ctx.chatId).catch(() => []);
    const notice: StreamEvent = {
      type: "command-output",
      id: "sandbox-recovery",
      stream: "stderr",
      text: `\n[agentkit] Sandbox lease lost — started a new sandbox (${fresh.sandbox.sandboxId}) and resumed.\n`,
    };
    ctx.send(notice);
    ctx.record(notice);
    return fresh;
  };

  /** Run a sandbox SDK call, transparently retrying once on a dead sandbox. */
  const withSandbox = async <T>(fn: (sbx: SandboxHandle) => Promise<T>): Promise<T> => {
    const active = await sandbox();
    try {
      return await fn(active.sandbox);
    } catch (error) {
      if (!isDeadSandboxError(error)) throw error;
      const fresh = await respawn();
      return fn(fresh.sandbox);
    }
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
    } finally {
      lastMark = Date.now();
    }
  };


  /** Shell helper that logs into the shared console feed and injects chat secrets. */
  const shell = async (
    command: string,
    opts: {
      toolId?: string;
      timeoutMs?: number;
      stream?: boolean;
      env?: Record<string, string>;
    } = {},
  ) => {
    const started = Date.now();
    let active = await sandbox();
    const envs = { ...(await getChatEnv(ctx.chatId)), ...(opts.env ?? {}) };

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
          await withSandbox((sbx) => sbx.files.write(resolvePath(path), content));
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
          const content: string = await withSandbox((sbx) => sbx.files.read(resolvePath(path)));
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
          const full = resolvePath(path);
          const content: string = await withSandbox((sbx) => sbx.files.read(full));
          const occurrences = content.split(find).length - 1;
          if (occurrences === 0) throw new Error("Snippet not found — read the file again.");
          if (occurrences > 1)
            throw new Error(`Snippet appears ${occurrences} times — include more context.`);
          const next = content.replace(find, replace);
          await withSandbox((sbx) => sbx.files.write(full, next));
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
          const entries = await withSandbox((sbx) => sbx.files.list(resolvePath(path ?? ".")));
          return { entries: entries.map((e) => ({ name: e.name, type: e.type })) };
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
          const { runBackground } = await import("@/lib/daytona.server");
          const envs = await getChatEnv(ctx.chatId);
          const alive = await shell(`curl -fsS --max-time 2 http://127.0.0.1:${p} >/dev/null`, {
            timeoutMs: 10_000,
          });
          if (alive.exitCode !== 0) {
            const command = `if [ -f package.json ]; then\n  if [ -f bun.lockb ] || [ -f bun.lock ]; then bun run dev -- --host 0.0.0.0 --port ${p};\n  elif [ -f pnpm-lock.yaml ]; then pnpm dev -- --host 0.0.0.0 --port ${p};\n  else npm run dev -- --host 0.0.0.0 --port ${p}; fi\nelif [ -f index.html ]; then python3 -m http.server ${p} --bind 0.0.0.0;\nelse echo 'No web project found' >&2; exit 1; fi`;
            await withSandbox((sbx) => runBackground(sbx, command, envs));
            const ready = await shell(
              `for i in $(seq 1 20); do curl -fsS --max-time 2 http://127.0.0.1:${p} >/dev/null && exit 0; sleep 1; done; exit 1`,
              { timeoutMs: 30_000 },
            );
            if (ready.exitCode !== 0) {
              throw new Error(`Dev server did not become ready on port ${p}. Inspect its console output, fix the startup error, and retry.`);
            }
          }
          const url = await withSandbox((sbx) => sbx.previewUrl(p));
          return { url, port: p, alreadyRunning: alive.exitCode === 0 };

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
          await withSandbox((sbx) => sbx.setTimeout(900_000)).catch(() => undefined);


          const preview = await shell(
            `curl -fsS --max-time 5 ${JSON.stringify(target)} >/dev/null`,
            { timeoutMs: 10_000 },
          );
          if (preview.exitCode !== 0) {
            throw new Error(`Cannot take a screenshot because no preview is responding at ${target}. Call start_dev_server first and use the same port.`);
          }

          // Resolve an existing Chromium binary before paying for any install.
          const findBin = `for c in chromium chromium-browser google-chrome google-chrome-stable; do command -v "$c" && exit 0; done; ls -1 "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -n1`;
          let bin = (await shell(findBin, { timeoutMs: 20_000 })).stdout.trim().split("\n").pop() ?? "";

          if (!bin) {
            const install = await shell(
              `npx --yes playwright@1.49.1 install --with-deps chromium 2>&1 | tail -n 20`,
              { toolId, stream: true, timeoutMs: 540_000 },
            );
            bin = (await shell(findBin, { timeoutMs: 20_000 })).stdout.trim().split("\n").pop() ?? "";
            if (!bin) {
              throw new Error(
                `Could not install a headless browser: ${clip(install.stderr || install.stdout)}`,
              );
            }
          }

          const shot = await shell(
            `mkdir -p ${SHOT_DIR} && rm -f ${SHOT_DIR}/shot.png && ${JSON.stringify(bin)} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --window-size=1280,900 --virtual-time-budget=4000 --screenshot=${SHOT_DIR}/shot.png ${JSON.stringify(target)} 2>&1 | tail -n 10; test -s ${SHOT_DIR}/shot.png`,
            { toolId, stream: true, timeoutMs: 120_000 },
          );
          if (shot.exitCode !== 0) {
            throw new Error(`Screenshot browser failed: ${clip(shot.stderr || shot.stdout)}`);
          }

          const bytes = await withSandbox((sbx) => sbx.files.readBytes(`${SHOT_DIR}/shot.png`));

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

    /* -------------------------- sandbox self-care ----------------------- */

    sandbox_info: tool({
      description:
        "Inspect YOUR sandbox: state, allocated CPU/memory/disk and current usage. Call this when something feels slow, a build gets killed, or before resizing.",
      inputSchema: z.object({}),
      execute: async () =>
        run("sandbox_info", {}, async () => {
          const active = await sandbox();
          const raw = active.sandbox.raw;
          await raw.refreshData().catch(() => {});
          let usage: Json = null;
          try {
            const m = await raw.getMetricsLatest();
            usage = {
              cpuUsedPct: m.cpuUsedPct ?? null,
              memUsed: m.memUsed ?? null,
              memTotal: m.memTotal ?? null,
              diskUsed: m.diskUsed ?? null,
              diskTotal: m.diskTotal ?? null,
            } as Json;
          } catch {
            /* metrics are best-effort */
          }
          return {
            sandboxId: raw.id,
            state: raw.state ?? null,
            cpu: raw.cpu ?? null,
            memoryGiB: raw.memory ?? null,
            diskGiB: raw.disk ?? null,
            public: raw.public ?? null,
            snapshot: raw.snapshot ?? null,
            usage,
          } as Json;
        }),
    }),

    sandbox_resize: tool({
      description:
        "Give YOUR OWN sandbox more CPU/RAM/disk when a build is killed, memory runs out, or disk fills up. Only affects the sandbox of this chat. Max 8 vCPU / 16 GiB RAM / 50 GiB disk.",
      inputSchema: z.object({
        cpu: z.number().int().min(1).max(8),
        memory: z.number().int().min(1).max(16).describe("RAM in GiB"),
        disk: z.number().int().min(3).max(50).describe("disk in GiB"),
        reason: z.string().optional(),
      }),
      execute: async ({ cpu, memory, disk, reason }) =>
        run("sandbox_resize", { cpu, memory, disk, reason: reason ?? null }, async () => {
          const active = await sandbox();
          const { assertOwnedByChat } = await import("@/lib/daytona.server");
          await assertOwnedByChat(ctx.chatId, active.sandbox.sandboxId);
          const raw = active.sandbox.raw;
          await raw.resize({ cpu, memory, disk }, 300);
          await raw.waitForResizeComplete(300).catch(() => {});
          await raw.refreshData().catch(() => {});
          return {
            resized: true,
            cpu: raw.cpu ?? cpu,
            memoryGiB: raw.memory ?? memory,
            diskGiB: raw.disk ?? disk,
          };
        }),
    }),

    sandbox_restart: tool({
      description:
        "Restart YOUR sandbox when it is wedged (hung processes, broken shell). Files on disk survive. Dev servers must be started again afterwards.",
      inputSchema: z.object({ reason: z.string().optional() }),
      execute: async ({ reason }) =>
        run("sandbox_restart", { reason: reason ?? null }, async () => {
          const active = await sandbox();
          const { assertOwnedByChat } = await import("@/lib/daytona.server");
          await assertOwnedByChat(ctx.chatId, active.sandbox.sandboxId);
          const raw = active.sandbox.raw;
          await raw.stop(180).catch(() => {});
          await raw.start(180);
          await raw.waitUntilStarted(180).catch(() => {});
          return { sandboxId: raw.id, state: raw.state ?? "started" };
        }),
    }),

    sandbox_network_check: tool({
      description:
        "Diagnose outbound internet from inside the sandbox (DNS, HTTPS, npm registry). If access is blocked, this clears the network restrictions on your own sandbox and re-tests.",
      inputSchema: z.object({ url: z.string().url().optional() }),
      execute: async ({ url }) =>
        run("sandbox_network_check", { url: url ?? null }, async () => {
          const target = url ?? "https://registry.npmjs.org/-/ping";
          const probe = () =>
            shell(
              `getent hosts registry.npmjs.org || true; curl -s -o /dev/null -w 'http=%{http_code} time=%{time_total}\n' --max-time 12 ${JSON.stringify(target)}`,
              { timeoutMs: 30_000 },
            );
          let out = await probe();
          let unblocked = false;
          if (out.exitCode !== 0 || !/http=[23]/.test(out.stdout)) {
            const active = await sandbox();
            const { assertOwnedByChat } = await import("@/lib/daytona.server");
            await assertOwnedByChat(ctx.chatId, active.sandbox.sandboxId);
            await active.sandbox.raw
              .updateNetworkSettings({ networkBlockAll: false, networkAllowList: "0.0.0.0/0" })
              .catch(() => {});
            unblocked = true;
            out = await probe();
          }
          return {
            target,
            ok: /http=[23]/.test(out.stdout),
            unblockedNetwork: unblocked,
            detail: clip(out.stdout || out.stderr),
          };
        }),
    }),

    /* ------------------------------ desktop ----------------------------- */

    desktop_start: tool({
      description:
        "Start the sandbox desktop (Xvfb + XFCE + VNC) and return a public HTTPS noVNC URL. Use it to run GUI apps or to click through a real browser. The user can watch the same screen in the Desktop tab.",
      inputSchema: z.object({}),
      execute: async () =>
        run("desktop_start", {}, async () => {
          const active = await sandbox();
          await active.sandbox.raw.computerUse.start();
          const url = await active.sandbox.previewUrl(6080);
          const info = await active.sandbox.raw.computerUse.display.getInfo().catch(() => null);
          return {
            vncUrl: url,
            screens: (info?.displays?.length ?? null) as Json,
          } as Json;
        }),
    }),

    desktop_screenshot: tool({
      description:
        "Capture the sandbox desktop screen and attach it to the chat. Use after desktop_start to see what a GUI app or browser is showing.",
      inputSchema: z.object({ caption: z.string().optional() }),
      execute: async ({ caption }) =>
        run("desktop_screenshot", { caption: caption ?? null }, async () => {
          const active = await sandbox();
          const shot = await active.sandbox.raw.computerUse.screenshot.takeCompressed({
            format: "png",
            showCursor: true,
          });
          if (!shot.screenshot) throw new Error("Desktop returned an empty screenshot — is the desktop started?");
          const bytes = Buffer.from(shot.screenshot.replace(/^data:image\/\w+;base64,/, ""), "base64");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const key = `${ctx.chatId}/${Date.now()}-desktop.png`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("screenshots")
            .upload(key, bytes, { contentType: "image/png", upsert: true });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
          const { data: signed } = await supabaseAdmin.storage
            .from("screenshots")
            .createSignedUrl(key, 60 * 60 * 24 * 30);
          if (signed?.signedUrl) {
            const image: StreamEvent = {
              type: "image",
              id: crypto.randomUUID(),
              url: signed.signedUrl,
              caption: caption ?? "Sandbox desktop",
            };
            ctx.send(image);
            ctx.record(image);
          }
          return { url: signed?.signedUrl ?? null };
        }),
    }),

    desktop_input: tool({
      description:
        "Control the sandbox desktop: click coordinates, type text, or press a key combination. Take a desktop_screenshot first so you know where to click.",
      inputSchema: z.object({
        action: z.enum(["click", "double_click", "type", "key", "scroll", "move"]),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        text: z.string().optional(),
        keys: z.string().optional().describe("hotkey, e.g. 'ctrl+l' or 'Return'"),
        direction: z.enum(["up", "down"]).optional(),
        amount: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ action, x, y, text, keys, direction, amount }) =>
        run("desktop_input", { action, x: x ?? null, y: y ?? null }, async () => {
          const active = await sandbox();
          const cu = active.sandbox.raw.computerUse;
          switch (action) {
            case "click":
            case "double_click":
              if (x === undefined || y === undefined) throw new Error("click needs x and y");
              await cu.mouse.click(x, y, "left", action === "double_click");
              break;
            case "move":
              if (x === undefined || y === undefined) throw new Error("move needs x and y");
              await cu.mouse.move(x, y);
              break;
            case "scroll":
              if (x === undefined || y === undefined) throw new Error("scroll needs x and y");
              await cu.mouse.scroll(x, y, direction ?? "down", amount ?? 3);
              break;
            case "type":
              if (!text) throw new Error("type needs text");
              await cu.keyboard.type(text);
              break;
            case "key":
              if (!keys) throw new Error("key needs keys");
              await cu.keyboard.hotkey(keys);
              break;
          }
          return { ok: true, action };
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

    deep_research: tool({
      description:
        "Deep web research in one call: expands your question into several queries, searches them all, opens the best pages and returns numbered sources with excerpts. Use this instead of many web_search calls when you need to actually understand something (third-party APIs, unfamiliar errors, deployment docs). Always cite the returned URLs.",
      inputSchema: z.object({
        question: z.string().min(3),
        depth: z.number().int().min(2).max(6).optional(),
        maxPages: z.number().int().min(2).max(10).optional(),
      }),
      execute: async ({ question, depth, maxPages }) =>
        run("deep_research", { question, depth: depth ?? 4 }, async () => {
          const { deepResearch } = await import("@/lib/research.server");
          const result = await deepResearch(question, {
            ...(depth !== undefined ? { depth } : {}),
            ...(maxPages !== undefined ? { maxPages } : {}),
          });
          return {
            question: result.question,
            queries: result.queries,
            notes: result.notes,
            sources: result.sources.map((s) => ({
              ref: `[${s.index}] ${s.title} — ${s.url}`,
              url: s.url,
              snippet: s.snippet,
              excerpt: s.excerpt ? clip(s.excerpt) : null,
              ...(s.error ? { error: s.error } : {}),
            })),
          };
        }),
    }),

    /* ---------------------------- integrations -------------------------- */

    integration_status: tool({
      description:
        "Check which external accounts (GitHub, Vercel, Cloudflare) are connected in Settings → Integrations, and under which account. Call this before any push or deploy so you never have to ask the user which account to use.",
      inputSchema: z.object({}),
      execute: async () =>
        run("integration_status", {}, async () => {
          const { readIntegration } = await import("@/lib/integrations.server");
          const kinds = ["github", "vercel", "cloudflare"] as const;
          const rows = await Promise.all(
            kinds.map(async (kind) => {
              const v = await readIntegration(kind);
              return {
                kind,
                connected: Boolean(v.token),
                account: v.account,
                status: v.status,
                ...(kind === "cloudflare" ? { accountId: v.extra } : {}),
                ...(kind === "vercel" ? { teamId: v.extra } : {}),
              };
            }),
          );
          return { integrations: rows };
        }),
    }),

    github_whoami: tool({
      description: "Return the GitHub account behind the connected token (login, name, repo count).",
      inputSchema: z.object({}),
      execute: async () =>
        run("github_whoami", {}, async () => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token } = await requireIntegration("github");
          const res = await fetch("https://api.github.com/user", {
            headers: ghHeaders(token!),
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw new Error(`GitHub HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j = (await res.json()) as { login: string; name?: string; public_repos?: number };
          return { login: j.login, name: j.name ?? null, publicRepos: j.public_repos ?? null };
        }),
    }),

    github_create_repo: tool({
      description:
        "Create a repository on the connected GitHub account (idempotent: returns the existing repo if the name is taken by this account).",
      inputSchema: z.object({
        name: z.string().min(1),
        private: z.boolean().optional(),
        description: z.string().optional(),
      }),
      execute: async ({ name, private: isPrivate, description }) =>
        run("github_create_repo", { name, private: isPrivate ?? true }, async () => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token } = await requireIntegration("github");
          const me = await fetch("https://api.github.com/user", {
            headers: ghHeaders(token!),
            signal: AbortSignal.timeout(20_000),
          });
          if (!me.ok) throw new Error(`GitHub HTTP ${me.status}`);
          const login = ((await me.json()) as { login: string }).login;

          const existing = await fetch(`https://api.github.com/repos/${login}/${name}`, {
            headers: ghHeaders(token!),
            signal: AbortSignal.timeout(20_000),
          });
          if (existing.ok) {
            const j = (await existing.json()) as { full_name: string; html_url: string };
            return { created: false, fullName: j.full_name, url: j.html_url, owner: login };
          }

          const res = await fetch("https://api.github.com/user/repos", {
            method: "POST",
            headers: { ...ghHeaders(token!), "content-type": "application/json" },
            body: JSON.stringify({
              name,
              private: isPrivate ?? true,
              description: description ?? "Created by agentkit",
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`GitHub HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
          const j = (await res.json()) as { full_name: string; html_url: string };
          return { created: true, fullName: j.full_name, url: j.html_url, owner: login };
        }),
    }),

    github_push: tool({
      description:
        "Commit everything in the project directory and push it to a GitHub repo using the connected token. Creates the repo first with github_create_repo if it does not exist. Credentials are never written to disk or printed.",
      inputSchema: z.object({
        repo: z.string().min(1).describe("owner/repo or just repo (defaults to the connected user)"),
        branch: z.string().optional(),
        message: z.string().optional(),
      }),
      execute: async ({ repo, branch, message }) =>
        run("github_push", { repo, branch: branch ?? "main" }, async (toolId) => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token } = await requireIntegration("github");
          const me = await fetch("https://api.github.com/user", {
            headers: ghHeaders(token!),
            signal: AbortSignal.timeout(20_000),
          });
          if (!me.ok) throw new Error(`GitHub HTTP ${me.status}`);
          const login = ((await me.json()) as { login: string }).login;
          const full = repo.includes("/") ? repo : `${login}/${repo}`;
          const ref = branch || "main";
          const commitMessage = (message || "chore: update from agentkit").replace(/'/g, "'\\''");

          const script = [
            `set -e`,
            `git config --global --add safe.directory "$PWD" || true`,
            `git init -q 2>/dev/null || true`,
            `git config user.email "agent@agentkit.local"`,
            `git config user.name "agentkit"`,
            `git checkout -B ${ref} -q`,
            `printf '%s\\n' 'node_modules' '.env' '.next' 'dist' '.vercel' > .gitignore.agentkit`,
            `if [ ! -f .gitignore ]; then mv .gitignore.agentkit .gitignore; else rm -f .gitignore.agentkit; fi`,
            `git add -A`,
            `git commit -q -m '${commitMessage}' || echo "nothing to commit"`,
            `git push --quiet --force "https://x-access-token:\${GITHUB_TOKEN}@github.com/${full}.git" ${ref} 2>&1 | sed -e "s#https://[^@]*@#https://#g"`,
          ].join("\n");

          const result = await shell(script, { toolId, stream: true, timeoutMs: 300_000, env: { GITHUB_TOKEN: token! } });
          const out = redact(`${result.stdout}\n${result.stderr}`, token!);
          if (result.exitCode !== 0) throw new Error(`git push failed (exit ${result.exitCode}): ${out.slice(-1500)}`);
          return { repo: full, branch: ref, url: `https://github.com/${full}`, output: clip(out) };
        }),
    }),

    vercel_whoami: tool({
      description: "Return the Vercel account/team behind the connected token.",
      inputSchema: z.object({}),
      execute: async () =>
        run("vercel_whoami", {}, async () => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("vercel");
          const url = new URL("https://api.vercel.com/v2/user");
          if (extra) url.searchParams.set("teamId", extra);
          const res = await fetch(url, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw new Error(`Vercel HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j = (await res.json()) as { user?: { username?: string; email?: string } };
          return { username: j.user?.username ?? null, email: j.user?.email ?? null, teamId: extra };
        }),
    }),

    vercel_list_projects: tool({
      description: "List projects on the connected Vercel account/team.",
      inputSchema: z.object({}),
      execute: async () =>
        run("vercel_list_projects", {}, async () => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("vercel");
          const url = new URL("https://api.vercel.com/v9/projects");
          url.searchParams.set("limit", "50");
          if (extra) url.searchParams.set("teamId", extra);
          const res = await fetch(url, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw new Error(`Vercel HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j = (await res.json()) as { projects?: { name: string; framework?: string }[] };
          return { projects: (j.projects ?? []).map((p) => ({ name: p.name, framework: p.framework ?? null })) };
        }),
    }),

    vercel_deploy: tool({
      description:
        "Deploy the sandbox project to Vercel with the Vercel CLI and the connected token. Installs the CLI if needed and returns the deployment URL. Read the build output on failure, fix the cause, and call again.",
      inputSchema: z.object({
        projectName: z.string().min(1),
        prod: z.boolean().optional(),
        buildCommand: z.string().optional(),
      }),
      execute: async ({ projectName, prod, buildCommand }) =>
        run("vercel_deploy", { projectName, prod: prod ?? true }, async (toolId) => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("vercel");
          const safeName = projectName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
          const script = [
            `set -e`,
            `command -v vercel >/dev/null 2>&1 || npm i -g vercel@latest >/dev/null 2>&1`,
            buildCommand ? buildCommand : `true`,
            `vercel deploy --yes ${prod === false ? "" : "--prod"} --token "$VERCEL_TOKEN" ${extra ? `--scope "$VERCEL_ORG_ID"` : ""} --name ${safeName} 2>&1`,
          ].join("\n");
          const env: Record<string, string> = { VERCEL_TOKEN: token! };
          if (extra) env["VERCEL_ORG_ID"] = extra;
          const result = await shell(script, { toolId, stream: true, timeoutMs: 900_000, env });
          const out = redact(`${result.stdout}\n${result.stderr}`, token!);
          const url = /https:\/\/[a-z0-9-]+\.vercel\.app/gi.exec(out)?.[0] ?? null;
          if (result.exitCode !== 0) {
            throw new Error(`vercel deploy failed (exit ${result.exitCode}): ${out.slice(-2000)}`);
          }
          return { project: safeName, url, output: clip(out) };
        }),
    }),

    cloudflare_whoami: tool({
      description: "Verify the Cloudflare token and return the connected account.",
      inputSchema: z.object({}),
      execute: async () =>
        run("cloudflare_whoami", {}, async () => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("cloudflare");
          const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${extra}`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20_000),
          });
          const j = (await res.json().catch(() => ({}))) as { result?: { name?: string }; success?: boolean };
          if (!res.ok || !j.success) throw new Error(`Cloudflare HTTP ${res.status}`);
          return { accountId: extra, accountName: j.result?.name ?? null };
        }),
    }),

    cloudflare_list_workers: tool({
      description: "List Workers scripts on the connected Cloudflare account.",
      inputSchema: z.object({}),
      execute: async () =>
        run("cloudflare_list_workers", {}, async () => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("cloudflare");
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${extra}/workers/scripts`,
            { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
          );
          const j = (await res.json().catch(() => ({}))) as {
            result?: { id: string; modified_on?: string }[];
            success?: boolean;
          };
          if (!res.ok || !j.success) throw new Error(`Cloudflare HTTP ${res.status}`);
          return { workers: (j.result ?? []).map((w) => ({ name: w.id, modifiedOn: w.modified_on ?? null })) };
        }),
    }),

    cloudflare_deploy_worker: tool({
      description:
        "Deploy the project to Cloudflare Workers with wrangler using the connected token. Creates a minimal wrangler.toml when the project has none, installs wrangler if missing, and returns the workers.dev URL.",
      inputSchema: z.object({
        name: z.string().min(1),
        entry: z.string().optional().describe("entry file, e.g. src/index.ts"),
        buildCommand: z.string().optional(),
      }),
      execute: async ({ name, entry, buildCommand }) =>
        run("cloudflare_deploy_worker", { name, entry: entry ?? null }, async (toolId) => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("cloudflare");
          const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
          const main = entry || "src/index.ts";
          const script = [
            `set -e`,
            `command -v wrangler >/dev/null 2>&1 || npm i -g wrangler@latest >/dev/null 2>&1`,
            buildCommand ? buildCommand : `true`,
            `if [ ! -f wrangler.toml ] && [ ! -f wrangler.jsonc ] && [ ! -f wrangler.json ]; then`,
            `  mkdir -p "$(dirname ${main})"`,
            `  if [ ! -f ${main} ]; then printf '%s\\n' 'export default { async fetch() { return new Response("Hello from agentkit"); } };' > ${main}; fi`,
            `  printf '%s\\n' 'name = "${safeName}"' 'main = "${main}"' 'compatibility_date = "2026-01-01"' > wrangler.toml`,
            `fi`,
            `wrangler deploy 2>&1`,
          ].join("\n");
          const result = await shell(script, {
            toolId,
            stream: true,
            timeoutMs: 900_000,
            env: { CLOUDFLARE_API_TOKEN: token!, CLOUDFLARE_ACCOUNT_ID: extra ?? "" },
          });
          const out = redact(`${result.stdout}\n${result.stderr}`, token!);
          const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/gi.exec(out)?.[0] ?? null;
          if (result.exitCode !== 0) {
            throw new Error(`wrangler deploy failed (exit ${result.exitCode}): ${out.slice(-2000)}`);
          }
          return { worker: safeName, url, output: clip(out) };
        }),
    }),

    cloudflare_tail: tool({
      description: "Fetch recent wrangler logs for a deployed Worker to debug runtime errors.",
      inputSchema: z.object({ name: z.string().min(1), seconds: z.number().int().min(5).max(60).optional() }),
      execute: async ({ name, seconds }) =>
        run("cloudflare_tail", { name }, async (toolId) => {
          const { requireIntegration } = await import("@/lib/integrations.server");
          const { token, extra } = await requireIntegration("cloudflare");
          const result = await shell(
            `command -v wrangler >/dev/null 2>&1 || npm i -g wrangler@latest >/dev/null 2>&1\ntimeout ${seconds ?? 20} wrangler tail ${name} --format pretty 2>&1 || true`,
            {
              toolId,
              stream: true,
              timeoutMs: 120_000,
              env: { CLOUDFLARE_API_TOKEN: token!, CLOUDFLARE_ACCOUNT_ID: extra ?? "" },
            },
          );
          return { logs: clip(redact(`${result.stdout}\n${result.stderr}`, token!)) };
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
