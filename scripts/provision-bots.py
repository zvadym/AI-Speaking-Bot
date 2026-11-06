#!/usr/bin/env python3
import argparse
import copy
import getpass
import json
import mimetypes
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from private_env import api_env_path, read_private_env, resolve_bot_token, store_bot_token

try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None

DEFAULT_MINIAPP_URL_BASE = "https://learn-language-app.notarobot.dev"
DEFAULT_CONTRACT_PATH = "deploy/bot-presentation.template.yaml"
PRESENTATION_SECTION = "telegram_presentation"
DEFAULT_MENU_TEXT_BY_BASE = {
    "en": "App",
    "uk": "App",
    "it": "App",
    "de": "App",
}

DEFAULT_COMMANDS_BY_BASE = {
    "en": [
        {"command": "start", "description": "Start the bot"},
        {"command": "level", "description": "Set your language level"},
        {"command": "voice", "description": "Choose voice or text replies"},
        {"command": "stats", "description": "Check subscription status"},
        {"command": "xp", "description": "Check your streak and XP"},
        {"command": "feedback", "description": "Send feedback"},
        {"command": "lang", "description": "Show fixed learning language"},
    ],
    "uk": [
        {"command": "start", "description": "Запустити бота"},
        {"command": "level", "description": "Встановити рівень мови"},
        {"command": "voice", "description": "Обрати голосовий або текстовий режим"},
        {"command": "stats", "description": "Перевірити статус підписки"},
        {"command": "xp", "description": "Переглянути серію та XP"},
        {"command": "feedback", "description": "Надіслати фідбек"},
        {"command": "lang", "description": "Показати фіксовану мову навчання"},
    ],
    "it": [
        {"command": "start", "description": "Avvia il bot"},
        {"command": "level", "description": "Imposta il tuo livello"},
        {"command": "voice", "description": "Scegli risposte vocali o testuali"},
        {"command": "stats", "description": "Controlla stato abbonamento"},
        {"command": "xp", "description": "Controlla streak e XP"},
        {"command": "feedback", "description": "Invia feedback"},
        {"command": "lang", "description": "Mostra lingua di studio fissa"},
    ],
    "de": [
        {"command": "start", "description": "Bot starten"},
        {"command": "level", "description": "Sprachniveau festlegen"},
        {"command": "voice", "description": "Sprach- oder Textantworten wählen"},
        {"command": "stats", "description": "Abo-Status prüfen"},
        {"command": "xp", "description": "Streak und XP prüfen"},
        {"command": "feedback", "description": "Feedback senden"},
        {"command": "lang", "description": "Feste Lernsprache anzeigen"},
    ],
}

LANGUAGE_FLAG_BY_CODE = {
    "ar": "🇸🇦",
    "de": "🇩🇪",
    "en": "🇬🇧",
    "es": "🇪🇸",
    "hi": "🇮🇳",
    "it": "🇮🇹",
    "pl": "🇵🇱",
    "pt": "🇵🇹",
    "tr": "🇹🇷",
    "uk": "🇺🇦",
}

LOCALIZED_TARGET_LANGUAGE_BY_BASE = {
    "en": {
        "ar": "Arabic",
        "de": "German",
        "en": "English",
        "es": "Spanish",
        "hi": "Hindi",
        "it": "Italian",
        "pl": "Polish",
        "pt": "Portuguese",
        "tr": "Turkish",
        "uk": "Ukrainian",
    },
    "uk": {
        "ar": "арабської",
        "de": "німецької",
        "en": "англійської",
        "es": "іспанської",
        "hi": "гінді",
        "it": "італійської",
        "pl": "польської",
        "pt": "португальської",
        "tr": "турецької",
        "uk": "української",
    },
    "de": {
        "ar": "Arabisch",
        "de": "Deutsch",
        "en": "Englisch",
        "es": "Spanisch",
        "hi": "Hindi",
        "it": "Italienisch",
        "pl": "Polnisch",
        "pt": "Portugiesisch",
        "tr": "Türkisch",
        "uk": "Ukrainisch",
    },
    "it": {
        "ar": "arabo",
        "de": "tedesco",
        "en": "inglese",
        "es": "spagnolo",
        "hi": "hindi",
        "it": "italiano",
        "pl": "polacco",
        "pt": "portoghese",
        "tr": "turco",
        "uk": "ucraino",
    },
    "tr": {
        "ar": "Arapça",
        "de": "Almanca",
        "en": "İngilizce",
        "es": "İspanyolca",
        "hi": "Hintçe",
        "it": "İtalyanca",
        "pl": "Lehçe",
        "pt": "Portekizce",
        "tr": "Türkçe",
        "uk": "Ukraynaca",
    },
    "hi": {
        "ar": "अरबी",
        "de": "जर्मन",
        "en": "अंग्रेज़ी",
        "es": "स्पेनिश",
        "hi": "हिंदी",
        "it": "इतालवी",
        "pl": "पोलिश",
        "pt": "पुर्तगाली",
        "tr": "तुर्की",
        "uk": "यूक्रेनी",
    },
    "ar": {
        "ar": "العربية",
        "de": "الألمانية",
        "en": "الإنجليزية",
        "es": "الإسبانية",
        "hi": "الهندية",
        "it": "الإيطالية",
        "pl": "البولندية",
        "pt": "البرتغالية",
        "tr": "التركية",
        "uk": "الأوكرانية",
    },
}

PRACTICE_TEMPLATE_BY_BASE = {
    "en": "{language} Practice",
    "uk": "Практика {language}",
    "de": "{language}-Praxis",
    "it": "Pratica di {language}",
    "tr": "{language} Pratiği",
    "hi": "{language} प्रैक्टिस",
    "ar": "ممارسة {language}",
}

TITLE_TEMPLATE_BY_BASE = {
    "en": "{name} {flag} | Your language tutor",
    "uk": "{name} {flag} | Твоя репетиторка з мови",
    "de": "{name} {flag} | Deine Sprachtrainerin",
    "it": "{name} {flag} | La tua tutor di lingua",
    "tr": "{name} {flag} | Dil öğretmenin",
    "hi": "{name} {flag} | आपकी भाषा ट्यूटर",
    "ar": "{name} {flag} | معلّمتك اللغوية",
}

REQUIRED_KEYS = [
    "bot_key",
    "base_language",
    "learning_language",
    "locale",
]
BOT_TOKEN_RE = re.compile(r"^\d+:[A-Za-z0-9_-]{20,}$")
BOT_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{5,32}$")
TELEGRAM_URL_RE = re.compile(r"^(?:https?://)?(?:t\.me|telegram\.me)/([A-Za-z0-9_]{5,32})/?$")


class BotProvisioningError(Exception):
    pass


class TelegramApiError(Exception):
    pass


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    candidates = [current] + list(current.parents)
    for candidate in candidates:
        if (candidate / "deploy").is_dir() and (candidate / "scripts").is_dir():
            return candidate
    raise BotProvisioningError(f"Could not detect repo root from {start}")


def normalize_lang_code(value: str) -> str:
    return value.strip().lower()


def validate_bot_username(value: str) -> bool:
    return bool(BOT_USERNAME_RE.fullmatch(value.strip()))


def validate_bot_token(value: str) -> bool:
    return bool(BOT_TOKEN_RE.fullmatch(value.strip()))


def parse_tags(raw: str) -> List[str]:
    seen = set()
    out: List[str] = []
    for part in raw.split(","):
        tag = part.strip()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
    return out


def prompt_text(
    label: str,
    *,
    required: bool = True,
    default: Optional[str] = None,
    validator=None,
    error_message: Optional[str] = None,
    secret: bool = False,
) -> str:
    while True:
        suffix = f" [{default}]" if default not in (None, "") else ""
        prompt = f"{label}{suffix}: "
        raw = getpass.getpass(prompt) if secret else input(prompt)
        value = raw.strip()
        if not value and default is not None:
            value = default.strip()
        if required and not value:
            print("Value is required.")
            continue
        if validator and value and not validator(value):
            print(error_message or "Invalid value.")
            continue
        return value


def prompt_int(label: str, *, minimum: int = 1, maximum: Optional[int] = None) -> int:
    while True:
        raw = input(f"{label}: ").strip()
        try:
            value = int(raw)
        except ValueError:
            print("Enter a valid integer.")
            continue
        if value < minimum:
            print(f"Value must be >= {minimum}.")
            continue
        if maximum is not None and value > maximum:
            print(f"Value must be <= {maximum}.")
            continue
        return value


def prompt_yes_no(label: str, *, default: bool = False) -> bool:
    suffix = "Y/n" if default else "y/N"
    while True:
        raw = input(f"{label} [{suffix}]: ").strip().lower()
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        print("Enter y or n.")


def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2, ensure_ascii=False)
        tmp.write("\n")
        temp_name = tmp.name
    os.replace(temp_name, path)


def read_yaml(path: Path) -> Dict[str, Any]:
    if yaml is None:
        raise BotProvisioningError(
            "PyYAML is required for sync/apply contract loading. Install it: pip install pyyaml"
        )
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except FileNotFoundError as exc:
        raise BotProvisioningError(f"Contract file not found: {path}") from exc
    except Exception as exc:
        raise BotProvisioningError(f"Failed to parse YAML contract {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise BotProvisioningError(f"YAML contract must be an object: {path}")
    return data


def load_contract(path: Path) -> Dict[str, Any]:
    data = read_yaml(path)

    defaults = {
        "version": 1,
        "section": PRESENTATION_SECTION,
        "required_fields": [
            "name",
            "description",
            "short_description",
            "commands",
            "menu_button",
        ],
        "limits": {
            "name_min": 1,
            "name_max": 64,
            "description_max": 512,
            "short_description_max": 120,
            "menu_button_text_max": 14,
            "commands_max": 100,
            "command_description_max": 256,
        },
        "patterns": {"command": r"^[a-z0-9_]{1,32}$"},
    }

    merged = copy.deepcopy(defaults)
    merged.update({k: v for k, v in data.items() if k not in ("limits", "patterns")})

    for subkey in ("limits", "patterns"):
        section = data.get(subkey)
        if isinstance(section, dict):
            merged[subkey].update(section)

    if merged.get("version") != 1:
        raise BotProvisioningError(f"Unsupported contract version: {merged.get('version')}")

    section_name = str(merged.get("section") or "").strip()
    if section_name != PRESENTATION_SECTION:
        raise BotProvisioningError(
            f"Contract section must be '{PRESENTATION_SECTION}', got '{section_name}'"
        )

    required_fields = merged.get("required_fields")
    if not isinstance(required_fields, list) or not all(isinstance(x, str) for x in required_fields):
        raise BotProvisioningError("Contract required_fields must be a list of strings")

    return merged


def parse_username_from_url(url: str) -> str:
    match = TELEGRAM_URL_RE.fullmatch(url.strip())
    if not match:
        return ""
    return match.group(1).lower()


def select_default_template_key(
    base_language: str,
    learning_language: str,
    template_keys: List[str],
    templates: Dict[str, Dict[str, Any]],
) -> str:
    ranked: List[Tuple[int, str]] = []
    for key in template_keys:
        t_base = str(templates[key].get("base_language") or "").strip().lower()
        t_learn = str(templates[key].get("learning_language") or "").strip().lower()

        score = 0
        if t_base == base_language and t_learn == learning_language:
            score = 30
        elif t_base == base_language:
            score = 20
        elif t_learn == learning_language:
            score = 10

        ranked.append((score, key))

    ranked.sort(key=lambda item: (-item[0], item[1]))
    return ranked[0][1]


def clamp(text: str, max_len: int) -> str:
    value = text.strip()
    if len(value) <= max_len:
        return value
    return value[: max_len - 3].rstrip() + "..."


def first_non_empty(values: List[str]) -> str:
    for value in values:
        if value and value.strip():
            return value.strip()
    return ""


def website_url_for_base(base_language: str) -> str:
    return f"https://ai-language-school.online/{base_language}"


def localized_menu_text(base_language: str) -> str:
    return DEFAULT_MENU_TEXT_BY_BASE.get(base_language, "App")


def with_website_url(description: str, base_language: str) -> str:
    cleaned = re.sub(
        r"\s*https?://ai-language-school\.online/[a-z]{2}\s*$",
        "",
        description.strip(),
        flags=re.IGNORECASE,
    ).strip()
    if not cleaned:
        return website_url_for_base(base_language)
    return f"{cleaned}\n{website_url_for_base(base_language)}"


def localized_commands(base_language: str) -> List[Dict[str, str]]:
    source = DEFAULT_COMMANDS_BY_BASE.get(base_language, DEFAULT_COMMANDS_BY_BASE["en"])
    return copy.deepcopy(source)


def localized_practice_language(base_language: str, learning_language: str) -> str:
    base = normalize_lang_code(base_language)
    learn = normalize_lang_code(learning_language)
    by_base = LOCALIZED_TARGET_LANGUAGE_BY_BASE.get(base, {})
    if learn in by_base:
        return by_base[learn]
    fallback = LOCALIZED_TARGET_LANGUAGE_BY_BASE["en"].get(learn)
    if fallback:
        return fallback
    return learn.upper() if learn else "LANGUAGE"


def target_language_flag(learning_language: str) -> str:
    return LANGUAGE_FLAG_BY_CODE.get(normalize_lang_code(learning_language), "🏳️")


def localized_presentation_name(display_name: str, base_language: str, learning_language: str) -> str:
    name = display_name.strip()
    if not name:
        return ""
    template = TITLE_TEMPLATE_BY_BASE.get(
        normalize_lang_code(base_language), TITLE_TEMPLATE_BY_BASE["en"]
    )
    return template.format(name=name, flag=target_language_flag(learning_language))


def expected_presentation_name(config: Dict[str, Any]) -> Optional[str]:
    display_name = str(config.get("bot_name") or "").strip()
    if not display_name:
        return None
    base_language = str(config.get("base_language") or "").strip()
    learning_language = str(config.get("learning_language") or "").strip()
    if not base_language or not learning_language:
        return None
    expected = localized_presentation_name(display_name, base_language, learning_language)
    return expected or None


def validate_payload(config: Dict[str, Any]) -> None:
    missing = [key for key in REQUIRED_KEYS if key not in config or config.get(key) in (None, "")]
    if missing:
        raise BotProvisioningError(f"Bot config missing required keys: {', '.join(missing)}")

    bot_key = str(config.get("bot_key") or "").strip()
    base = str(config.get("base_language") or "").strip()
    learn = str(config.get("learning_language") or "").strip()
    expected = f"{base}-{learn}"
    if bot_key != expected:
        raise BotProvisioningError(f"bot_key must equal {expected}, got {bot_key}")

    if "telegram_bot_token" in config:
        raise BotProvisioningError("Inline telegram_bot_token is forbidden; run migrate-private-env.py first")

    if not isinstance(config.get("locale"), dict):
        raise BotProvisioningError("locale must be an object")


def resolve_profile_photo_path(profile_value: str, repo_root: Path, *, require_exists: bool) -> Path:
    if os.path.isabs(profile_value):
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.profile_photo_path must be repo-relative, got absolute path: {profile_value}"
        )

    path = (repo_root / profile_value).resolve()
    if require_exists and (not path.exists() or not path.is_file()):
        raise BotProvisioningError(f"Profile photo file not found: {path}")
    return path


def normalize_menu_button_url(raw_url: str, bot_key: str) -> Tuple[str, bool]:
    replaced = raw_url.replace("{bot_key}", bot_key)
    changed = replaced != raw_url

    parsed = urllib.parse.urlparse(replaced)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.menu_button.web_app_url must be a valid http/https URL"
        )

    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    filtered = [(k, v) for (k, v) in pairs if k != "bot-key"]
    filtered.append(("bot-key", bot_key))
    new_query = urllib.parse.urlencode(filtered)
    rebuilt = urllib.parse.urlunparse(parsed._replace(query=new_query))
    if rebuilt != replaced:
        changed = True

    return rebuilt, changed


def validate_presentation_section(
    presentation: Any,
    *,
    contract: Dict[str, Any],
    bot_key: str,
    repo_root: Path,
    require_photo_exists: bool,
    normalize_menu_url: bool,
    expected_name: Optional[str] = None,
    normalize_name: bool = True,
    fallback_username: Optional[str] = None,
) -> Tuple[Dict[str, Any], List[str]]:
    if not isinstance(presentation, dict):
        raise BotProvisioningError(f"Missing or invalid '{PRESENTATION_SECTION}' section")

    required_fields: List[str] = contract["required_fields"]
    limits: Dict[str, Any] = contract["limits"]
    pattern = re.compile(str(contract["patterns"]["command"]))

    for key in required_fields:
        if key == "username" and fallback_username:
            continue
        if key not in presentation:
            raise BotProvisioningError(f"{PRESENTATION_SECTION}.{key} is required")

    normalized = copy.deepcopy(presentation)
    changes: List[str] = []

    name = str(normalized.get("name") or "").strip()
    expected = str(expected_name or "").strip()
    if expected and name != expected:
        if normalize_name:
            name = expected
            changes.append(
                f"Normalized {PRESENTATION_SECTION}.name to '{expected}'"
            )
        else:
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.name must equal '{expected}'"
            )
    if len(name) < int(limits["name_min"]) or len(name) > int(limits["name_max"]):
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.name length must be {limits['name_min']}..{limits['name_max']}"
        )
    normalized["name"] = name

    description = str(normalized.get("description") or "").strip()
    if len(description) > int(limits["description_max"]):
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.description length must be <= {limits['description_max']}"
        )
    normalized["description"] = description

    short_description = str(normalized.get("short_description") or "").strip()
    if len(short_description) > int(limits["short_description_max"]):
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.short_description length must be <= {limits['short_description_max']}"
        )
    normalized["short_description"] = short_description

    raw_username = str(normalized.get("username") or "").strip()
    if "username" in required_fields and not raw_username and not fallback_username:
        raise BotProvisioningError(f"{PRESENTATION_SECTION}.username is required")
    username_in_payload = "username" in normalized and bool(raw_username)

    if username_in_payload:
        username = raw_username.strip().lstrip("@")
        if not validate_bot_username(username):
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.username must match Telegram username format"
            )
        normalized["username"] = username
    else:
        normalized.pop("username", None)
        if fallback_username:
            username = str(fallback_username).strip().lstrip("@")
            if username and not validate_bot_username(username):
                raise BotProvisioningError("Bot username must match Telegram username format")

    commands = normalized.get("commands")
    if not isinstance(commands, list) or not commands:
        raise BotProvisioningError(f"{PRESENTATION_SECTION}.commands must be a non-empty array")
    if len(commands) > int(limits["commands_max"]):
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.commands length must be <= {limits['commands_max']}"
        )

    validated_commands: List[Dict[str, str]] = []
    for idx, cmd in enumerate(commands):
        if not isinstance(cmd, dict):
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.commands[{idx}] must be an object with command/description"
            )
        name_value = str(cmd.get("command") or "").strip()
        desc_value = str(cmd.get("description") or "").strip()
        if not pattern.fullmatch(name_value):
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.commands[{idx}].command invalid: {name_value}"
            )
        if not desc_value:
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.commands[{idx}].description is required"
            )
        if len(desc_value) > int(limits["command_description_max"]):
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.commands[{idx}].description length must be <= {limits['command_description_max']}"
            )
        validated_commands.append({"command": name_value, "description": desc_value})
    normalized["commands"] = validated_commands

    menu_button = normalized.get("menu_button")
    if not isinstance(menu_button, dict):
        raise BotProvisioningError(f"{PRESENTATION_SECTION}.menu_button must be an object")

    menu_text = str(menu_button.get("text") or "").strip()
    if not menu_text:
        raise BotProvisioningError(f"{PRESENTATION_SECTION}.menu_button.text is required")
    if len(menu_text) > int(limits["menu_button_text_max"]):
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.menu_button.text length must be <= {limits['menu_button_text_max']}"
        )

    raw_url = str(menu_button.get("web_app_url") or "").strip()
    if not raw_url:
        raise BotProvisioningError(f"{PRESENTATION_SECTION}.menu_button.web_app_url is required")

    normalized_url, url_changed = normalize_menu_button_url(raw_url, bot_key)
    if normalize_menu_url and url_changed:
        changes.append(
            f"Normalized {PRESENTATION_SECTION}.menu_button.web_app_url to include bot-key={bot_key}"
        )
    elif not normalize_menu_url and normalized_url != raw_url:
        raise BotProvisioningError(
            f"{PRESENTATION_SECTION}.menu_button.web_app_url must contain correct bot-key={bot_key}"
        )

    normalized["menu_button"] = {
        "text": menu_text,
        "web_app_url": normalized_url,
    }

    profile_value = str(normalized.get("profile_photo_path") or "").strip()
    if profile_value:
        resolve_profile_photo_path(profile_value, repo_root, require_exists=require_photo_exists)
        normalized["profile_photo_path"] = profile_value
    else:
        normalized.pop("profile_photo_path", None)

    return normalized, changes


def resolve_expected_username(config: Dict[str, Any], presentation: Dict[str, Any]) -> str:
    root_username = str(config.get("username") or "").strip().lstrip("@")
    if root_username:
        if not validate_bot_username(root_username):
            raise BotProvisioningError("username must match Telegram username format")
        return root_username

    presentation_username = str(presentation.get("username") or "").strip().lstrip("@")
    if presentation_username:
        if not validate_bot_username(presentation_username):
            raise BotProvisioningError(
                f"{PRESENTATION_SECTION}.username must match Telegram username format"
            )
        return presentation_username

    url_username = parse_username_from_url(str(config.get("telegram_url") or ""))
    if url_username:
        if not validate_bot_username(url_username):
            raise BotProvisioningError("telegram_url must contain a valid Telegram username")
        return url_username

    raise BotProvisioningError(
        "Missing bot username: set root 'username' (preferred), "
        f"or '{PRESENTATION_SECTION}.username', "
        "or a parseable 'telegram_url' (or pass --skip-username-check)"
    )


def load_existing_bot_configs(bots_dir: Path) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Path]]:
    configs: Dict[str, Dict[str, Any]] = {}
    paths: Dict[str, Path] = {}

    files = sorted(p for p in bots_dir.glob("*.json") if p.is_file())
    if not files:
        raise BotProvisioningError(f"No bot templates found in {bots_dir}")

    for path in files:
        try:
            data = read_json(path)
        except json.JSONDecodeError as exc:
            raise BotProvisioningError(f"Invalid JSON in {path}: {exc}") from exc
        bot_key = str(data.get("bot_key") or "").strip()
        if not bot_key:
            raise BotProvisioningError(f"Missing bot_key in {path}")
        if bot_key in configs:
            raise BotProvisioningError(
                f"Duplicate bot_key={bot_key} in {paths[bot_key]} and {path}"
            )
        locale = data.get("locale")
        if not isinstance(locale, dict):
            raise BotProvisioningError(f"Missing locale object in {path}")

        configs[bot_key] = data
        paths[bot_key] = path

    return configs, paths


class TelegramBotClient:
    def __init__(self, token: str):
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}"

    def _request(self, method: str, *, json_payload: Optional[Dict[str, Any]] = None, data: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}/{method}"
        req_headers = headers or {}
        body = data
        if json_payload is not None:
            body = json.dumps(json_payload).encode("utf-8")
            req_headers = {**req_headers, "Content-Type": "application/json; charset=utf-8"}

        max_attempts = 5
        for attempt in range(1, max_attempts + 1):
            req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
            raw_body = b""
            status_code = 0
            try:
                with urllib.request.urlopen(req, timeout=35) as response:
                    status_code = response.getcode()
                    raw_body = response.read()
            except urllib.error.HTTPError as exc:
                status_code = exc.code or 0
                raw_body = exc.read() or b""
            except urllib.error.URLError as exc:
                if attempt < max_attempts:
                    time.sleep(min(2 * attempt, 5))
                    continue
                raise TelegramApiError(f"{method} failed: {exc}") from exc

            parsed = {}
            if raw_body:
                try:
                    parsed = json.loads(raw_body.decode("utf-8"))
                except json.JSONDecodeError:
                    parsed = {}

            if parsed.get("ok") is True:
                return parsed

            retry_after = 0
            parameters = parsed.get("parameters")
            if isinstance(parameters, dict):
                value = parameters.get("retry_after")
                if isinstance(value, int):
                    retry_after = value

            if status_code == 429 and retry_after > 0 and attempt < max_attempts:
                time.sleep(retry_after)
                continue

            description = parsed.get("description") if isinstance(parsed, dict) else ""
            err = f"{method} failed (HTTP {status_code})"
            if description:
                err += f": {description}"
            raise TelegramApiError(err)

        raise TelegramApiError(f"{method} failed after retries")

    def call_json(self, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request(method, json_payload=payload)

    def set_profile_photo(self, photo_path: Path) -> Dict[str, Any]:
        if not photo_path.exists() or not photo_path.is_file():
            raise TelegramApiError(f"Profile photo file not found: {photo_path}")

        boundary = f"----CodexBoundary{int(time.time() * 1000)}"
        mime_type = mimetypes.guess_type(str(photo_path))[0] or "application/octet-stream"
        file_bytes = photo_path.read_bytes()
        attach_name = "profile_photo"
        photo_descriptor = json.dumps(
            {
                "type": "static",
                "photo": f"attach://{attach_name}",
            },
            ensure_ascii=False,
        )

        chunks: List[bytes] = []
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                'Content-Disposition: form-data; name="photo"\r\n\r\n'
            ).encode("utf-8")
        )
        chunks.append(photo_descriptor.encode("utf-8"))
        chunks.append(b"\r\n")
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{attach_name}"; filename="{photo_path.name}"\r\n'
                f"Content-Type: {mime_type}\r\n\r\n"
            ).encode("utf-8")
        )
        chunks.append(file_bytes)
        chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
        payload = b"".join(chunks)

        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        return self._request("setMyProfilePhoto", data=payload, headers=headers)


def configure_bot_via_api(
    *,
    bot_key: str,
    token: str,
    presentation: Dict[str, Any],
    expected_username: Optional[str],
    profile_photo: Optional[Path],
    dry_run: bool,
) -> List[str]:
    steps: List[str] = []

    if dry_run:
        steps.extend(
            [
                "DRY-RUN: getMe",
                "DRY-RUN: setMyName",
                "DRY-RUN: setMyDescription",
                "DRY-RUN: setMyShortDescription",
                "DRY-RUN: setMyCommands(scope=all_private_chats)",
                "DRY-RUN: setChatMenuButton",
            ]
        )
        if profile_photo:
            steps.append("DRY-RUN: setMyProfilePhoto")
        return steps

    client = TelegramBotClient(token)

    me = client.call_json("getMe", {})
    username = str((me.get("result") or {}).get("username") or "").strip().lower()
    normalized_expected = (expected_username or "").strip().lower()
    if normalized_expected and username != normalized_expected:
        raise TelegramApiError(
            f"Token username mismatch: expected @{normalized_expected}, got @{username or 'unknown'}"
        )
    steps.append("getMe")

    client.call_json("setMyName", {"name": presentation["name"]})
    steps.append("setMyName")

    client.call_json("setMyDescription", {"description": presentation["description"]})
    steps.append("setMyDescription")

    client.call_json(
        "setMyShortDescription",
        {"short_description": presentation["short_description"]},
    )
    steps.append("setMyShortDescription")

    client.call_json(
        "setMyCommands",
        {
            "scope": {"type": "all_private_chats"},
            "commands": presentation["commands"],
        },
    )
    steps.append("setMyCommands(scope=all_private_chats)")

    client.call_json(
        "setChatMenuButton",
        {
            "menu_button": {
                "type": "web_app",
                "text": presentation["menu_button"]["text"],
                "web_app": {"url": presentation["menu_button"]["web_app_url"]},
            }
        },
    )
    steps.append("setChatMenuButton")

    if profile_photo:
        client.set_profile_photo(profile_photo)
        steps.append("setMyProfilePhoto")

    return steps


def resolve_miniapp_url_base(value: str) -> str:
    raw = value.strip()
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise BotProvisioningError(f"Invalid --miniapp-url-base URL: {value}")
    return raw.rstrip("/")


def contract_path_from_arg(repo_root: Path, source_arg: Optional[str]) -> Path:
    source = source_arg or DEFAULT_CONTRACT_PATH
    path = Path(source)
    if not path.is_absolute():
        path = (repo_root / path).resolve()
    return path


def collect_bot_input(
    idx: int,
    total: int,
    template_keys: List[str],
    templates: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    print(f"\n--- Bot {idx}/{total} ---")
    base_language = normalize_lang_code(prompt_text("base_language (e.g. uk)"))
    learning_language = normalize_lang_code(prompt_text("learning_language (e.g. en)"))
    bot_key = f"{base_language}-{learning_language}"

    template_default = select_default_template_key(base_language, learning_language, template_keys, templates)
    base_matches = [
        key
        for key in template_keys
        if str(templates[key].get("base_language") or "").strip().lower() == base_language
    ]
    if not base_matches:
        print(
            f"Note: no existing template with base_language='{base_language}'. "
            "Locale/prompts will be cloned from another base language template."
        )
        print("Available templates:")
        for key in template_keys:
            t_base = str(templates[key].get("base_language") or "").strip().lower()
            t_learn = str(templates[key].get("learning_language") or "").strip().lower()
            print(f"  - {key} (base={t_base}, learning={t_learn})")

    while True:
        template_bot_key = prompt_text(
            "template_bot_key (source template, not new bot_key)",
            default=template_default,
            required=True,
        )
        if template_bot_key == bot_key and template_bot_key not in templates:
            print(
                f"{template_bot_key} is your target new bot key. "
                "Choose an existing template key to clone locale/prompts."
            )
            continue
        if template_bot_key in templates:
            break
        print(f"Unknown template_bot_key: {template_bot_key}")
        print(f"Available: {', '.join(template_keys)}")

    template = templates[template_bot_key]

    username = prompt_text(
        "bot_username (without @)",
        validator=validate_bot_username,
        error_message="Username must match Telegram bot username format (5-32 chars: A-Z, a-z, 0-9, _).",
    ).lstrip("@")
    bot_name = prompt_text("bot_name", default=str(template.get("bot_name") or ""))
    avatar_emoji = prompt_text("teacher_avatar_emoji", default=str(template.get("teacher_avatar_emoji") or ""))
    tagline_uk = prompt_text("teacher_tagline_uk", default=str(template.get("teacher_tagline_uk") or ""))
    tagline_en = prompt_text("teacher_tagline_en", default=str(template.get("teacher_tagline_en") or ""))
    tagline_it = prompt_text(
        "teacher_tagline_it (optional)",
        required=False,
        default=str(template.get("teacher_tagline_it") or ""),
    )

    style_tags_default = ", ".join(
        [str(x).strip() for x in (template.get("teacher_style_tags") or []) if str(x).strip()]
    )
    style_tags = parse_tags(prompt_text("teacher_style_tags (comma-separated)", default=style_tags_default))
    bot_voice = prompt_text("bot_voice", default=str(template.get("bot_voice") or "nova"))
    telegram_bot_token = prompt_text(
        "telegram_bot_token (from BotFather /newbot)",
        validator=validate_bot_token,
        error_message="Token must look like '<digits>:<secret>'",
        secret=True,
    )
    photo_raw = prompt_text("profile_photo_path (optional, repo-relative)", required=False, default="")

    return {
        "bot_key": bot_key,
        "base_language": base_language,
        "learning_language": learning_language,
        "template_bot_key": template_bot_key,
        "bot_username": username,
        "bot_name": bot_name,
        "teacher_avatar_emoji": avatar_emoji,
        "teacher_tagline_uk": tagline_uk,
        "teacher_tagline_en": tagline_en,
        "teacher_tagline_it": tagline_it,
        "teacher_style_tags": style_tags,
        "bot_voice": bot_voice,
        "telegram_bot_token": telegram_bot_token,
        "profile_photo_path": photo_raw,
    }


def build_bot_config(template: Dict[str, Any], intake: Dict[str, Any], miniapp_url_base: str) -> Dict[str, Any]:
    config = copy.deepcopy(template)
    config["bot_key"] = intake["bot_key"]
    config["base_language"] = intake["base_language"]
    config["learning_language"] = intake["learning_language"]
    config["bot_name"] = intake["bot_name"]
    config["teacher_avatar_emoji"] = intake["teacher_avatar_emoji"]
    config["teacher_tagline_uk"] = intake["teacher_tagline_uk"]
    config["teacher_tagline_en"] = intake["teacher_tagline_en"]
    if intake["teacher_tagline_it"]:
        config["teacher_tagline_it"] = intake["teacher_tagline_it"]
    else:
        config.pop("teacher_tagline_it", None)
    config["teacher_style_tags"] = intake["teacher_style_tags"]
    config["bot_voice"] = intake["bot_voice"]
    config["telegram_url"] = f"https://t.me/{intake['bot_username']}"
    config["username"] = intake["bot_username"]
    config.pop("telegram_bot_token", None)

    base = intake["base_language"]
    description = first_non_empty(
        [
            str(config.get(f"teacher_tagline_{base}") or ""),
            str(config.get("teacher_tagline_en") or ""),
            str(config.get("teacher_tagline_uk") or ""),
            str(config.get("teacher_tagline_it") or ""),
            f"Language practice bot for {str(config.get('learning_language') or '').upper()}.",
        ]
    )
    description_with_link = with_website_url(description, base)
    menu_text = localized_menu_text(base)

    presentation = {
        "name": localized_presentation_name(
            str(config.get("bot_name") or intake["bot_key"]),
            str(config.get("base_language") or intake["base_language"]),
            str(config.get("learning_language") or intake["learning_language"]),
        ),
        "description": clamp(description_with_link, 512),
        "short_description": clamp(description, 120),
        "commands": localized_commands(base),
        "menu_button": {
            "text": clamp(menu_text, 14),
            "web_app_url": f"{miniapp_url_base.rstrip('/')}/?bot-key={intake['bot_key']}",
        },
        "username": intake["bot_username"],
    }
    profile_photo_path = str(intake.get("profile_photo_path") or "").strip()
    if profile_photo_path:
        presentation["profile_photo_path"] = profile_photo_path

    config[PRESENTATION_SECTION] = presentation
    return config


# `apply` treats deploy/bots/*.json as the source of truth and pushes the
# already-defined Telegram presentation settings to the live Bot API. It does
# not persist normalization back into the JSON files; any fixes stay in-memory
# for this run unless you separately run `sync --write`.
def run_apply(args: argparse.Namespace) -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = find_repo_root(script_dir)
    contract_path = contract_path_from_arg(repo_root, args.source)
    contract = load_contract(contract_path)

    bots_dir = Path(args.bots_dir)
    if not bots_dir.is_absolute():
        bots_dir = (repo_root / bots_dir).resolve()

    config_args = args.config or []
    if args.all and config_args:
        raise BotProvisioningError("apply mode accepts either --all or --config <path>, not both")

    config_paths: List[Path] = []
    if args.all:
        if not bots_dir.exists() or not bots_dir.is_dir():
            raise BotProvisioningError(f"Bots directory not found: {bots_dir}")
        config_paths = sorted(path.resolve() for path in bots_dir.glob("*.json") if path.is_file())
        if not config_paths:
            raise BotProvisioningError(f"No bot config JSON files found in {bots_dir}")
    else:
        if not config_args:
            raise BotProvisioningError("apply mode requires --all or at least one --config <path>")
        for raw in config_args:
            path = Path(raw)
            if not path.is_absolute():
                path = (repo_root / path).resolve()
            config_paths.append(path)

    for config_path in config_paths:
        config = read_json(config_path)
        validate_payload(config)
        resolve_bot_token(str(config["bot_key"]))

    summary: List[Dict[str, Any]] = []
    print(f"Repo root: {repo_root}")
    print(f"Contract: {contract_path}")
    if args.all:
        print(f"Bots dir: {bots_dir}")
    print(f"Applying Telegram settings for {len(config_paths)} config(s)")
    if args.dry_run:
        print("Mode: DRY-RUN (no Telegram API calls, no file writes)")

    for config_path in config_paths:
        bot_key = config_path.stem
        try:
            if not config_path.exists() or not config_path.is_file():
                raise BotProvisioningError(f"Config not found: {config_path}")

            try:
                config = read_json(config_path)
            except json.JSONDecodeError as exc:
                raise BotProvisioningError(f"Invalid JSON in {config_path}: {exc}") from exc

            validate_payload(config)
            bot_key = str(config.get("bot_key") or bot_key)

            normalized_presentation, normalization_changes = validate_presentation_section(
                config.get(PRESENTATION_SECTION),
                contract=contract,
                bot_key=bot_key,
                repo_root=repo_root,
                require_photo_exists=True,
                normalize_menu_url=True,
                expected_name=expected_presentation_name(config),
                fallback_username=config.get("username")
                or parse_username_from_url(str(config.get("telegram_url") or "")),
            )

            expected_username = None
            if not args.skip_username_check:
                expected_username = resolve_expected_username(config, normalized_presentation)

            profile_photo_path: Optional[Path] = None
            if args.profile_photo:
                override = Path(args.profile_photo).expanduser()
                if not override.is_absolute():
                    override = (Path.cwd() / override).resolve()
                if not override.exists() or not override.is_file():
                    raise BotProvisioningError(f"Profile photo file not found: {override}")
                profile_photo_path = override
            elif "profile_photo_path" in normalized_presentation:
                profile_photo_path = resolve_profile_photo_path(
                    normalized_presentation["profile_photo_path"], repo_root, require_exists=True
                )

            steps = configure_bot_via_api(
                bot_key=bot_key,
                token=resolve_bot_token(bot_key),
                presentation=normalized_presentation,
                expected_username=expected_username,
                profile_photo=profile_photo_path,
                dry_run=args.dry_run,
            )

            detail = f"Applied Telegram settings from {config_path}"
            if normalization_changes:
                detail += " (with in-memory URL normalization)"

            summary.append(
                {
                    "bot_key": bot_key,
                    "status": "OK" if not args.dry_run else "DRY-RUN",
                    "detail": detail,
                    "steps": steps,
                    "notes": normalization_changes,
                }
            )
        except (BotProvisioningError, TelegramApiError, ValueError, OSError) as exc:
            summary.append(
                {
                    "bot_key": bot_key,
                    "status": "FAILED",
                    "detail": str(exc),
                    "steps": [],
                    "notes": [],
                }
            )

    print("\n=== Apply Summary ===")
    ok = 0
    failed = 0
    for item in summary:
        status = item["status"]
        if status in ("OK", "DRY-RUN"):
            ok += 1
        if status == "FAILED":
            failed += 1
        print(f"- [{status}] {item['bot_key']}: {item['detail']}")
        for note in item.get("notes", []):
            print(f"    - note: {note}")
        for step in item["steps"]:
            print(f"    - {step}")

    print(f"\nResults: success={ok}, failed={failed}, total={len(summary)}")
    return 1 if failed else 0


# `sync` never talks to Telegram. It validates and normalizes the
# `telegram_presentation` section inside deploy/bots/*.json so the checked-in
# files match the contract. Without `--write` this is a dry-run validator.
def run_sync(args: argparse.Namespace) -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = find_repo_root(script_dir)
    contract_path = contract_path_from_arg(repo_root, args.source)
    contract = load_contract(contract_path)

    bots_dir = Path(args.bots_dir)
    if not bots_dir.is_absolute():
        bots_dir = (repo_root / bots_dir).resolve()

    if not bots_dir.exists() or not bots_dir.is_dir():
        raise BotProvisioningError(f"Bots directory not found: {bots_dir}")

    configs, paths = load_existing_bot_configs(bots_dir)
    selected_keys = sorted(configs.keys())
    if args.bot_key:
        requested = [str(x).strip() for x in args.bot_key if str(x).strip()]
        unknown = [key for key in requested if key not in configs]
        if unknown:
            raise BotProvisioningError(f"Unknown --bot-key values: {', '.join(sorted(unknown))}")
        selected_keys = sorted(set(requested))

    dry_run = bool(args.dry_run or not args.write)

    print(f"Repo root: {repo_root}")
    print(f"Contract: {contract_path}")
    print(f"Bots dir: {bots_dir}")
    print(f"Mode: {'WRITE' if args.write else 'DRY-RUN'}")
    print(f"Selected bots ({len(selected_keys)}): {', '.join(selected_keys)}")

    summary: List[Dict[str, Any]] = []

    for key in selected_keys:
        path = paths[key]
        try:
            config = configs[key]
            validate_payload(config)

            normalized_presentation, changes = validate_presentation_section(
                config.get(PRESENTATION_SECTION),
                contract=contract,
                bot_key=key,
                repo_root=repo_root,
                require_photo_exists=True,
                normalize_menu_url=True,
                expected_name=expected_presentation_name(config),
                fallback_username=config.get("username")
                or parse_username_from_url(str(config.get("telegram_url") or "")),
            )

            did_write = False
            if changes and args.write:
                config[PRESENTATION_SECTION] = normalized_presentation
                write_json_atomic(path, config)
                did_write = True

            if changes and dry_run:
                status = "DRY-RUN"
                detail = f"{path.name} requires normalization"
            elif did_write:
                status = "UPDATED"
                detail = f"{path.name} normalized and written"
            else:
                status = "OK"
                detail = f"{path.name} valid"

            summary.append(
                {
                    "bot_key": key,
                    "status": status,
                    "detail": detail,
                    "notes": changes,
                }
            )
        except (BotProvisioningError, ValueError, OSError) as exc:
            summary.append(
                {
                    "bot_key": key,
                    "status": "FAILED",
                    "detail": str(exc),
                    "notes": [],
                }
            )

    print("\n=== Sync Summary ===")
    failed = 0
    for item in summary:
        if item["status"] == "FAILED":
            failed += 1
        print(f"- [{item['status']}] {item['bot_key']}: {item['detail']}")
        for note in item.get("notes", []):
            print(f"    - {note}")

    print(f"\nResults: failed={failed}, total={len(summary)}")
    return 1 if failed else 0


def run_interactive(args: argparse.Namespace) -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = find_repo_root(script_dir)
    contract_path = contract_path_from_arg(repo_root, args.source)
    contract = load_contract(contract_path)

    bots_dir = Path(args.bots_dir)
    if not bots_dir.is_absolute():
        bots_dir = (repo_root / bots_dir).resolve()

    if not bots_dir.exists() or not bots_dir.is_dir():
        raise BotProvisioningError(f"Bots directory not found: {bots_dir}")

    miniapp_url_base = resolve_miniapp_url_base(args.miniapp_url_base)
    templates, _paths = load_existing_bot_configs(bots_dir)
    template_keys = sorted(templates.keys())

    print(f"Repo root: {repo_root}")
    print(f"Contract: {contract_path}")
    print(f"Bots dir: {bots_dir}")
    print(f"Template candidates ({len(template_keys)}): {', '.join(template_keys)}")
    if args.dry_run:
        print("Mode: DRY-RUN (no Telegram API calls, no file writes)")

    count = prompt_int("How many bots do you want to provision", minimum=1)
    seen_run_keys = set()
    summary: List[Dict[str, Any]] = []

    for idx in range(1, count + 1):
        intake: Optional[Dict[str, Any]] = None
        try:
            intake = collect_bot_input(idx, count, template_keys, templates)
            bot_key = intake["bot_key"]

            if bot_key in seen_run_keys:
                raise BotProvisioningError(f"Duplicate bot_key in this run: {bot_key}")
            seen_run_keys.add(bot_key)

            template = templates[intake["template_bot_key"]]
            config = build_bot_config(template, intake, miniapp_url_base)
            validate_payload(config)

            normalized_presentation, changes = validate_presentation_section(
                config.get(PRESENTATION_SECTION),
                contract=contract,
                bot_key=bot_key,
                repo_root=repo_root,
                require_photo_exists=False,
                normalize_menu_url=True,
                expected_name=expected_presentation_name(config),
                fallback_username=config.get("username")
                or parse_username_from_url(str(config.get("telegram_url") or "")),
            )
            config[PRESENTATION_SECTION] = normalized_presentation

            profile_photo = None
            if "profile_photo_path" in normalized_presentation:
                profile_photo = resolve_profile_photo_path(
                    normalized_presentation["profile_photo_path"], repo_root, require_exists=True
                )

            target_path = bots_dir / f"{bot_key}.json"
            if target_path.exists() and not args.overwrite_existing:
                should_overwrite = prompt_yes_no(
                    f"{target_path.name} already exists. Overwrite?", default=False
                )
                if not should_overwrite:
                    summary.append(
                        {
                            "bot_key": bot_key,
                            "status": "SKIPPED",
                            "detail": f"User chose not to overwrite existing file {target_path.name}",
                            "steps": [],
                            "notes": [],
                        }
                    )
                    continue

            if not args.dry_run:
                store_bot_token(bot_key, intake["telegram_bot_token"])

            steps = configure_bot_via_api(
                bot_key=bot_key,
                token=intake["telegram_bot_token"],
                presentation=normalized_presentation,
                expected_username=None
                if args.skip_username_check
                else resolve_expected_username(config, normalized_presentation),
                profile_photo=profile_photo,
                dry_run=args.dry_run,
            )

            if not args.dry_run:
                write_json_atomic(target_path, config)

            summary.append(
                {
                    "bot_key": bot_key,
                    "status": "OK" if not args.dry_run else "DRY-RUN",
                    "detail": (
                        f"Prepared {target_path}"
                        if not args.dry_run
                        else f"Would write {target_path}"
                    ),
                    "steps": steps,
                    "notes": changes,
                }
            )
        except (BotProvisioningError, TelegramApiError, ValueError, OSError) as exc:
            summary.append(
                {
                    "bot_key": intake.get("bot_key", f"#{idx}") if intake else f"#{idx}",
                    "status": "FAILED",
                    "detail": str(exc),
                    "steps": [],
                    "notes": [],
                }
            )

    print("\n=== Provisioning Summary ===")
    ok = 0
    failed = 0
    for item in summary:
        status = item["status"]
        if status in ("OK", "DRY-RUN"):
            ok += 1
        if status == "FAILED":
            failed += 1
        print(f"- [{status}] {item['bot_key']}: {item['detail']}")
        for note in item.get("notes", []):
            print(f"    - note: {note}")
        for step in item.get("steps", []):
            print(f"    - {step}")

    print(f"\nResults: success={ok}, failed={failed}, total={len(summary)}")
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Provision and sync Telegram bot presentation settings in deploy/bots/*.json "
            "using hard-cutover telegram_presentation section."
        ),
    )
    parser.add_argument(
        "mode",
        choices=["interactive", "apply", "sync"],
        help=(
            "Provisioning mode: interactive creates/updates configs and applies them; "
            "apply pushes existing config values to Telegram; sync validates or normalizes local JSON only"
        ),
    )
    parser.add_argument("--bots-dir", default="deploy/bots", help="Directory with bot config JSON files")
    parser.add_argument(
        "--miniapp-url-base",
        default=DEFAULT_MINIAPP_URL_BASE,
        help="Mini-app base URL used by interactive mode when creating new bots",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without Telegram API calls or file writes")
    parser.add_argument(
        "--overwrite-existing",
        action="store_true",
        help="Overwrite existing deploy/bots/<bot_key>.json files without per-file confirmation",
    )
    parser.add_argument(
        "--config",
        action="append",
        help="Path to bot config JSON. Repeat for multiple files. Used by apply mode.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Apply all bot config JSON files from --bots-dir in apply mode.",
    )
    parser.add_argument(
        "--profile-photo",
        help="Optional photo path to set via setMyProfilePhoto for all configs in apply mode.",
    )
    parser.add_argument(
        "--skip-username-check",
        action="store_true",
        help="Skip getMe username match check in apply mode.",
    )
    parser.add_argument(
        "--source",
        help=f"Path to YAML contract template (default: {DEFAULT_CONTRACT_PATH})",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help=(
            "Write normalized telegram_presentation data back to JSON files in sync mode. "
            "Without this flag sync only reports drift."
        ),
    )
    parser.add_argument(
        "--bot-key",
        action="append",
        help="Bot key filter for sync mode (repeatable).",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        # sync operates on public metadata and does not need private credentials.
        if args.mode in ("interactive", "apply"):
            private_file = api_env_path()
            if private_file.exists() or os.environ.get("API_ENV_FILE"):
                for name, value in read_private_env(private_file).items():
                    os.environ.setdefault(name, value)
        if args.mode == "interactive":
            return run_interactive(args)
        if args.mode == "apply":
            return run_apply(args)
        if args.mode == "sync":
            return run_sync(args)
        parser.error(f"Unsupported mode: {args.mode}")
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130
    except (BotProvisioningError, ValueError, OSError) as exc:
        # JSON errors can include source fragments; never echo malformed config values.
        message = "Invalid JSON configuration" if isinstance(exc, json.JSONDecodeError) else str(exc)
        print(f"ERROR: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
