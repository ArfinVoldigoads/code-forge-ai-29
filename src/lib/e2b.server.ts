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

export { WORKDIR };
