// Phase 6 — dependency graph and blast radius. Neo4j is supporting
// infrastructure: a write failure here must never fail a scan, and every
// read is scoped by organizationId so one org never sees another's data.

const { getNeo4jSession } = require('../config/db.config');

const CHUNK_SIZE = 2000;

function packageKey(ecosystem, name, version) {
  return `${ecosystem}:${name}@${version}`;
}

async function ensureConstraints() {
  const session = getNeo4jSession();
  try {
    await session.executeWrite((tx) =>
      Promise.all([
        tx.run('CREATE CONSTRAINT repo_id IF NOT EXISTS FOR (r:Repository) REQUIRE r.id IS UNIQUE'),
        tx.run('CREATE CONSTRAINT package_key IF NOT EXISTS FOR (p:Package) REQUIRE p.key IS UNIQUE'),
        tx.run('CREATE CONSTRAINT vuln_id IF NOT EXISTS FOR (v:Vulnerability) REQUIRE v.id IS UNIQUE')
      ])
    );
  } finally {
    await session.close();
  }
}

/**
 * repository: { id, fullName, organizationId }
 * packages: [{ ecosystem, name, version }]
 * edges: [{ from, to }] — names; '__root__' means "the repository itself"
 * findings: [{ osvId, severity, summary, packageName, packageVersion, ecosystem }]
 */
async function writeScanToGraph({ repository, packages, edges, findings }) {
  await ensureConstraints();

  const versionByName = new Map(packages.map((p) => [p.name, p]));
  const session = getNeo4jSession();

  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (r:Repository {id: $id})
         SET r.fullName = $fullName, r.organizationId = $organizationId`,
        repository
      );

      // Drop this repository's old direct edges first so removed
      // dependencies disappear instead of accumulating forever.
      await tx.run(
        `MATCH (r:Repository {id: $id})-[rel:DEPENDS_ON]->(:Package) DELETE rel`,
        { id: repository.id }
      );

      const packageRows = packages.map((p) => ({
        key: packageKey(p.ecosystem, p.name, p.version),
        ecosystem: p.ecosystem,
        name: p.name,
        version: p.version
      }));

      for (let i = 0; i < packageRows.length; i += CHUNK_SIZE) {
        const chunk = packageRows.slice(i, i + CHUNK_SIZE);
        await tx.run(
          `UNWIND $rows AS row
           MERGE (p:Package {key: row.key})
           SET p.ecosystem = row.ecosystem, p.name = row.name, p.version = row.version`,
          { rows: chunk }
        );
      }

      const directEdgeRows = [];
      const packageEdgeRows = [];
      for (const edge of edges) {
        const toPkg = versionByName.get(edge.to);
        if (!toPkg) continue;
        const toKey = packageKey(toPkg.ecosystem, toPkg.name, toPkg.version);
        if (edge.from === '__root__') {
          directEdgeRows.push({ toKey });
        } else {
          const fromPkg = versionByName.get(edge.from);
          if (!fromPkg) continue;
          packageEdgeRows.push({ fromKey: packageKey(fromPkg.ecosystem, fromPkg.name, fromPkg.version), toKey });
        }
      }

      for (let i = 0; i < directEdgeRows.length; i += CHUNK_SIZE) {
        const chunk = directEdgeRows.slice(i, i + CHUNK_SIZE);
        await tx.run(
          `MATCH (r:Repository {id: $id})
           UNWIND $rows AS row
           MATCH (p:Package {key: row.toKey})
           MERGE (r)-[:DEPENDS_ON]->(p)`,
          { id: repository.id, rows: chunk }
        );
      }

      for (let i = 0; i < packageEdgeRows.length; i += CHUNK_SIZE) {
        const chunk = packageEdgeRows.slice(i, i + CHUNK_SIZE);
        await tx.run(
          `UNWIND $rows AS row
           MATCH (a:Package {key: row.fromKey}), (b:Package {key: row.toKey})
           MERGE (a)-[:DEPENDS_ON]->(b)`,
          { rows: chunk }
        );
      }

      const findingRows = (findings || [])
        .map((f) => {
          const pkg = versionByName.get(f.packageName);
          if (!pkg) return null;
          return {
            key: packageKey(pkg.ecosystem, pkg.name, pkg.version),
            vulnId: f.osvId,
            severity: f.severity,
            summary: f.summary
          };
        })
        .filter(Boolean);

      for (let i = 0; i < findingRows.length; i += CHUNK_SIZE) {
        const chunk = findingRows.slice(i, i + CHUNK_SIZE);
        await tx.run(
          `UNWIND $rows AS row
           MERGE (v:Vulnerability {id: row.vulnId})
           SET v.severity = row.severity, v.summary = row.summary
           WITH v, row
           MATCH (p:Package {key: row.key})
           MERGE (p)-[:AFFECTED_BY]->(v)`,
          { rows: chunk }
        );
      }
    });
  } finally {
    await session.close();
  }
}

async function deleteRepository(repositoryId) {
  const session = getNeo4jSession();
  try {
    await session.executeWrite((tx) =>
      tx.run('MATCH (r:Repository {id: $id}) DETACH DELETE r', { id: String(repositoryId) })
    );
  } finally {
    await session.close();
  }
}

/** Repositories reached by one advisory, with the shortest path to it. */
async function getBlastRadius(organizationId, vulnId) {
  const session = getNeo4jSession();
  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (r:Repository {organizationId: $orgId})
         MATCH (p:Package)-[:AFFECTED_BY]->(:Vulnerability {id: $vulnId})
         MATCH path = shortestPath((r)-[:DEPENDS_ON*..10]->(p))
         RETURN r.id AS repoId, r.fullName AS repo,
                p.name AS package, p.version AS version,
                [n IN nodes(path)[1..] | n.name + '@' + n.version] AS chain,
                length(path) AS depth
         ORDER BY depth`,
        { orgId: String(organizationId), vulnId }
      )
    );
    return result.records.map((r) => ({
      repoId: r.get('repoId'),
      repo: r.get('repo'),
      package: r.get('package'),
      version: r.get('version'),
      chain: r.get('chain'),
      depth: r.get('depth')?.toNumber ? r.get('depth').toNumber() : r.get('depth')
    }));
  } finally {
    await session.close();
  }
}

/** Shortest dependency path from one repository to one package, for Phase 8. */
async function getDependencyPath(organizationId, repositoryId, ecosystem, name, version) {
  const session = getNeo4jSession();
  const key = packageKey(ecosystem, name, version);
  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (r:Repository {id: $repoId, organizationId: $orgId})
         MATCH (p:Package {key: $key})
         OPTIONAL MATCH path = shortestPath((r)-[:DEPENDS_ON*..10]->(p))
         RETURN
           CASE WHEN path IS NULL THEN null
                ELSE [n IN nodes(path)[1..] | n.name + '@' + n.version] END AS chain,
           CASE WHEN path IS NULL THEN null ELSE length(path) END AS depth`,
        { repoId: String(repositoryId), orgId: String(organizationId), key }
      )
    );
    if (result.records.length === 0) return { direct: false, chain: null, depth: null };
    const record = result.records[0];
    const depthRaw = record.get('depth');
    const depth = depthRaw?.toNumber ? depthRaw.toNumber() : depthRaw;
    return { direct: depth === 1, chain: record.get('chain'), depth };
  } finally {
    await session.close();
  }
}

async function getSharedDependencies(organizationId) {
  const session = getNeo4jSession();
  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (r:Repository {organizationId: $orgId})-[:DEPENDS_ON]->(p:Package)
         WITH p, collect(DISTINCT r.fullName) AS repos
         WHERE size(repos) > 1
         RETURN p.name AS package, p.version AS version, repos, size(repos) AS repoCount
         ORDER BY repoCount DESC
         LIMIT 50`,
        { orgId: String(organizationId) }
      )
    );
    return result.records.map((r) => ({
      package: r.get('package'),
      version: r.get('version'),
      repos: r.get('repos'),
      repoCount: r.get('repoCount')?.toNumber ? r.get('repoCount').toNumber() : r.get('repoCount')
    }));
  } finally {
    await session.close();
  }
}

async function getTopPackages(organizationId) {
  const session = getNeo4jSession();
  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (r:Repository {organizationId: $orgId})-[:DEPENDS_ON]->(p:Package)
         WITH p.name AS package, count(DISTINCT r) AS repoCount
         RETURN package, repoCount
         ORDER BY repoCount DESC
         LIMIT 20`,
        { orgId: String(organizationId) }
      )
    );
    return result.records.map((r) => ({
      package: r.get('package'),
      repoCount: r.get('repoCount')?.toNumber ? r.get('repoCount').toNumber() : r.get('repoCount')
    }));
  } finally {
    await session.close();
  }
}

async function getRepoGraph(organizationId, repositoryId) {
  const session = getNeo4jSession();
  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (r:Repository {id: $repoId, organizationId: $orgId})
         OPTIONAL MATCH (r)-[:DEPENDS_ON]->(direct:Package)
         OPTIONAL MATCH (direct)-[:DEPENDS_ON*0..5]->(transitive:Package)
         OPTIONAL MATCH (transitive)-[:AFFECTED_BY]->(v:Vulnerability)
         RETURN r, collect(DISTINCT direct) AS directs, collect(DISTINCT transitive) AS transitives,
                collect(DISTINCT v) AS vulns`,
        { repoId: String(repositoryId), orgId: String(organizationId) }
      )
    );
    if (result.records.length === 0) return { nodes: [], edges: [] };
    const record = result.records[0];
    const repo = record.get('r');
    const directs = record.get('directs').filter(Boolean);
    const transitives = record.get('transitives').filter(Boolean);
    const vulns = record.get('vulns').filter(Boolean);

    const nodes = [
      { id: repo.properties.id, label: repo.properties.fullName, type: 'repository' },
      ...directs.map((p) => ({ id: p.properties.key, label: p.properties.name, type: 'direct' })),
      ...transitives.map((p) => ({ id: p.properties.key, label: p.properties.name, type: 'transitive' })),
      ...vulns.map((v) => ({ id: v.properties.id, label: v.properties.id, type: 'vulnerability' }))
    ];
    return { nodes, edges: [] };
  } finally {
    await session.close();
  }
}

module.exports = {
  packageKey,
  writeScanToGraph,
  deleteRepository,
  getBlastRadius,
  getDependencyPath,
  getSharedDependencies,
  getTopPackages,
  getRepoGraph
};
