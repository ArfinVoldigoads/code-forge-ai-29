import { Sandbox } from "e2b";
import { db } from "@/lib/db.server";

const TEMPLATE = "base";
const WORKDIR = "/home/user/project";

export async function getE2BKey(): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "e2b").maybeSingle();
  const value = (data?.value ?? {}) as { apiKey?: string };
  return value.apiKey ?? null;
}

type Session = { sandbox: Sandbox; sessionId: string };

/** Reuse a running sandbox for this chat, otherwise start a new one. */
export async function getSandboxForChat(chatId: string, apiKey: string): Promise<Session> {
  const { data: existing } = await db
    .from("sandbox_sessions")
    .select("id, sandbox_id")
    .eq("chat_id", chatId)
    .eq("status", "running")
    .order("last_active_at", { ascending: false })
    .maybeSingle();

  if (existing) {
    try {
      const sandbox = await Sandbox.connect(existing.sandbox_id, { apiKey });
      await sandbox.setTimeout(300_000);
      await db
        .from("sandbox_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { sandbox, sessionId: existing.id };
    } catch {
      await db.from("sandbox_sessions").update({ status: "stopped" }).eq("id", existing.id);
    }
  }

  const sandbox = await Sandbox.create(TEMPLATE, { apiKey, timeoutMs: 300_000 });
  await sandbox.commands.run(`mkdir -p ${WORKDIR}`);
  const { data: created } = await db
    .from("sandbox_sessions")
    .insert({
      chat_id: chatId,
      sandbox_id: sandbox.sandboxId,
      template: TEMPLATE,
      status: "running",
    } as never)
    .select("id")
    .single();

  return { sandbox, sessionId: created?.id ?? "" };
}

export function resolvePath(path: string): string {
  const clean = path.replace(/^\.\//, "").replace(/^\/+/, "");
  return path.startsWith("/home/") ? path : `${WORKDIR}/${clean}`;
}

const EXTRA_PATHS = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
  "/home/user/.bun/bin",
  "/home/user/.local/bin",
  "/home/user/.npm-global/bin",
  "/usr/local/node/bin",
  "/usr/lib/node_modules/.bin",
].join(":");

/**
 * Wrap a command in a login shell with a sane PATH so tools installed via
 * nvm/bun/pip resolve. Without this, non-interactive runs exit with 127.
 */
export function shellCommand(command: string): string {
  const script = [
    `export PATH="${EXTRA_PATHS}:$PATH"`,
    `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1`,
    `for d in $HOME/.nvm/versions/node/*/bin; do [ -d "$d" ] && export PATH="$d:$PATH"; done`,
    `mkdir -p ${WORKDIR}`,
    command,
  ].join("\n");
  return `bash -lc ${JSON.stringify(script)}`;
}

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

/**
 * Run a command and NEVER throw on a non-zero exit — E2B raises
 * CommandExitError, which otherwise surfaces as a useless "exit status 2".
 */
export async function runShell(
  sandbox: Sandbox,
  command: string,
  opts: { cwd?: string; timeoutMs?: number; onStdout?: (t: string) => void; onStderr?: (t: string) => void } = {},
): Promise<ShellResult> {
  try {
    const result = await sandbox.commands.run(shellCommand(command), {
      cwd: opts.cwd ?? WORKDIR,
      timeoutMs: opts.timeoutMs ?? 180_000,
      ...(opts.onStdout ? { onStdout: opts.onStdout } : {}),
      ...(opts.onStderr ? { onStderr: opts.onStderr } : {}),
    });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const e = error as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
    if (typeof e?.exitCode === "number") {
      return { exitCode: e.exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
    }
    return { exitCode: 1, stdout: "", stderr: e?.message ?? String(error) };
  }
}

export { WORKDIR };
