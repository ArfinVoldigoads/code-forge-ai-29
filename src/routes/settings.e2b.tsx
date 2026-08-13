import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/workspace/status-pill";
import { deleteE2BKey, getE2BSettings, saveE2BKey, testE2B } from "@/lib/settings.functions";

export const Route = createFileRoute("/settings/e2b")({ component: E2BPage });

function E2BPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const settings = useQuery({ queryKey: ["e2b"], queryFn: () => getE2BSettings() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["e2b"] });

  const save = useMutation({
    mutationFn: () => saveE2BKey({ data: { apiKey: apiKey.trim() } }),
    onSuccess: async () => {
      setApiKey("");
      await invalidate();
      toast.success("E2B key saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testE2B(),
    onSuccess: async (r) => {
      await invalidate();
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteE2BKey(),
    onSuccess: async () => {
      await invalidate();
      toast.success("E2B key removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The E2B API key powers sandboxed code execution. It is stored server-side and only ever
        shown masked.
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
          <Label htmlFor="e2b-key">New API key</Label>
          <Input
            id="e2b-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            maxLength={300}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="e2b_..."
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || apiKey.trim().length < 8}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save key
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
