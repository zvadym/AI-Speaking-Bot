#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

PROMPT_KEYS = {
    "model_system_prompt",
    "model_support_prompt",
    "model_hints_prompt",
    "model_summary_prompt",
}


def load_json(path: Path) -> Any:
    with path.open() as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def iter_workflows_from_export(payload: Any) -> Iterable[Dict[str, Any]]:
    # n8n export variants:
    # - a list of workflows
    # - a wrapper object with a "workflows" list
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                yield item
        return
    if isinstance(payload, dict) and isinstance(payload.get("workflows"), list):
        for item in payload["workflows"]:
            if isinstance(item, dict):
                yield item
        return
    if isinstance(payload, dict) and "nodes" in payload:
        yield payload


def get_node(workflow: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return None
    for n in nodes:
        if isinstance(n, dict) and n.get("name") == name:
            return n
    return None


def extract_telegram_credential_id(workflow: Dict[str, Any]) -> str:
    ids = set()
    for n in workflow.get("nodes", []):
        if not isinstance(n, dict):
            continue
        creds = n.get("credentials")
        if not isinstance(creds, dict):
            continue
        tg = creds.get("telegramApi")
        if not isinstance(tg, dict):
            continue
        cid = tg.get("id")
        if isinstance(cid, str) and cid.strip():
            ids.add(cid.strip())
    if not ids:
        return ""
    if len(ids) > 1:
        raise ValueError(f"Multiple telegramApi credential IDs found in workflow: {sorted(ids)}")
    return next(iter(ids))


def extract_settings(workflow: Dict[str, Any]) -> Tuple[str, str, str]:
    node = get_node(workflow, "Settings")
    if not node:
        raise ValueError("Missing Settings node")
    assigns = ((node.get("parameters") or {}).get("assignments") or {}).get("assignments")
    if not isinstance(assigns, list):
        raise ValueError("Settings node assignments missing/invalid")

    base = ""
    learn = ""
    bot_key = ""
    for a in assigns:
        if not isinstance(a, dict):
            continue
        if a.get("name") == "base_language":
            base = str(a.get("value") or "").strip()
        elif a.get("name") == "learning_language":
            learn = str(a.get("value") or "").strip()
        elif a.get("name") == "bot_key":
            bot_key = str(a.get("value") or "").strip()
    if not base or not learn:
        raise ValueError("Settings missing base_language/learning_language")
    if not bot_key:
        bot_key = f"{base}-{learn}"
    return base, learn, bot_key


def parse_loader_messages(value: str) -> Optional[List[str]]:
    # Preferred generator format: "={{ JSON.stringify([...]) }}"
    m = re.search(r"JSON\\.stringify\\((\\[.*\\])\\)", value, flags=re.S)
    if m:
        try:
            arr = json.loads(m.group(1))
            if isinstance(arr, list):
                return [str(x) for x in arr]
        except Exception:
            pass

    # Legacy format (hand-edited): "={{ JSON.stringify([`...`, `...`]) }}"
    msgs = re.findall(r"`([^`]*)`", value)
    if msgs:
        return msgs
    return None


def extract_locale(workflow: Dict[str, Any]) -> Dict[str, Any]:
    node = get_node(workflow, "Set Locale")
    if not node:
        raise ValueError("Missing Set Locale node")
    assigns = ((node.get("parameters") or {}).get("assignments") or {}).get("assignments")
    if not isinstance(assigns, list):
        raise ValueError("Set Locale node assignments missing/invalid")

    out: Dict[str, Any] = {}
    for a in assigns:
        if not isinstance(a, dict):
            continue
        name = a.get("name")
        if not isinstance(name, str) or not name:
            continue
        out[name] = a.get("value")

    loader_val = out.get("loader_messages")
    if isinstance(loader_val, str):
        parsed = parse_loader_messages(loader_val)
        if parsed is not None:
            out["loader_messages"] = parsed

    # Prompt templates are source-of-truth in deploy/prompts/.
    for key in PROMPT_KEYS:
        out.pop(key, None)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync deploy/bots/*.json locale + telegram credential IDs from an exported n8n workflow JSON."
    )
    parser.add_argument("--input", required=True, help="Path to n8n export JSON file or directory with workflow JSONs")
    parser.add_argument("--bots-dir", default="deploy/bots", help="Directory to write/update bot config files")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing files")
    args = parser.parse_args()

    input_path = Path(args.input)
    bots_dir = Path(args.bots_dir)

    workflows: List[Dict[str, Any]] = []
    if input_path.is_dir():
        for p in sorted(input_path.glob("*.json")):
            try:
                workflows.append(load_json(p))
            except Exception as e:
                print(f"Failed to read {p}: {e}", file=sys.stderr)
                return 1
    else:
        try:
            payload = load_json(input_path)
        except Exception as e:
            print(f"Failed to read {input_path}: {e}", file=sys.stderr)
            return 1
        workflows = list(iter_workflows_from_export(payload))

    if not workflows:
        print("No workflows found in input.", file=sys.stderr)
        return 1

    updated = 0
    skipped = 0

    for wf in workflows:
        name = str(wf.get("name") or "").strip()
        if not name.startswith("ai-bot-"):
            skipped += 1
            continue

        base, learn, bot_key = extract_settings(wf)
        tg_cred = extract_telegram_credential_id(wf)
        if not tg_cred:
            raise ValueError(f"Workflow {name} missing telegramApi credential id")

        locale = extract_locale(wf)

        out_path = bots_dir / f"{bot_key}.json"
        existing: Dict[str, Any] = {}
        if out_path.exists():
            try:
                existing = load_json(out_path)
            except Exception:
                existing = {}

        merged = {
            **(existing if isinstance(existing, dict) else {}),
            "bot_key": bot_key,
            "base_language": base,
            "learning_language": learn,
            "telegram_credential_id": tg_cred,
            "locale": locale,
        }

        if args.dry_run:
            print(f"[dry-run] would write {out_path}")
        else:
            write_json(out_path, merged)
        updated += 1

    print(f"Synced {updated} bot config(s). Skipped {skipped} non ai-bot workflow(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
