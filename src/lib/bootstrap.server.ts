import { db } from "./db.server";

/**
 * Seeds the built-in Lovable AI Gateway provider and a starter model set the
 * first time settings are opened, so chat works before any external key exists.
 */
export async function ensureDefaults(): Promise<void> {
  const { count, error: countError } = await db
    .from("providers")
    .select("id", { count: "exact", head: true });
  if (countError) console.error("[bootstrap] count providers failed", countError);
  if ((count ?? 0) > 0) return;

  const { data: provider, error } = await db
    .from("providers")
    .insert({
      name: "Lovable AI Gateway",
      type: "lovable",
      base_url: "https://ai.gateway.lovable.dev/v1",
      enabled: true,
      status: "untested",
    } as never)
    .select("id")
    .single();
  if (error || !provider) return;

  await db.from("models").insert([
    {
      provider_id: provider.id,
      display_name: "Gemini 3.5 Flash",
      model_id: "google/gemini-3.5-flash",
      description: "Fast coding and agentic reasoning. Good default.",
      context_window: 1_000_000,
      vision: true,
      is_default: true,
      sort_order: 1,
    },
    {
      provider_id: provider.id,
      display_name: "Gemini 2.5 Pro",
      model_id: "google/gemini-2.5-pro",
      description: "Strongest Gemini for complex multi-step reasoning.",
      context_window: 1_000_000,
      vision: true,
      sort_order: 2,
    },
    {
      provider_id: provider.id,
      display_name: "GPT-5.4",
      model_id: "openai/gpt-5.4",
      description: "Advanced reasoning and code generation.",
      context_window: 400_000,
      vision: true,
      sort_order: 3,
    },
    {
      provider_id: provider.id,
      display_name: "GPT-5.4 Mini",
      model_id: "openai/gpt-5.4-mini",
      description: "Balanced cost and capability.",
      context_window: 400_000,
      vision: true,
      sort_order: 4,
    },
  ] as never);
}
