import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SearchSettingsDTO = {
  provider: "tavily" | "brave" | "serper";
  hasKey: boolean;
  keyMask: string | null;
};

export const getSearchSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SearchSettingsDTO> => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { maskKey } = await import("./db.server");
    const { getSearchSettings: read } = await import("./search.server");
    const settings = await read();
    return {
      provider: settings.provider,
      hasKey: Boolean(settings.apiKey),
      keyMask: maskKey(settings.apiKey),
    };
  },
);

export const saveSearchSettings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        provider: z.enum(["tavily", "brave", "serper"]),
        apiKey: z.string().trim().max(400).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { getSearchSettings: read } = await import("./search.server");
    const current = await read();
    const apiKey = data.apiKey ? data.apiKey : current.apiKey;
    const { error } = await db.from("app_settings").upsert(
      { key: "search", value: { provider: data.provider, apiKey } as never } as never,
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    await audit("search.save", "app_settings", "search", { provider: data.provider });
    return { ok: true as const };
  });

export const deleteSearchKey = createServerFn({ method: "POST" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db, audit } = await import("./db.server");
  const { getSearchSettings: read } = await import("./search.server");
  const current = await read();
  const { error } = await db.from("app_settings").upsert(
    { key: "search", value: { provider: current.provider, apiKey: null } as never } as never,
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  await audit("search.delete", "app_settings", "search", {});
  return { ok: true as const };
});
