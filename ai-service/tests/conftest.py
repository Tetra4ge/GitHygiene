"""Shared fixtures. Runs against the real app with whatever GEMINI_API_KEY
is in .env — Stage 1/3/draft-issue tests make real Gemini calls unless
GEMINI_API_KEY is unset, in which case they're skipped rather than failed."""

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from main import app

requires_gemini = pytest.mark.skipif(
    not settings.GEMINI_API_KEY,
    reason="GEMINI_API_KEY not set — skipping live-model tests",
)


@pytest.fixture
def client():
    return TestClient(app)
