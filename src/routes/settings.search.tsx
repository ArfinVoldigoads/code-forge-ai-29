import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteSearchKey, getSearchSettings, saveSearchSettings } from "@/lib/search.functions";

export const Route = createFileRoute("/settings/search")({ component: SearchPage });

type Provider = "tavily" | "brave" | "serper";

const HINT: Record<Provider, string> = {
  tavily: "Tavily — AI-optimised search. Key looks like tvly-…",
  brave: "Brave Search API — subscription token from the Brave developer dashboard.",
  serper: "Serper.dev — Google results. Key from serper.dev dashboard.",
};

function SearchPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<Provider | null>(null);

  const settings = useQuery({ queryKey: ["search-settings"], queryFn: () => getSearchSettings() });
  const active: Provider = provider ?? settings.data?.provider ?? "tavily";
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["search-settings"] });

  const save = useMutation({
    mutationFn: () =>
      saveSearchSettings({ data: { provider: active, apiKey: apiKey.trim() || null } }),
    onSuccess: async () => {
      setApiKey("");
      await invalidate();
      toast.success("Search settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteSearchKey(),
    onSuccess: async () => {
      await invalidate();
      toast.success("Search key removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Give the agent web access. With a key set, it can use <code>web_search</code> and{" "}
        <code>fetch_url</code> to research docs and error messages before writing code.
      </p>

      <div className="panel-surface space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Current key</span>
          <span className="font-mono text-xs text-muted-foreground">
            {settings.data?.hasKey ? settings.data.keyMask : "not set"}
          </span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="search-provider">Provider</Label>
          <Select value={active} onValueChange={(v) => setProvider(v as Provider)}>
            <SelectTrigger id="search-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tavily">Tavily</SelectItem>
              <SelectItem value="brave">Brave Search</SelectItem>
              <SelectItem value="serper">Serper (Google)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{HINT[active]}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="search-key">API key</Label>
          <Input
            id="search-key"
            type="password"
            autoComplete="off"
            maxLength={300}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.data?.hasKey ? "leave blank to keep current key" : "paste key"}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || !settings.data?.hasKey}
          >
            <Trash2 className="mr-1.5 h-4 w-4 text-destructive" /> Remove key
          </Button>
        </div>
      </div>
    </div>
  );
}
