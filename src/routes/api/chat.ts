import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { StreamEvent } from "@/lib/types";

const bodySchema = z.object({
  chatId: z.string().uuid(),
  requestId: z.string().uuid(),
  cancel: z.boolean().optional(),
});

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireUnlocked } = await import("@/lib/gate.server");
        try {
          await requireUnlocked();
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }

        const parsed = bodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const { chatId, requestId, cancel } = parsed.data;

        const { db } = await import("@/lib/db.server");
        const { activeRuns, executeRun } = await import("@/lib/run-engine.server");

        if (cancel) {
          activeRuns.get(requestId)?.abort();
          await db
            .from("runs")
            .update({ status: "cancelled", updated_at: new Date().toISOString() } as never)
            .eq("request_id", requestId);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }

        const eventStreamHeaders = {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        };

        // Idempotency: a finished message is never regenerated.
        const { data: dupe } = await db
          .from("messages")
          .select("id, status")
          .eq("request_id", requestId)
          .maybeSingle();
        if (dupe && dupe.status !== "streaming") {
          return new Response(sse({ type: "assistant-finish", messageId: dupe.id }), {
            headers: eventStreamHeaders,
          });
        }

        // The run row is the durable owner of the work; this request is only one
        // possible executor of it. The cron worker takes over when we go away.
        const { data: existingRun } = await db
          .from("runs")
          .select("id, status, lease_until")
          .eq("request_id", requestId)
          .maybeSingle();

        if (existingRun && new Date(existingRun.lease_until).getTime() > Date.now()) {
          // Someone else already holds the lease — the UI keeps polling the message.
          return new Response(sse({ type: "assistant-finish", messageId: dupe?.id ?? requestId }), {
            headers: eventStreamHeaders,
          });
        }

        let runId = existingRun?.id ?? null;
        if (runId) {
          await db
            .from("runs")
            .update({
              status: "running",
              lease_until: new Date(Date.now() + 90_000).toISOString(),
              last_heartbeat: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", runId);
        } else {
          const { data: created } = await db
            .from("runs")
            .insert({
              chat_id: chatId,
              request_id: requestId,
              status: "running",
              lease_until: new Date(Date.now() + 90_000).toISOString(),
            } as never)
            .select("id")
            .single();
          runId = (created as { id: string } | null)?.id ?? null;
        }
        if (!runId) return new Response("Could not start the run", { status: 500 });

        const encoder = new TextEncoder();
        const activeRunId = runId;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: StreamEvent) => {
              try {
                controller.enqueue(encoder.encode(sse(event)));
              } catch {
                /* client disconnected — the run keeps going on the server */
              }
            };
            try {
              const outcome = await executeRun({
                chatId,
                requestId,
                runId: activeRunId,
                send,
                // Hand long tasks over to the background worker before the
                // request itself is at risk of being torn down.
                deadlineAt: Date.now() + 8 * 60_000,
              });
              if (outcome.status === "handoff" || outcome.status === "waiting") {
                send({ type: "assistant-finish", messageId: outcome.messageId ?? requestId });
              }
            } catch (error) {
              send({
                type: "error",
                message: error instanceof Error ? error.message : "Generation failed",
              });
            } finally {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
        });

        return new Response(stream, { headers: eventStreamHeaders });
      },
    },
  },
});
