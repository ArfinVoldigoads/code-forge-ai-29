import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk";
import { db } from "@/lib/db.server";

const WORKDIR = "/home/daytona/project";
/** Sandbox stays up for an hour of inactivity; heartbeats keep pushing it forward. */
const AUTO_STOP_MINUTES = 60;
const DEFAULT_SNAPSHOT = "daytona-large";

export type SandboxConfig = {
  apiKey: string | null;
  apiUrl: string | null;
  target: string | null;
  snapshot: string;
  status?: string;
  statusMessage?: string | null;
  lastTestedAt?: string | null;
};

export async function getDaytonaSettings(): Promise<SandboxConfig> {
  const { data } = await db.from("app_settings").select("value").eq("key", "daytona").maybeSingle();
  const value = (data?.value ?? {}) as Partial<SandboxConfig>;
  return {
    apiKey: value.apiKey ?? null,
    apiUrl: value.apiUrl ?? null,
    target: value.target ?? null,
    snapshot: value.snapshot || DEFAULT_SNAPSHOT,
    status: value.status ?? "untested",
    statusMessage: value.statusMessage ?? null,
    lastTestedAt: value.lastTestedAt ?? null,
  };
}

/** The API key for the sandbox engine, or null when it has not been configured. */
export async function getSandboxApiKey(): Promise<string | null> {
  return (await getDaytonaSettings()).apiKey;
}

export function daytonaClient(apiKey: string, cfg?: Partial<SandboxConfig>): Daytona {
  return new Daytona({
    apiKey,
    ...(cfg?.apiUrl ? { apiUrl: cfg.apiUrl } : {}),
    ...(cfg?.target ? { target: cfg.target } : {}),
  });
}

/* ------------------------------ shell plumbing ----------------------------- */

export function shellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

const EXTRA_PATHS = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
  "/home/daytona/.bun/bin",
  "/home/daytona/.local/bin",
  "/home/daytona/.npm-global/bin",
  "/usr/local/node/bin",
  "/usr/lib/node_modules/.bin",
].join(":");

/** Wrap a command in a login shell with a sane PATH so installed tools resolve. */
export function shellCommand(command: string): string {
  const script = [
    `export PATH="${EXTRA_PATHS}:$PATH"`,
    `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1`,
    `for d in $HOME/.nvm/versions/node/*/bin; do [ -d "$d" ] && export PATH="$d:$PATH"; done`,
    `mkdir -p ${WORKDIR}`,
    `cd ${WORKDIR}`,
    command,
  ].join("\n");
  return `bash -lc ${shellArgument(script)}`;
}

export function resolvePath(path: string): string {
  const clean = path.replace(/^\.\//, "").replace(/^\/+/, "");
  return path.startsWith("/home/") || path.startsWith("/tmp/") ? path : `${WORKDIR}/${clean}`;
}

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a command inside the sandbox. Never throws on a non-zero exit; streams
 * incremental output when a callback is supplied.
 */
export async function runShell(
  handle: SandboxHandle,
  command: string,
  opts: {
    cwd?: string;
    timeoutMs?: number;
    envs?: Record<string, string>;
    onStdout?: (t: string) => void;
    onStderr?: (t: string) => void;
  } = {},
): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const wrapped = shellCommand(
    opts.cwd && opts.cwd !== WORKDIR ? `cd ${shellArgument(opts.cwd)}\n${command}` : command,
  );
  try {
    if (!opts.onStdout && !opts.onStderr) {
      // No cwd on purpose: the wrapper creates and enters WORKDIR itself, and
      // passing a not-yet-existing directory makes the whole command fail.
      const res = await handle.raw.process.executeCommand(
        wrapped,
        undefined,
        opts.envs,
        Math.ceil(timeoutMs / 1000),
      );
      return { exitCode: res.exitCode ?? 0, stdout: res.result ?? "", stderr: "" };
    }
    return await streamCommand(handle, wrapped, timeoutMs, opts.envs, opts.onStdout);
  } catch (error) {
    if (isDeadSandboxError(error)) throw error;
    const e = error as { exitCode?: number; result?: string; message?: string };
    if (typeof e?.exitCode === "number") {
      return { exitCode: e.exitCode, stdout: e.result ?? "", stderr: e.message ?? "" };
    }
    return { exitCode: 1, stdout: "", stderr: e?.message ?? String(error) };
  }
}

/** Async session command + log polling so the console shows output as it happens. */
async function streamCommand(
  handle: SandboxHandle,
  wrapped: string,
  timeoutMs: number,
  envs: Record<string, string> | undefined,
  onStdout?: (t: string) => void,
): Promise<ShellResult> {
  const sessionId = `agentkit-${crypto.randomUUID().slice(0, 8)}`;
  const prelude = envs
    ? `${Object.entries(envs)
        .map(([k, v]) => `export ${k}=${shellArgument(v)}`)
        .join("\n")}\n`
    : "";
  await handle.raw.process.createSession(sessionId);
  try {
    const started = await handle.raw.process.executeSessionCommand(sessionId, {
      command: `bash -lc ${shellArgument(`${prelude}${wrapped}`)}`,
      runAsync: true,
    });
    const cmdId = started.cmdId;
    let seen = 0;
    let output = "";
    let exitCode: number | undefined;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const logs = (await handle.raw.process
        .getSessionCommandLogs(sessionId, cmdId)
        .catch(() => ({}))) as { output?: string };
      output = logs.output ?? output;
      if (output.length > seen) {
        onStdout?.(output.slice(seen));
        seen = output.length;
      }
      const cmd = await handle.raw.process.getSessionCommand(sessionId, cmdId);
      if (typeof cmd.exitCode === "number") {
        exitCode = cmd.exitCode;
        break;
      }
      await sleep(800);
    }
    if (exitCode === undefined) {
      return { exitCode: 124, stdout: output, stderr: `Timed out after ${timeoutMs}ms` };
    }
    const final = (await handle.raw.process
      .getSessionCommandLogs(sessionId, cmdId)
      .catch(() => ({}))) as { output?: string };
    const full = final.output ?? output;
    if (full.length > seen) onStdout?.(full.slice(seen));
    return { exitCode, stdout: full, stderr: "" };
  } finally {
    await handle.raw.process.deleteSession(sessionId).catch(() => {});
  }
}

/** Start a long-lived process (dev server) that survives after this call returns. */
export async function runBackground(
  handle: SandboxHandle,
  command: string,
  envs?: Record<string, string>,
): Promise<void> {
  const sessionId = `agentkit-bg-${crypto.randomUUID().slice(0, 8)}`;
  const prelude = envs
    ? `${Object.entries(envs)
        .map(([k, v]) => `export ${k}=${shellArgument(v)}`)
        .join("\n")}\n`
    : "";
  await handle.raw.process.createSession(sessionId);
  await handle.raw.process.executeSessionCommand(sessionId, {
    command: `bash -lc ${shellArgument(`${prelude}${shellCommand(command)}`)}`,
    runAsync: true,
  });
}

/* -------------------------------- lifecycle -------------------------------- */

/** Thin adapter with the small surface the agent tools need. */
export class SandboxHandle {
  constructor(
    readonly raw: DaytonaSandbox,
    readonly apiKey: string,
  ) {}

  get sandboxId(): string {
    return this.raw.id;
  }

  files = {
    read: async (path: string): Promise<string> => {
      const buf = await this.raw.fs.downloadFile(resolvePath(path));
      return buf.toString("utf8");
    },
    readBytes: async (path: string): Promise<Uint8Array> => {
      const buf = await this.raw.fs.downloadFile(resolvePath(path));
      return new Uint8Array(buf);
    },
    write: async (path: string, content: string): Promise<void> => {
      const full = resolvePath(path);
      const dir = full.slice(0, full.lastIndexOf("/"));
      if (dir) await this.raw.fs.createFolder(dir, "755").catch(() => {});
      await this.raw.fs.uploadFile(Buffer.from(content, "utf8"), full);
    },
    list: async (path: string): Promise<{ name: string; type: string }[]> => {
      const entries = await this.raw.fs.listFiles(resolvePath(path));
      return entries.map((e) => ({ name: e.name, type: e.isDir ? "dir" : "file" }));
    },
  };

  /** Always-public HTTPS preview URL for a port inside the sandbox. */
  async previewUrl(port: number): Promise<string> {
    const link = await this.raw.getPreviewLink(port);
    return link.url;
  }

  async refreshLease(): Promise<void> {
    await this.raw.refreshActivity().catch(async () => {
      await this.raw.setAutostopInterval(AUTO_STOP_MINUTES);
    });
  }
}

export type Session = { sandbox: SandboxHandle; sessionId: string };

const SHELL_HEALTH_MARKER = "__agentkit_shell_ok__";

async function assertHealthyShell(handle: SandboxHandle): Promise<void> {
  // The sandbox agent needs a moment after start/resume before it accepts exec.
  let last: ShellResult = { exitCode: -1, stdout: "", stderr: "no attempt" };
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500);
    await handle.raw.fs.createFolder(WORKDIR, "755").catch(() => {});
    last = await runShell(handle, `printf '${SHELL_HEALTH_MARKER}'`, { timeoutMs: 20_000 });
    if (last.exitCode === 0 && last.stdout.includes(SHELL_HEALTH_MARKER)) return;
    if (isDeadSandboxError(last.stderr)) break;
  }
  const detail = [last.stderr, last.stdout].filter(Boolean).join(" ").trim().slice(0, 400);
  throw new Error(
    `Sandbox shell health check failed (exit ${last.exitCode})${detail ? `: ${detail}` : ""}`,
  );
}

/** Best effort: free a remote sandbox so it stops eating the org memory quota. */
async function destroySandbox(raw: { delete?: () => Promise<unknown> } | null): Promise<void> {
  await raw?.delete?.().catch(() => {});
}

/** Adopt a sandbox Daytona already holds for this chat instead of creating another. */
async function adoptExistingRemote(
  daytona: Daytona,
  chatId: string,
  apiKey: string,
): Promise<SandboxHandle | null> {
  const found: DaytonaSandbox[] = [];
  try {
    for await (const sb of daytona.list({ labels: { agentkit: "1", chat: chatId } })) {
      found.push(sb);
    }
  } catch {
    return null;
  }
  let adopted: SandboxHandle | null = null;
  for (const raw of found) {
    if (adopted) {
      // Anything extra for this chat is a leak from a failed start — remove it.
      await destroySandbox(raw as unknown as { delete?: () => Promise<unknown> });
      continue;
    }
    try {
      if (raw.state !== "started") await raw.start(120);
      const handle = new SandboxHandle(raw, apiKey);
      await handle.refreshLease().catch(() => {});
      await openSandboxNetwork(handle);
      await assertHealthyShell(handle);
      adopted = handle;
    } catch {
      await destroySandbox(raw as unknown as { delete?: () => Promise<unknown> });
    }
  }
  return adopted;
}

/** Daytona can boot a sandbox with a restrictive egress policy; open it once. */
export async function openSandboxNetwork(handle: SandboxHandle): Promise<void> {
  await (
    handle.raw as unknown as {
      updateNetworkSettings?: (s: {
        networkBlockAll: boolean;
        networkAllowList: string;
      }) => Promise<unknown>;
    }
  )
    .updateNetworkSettings?.({ networkBlockAll: false, networkAllowList: "0.0.0.0/0" })
    .catch(() => {});
}

/** One in-flight start per chat, so repeated Start clicks never fan out into new sandboxes. */
const pendingSessions = new Map<string, Promise<Session>>();

export function getSandboxForChat(chatId: string, apiKey: string): Promise<Session> {
  const inflight = pendingSessions.get(chatId);
  if (inflight) return inflight;
  const task = resolveSandboxForChat(chatId, apiKey).finally(() => {
    pendingSessions.delete(chatId);
  });
  pendingSessions.set(chatId, task);
  return task;
}

/** Reuse the chat's running sandbox, resuming or creating one when needed. */
async function resolveSandboxForChat(chatId: string, apiKey: string): Promise<Session> {
  const cfg = await getDaytonaSettings();
  const daytona = daytonaClient(apiKey, cfg);

  const { data: existing } = await db
    .from("sandbox_sessions")
    .select("id, sandbox_id")
    .eq("chat_id", chatId)
    .eq("status", "running")
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const persist = async (handle: SandboxHandle): Promise<Session> => {
    const { data: row } = await db
      .from("sandbox_sessions")
      .select("id")
      .eq("chat_id", chatId)
      .eq("sandbox_id", handle.sandboxId)
      .maybeSingle();
    if (row?.id) {
      await db
        .from("sandbox_sessions")
        .update({ status: "running", last_active_at: new Date().toISOString() })
        .eq("id", row.id);
      return { sandbox: handle, sessionId: row.id };
    }
    const { data: created } = await db
      .from("sandbox_sessions")
      .insert({
        chat_id: chatId,
        sandbox_id: handle.sandboxId,
        template: cfg.snapshot,
        status: "running",
      } as never)
      .select("id")
      .single();
    return { sandbox: handle, sessionId: created?.id ?? "" };
  };

  if (existing) {
    try {
      const raw = await daytona.get(existing.sandbox_id);
      if (raw.state !== "started") {
        await raw.start(120).catch(async () => {
          await raw.waitUntilStarted(120);
        });
      }
      const handle = new SandboxHandle(raw, apiKey);
      await handle.refreshLease().catch(() => {});
      await openSandboxNetwork(handle);
      await assertHealthyShell(handle);
      await db
        .from("sandbox_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { sandbox: handle, sessionId: existing.id };
    } catch {
      // The row is stale: drop the remote sandbox too, otherwise it keeps
      // holding memory from the org quota while nothing can use it.
      await daytona
        .get(existing.sandbox_id)
        .then((raw) => destroySandbox(raw as unknown as { delete?: () => Promise<unknown> }))
        .catch(() => {});
      await db.from("sandbox_sessions").update({ status: "stopped" }).eq("id", existing.id);
    }
  }

  // Daytona may still hold a sandbox for this chat even when our row is gone.
  const adopted = await adoptExistingRemote(daytona, chatId, apiKey);
  if (adopted) return persist(adopted);

  const create = () =>
    daytona.create(
      {
        snapshot: cfg.snapshot,
        public: true,
        autoStopInterval: AUTO_STOP_MINUTES,
        autoArchiveInterval: 60 * 24,
        labels: { agentkit: "1", chat: chatId },
      },
      { timeout: 180 },
    );

  let raw: DaytonaSandbox;
  try {
    raw = await create();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/limit exceeded|quota/i.test(message)) throw error;
    const freed = await purgeAbandonedSandboxes(daytona);
    if (freed === 0) {
      throw new Error(
        `${message} — no idle sandbox left to reclaim. Delete unused sandboxes in Daytona or pick a smaller size in Settings → Sandbox.`,
      );
    }
    raw = await create();
  }

  const handle = new SandboxHandle(raw, apiKey);
  await openSandboxNetwork(handle);
  await runShell(handle, `mkdir -p ${WORKDIR}`, { timeoutMs: 30_000 });
  await assertHealthyShell(handle);
  return persist(handle);
}

/** Delete AgentKit sandboxes no chat claims anymore, freeing the memory quota. */
async function purgeAbandonedSandboxes(daytona: Daytona): Promise<number> {
  const { data: rows } = await db
    .from("sandbox_sessions")
    .select("sandbox_id")
    .eq("status", "running");
  const claimed = new Set((rows ?? []).map((r) => (r as { sandbox_id: string }).sandbox_id));
  let freed = 0;
  try {
    for await (const sb of daytona.list({ labels: { agentkit: "1" } })) {
      if (claimed.has(sb.id)) continue;
      await destroySandbox(sb as unknown as { delete?: () => Promise<unknown> });
      freed++;
    }
  } catch {
    return freed;
  }
  return freed;
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
  "sandbox not found",
  "sandbox is stopped",
  "sandbox is archived",
  "not found: sandbox",
  "failed to connect to sandbox",
  "connection closed",
  "session not found",
  "econnreset",
  "socket hang up",
  "fetch failed",
  "502",
  "503",
];

/** True when an SDK call failed because the remote sandbox is gone or stopped. */
export function isDeadSandboxError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : typeof error === "string" ? error : ""
  ).toLowerCase();
  if (!message) return false;
  return DEAD_SANDBOX_ERRORS.some((needle) => message.includes(needle));
}

/** Retire the current session so the next lookup builds a clean sandbox. */
export async function recreateSandboxForChat(chatId: string, apiKey: string): Promise<Session> {
  await db
    .from("sandbox_sessions")
    .update({ status: "stopped" })
    .eq("chat_id", chatId)
    .eq("status", "running");
  return getSandboxForChat(chatId, apiKey);
}

/** Only the sandbox bound to this chat may ever be managed by the agent. */
export async function assertOwnedByChat(chatId: string, sandboxId: string): Promise<void> {
  const { data } = await db
    .from("sandbox_sessions")
    .select("id")
    .eq("chat_id", chatId)
    .eq("sandbox_id", sandboxId)
    .maybeSingle();
  if (!data) throw new Error("This sandbox does not belong to the current chat — refusing.");
}

/* --------------------------------- secrets --------------------------------- */

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
export async function syncEnvFile(handle: SandboxHandle, chatId: string): Promise<string[]> {
  const env = await getChatEnv(chatId);
  const names = Object.keys(env);
  if (names.length === 0) return names;
  const body = names.map((k) => `${k}=${env[k]}`).join("\n");
  await handle.files.write(`${WORKDIR}/.env`, `${body}\n`);
  return names;
}

export { WORKDIR, AUTO_STOP_MINUTES, DEFAULT_SNAPSHOT };
