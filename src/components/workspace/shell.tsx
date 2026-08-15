import { useState, type ReactNode } from "react";
import { Menu, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ChatSidebar } from "./sidebar";
import { createChat } from "@/lib/workspace.functions";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () => createChat({ data: {} }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      navigate({ to: "/chat/$chatId", params: { chatId: id } });
    },
  });

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border md:block">
        <ChatSidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-20 flex items-center gap-1 border-b border-border/70 bg-background/85 px-2 py-1.5 backdrop-blur-md md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="h-10 w-10">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[86vw] max-w-80 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <ChatSidebar onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-display flex-1 truncate text-sm font-semibold tracking-tight">
            agentkit
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="New chat"
            className="h-10 w-10"
            onClick={() => create.mutate()}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </header>


        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
