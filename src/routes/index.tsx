import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceShell } from "@/components/workspace/shell";
import { createChat } from "@/lib/workspace.functions";
import { getGateStatus } from "@/lib/gate.functions";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  head: () => ({
    meta: [
      { title: "agentkit · AI coding agent workspace" },
      {
        name: "description",
        content:
          "A private AI coding workspace with streamed planning, model management and sandboxed execution.",
      },
      { property: "og:title", content: "agentkit · AI coding agent workspace" },
      {
        property: "og:description",
        content: "Streamed planning, model management and sandboxed execution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
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
    <WorkspaceShell>
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-3xl border border-border/60 bg-panel/40 p-8">
          <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background">
            <Terminal className="h-5 w-5" />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">AI coding workspace</h1>
          <p className="mt-3 mb-6 text-sm leading-relaxed text-muted-foreground">
            Start a chat and the agent will plan its approach live — assumptions, options,
            tradeoffs, then implementation — before it answers.
          </p>
          <Button
            className="h-10 rounded-lg"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            <Plus className="mr-2 h-4 w-4" /> New chat
          </Button>
        </div>
      </div>
    </WorkspaceShell>
  );
}

