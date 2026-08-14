import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type IntegrationDTO = {
  kind: "github" | "vercel" | "cloudflare";
  hasToken: boolean;
  tokenMask: string | null;
  extra: string | null;
  account: string | null;
  status: string;
  statusMessage: string | null;
  lastTestedAt: string | null;
};

const kindSchema = z.enum(["github", "vercel", "cloudflare"]);

export const listIntegrations = createServerFn({ method: "GET" }).handler(
  async (): Promise<IntegrationDTO[]> => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { maskKey } = await import("./db.server");
    const { readIntegration } = await import("./integrations.server");
    const kinds = ["github", "vercel", "cloudflare"] as const;
    return Promise.all(
      kinds.map(async (kind) => {
        const v = await readIntegration(kind);
        return {
          kind,
          hasToken: Boolean(v.token),
          tokenMask: maskKey(v.token),
          extra: v.extra,
          account: v.account,
          status: v.status,
          statusMessage: v.statusMessage,
          lastTestedAt: v.lastTestedAt,
        };
      }),
    );
  },
);

export const saveIntegration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: kindSchema,
        token: z.string().trim().max(600).optional().nullable(),
        extra: z.string().trim().max(200).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { audit } = await import("./db.server");
    const { readIntegration, writeIntegration } = await import("./integrations.server");
    const current = await readIntegration(data.kind);
    await writeIntegration(data.kind, {
      ...current,
      token: data.token ? data.token : current.token,
      extra: data.extra !== undefined && data.extra !== null ? data.extra || null : current.extra,
      status: "untested",
      statusMessage: null,
    });
    await audit("integration.save", "app_settings", data.kind);
    return { ok: true as const };
  });

export const testIntegration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ kind: kindSchema }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { audit } = await import("./db.server");
    const { readIntegration, writeIntegration, testIntegrationCredentials } = await import(
      "./integrations.server"
    );
    const current = await readIntegration(data.kind);
    const result = await testIntegrationCredentials(data.kind, current);
    await writeIntegration(data.kind, {
      ...current,
      account: result.account ?? current.account,
      status: result.ok ? "connected" : "error",
      statusMessage: result.message.slice(0, 400),
      lastTestedAt: new Date().toISOString(),
    });
    await audit("integration.test", "app_settings", data.kind, { ok: result.ok });
    return { ok: result.ok, message: result.message };
  });

export const deleteIntegration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ kind: kindSchema }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { audit } = await import("./db.server");
    const { writeIntegration } = await import("./integrations.server");
    await writeIntegration(data.kind, {
      token: null,
      extra: null,
      account: null,
      status: "untested",
      statusMessage: null,
      lastTestedAt: null,
    });
    await audit("integration.delete", "app_settings", data.kind);
    return { ok: true as const };
  });
