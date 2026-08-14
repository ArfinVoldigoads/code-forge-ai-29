import type { StreamEvent, TimelineBlock } from "./types";

let counter = 0;
const nextId = () => `b${++counter}`;

/** Fold one stream event into an ordered timeline (narration → action → narration). */
export function applyTimelineEvent(
  blocks: TimelineBlock[],
  event: StreamEvent,
): TimelineBlock[] {
  switch (event.type) {
    case "assistant-delta":
    case "step-text": {
      const text = event.text;
      if (!text) return blocks;
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "text") {
        return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...blocks, { kind: "text", id: nextId(), text }];
    }
    case "thought-start":
      return [
        ...blocks,
        { kind: "thought", id: event.id, text: "", durationMs: null, done: false },
      ];
    case "thought-delta":
      return blocks.map((b) =>
        b.kind === "thought" && b.id === event.id ? { ...b, text: b.text + event.text } : b,
      );
    case "thought-end":
      return blocks.map((b) =>
        b.kind === "thought" && b.id === event.id
          ? { ...b, done: true, durationMs: event.durationMs }
          : b,
      );
    case "phase":
      return [
        ...blocks,
        { kind: "phase", id: nextId(), phase: event.phase, message: event.message },
      ];
    case "tool-start":

      return [
        ...blocks,
        {
          kind: "tool",
          id: event.id,
          tool: { id: event.id, name: event.name, input: event.input, logs: [], status: "running" },
        },
      ];
    case "tool-result":
      return blocks.map((b) =>
        b.kind === "tool" && b.tool.id === event.id
          ? {
              ...b,
              tool: {
                ...b.tool,
                status: event.error ? "error" : "done",
                output: event.output,
                ...(event.error ? { error: event.error } : {}),
              },
            }
          : b,
      );
    case "command-output":
      return blocks.map((b) =>
        b.kind === "tool" && b.tool.id === event.id
          ? { ...b, tool: { ...b.tool, logs: [...b.tool.logs, event.text].slice(-300) } }
          : b,
      );
    case "image":
      return [
        ...blocks,
        {
          kind: "image",
          id: event.id,
          url: event.url,
          ...(event.caption ? { caption: event.caption } : {}),
        },
      ];
    case "secret-request":
      return [...blocks, { kind: "secret", id: event.id, reason: event.reason, keys: event.keys }];
    default:
      return blocks;
  }
}

/** Rebuild the ordered timeline of a saved message from its persisted events. */
export function buildTimeline(events: StreamEvent[] | null | undefined): TimelineBlock[] {
  let blocks: TimelineBlock[] = [];
  for (const event of events ?? []) blocks = applyTimelineEvent(blocks, event);
  return blocks;
}

export function timelineHasContent(blocks: TimelineBlock[]): boolean {
  return blocks.some((b) => (b.kind === "text" ? b.text.trim().length > 0 : true));
}
