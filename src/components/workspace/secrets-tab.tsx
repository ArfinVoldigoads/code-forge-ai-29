import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteSecret, listSecrets, saveSecret } from "@/lib/secrets.functions";

export function SecretsTab({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const secrets = useQuery({
    queryKey: ["secrets", chatId],
    queryFn: () => listSecrets({ data: { chatId } }),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["secrets", chatId] });

  const save = useMutation({
    mutationFn: () => saveSecret({ data: { chatId, name: name.trim(), value: value.trim() } }),
    onSuccess: async () => {
      setName("");
      setValue("");
      await invalidate();
      toast.success("Secret saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (secretName: string) => deleteSecret({ data: { chatId, name: secretName } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Secret removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = secrets.data ?? [];

  return (
    <div className="scroll-thin flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <p className="text-xs text-muted-foreground">
        Env values for this task. They are injected into every sandbox command and mirrored to{" "}
        <code>.env</code>. The agent can read the names, never the values.
      </p>

      <div className="space-y-2">
        <Input
          placeholder="NAME (e.g. OPENAI_API_KEY)"
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          className="font-mono text-xs"
        />
        <Input
          type="password"
          autoComplete="off"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono text-xs"
        />
        <Button
          size="sm"
          className="w-full"
          disabled={save.isPending || !name.trim() || !value.trim()}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
          )}
          Add secret
        </Button>
      </div>

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No secrets for this task yet.</p>
        )}
        {rows.map((secret) => (
          <div
            key={secret.id}
            className="panel-surface flex items-center gap-2 rounded-md px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs">{secret.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {secret.status === "pending" ? "requested by the agent" : (secret.mask ?? "set")}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Remove ${secret.name}`}
              onClick={() => remove.mutate(secret.name)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
