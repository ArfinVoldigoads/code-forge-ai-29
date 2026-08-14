CREATE TABLE IF NOT EXISTS public.project_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  value text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, name)
);

GRANT ALL ON public.project_secrets TO service_role;
ALTER TABLE public.project_secrets ENABLE ROW LEVEL SECURITY;