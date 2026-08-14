import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelDTO } from "@/lib/types";

export function Composer({
  onSend,
  onStop,
  streaming,
  models,
  modelId,
  onModelChange,
  disabled,
}: {
  onSend: (content: string) => void;
  onStop: () => void;
  streaming: boolean;
  models: ModelDTO[];
  modelId: string | null;
  onModelChange: (id: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Local draft state: typing must not re-render the message list / live timeline.
  const [value, setValue] = useState("");
  const [canSend, setCanSend] = useState(false);

  useEffect(() => {
    if (!streaming) ref.current?.focus();
  }, [streaming]);

  function submit() {
    const content = value.trim();
    if (!content || streaming) return;
    setValue("");
    setCanSend(false);
    onSend(content);
  }


  return (
    <div className="safe-bottom border-t border-border bg-background/95 px-3 pt-3 pb-3 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !streaming) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Describe the task. Enter to send, Shift+Enter for a new line."
          aria-label="Message"
          className="max-h-48 min-h-[72px] resize-none bg-panel text-sm"
          maxLength={30000}
        />
        <div className="flex items-center gap-2">
          <Select value={modelId ?? ""} onValueChange={onModelChange}>
            <SelectTrigger
              className="h-9 min-w-0 flex-1 text-xs sm:max-w-64"
              aria-label="Model selector"
            >
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.displayName}
                  {m.isDefault ? " · default" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {streaming ? (
            <Button variant="secondary" onClick={onStop} className="h-9">
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button onClick={onSend} disabled={disabled || !value.trim()} className="h-9">
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
