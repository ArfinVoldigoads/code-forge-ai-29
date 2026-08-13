import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug, Plus, Star, Trash2 } from "lucide-react";
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
  deleteModel,
  listModels,
  listProviders,
  saveModel,
  testModel,
} from "@/lib/settings.functions";
import type { ModelDTO } from "@/lib/types";

export const Route = createFileRoute("/settings/models")({ component: ModelsPage });

type Draft = {
  id?: string;
  providerId: string;
  displayName: string;
  modelId: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  vision: boolean;
};

function ModelsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const models = useQuery({ queryKey: ["models"], queryFn: () => listModels() });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => listProviders() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["models"] });

  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveModel({
        data: {
          ...(d.id ? { id: d.id } : {}),
          providerId: d.providerId,
          displayName: d.displayName.trim(),
          modelId: d.modelId.trim(),
          description: d.description.trim() || null,
          vision: d.vision,
          enabled: d.enabled,
          isDefault: d.isDefault,
          sortOrder: 0,
        },
      }),
    onSuccess: async () => {
      setDraft(null);
      await invalidate();
      toast.success("Model saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteModel({ data: { id } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Model deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: (id: string) => testModel({ data: { id } }),
    onSuccess: async (r) => {
      await invalidate();
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const providerOptions = (providers.data ?? []).filter((p) => p.enabled);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Models available in the composer. Mark one as default for new chats.
        </p>
        <Button
          size="sm"
          disabled={providerOptions.length === 0}
          onClick={() =>
            setDraft({
              providerId: providerOptions[0]?.id ?? "",
              displayName: "",
              modelId: "",
              description: "",
              enabled: true,
              isDefault: false,
              vision: false,
            })
          }
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add
        </Button>
      </div>

      {draft && (
        <div className="panel-surface space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={draft.providerId}
                onValueChange={(v) => setDraft({ ...draft, providerId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-name">Display name</Label>
              <Input
                id="m-name"
                value={draft.displayName}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-id">Model id</Label>
              <Input
                id="m-id"
                placeholder="google/gemini-3.5-flash"
                className="font-mono text-xs"
                value={draft.modelId}
                maxLength={160}
                onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-desc">Description (optional)</Label>
              <Input
                id="m-desc"
                value={draft.description}
                maxLength={400}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-5">
            <div className="flex items-center gap-2">
              <Switch
                id="m-enabled"
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
              />
              <Label htmlFor="m-enabled">Enabled</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="m-default"
                checked={draft.isDefault}
                onCheckedChange={(v) => setDraft({ ...draft, isDefault: v })}
              />
              <Label htmlFor="m-default">Default</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="m-vision"
                checked={draft.vision}
                onCheckedChange={(v) => setDraft({ ...draft, vision: v })}
              />
              <Label htmlFor="m-vision">Vision</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate(draft)}
              disabled={
                save.isPending ||
                !draft.providerId ||
                !draft.displayName.trim() ||
                !draft.modelId.trim()
              }
            >
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save model
            </Button>
          </div>
        </div>
      )}

      {models.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      <div className="space-y-2">
        {(models.data ?? []).map((m: ModelDTO) => (
          <div key={m.id} className="panel-surface flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{m.displayName}</span>
                {m.isDefault && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                <StatusPill status={m.status} message={m.statusMessage} />
                {!m.enabled && <span className="text-[11px] text-muted-foreground">disabled</span>}
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {m.modelId}
                {m.providerName ? ` · ${m.providerName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={test.isPending}
                onClick={() => test.mutate(m.id)}
              >
                <Plug className="mr-1 h-3.5 w-3.5" /> Test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    id: m.id,
                    providerId: m.providerId ?? "",
                    displayName: m.displayName,
                    modelId: m.modelId,
                    description: m.description ?? "",
                    enabled: m.enabled,
                    isDefault: m.isDefault,
                    vision: m.vision,
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${m.displayName}`}
                onClick={() => remove.mutate(m.id)}
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
