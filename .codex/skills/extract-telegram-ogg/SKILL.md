---
name: extract-telegram-ogg
description: Export the newest retrievable Telegram voice messages as OGG files for a user of this AI-Speaking-Bot repository. Use when the user asks to extract, download, collect, or archive recent Telegram voice notes or OGG files for a project bot key and Telegram username, including requests for the last X recordings; default to the latest five when no count is given.
---

# Extract Telegram OGG

Export retained inbound Telegram voice messages through the project production database and Telegram Bot API. Use the bundled script instead of reconstructing SSH, SQL, or download commands manually.

## Inputs

Identify these values from the request:

- Bot key, such as `uk-en`.
- Telegram username, with or without a leading `@`.
- Number of newest recordings. Default to `5`; allow `1` through `100`.

Ask for a missing bot key or username. Do not ask for a limit when it is omitted.

## Run the export

From the repository root, run:

```bash
node .codex/skills/extract-telegram-ogg/scripts/export-telegram-ogg.mjs \
  --bot-key <bot-key> \
  --username <username> \
  --limit <count>
```

Use `--dry-run` only when the user asks to inspect availability without downloading or when diagnosing the exporter:

```bash
node .codex/skills/extract-telegram-ogg/scripts/export-telegram-ogg.mjs \
  --bot-key <bot-key> \
  --username <username> \
  --limit <count> \
  --dry-run
```

The script reads production data without modifying it, downloads through the token in `deploy/bots/<bot-key>.json`, validates each Ogg container, and creates a timestamped directory, `manifest.json`, and ZIP under `.codex/exports/`.

## Report the result

Report:

- The exact number of exported files.
- The requested count and any shortfall.
- Clickable absolute links to the ZIP and manifest.
- The historical inbound voice count when it exceeds the number retained with downloadable `file_id` values.

Explain that Telegram Bot API cannot read arbitrary chat history and this exporter can only retrieve voice jobs still retained by `pg-boss`. Do not claim that usage rows without `file_id` values are downloadable.

## Safety

- Never print or return bot tokens, `DATABASE_URL`, or Telegram `file_id` values.
- Never modify production tables or queue rows.
- Keep generated exports inside the gitignored `.codex/exports/` directory.
- Stop on SSH, database, Telegram, Ogg validation, or archive errors; do not present an incomplete ZIP as successful.
