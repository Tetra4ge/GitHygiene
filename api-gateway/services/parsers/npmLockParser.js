// Phase 4 §2.2 — package-lock.json (lockfile v2 / v3) walker.
//
// Walks the flat `packages` object (lockfile v2/v3 shape) to recover the full
// resolved dependency tree, not just the direct packages `package.json` names.
//
// Scope decision: the `dependencies` table is unique on
// (repository_id, package_name, package_manager), so only one resolved
// version per package *name* can be stored per repository. When a lockfile
// resolves two different versions of the same name (npm's nested
// node_modules), the hoisted top-level entry (`node_modules/<name>`) wins;
// otherwise the first version encountered wins. This is a documented
// simplification, not a bug — see phases/Phase_04.md §6.
function parseNpmLock(lockJson) {
  const packages = lockJson && lockJson.packages;
  if (!packages || typeof packages !== 'object') {
    return { packages: [], edges: [] };
  }

  const root = packages[''] || {};
  const directNames = new Set([
    ...Object.keys(root.dependencies || {}),
    ...Object.keys(root.devDependencies || {})
  ]);

  // name -> { version, isDirect, isTopLevel }
  const chosen = new Map();
  // path -> { name, version }, used to resolve edges below
  const entryByPath = new Map();

  for (const [pkgPath, entry] of Object.entries(packages)) {
    if (pkgPath === '') continue;
    if (!entry || entry.link === true) continue;
    if (!pkgPath.startsWith('node_modules/') && !pkgPath.includes('/node_modules/')) continue;

    const segments = pkgPath.split('node_modules/');
    const name = segments[segments.length - 1];
    if (!name || !entry.version) continue;

    entryByPath.set(pkgPath, { name, version: entry.version });

    const isTopLevel = pkgPath === `node_modules/${name}`;
    const isDirect = directNames.has(name) && isTopLevel;

    const existing = chosen.get(name);
    if (!existing || (isTopLevel && !existing.isTopLevel)) {
      chosen.set(name, { version: entry.version, isDirect: isDirect || (existing && existing.isDirect), isTopLevel });
    } else if (isDirect) {
      existing.isDirect = true;
    }
  }

  // Direct packages named in package.json that never resolved in `packages`
  // (shouldn't normally happen, but a malformed lockfile can omit one) —
  // nothing to add since we have no version for them; they are simply absent.

  const edgeSet = new Set();
  const edges = [];

  function resolveDepPath(fromPath, depName) {
    // Node's resolution order: this entry's own node_modules, then walk up
    // one node_modules segment at a time to the root.
    const candidates = [];
    if (fromPath) {
      candidates.push(`${fromPath}/node_modules/${depName}`);
      let cursor = fromPath;
      while (cursor.includes('/node_modules/')) {
        cursor = cursor.slice(0, cursor.lastIndexOf('/node_modules/'));
        candidates.push(`${cursor}/node_modules/${depName}`);
      }
    }
    candidates.push(`node_modules/${depName}`);
    for (const c of candidates) {
      if (entryByPath.has(c)) return entryByPath.get(c);
    }
    return null;
  }

  for (const [pkgPath, entry] of Object.entries(packages)) {
    const deps = { ...(entry.dependencies || {}), ...(entry.optionalDependencies || {}) };
    const fromName = pkgPath === '' ? null : entryByPath.get(pkgPath)?.name;
    const fromKey = pkgPath === '' ? '__root__' : fromName;
    if (!fromKey) continue;

    for (const depName of Object.keys(deps)) {
      const resolved = resolveDepPath(pkgPath, depName);
      const toName = resolved ? resolved.name : depName;
      const edgeKey = `${fromKey}>${toName}`;
      if (edgeSet.has(edgeKey) || fromKey === toName) continue;
      edgeSet.add(edgeKey);
      edges.push({ from: fromKey, to: toName });
    }
  }

  const resultPackages = [];
  for (const [name, info] of chosen.entries()) {
    resultPackages.push({
      ecosystem: 'npm',
      name,
      version: info.version,
      isDirect: Boolean(info.isDirect)
    });
  }

  // Root-level edges (direct dependency -> package) use '__root__' as `from`;
  // callers should map that sentinel to the repository node.
  return { packages: resultPackages, edges };
}

module.exports = { parseNpmLock };
