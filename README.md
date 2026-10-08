<div align="center">

<img width="200" alt="GitHygiene" src="https://github.com/user-attachments/assets/dbed6bb9-f984-45c3-bc34-fb782f04b94f" />

# GitHygiene

</div>

</div>
> Know what's in your code. Know what's broken. Know how to fix it.

GitHygiene is a dependency health and security intelligence platform for GitHub repositories. It scans your repos, identifies every vulnerable and outdated package, assesses whether vulnerable code paths are actually reachable in your project, and generates AI-powered remediation plans — grounded entirely in your real scan data.

Built for **Hacktoberfest Hack Day — Coimbatore 2026** · INIT CLUB × iDEA CLUB × MLH

---

## Team

**Team Name:** TetraFourge

| Member | Contribution |
| ------ | ------------ |
| G Prajwal Priyadarshan | API Gateway, GitHub integration, scan pipeline |
| Kabilan K | AI service, Gemma 4 integration, reachability engine |
| Rahul L S | React dashboard, graph visualisation, UI/UX |
| Kishore B | Neo4j graph model, dependency extraction, DevOps |

---

## Problem Statement

### The Problem

Modern repositories are mostly other people's code. A typical project pulls in hundreds of open-source packages — most of them transitively, most of them invisible to the maintainer. When a vulnerability is published, answering *"am I affected, and through which package?"* means jumping between GitHub, a scanner's output, advisory databases, and package registries.

Existing tools make this worse by treating all findings equally: a CRITICAL advisory for a function your code never calls is ranked the same as one for a function called on every request. Developers end up with a wall of alerts and no way to know where to start.

The people hit hardest are the ones with the least tooling — students, solo maintainers, and small open-source teams who look after several repositories with no dedicated security team.

### Why We Chose This Problem

- Hacktoberfest is about the health of open source, and dependency hygiene is the least glamorous, most neglected part of it.
- Vulnerability scanners report findings as lists of advisory IDs. They rarely answer the cross-repository question ("which of my projects does this one advisory reach?") or explain what a finding means for someone who isn't a security specialist.
- All the data needed is already open: GitHub's API, the OSV vulnerability database, and the public package registries — no proprietary feeds required.
- Gemma 4's structured output capability makes it possible to build an AI reachability engine whose verdicts are grounded, auditable, and never hallucinated.

---

## Solution

GitHygiene connects to your GitHub account, imports your repositories, and runs a three-stage pipeline:

1. **Scan** — reads dependency manifests and lockfiles, checks every package version against OSV.dev, and queries npm/PyPI registries for the latest versions.
2. **Assess** — a Gemma 4-powered AI engine extracts the vulnerable surface from each advisory (the specific functions, subpaths, and trigger conditions named in the advisory text), then judges whether your repository's code actually calls those symbols.
3. **Remediate** — produces an ordered upgrade plan, a plain-language explanation for each finding, and a draft GitHub issue ready to assign to a contributor — all grounded in the evidence the static analysis found.

### Key Features

- **Security scoring** — every repository gets a 0–100 score with a documented penalty formula, so each score can be explained, not just displayed.
- **Reachability triage** — findings are classified as `reachable`, `likely_reachable`, `not_evidenced`, or `unused`, so you focus on what matters.
- **Cross-repository blast radius** — pick any advisory and see every repository it reaches and the exact dependency chain it travels through.
- **AI upgrade planner** — ordered remediation steps for a scan's findings, major-version breaking changes flagged, with a "direct-bump" or "override" strategy depending on whether the vulnerable package is a direct or transitive dependency.
- **Draft GitHub issues** — the AI engine writes a contributor-ready GitHub issue for each triaged finding, with file citations from the actual static analysis evidence.
- **Multi-ecosystem** — npm (`package-lock.json`, `package.json`) and PyPI (`requirements.txt`) in the first build; the model is designed to add more.
- **Open data only** — OSV.dev, the GitHub API, and public registries. No proprietary vulnerability feeds, no paid API required to run the core scanner.

---

## Innovation and Differentiation

**Most scanners stop at "you have this CVE".** GitHygiene goes further on three axes:

1. **Reachability, not just presence.** GitHygiene uses Gemma 4 to extract the vulnerable surface (the exact function names, subpaths, and trigger conditions) from the advisory text, then runs static analysis over the repository's source to check whether those symbols are actually called. A finding that can't reach your code is classified differently from one that runs on every request.

2. **Cross-repository impact.** The Neo4j dependency graph shares `Package` nodes across all of a user's repositories. One advisory attached to one package node is immediately connected to every repository that depends on it, at any depth. The blast-radius query answers "which of my repos are affected" in a single Cypher traversal.

3. **Structured AI output, not prose.** The AI engine uses Gemma 4's structured output (response schema) mode — every verdict validates against a Pydantic schema before it reaches the user. The engine fails closed on a schema mismatch rather than returning half-parsed prose. All file and line citations in a verdict must come from the static analysis evidence; the model is instructed to return an empty evidence list rather than invent a path.

---

## Technical Implementation

![Architecture Diagram](frontend/public/Architecture_Diagram.png)

### Architecture

```mermaid
graph TD
    subgraph Client["🖥️ Frontend"]
        React["⚛️ React 19 + TypeScript\nTailwind CSS · Recharts\nreact-force-graph-2d · Zustand"]
    end

    subgraph Gateway["🟢 API Gateway"]
        Express["Node.js / Express 5\nAuth · GitHub Sync · Scanner\nStatic Analysis · Graph Writes"]
    end

    subgraph AIService["🐍 AI Service — Gemma 4 Engine"]
        S1["Stage 1: Extract Surface\nPOST /v1/extract-surface"]
        S3["Stage 3: Assess Reachability\nPOST /v1/assess"]
        DI["Draft Issue\nPOST /v1/draft-issue"]
        GC["gemini_client.py\nStructured Output Mode"]
        S1 & S3 & DI --> GC
    end

    subgraph Data["💾 Persistence"]
        PG[("Supabase Postgres")]
        N4J[("Neo4j Aura\nDependency Graph")]
        Storage[("Supabase Storage")]
    end

    subgraph OpenData["🌐 Open Data — No API Key Needed"]
        OSV(OSV.dev)
        NPM(npm registry)
        PYPI(PyPI JSON API)
        GH(GitHub REST API)
    end

    React <-->|REST / JWT| Express
    Express --> GH & OSV & NPM & PYPI
    Express --> PG & N4J & Storage
    Express -->|Advisory + Evidence| S1
    Express -->|Surface + Evidence| S3
    Express -->|Triaged Finding| DI
    GC -->|Gemma 4 via Gemini API| Gemma["🤖 Gemma 4\ngemma-4-26b-a4b-it\ngemma-4-31b-it"]
```

### How It Works — The Three-Stage AI Pipeline

```mermaid
sequenceDiagram
    participant GW as API Gateway
    participant S1 as Stage 1: Extract Surface
    participant GW2 as API Gateway (static analysis)
    participant S3 as Stage 3: Assess
    participant DI as Draft Issue

    GW->>S1: POST /v1/extract-surface\n{ osv_id, summary, details, ecosystem, package }
    S1->>S1: Gemma 4 extracts vulnerable_symbols,\nsubpaths, trigger_conditions, attack_vector
    S1-->>GW: VulnerableSurface { symbols, confidence }

    GW2->>GW2: Static search over repo source\nfor import sites + call sites of named symbols
    Note over GW2: Evidence assembled: package_imported,\nimport_sites, call_sites, files_searched

    GW->>S3: POST /v1/assess\n{ surface, evidence, dependency, repository }
    S3->>S3: Gemma 4 judges reachability\nand recommends remediation
    S3->>S3: Grounding check: every cited file\nmust be in the Stage 2 evidence
    S3-->>GW: AssessResponse { reachability, recommendation,\nreasoning, remediation_mechanics }

    GW->>DI: POST /v1/draft-issue\n{ ranked finding + verdict }
    DI->>DI: Gemma 4 writes contributor-ready\nGitHub issue with file citations
    DI-->>GW: IssueDraft { title, scope, acceptance_criteria }
```

### Scan Pipeline

```mermaid
flowchart TD
    A([Trigger scan]) --> B[Return 202 immediately]
    B --> C[Fetch manifests from GitHub\npackage-lock.json · package.json · requirements.txt]
    C --> D{Manifest found?}
    D -- No --> FAIL([Mark failed])
    D -- Yes --> E[Parse full package tree\nwith direct / transitive flags]
    E --> F[Batch query OSV.dev\nfor all package + version pairs]
    F --> G[Query npm / PyPI\nlatest version + deprecation status]
    G --> H[Compute security score\npenalty formula · risk level]
    H --> I[Save dependencies + vulnerabilities\nto Postgres]
    I --> J[Write Repository → Package → Vulnerability\ngraph to Neo4j]
    J --> K[Create in-app notifications]
    K --> DONE([Mark done])
```

### Data Model

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

### Neo4j — Cross-Repository Dependency Graph

```mermaid
graph LR
    R1["🗂️ :Repository\nuser/api"] -->|DEPENDS_ON| P1["📦 :Package\nnpm:lodash@4.17.20"]
    R2["🗂️ :Repository\nuser/web"] -->|DEPENDS_ON| P1
    P1 -->|DEPENDS_ON| P3["📦 :Package\nnpm:minimist@1.2.5"]
    P3 -->|AFFECTED_BY| V1["⚠️ :Vulnerability\nGHSA-xvch-5gv4-984h · CRITICAL"]
    P1 -->|AFFECTED_BY| V2["⚠️ :Vulnerability\nGHSA-p6mc-m468-83gw · HIGH"]
```

Package nodes are **shared across all repositories** — one advisory attached to one package is instantly reachable from every repository that depends on it, at any depth.

### Technology Stack

| Category | Technologies |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, Recharts, react-force-graph-2d, Framer Motion |
| Backend | Node.js, Express 5, JOSE / jsonwebtoken |
| Database | Supabase Postgres (via `@supabase/supabase-js`), Supabase Storage, Supabase Auth |
| Graph | Neo4j Aura Free, `neo4j-driver`, Cypher |
| AI / ML | Gemma 4 (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) via Gemini API, FastAPI, Pydantic structured output |
| Infrastructure | Vercel (frontend), Supabase (auth + database + storage), Neo4j Aura |
| APIs / Services | GitHub REST API, OSV.dev batch API, npm registry, PyPI JSON API |

### Technical Decisions

**Gemma 4 with structured output, not prose.** The AI engine uses the Gemini API's `responseMimeType: "application/json"` + `responseSchema` mode. Every verdict validates against a Pydantic schema before it leaves the AI service. The engine retries once on a schema mismatch, then fails closed — the user sees "AI analysis unavailable" rather than a half-parsed or unverified response.

**OSV.dev for vulnerability data.** OSV is open, needs no API key, matches by exact package and version, and aggregates GitHub Security Advisories and ecosystem databases. It removes the need to load and maintain a CVE dataset.

**Neo4j for blast radius, Postgres for everything else.** Scan results live in Postgres. The graph holds only packages, their edges, and advisories, and answers the multi-hop questions (blast radius, shared dependencies) that recursive SQL can't do efficiently. If Neo4j is unavailable, scanning and the dashboard still work.

**AI service owns no database credentials.** The gateway assembles all the context (advisory text, static analysis evidence, dependency facts) and sends it to the AI service in the request body. The AI service only needs a Gemini API key. This means the AI service can be replaced or mocked without touching the database layer.

**Grounding check on every verdict.** Stage 3 validates that every file cited in the AI's evidence list is a file Stage 2 actually returned. A verdict citing a file not in the evidence fails with a 502 rather than being displayed — a wrong citation is more harmful than no citation.

---

## Implementation During the Hackathon

Everything in this repository was built during Hacktoberfest Hack Day — Coimbatore 2026:

- GitHub OAuth sign-in and repository import
- Dependency manifest parsing (`package-lock.json`, `package.json`, `requirements.txt`) with direct/transitive flags
- OSV.dev batch vulnerability lookup and npm/PyPI registry checks for outdated and deprecated packages
- Security scoring formula with per-finding penalty breakdown
- Neo4j dependency graph with cross-repository blast-radius queries
- Three-stage AI engine (surface extraction → static analysis → reachability verdict → issue draft) powered by Gemma 4
- React dashboard with graph visualisation, vulnerability tables, score badges, and in-app notifications
- Express API gateway connecting all services with JWT auth, row-level security, and graceful degradation when AI or Neo4j is unavailable

### Team Contributions

- **G Prajwal Priyadarshan:** API gateway architecture, GitHub integration, scanner pipeline, Neo4j graph writes
- **Kabilan K:** AI service, Gemma 4 integration, Stage 1/3 prompts, structured output and grounding logic
- **Rahul L S:** React dashboard, dependency graph visualisation, landing page, UI components
- **Kishore B:** Dependency extraction and parsing, Neo4j schema and Cypher queries, deployment

---

## Working Application

**Live Application:** [Live URL]

Sign in with GitHub, import any repository, and run a scan. The scanner works on any public repository — try one with an older lockfile to see vulnerability findings. The AI reachability engine requires `GEMINI_API_KEY` to be configured on the deployed instance.

---

## Demo Video

**Demo Video:** [Video URL]

The demo covers: sign in → import → scan → vulnerability findings with score → blast radius across repositories → AI reachability verdict → draft GitHub issue.

---

## Open Source and AI Usage

### AI / Models

- **[Gemma 4](https://ai.google.dev/gemma/docs) (`gemma-4-26b-a4b-it`)** — Stage 1: extracts vulnerable symbols, subpaths, and trigger conditions from OSV advisory text using structured output (JSON schema-constrained generation). Licence: [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
- **[Gemma 4](https://ai.google.dev/gemma/docs) (`gemma-4-31b-it`)** — Stage 3: judges whether the repository's code actually reaches the vulnerable surface, recommends remediation, and identifies files to change. Also used for drafting contributor-ready GitHub issues. Licence: [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
- **[Gemini API](https://ai.google.dev/gemini-api/docs)** — the inference provider for both Gemma 4 models; structured output mode (`responseMimeType: application/json`) ensures every response validates against a Pydantic schema.

### Open Source Components

- **[OSV.dev](https://osv.dev)** — open vulnerability database; batch API used to look up advisories for every package version in a scan. No API key required.
- **[FastAPI](https://fastapi.tiangolo.com)** — Python web framework for the AI microservice.
- **[Pydantic](https://docs.pydantic.dev)** — request/response validation and the structured output schemas that constrain Gemma 4's responses.
- **[LangGraph](https://github.com/langchain-ai/langgraph)** / **[LangChain](https://github.com/langchain-ai/langchain)** — agent orchestration framework (planned for multi-step workflows).
- **[React 19](https://react.dev)** — frontend framework.
- **[Tailwind CSS 4](https://tailwindcss.com)** — utility-first CSS.
- **[Recharts](https://recharts.org)** — dashboard charts.
- **[react-force-graph-2d](https://github.com/vasturiano/react-force-graph)** — dependency graph visualisation.
- **[Zustand](https://zustand.docs.pmnd.rs)** — frontend state management.
- **[Framer Motion](https://www.framer.com/motion/)** — UI animations.
- **[Express 5](https://expressjs.com)** — Node.js API gateway.
- **[neo4j-driver](https://github.com/neo4j/neo4j-javascript-driver)** — Neo4j graph database client.
- **[@supabase/supabase-js](https://github.com/supabase/supabase-js)** — Supabase client for Postgres, auth, and storage.
- **[GitHub REST API](https://docs.github.com/en/rest)** — repository listing and manifest fetching.
- **npm registry / PyPI JSON API** — latest version and deprecation status lookups.

---

## Setup and Usage

### Prerequisites

- Node.js 20+
- Python 3.11+
- A [Supabase](https://supabase.com) project
- A [Neo4j Aura](https://neo4j.com/cloud/platform/aura-graph-database/) Free instance
- A [Google AI Studio](https://aistudio.google.com) API key (for Gemma 4 via Gemini API)
- A GitHub OAuth App (for repository import)

### Installation

```bash
git clone https://github.com/Tetra4ge/GitHygiene.git
cd GitHygiene

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

### Environment Variables

Copy `.env.example` → `.env` in each service directory.

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
GEMINI_API_KEY=your_google_ai_studio_key
GEMMA_MODEL_EXTRACT=gemma-4-26b-a4b-it
GEMMA_MODEL_REASON=gemma-4-31b-it
```

**`frontend/.env`**
```env
VITE_API_DEV_URL=http://localhost:4000
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

### Initialise the Database

```bash
cd api-gateway
node utils/init-db.js
```

Then run this once in the Supabase SQL Editor:

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

### Running the Project

**Terminal 1 — API Gateway**
```bash
cd api-gateway && npm run dev
# → http://localhost:4000
```

**Terminal 2 — AI Service**
```bash
cd ai-service && source venv/bin/activate
uvicorn main:app --reload --port 8000
# → http://localhost:8000
```

**Terminal 3 — Frontend**
```bash
cd frontend && npm run dev
# → http://localhost:5173
```

Verify `GET http://localhost:4000/health` returns `{ "postgres": "ok", "neo4j": "ok" }` before using the app.

### Usage

1. Sign in with GitHub.
2. Go to **Repositories** → **Import** and select repos to track.
3. Click **Scan** on any repository.
4. Review the **Vulnerabilities** tab — severity, fixed version, blast radius.
5. Click **Assess** on any finding to run the AI reachability engine.
6. Click **Draft Issue** to generate a contributor-ready GitHub issue.

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
![Framer Motion](https://img.shields.io/badge/Framer_Motion-0055FF?style=for-the-badge&logo=framer&logoColor=white)

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

### 🤖 AI Service
![Gemma](https://img.shields.io/badge/Gemma_4-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Gemini API](https://img.shields.io/badge/Gemini_API-8E75B2?style=for-the-badge&logo=google&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Pydantic](https://img.shields.io/badge/Pydantic-E92063?style=for-the-badge&logo=pydantic&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-FF4F00?style=for-the-badge&logo=langchain&logoColor=white)

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🐘 Database
![PostgreSQL](https://img.shields.io/badge/Supabase_Postgres-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Supabase Auth](https://img.shields.io/badge/Supabase_Auth-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Supabase Storage](https://img.shields.io/badge/Supabase_Storage-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)

</td>
<td width="33%" valign="top">

### 🕸️ Graph
![Neo4j](https://img.shields.io/badge/Neo4j_Aura-018BFF?style=for-the-badge&logo=neo4j&logoColor=white)
![Cypher](https://img.shields.io/badge/Cypher-008CC1?style=for-the-badge&logo=neo4j&logoColor=white)

</td>
<td width="33%" valign="top">

### 🔴 Open Data
![OSV](https://img.shields.io/badge/OSV.dev-4285F4?style=for-the-badge&logo=google&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub_API-181717?style=for-the-badge&logo=github&logoColor=white)
![npm](https://img.shields.io/badge/npm_registry-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![PyPI](https://img.shields.io/badge/PyPI-3775A9?style=for-the-badge&logo=pypi&logoColor=white)

</td>
</tr>
</table>

---

## Devpost Submission

**Devpost Project:** [https://devpost.com/software/githygiene](https://devpost.com/software/githygiene)

**Blog Post:** [GitHygiene: Does This Vulnerability Actually Matter in My Code?](https://dev.to/prajwal_priyadarshan/githygiene-does-this-vulnerability-actually-matter-in-my-code-e0b)

---

## Credits and License

### Credits

- [OSV.dev](https://osv.dev) — open vulnerability database by Google
- [Gemma 4](https://deepmind.google/technologies/gemini/gemma/) — open model by Google DeepMind, accessed via the Gemini API
- [Neo4j Aura](https://neo4j.com/cloud/platform/aura-graph-database/) — free-tier graph database
- [Supabase](https://supabase.com) — open-source Firebase alternative
- [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) — force-directed graph renderer by Vasco Asturiano
- GitHub REST API, npm registry, PyPI JSON API — open public data sources

### License

[MIT](LICENSE)

---

## Submission Checklist

- [x] Project title and description added
- [ ] All team members listed
- [x] Problem clearly explained
- [x] Reason for choosing the problem explained
- [x] Solution and key features documented
- [x] Innovation and differentiation explained
- [x] Architecture included
- [x] Technical implementation documented
- [ ] Work completed during the hackathon documented
- [ ] Team contributions documented
- [ ] Working application is functional
- [ ] Live application link added where applicable
- [ ] Demo video added
- [x] AI and open-source components documented
- [ ] Setup and usage instructions tested
- [ ] Challenges and learnings documented
- [ ] Devpost submission completed
- [ ] Devpost link added
- [x] Credits added
- [x] License added
- [x] Repository is organized and complete
