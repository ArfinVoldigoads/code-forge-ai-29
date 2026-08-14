import { isValidElement, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textContent((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textContent(children).replace(/\n$/, "");
  const className = isValidElement<{ className?: string }>(children) ? children.props.className : "";
  const language = className?.match(/language-([\w-]+)/)?.[1] ?? "code";

  return (
    <div className="group/code relative my-4 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex h-9 items-center border-b border-border px-3 text-[10px] text-muted-foreground">
        <span className="font-mono uppercase">{language}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7"
          aria-label="Copy code"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="scroll-thin overflow-x-auto p-4 text-xs leading-relaxed">{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="markdown-body min-w-0 text-[0.9375rem] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: CodeBlock,
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
          input: ({ ...props }) => <input {...props} disabled />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
