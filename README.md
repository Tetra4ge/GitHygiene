# GitHygiene

A dependency-hygiene dashboard for GitHub repositories: import a repo, scan its manifests, and see which packages are flagged, who else on your team depends on them, and what to fix. Built for **Hacktoberfest Hack Day — Coimbatore 2026** (INIT CLUB × iDEA CLUB, in collaboration with MLH).

> **A note on this README:** it describes the project as it actually exists in this repository today, not the original plan. Where the build diverged from the plan in `docs/PRD.md` / `docs/TRD.md` / `phases/*.md`, this file says so, and the gap is tracked in [§9 Future Work](#9-future-work-and-known-gaps) instead of being listed as a shipped feature. See `phases/Phase_05.md` §7, `Phase_06.md` §7, `Phase_07.md` §5, and `Phase_08.md` §7 for the detailed, phase-by-phase version of the same gap analysis.

---

## 1. Team

| Name | Contribution |
|---|---|
| Prajwal Priyadarshan | _fill in contribution_ |
| _add teammates here_ | |

*(Replace the placeholders above with the actual team roster before submission — AGENTS.md requires this section to be accurate, not fabricated.)*

## 2. Problem Statement

Modern repositories pull in hundreds of open-source packages, most of them transitively, and a maintainer rarely sees past the direct ones. When a vulnerability surfaces, answering "am I affected, and through which package?" means jumping between GitHub, a scanner, advisory databases, and registries — and doing it once per repository. Students, solo maintainers, and small teams who look after several repositories feel this hardest, because they have no dedicated security tooling.

GitHygiene's target users are exactly that group: a student or solo developer who wants a quick health check, an open-source maintainer who wants to know which advisories actually reach their repos, and a small team lead who wants one view across every repository their team owns instead of one report per repo.

## 3. Solution

A signed-in user (via GitHub OAuth, brokered by Supabase Auth) belongs to an **organization**, which owns **projects**, which own **repositories**. The flow:

1. **Sync repositories** from GitHub into a project (`POST /api/v1/repos/sync`).
2. **Ingest a manifest** (`package.json` or `requirements.txt`) straight from the GitHub Contents API into Supabase Storage (`POST /api/v1/manifests/ingest`).
3. **Extract dependencies** from the stored manifest — and its lockfile, when reachable — into the `dependencies` table, resolving exact versions where a lockfile is available (`POST /api/v1/parser/extract`).
4. **Scan** the repository's dependencies and raise `security_alerts` for matches (`POST /api/v1/scanner/scan`).
5. **Review alerts** scoped to your organization, and resolve them once handled (`GET /api/v1/scanner/alerts`, `PATCH /api/v1/scanner/alerts/:id/resolve`).

Role-based access runs throughout: every query is scoped to the caller's organization via a shared `getCallerContext` helper, with an `admin` role that sees across every organization on the platform, and a `manager` role that can create organizations and manage org membership.

## 4. Innovation and Differentiation

- **Org-scoped, not just per-user.** Repositories belong to a project, which belongs to an organization — so a security lead sees every repository their team owns in one place, not one dashboard per developer.
- **Relational by design.** The scan pipeline is a set-based SQL join (not a loop over packages in application code), with row-level locking so two concurrent scans of the same repository can't race and double-report an alert.
- **Multi-ecosystem from the start.** The dependency model treats npm and pip packages uniformly, with room to add more ecosystems without restructuring the schema.

The PRD's headline cross-repository differentiator — "which of my repos does this advisory reach, and through what chain of packages" — depends on the dependency graph described in §9; it is not live yet.

## 5. Technical Implementation

### 5.1 Architecture

```text
frontend/      React 19 + Vite + Tailwind CSS — dashboard UI
                 ├── Supabase Auth (GitHub OAuth)
                 └── REST calls to api-gateway

api-gateway/   Express 5 — REST API, owns all database access
                 ├── Supabase Auth JWKS (verifies session tokens)
                 ├── Supabase Storage (manifest file storage)
                 ├── PostgreSQL via `pg` (organizations, projects, repositories,
                 │     dependencies, cves, security_alerts, reports, ...)
                 ├── Neo4j driver (connected; health-checked only — see §9)
                 └── GitHub REST API (repo listing, manifest/lockfile fetch)

ai-service/    FastAPI (Python) — scaffolded, not yet implemented (see §9)
```

The client never talks to Postgres, Neo4j, or GitHub directly — every external call is brokered by `api-gateway`, so no service key or GitHub token reaches the browser beyond the short-lived one the user's own OAuth session already has.

### 5.2 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, React Router, Zustand, Recharts, `react-force-graph-2d`, Framer Motion, Lenis |
| Backend | Node.js, Express 5 |
| Auth | Supabase Auth (GitHub OAuth), verified server-side against Supabase's JWKS (`jose`) |
| Database | PostgreSQL, accessed directly via `pg` (connection pool), not an ORM |
| Graph DB | Neo4j, via `neo4j-driver` — connected, not yet used beyond a health check |
| File storage | Supabase Storage (ingested manifests) |
| API docs | `swagger-jsdoc` + `swagger-ui-express`, served at `/api-docs` |
| AI engine | FastAPI service (`ai-service/`) — scaffolded with FastAPI, LangChain/LangGraph, OpenRouter and Gemini clients in `requirements.txt`; no route is implemented yet |
| External APIs | GitHub REST API (repositories, manifests, lockfiles) |

### 5.3 Database Schema (as implemented)

`organizations → projects → repositories → dependencies`, plus `users` (role + organization membership), `dependency_files` (ingested manifest pointers), `cves` / `dependency_vulnerabilities` (the seeded vulnerability-matching demo), `security_alerts`, and `reports` / `notifications` (provisioned, not yet written to by any route).

There is currently no committed schema file: `api-gateway/utils/init-db.js` expects to read DDL from `docs/DB_SCHEMA.md`, which does not exist in this repository. Anyone setting up a fresh database needs to reconstruct the schema from the `CREATE TABLE`/`ALTER TABLE` statements scattered across `api-gateway/controllers/*.js` and `api-gateway/utils/*.sql`, or write `docs/DB_SCHEMA.md` before running `init-db.js`.

### 5.4 API Surface

All routes are under `/api/v1` and require `Authorization: Bearer <supabase_jwt>` unless noted.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` *(no auth)* | Postgres + Neo4j connectivity check |
| POST | `/orgs` | Create an organization *(admin/manager)* |
| GET | `/orgs` | List organizations (own org, or all for admins) |
| GET | `/users/me` | Current user's profile |
| GET | `/users` | List organization members *(admin/manager)* |
| POST | `/repos/sync` | Sync a list of GitHub repos into a project |
| GET | `/repos` | List repositories visible to the caller |
| GET | `/github/repos` | Repositories available on GitHub for the caller |
| POST | `/github/token` | Exchange a GitHub OAuth code |
| POST | `/manifests/ingest` | Fetch a manifest from GitHub and store it |
| POST | `/parser/extract` | Parse a stored manifest into `dependencies` rows |
| POST | `/scanner/scan` | Run the CVE-matching scan on a repository |
| GET | `/scanner/alerts` | List security alerts |
| PATCH | `/scanner/alerts/:id/resolve` | Mark an alert resolved |

Full interactive documentation is served at `/api-docs` when the server is running.

## 6. Implementation During the Hackathon

_Fill in: what was built during the Hack Day itself versus brought in beforehand, and who built which piece. The codebase currently shows a working org/project/repository data model, GitHub repo sync, manifest ingestion to Supabase Storage, npm/pip dependency extraction (with lockfile resolution where reachable), a transactional CVE-matching scanner with concurrency-safe row locking, role-based access control, and a multi-page React dashboard (overview, repositories, manifests, scanner, security alerts, organizations, team, profile)._

## 7. Open Source and AI Usage

**Backend (`api-gateway`):** Express 5, `@supabase/supabase-js`, `pg`, `neo4j-driver`, `jose` (JWT/JWKS verification), `jsonwebtoken`, `axios`, `cors`, `morgan`, `dotenv`, `swagger-jsdoc`, `swagger-ui-express`, `uuid`, `redis`, `pg-copy-streams`, `archiver`, `multer` — all MIT/Apache-2.0-licensed. `redis`, `archiver`, and `multer` are listed as dependencies but are not currently imported by any route; see §9.

**Frontend:** React 19, Vite, Tailwind CSS 4, React Router, Zustand, Recharts, `react-force-graph-2d`, Framer Motion, Lenis, `@supabase/supabase-js`, Axios, Lucide icons — all MIT-licensed.

**AI (`ai-service`):** FastAPI, Pydantic, LangChain, LangGraph, `langchain-google-genai`, Celery, Redis, `pgvector` are declared in `requirements.txt` for a planned OpenRouter-primary/Gemini-fallback AI engine (vulnerability explanations, upgrade plans, repository summaries). **No AI call is implemented or wired up yet** — see §9. When it is, this section must name the actual model and provider used, per `AGENTS.md` §5.

**External data sources:** the GitHub REST API (repository listing, manifest and lockfile contents). OSV.dev and the npm/PyPI registries are planned data sources (see `docs/TRD.md` §6) that are not yet called by any code in this repository.

## 8. Setup and Usage

### Prerequisites
- Node.js (v18+ recommended)
- A Supabase project (Auth + Postgres + Storage) with a GitHub OAuth provider configured
- A reachable PostgreSQL database (Supabase's, or your own — `api-gateway` connects via `DATABASE_URL`, not through `@supabase/supabase-js`)
- A Neo4j instance (optional — the API degrades to a failed health check, not a crash, if unreachable)
- Python 3.11+ (only needed once `ai-service` is implemented and run)

### API Gateway
```bash
cd api-gateway
npm install
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, NEO4J_*, GITHUB_CLIENT_ID/SECRET
npm run dev             # nodemon, http://localhost:5000 by default (see .env PORT)
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env   # fill in VITE_API_DEV_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev             # Vite dev server
```

### AI Service (scaffold only — not yet functional)
```bash
cd ai-service
pip install -r requirements.txt
cp .env.example .env   # fill in OPENROUTER_API_KEY or GEMINI_API_KEY
python main.py          # http://localhost:8000 — only /health responds today
```

Every environment variable each service reads is listed in that service's `.env.example`. Real values must never be committed; only `.env.example` files are tracked.

## 9. Future Work and Known Gaps

Listed here instead of in the feature list above, per `phases/Phase_10.md`'s own instruction not to present unfinished work as shipped:

- **OSV.dev vulnerability detection and the scoring formula** (`docs/TRD.md` §6, §8) — the current scanner matches against a small seeded `cves` table with an `ILIKE` string search, not real advisory data. Details and a suggested approach that doesn't disturb the existing scanner: `phases/Phase_05.md` §7.
- **Dependency graph and cross-repository insights** (blast radius, shared dependencies, most-used packages) — Neo4j is connected but unused beyond a health-check ping; nothing writes to or reads from the graph yet. Details: `phases/Phase_06.md` §7, `phases/Phase_07.md` §5.
- **AI insights** (advisory explainer, upgrade planner, repository summary) — `ai-service` is a scaffolded FastAPI app with every route and client file still a one-line `# TODO`. Details and the intended gateway-assembles-context / service-calls-LLM split: `phases/Phase_08.md` §7. A further batch of proposed AI and contributor-tooling features (attack-path visualization, PR risk analysis, a local Ollama mode, a contribution-impact score, and more) is scoped in `phases/Phase_08.md` §8, none of it built yet.
- **Outdated/deprecated package detection** — `dependencies.latest_version` is currently just a copy of the installed version; no npm/PyPI registry lookup happens.
- **`docs/DB_SCHEMA.md` is missing** despite `api-gateway/utils/init-db.js` depending on it to provision a database from scratch.
- **Unused dependencies**: `archiver` and `multer` appear in `api-gateway/package.json` but are not imported anywhere.
- **Notifications** — a `notifications` table is provisioned but no route reads or writes it.
- **Deployment, demo video, and Devpost submission** — not yet done; see `phases/Phase_10.md`.

## 10. Challenges and Learnings

_Fill in with what was actually hard and what the team actually learned — for example, reconciling the original per-user client/server plan in `docs/PRD.md`/`docs/TRD.md` with the org/project/repository model that was actually built, or the tradeoffs of a transactional SQL-join scanner versus an external vulnerability feed._

## 11. Credits and License

Licensed under the [Apache License 2.0](./LICENSE). Built with the open-source libraries listed in §7, and the GitHub REST API. See `AGENTS.md` for this repository's hackathon submission and agent-contribution rules.
