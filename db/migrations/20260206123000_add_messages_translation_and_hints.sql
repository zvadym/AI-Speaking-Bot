-- migrate:up
ALTER TABLE public.messages
  ADD COLUMN translation_ua text NOT NULL DEFAULT '',
  ADD COLUMN follow_up_hints text NOT NULL DEFAULT '[]';

