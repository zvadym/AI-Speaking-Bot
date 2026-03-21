-- migrate:up
ALTER TABLE public.idiom_phrase_translations
  ADD COLUMN source_signature text NOT NULL DEFAULT '';

CREATE INDEX idx_idiom_phrase_translations_phrase_id_base_language_signature
  ON public.idiom_phrase_translations (phrase_id, base_language, source_signature);

-- migrate:down
DROP INDEX IF EXISTS public.idx_idiom_phrase_translations_phrase_id_base_language_signature;

ALTER TABLE public.idiom_phrase_translations
  DROP COLUMN IF EXISTS source_signature;
