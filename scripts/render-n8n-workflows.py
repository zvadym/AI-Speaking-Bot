#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Set

EXPLICIT_ENV = {
    "telegramApi": "N8N_CRED_TELEGRAM_ID",
    "openAiApi": "N8N_CRED_OPENAI_ID",
    "postgres": "N8N_CRED_POSTGRES_ID",
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


def find_required_env(files: List[Path]) -> Dict[str, Set[str]]:
    env_to_types: Dict[str, Set[str]] = {}
    for path in files:
        with path.open() as f:
            data = json.load(f)
        for node in data.get("nodes", []):
            creds = node.get("credentials")
            if not isinstance(creds, dict):
                continue
            for ctype in creds.keys():
                env_key = to_env_key(ctype)
                env_to_types.setdefault(env_key, set()).add(ctype)
    return env_to_types


def render_file(path: Path, output_dir: Path, env_map: Dict[str, str]) -> None:
    with path.open() as f:
        data = json.load(f)

    for node in data.get("nodes", []):
        creds = node.get("credentials")
        if not isinstance(creds, dict):
            continue
        for ctype, cdata in creds.items():
            if not isinstance(cdata, dict):
                continue
            env_key = env_map[ctype]
            cdata["id"] = os.environ[env_key]

    output_path = output_dir / path.name
    with output_path.open("w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Render n8n workflows with env-specific credential IDs.")
    parser.add_argument("--input", default="deploy/workflows", help="Directory with source workflow JSON files")
    parser.add_argument("--output", default="deploy/workflows/.rendered", help="Directory to write rendered workflows")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    files = iter_workflow_files(input_dir)
    if not files:
        print(f"No workflow JSON files found in {input_dir}", file=sys.stderr)
        return 1

    required = find_required_env(files)
    missing = [env_key for env_key in sorted(required) if not os.environ.get(env_key)]
    if missing:
        print("Missing required credential env vars:", file=sys.stderr)
        for env_key in missing:
            types = ", ".join(sorted(required[env_key]))
            print(f"  {env_key} (for: {types})", file=sys.stderr)
        return 1

    env_map = {ctype: env_key for env_key, types in required.items() for ctype in types}

    output_dir.mkdir(parents=True, exist_ok=True)
    for path in files:
        render_file(path, output_dir, env_map)

    print(f"Rendered {len(files)} workflow(s) to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
