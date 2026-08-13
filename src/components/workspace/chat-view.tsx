import { ToolActivity } from "@/components/workspace/tool-activity";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, ListChecks, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Composer } from "./composer";
import { CollapsiblePanel, MessageItem } from "./message-item";
import { Markdown } from "./markdown";
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
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const chatQuery = useQuery({
    queryKey: ["chat", chatId],
    queryFn: () => getChat({ data: { chatId } }),
  });
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: () => listModels() });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
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

  useEffect(scrollToBottom, [chatQuery.data?.messages.length, live.answer, live.planning, live.tools.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    if (!activeModelId) {
      toast.error("Add a model in Settings → Models first.");
      return;
    }
    setInput("");
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

  const messages = chatQuery.data?.messages ?? [];

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
                The agent plans out loud before it answers: assumptions, approaches, tradeoffs, then
                a concrete implementation plan.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              onEdit={edit}
              onRetry={retry}
              busy={streaming}
            />
          ))}

          {streaming && (
            <div className="space-y-2">
              <CollapsiblePanel
                title={live.phase === "planning" ? "Planning…" : "Planning"}
                icon={<ListChecks className="h-3.5 w-3.5" />}
                text={live.planning}
                defaultOpen
              />
              <CollapsiblePanel
                title={live.phase === "thinking" ? "Thinking…" : "Thinking"}
                icon={<Brain className="h-3.5 w-3.5" />}
                text={live.thinking}
                defaultOpen
              />
              <ToolActivity tools={live.tools} />
              {live.answer ? (
                <Markdown text={live.answer} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />{" "}
                  {live.phase === "acting" ? "Working in the sandbox…" : "Working…"}
                </div>
              )}

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
        value={input}
        onChange={setInput}
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
