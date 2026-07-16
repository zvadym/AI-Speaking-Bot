# Global `tts-1-hd` and Fable switch

## Goal

Move every production Telegram bot from `gpt-4o-mini-tts` with Nova to
`tts-1-hd` with Fable for agent voice replies.

## Decision

The alternatives evaluated were:

1. Keep deprecated `gpt-4o-mini-tts` and Nova. Rejected because the model is not
   suitable for a new long-term default.
2. Use `gpt-audio-1.5`. Rejected because the comparison pack showed six
   non-verbatim responses out of 26 and a materially higher measured cost.
3. Use `tts-1-hd` with Fable. Selected because it is a dedicated, non-deprecated
   speech model, reads prepared agent text directly, and Fable was selected after
   listening to the comparison pack.

## Configuration changes

- Change the API environment fallback for `BOT_TTS_MODEL` to `tts-1-hd`.
- Change the bot runtime factory fallback to `tts-1-hd` so direct construction
  cannot silently restore the deprecated model.
- Set `bot_voice` to `Fable` in all 15 files under `deploy/bots/`.
- Update the production server's preserved `deploy/.env.api` value to
  `BOT_TTS_MODEL=tts-1-hd`; the secret-bearing environment file remains
  uncommitted.

No transcription, agent reasoning, prompt, language-pair, billing, or Telegram
presentation behavior changes.

## Verification and rollout

- Validate that all bot JSON files parse and that every `bot_voice` is `Fable`.
- Verify both source-code TTS fallbacks resolve to `tts-1-hd`.
- Run the API test suite.
- Commit and push the source changes, deploy the production stack, then verify
  the running API and worker containers see `BOT_TTS_MODEL=tts-1-hd` and load
  Fable for all 15 bot configs.
- Check API health after deployment.

The existing browser comparison page is an evaluation artifact and remains
unchanged.
