# GitHygiene — CLAUDE.md

This is the agent guide for **GitHygiene**, a dependency health and vulnerability intelligence platform built for **Hacktoberfest Hack Day — Coimbatore 2026** (INIT CLUB × iDEA CLUB × MLH).

Read this file before touching anything in the repository.

---

## 1. What GitHygiene Does

GitHygiene gives developers — students, solo maintainers, small teams — a single dashboard showing the security and health of every GitHub repository they own.

**Core loop:**
1. Sign in with GitHub.
2. Import repositories.
3. Scan — GitHygiene reads dependency manifests, checks every package against the OSV vulnerability database and package registries, and scores the repository.
4. Explore — see vulnerable packages, outdated/deprecated packages, the dependency graph across repositories, and AI-generated explanations and upgrade plans.

**What makes it different:**

- **Cross-repository blast radius.** "Which of my repos does this one advisory reach, and through what chain of packages?" Most scanners don't answer this.
- **Plain-language explanations.** Each finding can be explained and turned into an ordered upgrade plan by an LLM, grounded in the actual scan data.
- **Built on open data.** OSV.dev, the GitHub API, and public package registries — no paid feeds required.
- **Multi-ecosystem.** npm and PyPI in the first build; the model is designed to add more.

---

## 2. Repository Layout

```text
.
├── client/                  # React app (Vite + Tailwind CSS)
├── server/                  # Express REST API and scan pipeline
│   └── src/
│       ├── config/          # supabase.js, neo4j.js, env.js
│       ├── middleware/      # auth.js, error.js
│       ├── routes/
│       └── services/        # github, parsers, osv, registry, graph, llm, scoring
├── supabase/
│   └── schema.sql           # all DDL; run in Supabase SQL editor
├── docs/
│   ├── PRD.md               # product requirements
│   └── TRD.md               # technical requirements and architecture
├── phases/
│   ├── Phase_01.md  →  Phase_10.md   # ordered build plan
├── .env.example             # all env vars; no real values
├── AGENTS.md                # hackathon submission rules
└── CLAUDE.md                # this file
```

The phases are the build plan. Each phase is self-contained, tiered (must have / should have / stretch), and ends with a "Done when" checklist. Follow them in order unless told otherwise.

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), Tailwind CSS, Recharts, React Router |
| Backend | Node.js, Express |
| Auth | Supabase Auth — GitHub OAuth only |
| Database | Supabase Postgres via `@supabase/supabase-js` (server-side, service role key) |
| Graph DB | Neo4j Aura Free via `neo4j-driver` |
| Vulnerability data | OSV.dev batch API — no API key needed |
| Package metadata | npm registry, PyPI JSON API — no API key needed |
| AI | LLM behind `server/src/services/llm.js` — provider set by `LLM_API_KEY` + `LLM_MODEL` env vars |

### Key constraints
- The service role key and LLM key are **server-only**. They must never reach the browser.
- No ORM. All Postgres access goes through `@supabase/supabase-js` on the server.
- Neo4j is optional at runtime. If it is unreachable, scans complete and the dashboard works; graph features degrade gracefully.
- The platform is **read-only** against GitHub. It never writes to a user's repository.

---

## 4. Architecture

```
User → React client
       ├── Supabase Auth (GitHub OAuth)
       └── Express API
              ├── GitHub REST API      (fetch repos + manifests)
              ├── OSV.dev              (vulnerability lookup)
              ├── npm / PyPI registry  (latest versions)
              ├── Supabase Postgres    (users, scans, findings, reports)
              ├── Neo4j Aura           (dependency graph)
              └── LLM API              (explanations, upgrade plans)
```

**Scan pipeline (in order):**
Fetch manifests → Parse package list → Query OSV → Query registries → Compute score → Save to Postgres → Write graph to Neo4j → Create notifications

---

## 5. Database Schema

### Postgres tables

| Table | Purpose |
|---|---|
| `profiles` | One row per user. Created automatically by a Postgres trigger on `auth.users`. |
| `repositories` | GitHub repos the user has imported. Unique on `(user_id, github_id)`. |
| `scans` | One row per scan attempt. Status: `queued` → `running` → `done` / `failed`. |
| `dependencies` | Every package found in a scan, with `latest_version` and `is_deprecated`. |
| `vulnerabilities` | OSV findings per (scan, dependency). |
| `ai_reports` | LLM output, keyed by `(type, scan_id)`. Reused on repeat requests. |
| `notifications` | Per-user scan events. |

Row Level Security is enabled on every table with no client policies — only the server (service role) can read or write.

### Neo4j nodes and relationships

```
(:Repository {id, fullName, userId})
(:Package    {key, ecosystem, name, version})    key = "<ecosystem>:<name>@<version>"
(:Vulnerability {id, severity, summary})

(:Repository)-[:DEPENDS_ON]->(:Package)
(:Package)-[:DEPENDS_ON]->(:Package)
(:Package)-[:AFFECTED_BY]->(:Vulnerability)
```

Package nodes are shared across repositories — that is what makes cross-repository blast radius queries work.

---

## 6. Scoring Formula

Score starts at 100, floored at 0.

| Finding | Penalty |
|---|---|
| Critical vulnerability | −25 |
| High vulnerability | −15 |
| Medium vulnerability | −7 |
| Low / unknown vulnerability | −2 |
| Deprecated direct dependency | −5 |
| Direct dep a major version behind | −1 each, capped at −10 |

Risk level: `low` ≥ 80 · `medium` 50–79 · `high` 25–49 · `critical` < 25

---

## 7. Environment Variables

All variables are in `.env.example`. Never commit real values.

```env
# server
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEO4J_URI=
NEO4J_USERNAME=
NEO4J_PASSWORD=
LLM_API_KEY=
LLM_MODEL=

# client
VITE_API_URL=http://localhost:4000/api
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`server/src/config/env.js` validates these at startup and fails fast with a clear message for any missing required variable.

---

## 8. API Routes

All routes under `/api`. Every route except `/health` requires `Authorization: Bearer <supabase_jwt>`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Postgres + Neo4j connectivity check |
| GET | `/me` | Current user profile |
| GET | `/github/repos` | User's GitHub repos available to import |
| POST | `/repos` | Import selected repos |
| GET | `/repos` | Imported repos with latest score |
| DELETE | `/repos/:id` | Remove a repo |
| POST | `/repos/:id/scan` | Queue a scan; returns `202 { scan_id }` |
| GET | `/scans/:id` | Scan status, summary, score breakdown |
| GET | `/scans/:id/dependencies` | Package list |
| GET | `/scans/:id/vulnerabilities` | Vulnerability list |
| GET | `/graph/blast-radius/:vulnId` | Repos reached by an advisory |
| GET | `/graph/shared` | Packages shared across repos |
| GET | `/graph/top-packages` | Most-used packages |
| GET | `/graph/repo/:id` | Nodes + edges for the graph view |
| POST | `/ai/explain` | Explain one advisory |
| POST | `/ai/upgrade-plan` | Ordered upgrade plan for a scan |
| POST | `/ai/summary` | Repository health summary |
| GET | `/dashboard/summary` | Dashboard totals |
| GET | `/notifications` | Notification list |
| PATCH | `/notifications/:id/read` | Mark notification read |

---

## 9. Build Phases

| Phase | Title | Tier |
|---|---|---|
| 1 | Project Scaffold & Environment | Must have |
| 2 | Sign In with GitHub | Must have |
| 3 | Import GitHub Repositories | Must have |
| 4 | Manifest Fetching & Dependency Extraction | Must have |
| 5 | Vulnerability & Package Health Scanning | Must have |
| 6 | Dependency Graph | Should have |
| 7 | Graph Insights | Should have |
| 8 | AI Insights | Should have |
| 9 | Dashboard, Analytics & Notifications | Must have |
| 10 | Polish, Deployment & Submission | Must have |

Each phase document in `phases/` describes the tasks, code to write, and a "Done when" checklist. Follow the tiering: build must-haves first so the project is always in a demoable state.

---

## 10. Development Principles

- **Understand before modifying.** Read the relevant phase doc and the files you are changing.
- **Simple over clever.** One Express process, no ORMs, no queuing infrastructure — this is a one-day build.
- **Fail fast and clearly.** Missing env vars → startup error. Malformed manifest → scan marked `failed` with a readable message. Bad token → `401`. Never a blank screen.
- **Graceful degradation.** Neo4j unavailable? Log it, skip the graph step, finish the scan. LLM key not set? Hide AI buttons, respond `503`.
- **User data isolation.** Every DB query filters by `req.user.id`. A user can never read another user's data by guessing an id.
- **No secrets in the repo.** Service role key and LLM key stay on the server. GitHub token lives only in memory for the duration of a request. `.env` is gitignored.
- **Don't fabricate.** No invented metrics, benchmarks, or functionality. Only document what was actually built.

---

## 11. Code Quality

- Follow the conventions already in the file you are editing.
- Keep functions focused. Prefer flat over nested.
- Handle errors at the boundary (middleware, route handler, service entry point) — not buried in utilities.
- No `console.log` left in production paths. Use a logger or `console.error` for real errors.
- Remove dead code and unused imports before committing.

---

## 12. Testing and Verification

Before marking a feature complete:

1. Run any existing tests (`npm test` in `client/` and `server/`).
2. Verify the relevant functionality manually.
3. Check `GET /api/health` is still green.
4. Confirm `.env.example` is up to date with any new variables.
5. Ensure the README is still accurate.

---

## 13. Git Workflow

After completing each phase or task, stage and commit all changes using **conventional commit format**.

### Commit type prefixes

| Prefix | Use for |
|---|---|
| `feat:` | New feature or capability |
| `fix:` | Bug fix |
| `chore:` | Tooling, config, dependency updates |
| `refactor:` | Restructuring without behaviour change |
| `docs:` | Documentation only |
| `test:` | Adding or fixing tests |

Keep commit messages short and precise — describe only what was actually changed.

**Examples:**
```
feat: add OSV batch vulnerability lookup
fix: handle missing lockfile in npm parser
chore: add neo4j-driver dependency
docs: update Phase_04 dependency extraction steps
```

### Branching

Push to the branch the user specifies. Create it if it does not exist:

```bash
git checkout -b feat/phase-4-manifest-parser
git push origin feat/phase-4-manifest-parser
```

Default working branch is `main`. Never open a PR or merge unless explicitly asked.

### Pull Requests

When asked to raise a PR:

- **Title format:** `<type>: <short description> - (Phase N)`
  - Example: `feat: add manifest parser and dependency extraction - (Phase 4)`
- **Body:** Summary bullets + Test plan checklist
- End the PR description with:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

### Attribution

**Never add Claude as a co-author in commit messages.** Do not append any `Co-Authored-By: Claude` line to commits. Commits are authored by the team members only.

---

## 14. Submission Checklist

Before final submission, every item below must be honest-ticked (i.e. actually true):

- [ ] Project builds and runs successfully
- [ ] Core scanning and scoring functionality works end to end
- [ ] README is complete and accurate — describes what was built, not what was planned
- [ ] Problem and reason for selecting it documented
- [ ] Solution and key features documented
- [ ] Innovation and differentiation explained
- [ ] Architecture diagram included
- [ ] Tech stack documented
- [ ] Hackathon-built work documented
- [ ] Team contributions documented
- [ ] AI and open-source components documented (model, provider, what each does)
- [ ] Setup instructions tested on a clean clone
- [ ] Environment variables documented in `.env.example`
- [ ] Challenges and learnings documented
- [ ] Credits and license included
- [ ] Live application link added
- [ ] Demo video added
- [ ] Devpost submission completed and linked
- [ ] No secrets committed
- [ ] No fabricated claims

See also `AGENTS.md` for the full organiser-mandated requirements.
