import { Fragment } from "react";

/** Minimal, dependency-free renderer for fenced code blocks + paragraphs. */
export function Markdown({ text }: { text: string }) {
  if (!text) return null;
  const blocks = text.split(/```/);

  return (
    <div className="space-y-3 text-[0.9375rem] leading-relaxed break-words">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const newline = block.indexOf("\n");
          const lang = newline > -1 ? block.slice(0, newline).trim() : "";
          const code = newline > -1 ? block.slice(newline + 1) : block;
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-md border border-border bg-background p-3 text-xs"
            >
              {lang ? (
                <div className="mb-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                  {lang}
                </div>
              ) : null}
              <code className="font-mono whitespace-pre">{code.replace(/\n$/, "")}</code>
            </pre>
          );
        }
        return (
          <Fragment key={index}>
            {block.split(/\n{2,}/).map((para, i) =>
              para.trim() ? (
                <p key={i} className="whitespace-pre-wrap">
                  {para.trim()}
                </p>
              ) : null,
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
