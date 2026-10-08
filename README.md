# GitHygiene

Most dependency scanners tell you which advisories exist somewhere in your
dependency tree. GitHygiene answers the question that follows: **does this
one actually matter in my code?** It reads the advisory, checks whether the
function it blames is really called in your repository, shows you the file
and the line, and tells you whether to upgrade, replace, mitigate or accept
it — citing real code the whole way.

Built for **Hacktoberfest Hack Day — Coimbatore 2026** (INIT CLUB × iDEA CLUB,
in collaboration with MLH).

> **A note on this README.** It separates what is **built** from what is
> **planned**, and never lists a plan as a feature. §9 tracks every remaining
> gap honestly, including the parts of the original plan (local Ollama mode,
> PR risk analysis, trend charts, actual deployment) that did not make it in.

---

## 1. Team

| Name | Contribution |
|---|---|
| Prajwal Priyadarshan | _fill in contribution_ |
| _add teammates here_ | |

*(Replace these placeholders with the real roster before submission.)*

## 2. Problem Statement

A typical repository pulls in hundreds of open-source packages, most of them
transitively, and the maintainer never sees them. When an advisory is published,
answering "am I affected, and through which package?" means jumping between
GitHub, a scanner, advisory databases and registries — once per repository.

The harder problem is what comes after the scan. A scanner reports every
advisory present in the tree with equal weight, and most of them are not
exploitable in your code: the package is there, but the vulnerable function is
never called, or it is pulled in by a build tool that never runs in production.
Working out which findings are real is manual, slow, and needs someone who can
read both the advisory and the codebase. So the list gets muted, and the one
finding that mattered is muted with it.

The people hit hardest have the least tooling: students, solo maintainers and
small teams who look after several repositories and have no security engineer.

## 3. Solution

A signed-in user (GitHub OAuth through Supabase Auth) belongs to an
**organization**, which owns **projects**, which own **repositories**.

**Built today:**

1. **Sync repositories** from GitHub into a project (`POST /api/v1/repos/sync`).
2. **Ingest a manifest** (`package.json` or `requirements.txt`) from the GitHub
   Contents API into Supabase Storage (`POST /api/v1/manifests/ingest`).
3. **Extract the full dependency tree** — direct *and* transitive packages,
   walked from `package-lock.json` (lockfile v2/v3) with the parent→child
   edges that make the graph and the reachability engine possible, or pinned
   versions from `requirements.txt` for Python (`POST /api/v1/parser/extract`).
4. **Scan against real osv.dev advisories** by exact package + version —
   severity, full advisory text, fixed version — and compute a 0–100
   repository security score (`POST /api/v1/osv/scan`). The original
   seeded-CVE/`ILIKE` scanner from the first build is kept running alongside
   it, unchanged (`POST /api/v1/scanner/scan`).
5. **Write the dependency graph to Neo4j** — packages shared across
   repositories, with blast-radius and shortest-path queries
   (`GET /api/v1/graph/*`).
6. **Run the two-stage AI reachability engine** on any finding — extract
   which functions an advisory blames, search this repository's own source
   for real calls to them, and get a cited verdict plus a remediation patch
   (`POST /api/v1/ai/assess`). See §4.
7. **Draft a contributor issue** from a ranked finding, one model call,
   copy-to-clipboard only — the platform never opens an issue itself
   (`POST /api/v1/ai/draft-issue`).
8. **Dashboard, fix-first ranking and notifications** — vulnerabilities
   broken down by severity *and* by reachability, a deterministic fix-first
   list, riskiest repositories, and a notification bell for scan events
   (`GET /api/v1/dashboard/summary`, `GET /api/v1/notifications`).

Role-based access runs throughout: every query is scoped to the caller's
organization through a shared `getCallerContext` helper, with an `admin` role
that sees across organizations and a `manager` role that can create
organizations and manage membership.

## 4. Innovation and Differentiation

### The engine

One pipeline, three stages, per finding. Full specification in
[docs/AI_DESIGN.md](docs/AI_DESIGN.md).

```text
OSV advisory (prose)
   │
   ├─ Stage 1 ── Gemma 4 26B A4B ──▶ which functions does the advisory actually blame?
   │
   ├─ Stage 2 ── deterministic ─────▶ does this repo import the package and call them?
   │                                  (tarball + symbol search — no model involved)
   │
   └─ Stage 3 ── Gemma 4 31B ───────▶ reachable? + upgrade / replace / mitigate / accept
```

**Why the middle stage has no model.** The model is never asked *whether* your
code calls something — only to interpret code it has been shown. Every claim the
engine makes about your repository cites a file and a line that a deterministic
search returned. That is what makes the output checkable instead of plausible.

**Why Stage 1 needs a model at all.** The OSV schema has no standard field for
affected functions; it leaves that to `ecosystem_specific`, which npm and PyPI
advisories rarely populate. For those ecosystems the vulnerable function name
exists only in the advisory's English prose — *"the `merge`, `mergeWith` and
`defaultsDeep` functions are vulnerable to prototype pollution"* — so extracting
it is text comprehension, not parsing.

### What makes it different

- **It answers "does this matter in my code?"**, with the line of code as the
  answer, rather than restating the advisory more fluently.
- **It is willing to say no.** Ranking a reachable medium above an unreachable
  critical is the output that makes the rest credible.
- **It is honest about not knowing.** "No evidenced call path" is never
  displayed as "safe" — static search misses dynamic imports, reflection and
  transitive callers, and the product says so where the user reads it.
- **Cross-repository blast radius** — which of an organization's repositories one
  advisory reaches, and through what chain of packages.
- **Open models, open data** — two Apache-2.0 Gemma 4 models over OSV.dev and the
  public registries. The same weights can run locally for private code.
- **Ranking is not AI, and does not claim to be.** Impact, difficulty and the
  fix-first order are computed from stored numbers.

## 5. Technical Implementation

### 5.1 Architecture

```text
frontend/      React 19 + Vite + Tailwind CSS — dashboard UI
                 ├── Supabase Auth (GitHub OAuth)
                 └── REST calls to api-gateway

api-gateway/   Express 5 — REST API, owns all database access, GitHub tokens, RBAC
                 ├── Supabase Auth JWKS (verifies session tokens)
                 ├── Supabase Storage (manifest file storage)
                 ├── PostgreSQL via `pg` — scans, dependencies, findings, caches
                 ├── Neo4j driver — writes the dependency graph after every OSV scan
                 ├── osv.dev, npm registry, PyPI JSON API
                 ├── GitHub REST API (repo listing, manifests, lockfiles, tarballs)
                 └── ai-service — assembles context, posts it, never sends a DB credential

ai-service/    FastAPI (Python) — prompts and model calls only, no database access
                 └── Gemini API → Gemma 4 (POST /v1/extract-surface, /v1/assess, /v1/draft-issue)
```

The client never talks to Postgres, Neo4j or GitHub directly. `ai-service` holds
the model key and no database credentials; `api-gateway` holds the database and
no model key.

### 5.2 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, React Router, Zustand, Recharts, `react-force-graph-2d`, Framer Motion, Lenis |
| Backend | Node.js, Express 5 |
| Auth | Supabase Auth (GitHub OAuth), verified server-side against Supabase's JWKS (`jose`) |
| Database | PostgreSQL via `pg` (connection pool), no ORM |
| Graph DB | Neo4j via `neo4j-driver` — packages, edges and advisories, written after every OSV scan |
| File storage | Supabase Storage (ingested manifests) |
| API docs | `swagger-jsdoc` + `swagger-ui-express`, at `/api-docs` |
| AI engine | FastAPI service, Gemma 4 via the Gemini API (`requests`, no SDK) |
| External data | GitHub REST API, osv.dev, npm registry, PyPI JSON API |

### 5.3 Database Schema

`organizations → projects → repositories → dependency_files / dependencies →
dependency_edges`, plus the two parallel vulnerability paths — the original
seeded `cves` / `dependency_vulnerabilities` / `security_alerts` tables, and
the real `osv_vulnerabilities` / `osv_findings` — and the AI engine's two
caches, `advisory_surfaces` (Stage 1, by advisory id) and `ai_assessments`
(Stage 3, by advisory + repository + version + commit sha). Full DDL,
reconstructed from the controllers and verified against a real Postgres 16
instance: **[docs/DB_SCHEMA.md](docs/DB_SCHEMA.md)**.

```bash
cd api-gateway && node utils/init-db.js   # reads docs/DB_SCHEMA.md, provisions every table
```

### 5.4 API Surface

All routes under `/api/v1`, requiring `Authorization: Bearer <supabase_jwt>`
except `/health`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` *(no auth)* | Postgres + Neo4j connectivity |
| POST · GET | `/orgs` | Create *(admin/manager)* · list organizations |
| GET | `/users/me` · `/users` | Current profile · members *(admin/manager)* |
| PUT | `/users/:userId/role` | Change a member's role *(admin/manager)* |
| POST · GET | `/repos/sync` · `/repos` | Sync from GitHub · list, with score |
| GET · POST | `/github/repos` · `/github/token` | Available repos · OAuth exchange |
| POST | `/manifests/ingest` | Fetch a manifest from GitHub and store it |
| POST | `/parser/extract` | Parse direct + transitive dependencies into Postgres |
| POST | `/scanner/scan` | Run the original seeded-CVE / `ILIKE` scan |
| GET · PATCH | `/scanner/alerts` · `/scanner/alerts/:id/resolve` | List · resolve |
| POST | `/osv/scan` | Real osv.dev scan — findings, registry lookups, score |
| GET | `/osv/findings` | Findings for a repository |
| GET | `/graph/blast-radius/:vulnId` · `/shared` · `/top-packages` · `/repo/:id` | Neo4j queries, `503` if the graph is unreachable |
| POST | `/ai/extract-surface` | Stage 1 — advisory → vulnerable surface (cached) |
| POST | `/ai/assess` | Stage 3 — reachability verdict + remediation (cached by commit) |
| POST | `/ai/draft-issue` | One model call — ranked finding → draft GitHub issue |
| GET | `/dashboard/summary` | Totals, severity × reachability, fix-first top 5 |
| GET · PATCH | `/notifications` · `/notifications/:id/read` | List · mark read |

Interactive documentation at `/api-docs`.

## 6. Implementation During the Hackathon

_Fill in team-specific contribution details before submission — who built
which piece and on what timeline._ What the codebase shows, end to end: an
org/project/repository data model with role-based access scoped through
`getCallerContext`; GitHub repo sync and manifest ingestion to Supabase
Storage; a full `package-lock.json` tree walk (direct + transitive packages,
plus parent→child edges) and pinned-`requirements.txt` parsing; the original
transactional seeded-CVE scanner, kept running; a second, real detection path
against osv.dev with registry lookups and a documented 0–100 scoring
formula; a Neo4j graph write on every scan with blast-radius and
shortest-path queries; a two-stage (three-step) AI reachability engine —
Gemma 4 extracting the vulnerable surface from advisory prose, a
deterministic GitHub-tarball regex search for real import/call sites in the
repository's own code, and Gemma 4 again judging reachability and
remediation strategy, grounded to fail closed on any citation outside the
evidence it was given; deterministic fix-first ranking and a dashboard with
a reachability breakdown; an issue-drafting endpoint; and a notification
bell. `docs/DB_SCHEMA.md` was written and verified against a real Postgres
instance so a clean clone can actually provision its database.

## 7. Open Source and AI Usage

### 7.1 AI models

Both models are open-weight, Apache 2.0, and reached through the Gemini API.
Full registry, including why there are two: [docs/AI_DESIGN.md](docs/AI_DESIGN.md) §5.

| | Stage 1 — extraction | Stage 3 — reasoning |
|---|---|---|
| Model | Gemma 4 26B A4B (instruction-tuned) | Gemma 4 31B (instruction-tuned, dense) |
| Provider | Google DeepMind | Google DeepMind |
| Gemini API id | `gemma-4-26b-a4b-it` | `gemma-4-31b-it` |
| Hugging Face | [`google/gemma-4-26B-A4B-it`](https://huggingface.co/google/gemma-4-26B-A4B-it) | [`google/gemma-4-31B-it`](https://huggingface.co/google/gemma-4-31B-it) |
| Licence | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) (open weights) | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) (open weights) |
| Parameters | 25.2B total, 3.8B active (MoE) | 30.7B dense |
| Context | 256K tokens | 256K tokens |
| Task | Advisory prose → vulnerable symbols | Code evidence → reachability + remediation |
| Input · Output | Advisory text · JSON | Evidence, snippets, dependency facts · JSON |
| Inference | Remote, Gemini API | Remote, Gemini API |
| Local resources | None | None |

The split is cost-driven: Stage 1 is high-volume and easy (the MoE model
activates ~3.8B parameters per token), Stage 3 is low-volume and hard (the dense
31B is the better coder of the two). Both run through the same Gemini API
client (`ai-service/llm/gemini_client.py`) with the model id as a parameter,
using the Gemini API's JSON-schema-constrained structured output to enforce
the contract — retried once on a validation failure, then surfaced as
"unavailable" rather than shown half-parsed. Stage 2 uses no model: it
fetches the repository's tarball and regex-searches it for the symbols
Stage 1 named, and every claim Stage 3 makes is checked in code against
that evidence before it is ever returned.

**Where this runs:** `ai-service/api/routes/surface.py` (Stage 1),
`api-gateway/services/evidence.service.js` (Stage 2),
`ai-service/api/routes/assess.py` (Stage 3),
`ai-service/api/routes/draft_issue.py` (issue drafting). The input/output
contracts match `docs/AI_DESIGN.md` §4.1–4.3.

Open weights are not incidental here: they are what allows the same models, the
same prompts and the same schemas to run locally for private repositories
(`phases/Phase_10.md` §1) — the one capability a closed model could not provide.

*Figures above are from Google's published model cards and the Gemini API Gemma
documentation, read 2026-10-08 — verify them, and re-check the licence terms in
the weights you actually pull, before final submission. Open-weight does not
automatically mean every part of a model is open source. This project has
published no benchmark of its own — no accuracy/precision claim is made for
the reachability verdict.*

### 7.2 Libraries

**Backend (`api-gateway`):** Express 5, `@supabase/supabase-js`, `pg`,
`pg-copy-streams`, `neo4j-driver`, `jose`, `jsonwebtoken`, `axios`, `tar`,
`cors`, `morgan`, `dotenv`, `swagger-jsdoc`, `swagger-ui-express` — MIT /
Apache-2.0. `tar` extracts the GitHub tarball Stage 2 searches.

**Frontend:** React 19, Vite, Tailwind CSS 4, React Router, Zustand, Recharts,
`react-force-graph-2d`, Framer Motion, Lenis, `@supabase/supabase-js`, Axios,
Lucide icons — MIT.

**AI (`ai-service`):** FastAPI, Pydantic (+ `pydantic-settings`), `requests`,
`python-dotenv` — that's the whole list. The original scaffold's LangChain,
LangGraph, Celery, Redis and `pgvector` lines were removed: the design needs
no vector store and no task queue ([AI_DESIGN.md](docs/AI_DESIGN.md) §5.2),
and a plain HTTP client is enough for the Gemini API's structured-output
mode — no SDK needed.

**External data:** the GitHub REST API (repos, contents, commits, tarballs),
osv.dev (`/v1/querybatch`, `/v1/vulns/{id}`), the npm registry and the PyPI
JSON API.

## 8. Setup and Usage

### Prerequisites
- Node.js 18+
- Python 3.11+
- A Supabase project (Auth + Postgres + Storage) with GitHub OAuth configured
- A reachable PostgreSQL database (`api-gateway` connects via `DATABASE_URL`) —
  use Supabase's **pooler** connection string (`aws-0-<region>.pooler.supabase.com:6543`),
  not the direct `db.<ref>.supabase.co` host: Supabase's direct host resolves
  IPv6-only by default, which fails outright on an IPv4-only network or host.
- Neo4j Aura (optional — an unreachable instance degrades the health check and
  the graph endpoints to `503`, not the rest of the app)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/) for
  the AI engine (optional — without one, `/ai/*` routes return `503` and
  everything else still works)

```bash
# api-gateway
cd api-gateway && npm install
cp .env.example .env     # SUPABASE_*, DATABASE_URL, NEO4J_*, GITHUB_CLIENT_*
node utils/init-db.js    # provisions every table from docs/DB_SCHEMA.md
npm run dev              # http://localhost:5000

# frontend
cd frontend && npm install
cp .env.example .env     # VITE_API_DEV_URL, VITE_SUPABASE_*
npm run dev

# ai-service
cd ai-service && pip install -r requirements.txt
cp .env.example .env     # GEMINI_API_KEY, GEMMA_MODEL_EXTRACT, GEMMA_MODEL_REASON
python main.py           # http://localhost:8000
```

Every variable each service reads is listed in its own `.env.example`. Only
`.env.example` files are tracked. See **[docs/DB_SCHEMA.md](docs/DB_SCHEMA.md)**
for the full schema `init-db.js` provisions, and note that re-running it drops
and recreates every table — fine for first setup, destructive afterward.

## 9. Future Work and Known Gaps

Listed here rather than above, so nothing unfinished reads as shipped. This
project's honest limits as a reachability analysis tool are in
[docs/AI_DESIGN.md](docs/AI_DESIGN.md) §8 — in short: it is not taint
analysis, `not_evidenced` is not a safety guarantee, it is not a replacement
for a tool with a mature advisory pipeline and open PRs, it is not sound on
purely transitive findings, and no accuracy number is claimed because none
has been measured.

**Scope decisions made along the way, not oversights:**
- The `dependencies` table stores at most one resolved version per package
  name per repository (its unique constraint is on
  `(repository_id, package_name, package_manager)`), so when a lockfile
  resolves two different versions of the same name, the hoisted top-level
  version wins. Documented in `phases/Phase_04.md` §6 and
  `docs/DB_SCHEMA.md`.
- Stage 2's evidence search is regex over files that already import the
  package (`phases/Phase_07.md` §4's own recommendation over an AST, for a
  one-day build) — it fully supports npm; the PyPI pass exists but is a
  single regex style, less tested.
- Remediation strategies are `direct-bump` and `override` only; `lift-parent`
  needs a registry-tree lookup (does a newer *parent* version resolve to a
  fixed transitive version?) that isn't built, so the model is never asked to
  assert it without evidence (`AI_DESIGN.md` §4.3).
- Blast-radius count feeds the fix-first ranking as a constant `1` in the
  dashboard summary rather than a live Neo4j query per finding — correct in
  spirit (impact scales with how many repositories share a vulnerable
  package) but not wired to the graph yet; the dedicated
  `GET /graph/blast-radius/:vulnId` endpoint does the real multi-repository
  query and is what the UI should call for that number next.

**Not built — the parts of the original 10-phase plan that didn't make it:**
- **Local Ollama mode** (`phases/Phase_10.md` §1) — running the same Gemma 4
  weights locally for private repositories. Real value, explicitly optional,
  cut for time; the `LLM_PROVIDER`/`OLLAMA_BASE_URL` variables are reserved
  in `ai-service/.env.example` but nothing reads them yet.
- **PR dependency-risk analysis** and the **Agent Skill wrapper**
  (`phases/Phase_10.md` §2, §2.5) — both stretch goals, contingent on the
  engine working first, not attempted.
- **Trend charts** (`phases/Phase_09.md` §7) — would need a scan-history
  table this schema doesn't have; explicitly the first thing to drop per that
  phase's own "if short on time" guidance.
- **Deployment, a demo video, and a Devpost submission** — none of these can
  be completed by an agent without a human's hosting accounts, a recording of
  the running app, and a Devpost login; they remain for the team to do.

**Considered and deliberately cut** (reasoning in `docs/AI_DESIGN.md` §3): an AI
repository-onboarding assistant, a standalone CVE explainer, a separate
"good first issue" finder, an embeddings/vector store, full taint analysis from
an HTTP entry point to the vulnerable sink, a multimodal terminal-screenshot
auditor (the platform already reads the lockfile, which is strictly better data),
and semantic CVE search (the worked example, "prototype pollution", is a CWE
field — a `WHERE` clause beats an embedding index).

## 10. Challenges and Learnings

- **Reconciling two schemas.** `docs/PRD.md`/`docs/TRD.md` describe a
  per-user `client`/`server` project; the actual codebase is an
  `organizations → projects → repositories` multi-tenant app under
  `frontend`/`api-gateway`/`ai-service`. Every later phase had to be built
  against what was actually there, not the original design doc — and
  `docs/DB_SCHEMA.md` had to be reconstructed from scattered `ALTER TABLE`
  statements rather than written from a clean design, since the file the
  rest of the code already assumed existed had never been committed.
- **One version per package, by design.** Supporting every resolved version
  of a transitively-duplicated package would have meant reworking the
  `dependencies` table's primary key and every query against it, late in the
  build, for a case (two different versions of the same package name in one
  repository) that is real but secondary to getting transitive edges
  recorded at all. Documented as a scope decision rather than silently
  dropped.
- **Grounding is the whole product.** The single most load-bearing piece of
  code in this build is not a model call — it's the check in
  `ai-service/api/routes/assess.py` that rejects a verdict citing a file
  outside the evidence it was given. Everything else (two LLM calls, a
  tarball fetch, a graph write) is only trustworthy because that check
  exists and fails closed.
- **Deciding what's AI and saying so.** Fix-first ranking, difficulty rating
  and the repository score are sorts and formulas over stored numbers, not
  model calls — `docs/AI_DESIGN.md` §2–3 is the record of why those stayed
  deterministic while the reachability verdict didn't.

## 11. Credits and License

Licensed under the [Apache License 2.0](./LICENSE). Built with the open-source
libraries listed in §7 and the GitHub REST API. Gemma 4 model weights are
Apache 2.0, © Google DeepMind. See `AGENTS.md` for this repository's hackathon
submission and agent-contribution rules.

## 12. Planning Documents

| Document | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Problem, users, scope tiers, success criteria, risks |
| [docs/TRD.md](docs/TRD.md) | Architecture, data model, external APIs, scoring, security |
| [docs/AI_DESIGN.md](docs/AI_DESIGN.md) | The AI engine: rationale, feature verdicts, model registry, limits |
| [phases/README.md](phases/README.md) | Ten-phase build plan and critical path |
