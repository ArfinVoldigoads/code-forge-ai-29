import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const passwordSchema = z.object({
  password: z.string().min(1).max(200),
});

export const unlockWorkspace = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    const { passwordMatches, getGateSession } = await import("./gate.server");
    const { audit } = await import("./db.server");
    const expected = process.env["SITE_PASSWORD"];
    if (!expected) throw new Error("Workspace password is not configured");

    if (!passwordMatches(data.password, expected)) {
      await audit("gate.unlock_failed");
      return { ok: false as const };
    }
    const session = await getGateSession();
    await session.update({ unlocked: true, since: Date.now() });
    await audit("gate.unlock");
    return { ok: true as const };
  });

export const lockWorkspace = createServerFn({ method: "POST" }).handler(async () => {
  const { getGateSession } = await import("./gate.server");
  const session = await getGateSession();
  await session.clear();
  return { ok: true as const };
});

export const getGateStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isUnlocked } = await import("./gate.server");
  return { unlocked: await isUnlocked() };
});
