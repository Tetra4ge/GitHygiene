"""Thin client for the Gemini API, used to run Gemma 4 models with
schema-constrained JSON output (structured output / "response schema"
mode — the Gemini API's documented mechanism for enforcing a JSON contract,
used here in place of a function-calling tool definition for the same end:
a response that always validates against the schema, never half-parsed
prose).

AI_DESIGN.md §7.1: Gemini API + Gemma 4 is the primary, documented path for
both the Best Use of Gemma 4 challenge and Best Open-Source AI Project.
"""

from __future__ import annotations

import json
import logging
from typing import Optional, Type

import requests
from pydantic import BaseModel, ValidationError

from core.config import settings

logger = logging.getLogger("ai-service.gemini")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class AIUnavailableError(Exception):
    """Raised when no provider is configured, or the provider call itself fails."""


class AIValidationError(Exception):
    """Raised when the model's response does not validate against the schema
    after one retry — surfaced by callers as 'AI analysis unavailable', never
    half-parsed or shown as prose (AI_DESIGN.md §4.5)."""


def _call_gemini(model: str, system_prompt: str, user_prompt: str, response_schema: dict) -> str:
    if not settings.GEMINI_API_KEY:
        raise AIUnavailableError("GEMINI_API_KEY is not configured.")

    url = f"{GEMINI_BASE_URL}/{model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": response_schema,
        },
    }

    try:
        resp = requests.post(
            url,
            headers={"x-goog-api-key": settings.GEMINI_API_KEY, "Content-Type": "application/json"},
            json=body,
            timeout=settings.GEMINI_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise AIUnavailableError(f"Gemini API request failed: {exc}") from exc

    if resp.status_code != 200:
        raise AIUnavailableError(f"Gemini API returned {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    try:
        candidates = data["candidates"]
        parts = candidates[0]["content"]["parts"]
        # Gemma 4's thinking mode emits "thought" parts ahead of the actual
        # answer — concatenating those in would corrupt the JSON payload.
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    except (KeyError, IndexError) as exc:
        raise AIUnavailableError(f"Unexpected Gemini API response shape: {data}") from exc

    if not text.strip():
        finish_reason = data.get("candidates", [{}])[0].get("finishReason", "unknown")
        raise AIUnavailableError(f"Gemini API returned no content (finishReason={finish_reason}).")

    return _strip_markdown_fence(text)


def _strip_markdown_fence(text: str) -> str:
    """responseMimeType=application/json usually returns bare JSON, but the
    model occasionally wraps it in a ```json ... ``` fence — or, with Gemma 4's
    thinking mode, appends a stray trailing ``` with no opening fence at all.
    Strip either shape before json.loads() instead of letting it fail parsing."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else stripped[3:]
        stripped = stripped.strip()
    if stripped.endswith("```"):
        stripped = stripped[:-3].strip()
    return stripped


def generate_structured(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    response_schema: dict,
    result_model: Type[BaseModel],
) -> BaseModel:
    """Calls Gemini, validates the JSON against `result_model`, retries once
    on a validation failure, then raises AIValidationError — never returns a
    half-parsed or unvalidated result."""

    last_error: Optional[Exception] = None
    prompt = user_prompt

    for attempt in range(2):
        try:
            raw_text = _call_gemini(model, system_prompt, prompt, response_schema)
            parsed = json.loads(raw_text)
            return result_model.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = exc
            logger.warning("Schema validation failed on attempt %s: %s", attempt + 1, exc)
            prompt = (
                f"{user_prompt}\n\nYour previous response did not match the required JSON "
                f"schema ({exc}). Return ONLY valid JSON matching the schema exactly, no "
                "markdown, no commentary."
            )
        except AIUnavailableError:
            raise

    raise AIValidationError(f"Model response failed schema validation twice: {last_error}")
