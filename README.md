# GitHygiene

> Know what's in your code. Know what's broken. Know how to fix it.

GitHygiene is a dependency health and security intelligence platform for GitHub repositories. Connect your repos, run a scan, and get a unified view of every vulnerable, outdated, and deprecated package across your entire project portfolio — with AI-generated explanations and upgrade plans, and a cross-repository graph that shows exactly how far a single advisory reaches.

Built for **Hacktoberfest Hack Day — Coimbatore 2026** · INIT CLUB × iDEA CLUB × MLH

---

## The Problem

Modern repositories are mostly other people's code. A typical project pulls in hundreds of open-source packages — most of them transitively, most of them invisible to the maintainer. When a vulnerability is published, answering *"am I affected, and through which package?"* means jumping between GitHub, a scanner's output, advisory databases, and package registries.

The people hit hardest are the ones with the least tooling: students, solo maintainers, and small open-source teams who look after several repositories with no dedicated security team.

---

## How It Works

```mermaid
flowchart LR
    U([User]) -->|GitHub OAuth| C[React Dashboard]
    C -->|REST + JWT| G[Express API Gateway]

    G -->|Fetch manifests| GH[(GitHub API)]
    G -->|Batch vuln lookup| OSV[(OSV.dev)]
    G -->|Latest versions| REG[(npm / PyPI)]
    G -->|Store findings| PG[(Supabase Postgres)]
    G -->|Dependency graph| N4J[(Neo4j Aura)]
    G -->|AI insights| AI[FastAPI AI Service]

    AI -->|LLM inference| OR[(OpenRouter)]
    AI -->|Vector search| PG
    AI -->|Graph context| N4J
```

**Scan pipeline — what happens when you hit "Scan":**

```mermaid
flowchart TD
    A([POST /repos/:id/scan]) --> B[Queue scan — return 202]
    B --> C[Fetch manifests from GitHub]
    C --> D{Manifest found?}
    D -- No --> FAIL([Mark failed: no manifest])
    D -- Yes --> E[Parse package list\npackage-lock.json · package.json · requirements.txt]
    E --> F[Batch query OSV.dev\nfor all package versions]
    F --> G[Query npm / PyPI\nfor latest versions]
    G --> H[Compute security score]
    H --> I[Save to Postgres\ndependencies + vulnerabilities]
    I --> J[Write dependency graph\nto Neo4j]
    J --> K[Create notifications]
    K --> DONE([Mark done])
```

---

## Architecture

Three services, each with a single job:

| Service | Stack | Responsibility |
|---|---|---|
| `frontend/` | React 19 + Vite + Tailwind CSS | Dashboard UI — talks only to the API gateway |
| `api-gateway/` | Node.js + Express 5 | Auth, GitHub sync, scanning, graph writes |
| `ai-service/` | Python + FastAPI + LangGraph | Embeddings, vector search, LLM report generation |

```mermaid
graph TD
    subgraph Client["🖥️ Frontend"]
        React["⚛️ React 19\n+ Tailwind CSS\n+ Recharts\n+ react-force-graph-2d"]
    end

    subgraph Gateway["🟢 API Gateway"]
        Express["Node.js / Express 5\nAuth · Scan · Graph · Storage"]
    end

    subgraph AIService["🐍 AI Service"]
        FastAPI["FastAPI"]
        LangGraph["LangGraph Agent"]
        Embeddings["HuggingFace Embeddings\nall-MiniLM-L6-v2"]
    end

    subgraph Data["💾 Persistence"]
        PG[("Supabase Postgres\n+ pgvector")]
        N4J[("Neo4j Aura\nDependency Graph")]
        Storage[("Supabase Storage\nManifest files")]
    end

    subgraph External["🌐 External APIs"]
        GH(GitHub REST API)
        OSV(OSV.dev)
        NPM(npm registry)
        PYPI(PyPI JSON API)
        OR(OpenRouter LLM)
    end

    React <-->|REST / JWT| Express
    Express --> GH
    Express --> OSV
    Express --> NPM
    Express --> PYPI
    Express --> PG
    Express --> N4J
    Express --> Storage
    Express --> FastAPI
    FastAPI --> LangGraph
    LangGraph --> Embeddings
    LangGraph <--> PG
    LangGraph <--> N4J
    LangGraph --> OR
```

**The gateway is the only service with credentials to Postgres, Neo4j, and Supabase Storage.** The AI service only needs Neo4j (read-only, for graph context) and its own LLM/vector credentials. Nothing touches a database it doesn't own.

---

## Data Model

### Postgres — what gets stored per scan

```mermaid
erDiagram
    profiles {
        uuid id PK
        text github_login
        text avatar_url
    }
    repositories {
        uuid id PK
        uuid user_id FK
        bigint github_id
        text full_name
        text default_branch
        text language
        timestamptz last_scanned_at
    }
    scans {
        uuid id PK
        uuid repository_id FK
        text status
        int security_score
        text risk_level
        text error
        timestamptz started_at
        timestamptz finished_at
    }
    dependencies {
        uuid id PK
        uuid scan_id FK
        text ecosystem
        text name
        text version
        text latest_version
        bool is_direct
        bool is_deprecated
    }
    vulnerabilities {
        uuid id PK
        uuid scan_id FK
        uuid dependency_id FK
        text osv_id
        text[] aliases
        text severity
        text summary
        text fixed_version
    }
    ai_reports {
        uuid id PK
        uuid repository_id FK
        uuid scan_id FK
        text type
        text content
        text model
    }
    notifications {
        uuid id PK
        uuid user_id FK
        text type
        text title
        bool is_read
    }

    profiles ||--o{ repositories : owns
    repositories ||--o{ scans : has
    scans ||--o{ dependencies : contains
    scans ||--o{ vulnerabilities : contains
    dependencies ||--o{ vulnerabilities : linked_to
    repositories ||--o{ ai_reports : has
    profiles ||--o{ notifications : receives
```

### Neo4j — the dependency graph

```mermaid
graph LR
    R1["🗂️ :Repository\nuser/api"] -->|DEPENDS_ON| P1["📦 :Package\nnpm:lodash@4.17.20"]
    R1 -->|DEPENDS_ON| P2["📦 :Package\nnpm:express@4.18.2"]
    R2["🗂️ :Repository\nuser/web"] -->|DEPENDS_ON| P1
    P1 -->|DEPENDS_ON| P3["📦 :Package\nnpm:minimist@1.2.5"]
    P3 -->|AFFECTED_BY| V1["⚠️ :Vulnerability\nGHSA-xvch-5gv4-984h\nCRITICAL"]
    P1 -->|AFFECTED_BY| V2["⚠️ :Vulnerability\nGHSA-p6mc-m468-83gw\nHIGH"]
```

Package nodes are **shared across repositories** — that sharing is what makes cross-repository blast-radius queries possible. When a new advisory hits `lodash`, both `user/api` and `user/web` are instantly reachable from it.

---

## Features

### Security Scoring

Every scan produces a score (0–100) and a risk level, computed from the findings:

| Finding | Penalty |
|---|---|
| Critical vulnerability | −25 |
| High vulnerability | −15 |
| Medium vulnerability | −7 |
| Low / unknown severity | −2 |
| Deprecated direct dependency | −5 |
| Direct dep a major version behind | −1 each (capped at −10) |

Risk level: **low** ≥ 80 · **medium** 50–79 · **high** 25–49 · **critical** < 25

The formula is shown in the UI so every score can be explained, not just displayed.

### Blast Radius — Cross-Repository Impact

```mermaid
flowchart TD
    ADV["Advisory\nGHSA-xvch-5gv4-984h\nCRITICAL"] --> P3["minimist@1.2.5"]
    P3 --> P1["lodash@4.17.20"]
    P1 --> R1["user/api\n🔴 score: 31"]
    P1 --> R2["user/web\n🔴 score: 44"]
    P1 --> R3["user/cli-tool\n🟡 score: 62"]
```

Pick any advisory and GitHygiene shows every repository in your portfolio that it reaches, the exact dependency chain it travels through, and the depth of each path. This is the answer to *"which of my projects are affected?"* — without opening a single repo.

### AI Insights

```mermaid
sequenceDiagram
    participant U as User
    participant G as API Gateway
    participant PG as Postgres
    participant N4J as Neo4j
    participant AI as AI Service
    participant LLM as OpenRouter LLM

    U->>G: POST /ai/explain { vulnerability_id }
    G->>PG: Fetch scan data, package, advisory
    G->>N4J: Fetch dependency chain
    G->>AI: Send context bundle
    AI->>LLM: Prompt with grounded context
    LLM-->>AI: Plain-language explanation
    AI-->>G: { report, model }
    G->>PG: Cache to ai_reports
    G-->>U: Explanation + upgrade guidance
```

Three AI features, all grounded in the actual scan data — no hallucinated package names or version numbers:

- **Advisory explainer** — what the vulnerability is, how it could affect this project, and what to do.
- **Upgrade planner** — ordered list of upgrades, most urgent first, flagging major-version breaking changes.
- **Repository health summary** — a short paragraph plus three priorities from the scan results.

Results are cached to `ai_reports` so re-requesting the same report doesn't hit the LLM again. Provider and model are recorded with every report.

---

## Tech Stack

<table>
<tr>
<td width="33%" valign="top">

### ⚛️ Frontend
![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-593D88?style=for-the-badge&logo=react&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts-FF6384?style=for-the-badge)

</td>
<td width="33%" valign="top">

### 🟢 API Gateway
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Neo4j](https://img.shields.io/badge/Neo4j-018BFF?style=for-the-badge&logo=neo4j&logoColor=white)
![JWT](https://img.shields.io/badge/JWT/JOSE-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)

</td>
<td width="33%" valign="top">

### 🐍 AI Service
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-FF4F00?style=for-the-badge&logo=langchain&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-000000?style=for-the-badge&logo=openai&logoColor=white)
![Celery](https://img.shields.io/badge/Celery-37814A?style=for-the-badge&logo=celery&logoColor=white)

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🐘 Database
![PostgreSQL](https://img.shields.io/badge/Supabase_Postgres-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![HuggingFace](https://img.shields.io/badge/HuggingFace-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)

</td>
<td width="33%" valign="top">

### 🕸️ Graph
![Neo4j](https://img.shields.io/badge/Neo4j_Aura-018BFF?style=for-the-badge&logo=neo4j&logoColor=white)
![Cypher](https://img.shields.io/badge/Cypher-008CC1?style=for-the-badge&logo=neo4j&logoColor=white)

</td>
<td width="33%" valign="top">

### 🔴 Open Data Sources
![OSV](https://img.shields.io/badge/OSV.dev-4285F4?style=for-the-badge&logo=google&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub_API-181717?style=for-the-badge&logo=github&logoColor=white)
![npm](https://img.shields.io/badge/npm_registry-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![PyPI](https://img.shields.io/badge/PyPI-3775A9?style=for-the-badge&logo=pypi&logoColor=white)

</td>
</tr>
</table>

---

## Running Locally

You need three terminals — the frontend, the gateway, and the AI service all run at once. You'll also need accounts for Supabase, Neo4j Aura, and an LLM provider via OpenRouter.

### 1. Install dependencies

```bash
# API Gateway
cd api-gateway && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# AI Service
cd ai-service
python -m venv venv
# macOS / Linux
source venv/bin/activate
# Windows PowerShell
# .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

### 2. Configure environment variables

Copy `.env.example` → `.env` in each of `api-gateway/`, `ai-service/`, and `frontend/`, and fill in your credentials.

**`api-gateway/.env`**
```env
PORT=4000
NODE_ENV=development
AI_SERVICE_DEV_URL=http://127.0.0.1:8000

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
DATABASE_URL=postgresql://postgres.xxx:PASSWORD@aws-0-us-west-1.pooler.supabase.com:6543/postgres

NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

**`ai-service/.env`**
```env
PORT=8000
ENVIRONMENT=development
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxx

NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password

CELERY_BROKER_URL=rediss://default:PASSWORD@xxx.upstash.io:6379
CELERY_RESULT_BACKEND=rediss://default:PASSWORD@xxx.upstash.io:6379
```

**`frontend/.env`**
```env
VITE_API_DEV_URL=http://localhost:4000
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

> **Never commit real credentials.** `.env` files are gitignored. If a key ever ends up in a `.env.example` by accident, rotate it at the provider — removing it from the file afterward is not enough.

### 3. Initialise the database (first time only)

```bash
cd api-gateway
node utils/init-db.js
```

This creates all tables. **It is destructive — run it only against a fresh database.**

Then run this once in the Supabase SQL Editor to wire up the auth trigger (new sign-ups are automatically synced to the `profiles` table):

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, github_login, avatar_url)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

Optional utility scripts (from `api-gateway/`):

| Script | What it does | Safe on existing data? |
|---|---|---|
| `node utils/run-indexes.js` | Applies performance indexes | ✅ Yes — `IF NOT EXISTS` |
| `node utils/seed-cves.js` | Seeds sample CVE data | ❌ No — destructive; requires `SEED_OPT_IN=true` |

### 4. Start all three services

**Terminal 1 — API Gateway**
```bash
cd api-gateway && npm run dev
# → http://localhost:4000
# Verify: curl http://localhost:4000/health
```

**Terminal 2 — AI Service**
```bash
cd ai-service
source venv/bin/activate  # or .\venv\Scripts\Activate.ps1 on Windows
uvicorn main:app --reload --port 8000
# → http://localhost:8000
# Verify: curl http://localhost:8000/health
```

**Terminal 3 — Frontend**
```bash
cd frontend && npm run dev
# → http://localhost:5173
```

Check `GET /api/health` returns `{ "postgres": "ok", "neo4j": "ok" }` before using the app — if either is failing, fix the credentials in `api-gateway/.env` first.

---

## API Reference

All routes are under `/api`. Every route except `/health` requires `Authorization: Bearer <supabase_jwt>`.

```mermaid
mindmap
  root((API))
    Auth & Profile
      GET /health
      GET /me
    GitHub
      GET /github/repos
    Repositories
      POST /repos
      GET /repos
      DELETE /repos/:id
      POST /repos/:id/scan
    Scans
      GET /scans/:id
      GET /scans/:id/dependencies
      GET /scans/:id/vulnerabilities
    Graph Insights
      GET /graph/blast-radius/:vulnId
      GET /graph/shared
      GET /graph/top-packages
      GET /graph/repo/:id
    AI
      POST /ai/explain
      POST /ai/upgrade-plan
      POST /ai/summary
    Dashboard
      GET /dashboard/summary
    Notifications
      GET /notifications
      PATCH /notifications/:id/read
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Network Error" in the frontend | `VITE_API_DEV_URL` wrong port | Fix it and restart `npm run dev` |
| "Invalid or expired token" | Wrong `SUPABASE_URL` in gateway | Verify the URL; no shared secret needed — verification is via JWKS |
| Profile not syncing on sign-up | Auth trigger not created | Run the SQL block above in Supabase SQL Editor |
| New user can't create resources | Everyone starts as `developer` role | Promote admin manually: `UPDATE profiles SET ...` |
| Manifest ingest 404 | File path doesn't exist on default branch | Paths are case-sensitive; use full path from repo root |
| GitHub org repos missing | Org restricts third-party OAuth | Approve the app under GitHub → Settings → Applications |

---

## Repository Layout

```text
.
├── frontend/          React 19 + Vite + Tailwind CSS dashboard
├── api-gateway/       Node.js / Express 5 REST API and scan pipeline
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── middlewares/
│   ├── utils/         DB init, seed, index scripts
│   └── server.js
├── ai-service/        FastAPI + LangGraph AI microservice
│   ├── api/
│   ├── core/
│   ├── db/
│   ├── llm/
│   ├── models/
│   ├── services/
│   └── main.py
├── docs/
│   ├── PRD.md         Product requirements
│   └── TRD.md         Technical architecture
├── phases/            Phase-by-phase build plan (Phase_01 – Phase_10)
├── AGENTS.md          Hackathon submission rules and agent guide
├── CLAUDE.md          AI coding agent guide for this repo
└── .env.example       Environment variable template
```

---

## Documentation

- [docs/PRD.md](docs/PRD.md) — product requirements, user stories, scope tiers
- [docs/TRD.md](docs/TRD.md) — full technical architecture, data model, API surface, scoring
- [phases/](phases/) — the ten-phase build plan with tasks, code guidance, and done-when checklists
- [CLAUDE.md](CLAUDE.md) — guide for AI coding agents working in this repo

---

## License

[MIT](LICENSE)
