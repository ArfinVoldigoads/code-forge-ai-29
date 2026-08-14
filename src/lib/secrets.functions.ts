import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SecretDTO = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  mask: string | null;
  updatedAt: string;
};

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use an env-var style name, e.g. OPENAI_API_KEY");

export const listSecrets = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<SecretDTO[]> => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, maskKey } = await import("./db.server");
    const { data: rows } = await db
      .from("project_secrets")
      .select("id, name, description, status, value, updated_at")
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: true });
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      description: (r.description ?? null) as string | null,
      status: r.status as string,
      mask: maskKey((r as { value?: string | null }).value ?? null),
      updatedAt: r.updated_at as string,
    }));
  });

export const saveSecret = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chatId: z.string().uuid(),
        name: nameSchema,
        value: z.string().min(1).max(8000),
        description: z.string().trim().max(400).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { error } = await db.from("project_secrets").upsert(
      {
        chat_id: data.chatId,
        name: data.name,
        value: data.value,
        description: data.description || null,
        status: "set",
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "chat_id,name" },
    );
    if (error) throw new Error(error.message);
    await audit("secret.save", "project_secrets", data.chatId, { name: data.name });
    return { ok: true as const };
  });

export const deleteSecret = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ chatId: z.string().uuid(), name: nameSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { error } = await db
      .from("project_secrets")
      .delete()
      .eq("chat_id", data.chatId)
      .eq("name", data.name);
    if (error) throw new Error(error.message);
    await audit("secret.delete", "project_secrets", data.chatId, { name: data.name });
    return { ok: true as const };
  });
