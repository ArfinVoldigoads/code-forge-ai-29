import { db } from "@/lib/db.server";

export type IntegrationKind = "github" | "vercel" | "cloudflare";

export type IntegrationValue = {
  token: string | null;
  /** Vercel team/scope id, Cloudflare account id. */
  extra: string | null;
  account: string | null;
  status: "untested" | "connected" | "error";
  statusMessage: string | null;
  lastTestedAt: string | null;
};

const EMPTY: IntegrationValue = {
  token: null,
  extra: null,
  account: null,
  status: "untested",
  statusMessage: null,
  lastTestedAt: null,
};

export async function readIntegration(kind: IntegrationKind): Promise<IntegrationValue> {
  const { data } = await db.from("app_settings").select("value").eq("key", kind).maybeSingle();
  const value = (data?.value ?? {}) as Partial<IntegrationValue>;
  return { ...EMPTY, ...value };
}

export async function writeIntegration(
  kind: IntegrationKind,
  value: IntegrationValue,
): Promise<void> {
  const { error } = await db
    .from("app_settings")
    .upsert({ key: kind, value: value as never } as never, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export type TestResult = { ok: boolean; message: string; account: string | null };

export async function testIntegrationCredentials(
  kind: IntegrationKind,
  value: IntegrationValue,
): Promise<TestResult> {
  if (!value.token) return { ok: false, message: "No token saved yet.", account: null };
  try {
    if (kind === "github") {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          authorization: `Bearer ${value.token}`,
          accept: "application/vnd.github+json",
          "user-agent": "agentkit",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, message: `GitHub HTTP ${res.status}`, account: null };
      const json = (await res.json()) as { login?: string };
      return {
        ok: true,
        message: `Connected as ${json.login ?? "unknown"}`,
        account: json.login ?? null,
      };
    }

    if (kind === "vercel") {
      const url = new URL("https://api.vercel.com/v2/user");
      if (value.extra) url.searchParams.set("teamId", value.extra);
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${value.token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, message: `Vercel HTTP ${res.status}`, account: null };
      const json = (await res.json()) as { user?: { username?: string; email?: string } };
      const who = json.user?.username ?? json.user?.email ?? "unknown";
      return { ok: true, message: `Connected as ${who}`, account: who };
    }

    const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { authorization: `Bearer ${value.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { message?: string }[];
    };
    if (!res.ok || !json.success) {
      return {
        ok: false,
        message: json.errors?.[0]?.message ?? `Cloudflare HTTP ${res.status}`,
        account: null,
      };
    }
    if (!value.extra) {
      return { ok: false, message: "Token is valid but Account ID is missing.", account: null };
    }
    const authHeaders = { authorization: `Bearer ${value.token}` };
    // Some Workers tokens lack "Account Settings · Read", so GET /accounts/{id}
    // 403s even though the account is fine. Fall back to a Workers-scoped probe.
    const acc = await fetch(`https://api.cloudflare.com/client/v4/accounts/${value.extra}`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(20_000),
    });
    const accJson = (await acc.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { name?: string };
    };
    if (acc.ok && accJson.success) {
      const name = accJson.result?.name ?? value.extra;
      return { ok: true, message: `Connected to ${name}`, account: name };
    }

    const scripts = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${value.extra}/workers/scripts`,
      { headers: authHeaders, signal: AbortSignal.timeout(20_000) },
    );
    const scriptsJson = (await scripts.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { message?: string }[];
    };
    if (scripts.ok && scriptsJson.success) {
      return {
        ok: true,
        message: `Connected to account ${value.extra} (Workers access verified).`,
        account: value.extra,
      };
    }

    // Last resort: some tokens can only list memberships/accounts.
    const list = await fetch("https://api.cloudflare.com/client/v4/accounts", {
      headers: authHeaders,
      signal: AbortSignal.timeout(20_000),
    });
    const listJson = (await list.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { id?: string; name?: string }[];
    };
    if (list.ok && listJson.success) {
      const match = (listJson.result ?? []).find((a) => a.id === value.extra);
      if (match) {
        const name = match.name ?? value.extra;
        return { ok: true, message: `Connected to ${name}`, account: name };
      }
      const ids = (listJson.result ?? []).map((a) => a.id).filter(Boolean);
      if (ids.length) {
        return {
          ok: false,
          message: `This token belongs to a different account. Accounts it can access: ${ids.join(", ")}. Use one of those as the Account ID.`,
          account: null,
        };
      }
    }

    return {
      ok: false,
      message:
        scriptsJson.errors?.[0]?.message ??
        `Token valid, but the Account ID was rejected (accounts HTTP ${acc.status}, workers HTTP ${scripts.status}).`,
      account: null,
    };


  } catch (e) {
    return {
      ok: false,
      message: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      account: null,
    };
  }
}

/** Env vars injected into sandbox commands for whichever integrations are connected. */
export async function integrationEnv(): Promise<Record<string, string>> {
  const [gh, vc, cf] = await Promise.all([
    readIntegration("github"),
    readIntegration("vercel"),
    readIntegration("cloudflare"),
  ]);
  const env: Record<string, string> = {};
  if (gh.token) {
    env["GITHUB_TOKEN"] = gh.token;
    env["GH_TOKEN"] = gh.token;
  }
  if (vc.token) {
    env["VERCEL_TOKEN"] = vc.token;
    if (vc.extra) env["VERCEL_ORG_ID"] = vc.extra;
  }
  if (cf.token) {
    env["CLOUDFLARE_API_TOKEN"] = cf.token;
    if (cf.extra) env["CLOUDFLARE_ACCOUNT_ID"] = cf.extra;
  }
  return env;
}

export function notConnected(kind: IntegrationKind): Error {
  const label = kind === "github" ? "GitHub" : kind === "vercel" ? "Vercel" : "Cloudflare";
  return new Error(
    `${label} is not connected. Ask the user to open Settings → Integrations and add their ${label} token.`,
  );
}

export async function requireIntegration(kind: IntegrationKind): Promise<IntegrationValue> {
  const value = await readIntegration(kind);
  if (!value.token) throw notConnected(kind);
  if (kind === "cloudflare" && !value.extra) {
    throw new Error("Cloudflare Account ID is missing. Add it in Settings → Integrations.");
  }
  return value;
}
