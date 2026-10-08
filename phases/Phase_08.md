# Phase 8: AI Engine, Part 2 — Reachability Verdict and Remediation

**Tier:** Must have. This is the demo.

Design and rationale: [docs/AI_DESIGN.md](../docs/AI_DESIGN.md) §4.3–4.5.

## 1. Goal
For each finding, a judgement the user can act on: **is the vulnerable code
actually reachable from this repository, and should you upgrade, replace,
mitigate, or accept it** — with the reasoning cited to real lines of their code.

This is where the product stops being a scanner with an AI label and starts
answering the question scanners leave on the user's desk.

## 2. Stage 3

**`POST /v1/assess`** on `ai-service`; `api-gateway` exposes
`POST /api/v1/ai/assess { finding_id }`.

**Input** — assembled by `api-gateway`, every field already computed:

| Group | Fields |
|---|---|
| Advisory | id, aliases, severity, summary, Stage 1 extraction |
| Evidence | Stage 2 output, with the real code snippets |
| Dependency | direct or transitive, installed / fixed / latest version, major-version distance, dev or runtime, dependency path from Phase 6 |
| Repository | library or application, entry-point files by convention, package manager |

**Output:** the JSON schema in `AI_DESIGN.md` §4.3 — `reachability`,
`confidence`, `evidence[]`, `recommendation`, `target_version`, `reasoning`,
`breaking_change_risk`, `files_to_change`, `tests_to_run`, `side_effects`,
`effort`, `alternatives_considered[]`, `insufficient_evidence`.

**Model:** `gemma-4-31b-it` via the Gemini API, thinking `high`, function
calling to enforce the schema. The dense 31B is the stronger coder of the two
Gemma 4 models available on the API and this is the call where a wrong answer
costs most; Stage 1's cheaper MoE model handles the volume. See
`AI_DESIGN.md` §5.1.

**Why this is an LLM task.** There is no formula. A critical advisory in a
transitive dev-dependency that never runs in production is noise; a medium one
whose exact vulnerable call sits in a request handler with `req.body` flowing
into it is this afternoon's work. Weighing severity against where the call
actually is, what flows into it, how far behind the fix is, and what upgrading
would break is the per-finding judgement that makes triage take a day — and one
of its inputs is a code snippet, so no scoring function can express it.

## 3. Honesty constraints

These are product requirements, not style preferences. They are what separates a
defensible submission from one that a judge can break in thirty seconds.

- **`not_evidenced` is never rendered as "safe."** Dynamic `require`, reflection,
  computed property access, build-time codegen and transitive callers all defeat
  static search. The UI wording is *"no evidenced call path — not proof of
  safety."* Deprioritise; never dismiss. If one rule from this phase survives
  contact with a deadline, make it this one.
- **Every repository claim cites evidence Stage 2 returned.** A verdict naming a
  file that is not in the evidence is a bug — assert it in code and drop the
  verdict rather than display it.
- **No invented versions or advisory ids.** Fixed and latest versions are
  supplied as facts; the model restates them, never derives them.
- **`accept` is a permitted answer** (unreachable, low severity, no fix
  published) and the prompt must say so. A model that recommends upgrading
  everything has recommended nothing.
- **`insufficient_evidence: true`** when Stage 1 found no symbols and Stage 2
  found no imports. Say so instead of reasoning from severity alone.
- Every AI panel is labelled AI-generated, with the cited snippet beside it so
  the user checks the reasoning rather than trusting it.

## 4. Caching

Stage 3 keyed on (advisory, repository, dependency version, **commit sha**). The
sha matters: the verdict is about code, and new code deserves a new verdict.
Store with the model id that produced it. "Regenerate" bypasses the cache.
Reuse the `ai_reports` table shape from [TRD §5.1](../docs/TRD.md).

## 5. UI

- **Finding detail** — verdict badge (`reachable` / `likely_reachable` /
  `not_evidenced` / `unused`), recommendation, reasoning.
- **Evidence panel beside it** — the cited file, line and snippet, with a link to
  that line on GitHub. *This is the screenshot the submission lives on.* Build it
  before anything else on this page.
- **Remediation block** — target version, breaking-change risk and note, files to
  change, tests to run, alternatives considered.
- Loading state, failure message, Markdown rendered without raw HTML execution.

## 6. Done When
- A repository that really calls a vulnerable function gets `reachable`, with a
  file and line that you can open and confirm by eye.
- A repository that depends on the same package but never calls that function
  gets `not_evidenced` or `unused`, and the UI does not call it safe.
- A transitive finding is explained as transitive, naming the direct dependency
  that pulls it in.
- Recommendations differ across findings in the same repository. If everything
  comes back `upgrade`, the prompt is not using the evidence — fix that before
  demoing.
- Every file named in a verdict appears in that verdict's evidence.
- Requesting the same assessment twice makes one model call; a new commit makes
  a new one.
- With `GEMINI_API_KEY` unset, the app runs normally and AI affordances are
  hidden.
- The API key appears nowhere in the client bundle or the repository.

## 7. If Short on Time
Ship the verdict and the evidence panel; drop `tests_to_run`, `side_effects` and
`alternatives_considered` from the UI (keep them in the JSON). One finding shown
convincingly, cited to a real line, beats five findings summarised.

## 8. Implementation Status (Current Codebase)
- **`ai-service/` is a scaffold.** `main.py` runs and serves `/health`; every
  other file — `core/config.py`, `llm/gemini_client.py`, `llm/prompts.py`,
  `models/*.py`, `db/*.py`, `services/ast_parser.py`, `api/routes/*.py` — is a
  one-line `# TODO`.
- **`api-gateway/services/ai.service.js` is a one-line stub.**
- **Provider order must change.** `ai-service/.env.example` lists
  `OPENROUTER_API_KEY` as primary with `GEMINI_API_KEY` as fallback. The Gemma 4
  challenge requires Gemma **through the Gemini API** (`AI_DESIGN.md` §7), so
  Gemini becomes the primary path. `GEMMA_MODEL_EXTRACT` and
  `GEMMA_MODEL_REASON` are the two new variables; both need adding to
  `.env.example` when implemented.
- **Nothing in this phase or Phase 7 is built.**
