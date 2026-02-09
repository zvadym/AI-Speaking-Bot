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

EXPLICIT_ENV = {
    "telegramApi": "N8N_CRED_TELEGRAM_ID",
    "openAiApi": "N8N_CRED_OPENAI_ID",
    "postgres": "N8N_CRED_POSTGRES_ID",
}

# Template workflow filenames (input_dir/*.json) that should be expanded into per-bot
# workflows when deploy/bots/*.json exists.
BOT_TEMPLATES = {
    "ai-bot.json": "ai-bot",
    "loader-messages-rotator.json": "loader-messages-rotator",
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


def render_file(
    path: Path, output_dir: Path, env_map: Dict[str, str], *, ignore_types: Optional[Set[str]] = None
) -> None:
    data = load_json(path)

    apply_env_credentials(data, env_map, ignore_types=ignore_types)

    output_path = output_dir / path.name
    write_json(output_path, data)


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


def patch_settings_node(ai_data: Dict[str, Any], bot_key: str, base_language: str, learning_language: str) -> None:
    node = find_node(ai_data, "Settings")
    params = node.get("parameters", {})
    assignments = (params.get("assignments") or {}).get("assignments")
    if not isinstance(assignments, list):
        raise ValueError("Settings node assignments missing/invalid")

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

    if "bot_key" not in seen:
        assignments.append(
            {
                "id": str(uuid.uuid4()),
                "name": "bot_key",
                "value": bot_key,
                "type": "string",
            }
        )


def patch_set_locale_node(ai_data: Dict[str, Any], locale: Dict[str, Any]) -> None:
    node = find_node(ai_data, "Set Locale")
    params = node.get("parameters", {})
    assignments = (params.get("assignments") or {}).get("assignments")
    if not isinstance(assignments, list):
        raise ValueError("Set Locale node assignments missing/invalid")

    template_keys = [a.get("name") for a in assignments if isinstance(a, dict)]
    template_key_set = {k for k in template_keys if isinstance(k, str)}
    locale_keys = set(locale.keys())

    missing = sorted(template_key_set - locale_keys)
    extra = sorted(locale_keys - template_key_set)
    if missing or extra:
        parts = []
        if missing:
            parts.append("missing keys: " + ", ".join(missing))
        if extra:
            parts.append("unknown keys: " + ", ".join(extra))
        raise ValueError("Locale keys mismatch (" + "; ".join(parts) + ")")

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
        base = (data.get("base_language") or "").strip()
        learn = (data.get("learning_language") or "").strip()
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
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    bots_dir = Path(args.bots)

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    files = iter_workflow_files(input_dir)
    if not files:
        print(f"No workflow JSON files found in {input_dir}", file=sys.stderr)
        return 1

    bots: List[Tuple[str, Dict[str, Any]]] = []
    bots_mode = bots_dir.exists() and any(p.suffix == ".json" for p in bots_dir.glob("*.json"))
    if bots_mode:
        bots = load_bot_configs(bots_dir)

    ignore_env_types = {"telegramApi"} if bots_mode else set()
    required = find_required_env(files, ignore_types=ignore_env_types)
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

    if bots_mode:
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
            tg_cred = bot["telegram_credential_id"]
            locale = bot["locale"]

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

            patch_settings_node(ai, bot_key, base, learn)
            patch_set_locale_node(ai, locale)
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

    # Legacy mode: render every workflow JSON and override all credential IDs from env (including Telegram).
    for path in files:
        render_file(path, output_dir, env_map)
        rendered += 1

    print(f"Rendered {rendered} workflow(s) to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
