"""Phase 9 §4 — POST /v1/draft-issue. Draft-only, never calls GitHub."""

from unittest.mock import patch

from tests.conftest import requires_gemini

VALID_PAYLOAD = {
    "package_name": "lodash",
    "osv_id": "GHSA-test-0001",
    "severity": "high",
    "reachability": "reachable",
    "difficulty": "beginner",
    "rank": 8.5,
    "summary": "Command Injection in lodash's template function",
    "reasoning": "src/render.js calls _.template() with attacker-controlled input at line 42.",
    "evidence": [{"file": "src/render.js", "line": 42, "why": "calls the vulnerable template() function"}],
    "target_version": "4.17.21",
    "recommendation": "upgrade",
}


def test_rejects_missing_required_fields(client):
    resp = client.post("/v1/draft-issue", json={"package_name": "x"})
    assert resp.status_code == 422


@requires_gemini
def test_drafts_issue_for_reachable_finding(client):
    resp = client.post("/v1/draft-issue", json=VALID_PAYLOAD)
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"]
    assert body["problem_statement"]
    assert body["why_it_matters"]
    assert isinstance(body["suggested_files"], list)
    assert isinstance(body["acceptance_criteria"], list)
    assert isinstance(body["skills_needed"], list)
    assert body["model"]


def test_suggested_files_filtered_to_evidence_only(client):
    """suggested_files the model invents outside the evidence must be dropped,
    not passed through — mocked since this is a filter, not model behavior."""
    from models.schemas import IssueDraft

    fake_result = IssueDraft(
        title="Fix command injection in lodash template()",
        problem_statement="test",
        why_it_matters="test",
        suggested_files=["src/render.js", "src/totally/unrelated.js"],
        scope="small",
        acceptance_criteria=["lodash bumped to 4.17.21"],
        skills_needed=["javascript"],
    )

    with patch("api.routes.draft_issue.generate_structured", return_value=fake_result):
        resp = client.post("/v1/draft-issue", json=VALID_PAYLOAD)

    assert resp.status_code == 200
    body = resp.json()
    assert body["suggested_files"] == ["src/render.js"]


def test_returns_503_when_gemini_not_configured(client):
    with patch("api.routes.draft_issue.settings") as mock_settings:
        mock_settings.GEMINI_API_KEY = None
        resp = client.post("/v1/draft-issue", json=VALID_PAYLOAD)
    assert resp.status_code == 503
