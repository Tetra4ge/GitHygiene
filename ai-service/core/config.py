"""Settings for ai-service.

Per phases/Phase_07.md §2: this service owns prompts and model calls only.
It receives everything it needs in the request body from api-gateway, so it
holds no database credentials — no SUPABASE_*, DATABASE_URL or NEO4J_*.

Per phases/Phase_10.md §3 (the Gemma 4 challenge): the Gemini API is the
primary inference path. OPENROUTER_API_KEY, if set, is a fallback only and
must never be described as the primary path.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PORT: int = 8000

    # Primary path — Gemini API with Gemma 4 models (AI_DESIGN.md §7.1).
    GEMINI_API_KEY: str | None = None
    GEMMA_MODEL_EXTRACT: str = "gemma-4-26b-a4b-it"
    GEMMA_MODEL_REASON: str = "gemma-4-31b-it"

    # Optional local mode (Phase_10.md §1) — not wired into the engine yet,
    # reserved so the LLM_PROVIDER switch exists before it is needed.
    LLM_PROVIDER: str = "gemini"
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # Fallback only, demoted per AI_DESIGN.md §7.1 — never the documented
    # primary path.
    OPENROUTER_API_KEY: str | None = None

    GEMINI_TIMEOUT_SECONDS: int = 30

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
