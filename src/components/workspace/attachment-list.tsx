import { FileText } from "lucide-react";
import type { AttachmentDTO } from "@/lib/types";

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentList({ attachments }: { attachments: AttachmentDTO[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {attachments.map((a) =>
        a.mimeType.startsWith("image/") && a.url ? (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block">
            <img
              src={a.url}
              alt={a.fileName}
              loading="lazy"
              className="max-h-44 rounded-xl border border-border/70 object-cover"
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={a.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-56 items-center gap-2 rounded-xl border border-border/70 bg-panel/60 px-3 py-2 text-xs hover:border-primary/50"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
            <span className="shrink-0 text-muted-foreground">{prettySize(a.sizeBytes)}</span>
          </a>
        ),
      )}
    </div>
  );
}
