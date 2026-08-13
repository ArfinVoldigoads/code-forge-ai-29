import { cn } from "@/lib/utils";

export function StatusPill({ status, message }: { status: string; message?: string | null }) {
  const tone =
    status === "connected"
      ? "border-success/40 bg-success/10 text-success"
      : status === "error"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-panel text-muted-foreground";

  return (
    <span
      title={message ?? undefined}
      className={cn("rounded-full border px-2 py-0.5 font-mono text-[11px]", tone)}
    >
      {status}
    </span>
  );
}
