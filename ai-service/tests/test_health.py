def test_health_reports_up(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["service"] == "ai-service"
    assert body["status"] == "up"
    assert "extract" in body["models"]
    assert "reason" in body["models"]


def test_health_reports_ai_configured_flag(client):
    from core.config import settings

    body = client.get("/health").json()
    assert body["ai_configured"] == bool(settings.GEMINI_API_KEY)
