import { createHash, timingSafeEqual } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";

export type GateSession = { unlocked?: boolean; since?: number };

function sessionConfig() {
  return {
    password: process.env["SESSION_SECRET"]!,
    name: "agentkit-session",
    maxAge: 60 * 60 * 24 * 7,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
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
