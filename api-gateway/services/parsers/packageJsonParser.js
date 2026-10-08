// Phase 4 §2.2 — package.json fallback when no package-lock.json is present.
// All packages are direct; there are no edges. Versions are approximate
// (range prefix stripped), which the caller surfaces to the UI.

const RANGE_PREFIX = /^[\^~>=<\s]+/;
// git URLs, "workspace:*", "*", "latest", "catalog:" etc. — not a version we
// can match against a vulnerability database, so skip rather than store junk.
const NOT_A_PLAIN_VERSION = /^(git\+|git:|https?:|file:|workspace:|catalog:|link:|\*$|latest$)/i;

function cleanVersion(constraint) {
  if (typeof constraint !== 'string') return null;
  const trimmed = constraint.trim();
  if (!trimmed || NOT_A_PLAIN_VERSION.test(trimmed)) return null;
  const stripped = trimmed.replace(RANGE_PREFIX, '').split(/[\s|]/)[0];
  if (!stripped || NOT_A_PLAIN_VERSION.test(stripped)) return null;
  if (!/^\d/.test(stripped)) return null;
  return stripped;
}

function parsePackageJson(manifestJson) {
  const allDeps = {
    ...(manifestJson.dependencies || {}),
    ...(manifestJson.devDependencies || {})
  };

  const packages = [];
  for (const [name, constraint] of Object.entries(allDeps)) {
    const version = cleanVersion(constraint);
    if (!version) continue;
    packages.push({ ecosystem: 'npm', name, version, isDirect: true, constraint });
  }

  return { packages, edges: [], approximate: true };
}

module.exports = { parsePackageJson, cleanVersion };
