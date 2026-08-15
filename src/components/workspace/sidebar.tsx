import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createChat, deleteChat, listChats, updateChat } from "@/lib/workspace.functions";
import { cn } from "@/lib/utils";

export function ChatSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { chatId?: string };
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const chats = useQuery({ queryKey: ["chats"], queryFn: () => listChats() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["chats"] });

  const create = useMutation({
    mutationFn: () => createChat({ data: {} }),
    onSuccess: async ({ id }) => {
      await invalidate();
      onNavigate?.();
      navigate({ to: "/chat/$chatId", params: { chatId: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteChat({ data: { chatId: id } }),
    onSuccess: async (_r, id) => {
      await invalidate();
      if (params.chatId === id) navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: (input: { chatId: string; title?: string; pinned?: boolean }) =>
      updateChat({ data: input }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const list = chats.data ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => c.title.toLowerCase().includes(q)) : list;
  }, [chats.data, query]);

  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);

  const renderRow = (chat: { id: string; title: string; pinned: boolean }) => {
    const active = params.chatId === chat.id;
    if (renaming === chat.id) {
      return (
        <div key={chat.id} className="flex items-center gap-1 px-1 py-1">
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                patch.mutate({ chatId: chat.id, title: renameValue.trim() || chat.title });
                setRenaming(null);
              }
              if (e.key === "Escape") setRenaming(null);
            }}
            className="h-8 text-sm"
            maxLength={120}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            aria-label="Save name"
            onClick={() => {
              patch.mutate({ chatId: chat.id, title: renameValue.trim() || chat.title });
              setRenaming(null);
            }}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            aria-label="Cancel rename"
            onClick={() => setRenaming(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      );
    }

    return (
      <div
        key={chat.id}
        className={cn(
          "group relative flex items-center gap-1 rounded-lg pr-1 transition-colors",
          active
            ? "bg-sidebar-accent text-foreground"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/50",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-foreground transition-opacity",
            active ? "opacity-100" : "opacity-0",
          )}
        />
        <Link
          to="/chat/$chatId"
          params={{ chatId: chat.id }}
          onClick={onNavigate}
          className="min-w-0 flex-1 truncate px-3 py-2.5 text-sm"
        >
          {chat.title}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 opacity-70"
              aria-label={`Actions for ${chat.title}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onSelect={() => {
                setRenaming(chat.id);
                setRenameValue(chat.title);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => patch.mutate({ chatId: chat.id, pinned: !chat.pinned })}
            >
              {chat.pinned ? (
                <>
                  <PinOff className="mr-2 h-4 w-4" /> Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-4 w-4" /> Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => remove.mutate(chat.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
          <Terminal className="h-4 w-4" />
        </span>
        <span className="font-display text-sm font-semibold tracking-tight">agentkit</span>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <Button className="h-10 w-full justify-start rounded-lg" onClick={() => create.mutate()}>
          <Plus className="mr-2 h-4 w-4" /> New chat
        </Button>
        <div className="relative">
          <Search className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-10 rounded-lg border-sidebar-border bg-background/40 pl-9 text-sm"
          />
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-2 pb-3">
        {pinned.length > 0 && (
          <section>
            <h2 className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Pinned
            </h2>
            <div className="space-y-0.5">{pinned.map(renderRow)}</div>
          </section>
        )}

        <section>
          {pinned.length > 0 && (
            <h2 className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Recent
            </h2>
          )}
          <div className="space-y-0.5">{rest.map(renderRow)}</div>
          {filtered.length === 0 && !chats.isLoading && (
            <p className="px-2 py-6 text-sm text-muted-foreground">No chats yet.</p>
          )}
        </section>
      </div>

      <div className="border-t border-sidebar-border p-2">
        <Link
          to="/settings/providers"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Settings className="h-4 w-4" /> Settings
        </Link>
      </div>
    </div>
  );
}
