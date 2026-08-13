import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const db = supabaseAdmin;

export async function audit(
  action: string,
  entity?: string,
  entityId?: string,
  detail: Record<string, unknown> = {},
) {
  try {
    await db.from("audit_logs").insert({
      action,
      entity: entity ?? null,
      entity_id: entityId ?? null,
      detail: detail as never,
    });
  } catch {
    // auditing must never break the request
  }
}

/** Never let a secret reach the client. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
