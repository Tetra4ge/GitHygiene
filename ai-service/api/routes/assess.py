"""Stage 3 — POST /v1/assess. phases/Phase_08.md §2."""

import logging

from fastapi import APIRouter, HTTPException

from core.config import settings
from llm.gemini_client import AIUnavailableError, AIValidationError, generate_structured
from llm.prompts import STAGE3_SYSTEM_PROMPT, stage3_user_prompt
from llm.response_schemas import STAGE3_RESPONSE_SCHEMA
from models.schemas import AssessRequest, AssessResponse

logger = logging.getLogger("ai-service.assess")
router = APIRouter()


@router.post("/v1/assess", response_model=AssessResponse)
async def assess(req: AssessRequest) -> AssessResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI features are not configured")

    payload = req.model_dump()
    prompt = stage3_user_prompt(payload)

    try:
        result = generate_structured(
            model=settings.GEMMA_MODEL_REASON,
            system_prompt=STAGE3_SYSTEM_PROMPT,
            user_prompt=prompt,
            response_schema=STAGE3_RESPONSE_SCHEMA,
            result_model=AssessResponse,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"AI features are not configured: {exc}") from exc
    except AIValidationError as exc:
        raise HTTPException(status_code=502, detail=f"AI analysis unavailable for this finding: {exc}") from exc

    # Grounding check (AI_DESIGN.md §4.5): every cited file must be one Stage 2
    # actually returned. A verdict citing a file not in the evidence is a bug —
    # fail closed rather than display it, per phases/Phase_08.md §3.
    allowed_files = {s.file for s in req.evidence.import_sites} | {s.file for s in req.evidence.call_sites}
    for cited in result.evidence:
        if cited.file not in allowed_files:
            raise HTTPException(
                status_code=502,
                detail=f"AI analysis unavailable for this finding: verdict cited '{cited.file}', "
                "which is not in the evidence Stage 2 returned.",
            )

    result.model = settings.GEMMA_MODEL_REASON
    return result
