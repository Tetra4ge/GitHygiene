# ai-service tests

```bash
cd ai-service
python -m pip install -r requirements-dev.txt
python -m pytest tests/ -v
```

Needs `GEMINI_API_KEY` set (in `.env` or the environment) for the live-model
tests; without it they're skipped, not failed. The `/health`, validation
(422), grounding-check, and 503-when-unconfigured tests always run — they
don't call Gemini.

Live-model tests call the real Gemini API once each. Running the whole
suite back-to-back can occasionally hit a transient 500 from the Gemini
backend or a free-tier rate limit on a single test; a retry in isolation
should pass.
