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
  if (provider.base_url) {
    return provider.base_url
      .trim()
      .replace(/\/(?:chat\/completions|models)\/?$/i, "")
      .replace(/\/+$/, "");
  }
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

function providerError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      detail?: string;
      error?: { message?: string; type?: string; code?: string | number } | string;
      message?: string;
    };
    const nested = typeof parsed.error === "object" ? parsed.error : null;
    const message = nested?.message ?? parsed.message ?? parsed.detail ?? parsed.error;
    if (typeof message === "string" && message.trim()) {
      if (status === 401 || status === 403) {
        return `Authentication failed (${status}): ${message.trim()}`;
      }
      return `HTTP ${status}: ${message.trim()}`;
    }
  } catch {
    /* Use the response preview below when the provider does not return JSON. */
  }
  return `HTTP ${status}: ${body.trim() || "Empty response"}`;
}

/** Real connectivity probe against the provider's own OpenAI-compatible API. */
export async function probeProvider(
  provider: ProviderRow,
  probeModelId?: string | null,
  timeoutMs = 20000,
): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = resolveKey(provider);
    const baseURL = baseUrlFor(provider);
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (isLovableGateway(provider)) headers["Lovable-API-Key"] = apiKey;

    const chatProbe = async (modelId: string) => {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_completion_tokens: 8,
        }),
        signal: controller.signal,
      });
      const body = (await res.text()).slice(0, 500);
      return res.ok
        ? { ok: true, message: `Connected · ${modelId} responded` }
        : { ok: false, message: providerError(res.status, body) };
    };

    // The Lovable AI Gateway does not expose /models — probe with a real call.
    if (isLovableGateway(provider)) {
      return await chatProbe(probeModelId || "google/gemini-3.1-flash-lite");
    }

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
      last = providerError(res.status, (await res.text()).slice(0, 500));
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: last };
      }
    }
    if (probeModelId) {
      const chat = await chatProbe(probeModelId);
      if (chat.ok) return chat;
      return { ok: false, message: chat.message };
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
