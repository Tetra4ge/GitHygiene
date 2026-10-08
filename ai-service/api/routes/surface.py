"""Stage 1 — POST /v1/extract-surface. phases/Phase_07.md §3."""

import logging

from fastapi import APIRouter, HTTPException

from core.config import settings
from llm.gemini_client import AIUnavailableError, AIValidationError, generate_structured
from llm.prompts import STAGE1_SYSTEM_PROMPT, stage1_user_prompt
from llm.response_schemas import STAGE1_RESPONSE_SCHEMA
from models.schemas import ExtractSurfaceRequest, ExtractSurfaceResponse, VulnerableSurface

logger = logging.getLogger("ai-service.surface")
router = APIRouter()


@router.post("/v1/extract-surface", response_model=ExtractSurfaceResponse)
async def extract_surface(req: ExtractSurfaceRequest) -> ExtractSurfaceResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI features are not configured")

    prompt = stage1_user_prompt(req.osv_id, req.aliases, req.summary, req.details, req.ecosystem, req.package_name)

    try:
        result: VulnerableSurface = generate_structured(
            model=settings.GEMMA_MODEL_EXTRACT,
            system_prompt=STAGE1_SYSTEM_PROMPT,
            user_prompt=prompt,
            response_schema=STAGE1_RESPONSE_SCHEMA,
            result_model=VulnerableSurface,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"AI features are not configured: {exc}") from exc
    except AIValidationError as exc:
        raise HTTPException(status_code=502, detail=f"AI analysis unavailable for this advisory: {exc}") from exc

    return ExtractSurfaceResponse(**result.model_dump(), model=settings.GEMMA_MODEL_EXTRACT)
