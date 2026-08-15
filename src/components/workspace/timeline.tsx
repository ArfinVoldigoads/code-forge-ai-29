import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, ChevronDown, KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "./markdown";
import { ToolRow } from "./tool-activity";
import { saveSecret } from "@/lib/secrets.functions";
import type { SecretRequestKey, TimelineBlock } from "@/lib/types";

function ScreenshotCard({ url, caption }: { url: string; caption?: string }) {
  return (
    <figure className="panel-surface overflow-hidden rounded-md border border-border/60">
      <img
        src={url}
        alt={caption ?? "Screenshot captured by the agent"}
        loading="lazy"
        className="w-full"
      />
      {caption && (
        <figcaption className="border-t border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function SecretForm({
  chatId,
  reason,
  keys,
}: {
  chatId: string;
  reason: string;
  keys: SecretRequestKey[];
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      for (const key of keys) {
        const value = (values[key.name] ?? "").trim();
        if (!value) continue;
        await saveSecret({
          data: {
            chatId,
            name: key.name,
            value,
            ...(key.description ? { description: key.description } : {}),
          },
        });
      }
    },
    onSuccess: async (_data, _vars) => {
      const savedNames = keys
        .map((k) => k.name)
        .filter((n) => (values[n] ?? "").trim().length > 0);
      setSaved(true);
      setValues({});
      toast.success("Secrets saved — resuming the agent…");
      await queryClient.invalidateQueries({ queryKey: ["secrets", chatId] });
      // Resume the run automatically instead of waiting for the user to type.
      window.dispatchEvent(
        new CustomEvent("agentkit:secrets-saved", { detail: { chatId, names: savedNames } }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="panel-surface space-y-3 rounded-md border border-primary/40 p-3">
      <div className="flex items-start gap-2 text-sm">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">The agent needs credentials</p>
          <p className="text-xs text-muted-foreground">{reason}</p>
        </div>
      </div>

      {saved ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <ShieldCheck className="h-3.5 w-3.5" /> Saved and injected into the sandbox environment.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.name} className="space-y-1">
                <Label htmlFor={`secret-${key.name}`} className="font-mono text-xs">
                  {key.name}
                </Label>
                {key.description && (
                  <p className="text-[11px] text-muted-foreground">{key.description}</p>
                )}
                <Input
                  id={`secret-${key.name}`}
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the value"
                  value={values[key.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [key.name]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Stored server-side, masked in the UI, never printed by the agent.
            </p>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save secrets
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ThoughtCard({
  text,
  durationMs,
  done,
}: {
  text: string;
  durationMs: number | null;
  done: boolean;
}) {
  const [open, setOpen] = useState(false);
  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;
  return (
    <div className="panel-surface overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        {done ? (
          <Brain className="h-3.5 w-3.5" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        <span className="flex-1">
          {done ? (seconds ? `Thought for ${seconds}s` : "Thought") : "Thinking…"}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && text.trim() && (
        <div className="scroll-thin max-h-80 overflow-y-auto border-t border-border/60 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}

function PhaseRow({ phase, message }: { phase: string; message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      <span className="font-mono uppercase tracking-wide text-[10px]">{phase}</span>
      <span>{message}</span>
    </div>
  );
}

export function Timeline({ blocks, chatId }: { blocks: TimelineBlock[]; chatId: string }) {
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {blocks.map((block) => {
        if (block.kind === "text")
          return block.text.trim() ? <Markdown key={block.id} text={block.text} /> : null;
        if (block.kind === "thought")
          return (
            <ThoughtCard
              key={block.id}
              text={block.text}
              durationMs={block.durationMs}
              done={block.done}
            />
          );
        if (block.kind === "phase")
          return <PhaseRow key={block.id} phase={block.phase} message={block.message} />;
        if (block.kind === "tool") return <ToolRow key={block.id} tool={block.tool} />;
        if (block.kind === "image")
          return (
            <ScreenshotCard
              key={block.id}
              url={block.url}
              {...(block.caption ? { caption: block.caption } : {})}
            />
          );
        if (block.kind === "ask")
          return (
            <AskUserCard
              key={block.id}
              chatId={chatId}
              askId={block.id}
              {...(block.title ? { title: block.title } : {})}
              questions={block.questions}
            />
          );
        if (block.kind === "progress")
          return (
            <ProgressCard
              key={block.id}
              {...(block.title ? { title: block.title } : {})}
              steps={block.steps}
            />
          );
        return (
          <SecretForm key={block.id} chatId={chatId} reason={block.reason} keys={block.keys} />
        );
      })}
    </div>
  );
}

