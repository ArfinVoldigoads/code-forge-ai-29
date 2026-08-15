import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ChatDTO, MessageDTO, StreamEvent } from "./types";

const chatId = z.object({ chatId: z.string().uuid() });

export const listChats = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { db } = await import("./db.server");
  const { data, error } = await db
    .from("chats")
    .select("id, title, pinned, model_id, updated_at")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map<ChatDTO>((c) => ({
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    modelId: c.model_id,
    updatedAt: c.updated_at,
  }));
});

export const createChat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ title: z.string().trim().max(120).optional(), modelId: z.string().uuid().nullish() })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { data: row, error } = await db
      .from("chats")
      .insert({
        title: data.title || "New chat",
        model_id: data.modelId ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit("chat.create", "chats", row.id);
    return { id: row.id };
  });

export const updateChat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chatId: z.string().uuid(),
        title: z.string().trim().min(1).max(120).optional(),
        pinned: z.boolean().optional(),
        modelId: z.string().uuid().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch["title"] = data.title;
    if (data.pinned !== undefined) patch["pinned"] = data.pinned;
    if (data.modelId !== undefined) patch["model_id"] = data.modelId;
    const { error } = await db
      .from("chats")
      .update(patch as never)
      .eq("id", data.chatId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => chatId.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");
    const { error } = await db.from("chats").delete().eq("id", data.chatId);
    if (error) throw new Error(error.message);
    await audit("chat.delete", "chats", data.chatId);
    return { ok: true };
  });

export const getChat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => chatId.parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const { data: chat, error } = await db
      .from("chats")
      .select("id, title, pinned, model_id, updated_at")
      .eq("id", data.chatId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!chat) throw new Error("Chat not found");

    const { data: rows, error: msgError } = await db
      .from("messages")
      .select("*, message_attachments(*)")
      .eq("chat_id", data.chatId)
      .order("seq", { ascending: true });
    if (msgError) throw new Error(msgError.message);

    const messages = (rows ?? []).map<MessageDTO>((m) => ({
      id: m.id,
      chatId: m.chat_id,
      role: m.role as MessageDTO["role"],
      content: m.content,
      planning: m.planning,
      thinking: m.thinking,
      events: (m.events ?? []) as StreamEvent[],
      modelRef: m.model_ref,
      requestId: m.request_id,
      error: m.error,
      status: m.status,
      revision: m.revision,
      createdAt: m.created_at,
      attachments: (m.message_attachments ?? []).map((a) => ({
        id: a.id,
        fileName: a.file_name,
        mimeType: a.mime_type,
        sizeBytes: Number(a.size_bytes),
        storagePath: a.storage_path,
      })),
    }));

    return {
      chat: {
        id: chat.id,
        title: chat.title,
        pinned: chat.pinned,
        modelId: chat.model_id,
        updatedAt: chat.updated_at,
      } satisfies ChatDTO,
      messages,
    };
  });

export const sendUserMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chatId: z.string().uuid(),
        content: z.string().trim().min(1).max(30000),
        requestId: z.string().uuid(),
        attachmentIds: z.array(z.string().uuid()).max(10).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");

    // Idempotency: the same request id never creates a second message.
    const { data: existing } = await db
      .from("messages")
      .select("id")
      .eq("request_id", data.requestId)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: row, error } = await db
      .from("messages")
      .insert({
        chat_id: data.chatId,
        role: "user",
        content: data.content,
        request_id: data.requestId,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", data.chatId);
    if ((count ?? 0) <= 1) {
      await db
        .from("chats")
        .update({ title: data.content.slice(0, 60) })
        .eq("id", data.chatId);
    } else {
      await db
        .from("chats")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", data.chatId);
    }
    return { id: row.id };
  });

/** Edits a user message, stores the previous text as a revision, and drops everything after it. */
export const editUserMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        messageId: z.string().uuid(),
        content: z.string().trim().min(1).max(30000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db, audit } = await import("./db.server");

    const { data: msg, error } = await db
      .from("messages")
      .select("id, chat_id, content, revision, seq, role")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!msg || msg.role !== "user") throw new Error("Message not found");

    await db.from("message_revisions").insert({
      message_id: msg.id,
      revision: msg.revision,
      content: msg.content,
    } as never);

    await db
      .from("messages")
      .update({ content: data.content, revision: msg.revision + 1 })
      .eq("id", msg.id);

    await db.from("messages").delete().eq("chat_id", msg.chat_id).gt("seq", msg.seq);
    await audit("message.edit", "messages", msg.id);
    return { chatId: msg.chat_id };
  });

/** Removes an assistant message (and anything after it) so a retry cannot duplicate. */
export const truncateFrom = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const { data: msg } = await db
      .from("messages")
      .select("id, chat_id, seq")
      .eq("id", data.messageId)
      .maybeSingle();
    if (!msg) throw new Error("Message not found");
    await db.from("messages").delete().eq("chat_id", msg.chat_id).gte("seq", msg.seq);
    return { chatId: msg.chat_id };
  });
