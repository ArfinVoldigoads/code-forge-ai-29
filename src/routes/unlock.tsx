import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Lock, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unlockWorkspace } from "@/lib/gate.functions";

export const Route = createFileRoute("/unlock")({
  head: () => ({
    meta: [
      { title: "Unlock · agentkit AI coding workspace" },
      {
        name: "description",
        content: "Enter the workspace password to open your AI coding agent workspace.",
      },
      { property: "og:title", content: "Unlock · agentkit" },
      { property: "og:description", content: "Password-protected AI coding agent workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UnlockPage,
});

function UnlockPage() {
  const router = useRouter();
  const unlock = useServerFn(unlockWorkspace);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await unlock({ data: { password } });
      if (result.ok) {
        await router.navigate({ to: "/" });
      } else {
        setError("Incorrect password.");
      }
    } catch {
      setError("Could not verify the password. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="panel-surface w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" />
          <h1 className="font-mono text-lg font-semibold tracking-tight">agentkit</h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          This AI coding workspace is private. Enter the password to continue.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending || !password}>
            <Lock className="mr-2 h-4 w-4" />
            {pending ? "Checking…" : "Unlock workspace"}
          </Button>
        </form>
      </div>
    </div>
  );
}
