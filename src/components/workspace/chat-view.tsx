import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";
import { Timeline } from "./timeline";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { MessageDTO } from "@/lib/types";

type ChatQueryData = { chat: unknown; messages: MessageDTO[] };

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
      await sendUserMessage({
        data: { chatId, content, requestId: uuid(), ...(attachmentIds.length ? { attachmentIds } : {}) },
      });
      // Don't block the stream on refetching the chat / sandbox queries.
      void refresh();
      await start(chatId, uuid());
    } catch (error) {
      void refresh();
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
