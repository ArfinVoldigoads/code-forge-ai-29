
-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- ============ app_settings (singleton key/value, server-only) ============
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER app_settings_updated BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ providers ============
CREATE TABLE public.providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  api_key TEXT,
  base_url TEXT,
  org_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'untested',
  status_message TEXT,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER providers_updated BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ models ============
CREATE TABLE public.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  description TEXT,
  context_window INTEGER,
  vision BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'untested',
  status_message TEXT,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.models TO service_role;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
CREATE INDEX models_provider_idx ON public.models(provider_id);
CREATE UNIQUE INDEX models_one_default_idx ON public.models((is_default)) WHERE is_default;
CREATE TRIGGER models_updated BEFORE UPDATE ON public.models FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ agent_skills ============
CREATE TABLE public.agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_skills TO service_role;
ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER agent_skills_updated BEFORE UPDATE ON public.agent_skills FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ chats ============
CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'New chat',
  pinned BOOLEAN NOT NULL DEFAULT false,
  model_id UUID REFERENCES public.models(id) ON DELETE SET NULL,
  sandbox_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.chats TO service_role;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE INDEX chats_updated_idx ON public.chats(pinned DESC, updated_at DESC);
CREATE TRIGGER chats_updated BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ messages ============
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  planning TEXT,
  thinking TEXT,
  model_ref TEXT,
  request_id TEXT,
  error TEXT,
  status TEXT NOT NULL DEFAULT 'complete',
  revision INTEGER NOT NULL DEFAULT 1,
  seq BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX messages_chat_idx ON public.messages(chat_id, seq);
CREATE UNIQUE INDEX messages_request_idx ON public.messages(request_id) WHERE request_id IS NOT NULL;
CREATE TRIGGER messages_updated BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ message_revisions ============
CREATE TABLE public.message_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.message_revisions TO service_role;
ALTER TABLE public.message_revisions ENABLE ROW LEVEL SECURITY;
CREATE INDEX message_revisions_msg_idx ON public.message_revisions(message_id, revision);

-- ============ message_attachments ============
CREATE TABLE public.message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.message_attachments TO service_role;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX attachments_chat_idx ON public.message_attachments(chat_id);
CREATE INDEX attachments_message_idx ON public.message_attachments(message_id);

-- ============ sandbox_sessions ============
CREATE TABLE public.sandbox_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL,
  template TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.sandbox_sessions TO service_role;
ALTER TABLE public.sandbox_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX sandbox_sessions_chat_idx ON public.sandbox_sessions(chat_id);

-- ============ sandbox_files ============
CREATE TABLE public.sandbox_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_session_id UUID NOT NULL REFERENCES public.sandbox_sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  action TEXT NOT NULL,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.sandbox_files TO service_role;
ALTER TABLE public.sandbox_files ENABLE ROW LEVEL SECURITY;
CREATE INDEX sandbox_files_session_idx ON public.sandbox_files(sandbox_session_id);

-- ============ tool_executions ============
CREATE TABLE public.tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.tool_executions TO service_role;
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;
CREATE INDEX tool_exec_chat_idx ON public.tool_executions(chat_id);

-- ============ command_outputs ============
CREATE TABLE public.command_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_execution_id UUID REFERENCES public.tool_executions(id) ON DELETE CASCADE,
  sandbox_session_id UUID REFERENCES public.sandbox_sessions(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.command_outputs TO service_role;
ALTER TABLE public.command_outputs ENABLE ROW LEVEL SECURITY;
CREATE INDEX command_outputs_exec_idx ON public.command_outputs(tool_execution_id);

-- ============ audit_logs ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX audit_logs_created_idx ON public.audit_logs(created_at DESC);

-- ============ seed agent skills ============
INSERT INTO public.agent_skills (slug, name, instructions, sort_order) VALUES
('frontend-ui','Frontend UI','Use semantic HTML, mobile-first responsive layouts, accessible components (labels, roles, focus states, contrast), and design tokens instead of ad-hoc styles. Verify the result in a browser at both desktop and 360x520 mobile viewports before declaring the work done.',1),
('debugging','Debugging','Reproduce the issue first, inspect logs and runtime state, isolate the failing layer, identify the root cause rather than the symptom, implement a targeted fix, then rerun the exact reproduction to verify.',2),
('testing','Testing','Cover the happy path, edge cases, invalid input, error handling, mobile layout behavior, and interactive states. Prefer executable checks over assertions in prose, and report actual command output.',3),
('api-integration','API Integration','Validate all inputs with a schema, keep secrets server-side, use parameterized queries, set explicit timeouts and bounded retries with backoff, and return actionable error messages that never leak credentials.',4),
('web-research','Web Research','Prefer current official documentation over memory, cite the source URL, respect robots.txt and terms of service, rate-limit requests, and never bypass authentication or access controls.',5),
('code-review','Code Review','Review for security, authorization and data scoping, injection risks, performance hot spots, error handling, and long-term maintainability. Call out concrete file and line level issues with suggested fixes.',6);

-- ============ default settings rows ============
INSERT INTO public.app_settings (key, value) VALUES
('e2b', '{"apiKey": null, "status": "untested", "statusMessage": null, "lastTestedAt": null}'::jsonb);
