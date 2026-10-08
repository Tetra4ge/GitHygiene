"""Stage 3 — POST /v1/assess. phases/Phase_08.md §2."""

from unittest.mock import patch

from tests.conftest import requires_gemini

VALID_PAYLOAD = {
    "osv_id": "GHSA-test-0001",
    "severity": "high",
    "summary": "Command Injection in lodash's template function",
    "surface": {
        "vulnerable_symbols": ["template"],
        "vulnerable_subpaths": [],
        "vulnerable_configs": [],
        "trigger_conditions": ["attacker-controlled template string"],
        "attack_vector": "command-injection",
        "needs_untrusted_input": True,
        "exploit_requires_runtime": "server",
        "extraction_confidence": "high",
        "notes": "",
    },
    "evidence": {
        "package_imported": True,
        "import_sites": [{"file": "src/render.js", "line": 3, "text": "const _ = require('lodash');"}],
        "call_sites": [
            {
                "file": "src/render.js",
                "line": 42,
                "symbol": "template",
                "snippet": "const compiled = _.template(userInput);\ncompiled();",
            }
        ],
        "searched_files": 120,
        "truncated": False,
    },
    "dependency": {
        "is_direct": True,
        "installed_version": "4.17.15",
        "fixed_version": "4.17.21",
        "latest_version": "4.17.21",
        "major_versions_behind": 0,
        "is_dev_dependency": False,
        "dependency_path": None,
        "package_manager": "npm",
    },
    "repository": {
        "kind": "application",
        "entry_point_files": ["src/index.js"],
        "package_manager": "npm",
    },
}


def test_rejects_missing_required_fields(client):
    resp = client.post("/v1/assess", json={"osv_id": "X"})
    assert resp.status_code == 422


@requires_gemini
def test_assesses_reachable_finding(client):
    resp = client.post("/v1/assess", json=VALID_PAYLOAD)
    assert resp.status_code == 200
    body = resp.json()
    assert body["reachability"] in ("reachable", "likely_reachable", "not_evidenced", "unused")
    assert body["confidence"] in ("low", "medium", "high")
    assert body["recommendation"] in ("upgrade", "replace", "mitigate", "accept")
    assert body["remediation_mechanics"]["strategy"] in ("direct-bump", "override")
    assert body["model"]
    # Grounding: every cited file must be one Stage 2 actually returned.
    allowed = {"src/render.js"}
    for ev in body["evidence"]:
        assert ev["file"] in allowed


@requires_gemini
def test_unused_when_package_never_imported(client):
    payload = {
        **VALID_PAYLOAD,
        "evidence": {
            "package_imported": False,
            "import_sites": [],
            "call_sites": [],
            "searched_files": 85,
            "truncated": False,
        },
    }
    resp = client.post("/v1/assess", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    # No evidence sites exist, so the model cannot ground a citation in them.
    assert body["evidence"] == []


def test_grounding_check_fails_closed_on_hallucinated_citation(client):
    """The model is never trusted to cite a file Stage 2 didn't return —
    mocked here since getting Gemma to hallucinate on demand isn't
    deterministic enough for a real assertion."""
    from models.schemas import AssessResponse, RemediationStrategy

    fake_result = AssessResponse(
        reachability="reachable",
        confidence="high",
        evidence=[{"file": "not/in/evidence.js", "line": 1, "why": "hallucinated"}],
        recommendation="upgrade",
        reasoning="test",
        remediation_mechanics=RemediationStrategy(strategy="direct-bump"),
        model="test-model",
    )

    with patch("api.routes.assess.generate_structured", return_value=fake_result):
        resp = client.post("/v1/assess", json=VALID_PAYLOAD)

    assert resp.status_code == 502
    assert "not in the evidence" in resp.json()["detail"]


def test_returns_503_when_gemini_not_configured(client):
    with patch("api.routes.assess.settings") as mock_settings:
        mock_settings.GEMINI_API_KEY = None
        resp = client.post("/v1/assess", json=VALID_PAYLOAD)
    assert resp.status_code == 503
