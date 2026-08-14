import { useCallback, useRef, useState } from "react";
import { applyTimelineEvent } from "@/lib/timeline";
import type { StreamEvent, TimelineBlock, ToolEventState } from "@/lib/types";

export type LiveState = {
  planning: string;
  thinking: string;
  answer: string;
  tools: ToolEventState[];
  timeline: TimelineBlock[];
  phase: "idle" | "planning" | "thinking" | "answering" | "acting";
  phaseLabel: string;
  error: string | null;
  cancelled: boolean;
};

const EMPTY: LiveState = {
  planning: "",
  thinking: "",
  answer: "",
  tools: [],
  timeline: [],
  phase: "idle",
  phaseLabel: "",
  error: null,
  cancelled: false,
};



export function useChatStream(onFinish: () => void | Promise<void>) {
  const [live, setLive] = useState<LiveState>(EMPTY);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runRef = useRef<{ chatId: string; requestId: string } | null>(null);

  const stop = useCallback(() => {
    const run = runRef.current;
    if (run) {
      void fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...run, cancel: true }),
        keepalive: true,
      }).catch(() => {});
    }
    abortRef.current?.abort();
  }, []);


  const reset = useCallback(() => setLive(EMPTY), []);

  const start = useCallback(
    async (chatId: string, requestId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      runRef.current = { chatId, requestId };

      setLive({ ...EMPTY, phase: "thinking" });
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

function applyEvent(prevState: LiveState, event: StreamEvent): LiveState {
  const prev: LiveState = { ...prevState, timeline: applyTimelineEvent(prevState.timeline, event) };
  switch (event.type) {

    case "planning-start":
      return { ...prev, phase: "planning" };
    case "planning-update":
      return { ...prev, planning: prev.planning + event.text };
    case "thought-start":
      return { ...prev, phase: "thinking" };
    case "thought-delta":
      return { ...prev, thinking: prev.thinking + event.text };
    case "phase":
      return { ...prev, phaseLabel: event.message };
    case "thinking-start":
      return { ...prev, phase: "thinking" };
    case "thinking-update":
      return { ...prev, thinking: prev.thinking + event.text };

    case "assistant-delta":
      return { ...prev, phase: "answering", answer: prev.answer + event.text };
    case "tool-start":
      return {
        ...prev,
        phase: "acting",
        tools: [
          ...prev.tools,
          { id: event.id, name: event.name, input: event.input, logs: [], status: "running" },
        ],
      };
    case "tool-result":
      return {
        ...prev,
        tools: prev.tools.map((t) =>
          t.id === event.id
            ? {
                ...t,
                status: event.error ? "error" : "done",
                output: event.output,
                ...(event.error ? { error: event.error } : {}),
              }
            : t,
        ),
      };
    case "command-output":
      return {
        ...prev,
        tools: prev.tools.map((t) =>
          t.id === event.id
            ? { ...t, logs: [...t.logs, event.text].slice(-200) }
            : t,
        ),
      };
    case "error":
      return { ...prev, error: event.message, phase: "idle" };
    case "cancelled":
      return { ...prev, cancelled: true, phase: "idle" };

    default:
      return prev;
  }
}
