import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

export type ProviderRow = {
  id: string;
  name: string;
  type?: string | null;
  api_key: string | null;
  base_url: string | null;
  org_id?: string | null;
};

function isLovableGateway(provider: Pick<ProviderRow, "type" | "base_url">): boolean {
  if (provider.type === "lovable") return true;
  return (provider.base_url ?? "").includes("ai.gateway.lovable.dev");
}

export function resolveKey(provider: Pick<ProviderRow, "type" | "api_key" | "base_url">): string {
  if (provider.api_key) return provider.api_key;
  if (isLovableGateway(provider)) {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Lovable AI Gateway key is not configured on this project.");
    return key;
  }
  throw new Error("This provider has no API key configured.");
}

export function baseUrlFor(provider: Pick<ProviderRow, "type" | "base_url">): string {
  if (provider.base_url) return provider.base_url.replace(/\/+$/, "");
  if (isLovableGateway(provider)) return LOVABLE_GATEWAY_URL;
  throw new Error("This provider needs a base URL, e.g. https://api.example.com/v1");
}

/** Every provider is treated as an OpenAI-compatible endpoint. */
export function buildModel(provider: ProviderRow, modelId: string): LanguageModel {
  const apiKey = resolveKey(provider);
  const baseURL = baseUrlFor(provider);
  return createOpenAICompatible({ name: provider.name || "provider", apiKey, baseURL })(modelId);
}

/** Candidate /models URLs — many gateways mount the API with or without /v1. */
function modelListUrls(baseURL: string): string[] {
  const urls = [`${baseURL}/models`];
  if (!/\/v\d+$/.test(baseURL)) urls.push(`${baseURL}/v1/models`);
  return urls;
}

/** Real connectivity probe against the provider's own OpenAI-compatible API. */
export async function probeProvider(
  provider: ProviderRow,
  timeoutMs = 15000,
): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = resolveKey(provider);
    const baseURL = baseUrlFor(provider);
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (isLovableGateway(provider)) headers["Lovable-API-Key"] = apiKey;

    let last = "";
    for (const url of modelListUrls(baseURL)) {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.ok) {
        const body = (await res.text()).slice(0, 4000);
        let count: number | null = null;
        try {
          const json = JSON.parse(body) as { data?: unknown[] };
          if (Array.isArray(json.data)) count = json.data.length;
        } catch {
          /* non-JSON body still means the endpoint answered */
        }
        return {
          ok: true,
          message: count === null ? "Connection successful" : `Connected · ${count} models listed`,
        };
      }
      last = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `${last} — check the API key.` };
      }
    }
    return {
      ok: false,
      message: `${last} — the base URL does not expose /models. Use the full OpenAI-compatible base URL (e.g. https://api.example.com/v1). Models can still be added and tested individually.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message: message.includes("abort") ? "Connection timed out" : message };
  } finally {
    clearTimeout(timer);
  }
}
