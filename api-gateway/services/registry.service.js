// Phase 5 §3.4 — latest version and deprecation status for direct
// dependencies, from the npm registry and the PyPI JSON API. No API key.
// A failed lookup leaves latest_version untouched rather than failing the scan.

const axios = require('axios');

const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 10000;

async function lookupNpm(name, installedVersion) {
  const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name;
  const { data } = await axios.get(`https://registry.npmjs.org/${encoded}`, {
    timeout: REQUEST_TIMEOUT_MS
  });
  const latest = data?.['dist-tags']?.latest || null;
  const deprecated = data?.versions?.[installedVersion]?.deprecated || null;
  return { latest, deprecated: Boolean(deprecated), deprecationMessage: deprecated || null };
}

async function lookupPyPI(name) {
  const { data } = await axios.get(`https://pypi.org/pypi/${name}/json`, {
    timeout: REQUEST_TIMEOUT_MS
  });
  const latest = data?.info?.version || null;
  return { latest, deprecated: false, deprecationMessage: null };
}

/**
 * deps: [{ name, version, ecosystem }] — direct dependencies only, per the
 * phase's scope decision (registry lookups are capped and not useful for
 * the hundreds of transitive packages a lockfile walk now returns).
 * Returns Map<name, { latest, deprecated, deprecationMessage }>.
 */
async function lookupLatestVersions(deps) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < deps.length) {
      const dep = deps[cursor++];
      try {
        const info =
          dep.ecosystem === 'PyPI'
            ? await lookupPyPI(dep.name)
            : await lookupNpm(dep.name, dep.version);
        results.set(dep.name, info);
      } catch (err) {
        console.error(`Registry lookup failed for ${dep.name}:`, err.message);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, deps.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { lookupLatestVersions };
