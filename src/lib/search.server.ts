import { db } from "@/lib/db.server";

export type SearchSettings = {
  provider: "tavily" | "brave" | "serper";
  apiKey: string | null;
};

export type SearchHit = { title: string; url: string; snippet: string };

export async function getSearchSettings(): Promise<SearchSettings> {
  const { data } = await db.from("app_settings").select("value").eq("key", "search").maybeSingle();
  const value = (data?.value ?? {}) as { provider?: string; apiKey?: string | null };
  const provider = (["tavily", "brave", "serper"].includes(value.provider ?? "")
    ? value.provider
    : "tavily") as SearchSettings["provider"];
  return { provider, apiKey: value.apiKey ?? null };
}

/** Web search through the configured provider. Never fabricates results. */
export async function webSearch(query: string, maxResults = 6): Promise<SearchHit[]> {
  const { provider, apiKey } = await getSearchSettings();
  if (!apiKey) {
    throw new Error(
      "Web search is not configured. The user must add a search API key in Settings → Search.",
    );
  }

  if (provider === "tavily") {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "advanced",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return (json.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: (r.content ?? "").slice(0, 600),
    }));
  }

  if (provider === "brave") {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      web?: { results?: { title: string; url: string; description?: string }[] };
    };
    return (json.web?.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: (r.description ?? "").slice(0, 600),
    }));
  }

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    organic?: { title: string; link: string; snippet?: string }[];
  };
  return (json.organic ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: (r.snippet ?? "").slice(0, 600),
  }));
}

/** Fetch a page and reduce it to readable text. */
export async function fetchUrlText(url: string, maxChars = 8000): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; agentkit/1.0)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!type.includes("html")) return body.slice(0, maxChars);
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxChars);
}
