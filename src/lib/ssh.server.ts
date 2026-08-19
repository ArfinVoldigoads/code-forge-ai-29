import type { Client as SSHClient } from "ssh2";

export type VpsConfig = {
  enabled: boolean;
  host: string | null;
  port: number;
  username: string;
  password: string | null;
  privateKey: string | null;
  status?: string;
  statusMessage?: string | null;
  lastTestedAt?: string | null;
};

export type ExecResult = { exitCode: number; stdout: string; stderr: string };

const pool = new Map<string, Promise<SSHClient>>();

const keyOf = (cfg: VpsConfig) => `${cfg.username}@${cfg.host}:${cfg.port}`;

function assertConfigured(cfg: VpsConfig): asserts cfg is VpsConfig & { host: string } {
  if (!cfg.host) throw new Error("No VPS configured. Add host, username and password in Settings → Runtime.");
  if (!cfg.password && !cfg.privateKey) throw new Error("VPS has no password or private key configured.");
}

async function createConnection(cfg: VpsConfig): Promise<SSHClient> {
  assertConfigured(cfg);
  const { Client } = await import("ssh2");
  const conn = new Client();
  await new Promise<void>((resolve, reject) => {
    const fail = (e: unknown) => reject(new Error(`SSH connect failed: ${(e as Error)?.message ?? String(e)}`));
    conn.once("ready", () => resolve());
    conn.once("error", fail);
    conn.connect({
      host: cfg.host as string,
      port: cfg.port || 22,
      username: cfg.username,
      ...(cfg.password ? { password: cfg.password } : {}),
      ...(cfg.privateKey ? { privateKey: cfg.privateKey } : {}),
      readyTimeout: 25_000,
      keepaliveInterval: 15_000,
      tryKeyboard: true,
    });
  });
  conn.once("close", () => {
    if (pool.get(keyOf(cfg)) !== undefined) pool.delete(keyOf(cfg));
  });
  conn.once("error", () => pool.delete(keyOf(cfg)));
  return conn;
}

/** Reuse one SSH connection per host; reconnect transparently when it drops. */
async function connection(cfg: VpsConfig): Promise<SSHClient> {
  const k = keyOf(cfg);
  const existing = pool.get(k);
  if (existing) {
    try {
      return await existing;
    } catch {
      pool.delete(k);
    }
  }
  const task = createConnection(cfg).catch((e) => {
    pool.delete(k);
    throw e;
  });
  pool.set(k, task);
  return task;
}

export function dropConnection(cfg: VpsConfig): void {
  const k = keyOf(cfg);
  const held = pool.get(k);
  pool.delete(k);
  void held?.then((c) => c.end()).catch(() => {});
}

type ExecOpts = {
  timeoutMs?: number;
  input?: string | Uint8Array;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

/** Run one command over SSH. Never throws on non-zero exit. */
export async function sshExec(
  cfg: VpsConfig,
  command: string,
  opts: ExecOpts = {},
): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  let conn: SSHClient;
  try {
    conn = await connection(cfg);
  } catch (error) {
    dropConnection(cfg);
    conn = await connection(cfg);
    if (!conn) throw error;
  }

  return new Promise<ExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (exitCode: number, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr: extra ? `${stderr}${extra}` : stderr });
    };
    const timer = setTimeout(() => finish(124, `\nTimed out after ${timeoutMs}ms`), timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) {
        dropConnection(cfg);
        finish(1, `ssh exec error: ${err.message}`);
        return;
      }
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        opts.onStdout?.(text);
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        opts.onStderr?.(text);
      });
      stream.on("close", (code: number | null) => finish(code ?? 0));
      stream.on("error", (e: Error) => finish(1, `\n${e.message}`));
      if (opts.input !== undefined) {
        stream.end(typeof opts.input === "string" ? Buffer.from(opts.input, "utf8") : Buffer.from(opts.input));
      }
    });
  });
}
