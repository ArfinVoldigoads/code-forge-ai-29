import { fetchUrlText, webSearch, type SearchHit } from "@/lib/search.server";

export type ResearchSource = {
  index: number;
  title: string;
  url: string;
  snippet: string;
  excerpt: string | null;
  error?: string;
};

export type ResearchResult = {
  question: string;
  queries: string[];
  sources: ResearchSource[];
  notes: string[];
};

/** Cheap query expansion — no model call, deterministic and fast. */
export function expandQueries(question: string, depth: number): string[] {
  const base = question.trim().replace(/\s+/g, " ");
  const variants = [
    base,
    `${base} documentation`,
    `${base} example`,
    `${base} error fix`,
    `${base} 2026`,
    `${base} best practice`,
  ];
  const wanted = Math.min(Math.max(depth, 2), 6);
  return Array.from(new Set(variants)).slice(0, wanted);
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * Multi-query research: expand the question, search in parallel, dedupe by host,
 * then read the most promising pages and return cited excerpts.
 */
export async function deepResearch(
  question: string,
  opts: { depth?: number; maxPages?: number; maxCharsPerPage?: number } = {},
): Promise<ResearchResult> {
  const depth = opts.depth ?? 4;
  const maxPages = Math.min(opts.maxPages ?? 6, 10);
  const perPage = opts.maxCharsPerPage ?? 4000;

  const queries = expandQueries(question, depth);
  const notes: string[] = [];

  const searches = await Promise.all(
    queries.map(async (q) => {
      try {
        return await webSearch(q, 6);
      } catch (e) {
        notes.push(`search failed for "${q}": ${e instanceof Error ? e.message : String(e)}`);
        return [] as SearchHit[];
      }
    }),
  );

  // Rank: hits appearing across several queries first, at most 2 per host.
  const seen = new Map<string, { hit: SearchHit; score: number }>();
  searches.forEach((hits, qi) => {
    hits.forEach((hit, hi) => {
      if (!hit.url?.startsWith("http")) return;
      const existing = seen.get(hit.url);
      const score = (existing?.score ?? 0) + (10 - hi) + (qi === 0 ? 3 : 0);
      seen.set(hit.url, { hit, score });
    });
  });

  const perHost = new Map<string, number>();
  const ranked = [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .filter(({ hit }) => {
      const host = hostOf(hit.url);
      const count = perHost.get(host) ?? 0;
      if (count >= 2) return false;
      perHost.set(host, count + 1);
      return true;
    })
    .slice(0, maxPages);

  if (!ranked.length) {
    return { question, queries, sources: [], notes: [...notes, "No search results at all."] };
  }

  const sources = await Promise.all(
    ranked.map(async ({ hit }, i): Promise<ResearchSource> => {
      const base = { index: i + 1, title: hit.title, url: hit.url, snippet: hit.snippet };
      try {
        const text = await fetchUrlText(hit.url, perPage);
        return { ...base, excerpt: text };
      } catch (e) {
        return {
          ...base,
          excerpt: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  return { question, queries, sources, notes };
}
