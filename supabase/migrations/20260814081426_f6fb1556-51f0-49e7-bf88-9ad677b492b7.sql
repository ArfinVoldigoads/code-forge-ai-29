ALTER TABLE public.providers ALTER COLUMN type DROP NOT NULL;
ALTER TABLE public.providers ALTER COLUMN type SET DEFAULT 'openai-compatible';
UPDATE public.providers SET type = 'openai-compatible' WHERE type IS NULL;