import { db } from "@/lib/db.server";
import { sshExec, type ExecResult, type VpsConfig } from "@/lib/ssh.server";

export type { VpsConfig };

/** Same path the sandbox engine uses, so every path helper keeps working. */
const WORKDIR = "/home/daytona/project";
const SESSION_DIR = "/tmp/agentkit-sessions";

const q = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

const DEFAULT_VPS: VpsConfig = {
  enabled: false,
  host: null,
  port: 22,
  username: "root",
  password: null,
  privateKey: null,
  status: "untested",
  statusMessage: null,
  lastTestedAt: null,
};

export async function getVpsConfig(): Promise<VpsConfig> {
  const { data } = await db.from("app_settings").select("value").eq("key", "vps").maybeSingle();
  const value = (data?.value ?? {}) as Partial<VpsConfig>;
  return {
    ...DEFAULT_VPS,
    ...value,
    port: Number(value.port) || 22,
    username: value.username || "root",
  };
}

export async function saveVpsConfig(next: VpsConfig): Promise<void> {
  await db.from("app_settings").upsert({ key: "vps", value: next as never });
}

/** True when the agent should run everything on the user's own server. */
export async function isVpsMode(): Promise<boolean> {
  const cfg = await getVpsConfig();
  return Boolean(cfg.enabled && cfg.host && (cfg.password || cfg.privateKey));
}

const envPrelude = (envs?: Record<string, string>) =>
  envs
    ? `${Object.entries(envs)
        .map(([k, v]) => `export ${k}=${q(v)}`)
        .join("\n")}\n`
    : "";

async function exec(
  cfg: VpsConfig,
  command: string,
  opts: { timeoutMs?: number; input?: string | Uint8Array; onStdout?: (t: string) => void } = {},
): Promise<ExecResult> {
  return sshExec(cfg, command, opts);
}

/** Make sure the shared project directory exists and belongs to the SSH user. */
async function provision(cfg: VpsConfig): Promise<void> {
  await exec(
    cfg,
    `mkdir -p ${WORKDIR} ${SESSION_DIR} 2>/dev/null || (sudo -n mkdir -p ${WORKDIR} ${SESSION_DIR} && sudo -n chown -R "$(id -u):$(id -g)" /home/daytona ${SESSION_DIR})`,
    { timeoutMs: 30_000 },
  );
}

/* ------------------------- Daytona-shaped adapter ------------------------- */

type SessionCmd = { logPath: string; codePath: string };

function buildRaw(cfg: VpsConfig) {
  const sessions = new Map<string, Map<string, SessionCmd>>();
  const specs: { cpu?: number; memory?: number; disk?: number } = {};

  const raw = {
    id: `vps-${cfg.host}`,
    state: "started" as string,
    get cpu() {
      return specs.cpu;
    },
    get memory() {
      return specs.memory;
    },
    get disk() {
      return specs.disk;
    },

    process: {
      executeCommand: async (
        command: string,
        _cwd?: string,
        envs?: Record<string, string>,
        timeoutSeconds?: number,
      ) => {
        const res = await exec(cfg, `${envPrelude(envs)}${command}`, {
          timeoutMs: (timeoutSeconds ?? 180) * 1000,
        });
        return {
          exitCode: res.exitCode,
          result: [res.stdout, res.stderr].filter(Boolean).join(""),
        };
      },
      createSession: async (sessionId: string) => {
        sessions.set(sessionId, new Map());
        await exec(cfg, `mkdir -p ${SESSION_DIR}/${sessionId}`, { timeoutMs: 20_000 });
      },
      executeSessionCommand: async (
        sessionId: string,
        opts: { command: string; runAsync?: boolean },
      ) => {
        const cmdId = crypto.randomUUID().slice(0, 8);
        const dir = `${SESSION_DIR}/${sessionId}`;
        const logPath = `${dir}/${cmdId}.log`;
        const codePath = `${dir}/${cmdId}.code`;
        const pidPath = `${dir}/${cmdId}.pid`;
        const scriptPath = `${dir}/${cmdId}.sh`;
        const wrapper = `${opts.command}\necho $? > ${codePath}\n`;
        await exec(
          cfg,
          `mkdir -p ${dir} && cat > ${scriptPath} && chmod +x ${scriptPath} && : > ${logPath} && setsid nohup bash ${scriptPath} >> ${logPath} 2>&1 < /dev/null & echo $! > ${pidPath}`,
          { input: wrapper, timeoutMs: 30_000 },
        );
        sessions.get(sessionId)?.set(cmdId, { logPath, codePath });
        return { cmdId };
      },
      getSessionCommandLogs: async (sessionId: string, cmdId: string) => {
        const res = await exec(cfg, `cat ${SESSION_DIR}/${sessionId}/${cmdId}.log 2>/dev/null`, {
          timeoutMs: 30_000,
        });
        return { output: res.stdout };
      },
      getSessionCommand: async (sessionId: string, cmdId: string) => {
        const res = await exec(cfg, `cat ${SESSION_DIR}/${sessionId}/${cmdId}.code 2>/dev/null`, {
          timeoutMs: 20_000,
        });
        const code = Number.parseInt(res.stdout.trim(), 10);
        return Number.isFinite(code) ? { exitCode: code } : {};
      },
      deleteSession: async (sessionId: string) => {
        sessions.delete(sessionId);
        await exec(cfg, `rm -rf ${SESSION_DIR}/${sessionId}`, { timeoutMs: 20_000 });
      },
    },

    fs: {
      downloadFile: async (path: string) => {
        const res = await exec(cfg, `base64 -w0 ${q(path)}`, { timeoutMs: 60_000 });
        if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `Cannot read ${path}`);
        return Buffer.from(res.stdout.trim(), "base64");
      },
      uploadFile: async (content: Buffer | Uint8Array, path: string) => {
        const dir = path.slice(0, path.lastIndexOf("/")) || "/";
        const b64 = Buffer.from(content).toString("base64");
        const res = await exec(cfg, `mkdir -p ${q(dir)} && base64 -d > ${q(path)}`, {
          input: b64,
          timeoutMs: 120_000,
        });
        if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `Cannot write ${path}`);
      },
      createFolder: async (path: string, _mode?: string) => {
        await exec(cfg, `mkdir -p ${q(path)}`, { timeoutMs: 30_000 });
      },
      listFiles: async (path: string) => {
        const res = await exec(cfg, `ls -A1p ${q(path)} 2>/dev/null`, { timeoutMs: 30_000 });
        if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `Cannot list ${path}`);
        return res.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((name) => ({
            name: name.replace(/\/$/, ""),
            isDir: name.endsWith("/"),
          }));
      },
    },

    computerUse: {
      start: async () => {
        throw new Error("The VNC desktop is only available on sandboxes, not on a VPS.");
      },
    },

    getPreviewLink: async (port: number) => ({ url: `http://${cfg.host}:${port}` }),
    refreshActivity: async () => {},
    setAutostopInterval: async () => {},

    /** Resizing is meaningless on a VPS: report what the machine actually has. */
    resize: async () => {
      await raw.refreshData();
    },
    waitForResizeComplete: async () => {},
    refreshData: async () => {
      const res = await exec(
        cfg,
        `nproc; free -g | awk '/Mem:/{print $2}'; df -BG --output=size ${WORKDIR} | tail -1 | tr -dc '0-9'`,
        { timeoutMs: 30_000 },
      );
      const [cpu, mem, disk] = res.stdout.split("\n").map((v) => Number.parseInt(v.trim(), 10));
      if (Number.isFinite(cpu)) specs.cpu = cpu;
      if (Number.isFinite(mem)) specs.memory = mem;
      if (Number.isFinite(disk)) specs.disk = disk;
    },
    /** "Restart" = clear the background processes agentkit started. */
    stop: async () => {
      await exec(
        cfg,
        `for p in ${SESSION_DIR}/*/*.pid; do [ -f "$p" ] && kill -TERM -"$(cat "$p")" 2>/dev/null; done; true`,
        { timeoutMs: 30_000 },
      );
    },
    start: async () => {
      await provision(cfg);
    },
    waitUntilStarted: async () => {},
    delete: async () => {},
  };

  return raw;
}

export type VpsRaw = ReturnType<typeof buildRaw>;

export async function createVpsHandleRaw(): Promise<VpsRaw> {
  const cfg = await getVpsConfig();
  if (!cfg.host) throw new Error("No VPS configured. Add it in Settings → Runtime.");
  const raw = buildRaw(cfg);
  await provision(cfg);
  return raw;
}

/** Connect, sanity-check the shell and report what the machine looks like. */
export async function testVpsConnection(
  cfg: VpsConfig,
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.host) return { ok: false, message: "Host / IP is empty." };
  if (!cfg.password && !cfg.privateKey) return { ok: false, message: "No password set." };
  try {
    const res = await sshExec(
      cfg,
      `uname -sr; nproc; free -m | awk '/Mem:/{print $2}'; df -h / | tail -1 | awk '{print $4}'; for b in git node bun docker python3; do command -v $b >/dev/null && printf '%s ' "$b"; done`,
      { timeoutMs: 40_000 },
    );
    if (res.exitCode !== 0) {
      return { ok: false, message: (res.stderr || res.stdout).trim().slice(0, 300) || "Command failed" };
    }
    const [os, cpu, memMb, freeDisk, tools] = res.stdout.split("\n");
    const ramGb = Math.round(Number.parseInt((memMb ?? "0").trim(), 10) / 1024);
    return {
      ok: true,
      message: `${(os ?? "").trim()} · ${(cpu ?? "?").trim()} vCPU · ${ramGb} GiB RAM · ${(freeDisk ?? "?").trim()} free · tools: ${(tools ?? "").trim() || "none"}`,
    };
  } catch (error) {
    return { ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}
