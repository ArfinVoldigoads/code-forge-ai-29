import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getGateStatus } from "@/lib/gate.functions";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/settings/providers", label: "Providers" },
  { to: "/settings/models", label: "Models" },
  { to: "/settings/skills", label: "Skills" },
  { to: "/settings/search", label: "Search" },
  { to: "/settings/integrations", label: "Integrations" },
  { to: "/settings/e2b", label: "E2B" },

] as const;


export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ location }) => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
    if (location.pathname.replace(/\/$/, "") === "/settings") {
      throw redirect({ to: "/settings/providers" });
    }
  },
  head: () => ({
    meta: [
      { title: "Settings · agentkit workspace" },
      {
        name: "description",
        content: "Configure AI providers, models, agent skills and the E2B sandbox key.",
      },
      { property: "og:title", content: "Settings · agentkit" },
      {
        property: "og:description",
        content: "Configure AI providers, models, agent skills and sandbox access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="safe-top border-b border-border px-4 pt-3 pb-0">
        <div className="mx-auto w-full max-w-4xl">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to workspace
          </Link>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">Settings</h1>
          <nav className="scroll-thin mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "shrink-0 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
                )}
                activeProps={{ className: "border-primary text-foreground" }}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-4xl pb-10">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
