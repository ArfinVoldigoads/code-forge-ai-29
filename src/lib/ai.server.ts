import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderType } from "./types";

export const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

export type ProviderRow = {
  id: string;
  name: string;
  type: string;
  api_key: string | null;
  base_url: string | null;
  org_id: string | null;
};

export function resolveKey(provider: Pick<ProviderRow, "type" | "api_key">): string {
  if (provider.type === "lovable") {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Lovable AI Gateway key is not configured on this project.");
    return key;
  }
  if (!provider.api_key) throw new Error("This provider has no API key configured.");
  return provider.api_key;
}

export function baseUrlFor(provider: Pick<ProviderRow, "type" | "base_url">): string {
  if (provider.base_url) return provider.base_url.replace(/\/$/, "");
  switch (provider.type as ProviderType) {
    case "lovable":
      return LOVABLE_GATEWAY_URL;
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com";
    case "google":
      return "https://generativelanguage.googleapis.com";
    default:
      throw new Error("An OpenAI-compatible provider requires a base URL.");
  }
}

export function buildModel(provider: ProviderRow, modelId: string): LanguageModel {
  const apiKey = resolveKey(provider);
  const baseURL = baseUrlFor(provider);

  switch (provider.type as ProviderType) {
    case "openai":
      return createOpenAI({
        apiKey,
        baseURL,
        ...(provider.org_id ? { organization: provider.org_id } : {}),
      })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: `${baseURL}/v1` })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL: `${baseURL}/v1beta` })(modelId);
    case "lovable":
    case "openai-compatible":
    default:
      return createOpenAICompatible({ name: provider.name, apiKey, baseURL })(modelId);
  }
}

/** Real connectivity probe against the provider's own API. */
export async function probeProvider(
  provider: ProviderRow,
  timeoutMs = 15000,
): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = resolveKey(provider);
    const baseURL = baseUrlFor(provider);
    let url = `${baseURL}/models`;
    let headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };

    if (provider.type === "anthropic") {
      url = `${baseURL}/v1/models`;
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    } else if (provider.type === "google") {
      url = `${baseURL}/v1beta/models`;
      headers = { "x-goog-api-key": apiKey };
    }

    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, message: "Connection successful" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message: message.includes("abort") ? "Connection timed out" : message };
  } finally {
    clearTimeout(timer);
  }
}
