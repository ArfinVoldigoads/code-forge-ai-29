import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

const uploadSchema = z.object({
  chatId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(150),
  /** base64 payload without the data: prefix */
  data: z.string().min(1),
});

export type UploadedAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  url: string | null;
};

/** Uploads one file to the private attachments bucket and records it for the chat. */
export const uploadAttachment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => uploadSchema.parse(d))
  .handler(async ({ data }): Promise<UploadedAttachment> => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    const { db } = await import("./db.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const bytes = Buffer.from(data.data, "base64");
    if (bytes.byteLength === 0) throw new Error("The file is empty.");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Max file size is 20 MB.");

    const safeName = data.fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${data.chatId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("attachments")
      .upload(path, bytes, { contentType: data.mimeType, upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    let extracted: string | null = null;
    if (/^text\/|json|xml|csv|javascript|typescript/.test(data.mimeType)) {
      extracted = bytes.toString("utf8").slice(0, 100_000);
    }

    const { data: row, error } = await db
      .from("message_attachments")
      .insert({
        chat_id: data.chatId,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: bytes.byteLength,
        storage_path: path,
        extracted_text: extracted,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { data: signed } = await supabaseAdmin.storage
      .from("attachments")
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    return {
      id: row.id as string,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: bytes.byteLength,
      storagePath: path,
      url: signed?.signedUrl ?? null,
    };
  });

/** Signed URLs for already stored attachments so the chat can render them. */
export const signAttachments = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ paths: z.array(z.string().min(1)).max(50) }).parse(d),
  )
  .handler(async ({ data }): Promise<Record<string, string>> => {
    const { requireUnlocked } = await import("./gate.server");
    await requireUnlocked();
    if (data.paths.length === 0) return {};
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage
      .from("attachments")
      .createSignedUrls(data.paths, 60 * 60 * 6);
    const map: Record<string, string> = {};
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
    }
    return map;
  });
