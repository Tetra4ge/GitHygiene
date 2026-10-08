# Phase 7: Graph Insights

**Tier:** Should have

## 1. Goal
Turn the graph from Phase 6 into answers the user can see: which repositories an advisory reaches, which packages are shared, and what a repository's dependency tree looks like.

## 2. Tasks

### 2.1 Queries
Add read functions to `server/src/services/graph.js`. Every query is scoped with `userId` so results only ever include the caller's repositories. Use `session.executeRead`.

**Blast radius** — repositories reached by one advisory, with the shortest path to it:

```cypher
MATCH (r:Repository {userId: $userId})
MATCH (p:Package)-[:AFFECTED_BY]->(:Vulnerability {id: $vulnId})
MATCH path = shortestPath((r)-[:DEPENDS_ON*..10]->(p))
RETURN r.id AS repoId,
       r.fullName AS repo,
       p.name AS package,
       p.version AS version,
       [n IN nodes(path)[1..] | n.name + '@' + n.version] AS chain,
       length(path) AS depth
ORDER BY depth
```

`shortestPath` matters here: asking for every path through a real npm tree can return an enormous number of results. `chain` is the list of packages from the repository down to the vulnerable one — this is what the UI shows as "you get this through A → B → C".

**Shared dependencies** — packages used by more than one repository:

```cypher
MATCH (r:Repository {userId: $userId})-[:DEPENDS_ON]->(p:Package)
WITH p, collect(r.fullName) AS repos
WHERE size(repos) > 1
RETURN p.name AS package, p.version AS version, repos
ORDER BY size(repos) DESC
LIMIT 50
```

**Most used packages** — by name, across versions, which also exposes version drift:

```cypher
MATCH (r:Repository {userId: $userId})-[:DEPENDS_ON]->(p:Package)
RETURN p.name AS package,
       count(DISTINCT r) AS repoCount,
       collect(DISTINCT p.version) AS versions
ORDER BY repoCount DESC
LIMIT 20
```

**Repository subgraph** — nodes and edges for drawing, limited to two levels so the picture stays readable:

```cypher
MATCH (r:Repository {id: $repoId, userId: $userId})-[:DEPENDS_ON]->(d:Package)
OPTIONAL MATCH (d)-[:DEPENDS_ON]->(t:Package)
OPTIONAL MATCH (d)-[:AFFECTED_BY]->(dv:Vulnerability)
OPTIONAL MATCH (t)-[:AFFECTED_BY]->(tv:Vulnerability)
RETURN d, t, dv, tv
LIMIT 500
```

Neo4j returns integers as its own `Integer` type. Convert with `.toNumber()` before sending JSON.

### 2.2 Routes
| Route | Returns |
|---|---|
| `GET /api/graph/blast-radius/:vulnId` | `{ vulnId, affected: [{ repoId, repo, package, version, chain, depth }] }` |
| `GET /api/graph/shared` | `[{ package, version, repos }]` |
| `GET /api/graph/top-packages` | `[{ package, repoCount, versions }]` |
| `GET /api/graph/repo/:id` | `{ nodes: [{ id, label, type, severity? }], links: [{ source, target }] }` |

If Neo4j is unreachable, respond `503` with a clear message. The client shows "Graph insights are unavailable right now" and the rest of the app keeps working.

### 2.3 UI
- **Blast radius** — on any vulnerability row, a "Where else?" action opens a panel listing every affected repository and the dependency chain leading to the vulnerable package.
- **Insights page** — two lists: shared dependencies and most used packages. Packages installed at several different versions get a "version drift" label.
- **Graph view** — on the repository detail page, a force-directed graph (for example with `react-force-graph-2d`) of the repository, its packages, and advisories. Colour vulnerable packages by severity. Clicking a node shows its name and version.

## 3. Done When
- With two repositories that share a vulnerable package, the blast radius for that advisory lists both, each with its own chain.
- A transitive vulnerability shows a chain longer than one package.
- The insights page lists packages shared between repositories.
- The graph view renders a real repository without freezing the page.
- A user sees only their own repositories in every result.

## 4. If Short on Time
Build blast radius first — it is the feature the demo is built around. Then the insights lists. The visual graph view is the first thing to drop.
