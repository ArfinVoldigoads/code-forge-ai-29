import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, HelpCircle, Loader2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitAskAnswers } from "@/lib/ask.functions";
import type { AskUserQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AskUserCard({
  chatId,
  askId,
  title,
  questions,
}: {
  chatId: string;
  askId: string;
  title?: string;
  questions: AskUserQuestion[];
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [done, setDone] = useState<null | "answered" | "skipped">(null);

  const current = questions[step];
  const last = step >= questions.length - 1;

  const finish = useMutation({
    mutationFn: async (skipped: boolean) => {
      const payload = skipped
        ? []
        : questions
            .map((q) => ({
              question: q.question,
              answer: (other[q.id]?.trim() || answers[q.id] || "").trim(),
            }))
            .filter((a) => a.answer.length > 0);
      await submitAskAnswers({ data: { chatId, askId, skipped, answers: payload } });
      return { skipped, payload };
    },
    onSuccess: ({ skipped, payload }) => {
      setDone(skipped ? "skipped" : "answered");
      const text = skipped
        ? "Skip — pilih default paling masuk akal dan lanjutkan tanpa bertanya lagi."
        : payload.map((a) => `- ${a.question}: ${a.answer}`).join("\n");
      window.dispatchEvent(
        new CustomEvent("agentkit:ask-answered", { detail: { chatId, askId, text } }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!current) return null;

  if (done) {
    return (
      <div className="rounded-xl border border-border/70 bg-panel/60 px-3.5 py-2.5 text-xs text-muted-foreground">
        {done === "skipped"
          ? "Pertanyaan dilewati — agent melanjutkan dengan pilihan default."
          : "Jawaban terkirim — agent melanjutkan pekerjaannya."}
      </div>
    );
  }

  const selected = answers[current.id];

  return (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-panel/80 p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          {title && <p className="text-xs text-muted-foreground">{title}</p>}
          <p className="text-[0.9375rem] font-medium break-words">{current.question}</p>
        </div>
        {questions.length > 1 && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {step + 1}/{questions.length}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        {current.options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setAnswers((a) => ({ ...a, [current.id]: opt.label }))}
            className={cn(
              "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              selected === opt.label
                ? "border-primary bg-primary/10"
                : "border-border/70 hover:border-primary/50 hover:bg-accent/40",
            )}
          >
            <span className="font-medium">{opt.label}</span>
            {opt.description && (
              <span className="block text-xs text-muted-foreground">{opt.description}</span>
            )}
          </button>
        ))}
      </div>

      {current.allowOther !== false && (
        <Input
          placeholder="Jawaban lain…"
          value={other[current.id] ?? ""}
          onChange={(e) => setOther((o) => ({ ...o, [current.id]: e.target.value }))}
          className="h-10 text-sm"
        />
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={finish.isPending}
          onClick={() => finish.mutate(true)}
        >
          <SkipForward className="mr-1 h-3.5 w-3.5" /> Skip
        </Button>
        <Button
          size="sm"
          disabled={finish.isPending}
          onClick={() => (last ? finish.mutate(false) : setStep((s) => s + 1))}
        >
          {finish.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {last ? (
            <>
              <Check className="mr-1 h-3.5 w-3.5" /> Kirim
            </>
          ) : (
            "Selanjutnya"
          )}
        </Button>
      </div>
    </div>
  );
}
