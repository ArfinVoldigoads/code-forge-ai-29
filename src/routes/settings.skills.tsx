import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { listSkills, updateSkill } from "@/lib/settings.functions";
import type { SkillDTO } from "@/lib/types";

export const Route = createFileRoute("/settings/skills")({ component: SkillsPage });

function SkillsPage() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => listSkills() });

  const update = useMutation({
    mutationFn: (input: { id: string; enabled?: boolean; instructions?: string }) =>
      updateSkill({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success("Skill updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enabled skills are appended to the agent's system prompt for every message.
      </p>

      {skills.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {(skills.data ?? []).map((s: SkillDTO) => {
        const value = drafts[s.id] ?? s.instructions;
        const dirty = value.trim() !== s.instructions.trim();
        return (
          <div key={s.id} className="panel-surface space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-medium">{s.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{s.slug}</p>
              </div>
              <Switch
                checked={s.enabled}
                aria-label={`Enable ${s.name}`}
                onCheckedChange={(enabled) => update.mutate({ id: s.id, enabled })}
              />
            </div>
            <Textarea
              value={value}
              maxLength={8000}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })}
              className="min-h-28 text-sm"
              aria-label={`${s.name} instructions`}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!dirty || update.isPending}
                onClick={() => update.mutate({ id: s.id, instructions: value.trim() })}
              >
                Save instructions
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
