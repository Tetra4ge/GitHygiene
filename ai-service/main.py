from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.surface import router as surface_router
from api.routes.assess import router as assess_router
from api.routes.draft_issue import router as draft_issue_router
from core.config import settings

app = FastAPI(
    title="GitHygiene AI Engine",
    description=(
        "Reachability and remediation engine for GitHygiene. Stage 1 extracts the "
        "vulnerable surface from an OSV advisory; Stage 3 judges whether a repository's "
        "own code actually reaches it and recommends a remediation. Both stages run "
        "Gemma 4 through the Gemini API (docs/AI_DESIGN.md)."
    ),
    version="1.0.0",
)

# CORS: restrict to the api-gateway in production via CLIENT_ORIGIN-equivalent
# config on that side — this service is never called directly from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(surface_router, tags=["Engine"])
app.include_router(assess_router, tags=["Engine"])
app.include_router(draft_issue_router, tags=["Engine"])


@app.get("/health", tags=["Health"])
async def health_check():
    """Reports whether a Gemini API key is configured — the engine is never
    load-bearing, so the rest of the platform works either way
    (AI_DESIGN.md §10)."""
    return {
        "success": True,
        "service": "ai-service",
        "status": "up",
        "ai_configured": bool(settings.GEMINI_API_KEY),
        "models": {
            "extract": settings.GEMMA_MODEL_EXTRACT,
            "reason": settings.GEMMA_MODEL_REASON,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=True)
