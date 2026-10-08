# Phase 6: Dependency Graph

**Tier:** Should have

## 1. Goal
Each completed scan is written into Neo4j as a graph of repositories, packages, and advisories, shared across all of the user's repositories.

## 2. Why a Graph
The questions that make this product different are multi-hop: "which repositories reach this advisory, and through which packages?" Package nodes are shared between repositories, so one advisory attached to one package node is immediately connected to every repository that depends on it, at any depth.

## 3. Graph Model

```text
(:Repository {id, fullName, userId})
(:Package {key, ecosystem, name, version})
(:Vulnerability {id, severity, summary})

(:Repository)-[:DEPENDS_ON]->(:Package)
(:Package)-[:DEPENDS_ON]->(:Package)
(:Package)-[:AFFECTED_BY]->(:Vulnerability)
```

`Package.key` is `<ecosystem>:<name>@<version>`, matching the keys the parsers produce in Phase 4.

`Repository.userId` is what keeps one user's graph separate from another's: every query starts from repositories owned by the caller.

## 4. Tasks

### 4.1 Graph writer
`server/src/services/graph.js` exports `writeScanToGraph({ repository, packages, edges, vulnerabilities })`. Use `MERGE` throughout so re-scanning never creates duplicates, and `UNWIND` so each step is one round trip instead of one per package.

```cypher
// 1. Repository — and drop its old direct edges so removed dependencies disappear
MERGE (r:Repository {id: $repo.id})
SET r.fullName = $repo.fullName, r.userId = $repo.userId
WITH r
OPTIONAL MATCH (r)-[old:DEPENDS_ON]->()
DELETE old
```

```cypher
// 2. Packages
UNWIND $packages AS pkg
MERGE (p:Package {key: pkg.key})
SET p.ecosystem = pkg.ecosystem, p.name = pkg.name, p.version = pkg.version
```

```cypher
// 3. Direct dependencies
MATCH (r:Repository {id: $repoId})
UNWIND $directKeys AS key
MATCH (p:Package {key: key})
MERGE (r)-[:DEPENDS_ON]->(p)
```

```cypher
// 4. Transitive edges
UNWIND $edges AS e
MATCH (a:Package {key: e.from}), (b:Package {key: e.to})
MERGE (a)-[:DEPENDS_ON]->(b)
```

```cypher
// 5. Advisories
UNWIND $vulns AS v
MATCH (p:Package {key: v.packageKey})
MERGE (x:Vulnerability {id: v.id})
SET x.severity = v.severity, x.summary = v.summary
MERGE (p)-[:AFFECTED_BY]->(x)
```

Run the steps inside one `session.executeWrite` so a scan is written completely or not at all. Send large lists in chunks of a few thousand. Always close the session in a `finally` block.

### 4.2 Hook into the pipeline
`fetch → parse → save dependencies → OSV → registries → score → write graph → done`

The graph step must not be able to fail a scan. Catch its errors, log them, and record on the scan that the graph was not updated, so the UI can say "graph data unavailable for this scan" instead of showing an empty graph as if it were correct.

### 4.3 Cleanup
When a repository is deleted (`DELETE /api/repos/:id`), remove its node:

```cypher
MATCH (r:Repository {id: $id}) DETACH DELETE r
```

Package nodes are left in place — other repositories may share them.

## 5. Done When
- After a scan, the Neo4j console shows the repository connected to its direct packages, those connected to their transitive packages, and vulnerable packages connected to advisories.
- Scanning the same repository twice does not change the node or relationship counts.
- Two repositories using the same package version point to the same `Package` node.
- Stopping Neo4j and running a scan still produces a completed scan with results in the dashboard.

## 6. If Short on Time
Write only direct dependencies and advisories (skip step 4). Blast radius and shared-dependency queries still work at depth one.
