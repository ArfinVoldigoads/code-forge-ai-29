CREATE TABLE public.runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE,
  message_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  round INTEGER NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX runs_active_idx ON public.runs (status, lease_until);
CREATE INDEX runs_chat_idx ON public.runs (chat_id, created_at DESC);

GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'agentkit-run-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--37bb010f-f876-46ad-a222-44fd241e371d.lovable.app/api/public/run-tick',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_84goj0jWk2xDooD9E_jqYA_9eTPYEJw"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  );
  $$
);