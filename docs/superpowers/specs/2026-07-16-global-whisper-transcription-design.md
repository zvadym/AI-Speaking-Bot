# Global Whisper transcription model

## Goal

Permanently switch every Telegram bot from `gpt-4o-transcribe` to `whisper-1`
for speech-to-text. The representative English voice-message comparison showed
that `whisper-1` with the existing language-specific verbatim prompt retained a
filler and repetition that `gpt-4o-transcribe` removed.

## Scope

The change applies globally to conversation voice messages and voice feedback
for all configured bots. It changes only the transcription model. Prompt-file
selection, language selection, response format, telemetry, delivery, and the
downstream conversation pipeline remain unchanged.

## Configuration

`whisper-1` becomes the default in both runtime layers:

- API environment parsing in `apps/api/src/env.js`;
- the bot AI client default in `apps/api/src/bot-runtime/bot-ai.ts`.

`deploy/.env.api.example` also uses `BOT_TRANSCRIPTION_MODEL=whisper-1`, so new
environments inherit the intended model. The production `deploy/.env.api` is
updated to the same value without committing that secret-bearing file.

The global environment variable remains supported. Setting
`BOT_TRANSCRIPTION_MODEL=gpt-4o-transcribe` continues to provide an immediate
rollback path without a source change.

## Deployment

The source changes are tested, committed, and pushed to `main`. Production is
then deployed through `scripts/deploy-remote.sh`, which preserves the server's
environment files while updating source and rebuilding the API and worker.
Because the environment value is stored only on the server, it must be changed
before the deploy so the recreated containers start with `whisper-1`.

## Verification

Automated verification covers:

- a unit assertion that the bot AI client uses `whisper-1` when no explicit
  transcription model is supplied;
- TypeScript typechecking;
- the API production build;
- the complete API test suite.

Post-deploy verification covers:

- the production environment resolves `BOT_TRANSCRIPTION_MODEL=whisper-1`;
- API and worker containers are running;
- API and mini-app HTTP health checks pass;
- all Telegram webhooks report no pending updates or recent errors;
- one representative `uk-en` voice message is transcribed through the new
  model during manual product verification.

## Trade-off

The tested sample showed better disfluency retention from `whisper-1`, but the
model still normalized at least one grammar error. This switch prioritizes
fillers and repetitions over the lower general word-error rate offered by
`gpt-4o-transcribe`; it does not promise phoneme-level or perfectly verbatim
transcription.
