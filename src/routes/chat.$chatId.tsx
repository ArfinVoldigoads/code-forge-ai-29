import { createFileRoute, redirect } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/workspace/shell";
import { ChatView } from "@/components/workspace/chat-view";
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

function ChatPage() {
  const { chatId } = Route.useParams();
  return (
    <WorkspaceShell>
      <ChatView key={chatId} chatId={chatId} />
    </WorkspaceShell>
  );
}
