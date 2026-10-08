# GitHygiene

Most dependency scanners tell you which advisories exist somewhere in your
dependency tree. GitHygiene is being built to answer the question that follows:
**does this one actually matter in my code?** It reads the advisory, finds
whether the function it blames is really called in your repository, shows you
the line, and tells you whether to upgrade, replace, mitigate or accept it.

Built for **Hacktoberfest Hack Day — Coimbatore 2026** (INIT CLUB × iDEA CLUB,
in collaboration with MLH).

> **A note on this README.** It separates what is **built** from what is
> **planned**, and never lists a plan as a feature. The AI engine described in §4
> is specified in [docs/AI_DESIGN.md](docs/AI_DESIGN.md) and is **not
> implemented yet** — §9 tracks every gap. Sections marked _(planned)_ must be
> rewritten in the past tense only once the code exists, per `AGENTS.md` §6.

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
3. **Extract dependencies** into the `dependencies` table, resolving exact
   versions from a lockfile where one is reachable (`POST /api/v1/parser/extract`).
4. **Scan** dependencies and raise `security_alerts` (`POST /api/v1/scanner/scan`).
5. **Review and resolve alerts**, scoped to your organization.

Role-based access runs throughout: every query is scoped to the caller's
organization through a shared `getCallerContext` helper, with an `admin` role
that sees across organizations and a `manager` role that can create
organizations and manage membership.

**Planned** — real OSV advisory data (the current scan matches CVE descriptions
by string, see §9), then the analysis engine in §4.

## 4. Innovation and Differentiation _(planned — see §9)_

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

api-gateway/   Express 5 — REST API, owns all database access
                 ├── Supabase Auth JWKS (verifies session tokens)
                 ├── Supabase Storage (manifest file storage)
                 ├── PostgreSQL via `pg`
                 ├── Neo4j driver (connected; health-checked only — see §9)
                 ├── GitHub REST API (repo listing, manifests, lockfiles)
                 └── ai-service (planned: assembles context, posts it on)

ai-service/    FastAPI (Python) — scaffolded, not implemented (see §9)
                 └── planned: Gemini API → Gemma 4 (prompts and model calls only)
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
| Graph DB | Neo4j via `neo4j-driver` — connected, not yet used beyond a health check |
| File storage | Supabase Storage (ingested manifests) |
| API docs | `swagger-jsdoc` + `swagger-ui-express`, at `/api-docs` |
| AI engine | FastAPI service — **scaffolded only**; planned: Gemma 4 via the Gemini API |
| External data | GitHub REST API. Planned: OSV.dev, npm and PyPI registries |

### 5.3 Database Schema

`organizations → projects → repositories → dependencies`, plus `users`,
`dependency_files`, `cves` / `dependency_vulnerabilities`, `security_alerts`,
and `reports` / `notifications` (provisioned, unused).

**There is currently no committed schema file.** `api-gateway/utils/init-db.js`
reads DDL from `docs/DB_SCHEMA.md`, which does not exist, and the rest of the
DDL is scattered across `controllers/*.js` as self-healing `ALTER TABLE`
statements. A clean clone cannot provision its database — see §9.

### 5.4 API Surface

All routes under `/api/v1`, requiring `Authorization: Bearer <supabase_jwt>`
except `/health`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` *(no auth)* | Postgres + Neo4j connectivity |
| POST · GET | `/orgs` | Create *(admin/manager)* · list organizations |
| GET | `/users/me` · `/users` | Current profile · members *(admin/manager)* |
| PUT | `/users/:userId/role` | Change a member's role *(admin/manager)* |
| POST · GET | `/repos/sync` · `/repos` | Sync from GitHub · list |
| GET · POST | `/github/repos` · `/github/token` | Available repos · OAuth exchange |
| POST | `/manifests/ingest` | Fetch a manifest from GitHub and store it |
| POST | `/parser/extract` | Parse a stored manifest into `dependencies` |
| POST | `/scanner/scan` | Run the CVE-matching scan |
| GET · PATCH | `/scanner/alerts` · `/scanner/alerts/:id/resolve` | List · resolve |

Interactive documentation at `/api-docs`.

## 6. Implementation During the Hackathon

_Fill in: what was built during the Hack Day versus brought in beforehand, and
who built which piece. The codebase currently shows an org/project/repository
data model, GitHub repo sync, manifest ingestion to Supabase Storage, npm/pip
dependency extraction with lockfile version resolution, a transactional
CVE-matching scanner with concurrency-safe row locking, role-based access
control, and a multi-page React dashboard._

## 7. Open Source and AI Usage

### 7.1 AI models _(planned — no model call is implemented yet)_

Both models are open-weight, Apache 2.0, and reached through the Gemini API.
Full registry, including why there are two: [docs/AI_DESIGN.md](docs/AI_DESIGN.md) §5.

| | Stage 1 — extraction | Stage 3 — reasoning |
|---|---|---|
| Model | Gemma 4 26B A4B (instruction-tuned) | Gemma 4 31B (instruction-tuned, dense) |
| Provider | Google DeepMind | Google DeepMind |
| Gemini API id | `gemma-4-26b-a4b-it` | `gemma-4-31b-it` |
| Hugging Face | `google/gemma-4-26B-A4B-it` | `google/gemma-4-31B-it` |
| Licence | Apache 2.0 | Apache 2.0 |
| Parameters | 25.2B total, 3.8B active (MoE) | 30.7B dense |
| Context | 256K tokens | 256K tokens |
| Task | Advisory prose → vulnerable symbols | Code evidence → reachability + remediation |
| Input · Output | Advisory text · JSON | Evidence, snippets, dependency facts · JSON |
| Inference | Remote, Gemini API | Remote, Gemini API |
| Local resources | None | None |

The split is cost-driven: Stage 1 is high-volume and easy (the MoE model
activates ~3.8B parameters per token), Stage 3 is low-volume and hard (the dense
31B is the better coder of the two). Both run through one client with the model
id as a parameter. Stage 2 uses no model.

*Figures above are from Google's published model cards and the Gemini API Gemma
documentation, read 2026-10-08 — verify them before final submission. This
project has published no benchmark of its own.*

### 7.2 Libraries

**Backend (`api-gateway`):** Express 5, `@supabase/supabase-js`, `pg`,
`neo4j-driver`, `jose`, `jsonwebtoken`, `axios`, `cors`, `morgan`, `dotenv`,
`swagger-jsdoc`, `swagger-ui-express`, `uuid`, `redis`, `pg-copy-streams`,
`archiver`, `multer` — MIT / Apache-2.0. `redis`, `archiver` and `multer` are
declared but unimported; see §9.

**Frontend:** React 19, Vite, Tailwind CSS 4, React Router, Zustand, Recharts,
`react-force-graph-2d`, Framer Motion, Lenis, `@supabase/supabase-js`, Axios,
Lucide icons — MIT.

**AI (`ai-service`):** FastAPI, Pydantic, LangChain, LangGraph, Celery, Redis and
`pgvector` are declared in `requirements.txt`. **No AI call is implemented.**
The current design needs no vector store, Celery or Redis
([AI_DESIGN.md](docs/AI_DESIGN.md) §5.2) — those lines should be removed when
the service is built, not left to imply capability that does not exist.

**External data:** the GitHub REST API. OSV.dev and the npm/PyPI registries are
planned and not yet called by any code here.

## 8. Setup and Usage

### Prerequisites
- Node.js 18+
- A Supabase project (Auth + Postgres + Storage) with GitHub OAuth configured
- A reachable PostgreSQL database (`api-gateway` connects via `DATABASE_URL`)
- Neo4j (optional — an unreachable instance degrades the health check, not the app)
- Python 3.11+ (only once `ai-service` is implemented)

> **Known blocker:** `docs/DB_SCHEMA.md` is missing, so `npm run init-db` cannot
> provision a fresh database. Until it is written, the schema must be
> reconstructed from the `CREATE TABLE` / `ALTER TABLE` statements in
> `api-gateway/controllers/*.js` and `api-gateway/utils/*.sql`.

```bash
# api-gateway
cd api-gateway && npm install
cp .env.example .env     # SUPABASE_*, DATABASE_URL, NEO4J_*, GITHUB_CLIENT_*
npm run dev              # http://localhost:5000

# frontend
cd frontend && npm install
cp .env.example .env     # VITE_API_DEV_URL, VITE_SUPABASE_*
npm run dev

# ai-service (scaffold only — only /health responds)
cd ai-service && pip install -r requirements.txt
cp .env.example .env
python main.py           # http://localhost:8000
```

Every variable each service reads is listed in its own `.env.example`. Only
`.env.example` files are tracked.

## 9. Future Work and Known Gaps

Listed here rather than above, so nothing unfinished reads as shipped.

**Blocking a clean clone**
- **`docs/DB_SCHEMA.md` is missing** while `init-db.js` depends on it. Highest-value
  fix in the project — `phases/Phase_10.md` §5.

**Data quality — prerequisite for everything in §4**
- **Real vulnerability detection.** The current scanner matches a package name
  against CVE *descriptions* with `ILIKE`, against a small seeded table. Its own
  comments describe it as a stand-in. OSV.dev integration, the registry lookups
  for outdated/deprecated packages, and the scoring formula are all unbuilt —
  `phases/Phase_05.md`.
- **Transitive dependencies are not recorded.** The parser stores only direct
  dependencies and consults the lockfile just to pin their versions, so most real
  findings and every dependency chain are missing — `phases/Phase_04.md` §5.
- `dependencies.latest_version` is set equal to the installed version; no
  registry lookup happens.

**Not built**
- **The AI engine** (§4) — `ai-service` is a FastAPI scaffold whose every route
  and client file is a one-line `# TODO`; `api-gateway/services/ai.service.js` is
  a one-line stub. `ai-service/main.py` still carries boilerplate title text from
  an unrelated template. Specified in `docs/AI_DESIGN.md`, built in
  `phases/Phase_07.md` and `Phase_08.md`.
- **Dependency graph and blast radius** — Neo4j is connected but nothing writes
  to or reads from it — `phases/Phase_06.md`.
- **Fix-first ranking, contribution intelligence, dashboard, notifications** —
  `phases/Phase_09.md`.
- **Local Ollama mode** and **PR dependency-risk analysis** — optional,
  `phases/Phase_10.md`.
- **Deployment, demo video and Devpost submission.**

**Considered and deliberately cut** (reasoning in `docs/AI_DESIGN.md` §3): an AI
repository-onboarding assistant, a standalone CVE explainer, a separate
"good first issue" finder, an embeddings/vector store, and full taint analysis
from an HTTP entry point to the vulnerable sink.

**Cleanup**
- `archiver` and `multer` are declared in `api-gateway/package.json` and never
  imported; `pgvector`, `langchain-postgres`, Celery and Redis in `ai-service`
  are not needed by the current design.

## 10. Challenges and Learnings

_Fill in with what was actually hard. Candidates from the build so far:
reconciling the per-user model in `docs/PRD.md` with the org/project/repository
hierarchy that was actually built; the tradeoffs of a transactional SQL-join
scanner versus an external advisory feed; and deciding which parts of the
product genuinely need a language model and which were arithmetic wearing a
costume (`docs/AI_DESIGN.md` §2–3)._

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
