import { useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Copy,
  ListChecks,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";
import type { MessageDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CollapsiblePanel({
  title,
  icon,
  text,
  defaultOpen = false,
  tone = "default",
}: {
  title: string;
  icon: React.ReactNode;
  text: string;
  defaultOpen?: boolean;
  tone?: "default" | "success" | "error";
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!text) return null;

  return (
    <div className="panel-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span
          className={cn(
            tone === "success" && "text-success",
            tone === "error" && "text-destructive",
          )}
        >
          {icon}
        </span>
        <span className="flex-1">{title}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="scroll-thin max-h-96 overflow-y-auto border-t border-border px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}

export function MessageItem({
  message,
  onEdit,
  onRetry,
  busy,
}: {
  message: MessageDTO;
  onEdit: (id: string, content: string) => void;
  onRetry: (id: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full max-w-[95%] space-y-2 sm:max-w-[80%]">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-24 font-sans text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || !draft.trim()}
                onClick={() => {
                  setEditing(false);
                  onEdit(message.id, draft.trim());
                }}
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Save & resubmit
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[95%] rounded-lg rounded-br-sm border border-border bg-panel px-3.5 py-2.5 text-[0.9375rem] break-words whitespace-pre-wrap sm:max-w-[80%]">
              {message.content}
            </div>
            <div className="flex items-center gap-1">
              {message.revision > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  edited · rev {message.revision}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <CollapsiblePanel
        title="Planning"
        icon={<ListChecks className="h-3.5 w-3.5" />}
        text={message.planning ?? ""}
      />
      <CollapsiblePanel
        title="Thinking"
        icon={<Brain className="h-3.5 w-3.5" />}
        text={message.thinking ?? ""}
      />

      {message.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{message.error}</span>
        </div>
      )}

      {message.content && <Markdown text={message.content} />}

      <div className="flex flex-wrap items-center gap-1 pt-1">
        {message.modelRef && (
          <span className="mr-1 font-mono text-[11px] text-muted-foreground">
            {message.modelRef}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(message.content);
            toast.success("Copied");
          }}
        >
          <Copy className="mr-1 h-3.5 w-3.5" /> Copy
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => onRetry(message.id)}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    </div>
  );
}
