import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";
import { Timeline } from "./timeline";
import { useChatStream } from "@/hooks/use-chat-stream";
import { buildTimeline } from "@/lib/timeline";
import { PinnedProgress } from "./pinned-progress";
import type { MessageDTO } from "@/lib/types";

type ChatQueryData = { chat: { modelId: string | null } & Record<string, unknown>; messages: MessageDTO[] };

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
    // Switching a model only changes one field — update the cache in place so
    // the picker responds instantly instead of refetching chat + sandbox state.
    onMutate: (modelId: string) => {
      const previous = queryClient.getQueryData<ChatQueryData>(["chat", chatId]);
      queryClient.setQueryData(["chat", chatId], (old: ChatQueryData | undefined) =>
        old ? { ...old, chat: { ...old.chat, modelId } } : old,
      );
      return { previous };
    },
    onError: (e: Error, _modelId, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["chat", chatId], ctx.previous);
      toast.error(e.message);
    },
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

  async function send(raw: string, attachmentIds: string[] = []) {
    const content = raw.trim();
    if (!content || streaming) return;
    if (!activeModelId) {
      toast.error("Add a model in Settings → Models first.");
      return;
    }
    atBottomRef.current = true;

    // Optimistic: the bubble shows the instant the user hits send.
    const optimisticId = `optimistic-${uuid()}`;
    queryClient.setQueryData(["chat", chatId], (old: ChatQueryData | undefined) =>
      old
        ? {
            ...old,
            messages: [
              ...old.messages,
              {
                id: optimisticId,
                chatId,
                role: "user",
                content,
                planning: null,
                thinking: null,
                events: [],
                modelRef: null,
                requestId: optimisticId,
                error: null,
                status: "complete",
                revision: 1,
                createdAt: new Date().toISOString(),
                attachments: [],
              } as MessageDTO,
            ],
          }
        : old,
    );

    try {
      if (!chatQuery.data?.chat.modelId) {
        void updateChat({ data: { chatId, modelId: activeModelId } });
      }
      const requestId = uuid();
      const saved = await sendUserMessage({
        data: { chatId, content, requestId, ...(attachmentIds.length ? { attachmentIds } : {}) },
      });
      // The row now exists in the database — swap the placeholder for its real
      // id so the next refetch reconciles it instead of flashing a duplicate.
      // No invalidation here: refetching chat + sandbox mid-send adds seconds of jank.
      queryClient.setQueryData(["chat", chatId], (old: ChatQueryData | undefined) =>
        old
          ? {
              ...old,
              messages: old.messages.map((m) =>
                m.id === optimisticId ? { ...m, id: saved.id, requestId } : m,
              ),
            }
          : old,
      );
      await start(chatId, uuid());
    } catch (error) {
      // Drop the placeholder bubble: nothing was persisted.
      queryClient.setQueryData(["chat", chatId], (old: ChatQueryData | undefined) =>
        old ? { ...old, messages: old.messages.filter((m) => m.id !== optimisticId) } : old,
      );
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
    // Same for the agent's in-chat question card: answering resumes the run.
    function onAskAnswered(event: Event) {
      const detail = (event as CustomEvent<{ chatId: string; text: string }>).detail;
      if (!detail || detail.chatId !== chatId) return;
      void sendRef.current(
        detail.text
          ? `Jawaban saya:\n${detail.text}\n\nLanjutkan tugasnya sekarang.`
          : "Skip — pakai default paling masuk akal dan lanjutkan tugasnya sekarang.",
      );
    }
    window.addEventListener("agentkit:secrets-saved", onSecretsSaved);
    window.addEventListener("agentkit:ask-answered", onAskAnswered);
    return () => {
      window.removeEventListener("agentkit:secrets-saved", onSecretsSaved);
      window.removeEventListener("agentkit:ask-answered", onAskAnswered);
    };
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

  // Stable identities so memoized message rows don't re-render on every poll.
  const editRef = useRef(edit);
  editRef.current = edit;
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const onEdit = useCallback((id: string, content: string) => void editRef.current(id, content), []);
  const onRetry = useCallback((id: string) => void retryRef.current(id), []);

  const allMessages = chatQuery.data?.messages ?? [];
  const last = allMessages[allMessages.length - 1];
  // While we stream locally the live timeline already shows the current run, so
  // hide only that half-written row — older messages (even ones left marked as
  // streaming by a dropped run) must stay visible.
  const messages =
    streaming && last?.status === "streaming" ? allMessages.slice(0, -1) : allMessages;
  const remoteRunning = !streaming && last?.status === "streaming";
  const showLive = streaming || live.timeline.length > 0;

  // Pinned task card: the newest progress block from the live run, or from the
  // last assistant message when the run continues in the background.
  const activeProgress = (() => {
    const fromLive = [...live.timeline].reverse().find((b) => b.kind === "progress");
    if (fromLive && fromLive.kind === "progress") return fromLive;
    const lastAssistant = [...allMessages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return null;
    const block = [...buildTimeline(lastAssistant.events)]
      .reverse()
      .find((b) => b.kind === "progress");
    return block && block.kind === "progress" ? block : null;
  })();


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-6"
      >
        <div className="mx-auto w-full max-w-3xl space-y-7">
          {messages.length === 0 && !streaming && (
            <div className="space-y-6 py-8">
              <div className="space-y-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  Mau bangun apa hari ini?
                </h1>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Agent berpikir, menjelajah sandbox, menulis kode, menjalankannya, memperbaiki yang
                  gagal, lalu memverifikasi hasilnya — otomatis.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  "Buat website portofolio dengan UI keren",
                  "Scrape data produk dan simpan ke CSV",
                  "Bikin API Express + tes dan jalankan",
                ].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void send(example)}
                    className="min-h-20 rounded-2xl border border-border/60 bg-panel/40 p-4 text-left text-sm leading-snug transition-colors hover:border-foreground/40 hover:bg-panel"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}


          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              chatId={chatId}
              onEdit={onEdit}
              onRetry={onRetry}
              busy={streaming}
            />
          ))}

          {showLive && (
            <div className="space-y-2">
              <Timeline blocks={live.timeline} chatId={chatId} />
              {streaming && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {live.phaseLabel ||
                    (live.phase === "acting"
                      ? "Working in the sandbox…"
                      : live.phase === "thinking"
                        ? "Thinking…"
                        : "Working…")}
                </div>
              )}
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

      {activeProgress && (
        <PinnedProgress
          {...(activeProgress.title ? { title: activeProgress.title } : {})}
          steps={activeProgress.steps}
        />
      )}

      <Composer
        chatId={chatId}
        onSend={(content, ids) => void send(content, ids)}
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
