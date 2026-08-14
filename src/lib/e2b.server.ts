import { Sandbox } from "e2b";
import { db } from "@/lib/db.server";

const TEMPLATE = "base";
const WORKDIR = "/home/user/project";
// Refreshable one-hour lease: an open workspace should not expire after five minutes.
const SANDBOX_LEASE_MS = 60 * 60 * 1000;

export async function getE2BKey(): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "e2b").maybeSingle();
  const value = (data?.value ?? {}) as { apiKey?: string };
  return value.apiKey ?? null;
}

type Session = { sandbox: Sandbox; sessionId: string };

const SHELL_HEALTH_MARKER = "__agentkit_shell_ok__";

function shellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function assertHealthyShell(sandbox: Sandbox): Promise<void> {
  const result = await runShell(sandbox, `printf '${SHELL_HEALTH_MARKER}'`, {
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0 || !result.stdout.includes(SHELL_HEALTH_MARKER)) {
    throw new Error(result.stderr || "Sandbox shell health check failed");
  }
}

/** Reuse a running sandbox for this chat, otherwise start a new one. */
export async function getSandboxForChat(chatId: string, apiKey: string): Promise<Session> {
  const { data: existing } = await db
    .from("sandbox_sessions")
    .select("id, sandbox_id")
    .eq("chat_id", chatId)
    .eq("status", "running")
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    try {
      const sandbox = await Sandbox.connect(existing.sandbox_id, { apiKey });
      await sandbox.setTimeout(SANDBOX_LEASE_MS);
      await assertHealthyShell(sandbox);
      await db
        .from("sandbox_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { sandbox, sessionId: existing.id };
    } catch {
      await db.from("sandbox_sessions").update({ status: "stopped" }).eq("id", existing.id);
    }
  }

  const sandbox = await Sandbox.create(TEMPLATE, { apiKey, timeoutMs: SANDBOX_LEASE_MS });
  await sandbox.commands.run(`mkdir -p ${WORKDIR}`);
  await assertHealthyShell(sandbox);
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
  return `bash -lc ${shellArgument(script)}`;
}

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

/**
 * Run a command and NEVER throw on a non-zero exit — E2B raises
 * CommandExitError, which otherwise surfaces as a useless "exit status 2".
 */
export async function runShell(
  sandbox: Sandbox,
  command: string,
  opts: {
    cwd?: string;
    timeoutMs?: number;
    envs?: Record<string, string>;
    onStdout?: (t: string) => void;
    onStderr?: (t: string) => void;
  } = {},
): Promise<ShellResult> {
  try {
    const result = await sandbox.commands.run(shellCommand(command), {
      cwd: opts.cwd ?? WORKDIR,
      timeoutMs: opts.timeoutMs ?? 180_000,
      ...(opts.envs ? { envs: opts.envs } : {}),
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

const RECOVERABLE_SHELL_ERRORS = [
  "syntax error near unexpected token",
  "sandbox not running",
  "sandbox is not running",
  "sandbox was not found",
  "failed to connect to sandbox",
  "connection closed",
  "session not found",
];

export function isRecoverableShellFailure(result: ShellResult): boolean {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return RECOVERABLE_SHELL_ERRORS.some((message) => detail.includes(message));
}

const DEAD_SANDBOX_ERRORS = [
  "sandbox not running",
  "sandbox is not running",
  "sandbox was not found",
  "sandbox timeout",
  "failed to connect to sandbox",
  "connection closed",
  "session not found",
  "not found: sandbox",
  "502",
  "503",
  "econnreset",
  "socket hang up",
  "fetch failed",
];

/** True when an SDK call failed because the remote sandbox lease is gone. */
export function isDeadSandboxError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : typeof error === "string" ? error : ""
  ).toLowerCase();
  if (!message) return false;
  return DEAD_SANDBOX_ERRORS.some((needle) => message.includes(needle));
}


/** Stop stale sessions so the next lookup creates a clean sandbox. */
export async function recreateSandboxForChat(chatId: string, apiKey: string): Promise<Session> {
  await db
    .from("sandbox_sessions")
    .update({ status: "stopped" })
    .eq("chat_id", chatId)
    .eq("status", "running");
  return getSandboxForChat(chatId, apiKey);
}

/** Secrets the user filled in for this chat, ready to inject as env vars. */
export async function getChatEnv(chatId: string): Promise<Record<string, string>> {
  const { data } = await db
    .from("project_secrets")
    .select("name, value")
    .eq("chat_id", chatId)
    .eq("status", "set");
  const env: Record<string, string> = {};
  for (const row of data ?? []) {
    const name = (row as { name: string }).name;
    const value = (row as { value: string | null }).value;
    if (name && value) env[name] = value;
  }
  return env;
}

/** Mirror the chat secrets into the project's .env so tooling picks them up. */
export async function syncEnvFile(sandbox: Sandbox, chatId: string): Promise<string[]> {
  const env = await getChatEnv(chatId);
  const names = Object.keys(env);
  if (names.length === 0) return names;
  const body = names.map((k) => `${k}=${env[k]}`).join("\n");
  await sandbox.files.write(`${WORKDIR}/.env`, `${body}\n`);
  return names;
}

export { WORKDIR };

