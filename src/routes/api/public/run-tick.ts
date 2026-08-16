import { createFileRoute } from "@tanstack/react-router";

/**
 * Background worker for durable agent runs.
 *
 * pg_cron calls this every minute. It picks up runs whose lease expired (the
 * browser closed, the request was torn down, a slice handed the work back) and
 * pushes each one forward by a few model turns.
 */

const MAX_RUNS_PER_TICK = 2;
const SLICE_MS = 50_000;

function authorized(request: Request): boolean {
  const expected =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
  const key =
    request.headers.get("apikey") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(expected) && key === expected;
}

export const Route = createFileRoute("/api/public/run-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

        const { db } = await import("@/lib/db.server");
        const { executeRun } = await import("@/lib/run-engine.server");

        const nowIso = new Date().toISOString();
        const { data: candidates } = await db
          .from("runs")
          .select("id, chat_id, request_id, round, lease_until")
          .in("status", ["queued", "running"])
          .lt("lease_until", nowIso)
          .order("updated_at", { ascending: true })
          .limit(MAX_RUNS_PER_TICK);

        const results: Array<{ runId: string; status: string }> = [];

        for (const run of candidates ?? []) {
          // Claim the lease optimistically: the update only lands when nobody
          // else took the same row in between.
          const { data: claimed } = await db
            .from("runs")
            .update({
              status: "running",
              round: (run.round ?? 0) + 1,
              lease_until: new Date(Date.now() + SLICE_MS + 60_000).toISOString(),
              last_heartbeat: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", run.id)
            .eq("lease_until", run.lease_until)
            .select("id")
            .maybeSingle();
          if (!claimed) continue;

          // A run that has been resumed far too often is stuck; stop the loop.
          if ((run.round ?? 0) > 60) {
            await db
              .from("runs")
              .update({
                status: "failed",
                last_error: "Run exceeded the maximum number of background rounds.",
                lease_until: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as never)
              .eq("id", run.id);
            await db
              .from("messages")
              .update({
                status: "error",
                error: "Run melebihi batas lanjutan otomatis. Tekan Retry untuk melanjutkan.",
              } as never)
              .eq("request_id", run.request_id);
            results.push({ runId: run.id, status: "exhausted" });
            continue;
          }

          try {
            const outcome = await executeRun({
              chatId: run.chat_id,
              requestId: run.request_id,
              runId: run.id,
              deadlineAt: Date.now() + SLICE_MS,
              maxRounds: 6,
            });
            results.push({ runId: run.id, status: outcome.status });
          } catch (error) {
            const message = error instanceof Error ? error.message : "worker failure";
            await db
              .from("runs")
              .update({
                status: "failed",
                last_error: message.slice(0, 800),
                lease_until: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as never)
              .eq("id", run.id);
            results.push({ runId: run.id, status: "failed" });
          }
        }

        return Response.json({ picked: results.length, results });
      },
      GET: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        return Response.json({ ok: true });
      },
    },
  },
});
