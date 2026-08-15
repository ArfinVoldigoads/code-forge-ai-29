import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AskAnswer = { question: string; answer: string };

const schema = z.object({
  chatId: z.string().uuid(),
  askId: z.string().min(1).max(120),
  skipped: z.boolean().default(false),
  answers: z
    .array(z.object({ question: z.string().max(500), answer: z.string().max(2000) }))
    .max(20)
    .default([]),
});

/** Stores the user's answers to an in-chat agent question so the run can continue. */
export const submitAskAnswers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const { error } = await db.from("ask_user_answers").upsert(
      {
        chat_id: data.chatId,
        ask_id: data.askId,
        answers: data.answers as never,
        skipped: data.skipped,
      } as never,
      { onConflict: "chat_id,ask_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Answers already given in this chat, keyed by the question-card id. */
export const listAskAnswers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const { data: rows } = await db
      .from("ask_user_answers")
      .select("ask_id, answers, skipped")
      .eq("chat_id", data.chatId);
    const map: Record<string, { answers: AskAnswer[]; skipped: boolean }> = {};
    for (const r of rows ?? []) {
      map[r.ask_id as string] = {
        answers: (r.answers ?? []) as AskAnswer[],
        skipped: Boolean(r.skipped),
      };
    }
    return map;
  });
