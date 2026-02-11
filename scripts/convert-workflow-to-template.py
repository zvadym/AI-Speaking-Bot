#!/usr/bin/env python3
"""
Interactive converter: rendered/exported workflow -> repo template workflow.

Default source dir:
  deploy/workflows/to_convert

Supported targets:
  - ai-bot
  - loader-messages-rotator
"""

from __future__ import annotations

import argparse
import copy
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_DIR = REPO_ROOT / "deploy" / "workflows" / "to_convert"
TARGET_TEMPLATE_FILES = {
    "ai-bot": REPO_ROOT / "deploy" / "workflows" / "ai-bot.json",
    "loader-messages-rotator": REPO_ROOT / "deploy" / "workflows" / "loader-messages-rotator.json",
}
BOT_KEY_EXPR = "={{ $('Settings').item.json.bot_key }}"


def resolve_path(path_str: str) -> Path:
    p = Path(path_str)
    return p if p.is_absolute() else (REPO_ROOT / p)


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def write_json(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def list_json_files(input_dir: Path) -> List[Path]:
    return sorted([p for p in input_dir.glob("*.json") if p.is_file()])


def choose_from_list(options: List[str], prompt: str) -> int:
    while True:
        raw = input(prompt).strip()
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(options):
                return idx - 1
        print(f"Invalid selection. Enter a number from 1 to {len(options)}.")


def choose_source_file(files: List[Path]) -> Path:
    print("\nFiles found in to-convert directory:")
    for i, path in enumerate(files, start=1):
        print(f"  {i}. {path.name}")
    idx = choose_from_list([p.name for p in files], "\nPick file number: ")
    return files[idx]


def choose_target_template() -> str:
    targets = list(TARGET_TEMPLATE_FILES.keys())
    print("\nTarget template:")
    for i, t in enumerate(targets, start=1):
        print(f"  {i}. {t}")
    idx = choose_from_list(targets, "\nPick target number: ")
    return targets[idx]


def find_node_by_name(workflow: Dict[str, Any], node_name: str) -> Optional[Dict[str, Any]]:
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return None
    for node in nodes:
        if isinstance(node, dict) and node.get("name") == node_name:
            return node
    return None


def extract_bot_key(workflow: Dict[str, Any], target_name: str) -> Optional[str]:
    settings = find_node_by_name(workflow, "Settings")
    if isinstance(settings, dict):
        assignments = (((settings.get("parameters") or {}).get("assignments") or {}).get("assignments") or [])
        if isinstance(assignments, list):
            for item in assignments:
                if isinstance(item, dict) and item.get("name") == "bot_key":
                    val = str(item.get("value") or "").strip()
                    if val:
                        return val

    wf_name = str(workflow.get("name") or "").strip()
    prefix = f"{target_name}-"
    if wf_name.startswith(prefix):
        suffix = wf_name[len(prefix) :].strip()
        if suffix:
            return suffix
    return None


def normalize_root_id_and_name(converted: Dict[str, Any], template: Dict[str, Any]) -> int:
    changed = 0
    for key in ("id", "name"):
        if key in template and converted.get(key) != template.get(key):
            converted[key] = template[key]
            changed += 1
    return changed


def strip_webhook_path_suffix(converted: Dict[str, Any], bot_key: Optional[str]) -> int:
    if not bot_key:
        return 0
    suffix = f"-{bot_key}"
    changed = 0
    nodes = converted.get("nodes")
    if not isinstance(nodes, list):
        return 0
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "n8n-nodes-base.webhook":
            continue
        params = node.get("parameters")
        if not isinstance(params, dict):
            continue
        path = params.get("path")
        if isinstance(path, str) and path.endswith(suffix):
            params["path"] = path[: -len(suffix)]
            changed += 1
    return changed


def restore_webhook_ids(converted: Dict[str, Any], template: Dict[str, Any]) -> int:
    tpl_nodes = template.get("nodes")
    conv_nodes = converted.get("nodes")
    if not isinstance(tpl_nodes, list) or not isinstance(conv_nodes, list):
        return 0

    template_ids_by_name: Dict[str, str] = {}
    for node in tpl_nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "n8n-nodes-base.webhook":
            continue
        name = node.get("name")
        webhook_id = node.get("webhookId")
        if isinstance(name, str) and isinstance(webhook_id, str) and webhook_id.strip():
            template_ids_by_name[name] = webhook_id

    changed = 0
    for node in conv_nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "n8n-nodes-base.webhook":
            continue
        name = node.get("name")
        if not isinstance(name, str):
            continue
        desired = template_ids_by_name.get(name)
        if not desired:
            continue
        if node.get("webhookId") != desired:
            node["webhookId"] = desired
            changed += 1
    return changed


def normalize_start_loader(converted: Dict[str, Any], template: Dict[str, Any]) -> int:
    src_node = find_node_by_name(converted, "Start loader")
    tpl_node = find_node_by_name(template, "Start loader")
    if not isinstance(src_node, dict) or not isinstance(tpl_node, dict):
        return 0

    src_params = src_node.get("parameters")
    tpl_params = tpl_node.get("parameters")
    if not isinstance(src_params, dict) or not isinstance(tpl_params, dict):
        return 0

    changed = 0

    tpl_workflow_id = tpl_params.get("workflowId")
    src_workflow_id = src_params.get("workflowId")
    if isinstance(tpl_workflow_id, dict):
        if not isinstance(src_workflow_id, dict):
            src_params["workflowId"] = copy.deepcopy(tpl_workflow_id)
            changed += 1
        else:
            for key in ("value", "cachedResultName", "cachedResultUrl"):
                if key in tpl_workflow_id and src_workflow_id.get(key) != tpl_workflow_id.get(key):
                    src_workflow_id[key] = tpl_workflow_id[key]
                    changed += 1

    src_inputs = src_params.get("workflowInputs")
    if isinstance(src_inputs, dict):
        src_val = src_inputs.get("value")
        if not isinstance(src_val, dict):
            src_val = {}
            src_inputs["value"] = src_val
            changed += 1
        if src_val.get("bot_key") != BOT_KEY_EXPR:
            src_val["bot_key"] = BOT_KEY_EXPR
            changed += 1

        src_schema = src_inputs.get("schema")
        if isinstance(src_schema, list):
            before = len(src_schema)
            src_inputs["schema"] = [
                item
                for item in src_schema
                if not (isinstance(item, dict) and item.get("id") == "bot_key")
            ]
            if len(src_inputs["schema"]) != before:
                changed += before - len(src_inputs["schema"])
    return changed


def confirm(prompt: str) -> bool:
    return input(f"{prompt} [y/N]: ").strip().lower() in {"y", "yes"}


def make_backup(path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = path.with_suffix(path.suffix + f".bak.{ts}")
    shutil.copy2(path, backup)
    return backup


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert exported/rendered n8n workflow JSON into repo template JSON."
    )
    parser.add_argument(
        "--input-dir",
        default=str(DEFAULT_INPUT_DIR),
        help="Directory that contains downloaded workflow JSON files (default: deploy/workflows/to_convert)",
    )
    args = parser.parse_args()

    input_dir = resolve_path(args.input_dir)
    input_dir.mkdir(parents=True, exist_ok=True)

    files = list_json_files(input_dir)
    if not files:
        print(f"No JSON files found in {input_dir}")
        print("Put exported workflow JSON file(s) there and run again.")
        return 1

    source_file = choose_source_file(files)
    target_name = choose_target_template()
    target_template_path = TARGET_TEMPLATE_FILES[target_name]

    if not target_template_path.exists():
        print(f"Target template file not found: {target_template_path}", file=sys.stderr)
        return 1

    try:
        source = load_json(source_file)
        template = load_json(target_template_path)
    except Exception as e:
        print(f"Failed to read JSON: {e}", file=sys.stderr)
        return 1

    converted = copy.deepcopy(source)
    bot_key = extract_bot_key(converted, target_name)

    changes: List[Tuple[str, int]] = []
    changes.append(("root id/name reset to template", normalize_root_id_and_name(converted, template)))
    changes.append(("webhook path suffix stripped", strip_webhook_path_suffix(converted, bot_key)))
    changes.append(("webhookId restored from template", restore_webhook_ids(converted, template)))
    if target_name == "ai-bot":
        changes.append(("Start loader normalized", normalize_start_loader(converted, template)))

    print("\nConversion summary:")
    print(f"  source: {source_file}")
    print(f"  target: {target_template_path}")
    print(f"  detected bot_key: {bot_key or '(not found)'}")
    for label, count in changes:
        print(f"  - {label}: {count}")

    if not confirm("\nReplace target template with converted content?"):
        print("Aborted.")
        return 1

    backup_path = make_backup(target_template_path)
    write_json(target_template_path, converted)

    print("\nDone.")
    print(f"  backup: {backup_path}")
    print(f"  updated: {target_template_path}")
    print("\nNext step:")
    print(
        "  python3 scripts/render-n8n-workflows.py --input deploy/workflows --output deploy/workflows/.rendered"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
