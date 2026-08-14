import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";
import { Timeline } from "./timeline";
import { useChatStream } from "@/hooks/use-chat-stream";

import { listModels } from "@/lib/settings.functions";
import {
  editUserMessage,
  getChat,
  sendUserMessage,
  truncateFrom,
  updateChat,
} from "@/lib/workspace.functions";

function uuid() {
  return crypto.randomUUID();
}

export function ChatView({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const chatQuery = useQuery({
    queryKey: ["chat", chatId],
    queryFn: () => getChat({ data: { chatId } }),
    // A run keeps going on the server even if we leave the chat — keep polling
    // until the assistant message is no longer marked as streaming.
    refetchInterval: (query) =>
      (query.state.data?.messages ?? []).some((m) => m.status === "streaming") ? 1500 : false,
  });

  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: () => listModels() });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    await queryClient.invalidateQueries({ queryKey: ["sandbox-dir", chatId] });
    await queryClient.invalidateQueries({ queryKey: ["sandbox-status", chatId] });
  }, [queryClient, chatId]);


  const { live, streaming, start, stop } = useChatStream(refresh);

  const models = (modelsQuery.data ?? []).filter((m) => m.enabled);
  const activeModelId =
    chatQuery.data?.chat.modelId ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? null;

  const pickModel = useMutation({
    mutationFn: (modelId: string) => updateChat({ data: { chatId, modelId } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  };

  useEffect(scrollToBottom, [chatQuery.data?.messages.length, live.answer, live.timeline.length, live.tools.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || streaming) return;
    if (!activeModelId) {
      toast.error("Add a model in Settings → Models first.");
      return;
    }
    atBottomRef.current = true;
    try {
      if (!chatQuery.data?.chat.modelId) {
        await updateChat({ data: { chatId, modelId: activeModelId } });
      }
      await sendUserMessage({ data: { chatId, content, requestId: uuid() } });
      await refresh();
      await start(chatId, uuid());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the message");
    }
  }

  const sendRef = useRef(send);
  sendRef.current = send;

  // When the user fills the secret form the agent asked for, resume the run
  // automatically — no extra message typing required.
  useEffect(() => {
    function onSecretsSaved(event: Event) {
      const detail = (event as CustomEvent<{ chatId: string; names: string[] }>).detail;
      if (!detail || detail.chatId !== chatId) return;
      const names = detail.names.length ? detail.names.join(", ") : "the requested secrets";
      void sendRef.current(
        `I saved ${names} in the environment. Continue the task from where you stopped.`,
      );
    }
    window.addEventListener("agentkit:secrets-saved", onSecretsSaved);
    return () => window.removeEventListener("agentkit:secrets-saved", onSecretsSaved);
  }, [chatId]);

  async function retry(messageId: string) {
    if (streaming) return;
    try {
      await truncateFrom({ data: { messageId } });
      await refresh();
      await start(chatId, uuid());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    }
  }

  async function edit(messageId: string, content: string) {
    if (streaming) return;
    try {
      await editUserMessage({ data: { messageId, content } });
      await refresh();
      await start(chatId, uuid());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Edit failed");
    }
  }

  const allMessages = chatQuery.data?.messages ?? [];
  // While we stream locally, the live timeline already shows the run; hide the
  // half-written DB row so nothing is rendered twice.
  const messages = streaming ? allMessages.filter((m) => m.status !== "streaming") : allMessages;
  const remoteRunning = !streaming && allMessages.some((m) => m.status === "streaming");


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {messages.length === 0 && !streaming && (
            <div className="panel-surface p-5">
              <h1 className="mb-1 text-base font-semibold">Start a coding task</h1>
              <p className="text-sm text-muted-foreground">
The agent thinks, explores the sandbox, edits code, runs it, fixes what breaks and verifies
                the result — automatically, without waiting for approval between steps.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              chatId={chatId}
              onEdit={edit}
              onRetry={retry}
              busy={streaming}
            />
          ))}

          {streaming && (
            <div className="space-y-2">
              <Timeline blocks={live.timeline} chatId={chatId} />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {live.phaseLabel ||
                  (live.phase === "acting"
                    ? "Working in the sandbox…"
                    : live.phase === "thinking"
                      ? "Thinking…"
                      : "Working…")}
              </div>
            </div>
          )}


          {remoteRunning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              This task is still running in the background…
            </div>
          )}

          {live.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {live.error}

            </p>
          )}
        </div>
      </div>

      <Composer
        onSend={send}
        onStop={stop}
        streaming={streaming}
        models={models}
        modelId={activeModelId}
        onModelChange={(id) => pickModel.mutate(id)}
        disabled={chatQuery.isLoading}
      />
    </div>
  );
}
