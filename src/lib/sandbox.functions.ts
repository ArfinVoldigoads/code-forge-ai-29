import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const chatOnly = z.object({ chatId: z.string().uuid() });

async function session(chatId: string) {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { getE2BKey, getSandboxForChat } = await import("./e2b.server");
  const apiKey = await getE2BKey();
  if (!apiKey) throw new Error("No E2B API key. Add one in Settings → E2B.");
  return getSandboxForChat(chatId, apiKey);
}

export const sandboxStatus = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => chatOnly.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { getE2BKey } = await import("./e2b.server");
    const { db } = await import("./db.server");
    const apiKey = await getE2BKey();
    const { data: row } = await db
      .from("sandbox_sessions")
      .select("sandbox_id, status, last_active_at")
      .eq("chat_id", data.chatId)
      .eq("status", "running")
      .order("last_active_at", { ascending: false })
      .maybeSingle();
    return {
      hasKey: Boolean(apiKey),
      sandboxId: row?.sandbox_id ?? null,
      lastActiveAt: row?.last_active_at ?? null,
    };
  });

export const startSandbox = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => chatOnly.parse(d))
  .handler(async ({ data }) => {
    const { sandbox } = await session(data.chatId);
    return { sandboxId: sandbox.sandboxId };
  });

export const listDir = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), path: z.string().default(".") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sandbox } = await session(data.chatId);
    const { resolvePath } = await import("./e2b.server");
    const entries = await sandbox.files.list(resolvePath(data.path));
    return {
      path: data.path,
      entries: entries
        .map((e) => ({ name: e.name, type: (e.type ?? "file") as string }))
        .sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
        ),
    };
  });

export const readSandboxFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), path: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sandbox } = await session(data.chatId);
    const { resolvePath } = await import("./e2b.server");
    const content = await sandbox.files.read(resolvePath(data.path));
    return { path: data.path, content: content.slice(0, 200_000) };
  });

export const writeSandboxFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ chatId: z.string().uuid(), path: z.string().min(1), content: z.string() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { sandbox } = await session(data.chatId);
    const { resolvePath } = await import("./e2b.server");
    await sandbox.files.write(resolvePath(data.path), data.content);
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
    const { sandbox, sessionId } = await session(data.chatId);
    const { resolvePath, WORKDIR, shellCommand } = await import("./e2b.server");
    const { db } = await import("./db.server");
    const cwd = data.cwd ? resolvePath(data.cwd) : WORKDIR;
    const clip = (t: string) => (t.length > 20000 ? `${t.slice(0, 20000)}\n…truncated` : t);
    try {
      const result = await sandbox.commands.run(shellCommand(data.command), { cwd, timeoutMs: 180_000 });
      const hint =
        result.exitCode === 127
          ? "\ncommand not found (exit 127) — install it first, e.g. `npm i -g <tool>` or `apt-get install -y <pkg>`."
          : "";
      const out = {
        exitCode: result.exitCode,
        stdout: clip(result.stdout),
        stderr: clip(result.stderr + hint),
      };
      await db.from("command_outputs").insert({
        sandbox_session_id: sessionId || null,
        command: data.command,
        stdout: out.stdout,
        stderr: out.stderr,
        exit_code: out.exitCode,
      } as never);
      return { ...out, durationMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, stdout: "", stderr: message, durationMs: Date.now() - started };
    }
  });

export const startPreview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), port: z.number().int().min(1024).max(65535) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sandbox } = await session(data.chatId);
    const { WORKDIR, shellCommand } = await import("./e2b.server");
    const port = data.port;
    const existing = await sandbox.commands.run(
      shellCommand(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`),
      { cwd: WORKDIR, timeoutMs: 5_000 },
    );
    if (existing.exitCode === 0) return { url: `https://${sandbox.getHost(port)}`, port };
    const command = `if [ -f package.json ]; then\n  if [ -f bun.lockb ] || [ -f bun.lock ]; then bun run dev -- --host 0.0.0.0 --port ${port};\n  elif [ -f pnpm-lock.yaml ]; then pnpm dev -- --host 0.0.0.0 --port ${port};\n  else npm run dev -- --host 0.0.0.0 --port ${port}; fi\nelif [ -f index.html ]; then python3 -m http.server ${port} --bind 0.0.0.0;\nelse echo 'No web project found. Ask the agent to create one first.' >&2; exit 1; fi`;
    await sandbox.commands.run(shellCommand(command), { cwd: WORKDIR, background: true });
    return { url: `https://${sandbox.getHost(port)}`, port };
  });
