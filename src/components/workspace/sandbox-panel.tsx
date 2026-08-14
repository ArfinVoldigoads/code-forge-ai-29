import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  File as FileIcon,
  Folder,
  Loader2,
  Play,
  RefreshCw,
  Save,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  listDir,
  readSandboxFile,
  runCli,
  sandboxStatus,
  startSandbox,
  writeSandboxFile,
} from "@/lib/sandbox.functions";

type Line = { id: string; command: string; output: string; exitCode: number; ms: number };

function joinPath(base: string, name: string) {
  return base === "." || base === "" ? name : `${base}/${name}`;
}

function parentPath(path: string) {
  if (path === "." || !path.includes("/")) return ".";
  return path.slice(0, path.lastIndexOf("/"));
}

export function SandboxPanel({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["sandbox-status", chatId],
    queryFn: () => sandboxStatus({ data: { chatId } }),
    refetchInterval: 15_000,
  });

  const boot = useMutation({
    mutationFn: () => startSandbox({ data: { chatId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sandbox-status", chatId] });
      await queryClient.invalidateQueries({ queryKey: ["sandbox-dir", chatId] });
      toast.success("Sandbox ready");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <TerminalSquare className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs font-semibold">sandbox</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {status.data?.sandboxId ? status.data.sandboxId.slice(0, 12) : "not running"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          disabled={boot.isPending}
          onClick={() => boot.mutate()}
        >
          {boot.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Start"}
        </Button>
      </div>

      {status.data && !status.data.hasKey && (
        <p className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          Add an E2B API key in Settings → E2B to use the console and file explorer.
        </p>
      )}

      <Tabs defaultValue="console" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 grid w-auto grid-cols-2">
          <TabsTrigger value="console">Console</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <TabsContent value="console" className="min-h-0 flex-1">
          <ConsoleTab chatId={chatId} />
        </TabsContent>
        <TabsContent value="files" className="min-h-0 flex-1">
          <FilesTab chatId={chatId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConsoleTab({ chatId }: { chatId: string }) {
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);

  const exec = useMutation({
    mutationFn: (cmd: string) => runCli({ data: { chatId, command: cmd } }),
    onSuccess: (res, cmd) =>
      setLines((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          command: cmd,
          output: [res.stdout, res.stderr].filter(Boolean).join("\n"),
          exitCode: res.exitCode,
          ms: res.durationMs,
        },
      ]),
    onError: (e: Error, cmd) =>
      setLines((prev) => [
        ...prev,
        { id: crypto.randomUUID(), command: cmd, output: e.message, exitCode: 1, ms: 0 },
      ]),
  });

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, exec.isPending]);

  function submit() {
    const cmd = command.trim();
    if (!cmd || exec.isPending) return;
    setCommand("");
    setHistory((h) => [...h, cmd]);
    setCursor(-1);
    exec.mutate(cmd);
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div
        ref={logRef}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 && (
          <p className="text-muted-foreground">
            Run shell commands inside the sandbox, e.g. <code>ls -la</code>, <code>npm test</code>.
          </p>
        )}
        {lines.map((line) => (
          <div key={line.id} className="mb-2">
            <div className="text-primary">$ {line.command}</div>
            {line.output && (
              <pre className="whitespace-pre-wrap text-muted-foreground">{line.output}</pre>
            )}
            <div className="text-[10px] text-muted-foreground/70">
              exit {line.exitCode} · {line.ms}ms
            </div>
          </div>
        ))}
        {exec.isPending && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> running…
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="command"
          aria-label="Sandbox command"
          className="font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const next = cursor < 0 ? history.length - 1 : Math.max(0, cursor - 1);
              setCursor(next);
              setCommand(history[next] ?? "");
            } else if (e.key === "ArrowDown" && history.length) {
              e.preventDefault();
              const next = cursor < 0 ? -1 : cursor + 1;
              if (next >= history.length) {
                setCursor(-1);
                setCommand("");
              } else {
                setCursor(next);
                setCommand(history[next] ?? "");
              }
            }
          }}
        />
        <Button size="icon" className="h-9 w-9" onClick={submit} disabled={exec.isPending} aria-label="Run command">
          <Play className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function FilesTab({ chatId }: { chatId: string }) {
  const [dir, setDir] = useState(".");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const listing = useQuery({
    queryKey: ["sandbox-dir", chatId, dir],
    queryFn: () => listDir({ data: { chatId, path: dir } }),
    retry: false,
  });

  const open = useMutation({
    mutationFn: (path: string) => readSandboxFile({ data: { chatId, path } }),
    onSuccess: (res) => {
      setOpenFile(res.path);
      setDraft(res.content);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () => writeSandboxFile({ data: { chatId, path: openFile!, content: draft } }),
    onSuccess: () => toast.success("Saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (openFile) {
    return (
      <div className="flex h-full min-h-0 flex-col p-3">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpenFile(null)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="truncate font-mono text-xs">{openFile}</span>
          <Button
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            <Save className="mr-1 h-3.5 w-3.5" /> Save
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="scroll-thin min-h-0 flex-1 resize-none font-mono text-[11px]"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="mb-2 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={dir === "."}
          onClick={() => setDir(parentPath(dir))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="truncate font-mono text-xs text-muted-foreground">/{dir === "." ? "" : dir}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={() => listing.refetch()}
          aria-label="Refresh files"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
        {listing.isFetching && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
          </div>
        )}
        {listing.isError && (
          <p className="px-3 py-2 text-xs text-destructive">{(listing.error as Error).message}</p>
        )}
        {listing.data?.entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">Empty directory.</p>
        )}
        {listing.data?.entries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50"
            onClick={() =>
              entry.type === "dir"
                ? setDir(joinPath(dir, entry.name))
                : open.mutate(joinPath(dir, entry.name))
            }
          >
            {entry.type === "dir" ? (
              <Folder className="h-3.5 w-3.5 text-primary" />
            ) : (
              <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate font-mono">{entry.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
