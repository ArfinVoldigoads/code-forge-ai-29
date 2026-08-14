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

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Keyless fallback so search always works, even without a provider API key. */
async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchHit[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|<\/body>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < maxResults) {
    let url = m[1];
    const redirect = /uddg=([^&]+)/.exec(url);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (!url.startsWith("http")) continue;
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(m[3]);
    hits.push({
      title: decode(m[2]),
      url,
      snippet: snippetMatch ? decode(snippetMatch[1]).slice(0, 600) : "",
    });
  }
  if (!hits.length) throw new Error("No results from the keyless search fallback.");
  return hits;
}

/** Web search through the configured provider. Never fabricates results. */
export async function webSearch(query: string, maxResults = 6): Promise<SearchHit[]> {
  const { provider, apiKey } = await getSearchSettings();
  if (!apiKey) return duckDuckGoSearch(query, maxResults);


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
