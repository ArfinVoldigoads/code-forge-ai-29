import { useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, Terminal, XCircle } from "lucide-react";
import type { Json, StreamEvent, ToolEventState } from "@/lib/types";

const LABEL: Record<string, string> = {
  write_file: "Writing file",
  read_file: "Reading file",
  list_files: "Listing files",
  run_command: "Running command",
};

function summarize(name: string, input: Json): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  if (name === "run_command") return String(obj["command"] ?? "");
  if (typeof obj["path"] === "string") return obj["path"];
  return "";
}

function ToolRow({ tool }: { tool: ToolEventState }) {
  const [open, setOpen] = useState(false);
  const detail = tool.logs.join("") || JSON.stringify(tool.output ?? {}, null, 2);

  return (
    <div className="panel-surface overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        {tool.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : tool.status === "error" ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <span className="font-medium">{LABEL[tool.name] ?? tool.name}</span>
        <code className="truncate font-mono text-[11px] text-muted-foreground">
          {summarize(tool.name, tool.input)}
        </code>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <pre className="scroll-thin max-h-64 overflow-auto border-t border-border/60 bg-background/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {tool.error ? tool.error : detail || "(no output)"}
        </pre>
      )}
    </div>
  );
}

export function ToolActivity({ tools }: { tools: ToolEventState[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Terminal className="h-3 w-3" /> Sandbox activity
      </div>
      {tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

/** Rebuild tool state from the persisted event log of a saved message. */
export function toolsFromEvents(events: StreamEvent[] | null | undefined): ToolEventState[] {
  const map = new Map<string, ToolEventState>();
  for (const event of events ?? []) {
    if (event.type === "tool-start") {
      map.set(event.id, {
        id: event.id,
        name: event.name,
        input: event.input,
        logs: [],
        status: "running",
      });
    } else if (event.type === "tool-result") {
      const existing = map.get(event.id);
      if (existing) {
        existing.status = event.error ? "error" : "done";
        existing.output = event.output;
        if (event.error) existing.error = event.error;
      }
    } else if (event.type === "command-output") {
      const existing = map.get(event.id);
      if (existing) existing.logs.push(event.text);
    }
  }
  return [...map.values()];
}
