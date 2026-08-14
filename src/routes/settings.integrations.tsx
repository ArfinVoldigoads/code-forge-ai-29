import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteIntegration,
  listIntegrations,
  saveIntegration,
  testIntegration,
  type IntegrationDTO,
} from "@/lib/integrations.functions";

export const Route = createFileRoute("/settings/integrations")({ component: IntegrationsPage });

type Kind = IntegrationDTO["kind"];

const META: Record<
  Kind,
  { title: string; blurb: string; tokenLabel: string; extraLabel?: string; extraHint?: string }
> = {
  github: {
    title: "GitHub",
    blurb:
      "Personal Access Token with repo (and workflow) scope. The agent uses it to create repos and push code without asking which account.",
    tokenLabel: "Personal Access Token",
  },
  vercel: {
    title: "Vercel",
    blurb: "Access token from vercel.com/account/tokens. Used to link projects and deploy.",
    tokenLabel: "Access Token",
    extraLabel: "Team / Scope ID (optional)",
    extraHint: "team_xxx — leave empty for a personal account.",
  },
  cloudflare: {
    title: "Cloudflare",
    blurb:
      "API Token: dash.cloudflare.com → My Profile → API Tokens → Create Token → template \"Edit Cloudflare Workers\" (permissions: Account · Workers Scripts · Edit, and Account · Account Settings · Read). Account ID: lihat URL dashboard kamu — bagian setelah dash.cloudflare.com/, contoh https://dash.cloudflare.com/8f1c…/workers. Copy 32 karakter hex itu. Global API Key tidak bisa dipakai.",
    tokenLabel: "API Token",
    extraLabel: "Account ID",
    extraHint: "dari URL: dash.cloudflare.com/<INI>/workers",
  },
};

function IntegrationsPage() {
  const list = useQuery({ queryKey: ["integrations"], queryFn: () => listIntegrations() });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect the accounts the agent should use. Tokens are stored server-side and injected into
        sandbox commands as environment variables — they are never shown back to the UI or printed
        into logs.
      </p>
      {list.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        (list.data ?? []).map((item) => <IntegrationCard key={item.kind} item={item} />)
      )}
    </div>
  );
}

function IntegrationCard({ item }: { item: IntegrationDTO }) {
  const meta = META[item.kind];
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [extra, setExtra] = useState(item.extra ?? "");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["integrations"] });

  const save = useMutation({
    mutationFn: () =>
      saveIntegration({
        data: { kind: item.kind, token: token.trim() || null, extra: extra.trim() },
      }),
    onSuccess: async () => {
      setToken("");
      await invalidate();
      toast.success(`${meta.title} saved`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testIntegration({ data: { kind: item.kind } }),
    onSuccess: async (r) => {
      await invalidate();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteIntegration({ data: { kind: item.kind } }),
    onSuccess: async () => {
      setExtra("");
      await invalidate();
      toast.success(`${meta.title} disconnected`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="panel-surface space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{meta.title}</h2>
        {item.status === "connected" ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> connected
            {item.account ? ` · ${item.account}` : ""}
          </span>
        ) : item.status === "error" ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5" /> error
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">untested</span>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {item.hasToken ? item.tokenMask : "no token"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">{meta.blurb}</p>
      {item.statusMessage ? (
        <p className="text-xs text-muted-foreground">{item.statusMessage}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${item.kind}-token`}>{meta.tokenLabel}</Label>
          <Input
            id={`${item.kind}-token`}
            type="password"
            autoComplete="off"
            placeholder={item.hasToken ? "leave empty to keep current" : "paste token"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        {meta.extraLabel ? (
          <div className="space-y-2">
            <Label htmlFor={`${item.kind}-extra`}>{meta.extraLabel}</Label>
            <Input
              id={`${item.kind}-extra`}
              autoComplete="off"
              placeholder={meta.extraHint ?? ""}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => test.mutate()}
          disabled={test.isPending || !item.hasToken}
        >
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test connection"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => remove.mutate()}
          disabled={remove.isPending || !item.hasToken}
        >
          <Trash2 className="h-4 w-4" /> Disconnect
        </Button>
      </div>
    </div>
  );
}
