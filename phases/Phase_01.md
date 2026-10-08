# Phase 1: Project Scaffold & Environment

**Tier:** Must have

## 1. Goal
A running client and server, connected to Supabase and Neo4j, with the database schema in place. Nothing user-facing yet — this phase exists so every later phase starts from a working base.

## 2. Accounts to Provision
- **Supabase** — create a project. Note the project URL, the anon key (client), and the service role key (server only).
- **Neo4j Aura Free** — create an instance and download the credentials file (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`). The URI uses the `neo4j+s://` scheme.
- **LLM provider** — not needed until Phase 8, but request the key early in case approval takes time.

## 3. Tasks

### 3.1 Scaffold
1. `client/` — Vite + React, Tailwind CSS, React Router, `@supabase/supabase-js`.
2. `server/` — Express with `cors`, `dotenv`, `@supabase/supabase-js`, `neo4j-driver`.
3. Root `.gitignore` covering `node_modules/`, `.env`, `dist/`.
4. Root `.env.example` with every variable listed in [TRD §10](../docs/TRD.md), values left blank.

### 3.2 Server configuration
- `server/src/config/env.js` — reads the environment and fails fast with a clear message if a required variable is missing.
- `server/src/config/supabase.js` — exports a Supabase client created with the service role key.
- `server/src/config/neo4j.js` — exports a single driver instance and closes it on `SIGINT` / `SIGTERM`.
- `server/src/middleware/error.js` — one error handler that returns `{ error: message }` and never leaks stack traces.

### 3.3 Database schema
Put the schema in `supabase/schema.sql` and run it in the Supabase SQL editor. Create the tables from [TRD §5.1](../docs/TRD.md): `profiles`, `repositories`, `scans`, `dependencies`, `vulnerabilities`, `ai_reports`, `notifications`.

- Use `uuid` primary keys with `gen_random_uuid()` defaults.
- Add `on delete cascade` from `repositories` → `scans` → `dependencies` / `vulnerabilities`, so removing a repository cleans up after itself.
- Enable Row Level Security on every table and add no policies. Only the server (service role) can then read or write.

Create the profile automatically at first sign-in:

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, github_login, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### 3.4 Graph constraints
Run once in the Neo4j console:

```cypher
CREATE CONSTRAINT repo_id IF NOT EXISTS FOR (r:Repository) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT package_key IF NOT EXISTS FOR (p:Package) REQUIRE p.key IS UNIQUE;
CREATE CONSTRAINT vuln_id IF NOT EXISTS FOR (v:Vulnerability) REQUIRE v.id IS UNIQUE;
```

### 3.5 Health check
`GET /api/health` runs a trivial query against Postgres (select one row from `profiles`) and `RETURN 1` against Neo4j, and reports each separately:

```json
{ "postgres": "ok", "neo4j": "ok" }
```

## 4. Done When
- `npm run dev` starts both the client and the server without errors.
- `GET /api/health` reports `ok` for both stores.
- All seven tables exist in Supabase with RLS enabled.
- `.env.example` is committed; no `.env` file is tracked.

## 5. If Short on Time
Skip Neo4j setup and return `"neo4j": "skipped"` from the health check. Phases 2–5 do not need it.
