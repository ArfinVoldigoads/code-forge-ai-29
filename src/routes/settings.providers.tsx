import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/workspace/status-pill";
import {
  deleteProvider,
  listProviders,
  saveProvider,
  testProvider,
} from "@/lib/settings.functions";
import { PROVIDER_TYPES, type ProviderDTO, type ProviderType } from "@/lib/types";

export const Route = createFileRoute("/settings/providers")({ component: ProvidersPage });

type Draft = {
  id?: string;
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl: string;
  orgId: string;
  enabled: boolean;
};

const emptyDraft: Draft = {
  name: "",
  type: "openai",
  apiKey: "",
  baseUrl: "",
  orgId: "",
  enabled: true,
};

function ProvidersPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const providers = useQuery({ queryKey: ["providers"], queryFn: () => listProviders() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["providers"] });

  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveProvider({
        data: {
          ...(d.id ? { id: d.id } : {}),
          name: d.name.trim(),
          type: d.type,
          apiKey: d.apiKey.trim() || null,
          baseUrl: d.baseUrl.trim() || null,
          orgId: d.orgId.trim() || null,
          enabled: d.enabled,
        },
      }),
    onSuccess: async () => {
      setDraft(null);
      await invalidate();
      toast.success("Provider saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProvider({ data: { id } }),
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success("Provider deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: (id: string) => testProvider({ data: { id } }),
    onSuccess: async (r) => {
      await invalidate();
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const needsKey = draft ? PROVIDER_TYPES.find((p) => p.value === draft.type)?.needsKey : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Connect model providers. Keys are stored server-side and never sent to the browser.
        </p>
        <Button size="sm" onClick={() => setDraft({ ...emptyDraft })}>
          <Plus className="mr-1.5 h-4 w-4" /> Add
        </Button>
      </div>

      {draft && (
        <div className="panel-surface space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={draft.type}
                onValueChange={(v) => setDraft({ ...draft, type: v as ProviderType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsKey && (
              <div className="space-y-2">
                <Label htmlFor="p-key">API key</Label>
                <Input
                  id="p-key"
                  type="password"
                  autoComplete="off"
                  placeholder={draft.id ? "Leave blank to keep current key" : ""}
                  value={draft.apiKey}
                  maxLength={400}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="p-url">Base URL (optional)</Label>
              <Input
                id="p-url"
                placeholder="https://api.example.com/v1"
                value={draft.baseUrl}
                maxLength={300}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="p-enabled"
              checked={draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />
            <Label htmlFor="p-enabled">Enabled</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate(draft)}
              disabled={save.isPending || !draft.name.trim()}
            >
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save provider
            </Button>
          </div>
        </div>
      )}

      {providers.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      <div className="space-y-2">
        {(providers.data ?? []).map((p: ProviderDTO) => (
          <div key={p.id} className="panel-surface flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{p.name}</span>
                <StatusPill status={p.status} message={p.statusMessage} />
                {!p.enabled && <span className="text-[11px] text-muted-foreground">disabled</span>}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {p.type}
                {p.keyMask ? ` · ${p.keyMask}` : ""}
                {p.baseUrl ? ` · ${p.baseUrl}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={test.isPending}
                onClick={() => test.mutate(p.id)}
              >
                <Plug className="mr-1 h-3.5 w-3.5" /> Test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    apiKey: "",
                    baseUrl: p.baseUrl ?? "",
                    orgId: p.orgId ?? "",
                    enabled: p.enabled,
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${p.name}`}
                onClick={() => remove.mutate(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
