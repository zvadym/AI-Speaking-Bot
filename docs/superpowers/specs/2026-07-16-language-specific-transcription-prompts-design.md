# Language-specific transcription prompts

## Goal

Make Telegram voice-message transcription more verbatim without changing the
transcription model or the surrounding voice pipeline. The transcript should
retain filler sounds, repetitions, stutters, partial words, self-corrections,
false starts, and learner errors instead of silently polishing the speech.

## Scope

This change applies to every configured bot and to both transcription paths:

- conversation voice messages, transcribed in the bot's learning language;
- voice feedback, transcribed in the bot's base language.

The OpenAI transcription model, response format, language parameter, telemetry,
delivery flow, and downstream conversation behavior remain unchanged.

## Prompt files

Transcription prompts live separately from application code under:

```text
deploy/prompts/transcription/
├── en.md
├── ar.md
├── de.md
├── es.md
├── hi.md
├── it.md
├── pl.md
├── tr.md
└── uk.md
```

`en.md` is required and is the fallback for any language without a dedicated
file. A missing language-specific file is therefore valid. A missing or empty
English fallback is a startup/runtime configuration error and must not silently
fall back to a hardcoded prompt.

Prompts are selected by the language of the audio, not by `bot_key`. This lets
the same language prompt serve multiple bot pairs and correctly handles the
different languages used by conversation messages and voice feedback.

## Prompt requirements

Each language-specific prompt is written in that language and instructs the
model to:

- transcribe only what is audibly spoken;
- preserve filler sounds and hesitation markers;
- preserve repetitions, stutters, elongated utterances, partial words,
  self-corrections, and false starts;
- preserve grammar, vocabulary, and pronunciation-driven learner errors;
- avoid correcting, completing, paraphrasing, summarizing, or improving speech;
- mark unintelligible audio with a language-appropriate bracketed marker;
- return only the transcript;
- follow a short language-appropriate example demonstrating verbatim output.

The files contain plain prompt text and do not require template placeholders.

## Runtime design

The bot AI client resolves the transcription language exactly as it does now:
the learning language for conversation audio and the base language for feedback
audio. A small prompt loader then:

1. normalizes the language code to lowercase;
2. attempts to load `deploy/prompts/transcription/<language>.md`;
3. loads `deploy/prompts/transcription/en.md` when the language file is absent;
4. uses the existing in-process prompt cache for the resolved filename;
5. passes the loaded text as the Audio API `prompt` value.

Prompt-directory discovery continues to use `BOT_RUNTIME_PROMPTS_DIR`, the
container path, and the repository-local path in the existing priority order.

## Error handling

An absent language-specific prompt uses the English fallback. File read errors
other than absence, or a missing/empty English fallback, fail the transcription
call with a descriptive prompt-loading error. No embedded English prompt is
kept in source code because prompt files are the sole source of truth.

## Tests

Unit tests cover:

- selection of the learning-language prompt for conversation transcription;
- selection of the base-language prompt for feedback transcription;
- fallback to `en.md` when a language-specific file is absent;
- preservation of the existing model, language, response format, and telemetry
  parameters in the OpenAI request;
- a readable failure when the required English fallback cannot be loaded.

The normal API test suite is the verification gate. No live OpenAI request is
required for deterministic tests. Real voice samples should be compared before
and after deployment to measure filler/repetition retention, since prompt
instructions improve but cannot guarantee phoneme-level fidelity.

