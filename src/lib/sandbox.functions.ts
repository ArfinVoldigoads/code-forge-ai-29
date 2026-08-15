import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const sandboxStatus = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { getSandboxApiKey, getSandboxForChat } = await import("./daytona.server");
    const { db } = await import("./db.server");
    const apiKey = await getSandboxApiKey();
    const { data: row } = await db
      .from("sandbox_sessions")
      .select("sandbox_id, status, last_active_at")
      .eq("chat_id", data.chatId)
      .eq("status", "running")
      .order("last_active_at", { ascending: false })
      .maybeSingle();
    if (!apiKey) return { hasKey: false, sandboxId: null, lastActiveAt: null };
    if (!row) return { hasKey: true, sandboxId: null, lastActiveAt: null };

    // A stored row can point to an expired remote process. Probe it and let
    // getSandboxForChat transparently replace the session when it is stale.
    const active = await getSandboxForChat(data.chatId, apiKey);
    return {
      hasKey: true,
      sandboxId: active.sandbox.sandboxId,
      lastActiveAt: new Date().toISOString(),
    };
  });

export const startSandbox = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox } = await getSandboxSession(data.chatId);
    return { sandboxId: sandbox.sandboxId };
  });

/** Keep the chat's sandbox lease alive while the workspace is open. */
export const heartbeatSandbox = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { getSandboxApiKey, getSandboxForChat } = await import("./daytona.server");
    const apiKey = await getSandboxApiKey();
    if (!apiKey) return { alive: false, sandboxId: null };
    try {
      const { sandbox } = await getSandboxForChat(data.chatId, apiKey);
      return { alive: true, sandboxId: sandbox.sandboxId };
    } catch {
      return { alive: false, sandboxId: null };
    }
  });


export const listDir = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), path: z.string().default(".") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox } = await getSandboxSession(data.chatId);
    
    const entries = await sandbox.files.list(data.path);
    return {
      path: data.path,
      entries: entries
        .map((e: { name: string; type: string }) => ({ name: e.name, type: e.type }))
        .sort((a: { name: string; type: string }, b: { name: string; type: string }) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
        ),
    };
  });

export const readSandboxFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), path: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox } = await getSandboxSession(data.chatId);
    
    const content = await sandbox.files.read(data.path);
    return { path: data.path, content: content.slice(0, 200_000) };
  });

export const writeSandboxFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ chatId: z.string().uuid(), path: z.string().min(1), content: z.string() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox } = await getSandboxSession(data.chatId);
    
    await sandbox.files.write(data.path, data.content);
    return { ok: true as const };
  });

export const runCli = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chatId: z.string().uuid(),
        command: z.string().trim().min(1).max(4000),
        cwd: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const started = Date.now();
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox, sessionId } = await getSandboxSession(data.chatId);
    const {
      getSandboxApiKey,
      isRecoverableShellFailure,
      recreateSandboxForChat,
      resolvePath,
      WORKDIR,
      runShell,
    } = await import("./daytona.server");
    const { db } = await import("./db.server");
    const cwd = data.cwd ? resolvePath(data.cwd) : WORKDIR;
    const clip = (t: string) => (t.length > 20000 ? `${t.slice(0, 20000)}\n…truncated` : t);
    let activeSandbox = sandbox;
    let activeSessionId = sessionId;
    let result = await runShell(activeSandbox, data.command, { cwd, timeoutMs: 180_000 });
    let recovered = false;
    if (isRecoverableShellFailure(result)) {
      const apiKey = await getSandboxApiKey();
      if (apiKey) {
        const replacement = await recreateSandboxForChat(data.chatId, apiKey);
        activeSandbox = replacement.sandbox;
        activeSessionId = replacement.sessionId;
        result = await runShell(activeSandbox, data.command, { cwd, timeoutMs: 180_000 });
        recovered = true;
      }
    }
    const hint =
      result.exitCode === 127
        ? "\ncommand not found (exit 127) — install it first, e.g. `npm i -g <tool>` or `apt-get install -y <pkg>`."
        : "";
    const out = {
      exitCode: result.exitCode,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr + hint),
    };
    const durationMs = Date.now() - started;
    await db.from("command_outputs").insert({
      chat_id: data.chatId,
      source: "user",
      duration_ms: durationMs,
      sandbox_session_id: activeSessionId || null,
      command: data.command,
      stdout: out.stdout,
      stderr: out.stderr,
      exit_code: out.exitCode,
    } as never);
    return { ...out, durationMs, recovered };
  });

/** Unified console feed: commands run by you AND by the agent, newest last. */
export const consoleFeed = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(60) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const { data: rows } = await db
      .from("command_outputs")
      .select("id, command, stdout, stderr, exit_code, duration_ms, source, created_at")
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return {
      lines: (rows ?? [])
        .map((r) => ({
          id: r.id as string,
          command: r.command as string,
          output: [r.stdout, r.stderr].filter(Boolean).join("\n"),
          exitCode: (r.exit_code ?? 0) as number,
          ms: (r.duration_ms ?? 0) as number,
          source: ((r as { source?: string }).source ?? "user") as string,
          createdAt: r.created_at as string,
        }))
        .reverse(),
    };
  });

export const startPreview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), port: z.number().int().min(1024).max(65535) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox } = await getSandboxSession(data.chatId);
    const { WORKDIR, runBackground, runShell } = await import("./daytona.server");
    const port = data.port;
    const existing = await runShell(
      sandbox,
      `curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`,
      { cwd: WORKDIR, timeoutMs: 5_000 },
    );
    if (existing.exitCode === 0) return { url: await sandbox.previewUrl(port), port };
    const command = `if [ -f package.json ]; then\n  if [ -f bun.lockb ] || [ -f bun.lock ]; then bun run dev -- --host 0.0.0.0 --port ${port};\n  elif [ -f pnpm-lock.yaml ]; then pnpm dev -- --host 0.0.0.0 --port ${port};\n  else npm run dev -- --host 0.0.0.0 --port ${port}; fi\nelif [ -f index.html ]; then python3 -m http.server ${port} --bind 0.0.0.0;\nelse echo 'No web project found. Ask the agent to create one first.' >&2; exit 1; fi`;
    await runBackground(sandbox, command);
    const ready = await runShell(
      sandbox,
      `for i in $(seq 1 20); do curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null && exit 0; sleep 1; done; exit 1`,
      { cwd: WORKDIR, timeoutMs: 30_000 },
    );
    if (ready.exitCode !== 0) {
      throw new Error(`Preview did not start on port ${port}. Check the Console for the server error.`);
    }
    return { url: await sandbox.previewUrl(port), port };
  });

/** Boot the VNC desktop for this chat and return the public noVNC URL. */
export const startDesktop = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getSandboxSession } = await import("./sandbox-ops.server");
    const { sandbox } = await getSandboxSession(data.chatId);
    await sandbox.raw.computerUse.start().catch(() => undefined);
    const url = await sandbox.previewUrl(6080);
    return { url };
  });
