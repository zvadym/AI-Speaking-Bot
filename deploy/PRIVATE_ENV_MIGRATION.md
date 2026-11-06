# Migrate existing installations to private env files

This change does not rotate credentials or rewrite Git history. Preserve the current
values first, verify the new deployment, then handle rotation/history as separate work.
Do not run production deployment automatically: `scripts/AGENTS.md` prohibits it.

## Local migration

From the original checkout, before removing token fields:

```bash
python3 scripts/migrate-private-env.py --dry-run
python3 scripts/migrate-private-env.py --remove-legacy
```

The default destination is `$HOME/.config/ai-speaking-bot`. Override with
`--config-dir /absolute/private/directory`. The migration:

1. Parses the old `deploy/.env.api`, `.env.miniapp`, optional `.env.landing` and bot JSON.
2. Rejects conflicting existing destination values or invalid/missing bot tokens.
3. Creates a private backup directory containing the original env files and bot JSON.
4. Writes mode-0600 external files and verifies their parsed values, including every token.
5. Only with `--remove-legacy`, removes the old local env files and inline token fields.

A failed preflight leaves source files untouched. A write/verification failure retains
legacy files and the private backup. Keep the backup outside Git. Do not copy it into
the repository, an issue, a PR, or CI artifacts. Repeating the migration preserves values.

Do not run `--remove-legacy` against an old running production checkout: it still reads
JSON credentials. Production requires the staged sequence below.

## Production preparation, before deploying the sanitized revision

The old bots must keep running while private configuration is prepared. Do not reset
the server checkout to the sanitized revision before copying its current credentials.
Run the following only during an explicitly authorized server operation.

1. Copy **only** the reviewed `scripts/private_env.py` and
   `scripts/migrate-private-env.py` into a temporary directory on the server. They
   need only Python 3; place both files in the same directory. Use a fresh private
   temporary directory, with mode 0700. Do not copy local production env values over
   the server's configuration: the server's existing values are authoritative.
2. Create `/etc/ai-speaking-bot` (or chosen `DEPLOY_CONFIG_DIR`), owned by the SSH
   deployment user and mode 0700. Do not change ownership of unrelated `/etc` paths.
3. Run the copied migration tool against the old checkout, first with `--dry-run`,
   then without it. **Omit `--remove-legacy`**:

```bash
# Run from the private directory containing the two reviewed migration scripts.
python3 migrate-private-env.py \
  --repo-root /opt/ai-speaking-bot \
  --config-dir /etc/ai-speaking-bot \
  --dry-run
python3 migrate-private-env.py \
  --repo-root /opt/ai-speaking-bot \
  --config-dir /etc/ai-speaking-bot
```

Record the private backup path printed by the tool. It includes the original
`deploy/bots` files and original env files. Keep permissions 0700/0600.

4. Validate the new private files against the still-running bot configs:

```bash
python3 private_env.py check \
  /etc/ai-speaking-bot/api.env /etc/ai-speaking-bot/miniapp.env \
  --repo-root /opt/ai-speaking-bot \
  --bots-dir /opt/ai-speaking-bot/deploy/bots --deployment
```

This checks every token and required deployment setting without printing values.
The migration does not add missing OpenAI/Stripe/internal credentials: retain the
server's existing configuration and investigate any missing configuration before rollout.

5. Prepare rollback before replacing containers. Record the existing source commit;
   tag the current API, worker and Mini App image IDs with local rollback tags
   (do not push them). Create a private Compose override with those image tags and
   override the API/worker `/deploy/bots` bind mount to the backup's `deploy/bots`.
   This lets the old images use their original JSON credentials outside the checkout.
   Keep the override outside Git. Validate the merged configuration with
   `docker compose ... config --quiet`, never print the expanded configuration.

Example rollback override structure (supply the actual image tags and backup path
as environment variables before invoking Compose):

```yaml
services:
  api:
    image: ${ROLLBACK_API_IMAGE:?Set the locally preserved API image tag}
    volumes:
      - ${PRIVATE_BACKUP:?Set the verified migration backup path}/deploy/bots:/deploy/bots:ro
  worker:
    image: ${ROLLBACK_WORKER_IMAGE:?Set the locally preserved worker image tag}
    volumes:
      - ${PRIVATE_BACKUP:?Set the verified migration backup path}/deploy/bots:/deploy/bots:ro
  miniapp:
    image: ${ROLLBACK_MINIAPP_IMAGE:?Set the locally preserved Mini App image tag}
```

## Deploy and verify

After reviewed code is available on the selected remote branch, use the existing
SSH deploy wrapper. `DEPLOY_CONFIG_DIR` defaults to `/etc/ai-speaking-bot`.
The wrapper checks target-revision bot configs against external credentials **before**
checkout/reset, migrations, container recreation, or webhook registration. Missing
private files stop deployment while the old containers keep running.

The file check deliberately does not trust inherited shell token overrides.
Deployment wrappers load private file values over inherited service variables so
migrations and containers use the same configuration. Local development commands
retain explicit process-variable overrides. Routine deployment does not upload or
overwrite env files.

Verify:

- `/healthz` and the Mini App respond.
- API and worker start without missing-env/config errors.
- `telegram-webhooks.mjs inspect` reports the expected URL and pending/error state
  for every bot. The webhook CLI validates all target tokens before any Telegram call.
- Exercise one dedicated test bot's text and voice flow without broadcasting to users.
- Tokens/signing secrets were preserved, so the derived webhook secrets stay unchanged.

Do not print `env`, private files, complete Docker inspect output or resolved Compose
configuration. These may contain secrets. Check only specific non-secret fields.

If rollout fails, use the private rollback Compose override with `up -d --no-build
--pull never api worker miniapp` and the preserved images. Export `API_ENV_FILE` and
`MINIAPP_ENV_FILE` to the external files. This restores old images and private old bot
JSON without writing credentials into the public checkout. Do not roll back database
migrations; this change adds none. Preserve the original private backup until the
rollout is verified.

After successful verification, run the migration tool from the new checkout with
`--remove-legacy` and the same config directory. It verifies parity again, backs up
remaining old env files and removes them. Only then proceed to credential rotation
and historical Git cleanup as separately reviewed operations.

## New bots and tests

- `provision-bots.py interactive` stores its token in the external API env file.
  Copy/update the specific private server credential through an authorized private
  channel before deploying the new public bot config. Routine SSH deploy will refuse
  to proceed until every target bot has a valid credential.
- `sync` needs no secrets. `apply` preflights all selected tokens; `--dry-run` performs
  no Telegram API calls and no writes.
- Node commands load only explicit `API_ENV_FILE`; development wrappers select the
  local default directory. Docker injects env host-side and needs no secret-file mount.
- API tests use synthetic credentials, independent of local private files.
- Do not place backend secrets in Mini App `VITE_*` or landing `NUXT_PUBLIC_*` values.
