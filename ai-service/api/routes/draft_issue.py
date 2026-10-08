"""Phase 9 §4 — one model call, on demand, to turn a ranked finding into a
draft GitHub issue. Draft-only: this service never calls the GitHub issues
API (phases/Phase_09.md §4 / AGENTS.md)."""

import logging

from fastapi import APIRouter, HTTPException

from core.config import settings
from llm.gemini_client import AIUnavailableError, AIValidationError, generate_structured
from llm.prompts import DRAFT_ISSUE_SYSTEM_PROMPT, draft_issue_user_prompt
from llm.response_schemas import DRAFT_ISSUE_RESPONSE_SCHEMA
from models.schemas import DraftIssueRequest, DraftIssueResponse, IssueDraft

logger = logging.getLogger("ai-service.draft_issue")
router = APIRouter()


@router.post("/v1/draft-issue", response_model=DraftIssueResponse)
async def draft_issue(req: DraftIssueRequest) -> DraftIssueResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI features are not configured")

    prompt = draft_issue_user_prompt(req.model_dump())

    try:
        result = generate_structured(
            model=settings.GEMMA_MODEL_REASON,
            system_prompt=DRAFT_ISSUE_SYSTEM_PROMPT,
            user_prompt=prompt,
            response_schema=DRAFT_ISSUE_RESPONSE_SCHEMA,
            result_model=IssueDraft,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"AI features are not configured: {exc}") from exc
    except AIValidationError as exc:
        raise HTTPException(status_code=502, detail=f"Could not draft an issue for this finding: {exc}") from exc

    allowed_files = {e.file for e in req.evidence}
    suggested = [f for f in result.suggested_files if f in allowed_files] if allowed_files else []

    return DraftIssueResponse(**{**result.model_dump(), "suggested_files": suggested}, model=settings.GEMMA_MODEL_REASON)
