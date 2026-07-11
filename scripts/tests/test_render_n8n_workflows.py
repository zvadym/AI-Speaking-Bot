import copy
import importlib.util
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
RENDERER_PATH = REPO_ROOT / "scripts" / "render-n8n-workflows.py"
WORKFLOW_PATH = REPO_ROOT / "deploy" / "workflows" / "ai-bot.json"

spec = importlib.util.spec_from_file_location("render_n8n_workflows", RENDERER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load renderer: {RENDERER_PATH}")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def load_workflow():
    return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))


def find_node(workflow, name):
    matches = [node for node in workflow["nodes"] if node.get("name") == name]
    if len(matches) != 1:
        raise AssertionError(f"Expected one node named {name!r}, found {len(matches)}")
    return matches[0]


def outgoing_nodes(workflow, name):
    result = []
    connection = workflow.get("connections", {}).get(name, {})
    for outputs in connection.values():
        for output in outputs or []:
            result.extend(edge["node"] for edge in output or [])
    return result


class InternalSecretRenderingTests(unittest.TestCase):
    def test_injects_every_marked_http_node_without_a_name_allowlist(self):
        workflow = {
            "nodes": [
                {
                    "name": "Known internal node",
                    "type": renderer.HTTP_REQUEST_NODE_TYPE,
                    "parameters": {
                        "headerParameters": {
                            "parameters": [
                                {
                                    "name": "x-internal-secret",
                                    "value": renderer.INTERNAL_SECRET_SENTINEL,
                                }
                            ]
                        }
                    },
                },
                {
                    "name": "Future internal node",
                    "type": renderer.HTTP_REQUEST_NODE_TYPE,
                    "parameters": {
                        "headerParameters": {
                            "parameters": [
                                {
                                    "name": "X-Internal-Secret",
                                    "value": renderer.INTERNAL_SECRET_SENTINEL,
                                }
                            ]
                        }
                    },
                },
            ]
        }

        injected = renderer.inject_internal_http_secrets(workflow, "runtime-secret-for-test")

        self.assertEqual(injected, {"Known internal node", "Future internal node"})
        serialized = json.dumps(workflow)
        self.assertNotIn(renderer.INTERNAL_SECRET_SENTINEL, serialized)
        self.assertEqual(serialized.count("runtime-secret-for-test"), 2)

    def test_rejects_a_tracked_non_sentinel_header_value(self):
        workflow = {
            "nodes": [
                {
                    "name": "Unsafe internal node",
                    "type": renderer.HTTP_REQUEST_NODE_TYPE,
                    "parameters": {
                        "headerParameters": {
                            "parameters": [
                                {"name": "x-internal-secret", "value": "hardcoded-value"}
                            ]
                        }
                    },
                }
            ]
        }

        with self.assertRaisesRegex(ValueError, "must use"):
            renderer.inject_internal_http_secrets(workflow, "runtime-secret-for-test")

    def test_source_template_uses_only_sentinels_and_renders_all_internal_nodes(self):
        workflow = load_workflow()
        source_values = []
        for node in workflow["nodes"]:
            if node.get("type") != renderer.HTTP_REQUEST_NODE_TYPE:
                continue
            headers = (
                node.get("parameters", {})
                .get("headerParameters", {})
                .get("parameters", [])
            )
            for header in headers:
                if str(header.get("name", "")).lower() == renderer.INTERNAL_SECRET_HEADER_NAME:
                    source_values.append(header.get("value"))

        self.assertEqual(len(source_values), 6)
        self.assertEqual(set(source_values), {renderer.INTERNAL_SECRET_SENTINEL})

        rendered = copy.deepcopy(workflow)
        with patch.dict(os.environ, {"LOADER_API_BASE_URL": "http://api.test:3000"}):
            patched = renderer.patch_internal_http_urls(rendered)
        injected = renderer.inject_internal_http_secrets(rendered, "runtime-secret-for-test")
        renderer.validate_internal_http_headers(patched, injected)

        self.assertEqual(patched, set(renderer.INTERNAL_HTTP_URL_SUFFIXES))
        self.assertTrue(patched.issubset(injected))
        for node_name, suffix in renderer.INTERNAL_HTTP_URL_SUFFIXES.items():
            node = find_node(rendered, node_name)
            self.assertEqual(node["parameters"]["url"], f"http://api.test:3000{suffix}")


class PreparedUpdateDispatchTests(unittest.TestCase):
    def test_prepare_is_ordered_and_stats_has_a_legacy_fallback(self):
        workflow = load_workflow()

        self.assertEqual(
            outgoing_nodes(workflow, "Create User"),
            ["Code: Start prepare"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "Code: Start prepare"),
            ["API: Prepare update"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "API: Prepare update"),
            ["Code: Normalize prepared update"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "Code: Normalize prepared update"),
            ["Get plan data", "Get User Data"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "Track reply keyboard click"),
            ["Switch: Prepared route"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "Switch: Prepared route"),
            ["API: Ingest prepared update", "Is /[command]"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "API: Ingest prepared update"),
            ["Runtime update accepted?"],
        )
        self.assertEqual(
            outgoing_nodes(workflow, "Runtime update accepted?"),
            ["Is /[command]"],
        )

        prepare = find_node(workflow, "API: Prepare update")
        ingest = find_node(workflow, "API: Ingest prepared update")
        self.assertTrue(prepare["continueOnFail"])
        self.assertTrue(ingest["continueOnFail"])
        self.assertEqual(prepare["parameters"]["options"]["timeout"], 2000)
        self.assertEqual(ingest["parameters"]["options"]["timeout"], 2000)

    def test_normalizer_preserves_a_valid_contract_for_ingestion(self):
        workflow = load_workflow()
        code = find_node(workflow, "Code: Normalize prepared update")["parameters"]["jsCode"]
        payload = {
            "contractVersion": 1,
            "route": "message.text",
            "input": {"message": {"text": "sensitive-shadow-message"}},
        }
        runner = f"""
const code = {json.dumps(code)};
const payload = {json.dumps(payload)};
const startedAtMs = Date.now() - 7;
const run = new Function('$input', '$', code);
const result = run(
  {{ first: () => ({{ json: payload }}) }},
  () => ({{ first: () => ({{ json: {{ started_at_ms: startedAtMs }} }}) }})
);
console.log(JSON.stringify(result));
"""
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", runner],
            check=True,
            capture_output=True,
            text=True,
        )
        result = json.loads(completed.stdout)[0]["json"]

        self.assertEqual(
            set(result),
            {
                "prepare_ok",
                "contract_version",
                "route",
                "duration_ms",
                "failure_reason",
                "prepared_update",
            },
        )
        self.assertTrue(result["prepare_ok"])
        self.assertEqual(result["contract_version"], 1)
        self.assertEqual(result["route"], "message.text")
        self.assertLessEqual(result["duration_ms"], 60000)
        self.assertEqual(result["prepared_update"], payload)


if __name__ == "__main__":
    unittest.main()
