import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from private_env import parse_env, external_path, read_private_env, store_bot_token, resolve_bot_token


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = load_script('migration', 'migrate-private-env.py')
provision = load_script('provision', 'provision-bots.py')
TOKEN = '100000000:' + 'x' * 35


class PrivateEnvTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        (self.repo / 'deploy/bots').mkdir(parents=True)
        self.private = self.root / 'private'
        self.bot = self.repo / 'deploy/bots/uk-en.json'
        self.bot.write_text(json.dumps({'bot_key': 'uk-en', 'telegram_bot_token': TOKEN, 'locale': {'keep': 'unchanged'}}))
        self.old = self.repo / 'deploy/.env.api'
        self.old.write_text("JWT_SECRET='literal $HOME `id` $(touch nope)'\nDATABASE_URL=postgres://local/test\n")

    def test_migration_preserves_values_and_metadata_and_is_repeatable(self):
        old_values = parse_env(self.old.read_text())
        migration.migrate(self.repo, self.private, dry_run=True, remove_legacy=True)
        self.assertFalse(self.private.exists())
        backup = migration.migrate(self.repo, self.private, remove_legacy=True)
        values = read_private_env(self.private / 'api.env', self.repo)
        self.assertEqual(values, dict(old_values, TELEGRAM_BOT_TOKEN_UK_EN=TOKEN))
        self.assertEqual(json.loads(self.bot.read_text()), {'bot_key': 'uk-en', 'locale': {'keep': 'unchanged'}})
        self.assertFalse(self.old.exists())
        self.assertEqual(json.loads((backup / 'deploy/bots/uk-en.json').read_text())['telegram_bot_token'], TOKEN)
        for path in [self.private / 'api.env', backup / 'deploy/bots/uk-en.json']:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        migration.migrate(self.repo, self.private, remove_legacy=True)
        self.assertEqual(read_private_env(self.private / 'api.env', self.repo), values)

    def test_conflict_stops_before_removing_or_overwriting_anything(self):
        self.private.mkdir(mode=0o700)
        target = self.private / 'api.env'
        target.write_text('JWT_SECRET=different\n')
        target.chmod(0o600)
        original = self.bot.read_bytes()
        with self.assertRaisesRegex(ValueError, 'differs'):
            migration.migrate(self.repo, self.private, remove_legacy=True)
        self.assertTrue(self.old.exists())
        self.assertEqual(self.bot.read_bytes(), original)
        self.assertEqual(target.read_text(), 'JWT_SECRET=different\n')

    def test_parser_and_shell_do_not_execute_values(self):
        self.private.mkdir(mode=0o700)
        file = self.private / 'api.env'
        marker = self.root / 'must-not-exist'
        value = f'$(touch {marker}) $HOME `id`'
        file.write_text(f"LITERAL='{value}'\nMULTILINE=\"one\\ntwo\"\n")
        file.chmod(0o600)
        self.assertEqual(parse_env(file.read_text())['MULTILINE'], 'one\ntwo')
        exports = subprocess.check_output([sys.executable, str(SCRIPTS / 'private_env.py'), 'shell', str(file)], text=True)
        result = subprocess.run(['bash', '-c', exports + '\nprintf "%s" "$LITERAL"'], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout, value)
        self.assertFalse(marker.exists())
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            parse_env('source /tmp/unsafe\n')

    def test_path_permissions_and_secret_updates(self):
        with self.assertRaisesRegex(ValueError, 'outside'):
            external_path(self.old, self.repo)
        link = self.root / 'linked.env'
        link.symlink_to(self.old)
        with self.assertRaisesRegex(ValueError, 'outside'):
            external_path(link, self.repo)
        file = self.private / 'api.env'
        store_bot_token('uk-en', TOKEN, file)
        self.assertEqual(resolve_bot_token('uk-en', read_private_env(file)), TOKEN)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            store_bot_token('uk-en', '100000000:' + 'y' * 35, file)
        file.chmod(0o644)
        with self.assertRaisesRegex(ValueError, '0600'):
            read_private_env(file)

    def test_provisioning_public_config_never_contains_intake_token(self):
        intake = dict(bot_key='uk-en', base_language='uk', learning_language='en', bot_name='Demo',
                      teacher_avatar_emoji='', teacher_tagline_uk='', teacher_tagline_en='', teacher_tagline_it='',
                      teacher_style_tags=[], bot_voice='fable', bot_username='example_test_bot',
                      telegram_bot_token=TOKEN, profile_photo_path='')
        config = provision.build_bot_config({'locale': {}, 'telegram_bot_token': TOKEN}, intake, 'https://example.test')
        provision.validate_payload(config)
        self.assertNotIn(TOKEN, json.dumps(config))
        self.assertNotIn('telegram_bot_token', config)
        with self.assertRaisesRegex(provision.BotProvisioningError, 'Inline'):
            provision.validate_payload(dict(config, telegram_bot_token=TOKEN))


if __name__ == '__main__':
    unittest.main()
