import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/shell";
import { ChatView } from "@/components/workspace/chat-view";
import { SandboxPanel } from "@/components/workspace/sandbox-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { getGateStatus } from "@/lib/gate.functions";


export const Route = createFileRoute("/chat/$chatId")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  head: () => ({
    meta: [
      { title: "Chat · agentkit AI coding workspace" },
      {
        name: "description",
        content: "Streamed planning, reasoning and code output from your AI coding agent.",
      },
      { property: "og:title", content: "Chat · agentkit" },
      { property: "og:description", content: "Streamed planning and code output from the agent." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPage,
});

function useIsWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setWide(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function ChatPage() {
  const { chatId } = Route.useParams();
  const [showPanel, setShowPanel] = useState(false);
  const wide = useIsWide();

  useEffect(() => {
    if (wide) setShowPanel(true);
  }, [wide]);

  return (
    <WorkspaceShell>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatView key={chatId} chatId={chatId} />
        </div>

        <Button
          variant="outline"
          size="icon"
          aria-label={showPanel ? "Hide sandbox panel" : "Show sandbox panel"}
          className="absolute right-3 top-3 z-10 h-8 w-8"
          onClick={() => setShowPanel((v) => !v)}
        >
          {showPanel ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>

        {wide && showPanel && (
          <aside className="flex w-[26rem] shrink-0 flex-col border-l border-border">
            <SandboxPanel chatId={chatId} />
          </aside>
        )}

        {!wide && (
          <Sheet open={showPanel} onOpenChange={setShowPanel}>
            <SheetContent side="right" className="flex w-full max-w-full flex-col p-0">
              <SheetTitle className="sr-only">Sandbox</SheetTitle>
              <SandboxPanel chatId={chatId} />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </WorkspaceShell>
  );
}
