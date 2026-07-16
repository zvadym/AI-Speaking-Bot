# TTS model and voice comparison

## Goal

Create a local listening pack that compares every compatible built-in voice of
`tts-1-hd` and `gpt-audio-1.5` in English and German. The pack is an evaluation
artifact only and does not change production bot configuration.

## Test text

- English: “Hello! Today is a beautiful day to practice speaking clearly and confidently.”
- German: “Hallo! Heute ist ein schöner Tag, um klar und selbstbewusst zu sprechen.”

The sentences have equivalent meaning, neutral tone, and enough phonetic variety
for a basic pronunciation comparison.

## Models and voices

- `tts-1-hd`: `alloy`, `ash`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`.
- `gpt-audio-1.5`: attempt every built-in audio-output voice documented by the API:
  `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`,
  `shimmer`, `verse`, `marin`, `cedar`.

Custom voices are excluded because they require customer-specific voice IDs.

## Output

Write MP3 files under `.codex/exports/tts-model-voice-comparison-20260716/`,
organized by model and language. The expected total is 44 files: 18 from
`tts-1-hd` and 26 from `gpt-audio-1.5`.

Also create:

- an HTML index with an audio player for every successful sample;
- a machine-readable manifest containing model, language, voice, source text,
  returned transcript when available, file path, and generation status;
- a short README with the test texts and directory layout.

## Generation behavior

`tts-1-hd` receives the source sentence directly through the Speech API.
`gpt-audio-1.5` receives an instruction to read the source sentence exactly,
without introductions, corrections, translations, or added commentary. Its
returned transcript is recorded and compared with the source text.

Requests use bounded retries for transient API failures. A failure for one voice
does not prevent the remaining samples from being generated; it is recorded in
the manifest.

## Verification

- Confirm that every successful output is a non-empty MP3 file.
- Inspect media metadata with `ffprobe` when available.
- Confirm that the manifest contains one record for every requested combination.
- Report unsupported voices and transcript deviations explicitly.
- Do not modify or deploy the production TTS model or bot voice settings.
