import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ModelDTO, ProviderDTO, ProviderType, SkillDTO } from "./types";

const idSchema = z.object({ id: z.string().uuid() });

const providerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(["lovable", "openai", "anthropic", "google", "openai-compatible"]),
  apiKey: z.string().trim().max(400).optional().nullable(),
  baseUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal("")),
  orgId: z.string().trim().max(120).optional().nullable(),
  enabled: z.boolean().default(true),
});

const modelInput = z.object({
  id: z.string().uuid().optional(),
  providerId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional().nullable(),
  contextWindow: z.number().int().positive().max(10_000_000).optional().nullable(),
  vision: z.boolean().default(false),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

/* ------------------------------- providers ------------------------------- */

export const listProviders = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db, maskKey } = await import("./db.server");
  const { ensureDefaults } = await import("./bootstrap.server");
  await ensureDefaults();

  const { data, error } = await db
    .from("providers")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map<ProviderDTO>((p) => ({
    id: p.id,
    name: p.name,
    type: p.type as ProviderType,
    keyMask: maskKey(p.api_key),
    hasKey: Boolean(p.api_key) || p.type === "lovable",
    baseUrl: p.base_url,
    orgId: p.org_id,
    enabled: p.enabled,
    status: p.status,
    statusMessage: p.status_message,
    lastTestedAt: p.last_tested_at,
  }));
});

export const saveProvider = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => providerInput.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");

    const patch: Record<string, unknown> = {
      name: data.name,
      type: data.type,
      base_url: data.baseUrl ? data.baseUrl : null,
      org_id: data.orgId || null,
      enabled: data.enabled,
    };
    if (data.apiKey) patch["api_key"] = data.apiKey;

    if (data.id) {
      const { error } = await db.from("providers").update(patch as never).eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit("provider.update", "providers", data.id, { name: data.name });
      return { id: data.id };
    }
    const { data: row, error } = await db
      .from("providers")
      .insert(patch as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit("provider.create", "providers", row.id, { name: data.name });
    return { id: row.id };
  });

export const deleteProvider = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { error } = await db.from("providers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit("provider.delete", "providers", data.id);
    return { ok: true };
  });

export const testProvider = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { probeProvider } = await import("./ai.server");

    const { data: row, error } = await db
      .from("providers")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Provider not found");

    const result = await probeProvider(row);
    await db
      .from("providers")
      .update({
        status: result.ok ? "connected" : "error",
        status_message: result.message.slice(0, 500),
        last_tested_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    await audit("provider.test", "providers", data.id, { ok: result.ok });
    return result;
  });

/* --------------------------------- models -------------------------------- */

export const listModels = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db } = await import("./db.server");
  const { ensureDefaults } = await import("./bootstrap.server");
  await ensureDefaults();

  const { data, error } = await db
    .from("models")
    .select("*, providers(name, type)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map<ModelDTO>((m) => {
    const provider = m.providers as { name: string; type: string } | null;
    return {
      id: m.id,
      providerId: m.provider_id,
      providerName: provider?.name ?? null,
      providerType: (provider?.type as ProviderType) ?? null,
      displayName: m.display_name,
      modelId: m.model_id,
      description: m.description,
      contextWindow: m.context_window,
      vision: m.vision,
      enabled: m.enabled,
      isDefault: m.is_default,
      sortOrder: m.sort_order,
      status: m.status,
      statusMessage: m.status_message,
      lastTestedAt: m.last_tested_at,
    };
  });
});

export const saveModel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => modelInput.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");

    if (data.isDefault) {
      await db.from("models").update({ is_default: false }).eq("is_default", true);
    }
    const patch = {
      provider_id: data.providerId,
      display_name: data.displayName,
      model_id: data.modelId,
      description: data.description || null,
      context_window: data.contextWindow ?? null,
      vision: data.vision,
      enabled: data.enabled,
      is_default: data.isDefault,
      sort_order: data.sortOrder,
    };
    if (data.id) {
      const { error } = await db.from("models").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit("model.update", "models", data.id);
      return { id: data.id };
    }
    const { data: row, error } = await db
      .from("models")
      .insert(patch as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit("model.create", "models", row.id);
    return { id: row.id };
  });

export const deleteModel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { error } = await db.from("models").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit("model.delete", "models", data.id);
    return { ok: true };
  });

export const testModel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { buildModel } = await import("./ai.server");
    const { generateText } = await import("ai");

    const { data: row, error } = await db
      .from("models")
      .select("*, providers(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.providers) throw new Error("Model or provider not found");

    let result: { ok: boolean; message: string };
    try {
      const out = await generateText({
        model: buildModel(row.providers as never, row.model_id),
        prompt: "Reply with the single word: ready",
        abortSignal: AbortSignal.timeout(30000),
      });
      result = { ok: true, message: `Responded: ${out.text.trim().slice(0, 80) || "(empty)"}` };
    } catch (e) {
      result = { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 400) };
    }

    await db
      .from("models")
      .update({
        status: result.ok ? "connected" : "error",
        status_message: result.message,
        last_tested_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    await audit("model.test", "models", data.id, { ok: result.ok });
    return result;
  });

/* --------------------------------- skills -------------------------------- */

export const listSkills = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db } = await import("./db.server");
  const { data, error } = await db
    .from("agent_skills")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map<SkillDTO>((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    instructions: s.instructions,
    enabled: s.enabled,
    sortOrder: s.sort_order,
  }));
});

export const updateSkill = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        enabled: z.boolean().optional(),
        instructions: z.string().trim().min(1).max(8000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const patch: Record<string, unknown> = {};
    if (data.enabled !== undefined) patch["enabled"] = data.enabled;
    if (data.instructions !== undefined) patch["instructions"] = data.instructions;
    const { error } = await db.from("agent_skills").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit("skill.update", "agent_skills", data.id, patch);
    return { ok: true };
  });

/* ----------------------------------- e2b ---------------------------------- */

export const getE2BSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db, maskKey } = await import("./db.server");
  const { data } = await db.from("app_settings").select("value").eq("key", "e2b").maybeSingle();
  const value = (data?.value ?? {}) as {
    apiKey?: string | null;
    status?: string;
    statusMessage?: string | null;
    lastTestedAt?: string | null;
  };
  return {
    keyMask: maskKey(value.apiKey),
    hasKey: Boolean(value.apiKey),
    status: value.status ?? "untested",
    statusMessage: value.statusMessage ?? null,
    lastTestedAt: value.lastTestedAt ?? null,
  };
});

export const saveE2BKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ apiKey: z.string().trim().min(8).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    await db.from("app_settings").upsert({
      key: "e2b",
      value: {
        apiKey: data.apiKey,
        status: "untested",
        statusMessage: null,
        lastTestedAt: null,
      } as never,
    });
    await audit("e2b.key_saved");
    return { ok: true };
  });

export const deleteE2BKey = createServerFn({ method: "POST" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db, audit } = await import("./db.server");
  await db.from("app_settings").upsert({
    key: "e2b",
    value: { apiKey: null, status: "untested", statusMessage: null, lastTestedAt: null } as never,
  });
  await audit("e2b.key_deleted");
  return { ok: true };
});

export const testE2B = createServerFn({ method: "POST" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db, audit } = await import("./db.server");
  const { data } = await db.from("app_settings").select("value").eq("key", "e2b").maybeSingle();
  const value = (data?.value ?? {}) as { apiKey?: string | null };

  let result: { ok: boolean; message: string };
  if (!value.apiKey) {
    result = { ok: false, message: "No E2B API key saved yet." };
  } else {
    try {
      const res = await fetch("https://api.e2b.dev/templates", {
        headers: { "X-API-KEY": value.apiKey },
        signal: AbortSignal.timeout(15000),
      });
      result = res.ok
        ? { ok: true, message: "Connected to E2B" }
        : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      result = { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
  }

  await db.from("app_settings").upsert({
    key: "e2b",
    value: {
      apiKey: value.apiKey ?? null,
      status: result.ok ? "connected" : "error",
      statusMessage: result.message,
      lastTestedAt: new Date().toISOString(),
    } as never,
  });
  await audit("e2b.test", undefined, undefined, { ok: result.ok });
  return result;
});
