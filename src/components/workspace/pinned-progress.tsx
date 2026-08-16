import { useState } from "react";
import { Check, ChevronDown, Circle, ListChecks, Loader2 } from "lucide-react";
import type { ProgressStep } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Sticky task card pinned right above the composer while a task is unfinished.
 * Expandable/collapsible like the thought blocks; disappears once every step is done.
 */
export function PinnedProgress({ title, steps }: { title?: string; steps: ProgressStep[] }) {
  const [open, setOpen] = useState(true);
  if (steps.length === 0) return null;

  const done = steps.filter((s) => s.status === "done").length;
  if (done === steps.length) return null;
  const pct = Math.round((done / steps.length) * 100);
  const current = steps.find((s) => s.status === "running") ?? steps.find((s) => s.status === "pending");

  return (
    <div className="px-3 pt-2">
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border/70 bg-panel/90 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title || "Progress"}</span>
            {!open && current && (
              <span className="block truncate text-xs text-muted-foreground">{current.label}</span>
            )}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {done}/{steps.length}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>

        <div className="px-3 pb-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {open && (
          <ol className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto border-t border-border/60 px-3 py-2">
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
        )}
      </div>
    </div>
  );
}
