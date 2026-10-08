# Phase 6: Dependency Graph and Blast Radius

**Tier:** Should have

Phases 6 and 7 of the previous plan (graph writing, then graph querying) are
merged here, freeing a phase for the AI engine. The graph is supporting
infrastructure for the engine, not a feature of its own.

## 1. Goal
Each completed scan is written to Neo4j, and the platform can answer: which
repositories does this advisory reach, and through what chain of packages.

## 2. What the graph is for

Two consumers, both concrete:

1. **Blast radius** — the cross-repository question no per-repo scanner answers,
   and the organisation-level differentiator in the PRD.
2. **The AI engine (Phases 7–8)** — Stage 3 is told whether a finding is direct
   or transitive and, if transitive, which direct dependency drags it in. That
   path comes from here, and it materially changes the verdict: your code cannot
   call a package it never imports.

If the graph is unavailable, the engine still runs — it receives "dependency
path unknown" and says so. Graph failures must never fail a scan.

## 3. Model

```text
(:Repository {id, fullName, organizationId})
(:Package {key, ecosystem, name, version})      key = "<ecosystem>:<name>@<version>"
(:Vulnerability {id, severity, summary})

(:Repository)-[:DEPENDS_ON]->(:Package)
(:Package)-[:DEPENDS_ON]->(:Package)
(:Package)-[:AFFECTED_BY]->(:Vulnerability)
```

`organizationId`, not `userId` — match the real hierarchy. Package nodes are
shared between repositories; that sharing is the whole mechanism.

Uniqueness constraints on `Repository.id`, `Package.key`, `Vulnerability.id`
keep writes idempotent:

```cypher
CREATE CONSTRAINT repo_id     IF NOT EXISTS FOR (r:Repository)    REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT package_key IF NOT EXISTS FOR (p:Package)       REQUIRE p.key IS UNIQUE;
CREATE CONSTRAINT vuln_id     IF NOT EXISTS FOR (v:Vulnerability) REQUIRE v.id IS UNIQUE;
```

## 4. Writing

`writeScanToGraph({ repository, packages, edges, vulnerabilities })`. `MERGE`
throughout so re-scanning never duplicates; `UNWIND` so each step is one round
trip. Drop the repository's old `DEPENDS_ON` edges first so removed dependencies
disappear. One `session.executeWrite`, chunks of a few thousand, session closed
in `finally`.

Hook in after scoring. Wrap the whole step in `try/catch`: log the failure,
record on the scan that the graph was not updated, continue. On
`DELETE /repos/:id`: `MATCH (r:Repository {id:$id}) DETACH DELETE r` — leave
package nodes, other repositories share them.

## 5. Reading

Every query scoped by `organizationId`, `session.executeRead`. Neo4j integers
need `.toNumber()` before JSON.

**Blast radius** — repositories reached by one advisory, with the shortest path:

```cypher
MATCH (r:Repository {organizationId: $orgId})
MATCH (p:Package)-[:AFFECTED_BY]->(:Vulnerability {id: $vulnId})
MATCH path = shortestPath((r)-[:DEPENDS_ON*..10]->(p))
RETURN r.id AS repoId, r.fullName AS repo,
       p.name AS package, p.version AS version,
       [n IN nodes(path)[1..] | n.name + '@' + n.version] AS chain,
       length(path) AS depth
ORDER BY depth
```

`shortestPath` is not optional — every path through a real npm tree is an
enormous result set. `chain` is what the UI renders as "you get this through
A → B → C", and what Phase 8 passes to the model.

**Dependency path for one finding** — the single query the engine calls:
shortest path from the repository to the vulnerable package, returning the
direct dependency at the head of the chain.

**Shared dependencies** and **most-used packages** — `GROUP BY` over direct
edges; useful on an insights page, not required by anything else.

Routes: `GET /graph/blast-radius/:vulnId`, `/graph/shared`,
`/graph/top-packages`, `/graph/repo/:id`. `503` with a clear message when Neo4j
is unreachable; the rest of the app keeps working.

## 6. Done When
- Two repositories sharing a vulnerable package both appear in that advisory's
  blast radius, each with its own chain.
- A transitive finding shows a chain longer than one package.
- Scanning twice does not change node or relationship counts.
- Two repositories on the same package version point to one `Package` node.
- Neo4j stopped → scans still complete, dashboard still works, graph views say
  so.
- An organisation sees only its own repositories in every result.

## 7. If Short on Time
Write direct dependencies and advisories only; skip `Package → Package` edges.
Blast radius still works at depth one, and the engine receives "direct" or
"transitive, path unknown" — degraded but honest.

The force-directed graph view is the first thing to drop. It is the most
screenshot-friendly and the least useful part of this phase: a hairball of 800
npm packages tells a judge nothing, while one cited line of their own code tells
them everything. `react-force-graph-2d` is already in `frontend/package.json` if
time allows.

## 8. Implementation Status (Current Codebase)
- **Built:** the Neo4j driver is configured and `GET /health` pings it with
  `RETURN 1`. That is the only place Neo4j is touched.
- **Not built:** everything else. No node has ever been created.
- **Blocked on Phase 4:** the graph needs transitive edges, and the parser does
  not produce them yet (see `Phase_05.md` §6). Without that, every chain is
  length one.
