import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  uploadAttachment,
  type UploadedAttachment,
} from "@/lib/attachments.functions";
import type { ModelDTO } from "@/lib/types";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Composer({
  chatId,
  onSend,
  onStop,
  streaming,
  models,
  modelId,
  onModelChange,
  disabled,
}: {
  chatId: string;
  onSend: (content: string, attachmentIds: string[]) => void;
  onStop: () => void;
  streaming: boolean;
  models: ModelDTO[];
  modelId: string | null;
  onModelChange: (id: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Local draft state: typing must not re-render the message list / live timeline.
  const [value, setValue] = useState("");
  const [canSend, setCanSend] = useState(false);
  const [files, setFiles] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!streaming) ref.current?.focus();
  }, [streaming]);

  async function addFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (!picked.length) return;
    if (files.length + picked.length > MAX_ATTACHMENTS) {
      toast.error(`Maksimal ${MAX_ATTACHMENTS} file per pesan.`);
      return;
    }
    for (const file of picked) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} lebih dari 20 MB.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const data = await readAsBase64(file);
        const uploaded = await uploadAttachment({
          data: {
            chatId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            data,
          },
        });
        setFiles((f) => [...f, uploaded]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Gagal mengunggah ${file.name}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function submit() {
    const content = value.trim();
    if ((!content && files.length === 0) || streaming || uploading > 0) return;
    setValue("");
    setCanSend(false);
    const ids = files.map((f) => f.id);
    setFiles([]);
    onSend(content || "(lihat lampiran)", ids);
  }

  return (
    <div className="safe-bottom bg-background/95 px-3 pt-2 pb-3 backdrop-blur">
      <div
        className={`mx-auto w-full max-w-3xl rounded-2xl border bg-panel/80 p-2 shadow-lg transition-colors ${
          dragging ? "border-primary" : "border-border/70"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        {(files.length > 0 || uploading > 0) && (
          <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
            {files.map((f) => (
              <span
                key={f.id}
                className="flex max-w-52 items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 py-1 pr-1 pl-2 text-xs"
              >
                {f.mimeType.startsWith("image/") && f.url ? (
                  <img src={f.url} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="truncate">{f.fileName}</span>
                <span className="text-muted-foreground">{prettySize(f.sizeBytes)}</span>
                <button
                  type="button"
                  aria-label={`Hapus ${f.fileName}`}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {uploading > 0 && (
              <span className="flex items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mengunggah…
              </span>
            )}
          </div>
        )}

        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            const has = next.trim().length > 0;
            if (has !== canSend) setCanSend(has);
          }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !streaming) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Jelaskan tugasnya… Enter kirim, Shift+Enter baris baru."
          aria-label="Message"
          className="max-h-48 min-h-[64px] resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0 sm:text-sm"
          maxLength={30000}
        />

        <div className="flex items-center gap-2 px-1 pt-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Lampirkan file"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Select value={modelId ?? ""} onValueChange={onModelChange}>
            <SelectTrigger
              className="h-9 min-w-0 flex-1 rounded-full border-border/70 text-xs sm:max-w-56"
              aria-label="Model selector"
            >
              <SelectValue placeholder="Pilih model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.displayName}
                  {m.isDefault ? " · default" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {streaming ? (
            <Button
              variant="secondary"
              onClick={onStop}
              className="h-9 shrink-0 rounded-full px-4"
            >
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              aria-label="Kirim"
              disabled={disabled || uploading > 0 || (!canSend && files.length === 0)}
              className="h-9 w-9 shrink-0 rounded-full"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
