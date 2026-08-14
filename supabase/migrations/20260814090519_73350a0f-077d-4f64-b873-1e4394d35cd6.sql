ALTER TABLE public.command_outputs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';
ALTER TABLE public.command_outputs ADD COLUMN IF NOT EXISTS chat_id uuid;
ALTER TABLE public.command_outputs ADD COLUMN IF NOT EXISTS duration_ms integer;
CREATE INDEX IF NOT EXISTS command_outputs_chat_created_idx ON public.command_outputs (chat_id, created_at);