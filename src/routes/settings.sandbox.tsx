import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/workspace/status-pill";
import {
  deleteSandboxKey,
  getSandboxSettings,
  saveSandboxSettings,
  testSandbox,
} from "@/lib/settings.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/sandbox")({ component: SandboxSettingsPage });

const SNAPSHOTS = [
  { id: "daytona-small", label: "Small", detail: "1 vCPU · 1 GiB RAM · 3 GiB disk" },
  { id: "daytona-medium", label: "Medium", detail: "2 vCPU · 4 GiB RAM · 8 GiB disk" },
  { id: "daytona-large", label: "Large", detail: "4 vCPU · 8 GiB RAM · 10 GiB disk" },
  { id: "daytona-vm-large", label: "Linux VM", detail: "4 vCPU · 8 GiB RAM · full VM" },
  { id: "windows-medium", label: "Windows", detail: "2 vCPU · 8 GiB RAM · 50 GiB disk" },
] as const;

function SandboxSettingsPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [snapshot, setSnapshot] = useState("daytona-large");
  const settings = useQuery({ queryKey: ["sandbox-settings"], queryFn: () => getSandboxSettings() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sandbox-settings"] });

  useEffect(() => {
    if (settings.data?.snapshot) setSnapshot(settings.data.snapshot);
  }, [settings.data?.snapshot]);

  const save = useMutation({
    mutationFn: () =>
      saveSandboxSettings({
        data: { apiKey: apiKey.trim() || null, snapshot, apiUrl: null, target: null },
      }),
    onSuccess: async () => {
      setApiKey("");
      await invalidate();
      toast.success("Sandbox settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testSandbox(),
    onSuccess: async (r) => {
      await invalidate();
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteSandboxKey(),
    onSuccess: async () => {
      await invalidate();
      toast.success("Daytona key removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Code execution runs on Daytona sandboxes: configurable CPU/RAM, public HTTPS previews and a
        VNC desktop. The agent can resize, restart and unblock the network of its own sandbox.
      </p>

      <div className="panel-surface space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Current key</span>
          <span className="font-mono text-xs text-muted-foreground">
            {settings.data?.hasKey ? settings.data.keyMask : "not set"}
          </span>
          {settings.data && (
            <StatusPill status={settings.data.status} message={settings.data.statusMessage} />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="daytona-key">API key</Label>
          <Input
            id="daytona-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            maxLength={400}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="dtn_..."
          />
          <p className="text-xs text-muted-foreground">
            Create one at app.daytona.io → Keys. Stored server-side and only shown masked.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Default sandbox size</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {SNAPSHOTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSnapshot(s.id)}
                className={cn(
                  "rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/60",
                  snapshot === s.id && "border-primary bg-primary/10",
                )}
              >
                <span className="font-medium">{s.label}</span>
                <span className="block font-mono text-xs text-muted-foreground">{s.detail}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            New chats start with this size; the agent can resize its own sandbox up to 8 vCPU /
            16 GiB when a build needs more.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || (!settings.data?.hasKey && apiKey.trim().length < 8)}
          >
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
          <Button
            variant="secondary"
            onClick={() => test.mutate()}
            disabled={test.isPending || !settings.data?.hasKey}
          >
            <Plug className="mr-1.5 h-4 w-4" /> Test connection
          </Button>
          <Button
            variant="ghost"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || !settings.data?.hasKey}
          >
            <Trash2 className="mr-1.5 h-4 w-4 text-destructive" /> Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
