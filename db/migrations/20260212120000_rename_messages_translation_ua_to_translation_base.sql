-- migrate:up
ALTER TABLE public.messages
  RENAME COLUMN translation_ua TO translation_base;

-- migrate:down
ALTER TABLE public.messages
  RENAME COLUMN translation_base TO translation_ua;

