#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


TOPIC_DEFAULT_EMOJI = "🧩"
LEGACY_TOPIC_EMOJIS = {
    "routine": "🌅",
    "food": "🍽️",
    "travel": "✈️",
    "coffee": "☕",
    "apartment": "🏠",
    "interview": "💼",
    "office": "🧑‍💻",
    "movies": "🎬",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Backfill bot topic catalog through the admin API."
    )
    parser.add_argument("--bot-key", dest="bot_key", default="", help="Only backfill one bot_key")
    parser.add_argument("--force", action="store_true", help="Update existing topics too")
    parser.add_argument("--api-base-url", dest="api_base_url", default="", help="Admin API base URL")
    parser.add_argument(
        "--admin-password",
        dest="admin_password",
        default="",
        help="Admin dashboard password",
    )
    return parser.parse_args()


def parse_env_file(path: Path) -> dict:
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]
        values[key] = value
    return values


def normalize_language_code(value: str) -> str:
    code = str(value or "").strip().lower()
    if not code:
        return ""
    if code in {"ua", "uk-ua", "ua-ua"}:
        return "uk"
    return code[:16]


def default_emoji_for_topic_id(topic_id: str) -> str:
    return LEGACY_TOPIC_EMOJIS.get(topic_id, TOPIC_DEFAULT_EMOJI)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_bot_configs(bots_dir: Path) -> dict:
    bot_configs = {}
    for path in sorted(bots_dir.glob("*.json")):
        parsed = load_json(path)
        bot_key = str(parsed.get("bot_key") or "").strip().lower()
        if bot_key:
            bot_configs[bot_key] = parsed
    return bot_configs


def load_legacy_templates(topics_dir: Path, base_language_raw: str):
    base_language = normalize_language_code(base_language_raw) or "en"
    candidates = [topics_dir / f"{base_language}.json"]
    if base_language != "en":
        candidates.append(topics_dir / "en.json")
    source = next((candidate for candidate in candidates if candidate.exists()), None)
    if source is None:
        raise RuntimeError(f"Missing legacy topic template file for base language {base_language}")
    parsed = load_json(source)
    templates = parsed.get("templates")
    return templates if isinstance(templates, list) else []


def seed_template_from_legacy(template_raw: dict, sort_order: int) -> dict:
    topic_id = str(template_raw.get("id") or "").strip().lower()
    if not topic_id:
        raise RuntimeError("Legacy template missing id")
    return {
        "topic_id": topic_id,
        "emoji": default_emoji_for_topic_id(topic_id),
        "access_tier": "all",
        "title_base": str(template_raw.get("title") or "").strip(),
        "goal_base": str(template_raw.get("goal") or "").strip(),
        "allowed_base": [
            str(item or "").strip()
            for item in (template_raw.get("allowed") or [])
            if str(item or "").strip()
        ],
        "avoid_base": [
            str(item or "").strip()
            for item in (template_raw.get("avoid") or [])
            if str(item or "").strip()
        ],
        "sort_order": sort_order,
    }


def build_api_request(url: str, admin_password: str, method: str = "GET", body=None):
    headers = {"X-Admin-Password": admin_password}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    return urllib.request.Request(url, data=data, headers=headers, method=method)


def api_json(base_url: str, path: str, admin_password: str, *, method: str = "GET", body=None, query=None):
    base = base_url.rstrip("/")
    url = f"{base}{path}"
    if query:
        query_string = urllib.parse.urlencode(query)
        url = f"{url}?{query_string}"
    request = build_api_request(url, admin_password, method=method, body=body)
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": raw or f"http_{exc.code}"}
        detail = payload.get("detail") or payload.get("error") or raw or f"http_{exc.code}"
        raise RuntimeError(f"{method} {path} failed: {detail}") from exc
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{method} {path} returned invalid JSON") from exc


def resolve_api_base(repo_root: Path, cli_value: str) -> str:
    if cli_value.strip():
        return cli_value.strip().rstrip("/")
    if os.environ.get("TOPIC_ADMIN_API_BASE"):
        return os.environ["TOPIC_ADMIN_API_BASE"].strip().rstrip("/")
    if os.environ.get("VITE_API_BASE"):
        return os.environ["VITE_API_BASE"].strip().rstrip("/")
    if os.environ.get("API_BASE_URL"):
        return os.environ["API_BASE_URL"].strip().rstrip("/")

    deploy_dir = repo_root / "deploy"
    env_miniapp = parse_env_file(deploy_dir / ".env.miniapp")
    env_api = parse_env_file(deploy_dir / ".env.api")
    for candidate in (
        env_miniapp.get("VITE_API_BASE"),
        env_api.get("API_BASE_URL"),
    ):
        if candidate:
            return candidate.strip().rstrip("/")
    raise RuntimeError(
        "Missing API base URL. Pass --api-base-url or set TOPIC_ADMIN_API_BASE / VITE_API_BASE."
    )


def resolve_admin_password(repo_root: Path, cli_value: str) -> str:
    if cli_value.strip():
        return cli_value.strip()
    if os.environ.get("ADMIN_DASHBOARD_PASSWORD"):
        return os.environ["ADMIN_DASHBOARD_PASSWORD"].strip()
    env_api = parse_env_file(repo_root / "deploy" / ".env.api")
    password = str(env_api.get("ADMIN_DASHBOARD_PASSWORD") or "").strip()
    if password:
        return password
    raise RuntimeError(
        "Missing ADMIN_DASHBOARD_PASSWORD. Pass --admin-password or set it in deploy/.env.api."
    )


def main():
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    bots_dir = repo_root / "deploy" / "bots"
    topics_dir = repo_root / "deploy" / "topics"

    api_base_url = resolve_api_base(repo_root, args.api_base_url)
    admin_password = resolve_admin_password(repo_root, args.admin_password)

    bot_configs = load_bot_configs(bots_dir)
    bot_entries = sorted(
        (
            (bot_key, config)
            for bot_key, config in bot_configs.items()
            if not args.bot_key or bot_key == args.bot_key.strip().lower()
        ),
        key=lambda item: item[0],
    )

    if not bot_entries:
        print("No bot configs found to backfill", file=sys.stderr)
        return 1

    created = 0
    updated = 0
    skipped = 0

    for bot_key, config in bot_entries:
        base_language = normalize_language_code(config.get("base_language") or bot_key.split("-")[0])
        target_language = normalize_language_code(config.get("learning_language") or bot_key.split("-")[1])
        templates = load_legacy_templates(topics_dir, base_language)
        print(f"Backfilling {bot_key} ({base_language}->{target_language}) with {len(templates)} topic(s)")

        existing_payload = api_json(
            api_base_url,
            "/admin/topics",
            admin_password,
            query={"bot_key": bot_key},
        )
        existing_ids = {
            str(item.get("topic_id") or "").strip().lower()
            for item in existing_payload.get("items", [])
            if str(item.get("topic_id") or "").strip()
        }

        for index, template in enumerate(templates):
            seed = seed_template_from_legacy(template, index)
            exists = seed["topic_id"] in existing_ids
            if exists and not args.force:
                skipped += 1
                continue

            draft_payload = api_json(
                api_base_url,
                "/admin/topics/generate-draft",
                admin_password,
                method="POST",
                body={
                    "bot_key": bot_key,
                    "topic_name": seed["title_base"],
                    "sort_order": seed["sort_order"],
                    "access_tier": seed["access_tier"],
                    "base_template": seed,
                },
            )
            draft = draft_payload.get("draft") or {}
            topic_payload = {
                "bot_key": bot_key,
                "topic_id": draft.get("topic_id") or seed["topic_id"],
                "emoji": draft.get("emoji") or seed["emoji"],
                "access_tier": draft.get("access_tier") or seed["access_tier"],
                "title_base": draft.get("title_base") or seed["title_base"],
                "goal_base": draft.get("goal_base") or seed["goal_base"],
                "allowed_base": draft.get("allowed_base") or seed["allowed_base"],
                "avoid_base": draft.get("avoid_base") or seed["avoid_base"],
                "starter_questions_target": draft.get("starter_questions_target") or [],
                "recovery_questions_target": draft.get("recovery_questions_target") or [],
                "sort_order": draft.get("sort_order", seed["sort_order"]),
            }

            if exists:
                api_json(
                    api_base_url,
                    f"/admin/topics/{urllib.parse.quote(seed['topic_id'], safe='')}",
                    admin_password,
                    method="PUT",
                    body=topic_payload,
                )
                updated += 1
            else:
                api_json(
                    api_base_url,
                    "/admin/topics",
                    admin_password,
                    method="POST",
                    body=topic_payload,
                )
                created += 1

    print(f"Topic backfill finished. created={created} updated={updated} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
