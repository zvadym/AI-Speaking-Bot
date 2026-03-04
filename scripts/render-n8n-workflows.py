#!/usr/bin/env python3
import argparse
import copy
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]

EXPLICIT_ENV = {
    "openAiApi": "N8N_CRED_OPENAI_ID",
    "postgres": "N8N_CRED_POSTGRES_ID",
    # Note: telegramApi credentials come from bot config files (deploy/bots/*.json),
    # not from environment variables.
}

# Template workflow filenames (input_dir/*.json) that should be expanded into per-bot
# workflows when deploy/bots/*.json exists.
BOT_TEMPLATES = {
    "ai-bot.json": "ai-bot",
    "loader-messages-rotator.json": "loader-messages-rotator",
}

PROMPT_KEYS = (
    "model_system_prompt",
    "model_support_prompt",
    "model_hints_prompt",
    "model_summary_prompt",
    "model_vocab_prompt",
)

PROMPT_TEMPLATE_FILES = {
    "model_system_prompt": "model_system_prompt.md",
    "model_support_prompt": "model_support_prompt.md",
    "model_hints_prompt": "model_hints_prompt.md",
    "model_summary_prompt": "model_summary_prompt.md",
    "model_vocab_prompt": "model_vocab_prompt.md",
}

TOPIC_LIBRARY_FALLBACK = "en"

COMMON_DETECTED_LANGUAGE_CODES = ("en", "de", "it", "uk", "ru")

PLACEHOLDER_RE = re.compile(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}")

# Basic language name mapping for common ISO 639-1 codes
LANGUAGE_LABELS = {
    "en": "English",
    "de": "German",
    "es": "Spanish",
    "it": "Italian",
    "fr": "French",
    "pt": "Portuguese",
    "ru": "Russian",
    "uk": "Ukrainian",
    "pl": "Polish",
    "nl": "Dutch",
    "sv": "Swedish",
    "da": "Danish",
    "no": "Norwegian",
    "fi": "Finnish",
    "cs": "Czech",
    "sk": "Slovak",
    "hu": "Hungarian",
    "ro": "Romanian",
    "bg": "Bulgarian",
    "hr": "Croatian",
    "sr": "Serbian",
    "sl": "Slovenian",
    "tr": "Turkish",
    "ar": "Arabic",
    "he": "Hebrew",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "hi": "Hindi",
    "th": "Thai",
    "vi": "Vietnamese",
}

EXPLANATION_TITLES = {
    # User-facing title used in explanation_html blocks.
    "en": "Explanation",
    "de": "Erklärung",
    "it": "Spiegazione",
    "uk": "Пояснення",
    "ru": "Пояснение",
}


def to_env_key(credential_type: str) -> str:
    if credential_type in EXPLICIT_ENV:
        return EXPLICIT_ENV[credential_type]
    # Convert camelCase or kebab-case to UPPER_SNAKE.
    s = re.sub(r"[^A-Za-z0-9]", "_", credential_type)
    s = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", s)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    s = s.upper()
    return f"N8N_CRED_{s}_ID"


def iter_workflow_files(input_dir: Path) -> List[Path]:
    return sorted([p for p in input_dir.glob("*.json") if p.is_file()])


def load_json(path: Path) -> Dict[str, Any]:
    with path.open() as f:
        return json.load(f)


def write_json(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def normalize_language_code(value: Any) -> str:
    return str(value or "").strip().lower()


def resolve_path(path_str: str) -> Path:
    p = Path(path_str)
    if p.is_absolute():
        return p
    return (REPO_ROOT / p).resolve()


def get_language_label(code: str) -> str:
    """Get human-readable language name from ISO code."""
    return LANGUAGE_LABELS.get(code, code.upper())


def load_prompt_templates(prompts_dir: Path) -> Dict[str, str]:
    templates: Dict[str, str] = {}
    for key, filename in PROMPT_TEMPLATE_FILES.items():
        path = prompts_dir / filename
        if not path.exists():
            raise ValueError(f"Missing prompt template file: {path}")
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise ValueError(f"Prompt template file is empty: {path}")
        templates[key] = text
    return templates


def load_topic_templates(topics_dir: Path, base_language_code: str) -> List[Dict[str, Any]]:
    code = normalize_language_code(base_language_code) or TOPIC_LIBRARY_FALLBACK
    candidates = [topics_dir / f"{code}.json"]
    if code != TOPIC_LIBRARY_FALLBACK:
        candidates.append(topics_dir / f"{TOPIC_LIBRARY_FALLBACK}.json")

    source_path: Optional[Path] = None
    for path in candidates:
        if path.exists():
            source_path = path
            break

    if source_path is None:
        raise ValueError(
            f"Missing topic template file for base language {code!r} in {topics_dir}"
        )

    try:
        data = json.loads(source_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid topic template JSON in {source_path}: {e}") from e

    templates = data.get("templates")
    if not isinstance(templates, list) or not templates:
        raise ValueError(f"Topic template file has no templates: {source_path}")

    out: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    for entry in templates:
        if not isinstance(entry, dict):
            raise ValueError(f"Topic template entries must be objects in {source_path}")
        topic_id = str(entry.get("id") or "").strip().lower()
        title = str(entry.get("title") or "").strip()
        goal = str(entry.get("goal") or "").strip()
        allowed = entry.get("allowed")
        avoid = entry.get("avoid")
        if not topic_id or not title or not goal:
            raise ValueError(f"Topic template is missing id/title/goal in {source_path}")
        if topic_id in seen_ids:
            raise ValueError(f"Duplicate topic template id {topic_id!r} in {source_path}")
        if not isinstance(allowed, list) or not all(isinstance(x, str) and x.strip() for x in allowed):
            raise ValueError(f"Topic template {topic_id!r} has invalid allowed list in {source_path}")
        if not isinstance(avoid, list) or not all(isinstance(x, str) and x.strip() for x in avoid):
            raise ValueError(f"Topic template {topic_id!r} has invalid avoid list in {source_path}")
        seen_ids.add(topic_id)
        out.append(
            {
                "id": topic_id,
                "title": title,
                "goal": goal,
                "allowed": [str(x).strip() for x in allowed],
                "avoid": [str(x).strip() for x in avoid],
            }
        )
    return out


def render_template_strict(template: str, context: Dict[str, str], *, template_name: str) -> str:
    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in context:
            raise ValueError(f"Template {template_name} has unknown placeholder: {key}")
        return str(context[key])

    rendered = PLACEHOLDER_RE.sub(repl, template)
    unresolved = sorted(set(PLACEHOLDER_RE.findall(rendered)))
    if unresolved:
        raise ValueError(
            f"Template {template_name} left unresolved placeholders: {', '.join(unresolved)}"
        )
    return rendered


def build_prompt_context(
    *,
    bot_key: str,
    bot_name: str,
    base_language_code: str,
    target_language_code: str,
) -> Dict[str, str]:
    """
    Build context for rendering prompt templates.
    Uses English defaults for instruction examples - the AI model understands
    English instructions and will respond in the appropriate base_language.
    """
    english_style_rule = (
        '- For target_language_code "en": keep a light British English vibe '
        '(spelling and a few gentle Britishisms like "cheers", "brilliant", "mate"), '
        "but avoid heavy slang and keep it clear for learners."
        if target_language_code == "en"
        else ""
    )
    return {
        "bot_name": bot_name,
        "bot_key": bot_key,
        "base_language_code": base_language_code,
        "target_language_code": target_language_code,
        "base_language_label": get_language_label(base_language_code),
        "target_language_label": get_language_label(target_language_code),
        # Instruction fields - AI understands English, will respond in base_language
        "explanation_title": EXPLANATION_TITLES.get(base_language_code, "Explanation"),
        "article_gender_example": (
            "we need the article ... and we use ..., because the noun has ... gender"
        ),
        "vague_reason_example": "this sounds better",
        "english_style_rule": english_style_rule,
    }


def compose_locale_with_generated_prompts(
    locale: Dict[str, Any],
    prompt_templates: Dict[str, str],
    prompt_context: Dict[str, str],
    topic_templates: List[Dict[str, Any]],
    *,
    bot_key: str,
) -> Dict[str, Any]:
    def normalize_locale_value(value: Any) -> Any:
        if isinstance(value, str):
            # Bot configs sometimes contain literal "\\n" sequences. Telegram will display them as "\n"
            # unless we normalize them to actual newlines before embedding into workflows.
            return value.replace("\\r\\n", "\n").replace("\\n", "\n")
        if isinstance(value, list):
            return [normalize_locale_value(v) for v in value]
        return value

    merged = {k: normalize_locale_value(v) for k, v in dict(locale).items()}

    base_language_code = normalize_language_code(prompt_context.get("base_language_code"))
    hints_section_defaults: Dict[str, str]
    if base_language_code == "de":
        hints_section_defaults = {
            "hints_section_question": "Frage:",
            "hints_section_simple": "Einfache Variante:",
            "hints_section_conversational": "Gesprächsvariante:",
            "hints_section_advanced": "Fortgeschrittene Variante:",
            "hints_section_phrases": "Nützliche Phrasen:",
        }
    elif base_language_code == "it":
        hints_section_defaults = {
            "hints_section_question": "Domanda:",
            "hints_section_simple": "Versione semplice:",
            "hints_section_conversational": "Versione colloquiale:",
            "hints_section_advanced": "Versione avanzata:",
            "hints_section_phrases": "Frasi utili:",
        }
    elif base_language_code == "uk":
        hints_section_defaults = {
            "hints_section_question": "Питання:",
            "hints_section_simple": "Простий варіант:",
            "hints_section_conversational": "Розмовний варіант:",
            "hints_section_advanced": "Просунутий варіант:",
            "hints_section_phrases": "Корисні фрази:",
        }
    else:
        # Default to English (includes base_language_code == "en" and unknown codes).
        hints_section_defaults = {
            "hints_section_question": "Question:",
            "hints_section_simple": "Simple version:",
            "hints_section_conversational": "Conversational version:",
            "hints_section_advanced": "Advanced version:",
            "hints_section_phrases": "Useful phrases:",
        }

    for key, default_value in hints_section_defaults.items():
        current = merged.get(key)
        if not isinstance(current, str) or not current.strip():
            merged[key] = default_value

    if base_language_code == "de":
        vocab_defaults = {
            "btn_vocab": "Vokabeln 📚",
            "callback_vocab_loading": "Sammle Wörter...",
            "vocab_header": "📚 Vokabeln aus meiner Antwort:",
            "vocab_empty": "Ich konnte keine nützlichen Vokabeln in dieser Antwort finden.",
        }
    elif base_language_code == "it":
        vocab_defaults = {
            "btn_vocab": "Vocabolario 📚",
            "callback_vocab_loading": "Raccolgo parole...",
            "vocab_header": "📚 Vocabolario dalla mia risposta:",
            "vocab_empty": "Non ho trovato vocaboli utili in questa risposta.",
        }
    elif base_language_code == "uk":
        vocab_defaults = {
            "btn_vocab": "Словничок 📚",
            "callback_vocab_loading": "Збираю слова...",
            "vocab_header": "📚 Словничок з моєї відповіді:",
            "vocab_empty": "Не знайшов корисних слів для словничка в цій відповіді.",
        }
    else:
        vocab_defaults = {
            "btn_vocab": "Vocab 📚",
            "callback_vocab_loading": "Collecting words...",
            "vocab_header": "📚 Vocab from my reply:",
            "vocab_empty": "I couldn't find useful vocab in this reply.",
        }

    for key, default_value in vocab_defaults.items():
        current = merged.get(key)
        if not isinstance(current, str) or not current.strip():
            merged[key] = default_value

    if base_language_code == "de":
        topic_defaults = {
            "msg_private_only": "Dieser Bot funktioniert nur im privaten Chat.",
            "topic_menu_title": "Waehle ein Gesprächsthema 👇",
            "topic_menu_current_none": "Aktuelles Thema: keines aktiv.",
            "topic_menu_current_prefix": "Aktuelles Thema: ",
            "topic_private_only": "Themen funktionieren nur im privaten Chat mit dem Bot.",
            "topic_btn_change": "Aendern",
            "topic_btn_clear": "Thema loeschen",
            "topic_card_title_prefix": "📌 Thema: ",
            "topic_card_goal_prefix": "Ziel: ",
            "topic_allowed_prefix": "Erlaubt: ",
            "topic_avoid_prefix": "Vermeiden: ",
            "topic_card_rules_line": "Ich bleibe bei diesem Thema. Zum Wechseln nutze /topic.",
            "topic_clear_done": "Thema entfernt. Mit /topic kannst du ein neues waehlen.",
        }
    elif base_language_code == "it":
        topic_defaults = {
            "msg_private_only": "Questo bot funziona solo nella chat privata.",
            "topic_menu_title": "Scegli un argomento 👇",
            "topic_menu_current_none": "Argomento attuale: nessuno attivo.",
            "topic_menu_current_prefix": "Argomento attuale: ",
            "topic_private_only": "Gli argomenti funzionano solo nella chat privata con il bot.",
            "topic_btn_change": "Cambia",
            "topic_btn_clear": "Rimuovi argomento",
            "topic_card_title_prefix": "📌 Argomento: ",
            "topic_card_goal_prefix": "Obiettivo: ",
            "topic_allowed_prefix": "Consentito: ",
            "topic_avoid_prefix": "Evita: ",
            "topic_card_rules_line": "Resto su questo argomento. Per cambiarlo usa /topic.",
            "topic_clear_done": "Argomento rimosso. Usa /topic per sceglierne un altro.",
        }
    elif base_language_code == "uk":
        topic_defaults = {
            "msg_private_only": "Цей бот працює лише в приватному чаті.",
            "topic_menu_title": "Обери тему розмови 👇",
            "topic_menu_current_none": "Поточна тема: зараз не активна.",
            "topic_menu_current_prefix": "Поточна тема: ",
            "topic_private_only": "Теми працюють лише в приватному чаті з ботом.",
            "topic_btn_change": "Змінити",
            "topic_btn_clear": "Прибрати тему",
            "topic_card_title_prefix": "📌 Тема: ",
            "topic_card_goal_prefix": "Мета: ",
            "topic_allowed_prefix": "Можна: ",
            "topic_avoid_prefix": "Уникати: ",
            "topic_card_rules_line": "Я триматимуся цієї теми. Щоб змінити її, використай /topic.",
            "topic_clear_done": "Тему прибрано. Командою /topic можна обрати нову.",
        }
    else:
        topic_defaults = {
            "msg_private_only": "This bot works only in a private chat.",
            "topic_menu_title": "Choose a conversation topic 👇",
            "topic_menu_current_none": "Current topic: none active.",
            "topic_menu_current_prefix": "Current topic: ",
            "topic_private_only": "Topics work only in a private chat with the bot.",
            "topic_btn_change": "Change",
            "topic_btn_clear": "Clear topic",
            "topic_card_title_prefix": "📌 Topic: ",
            "topic_card_goal_prefix": "Goal: ",
            "topic_allowed_prefix": "Allowed: ",
            "topic_avoid_prefix": "Avoid: ",
            "topic_card_rules_line": "I'll stay on this topic. To switch, use /topic.",
            "topic_clear_done": "Topic cleared. Use /topic to choose a new one.",
        }

    for key, default_value in topic_defaults.items():
        current = merged.get(key)
        if not isinstance(current, str) or not current.strip():
            merged[key] = default_value

    merged["topic_templates_json"] = json.dumps(
        {"templates": topic_templates}, ensure_ascii=False
    )

    deprecated_present = [k for k in PROMPT_KEYS if k in merged]
    if deprecated_present:
        print(
            f"Warning: {bot_key} locale contains deprecated prompt keys: {', '.join(sorted(deprecated_present))}. "
            "Using generated templates instead.",
            file=sys.stderr,
        )
    for prompt_key in PROMPT_KEYS:
        tmpl = prompt_templates.get(prompt_key)
        if tmpl is None:
            raise ValueError(f"Prompt template missing for key: {prompt_key}")
        merged[prompt_key] = render_template_strict(
            tmpl, prompt_context, template_name=f"{prompt_key} ({bot_key})"
        )
    return merged


def build_detected_language_enum(base_language: str, learning_language: str) -> List[str]:
    out: List[str] = []
    for code in (*COMMON_DETECTED_LANGUAGE_CODES, base_language, learning_language, "other"):
        c = normalize_language_code(code)
        if c and c not in out:
            out.append(c)
    if "other" not in out:
        out.append("other")
    return out


def patch_message_model_node(ai_data: Dict[str, Any], base_language: str, learning_language: str) -> None:
    node = find_node(ai_data, "Message a model")
    params = node.get("parameters")
    if not isinstance(params, dict):
        raise ValueError("Message a model node parameters missing/invalid")

    responses = params.get("responses")
    values = (responses or {}).get("values") if isinstance(responses, dict) else None
    if isinstance(values, list):
        for msg in values:
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if not isinstance(content, str):
                continue
            msg["content"] = content.replace(
                "Summary so far (UA):", "Summary so far (base language):"
            )

    options = params.get("options")
    text_format = (options or {}).get("textFormat") if isinstance(options, dict) else None
    text_opts = (text_format or {}).get("textOptions") if isinstance(text_format, dict) else None
    schema_raw = text_opts.get("schema") if isinstance(text_opts, dict) else None
    if not isinstance(schema_raw, str):
        raise ValueError("Message a model schema missing/invalid")

    try:
        schema_obj = json.loads(schema_raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Message a model schema JSON is invalid: {e}") from e

    props = schema_obj.get("properties")
    if not isinstance(props, dict):
        raise ValueError("Message a model schema properties missing/invalid")

    detected = props.get("detected_language")
    if not isinstance(detected, dict):
        raise ValueError("Message a model schema detected_language property missing/invalid")

    detected["enum"] = build_detected_language_enum(base_language, learning_language)
    text_opts["schema"] = json.dumps(schema_obj, indent=2, ensure_ascii=False)


def find_required_env(files: List[Path], *, ignore_types: Optional[Set[str]] = None) -> Dict[str, Set[str]]:
    env_to_types: Dict[str, Set[str]] = {}
    ignore = ignore_types or set()
    for path in files:
        data = load_json(path)
        for node in data.get("nodes", []):
            creds = node.get("credentials")
            if not isinstance(creds, dict):
                continue
            for ctype in creds.keys():
                if ctype in ignore:
                    continue
                env_key = to_env_key(ctype)
                env_to_types.setdefault(env_key, set()).add(ctype)
    return env_to_types


def apply_env_credentials(
    data: Dict[str, Any], env_map: Dict[str, str], *, ignore_types: Optional[Set[str]] = None
) -> None:
    ignore = ignore_types or set()
    for node in data.get("nodes", []):
        creds = node.get("credentials")
        if not isinstance(creds, dict):
            continue
        for ctype, cdata in creds.items():
            if ctype in ignore:
                continue
            if ctype not in env_map:
                continue
            if not isinstance(cdata, dict):
                continue
            env_key = env_map[ctype]
            if os.environ.get(env_key):
                cdata["id"] = os.environ[env_key]


def find_node(data: Dict[str, Any], name: str) -> Dict[str, Any]:
    matches = [n for n in data.get("nodes", []) if n.get("name") == name]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one node named {name!r}, got {len(matches)}")
    return matches[0]


def set_telegram_credential_id(data: Dict[str, Any], telegram_credential_id: str) -> None:
    if not telegram_credential_id:
        return
    for node in data.get("nodes", []):
        creds = node.get("credentials")
        if not isinstance(creds, dict):
            continue
        tg = creds.get("telegramApi")
        if not isinstance(tg, dict):
            continue
        tg["id"] = telegram_credential_id


def deterministic_workflow_id(prefix: str, bot_key: str) -> str:
    # n8n accepts string IDs. Using deterministic uuid5 hex keeps imports stable.
    return uuid.uuid5(uuid.NAMESPACE_URL, f"{prefix}:{bot_key}").hex


def patch_webhook_ids_for_bot(workflow_data: Dict[str, Any], workflow_prefix: str, bot_key: str) -> None:
    """
    Ensure webhook paths are unique per bot workflow clone.
    n8n stores webhook path IDs on nodes as "webhookId". If we clone workflows
    without changing them, multiple bots conflict on activation.
    """
    nodes = workflow_data.get("nodes", [])
    if not isinstance(nodes, list):
        return

    for idx, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        webhook_id = node.get("webhookId")
        if not isinstance(webhook_id, str) or not webhook_id.strip():
            continue
        node_name = node.get("name") or f"node-{idx}"
        node_type = node.get("type") or "unknown"
        seed = f"webhook:{workflow_prefix}:{bot_key}:{idx}:{node_type}:{node_name}"
        node["webhookId"] = str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def patch_webhook_paths_for_bot(workflow_data: Dict[str, Any], bot_key: str) -> None:
    """
    Make n8n Webhook node paths unique per bot clone.

    In multi-bot mode, cloning a workflow that contains webhook triggers would otherwise
    create conflicting /webhook/<path> endpoints across bots.
    """
    nodes = workflow_data.get("nodes", [])
    if not isinstance(nodes, list):
        return

    suffix = f"-{bot_key}"
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "n8n-nodes-base.webhook":
            continue
        params = node.get("parameters")
        if not isinstance(params, dict):
            continue
        path = params.get("path")
        if not isinstance(path, str) or not path.strip():
            continue
        if path.endswith(suffix):
            continue
        params["path"] = f"{path}{suffix}"


def patch_settings_node(
    ai_data: Dict[str, Any],
    bot_key: str,
    base_language: str,
    learning_language: str,
    bot_voice: str,
    node_name: str = "Settings",
) -> None:
    node = find_node(ai_data, node_name)
    params = node.get("parameters", {})
    assignments = (params.get("assignments") or {}).get("assignments")
    if not isinstance(assignments, list):
        raise ValueError(f"{node_name} node assignments missing/invalid")

    seen: Set[str] = set()
    for a in assignments:
        if not isinstance(a, dict):
            continue
        name = a.get("name")
        if not isinstance(name, str):
            continue
        seen.add(name)
        if name == "base_language":
            a["value"] = base_language
        elif name == "learning_language":
            a["value"] = learning_language
        elif name == "bot_key":
            a["value"] = bot_key
        elif name == "bot_voice":
            a["value"] = bot_voice

    if "bot_key" not in seen:
        assignments.append(
            {
                "id": str(uuid.uuid4()),
                "name": "bot_key",
                "value": bot_key,
                "type": "string",
            }
        )

    if "bot_voice" not in seen:
        assignments.append(
            {
                "id": str(uuid.uuid4()),
                "name": "bot_voice",
                "value": bot_voice,
                "type": "string",
            }
        )


def patch_set_locale_node(
    ai_data: Dict[str, Any], locale: Dict[str, Any], node_name: str = "Set Locale"
) -> None:
    node = find_node(ai_data, node_name)
    params = node.get("parameters", {})
    assignments = (params.get("assignments") or {}).get("assignments")
    if not isinstance(assignments, list):
        raise ValueError(f"{node_name} node assignments missing/invalid")

    template_keys = [a.get("name") for a in assignments if isinstance(a, dict)]
    template_key_set = {k for k in template_keys if isinstance(k, str)}
    locale_keys = set(locale.keys())

    missing = sorted(template_key_set - locale_keys)
    if missing:
        raise ValueError("Locale keys mismatch (missing keys: " + ", ".join(missing) + ")")

    for a in assignments:
        if not isinstance(a, dict):
            continue
        name = a.get("name")
        if not isinstance(name, str):
            continue
        value = locale.get(name)
        if name == "loader_messages" and isinstance(value, list):
            a["value"] = [str(x) for x in value]
            a["type"] = "array"
        else:
            a["value"] = value


def patch_start_loader(ai_data: Dict[str, Any], loader_workflow_id: str, loader_workflow_name: str, bot_key: str) -> None:
    node = find_node(ai_data, "Start loader")
    params = node.get("parameters", {})
    wf = params.get("workflowId")
    if isinstance(wf, dict):
        wf["value"] = loader_workflow_id
        wf["cachedResultName"] = loader_workflow_name
        wf["cachedResultUrl"] = f"/workflow/{loader_workflow_id}"

    wf_inputs = params.get("workflowInputs")
    if isinstance(wf_inputs, dict):
        val = wf_inputs.get("value")
        if isinstance(val, dict):
            val["bot_key"] = bot_key
        schema = wf_inputs.get("schema")
        if isinstance(schema, list) and not any(isinstance(x, dict) and x.get("id") == "bot_key" for x in schema):
            schema.append(
                {
                    "id": "bot_key",
                    "type": "string",
                    "display": True,
                    "required": False,
                    "displayName": "bot_key",
                    "defaultMatch": False,
                    "canBeUsedToMatch": True,
                }
            )


def load_bot_configs(bots_dir: Path) -> List[Tuple[str, Dict[str, Any]]]:
    bots: List[Tuple[str, Dict[str, Any]]] = []
    for path in sorted([p for p in bots_dir.glob("*.json") if p.is_file()]):
        data = load_json(path)
        base = normalize_language_code(data.get("base_language"))
        learn = normalize_language_code(data.get("learning_language"))
        bot_key = (data.get("bot_key") or "").strip() or f"{base}-{learn}"
        tg_cred = (data.get("telegram_credential_id") or "").strip()
        locale = data.get("locale")
        if not base or not learn or not bot_key:
            raise ValueError(f"Invalid bot config (missing base/learning/bot_key): {path}")
        if bot_key != f"{base}-{learn}":
            raise ValueError(f"Invalid bot config (bot_key must equal {base}-{learn}): {path}")
        if not tg_cred:
            raise ValueError(f"Invalid bot config (missing telegram_credential_id): {path}")
        if not isinstance(locale, dict):
            raise ValueError(f"Invalid bot config (missing locale object): {path}")
        data["base_language"] = base
        data["learning_language"] = learn
        bots.append((bot_key, data))
    return bots


def clear_rendered_output_dir(input_dir: Path, output_dir: Path) -> int:
    if input_dir.resolve() == output_dir.resolve():
        raise ValueError("Refusing to clear output: --output must differ from --input")

    removed = 0
    for path in output_dir.glob("*.json"):
        if path.is_file():
            path.unlink()
            removed += 1
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="Render n8n workflows with env-specific credential IDs.")
    parser.add_argument("--input", default="deploy/workflows", help="Directory with source workflow JSON files")
    parser.add_argument("--output", default="deploy/workflows/.rendered", help="Directory to write rendered workflows")
    parser.add_argument("--bots", default="deploy/bots", help="Directory with per-bot JSON configs (enables multi-bot mode if present)")
    parser.add_argument("--prompts", default="deploy/prompts", help="Directory with prompt template files")
    parser.add_argument("--topics", default="deploy/topics", help="Directory with shared topic template files")
    args = parser.parse_args()

    input_dir = resolve_path(args.input)
    output_dir = resolve_path(args.output)
    bots_dir = resolve_path(args.bots)
    prompts_dir = resolve_path(args.prompts)
    topics_dir = resolve_path(args.topics)

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    files = iter_workflow_files(input_dir)
    if not files:
        print(f"No workflow JSON files found in {input_dir}", file=sys.stderr)
        return 1

    # Bot configs are required - no legacy single-bot mode supported
    bots_mode = bots_dir.exists() and any(p.suffix == ".json" for p in bots_dir.glob("*.json"))
    if not bots_mode:
        print("ERROR: No bot configs found in bots directory.", file=sys.stderr)
        print(f"Please create bot config files in {bots_dir}/", file=sys.stderr)
        print("See deploy/bots/README.md for details.", file=sys.stderr)
        return 1
    
    bots = load_bot_configs(bots_dir)
    try:
        prompt_templates = load_prompt_templates(prompts_dir)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1

    # Telegram credentials come from bot configs, not env vars
    required = find_required_env(files, ignore_types={"telegramApi"})
    missing = [env_key for env_key in sorted(required) if not os.environ.get(env_key)]
    if missing:
        print("Missing required credential env vars:", file=sys.stderr)
        for env_key in missing:
            types = ", ".join(sorted(required[env_key]))
            print(f"  {env_key} (for: {types})", file=sys.stderr)
        return 1

    env_map = {ctype: env_key for env_key, types in required.items() for ctype in types}

    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        removed = clear_rendered_output_dir(input_dir, output_dir)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1
    if removed:
        print(f"Cleared {removed} stale rendered workflow(s) from {output_dir}")
    rendered = 0

    # Load templates once.
    template_ai = input_dir / "ai-bot.json"
    template_loader = input_dir / "loader-messages-rotator.json"
    if not template_ai.exists() or not template_loader.exists():
        print("Multi-bot mode requires templates in input dir:", file=sys.stderr)
        print(f"  Missing: {template_ai} or {template_loader}", file=sys.stderr)
        return 1

    ai_tpl = load_json(template_ai)
    loader_tpl = load_json(template_loader)

    for bot_key, bot in bots:
        base = bot["base_language"]
        learn = bot["learning_language"]
        bot_name = str(bot.get("bot_name") or "").strip() or bot_key
        bot_voice = str(bot.get("bot_voice") or "").strip() or "nova"
        tg_cred = bot["telegram_credential_id"]
        locale = bot["locale"]
        prompt_context = build_prompt_context(
            bot_key=bot_key,
            bot_name=bot_name,
            base_language_code=base,
            target_language_code=learn,
        )
        try:
            topic_templates = load_topic_templates(topics_dir, base)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 1
        full_locale = compose_locale_with_generated_prompts(
            locale=locale,
            prompt_templates=prompt_templates,
            prompt_context=prompt_context,
            topic_templates=topic_templates,
            bot_key=bot_key,
        )

        ai = copy.deepcopy(ai_tpl)
        loader = copy.deepcopy(loader_tpl)

        ai_id = deterministic_workflow_id("ai-bot", bot_key)
        loader_id = deterministic_workflow_id("loader-messages-rotator", bot_key)

        ai["id"] = ai_id
        ai["name"] = f"ai-bot-{bot_key}"
        loader["id"] = loader_id
        loader["name"] = f"loader-messages-rotator-{bot_key}"

        patch_webhook_paths_for_bot(ai, bot_key)
        patch_webhook_ids_for_bot(ai, "ai-bot", bot_key)
        patch_webhook_ids_for_bot(loader, "loader-messages-rotator", bot_key)

        patch_settings_node(ai, bot_key, base, learn, bot_voice)
        patch_settings_node(ai, bot_key, base, learn, bot_voice, node_name="Digest Settings")
        patch_set_locale_node(ai, full_locale)
        patch_set_locale_node(ai, full_locale, node_name="Digest Locale")
        patch_message_model_node(ai, base, learn)
        patch_start_loader(ai, loader_id, loader["name"], bot_key)

        set_telegram_credential_id(ai, tg_cred)
        set_telegram_credential_id(loader, tg_cred)

        apply_env_credentials(ai, env_map, ignore_types={"telegramApi"})
        apply_env_credentials(loader, env_map, ignore_types={"telegramApi"})

        write_json(output_dir / f"ai-bot-{bot_key}.json", ai)
        write_json(output_dir / f"loader-messages-rotator-{bot_key}.json", loader)
        rendered += 2

    # Render other workflows (skip templates).
    for path in files:
        if path.name in BOT_TEMPLATES:
            continue
        wf = load_json(path)
        # Keep Telegram credential IDs from file, unless it is missing and we have bots.
        # For global workflows, default to the first bot's Telegram creds.
        if bots:
            has_tg = False
            for n in wf.get("nodes", []):
                creds = n.get("credentials")
                if isinstance(creds, dict) and isinstance(creds.get("telegramApi"), dict):
                    has_tg = True
                    break
            if has_tg:
                default_tg = bots[0][1]["telegram_credential_id"]
                set_telegram_credential_id(wf, default_tg)
        apply_env_credentials(wf, env_map, ignore_types={"telegramApi"})
        write_json(output_dir / path.name, wf)
        rendered += 1

    print(f"Rendered {rendered} workflow(s) (multi-bot) to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
