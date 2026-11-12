"""Keep settings-only bots from restoring stale Telegram command menus."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('provision_command_menus', SCRIPTS / 'provision-bots.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


class FakeTelegramClient:
    def __init__(self):
        self.calls = []
        self.menus = {
            ('default', ''): [{'command': 'start', 'description': 'Start'}],
            ('all_private_chats', ''): [{'command': 'feedback', 'description': 'Feedback'}],
            ('default', 'uk'): [{'command': 'level', 'description': 'Level'}],
            ('all_private_chats', 'en'): [{'command': 'voice', 'description': 'Voice'}],
        }

    def call_json(self, method, payload):
        self.calls.append((method, payload))
        key = (payload.get('scope', {}).get('type'), payload.get('language_code', ''))
        if method == 'getMe':
            return {'ok': True, 'result': {'username': 'example_test_bot'}}
        if method == 'getMyCommands':
            return {'ok': True, 'result': self.menus.get(key, [])}
        if method == 'deleteMyCommands':
            self.menus.pop(key, None)
        if method == 'setMyCommands':
            raise AssertionError('Provisioning must not recreate command menus')
        return {'ok': True, 'result': True}


class BotCommandMenuTest(unittest.TestCase):
    def test_public_configs_have_no_commands_and_all_settings_feedback_labels(self):
        files = sorted((ROOT / 'deploy/bots').glob('*.json'))
        self.assertEqual(len(files), 15)
        for file in files:
            bot = json.loads(file.read_text())
            self.assertEqual(bot['telegram_presentation']['commands'], [], file.name)
            locale = bot['locale']
            for key in ('stats', 'feedback', 'cancel', 'back', 'feedback_waiting'):
                self.assertTrue(locale['settings'].get(key), (file.name, key))
            for key in ('msg_feedback_prompt', 'msg_feedback_thanks', 'msg_feedback_cancelled',
                        'msg_feedback_expired', 'msg_feedback_unsupported', 'msg_feedback_placeholder'):
                self.assertTrue(locale.get(key), (file.name, key))
            self.assertLessEqual(len(locale['msg_feedback_placeholder']), 64)
            self.assertNotIn('/stats', json.dumps(locale))
            self.assertNotIn('choose_voice_mode_text', locale)
            self.assertNotIn('keyboard_btn_voice_text', locale)
            self.assertTrue(locale['choose_level_text'])  # Onboarding still needs its picker.

    def test_contract_accepts_empty_commands_and_rejects_stale_nonempty_menu(self):
        # Exercise the real contract defaults without requiring optional PyYAML
        # in CI's standard-library-only tooling tests. The sync check loads YAML.
        with patch.object(provision, 'read_yaml', return_value={}):
            contract = provision.load_contract(ROOT / 'deploy/bot-presentation.template.yaml')
        bot = json.loads((ROOT / 'deploy/bots/uk-en.json').read_text())
        presentation = bot['telegram_presentation']
        normalized, _ = provision.validate_presentation_section(
            presentation, contract=contract, bot_key=bot['bot_key'], repo_root=ROOT,
            require_photo_exists=False, normalize_menu_url=False)
        self.assertEqual(normalized['commands'], [])
        self.assertEqual(normalized['menu_button'], presentation['menu_button'])
        for commands in (None, {}, [{'command': 'level', 'description': 'Level'}]):
            with self.assertRaisesRegex(provision.BotProvisioningError, 'empty array'):
                provision.validate_presentation_section(
                    dict(presentation, commands=commands), contract=contract,
                    bot_key=bot['bot_key'], repo_root=ROOT,
                    require_photo_exists=False, normalize_menu_url=False)

    def test_clear_deletes_default_private_and_existing_localized_overrides(self):
        client = FakeTelegramClient()
        steps = provision.clear_bot_commands(client)
        self.assertEqual(client.menus, {})
        self.assertEqual(len([c for c in client.calls if c[0] == 'deleteMyCommands']), 4)
        self.assertTrue(any('scope=default,language=uk' in s for s in steps))
        self.assertTrue(any('scope=all_private_chats,language=en' in s for s in steps))
        self.assertFalse(any(method == 'setMyCommands' for method, _ in client.calls))
        lookups = [payload for method, payload in client.calls if method == 'getMyCommands']
        for language in provision.COMMAND_LANGUAGE_CODES:
            for scope in ('default', 'all_private_chats'):
                self.assertIn({'scope': {'type': scope}, 'language_code': language}, lookups)

    def test_clear_refuses_a_menu_that_survives_deletion(self):
        class Sticky(FakeTelegramClient):
            def call_json(self, method, payload):
                if method == 'deleteMyCommands':
                    return {'ok': True, 'result': True}
                return super().call_json(method, payload)
        with self.assertRaisesRegex(provision.TelegramApiError, 'not cleared'):
            provision.clear_bot_commands(Sticky())

    def test_apply_preserves_miniapp_button_and_dry_run_never_calls_api(self):
        client = FakeTelegramClient()
        presentation = {
            'name': 'Demo', 'description': 'Demo bot', 'short_description': 'Practice',
            'commands': [], 'menu_button': {'text': 'App', 'web_app_url': 'https://example.test/app'},
        }
        with patch.object(provision, 'TelegramBotClient', return_value=client):
            provision.configure_bot_via_api(bot_key='uk-en', token='synthetic', presentation=presentation,
                                           expected_username='example_test_bot', profile_photo=None, dry_run=False)
        buttons = [p['menu_button'] for method, p in client.calls if method == 'setChatMenuButton']
        self.assertEqual(buttons, [{'type': 'web_app', 'text': 'App', 'web_app': {'url': 'https://example.test/app'}}])
        with patch.object(provision, 'TelegramBotClient', side_effect=AssertionError('No API in dry run')):
            steps = provision.configure_bot_via_api(bot_key='uk-en', token='synthetic', presentation=presentation,
                                                   expected_username=None, profile_photo=None, dry_run=True)
        self.assertTrue(any('deleteMyCommands' in s for s in steps))
        self.assertFalse(any('setMyCommands' in s for s in steps))


if __name__ == '__main__':
    unittest.main()
