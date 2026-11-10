"""Exercise the real SSH wrapper against local fake SSH/Git/Docker commands."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
TOKEN = '100000000:' + 'x' * 35


class DeployPreflightTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo = root / 'checkout'
        self.target = root / 'target'
        self.config = root / 'private'
        self.bin = root / 'bin'
        self.log = root / 'events'
        for directory in [self.repo, self.target, self.config, self.bin]:
            directory.mkdir(mode=0o700)
        for tree in [self.repo, self.target]:
            (tree / 'scripts').mkdir()
            (tree / 'deploy/bots').mkdir(parents=True)
            shutil.copyfile(SCRIPTS / 'private_env.py', tree / 'scripts/private_env.py')
            shutil.copyfile(SCRIPTS / 'private-env.sh', tree / 'scripts/private-env.sh')
            (tree / 'deploy/bots/uk-en.json').write_text(json.dumps({'bot_key': 'uk-en'}))
        (self.repo / 'deploy/migrate.sh').write_text('echo migration >> "$TEST_EVENTS"\n')
        self.make_command('ssh', '''#!/usr/bin/env python3
import subprocess, sys
raise SystemExit(subprocess.run(['bash', '-c', sys.argv[-1]]).returncode)
''')
        self.make_command('git', '''#!/usr/bin/env bash
set -eu
echo "git:$1" >> "$TEST_EVENTS"
if [[ "$1" == archive ]]; then
  tar -c -C "$TEST_TARGET" scripts/private_env.py deploy/bots
fi
''')
        self.make_command('docker', '''#!/usr/bin/env bash
echo docker >> "$TEST_EVENTS"
''')
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', DEPLOY_HOST='local-test',
                        DEPLOY_DIR=str(self.repo), DEPLOY_CONFIG_DIR=str(self.config),
                        TEST_EVENTS=str(self.log), TEST_TARGET=str(self.target),
                        SKIP_HEALTHCHECKS='true', SSH_FORWARD_AGENT='false')

    def make_command(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o700)

    def configure(self):
        api = self.config / 'api.env'
        api.write_text('DATABASE_URL=postgres://local/test\nWEBAPP_URL=https://example.test\n'
                       'API_BASE_URL=https://example.test\nSTRIPE_SECRET_KEY=test\n'
                       'STRIPE_WEBHOOK_SECRET=test\nJWT_SECRET=test\n'
                       'ELEVENLABS_API_KEY=test-elevenlabs-key\n'
                       f'TELEGRAM_BOT_TOKEN_UK_EN={TOKEN}\n')
        api.chmod(0o600)
        mini = self.config / 'miniapp.env'
        mini.write_text('VITE_API_BASE=https://example.test\n')
        mini.chmod(0o600)

    def run_deploy(self):
        result = subprocess.run(['bash', str(SCRIPTS / 'deploy-remote.sh')], env=self.env, text=True, capture_output=True)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        events = self.log.read_text().splitlines() if self.log.exists() else []
        return result, events

    def test_missing_private_file_never_touches_checkout_or_containers(self):
        result, events = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing private env file', result.stderr)
        self.assertEqual(events, [])

    def test_new_target_bot_missing_token_stops_before_checkout(self):
        self.configure()
        (self.target / 'deploy/bots/uk-de.json').write_text(json.dumps({'bot_key': 'uk-de'}))
        result, events = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('TELEGRAM_BOT_TOKEN_UK_DE', result.stderr)
        self.assertEqual(events, ['git:fetch', 'git:archive'])

    def test_valid_configuration_reaches_migrations_and_containers_only_after_preflight(self):
        self.configure()
        result, events = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[:5], ['git:fetch', 'git:archive', 'git:checkout', 'git:reset', 'migration'])
        self.assertIn('docker', events[5:])

    def test_missing_scribe_key_stops_before_checkout_even_with_inherited_key(self):
        self.configure()
        api = self.config / 'api.env'
        api.write_text(api.read_text().replace('ELEVENLABS_API_KEY=test-elevenlabs-key\n', ''))
        self.env['ELEVENLABS_API_KEY'] = 'inherited-key-is-not-a-deployed-key'
        result, events = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ELEVENLABS_API_KEY', result.stderr)
        self.assertNotIn(self.env['ELEVENLABS_API_KEY'], result.stderr)
        self.assertEqual(events, ['git:fetch', 'git:archive'])

    def test_explicit_whisper_rollback_does_not_require_elevenlabs(self):
        self.configure()
        api = self.config / 'api.env'
        api.write_text(api.read_text().replace('ELEVENLABS_API_KEY=test-elevenlabs-key\n',
                                               'BOT_TRANSCRIPTION_MODEL=whisper-1\n'))
        result, events = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('docker', events)


if __name__ == '__main__':
    unittest.main()
