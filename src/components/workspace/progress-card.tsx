import { Check, Circle, Loader2 } from "lucide-react";
import type { ProgressStep } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProgressCard({ title, steps }: { title?: string; steps: ProgressStep[] }) {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.status === "done").length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-panel/80 p-3.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 truncate text-sm font-medium">{title || "Progress"}</p>
        <span className="font-mono text-xs text-muted-foreground">
          {done}/{steps.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={`${i}-${step.label}`} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0">
              {step.status === "done" ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : step.status === "running" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
              )}
            </span>
            <span
              className={cn(
                "break-words",
                step.status === "done" && "text-muted-foreground line-through",
                step.status === "pending" && "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
