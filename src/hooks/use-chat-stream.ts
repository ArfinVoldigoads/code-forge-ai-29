import { useCallback, useRef, useState } from "react";
import type { StreamEvent, ToolEventState } from "@/lib/types";

export type LiveState = {
  planning: string;
  thinking: string;
  answer: string;
  tools: ToolEventState[];
  phase: "idle" | "planning" | "thinking" | "answering" | "acting";
  error: string | null;
  cancelled: boolean;
};

const EMPTY: LiveState = {
  planning: "",
  thinking: "",
  answer: "",
  tools: [],
  phase: "idle",
  error: null,
  cancelled: false,
};


export function useChatStream(onFinish: () => void | Promise<void>) {
  const [live, setLive] = useState<LiveState>(EMPTY);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => setLive(EMPTY), []);

  const start = useCallback(
    async (chatId: string, requestId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLive({ ...EMPTY, phase: "planning" });
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatId, requestId }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(
            res.status === 401 ? "Session expired. Unlock the workspace again." : await res.text(),
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.trim();
            if (!line.startsWith("data:")) continue;
            let event: StreamEvent;
            try {
              event = JSON.parse(line.slice(5).trim()) as StreamEvent;
            } catch {
              continue;
            }
            setLive((prev) => applyEvent(prev, event));
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setLive((prev) => ({ ...prev, cancelled: true, phase: "idle" }));
        } else {
          setLive((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "Stream failed",
            phase: "idle",
          }));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        await onFinish();
        setLive(EMPTY);
      }
    },
    [onFinish],
  );

  return { live, streaming, start, stop, reset };
}

function applyEvent(prev: LiveState, event: StreamEvent): LiveState {
  switch (event.type) {
    case "planning-start":
      return { ...prev, phase: "planning" };
    case "planning-update":
      return { ...prev, planning: prev.planning + event.text };
    case "thinking-start":
      return { ...prev, phase: "thinking" };
    case "thinking-update":
      return { ...prev, thinking: prev.thinking + event.text };
    case "assistant-delta":
      return { ...prev, phase: "answering", answer: prev.answer + event.text };
    case "error":
      return { ...prev, error: event.message, phase: "idle" };
    case "cancelled":
      return { ...prev, cancelled: true, phase: "idle" };
    default:
      return prev;
  }
}
