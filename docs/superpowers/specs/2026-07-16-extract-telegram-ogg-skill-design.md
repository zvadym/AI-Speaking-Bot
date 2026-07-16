# Extract Telegram OGG Skill Design

## Goal

Create a repository-local Codex skill that exports the latest retrievable Telegram voice messages for a project bot and user. The caller supplies a bot key and Telegram username and may supply a record limit; the default limit is five.

## Scope

- Store the skill at `.codex/skills/extract-telegram-ogg`.
- Support this repository and its production host `langbot-de-1` only.
- Read production data without modifying it.
- Export only inbound `message.voice` updates whose Telegram `file_id` remains available in retained `pg-boss` job payloads.
- Do not attempt to reconstruct older recordings from usage events, transcripts, or Telegram chat history.

## Interface

The skill accepts:

- `--bot-key <key>`: required; for example, `uk-en`.
- `--username <name>`: required; accept an optional leading `@` and normalize it away.
- `--limit <number>`: optional positive integer, default `5`, with a conservative upper bound of `100`.
- `--dry-run`: optional; discover matching records and print a summary without downloading files.

Natural-language requests such as “extract the last 10 OGG files for demo_student from uk-en” should trigger the skill.

## Components

### Skill instructions

`SKILL.md` tells Codex to validate inputs, run the bundled exporter, report the exact number of files exported, link the ZIP and manifest, and explain the retention limitation when historical usage exceeds retrievable jobs.

### Export script

A bundled Node.js script performs the deterministic workflow:

1. Validate the bot key, username, and limit.
2. Confirm `deploy/bots/<bot-key>.json` exists and contains a Telegram bot token without printing that token.
3. Connect to `langbot-de-1` over SSH and execute a read-only query from `languagebot-api-1`, using its configured PostgreSQL connection and SSL settings.
4. Resolve the username to a `chat_id` in `users`.
5. Read the newest retained `pgboss.job` rows for queue `bot-update-process`, bot route `message.voice`, the resolved user, and the requested bot key.
6. Query inbound `voice_usage_events` totals to distinguish “historical voice activity exists” from “retrievable file IDs exist.”
7. Call Telegram `getFile` and download each available recording.
8. Write numbered `.ogg` files, a metadata-only `manifest.json`, and a ZIP archive under `.codex/exports/`.

The remote query must receive validated values as parameters rather than interpolating arbitrary user input into SQL. The manifest must omit bot tokens, database URLs, and Telegram `file_id` values.

## Output

Use a timestamped directory name that includes the normalized username and bot key. Name each recording with its descending sequence number, Telegram update timestamp in UTC, and reported duration. Return recordings in newest-first order so `01_...ogg` is the newest recording.

The manifest records the bot key, username, chat ID, export timestamp, requested limit, historical inbound count, retrievable count, and per-file timestamp, duration, byte size, and filename.

## Error Handling

Exit non-zero with a concise error when:

- SSH or the production container is unavailable.
- The bot config or token is missing.
- The username does not exist.
- No retained voice jobs match.
- Telegram rejects a `file_id` or a download fails.

Download into a temporary export directory and create the final ZIP only after all requested available files succeed. Never print secrets. If fewer retained records exist than requested, export those records and clearly report the shortfall.

## Verification

- Validate the skill structure with the skill-creator validator.
- Test CLI argument validation without network access.
- Run `--dry-run` against `uk-en` and `demo_student`.
- Run a live export with a limit of one.
- Verify the downloaded file begins with an Ogg container signature and that the ZIP passes `unzip -t`.
- Confirm generated exports remain under the gitignored `.codex` directory.
