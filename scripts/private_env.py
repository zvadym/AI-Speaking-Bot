"""Private dotenv configuration shared by migration, provisioning and shell tools.

No shell expansion or evaluation occurs while parsing. Only shell_exports emits
shell code, with validated names and every value quoted using shlex.quote.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import tempfile

REPO_ROOT = Path(__file__).resolve().parent.parent
TOKEN_RE = re.compile(r"^\d+:[A-Za-z0-9_-]{20,}$")
ASSIGNMENT_RE = re.compile(
    r'''^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?:'([^']*)'|"((?:\\.|[^"\\])*)"|([^\r\n#]*))[ \t]*(?:\#.*)?$''',
    re.MULTILINE,
)


def parse_env(text):
    result = {}
    consumed = []
    for match in ASSIGNMENT_RE.finditer(text):
        key, single, double, bare = match.groups()
        value = single if single is not None else double if double is not None else bare.strip()
        if double is not None:
            value = value.replace(r"\n", "\n").replace(r"\r", "\r")
        result[key] = value
        consumed.append(match.span())
    # Reject unsupported syntax rather than silently losing a credential.
    remainder = text
    for start, end in reversed(consumed):
        remainder = remainder[:start] + remainder[end:]
    if any(line.strip() and not line.lstrip().startswith('#') for line in remainder.splitlines()):
        raise ValueError('Unsupported dotenv syntax (use NAME=value or quoted values; no shell commands)')
    return result


def external_path(filename, repo_root=REPO_ROOT):
    path = Path(filename).expanduser()
    if not path.is_absolute():
        raise ValueError('Private env path must be absolute and outside the repository')
    resolved = path.resolve()
    if resolved == repo_root.resolve() or repo_root.resolve() in resolved.parents:
        raise ValueError('Private env path must be outside the repository')
    # Also reject a different Git checkout, not only this checkout.
    if any((parent / '.git').exists() for parent in [resolved.parent, *resolved.parents]):
        raise ValueError('Private env path must not be inside a Git checkout')
    return resolved


def api_env_path():
    directory = Path(os.environ.get('LANGUAGEBOT_CONFIG_DIR') or Path.home() / '.config/ai-speaking-bot')
    return external_path(os.environ.get('API_ENV_FILE') or str(directory / 'api.env'))


def read_private_env(filename, repo_root=REPO_ROOT):
    path = external_path(filename, repo_root)
    if not path.is_file():
        raise ValueError(f'Missing private env file: {path}')
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError(f'Private env file requires mode 0600: {path}')
    return parse_env(path.read_text(encoding='utf-8'))


def token_env_name(bot_key):
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', bot_key):
        raise ValueError('Invalid bot key for token lookup')
    return 'TELEGRAM_BOT_TOKEN_' + bot_key.replace('-', '_').upper()


def resolve_bot_token(bot_key, env=None):
    env = os.environ if env is None else env
    name = token_env_name(bot_key)
    value = env.get(name, '').strip()
    if not TOKEN_RE.fullmatch(value):
        raise ValueError(f'Missing or invalid bot credential: {name}')
    return value


def atomic_private_write(filename, text):
    path = external_path(filename)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Do not silently put secrets in a shared directory.
    if stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        raise ValueError(f'Private env directory requires mode 0700: {path.parent}')
    fd, temporary = tempfile.mkstemp(prefix='.private-env-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def store_bot_token(bot_key, token, filename=None):
    if not TOKEN_RE.fullmatch(token):
        raise ValueError('Invalid Telegram bot credential')
    path = api_env_path() if filename is None else external_path(filename)
    text = path.read_text(encoding='utf-8') if path.exists() else ''
    existing = read_private_env(path) if path.exists() else {}
    name = token_env_name(bot_key)
    if name in existing and existing[name] != token:
        raise ValueError(f'Private credential already exists: {name}; update it explicitly before provisioning')
    if name not in existing:
        atomic_private_write(path, text.rstrip('\n') + f'\n{name}={token}\n')


def main():
    parser = argparse.ArgumentParser(description='Validate or load private environment files without printing values')
    parser.add_argument('command', choices=['shell', 'check'])
    parser.add_argument('files', nargs='+')
    parser.add_argument('--repo-root', type=Path, default=REPO_ROOT)
    parser.add_argument('--bots-dir', type=Path)
    parser.add_argument('--deployment', action='store_true', help='Require API and Mini App deployment settings')
    parser.add_argument('--override', action='store_true', help='Use private file values over inherited environment')
    args = parser.parse_args()
    try:
        values = {}
        for filename in args.files:
            values.update(read_private_env(filename, args.repo_root))
        if args.deployment:
            required = ['DATABASE_URL', 'WEBAPP_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'JWT_SECRET', 'VITE_API_BASE']
            missing = [key for key in required if not values.get(key, '').strip()]
            if not (values.get('API_BASE_URL') or values.get('TELEGRAM_WEBHOOK_BASE_URL')):
                missing.append('API_BASE_URL or TELEGRAM_WEBHOOK_BASE_URL')
            if missing:
                raise ValueError('Missing deployment settings: ' + ', '.join(missing))
        if args.command == 'shell':
            # Internal API for scripts/private-env.sh. Never invoke in a log/terminal
            # to inspect configuration: this output contains credentials.
            for key, value in values.items():
                if args.override or key not in os.environ:
                    print(f'export {key}={shlex.quote(value)}')
        else:
            if args.bots_dir:
                files = sorted(args.bots_dir.glob('*.json'))
                if not files:
                    raise ValueError('No bot configs found')
                seen = set()
                for filename in files:
                    try:
                        config = json.loads(filename.read_text())
                    except (ValueError, OSError):
                        raise ValueError(f'Invalid bot config: {filename.name}') from None
                    key = config.get('bot_key', '')
                    if key in seen:
                        raise ValueError('Duplicate bot key')
                    seen.add(key)
                    # Validate the actual file, not inherited shell overrides.
                    resolve_bot_token(key, values)
                print(f'Private env validated; credentials present for {len(seen)} bots')
            else:
                print('Private env validated')
        return 0
    except (ValueError, OSError) as error:
        print(f'Private env validation failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
