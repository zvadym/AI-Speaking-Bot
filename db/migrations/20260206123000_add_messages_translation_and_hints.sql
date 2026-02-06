-- migrate:up
ALTER TABLE public.messages
  ADD COLUMN translation_ua text NOT NULL DEFAULT '',
  ADD COLUMN follow_up_hints text NOT NULL DEFAULT '[]';

-- migrate:down
ALTER TABLE public.messages
  DROP COLUMN translation_ua,
  DROP COLUMN follow_up_hints;
  
