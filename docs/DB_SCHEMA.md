# Database Schema — GitHygiene

This file is the single source of truth for the Postgres schema. It is read
directly by `api-gateway/utils/init-db.js`, which extracts the first fenced
SQL code block below (fenced with the `sql` language tag) and executes it to
provision (or re-provision) the database — so **that block must stay valid,
runnable SQL**, and any schema change in the code must be reflected here too.

## Why this file exists

It was missing for most of this project's build (see `phases/Phase_10.md`
§5 and the README's former "known blocker" note), which meant a clean clone
could not set up its own database — `init-db.js` would fail immediately
trying to read a file that didn't exist. The schema below was reconstructed
from the `CREATE TABLE` / `ALTER TABLE` statements actually present across
`api-gateway/controllers/*.js` and `api-gateway/utils/*.js`, not from a
design document, so it reflects what the running code actually reads and
writes.

## Hierarchy

```text
organizations ──▶ projects ──▶ repositories ──▶ dependency_files
      │                              │               └─▶ dependencies ──▶ dependency_edges
      │                              │                         ├─▶ dependency_vulnerabilities ─▶ cves
      └──▶ users                     │                         ├─▶ osv_findings ─▶ osv_vulnerabilities ─▶ advisory_surfaces
                                      │                         └─▶ (ai_assessments references dependencies + osv_vulnerabilities)
                                      ├─▶ security_alerts
                                      └─▶ notifications
```

This is an **organization-scoped** multi-tenant model (`organizations` →
`projects` → `repositories`), not the per-user model the earliest phase
drafts assumed — every query in the gateway filters through a user's
`organization_id`, with an `admin` role seeing across every organization.

## Notes on specific tables

- **`users`** mirrors Supabase-managed `auth.users` via the
  `handle_new_user()` trigger below — one row per authenticated user, created
  automatically at first sign-in. `last_login` is a reserved column; nothing
  in this build currently writes to it.
- **`cves` / `dependency_vulnerabilities` / `security_alerts`** are the
  original Phase 5/6 scanner's tables — a synthetic CVE dataset matched by
  `ILIKE` against `dependencies.package_name` (see `scanner.service.js`'s own
  comments). Kept as-is; not deleted.
- **`osv_vulnerabilities` / `osv_findings`** are the real detection path
  (`phases/Phase_05.md`) — advisories fetched from osv.dev, cached
  platform-wide, matched by exact package + version. `repositories.security_score`
  / `risk_level` / `score_breakdown` are computed from these, not from `cves`.
- **`advisory_surfaces`** is Stage 1's cache (`phases/Phase_07.md`), keyed by
  advisory id only — repository-independent, shared by every scan that ever
  hits that advisory.
- **`ai_assessments`** is Stage 3's cache (`phases/Phase_08.md`), keyed by
  advisory + repository + installed version + commit sha, so a new commit
  invalidates it.
- **`dependency_edges`** holds the resolved `package-lock.json` tree
  (`phases/Phase_04.md` §2.2) as parent→child package *names* (not ids): the
  `dependencies` table stores at most one resolved version per package name
  per repository (see its unique constraint below), so edges are recorded at
  the name level and the graph writer (`graph.service.js`) resolves each name
  to its current chosen version when it writes to Neo4j.
- **`teams`, `team_members`, `reports`** appear in `init-db.js`'s cleanup
  step (`DROP TABLE IF EXISTS ...`) but are not created here and not read or
  written by any route in this build — harmless no-ops, not part of the
  current schema. Left out of the DDL below rather than fabricated.
- Every `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` you see in the controllers
  (`parser.controller.js`, `schema-migrations.util.js`, `ai-schema.util.js`,
  `dashboard-schema.util.js`) is a self-healing migration for columns added
  after this file was first written mid-build; they are idempotent and also
  reflected in the DDL below, so a fresh `init-db.js` run and an existing
  database converge on the same shape either way.

## Neo4j (graph database, not covered by this file)

Holds only packages, their edges, and advisories — see `phases/Phase_06.md`
§3 and `docs/TRD.md` §5.2 for the node/relationship model
(`Repository`/`Package`/`Vulnerability`). Provisioned by
`graph.service.js`'s `ensureConstraints()` on first write, not by this file.

## Schema

```sql
-- organizations --------------------------------------------------------

CREATE TABLE organizations (
  organization_id SERIAL PRIMARY KEY,
  organization_name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) UNIQUE,
  subscription_plan VARCHAR(50) DEFAULT 'free',
  created_at TIMESTAMP DEFAULT now()
);

-- users (mirrors auth.users; see handle_new_user() trigger below) ------

CREATE TABLE users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(organization_id) ON DELETE SET NULL,
  full_name VARCHAR(255),
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'manager', 'developer')),
  created_at TIMESTAMP DEFAULT now(),
  last_login TIMESTAMP
);

-- projects ---------------------------------------------------------------

CREATE TABLE projects (
  project_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  project_name VARCHAR(255) NOT NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (organization_id, project_name)
);

-- repositories -------------------------------------------------------------

CREATE TABLE repositories (
  repository_id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  repo_name VARCHAR(255) NOT NULL,
  default_branch VARCHAR(100) DEFAULT 'main',
  language VARCHAR(100),
  last_synced_at TIMESTAMP,
  -- Phase 5 — OSV scoring (schema-migrations.util.js)
  security_score INT,
  risk_level VARCHAR(20),
  score_breakdown JSONB,
  last_scanned_at TIMESTAMP,
  last_scan_error TEXT,
  -- Phase 6 — graph write status (schema-migrations.util.js)
  graph_error TEXT,
  UNIQUE (project_id, repo_name)
);

-- dependency_files — pointers to manifests ingested into Supabase Storage --

CREATE TABLE dependency_files (
  file_id SERIAL PRIMARY KEY,
  repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  package_manager VARCHAR(50) NOT NULL,
  storage_path TEXT NOT NULL,
  last_scanned TIMESTAMP
);

-- dependencies — one row per resolved package per repository -------------

CREATE TABLE dependencies (
  dependency_id SERIAL PRIMARY KEY,
  repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  current_version VARCHAR(100),
  latest_version VARCHAR(100),
  is_deprecated BOOLEAN DEFAULT false,
  introduced_at TIMESTAMP DEFAULT now(),
  original_constraint VARCHAR(100),
  package_manager VARCHAR(50) NOT NULL,
  -- Phase 4 — transitive dependency walk (parser.controller.js)
  is_direct BOOLEAN DEFAULT true,
  ecosystem VARCHAR(20),
  UNIQUE (repository_id, package_name, package_manager)
);

CREATE INDEX idx_dependencies_package ON dependencies(package_name);

-- dependency_edges — resolved package-lock.json tree, by package name ----

CREATE TABLE dependency_edges (
  edge_id SERIAL PRIMARY KEY,
  repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  package_manager VARCHAR(50) NOT NULL,
  parent_name VARCHAR(255) NOT NULL,
  child_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (repository_id, package_manager, parent_name, child_name)
);

-- cves — synthetic dataset for the original Phase 5/6 ILIKE scanner ------

CREATE TABLE cves (
  cve_id SERIAL PRIMARY KEY,
  cve_number VARCHAR(50) UNIQUE NOT NULL,
  severity VARCHAR(20) NOT NULL,
  cvss_score NUMERIC(3, 1),
  description TEXT NOT NULL,
  published_date DATE
);

CREATE INDEX idx_cves_number ON cves(cve_number);

-- dependency_vulnerabilities — junction for the ILIKE scanner -------------

CREATE TABLE dependency_vulnerabilities (
  id SERIAL PRIMARY KEY,
  dependency_id INT NOT NULL REFERENCES dependencies(dependency_id) ON DELETE CASCADE,
  cve_id INT NOT NULL REFERENCES cves(cve_id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (dependency_id, cve_id)
);

-- security_alerts — raised by the ILIKE scanner ---------------------------

CREATE TABLE security_alerts (
  alert_id SERIAL PRIMARY KEY,
  repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  dependency_id INT NOT NULL REFERENCES dependencies(dependency_id) ON DELETE CASCADE,
  severity VARCHAR(20) NOT NULL,
  message TEXT,
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT now(),
  resolved_at TIMESTAMP
);

CREATE INDEX idx_alerts_repository ON security_alerts(repository_id);

-- osv_vulnerabilities — real advisories, cached platform-wide forever -----

CREATE TABLE osv_vulnerabilities (
  osv_id VARCHAR(100) PRIMARY KEY,
  aliases TEXT[],
  severity VARCHAR(20),
  summary TEXT,
  details TEXT,
  raw JSONB,
  cached_at TIMESTAMP DEFAULT now()
);

-- osv_findings — one row per (dependency, advisory) pair -----------------

CREATE TABLE osv_findings (
  finding_id SERIAL PRIMARY KEY,
  repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  dependency_id INT NOT NULL REFERENCES dependencies(dependency_id) ON DELETE CASCADE,
  osv_id VARCHAR(100) NOT NULL REFERENCES osv_vulnerabilities(osv_id) ON DELETE CASCADE,
  fixed_version VARCHAR(100),
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (dependency_id, osv_id)
);

-- advisory_surfaces — Stage 1 cache, keyed by advisory id only -----------

CREATE TABLE advisory_surfaces (
  osv_id VARCHAR(100) PRIMARY KEY REFERENCES osv_vulnerabilities(osv_id) ON DELETE CASCADE,
  vulnerable_symbols TEXT[],
  vulnerable_subpaths TEXT[],
  vulnerable_configs TEXT[],
  trigger_conditions TEXT[],
  attack_vector VARCHAR(100),
  needs_untrusted_input BOOLEAN,
  exploit_requires_runtime VARCHAR(20),
  extraction_confidence VARCHAR(10),
  notes TEXT,
  model VARCHAR(100),
  from_ecosystem_specific BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- ai_assessments — Stage 3 cache, keyed by advisory+repo+version+commit --

CREATE TABLE ai_assessments (
  assessment_id SERIAL PRIMARY KEY,
  osv_id VARCHAR(100) NOT NULL REFERENCES osv_vulnerabilities(osv_id) ON DELETE CASCADE,
  repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  dependency_id INT NOT NULL REFERENCES dependencies(dependency_id) ON DELETE CASCADE,
  installed_version VARCHAR(100) NOT NULL,
  commit_sha VARCHAR(100) NOT NULL,
  model VARCHAR(100),
  response JSONB NOT NULL,
  evidence JSONB,
  remediation JSONB,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (osv_id, repository_id, dependency_id, installed_version, commit_sha)
);

-- notifications — organization-scoped scan events (Phase 9 §6) -----------

CREATE TABLE notifications (
  notification_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  repository_id INT REFERENCES repositories(repository_id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);
```

## `handle_new_user()` trigger

`init-db.js` installs this against `auth.users` after the tables above exist
(Supabase manages `auth.users` itself in production; locally, `init-db.js`
creates a minimal mock of it first so the trigger has something to bind to):

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (user_id, email, full_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'developer'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

## Row Level Security

Not currently enabled by this file. `api-gateway` connects with a direct
Postgres role (`DATABASE_URL`), not the Supabase client libraries' anon/service
keys, and every query is scoped by the caller's `organization_id` in
application code (see `utils/rbac.util.js`). If this moves to using
Supabase's REST/client libraries directly from a context that isn't fully
trusted, enable RLS on every table first — TRD §11 states this as the
intended posture.

## Setup

```bash
cd api-gateway
npm install
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_*, NEO4J_*, GITHUB_CLIENT_*
node utils/init-db.js  # reads this file, (re)creates every table above
```

Running it against an existing database **drops and recreates every table
listed above** (see `init-db.js`'s own `DROP TABLE IF EXISTS ... CASCADE`
step) — safe for a fresh setup, destructive on one with data you want to
keep.
