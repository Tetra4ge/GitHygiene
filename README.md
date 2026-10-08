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

    AI -->|LLM inference| OR[(OpenRouter / Gemini)]
    AI -->|Vector search| PG
    AI -->|Graph context| N4J
```

**Scan pipeline — what happens when you hit "Scan":**

```mermaid
flowchart TD
    A([Trigger scan on repository]) --> B[Queue scan — return 202 immediately]
    B --> C[Fetch manifests from GitHub]
    C --> D{Manifest found?}
    D -- No --> FAIL([Mark failed: no manifest found])
    D -- Yes --> E[Parse package list\npackage-lock.json · package.json · requirements.txt]
    E --> F[Batch query OSV.dev\nfor all package versions]
    F --> G[Query npm / PyPI registries\nfor latest versions + deprecation status]
    G --> H[Compute security score\npenalty formula · risk level]
    H --> I[Save to Postgres\ndependencies + vulnerabilities]
    I --> J[Write dependency graph to Neo4j\nRepository → Package → Vulnerability]
    J --> K[Create in-app notifications]
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
        React["⚛️ React 19 + TypeScript\nTailwind CSS · Recharts\nreact-force-graph-2d · Zustand"]
    end

    subgraph Gateway["🟢 API Gateway"]
        Express["Node.js / Express 5\nAuth · GitHub Sync · Scanner\nGraph Writes · Notifications"]
    end

    subgraph AIService["🐍 AI Service"]
        FastAPI["FastAPI"]
        LangGraph["LangGraph Agent Workflow"]
        Embeddings["sentence-transformers\nall-MiniLM-L6-v2"]
        Gemini["Google Gemini / OpenRouter"]
    end

    subgraph Data["💾 Persistence"]
        PG[("Supabase Postgres\n+ pgvector")]
        N4J[("Neo4j Aura\nDependency Graph")]
        Storage[("Supabase Storage\nManifest files")]
    end

    subgraph OpenData["🌐 Open Data — No API Key Needed"]
        OSV(OSV.dev\nVulnerability DB)
        NPM(npm registry)
        PYPI(PyPI JSON API)
        GH(GitHub REST API)
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
    LangGraph --> Gemini
```

**The gateway is the only service with credentials to Postgres, Neo4j, and Supabase Storage.** The AI service only needs Neo4j (read-only, for graph context) and its own LLM credentials. Nothing touches a database it doesn't own.

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
    P3 --> P1["lodash@4.17.20\n⬆ transitive dep"]
    P1 --> R1["user/api\n🔴 score: 31"]
    P1 --> R2["user/web\n🔴 score: 44"]
    P1 --> R3["user/cli-tool\n🟡 score: 62"]
```

Pick any advisory and GitHygiene shows every repository in your portfolio that it reaches, the exact dependency chain it travels through, and the depth of each path. This is the answer to *"which of my projects are affected?"* — without opening a single repo.

---

## AI Intelligence Layer

The AI service is a standalone FastAPI application powered by **LangGraph** agent workflows. It consumes real scan data from Postgres and graph context from Neo4j — it never guesses or hallucinates package names, versions, or advisory details.

```mermaid
graph TD
    subgraph Input["📥 Context Assembly — API Gateway"]
        S1[Scan findings from Postgres]
        S2[Dependency chain from Neo4j]
        S3[Advisory details from OSV]
    end

    subgraph Agent["🧠 LangGraph Agent — AI Service"]
        N1[Context Builder Node]
        N2[Embedding Node\nall-MiniLM-L6-v2]
        N3[Vector Search Node\npgvector similarity]
        N4[LLM Inference Node\nGemini / OpenRouter]
        N5[Response Formatter Node]

        N1 --> N2
        N2 --> N3
        N3 --> N4
        N4 --> N5
    end

    subgraph Output["📤 Features"]
        F1["🔍 Advisory Explainer\nWhat it is · Impact · Fix"]
        F2["📋 Upgrade Planner\nOrdered steps · Breaking changes flagged"]
        F3["📊 Health Summary\nParagraph + 3 priorities"]
        F4["💬 Repository Chat\nNatural language Q&A over scan data"]
    end

    S1 & S2 & S3 --> N1
    N5 --> F1 & F2 & F3 & F4
```

### AI Features

| Feature | Route | What it does |
|---|---|---|
| **Advisory Explainer** | `POST /ai/explain` | Plain-language breakdown of one vulnerability in this repository's context — what the issue is, how it reaches the project, what to upgrade |
| **Upgrade Planner** | `POST /ai/upgrade-plan` | Ordered upgrade steps for a scan's findings, most urgent first, with major-version breaking changes flagged |
| **Health Summary** | `POST /ai/summary` | A short paragraph plus three actionable priorities derived from the scan score and findings |
| **Repository Chat** | `POST /ai/chat` | Natural language Q&A over a repository's scan results — "which packages should I fix first?" or "is CVE-2024-XXXX exploitable here?" |

### How AI Reports are Generated

```mermaid
sequenceDiagram
    participant U as User
    participant G as API Gateway
    participant PG as Postgres
    participant N4J as Neo4j
    participant AI as AI Service
    participant VEC as pgvector
    participant LLM as Gemini / OpenRouter

    U->>G: POST /ai/explain { vulnerability_id }
    G->>PG: Check for cached ai_report
    alt Report cached
        PG-->>G: Cached report
        G-->>U: Return cached result
    else Not cached
        G->>PG: Fetch scan data, package, advisory
        G->>N4J: Fetch dependency chain to vulnerability
        G->>AI: Send context bundle
        AI->>VEC: Semantic search for similar advisories
        VEC-->>AI: Related context
        AI->>LLM: Grounded prompt with scan data only
        LLM-->>AI: Plain-language explanation
        AI-->>G: Report + model used
        G->>PG: Cache to ai_reports with model name
        G-->>U: Explanation + upgrade guidance
    end
```

All results are cached to `ai_reports` — re-requesting the same report returns the stored result without hitting the LLM again. Every cached report records which model generated it.

### Open Source AI Models & Libraries

| Component | Model / Library | Role |
|---|---|---|
| **LLM Inference** | [Google Gemini](https://deepmind.google/technologies/gemini/) via `langchain-google-genai` | Primary LLM for explanations, upgrade plans, summaries |
| **LLM Fallback** | [OpenRouter](https://openrouter.ai) via `langchain-openai` | Provider-agnostic fallback — routes to any hosted model |
| **Embeddings** | [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (HuggingFace) | Converts advisory text and package descriptions into vector embeddings |
| **Vector Store** | [pgvector](https://github.com/pgvector/pgvector) on Supabase Postgres | Stores and queries embeddings for semantic similarity search |
| **Agent Orchestration** | [LangGraph](https://github.com/langchain-ai/langgraph) | Stateful multi-step agent workflow — context → embed → search → infer → format |
| **LLM Framework** | [LangChain](https://github.com/langchain-ai/langchain) | Prompt templates, output parsers, chain composition |
| **Async Tasks** | [Celery](https://docs.celeryq.dev) + [Upstash Redis](https://upstash.com) | Background task queue for long-running AI jobs (planned) |

All embedding models run open weights from HuggingFace — no proprietary embedding API is required. Inference goes through OpenRouter, which means the LLM provider can be swapped by changing one environment variable.

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
![Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-000000?style=for-the-badge&logo=openai&logoColor=white)

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🐘 Database & Vectors
![PostgreSQL](https://img.shields.io/badge/Supabase_Postgres-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![HuggingFace](https://img.shields.io/badge/all--MiniLM--L6--v2-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)

</td>
<td width="33%" valign="top">

### 🕸️ Graph
![Neo4j](https://img.shields.io/badge/Neo4j_Aura-018BFF?style=for-the-badge&logo=neo4j&logoColor=white)
![Cypher](https://img.shields.io/badge/Cypher-008CC1?style=for-the-badge&logo=neo4j&logoColor=white)

</td>
<td width="33%" valign="top">

### 🔴 Open Data — No API Key
![OSV](https://img.shields.io/badge/OSV.dev-4285F4?style=for-the-badge&logo=google&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub_API-181717?style=for-the-badge&logo=github&logoColor=white)
![npm](https://img.shields.io/badge/npm_registry-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![PyPI](https://img.shields.io/badge/PyPI-3775A9?style=for-the-badge&logo=pypi&logoColor=white)

</td>
</tr>
</table>

---

## Running Locally

You need three terminals — the frontend, the gateway, and the AI service all run at once. You'll also need accounts for Supabase, Neo4j Aura, and an LLM provider via OpenRouter or Google AI Studio.

### 1. Install dependencies

```bash
# API Gateway
cd api-gateway && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# AI Service
cd ai-service
python -m venv venv
source venv/bin/activate        # macOS / Linux
# .\venv\Scripts\Activate.ps1  # Windows PowerShell
pip install -r requirements.txt
cd ..
```

### 2. Configure environment variables

Copy `.env.example` → `.env` in each of `api-gateway/`, `ai-service/`, and `frontend/`, then fill in your credentials.

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

# LLM — use either Gemini or OpenRouter
GOOGLE_API_KEY=your_google_ai_studio_key
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxx

NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password

# Optional: async task queue
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

Then run this once in the Supabase SQL Editor to wire up the auth trigger that syncs new sign-ups into `profiles`:

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

Optional utility scripts (run from `api-gateway/`):

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
source venv/bin/activate   # or .\venv\Scripts\Activate.ps1 on Windows
uvicorn main:app --reload --port 8000
# → http://localhost:8000
# Verify: curl http://localhost:8000/health
```

**Terminal 3 — Frontend**
```bash
cd frontend && npm run dev
# → http://localhost:5173
```

Check `GET /api/health` returns `{ "postgres": "ok", "neo4j": "ok" }` before using the app. If either is failing, fix the corresponding credentials in `api-gateway/.env` first.

---

## API Reference

All routes are under `/api`. Every route except `/health` requires `Authorization: Bearer <supabase_jwt>`.

```mermaid
mindmap
  root((GitHygiene API))
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
      POST /ai/chat
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
| "Invalid or expired token" | Wrong `SUPABASE_URL` in gateway | Verify the URL; verification is via JWKS — no shared secret needed |
| Profile not syncing on sign-up | Auth trigger not created | Run the SQL block above in Supabase SQL Editor |
| New user can't create resources | Everyone starts as `developer` role | Promote admin manually: `UPDATE profiles SET role = 'admin' WHERE ...` |
| Manifest ingest 404 | File path doesn't exist on default branch | Paths are case-sensitive; use full path from repo root |
| GitHub org repos missing | Org restricts third-party OAuth | Approve the app under GitHub → Settings → Applications |
| AI features return 503 | `GOOGLE_API_KEY` / `OPENROUTER_API_KEY` not set | Add the key to `ai-service/.env` and restart the AI service |

---

## Repository Layout

```text
.
├── frontend/               React 19 + Vite + Tailwind CSS dashboard
│   ├── src/
│   │   ├── components/     UI components (landing, dashboard, console)
│   │   ├── layouts/        DashboardLayout, auth guards
│   │   ├── lib/            api.ts, authStore, themeStore, types
│   │   └── pages/          Login, Dashboard, Repositories, Graph, AI
│   └── public/
├── api-gateway/            Node.js / Express 5 REST API and scan pipeline
│   ├── controllers/        github, health, manifest, org, parser, repo, scanner, user
│   ├── routes/
│   ├── services/           scanner.service.js, ai.service.js
│   ├── middlewares/        auth, role, error handling
│   ├── utils/              init-db, seed-cves, run-indexes, test-scanner
│   └── server.js
├── ai-service/             FastAPI + LangGraph AI microservice
│   ├── api/routes/         analysis.py, strategy.py
│   ├── core/               config.py
│   ├── db/                 neo4j_client.py, pg_client.py
│   ├── llm/                gemini_client.py, prompts.py
│   ├── models/             domain.py, schemas.py
│   ├── services/           ast_parser.py
│   └── main.py
├── docs/
│   ├── PRD.md              Product requirements
│   └── TRD.md              Technical architecture
├── AGENTS.md               Hackathon submission rules
├── CLAUDE.md               AI coding agent guide for this repo
└── .env.example            Environment variable template
```

---

## Documentation

- [docs/PRD.md](docs/PRD.md) — product requirements, user stories, scope tiers
- [docs/TRD.md](docs/TRD.md) — full technical architecture, data model, API surface, scoring
- [CLAUDE.md](CLAUDE.md) — guide for AI coding agents working in this repo

---

## License

[MIT](LICENSE)
