# VPS mode: agent runs directly on your server

Add a **VPS** option in Settings so the agent executes commands, writes files, and deploys straight
on your own server over SSH — no Daytona sandbox involved.

## What you get

- Settings → Sandbox becomes **Runtime**, with two engines you can switch between:
  - **Daytona sandbox** (current behaviour)
  - **VPS (SSH)** — your own server
- VPS fields: **IP / host**, **port** (default 22), **username**, **password** (SSH key optional),
  and **work directory** (default `/root/agentkit` or `/home/<user>/agentkit`).
- **Test connection** button: connects, runs `uname -a`, reports OS, RAM, disk, and whether
  `git`, `node`, `bun`, `docker` are installed.
- Once VPS mode is on, every chat uses the VPS: shell console, file explorer, dev server,
  screenshots, deploys. Each chat gets its own folder `<workdir>/<chatId>` so projects don't collide.
- Preview: instead of a Daytona HTTPS link, the agent reports `http://<vps-ip>:<port>` for the dev
  server it starts, and can open a firewall port when needed.

## Important limitation to decide on

The app's backend runs on a serverless edge runtime that has no guaranteed raw-SSH support. Two ways
to talk to the VPS:

1. **Direct SSH** (`ssh2` library) — nothing to install on your VPS, just IP + user + password.
   Risk: the edge runtime may reject the SSH crypto/TCP stack in production. I'd implement it and
   verify against a real SSH server; if it fails in production we fall back to option 2.
2. **VPS agent** — on first connection you paste one command on the VPS
   (`curl -fsSL <app-url>/api/public/vps-agent.sh | bash`) which installs a tiny HTTPS exec service
   secured by a generated token. 100% reliable on edge, but requires that one-time paste.

Plan: build option 1 first (matches "just IP/user/password"), keep the interface pluggable so
option 2 can be added as an automatic fallback without redoing the agent tools.

## Technical outline

- `src/lib/runtime.server.ts` — engine selector reading `app_settings.key = 'runtime'`
  (`{ engine: 'daytona' | 'vps', vps: { host, port, user, password, workdir, status, ... } }`).
- `src/lib/vps.server.ts` — SSH exec layer exposing the same surface as `SandboxHandle`:
  `runShell`, `runBackground` (via `nohup`/`setsid`), `files.read/readBytes/write/list`,
  `previewUrl(port)`, `refreshLease()` (no-op), plus `sandbox_info` returning real server specs.
  Connections are pooled per chat and reconnect on drop.
- `src/lib/sandbox-ops.server.ts` + `sandbox.functions.ts` + `agent-tools.server.ts` switch on the
  engine instead of importing Daytona directly; tool names and signatures stay unchanged.
- VPS-only tools: `sandbox_resize` becomes a no-op that reports real RAM/disk; `desktop_start`
  disabled with a clear message.
- Settings page `settings.sandbox.tsx` gains the engine toggle + VPS form; password stored
  server-side, only ever returned masked.
- Credentials never leave the server and are stripped from logs, audit entries, and tool output.
