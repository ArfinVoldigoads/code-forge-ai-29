export type ProviderDTO = {
  id: string;
  name: string;
  keyMask: string | null;
  hasKey: boolean;
  baseUrl: string | null;
  orgId: string | null;
  enabled: boolean;
  status: string;
  statusMessage: string | null;
  lastTestedAt: string | null;
};

export type ModelDTO = {
  id: string;
  providerId: string | null;
  providerName: string | null;
  displayName: string;
  modelId: string;
  description: string | null;
  contextWindow: number | null;
  vision: boolean;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  status: string;
  statusMessage: string | null;
  lastTestedAt: string | null;
};

export type SkillDTO = {
  id: string;
  slug: string;
  name: string;
  instructions: string;
  enabled: boolean;
  sortOrder: number;
};

export type ChatDTO = {
  id: string;
  title: string;
  pinned: boolean;
  modelId: string | null;
  updatedAt: string;
};

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type SecretRequestKey = { name: string; description?: string };

export type AskUserOption = { label: string; description?: string };

export type AskUserQuestion = {
  id: string;
  question: string;
  options: AskUserOption[];
  allowOther?: boolean;
  multi?: boolean;
};

export type ProgressStep = {
  label: string;
  status: "pending" | "running" | "done";
};


export type StreamEvent =
  | { type: "planning-start" }
  | { type: "planning-update"; text: string }
  | { type: "planning-finish" }
  | { type: "thinking-start" }
  | { type: "thinking-update"; text: string }
  | { type: "thinking-finish" }
  | { type: "thought-start"; id: string }
  | { type: "thought-delta"; id: string; text: string }
  | { type: "thought-end"; id: string; durationMs: number }
  | { type: "phase"; phase: string; message: string }
  | { type: "tool-start"; id: string; name: string; input: Json }
  | { type: "tool-progress"; id: string; text: string }
  | { type: "tool-result"; id: string; output: Json; error?: string }
  | { type: "command-output"; id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "file-change"; path: string; action: string }
  | { type: "test-result"; name: string; passed: boolean; detail?: string }
  | { type: "step-text"; text: string }
  | { type: "image"; id: string; url: string; caption?: string }
  | { type: "secret-request"; id: string; reason: string; keys: SecretRequestKey[] }
  | { type: "ask-user"; id: string; title?: string; questions: AskUserQuestion[] }
  | { type: "progress"; id: string; title?: string; steps: ProgressStep[] }
  | { type: "assistant-delta"; text: string }
  | { type: "assistant-finish"; messageId: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export type ToolEventState = {
  id: string;
  name: string;
  input: Json;
  output?: Json;
  error?: string;
  logs: string[];
  status: "running" | "done" | "error";
};

/** One ordered block of the assistant turn: narration, an action, an image, a form. */
export type TimelineBlock =
  | { kind: "text"; id: string; text: string }
  | { kind: "thought"; id: string; text: string; durationMs: number | null; done: boolean }
  | { kind: "phase"; id: string; phase: string; message: string }
  | { kind: "tool"; id: string; tool: ToolEventState }
  | { kind: "image"; id: string; url: string; caption?: string }
  | { kind: "secret"; id: string; reason: string; keys: SecretRequestKey[] }
  | { kind: "ask"; id: string; title?: string; questions: AskUserQuestion[] }
  | { kind: "progress"; id: string; title?: string; steps: ProgressStep[] };



export type MessageDTO = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  planning: string | null;
  thinking: string | null;
  events: StreamEvent[];
  modelRef: string | null;
  requestId: string | null;
  error: string | null;
  status: string;
  revision: number;
  createdAt: string;
  attachments: AttachmentDTO[];
};

export type AttachmentDTO = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  url?: string | null;
};
