create table if not exists public.ask_user_answers (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  ask_id text not null,
  answers jsonb not null default '[]'::jsonb,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chat_id, ask_id)
);

grant all on public.ask_user_answers to service_role;
alter table public.ask_user_answers enable row level security;