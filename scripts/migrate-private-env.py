#!/usr/bin/env python3
"""One-time, local-only migration. Does not SSH, deploy or rotate credentials."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import stat
import sys
import tempfile

from private_env import (REPO_ROOT, TOKEN_RE, atomic_private_write, external_path,
                         parse_env, read_private_env, token_env_name)


def migrate(repo_root, config_dir, *, dry_run=False, remove_legacy=False):
    repo_root = repo_root.resolve()
    config_dir = external_path(config_dir, repo_root)
    if config_dir.exists() and stat.S_IMODE(config_dir.stat().st_mode) & 0o077:
        raise ValueError('Private config directory requires mode 0700')
    configs = []
    tokens = {}
    for file in sorted((repo_root / 'deploy/bots').glob('*.json')):
        try:
            data = json.loads(file.read_text())
        except ValueError:
            raise ValueError(f'Invalid bot JSON: {file.name}') from None
        name = token_env_name(data.get('bot_key', ''))
        if name in tokens:
            raise ValueError('Duplicate bot key')
        token = str(data.get('telegram_bot_token') or '').strip()
        if token and not TOKEN_RE.fullmatch(token):
            raise ValueError(f'Invalid legacy bot credential: {name}')
        tokens[name] = token
        configs.append((file, data))
    if not configs:
        raise ValueError('No bot configs found')

    # Plan and validate every file before any writes or removal.
    writes = {}
    originals = []
    for name in ['api', 'miniapp', 'landing']:
        old = repo_root / f'deploy/.env.{name}'
        target = config_dir / f'{name}.env'
        if not old.exists() and not target.exists():
            if name == 'api':
                raise ValueError('Missing API env; provide the original deploy/.env.api before migration')
            continue
        old_text = old.read_text() if old.exists() else ''
        old_values = parse_env(old_text)
        new_text = target.read_text() if target.exists() else old_text
        values = read_private_env(target, repo_root) if target.exists() else old_values.copy()
        for key, value in old_values.items():
            if values.get(key) != value:
                raise ValueError(f'Private {name}.env differs from legacy value for {key}; reconcile explicitly')
        if name == 'api':
            for key, token in tokens.items():
                if token:
                    if key in values and values[key] != token:
                        raise ValueError(f'Credential conflict: {key}')
                    if key not in values:
                        new_text = new_text.rstrip('\n') + f'\n{key}={token}\n'
                        values[key] = token
                if not TOKEN_RE.fullmatch(values.get(key, '')):
                    raise ValueError(f'Missing bot credential: {key}; migrate before replacing old bot configs')
        if parse_env(new_text) != values:
            raise ValueError(f'Environment parity failed: {name}')
        writes[target] = (new_text, values)
        if old.exists():
            originals.append(old)

    if dry_run:
        print(f'Validated migration: {len(writes)} env files, {len(configs)} bot credentials; no writes')
        return None
    config_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    # All backup contents are private, including copies of the original bot JSON.
    backup = Path(tempfile.mkdtemp(prefix='migration-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-', dir=config_dir))
    for source in originals + [file for file, _ in configs]:
        destination = backup / source.relative_to(repo_root)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.write_bytes(source.read_bytes())
        destination.chmod(0o600)
    for target, (text, values) in writes.items():
        atomic_private_write(target, text)
        if read_private_env(target, repo_root) != values:
            raise ValueError('Written private environment failed verification; legacy files retained')
    # Only after every private file has passed a read-back verification.
    if remove_legacy:
        for file, data in configs:
            if 'telegram_bot_token' in data:
                del data['telegram_bot_token']
                file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        for old in originals:
            old.unlink()
    print(f'Migration verified: {len(configs)} bot credentials; private backup: {backup}')
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', type=Path, default=REPO_ROOT)
    parser.add_argument('--config-dir', type=Path, default=Path.home() / '.config/ai-speaking-bot')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--remove-legacy', action='store_true', help='After verification, remove local legacy env files and inline bot tokens')
    args = parser.parse_args()
    try:
        migrate(args.repo_root, args.config_dir, dry_run=args.dry_run, remove_legacy=args.remove_legacy)
        return 0
    except (ValueError, OSError) as error:
        print(f'Migration stopped: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
