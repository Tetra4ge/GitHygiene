# Phase 7: AI Engine, Part 1 — Vulnerable Surface and Code Evidence

**Tier:** Must have. This and Phase 8 are the project's differentiator.

Design and rationale: [docs/AI_DESIGN.md](../docs/AI_DESIGN.md) §4.1–4.2.
This phase builds Stages 1 and 2; Phase 8 builds Stage 3 and the UI.

## 1. Goal
For a given finding, know **which functions the advisory actually blames**, and
**whether this repository's own code calls them** — with a file and a line
number to show for it.

Nothing user-facing ships in this phase. It produces the evidence Phase 8
reasons over, and it is worth building and testing on its own because a wrong
answer here is invisible later: Stage 3 will reason beautifully over bad
evidence.

## 2. Service split

`api-gateway` owns Postgres, GitHub tokens, RBAC and org-scoping. `ai-service`
owns prompts and model calls. The split is already implied by
`api-gateway/services/ai.service.js`'s own comment and by `AI_SERVICE_DEV_URL`
in `api-gateway/.env.example`.

```text
api-gateway                                  ai-service (FastAPI)
  ├── assembles context from Postgres/Neo4j
  ├── fetches repo code from GitHub      ──▶  Stage 1: advisory → surface (LLM)
  ├── runs the evidence search                Stage 3: evidence → verdict (LLM)
  └── caches and stores results          ◀──  returns validated JSON
```

`ai-service` therefore needs **no database credentials** for either stage — it
receives everything in the request body. Drop `SUPABASE_*`, `DATABASE_URL` and
`NEO4J_*` from `ai-service/.env.example` when implementing, and the unused
`pgvector` / `langchain-postgres` / Celery / Redis lines from its
`requirements.txt` (see `AI_DESIGN.md` §5.2 for why there is no vector store).

Also fix `ai-service/main.py`: its title and description are leftover
boilerplate from an unrelated template about "breaking down monoliths into
microservices."

## 3. Stage 1 — Advisory → vulnerable surface

**`POST /v1/extract-surface`** on `ai-service`.

**Why this is an LLM task** and not a parser: the OSV schema has no standard
field for affected functions — it leaves that to `ecosystem_specific`, which npm
and PyPI advisories rarely populate. The function name usually exists only in
the advisory's English prose. Full reasoning in `AI_DESIGN.md` §4.1.

**Input:** advisory id, aliases, summary, **full `details` text** (stored by
Phase 5 §3.3), CWE ids, ecosystem, package name, affected ranges. No user code.

**Output:** the JSON schema in `AI_DESIGN.md` §4.1 — `vulnerable_symbols`,
`vulnerable_subpaths`, `vulnerable_configs`, `trigger_conditions`,
`attack_vector`, `needs_untrusted_input`, `exploit_requires_runtime`,
`extraction_confidence`.

**Model:** `gemma-4-26b-a4b-it` via the Gemini API, thinking `minimal`, function
calling used to enforce the schema.

**Rules:**
- Empty lists with `extraction_confidence: "low"` is a correct, expected answer.
  Many advisories genuinely name no function. Forbid guessing in the prompt, and
  do not treat low confidence as a failure.
- Validate against the schema. One retry, then store an explicit failure.
- If `affected[].ecosystem_specific` already lists functions, use it and skip
  the model call. Free and exact beats inferred.
- **Cache by advisory id, platform-wide, forever.** Repository-independent, so
  one call serves every user who ever hits that advisory. This is what keeps the
  demo fast and the bill near zero.

## 4. Stage 2 — Evidence retrieval (no model)

In `api-gateway`. Deterministic by design: the model is never asked *whether*
code calls something, only to interpret code it has been shown.

**Fetch:** `GET /repos/{owner}/{repo}/tarball/{ref}` with the caller's GitHub
token — one request for the whole repository. Extract to a temp directory,
delete after the scan. Cap the download (~25 MB suggested) and skip
`node_modules`, `.git`, `dist`, `build`, `vendor`, lockfiles and binaries.
Read-only, consistent with the platform's never-write principle.

*(`GET /search/code` is a fallback, not the default: it is rate-limited to a
handful of requests per minute and indexes only the default branch. Verify its
current limits before depending on it.)*

**Search, in two passes:**
1. **Import sites** — files importing the package: `require('lodash')`,
   `import _ from 'lodash'`, `import {merge} from 'lodash'`, `from lodash import`,
   `import lodash`. Record the local binding name.
2. **Call sites** — inside those files only, references to the Stage 1 symbols,
   using the binding found in pass 1 (`_.merge(`, `merge(`, `lodash.merge(`).

**Output:** the evidence JSON in `AI_DESIGN.md` §4.2 — `package_imported`,
`import_sites`, `call_sites` (file, line, symbol, snippet), `searched_files`,
`truncated`. Include ~3 lines of context around each call site; that snippet is
what Stage 3 reasons over and what the UI shows the user.

**Start with regex, not an AST.** `ai-service/services/ast_parser.py` exists as
a stub, and the temptation is to fill it first. Regex scoped to files that
already import the package is enough for a demo, needs no parser per language,
and fails soft on syntax it does not understand. Promote to `tree-sitter` only
if testing shows real noise. An AST is a day of work that improves precision on
a problem you have not measured yet.

**Meaningful negative results**, all of which must survive to Stage 3 intact:
- `package_imported: true, call_sites: []` — present, vulnerable function unused.
- `package_imported: false` on a transitive dependency — your code never touches
  it; some other package does.
- `truncated: true` — the search was capped; say so rather than implying a clean
  sweep.

## 5. Done When
- Stage 1 on a real advisory that names functions in prose (an old `lodash`
  prototype-pollution advisory is the canonical test) returns those exact
  function names.
- Stage 1 on an advisory that names no function returns empty lists and low
  confidence — **and does not invent one**. Test this deliberately; it is the
  failure mode that discredits the whole feature.
- Stage 2 on a repository that calls the vulnerable function returns the right
  file and the right line, verified by opening the file.
- Stage 2 on a repository that depends on the package but never calls that
  function returns `call_sites: []`.
- The same advisory requested twice makes one model call.
- With no API key set, both stages fail closed and the rest of the app is
  unaffected.

## 6. If Short on Time
npm only. The lockfile path is better developed, npm advisories name functions
more often than PyPI ones, and one ecosystem demoed convincingly beats two
demoed partially. Say in the README that PyPI evidence retrieval is not built.
