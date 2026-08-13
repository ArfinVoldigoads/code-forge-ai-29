import { createHash, timingSafeEqual } from "node:crypto";
import { useSession, getRequest } from "@tanstack/react-start/server";

export type GateSession = { unlocked?: boolean; since?: number };

function isSecureRequest(): boolean {
  try {
    const request = getRequest();
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto");
    if (proto) return proto.split(",")[0]!.trim() === "https";
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function sessionConfig() {
  // The preview runs inside a cross-site iframe, where SameSite=Lax cookies are
  // dropped. Use SameSite=None (requires Secure) whenever the request is HTTPS.
  const secure = isSecureRequest();
  return {
    password: process.env["SESSION_SECRET"]!,
    name: "agentkit-session",
    maxAge: 60 * 60 * 24 * 7,
    cookie: {
      httpOnly: true,
      secure,
      sameSite: (secure ? "none" : "lax") as "none" | "lax",
      path: "/",
    },
  };
}

export function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function getGateSession() {
  return useSession<GateSession>(sessionConfig());
}

export async function isUnlocked(): Promise<boolean> {
  const session = await getGateSession();
  return session.data.unlocked === true;
}

/** Throws a 401 Response when the caller has not passed the password gate. */
export async function requireUnlocked(): Promise<void> {
  if (!(await isUnlocked())) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
