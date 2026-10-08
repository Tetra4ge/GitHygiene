"""Stage 1 — POST /v1/extract-surface. phases/Phase_07.md §3."""

from tests.conftest import requires_gemini

VALID_PAYLOAD = {
    "osv_id": "GHSA-test-0001",
    "aliases": ["CVE-2021-23337"],
    "summary": "Command Injection in lodash",
    "details": (
        "lodash versions prior to 4.17.21 are vulnerable to Command Injection "
        "via the template function. The vulnerable function is `template`, "
        "which can be exploited when attacker-controlled input reaches it."
    ),
    "ecosystem": "npm",
    "package_name": "lodash",
}


def test_rejects_missing_required_fields(client):
    resp = client.post("/v1/extract-surface", json={"osv_id": "X"})
    assert resp.status_code == 422


@requires_gemini
def test_extracts_surface_from_real_advisory(client):
    resp = client.post("/v1/extract-surface", json=VALID_PAYLOAD)
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["vulnerable_symbols"], list)
    assert isinstance(body["vulnerable_subpaths"], list)
    assert isinstance(body["vulnerable_configs"], list)
    assert isinstance(body["trigger_conditions"], list)
    assert body["exploit_requires_runtime"] in ("server", "client", "build", "unknown")
    assert body["extraction_confidence"] in ("low", "medium", "high")
    assert body["model"]  # non-empty — real model name, not "none"
    assert body["from_ecosystem_specific"] is False


@requires_gemini
def test_low_confidence_on_empty_advisory(client):
    payload = {**VALID_PAYLOAD, "summary": "", "details": None}
    resp = client.post("/v1/extract-surface", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    # An advisory with no text should not hallucinate symbols.
    assert body["vulnerable_symbols"] == [] or body["extraction_confidence"] == "low"
