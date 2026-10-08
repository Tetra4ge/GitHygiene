// Phase 5 — real vulnerability data from OSV.dev. No API key needed.
//
// Two calls: a batch query for ids (cheap, one request per up-to-1000
// packages), then one detail fetch per *unique* advisory id, run with capped
// concurrency and cached in Postgres so the same advisory is never re-fetched
// across repositories or scans.

const axios = require('axios');

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';
const BATCH_LIMIT = 1000;
const DETAIL_CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * packages: [{ ecosystem: 'npm'|'PyPI', name, version }]
 * Returns: Map<`${ecosystem}:${name}@${version}`, string[] osvIds>
 */
async function queryBatch(packages) {
  const results = new Map();
  if (packages.length === 0) return results;

  for (let i = 0; i < packages.length; i += BATCH_LIMIT) {
    const chunk = packages.slice(i, i + BATCH_LIMIT);
    const queries = chunk.map((p) => ({
      package: { ecosystem: p.ecosystem, name: p.name },
      version: p.version
    }));

    let response;
    try {
      response = await axios.post(
        OSV_BATCH_URL,
        { queries },
        { timeout: REQUEST_TIMEOUT_MS }
      );
    } catch (err) {
      throw new Error(`OSV batch query failed: ${err.message}`);
    }

    const osvResults = response.data?.results || [];
    chunk.forEach((pkg, idx) => {
      const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
      const vulns = (osvResults[idx]?.vulns || []).map((v) => v.id);
      results.set(key, vulns);
    });
  }

  return results;
}

function normalizeSeverity(raw) {
  const upper = (raw || 'UNKNOWN').toUpperCase();
  return upper === 'MODERATE' ? 'MEDIUM' : upper;
}

/** Extracts the fixed version for one package from an OSV advisory's affected[] ranges. */
function extractFixedVersion(advisory, ecosystem, packageName) {
  const affected = advisory.affected || [];
  for (const entry of affected) {
    if (entry.package?.ecosystem !== ecosystem || entry.package?.name !== packageName) continue;
    for (const range of entry.ranges || []) {
      for (const event of range.events || []) {
        if (event.fixed) return event.fixed;
      }
    }
    // Some advisories list fixed versions directly instead of ranges.
    if (Array.isArray(entry.versions) && entry.versions.length === 0 && entry.database_specific?.last_affected_version) {
      return null;
    }
  }
  return null;
}

/** Fetches one advisory's full detail from OSV.dev. */
async function fetchVulnDetail(osvId) {
  const { data } = await axios.get(`${OSV_VULN_URL}/${osvId}`, { timeout: REQUEST_TIMEOUT_MS });
  return data;
}

/**
 * Fetches details for a set of unique OSV ids with capped concurrency.
 * Returns Map<osvId, normalizedAdvisory>. `fixed_version` is left null here —
 * it is package-specific, so the caller derives it per-dependency with
 * extractFixedVersion() from the stored `raw` advisory.
 */
async function fetchVulnDetails(osvIds) {
  const unique = [...new Set(osvIds)];
  const details = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const id = unique[cursor++];
      try {
        const raw = await fetchVulnDetail(id);
        details.set(id, normalizeAdvisory(raw));
      } catch (err) {
        console.error(`OSV detail fetch failed for ${id}:`, err.message);
      }
    }
  }

  const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, unique.length) }, worker);
  await Promise.all(workers);
  return details;
}

function normalizeAdvisory(raw) {
  const summary = raw.summary || (raw.details ? raw.details.split('\n')[0] : raw.id);
  return {
    osv_id: raw.id,
    aliases: raw.aliases || [],
    summary,
    details: raw.details || null,
    severity: normalizeSeverity(raw.database_specific?.severity),
    raw
  };
}

module.exports = {
  queryBatch,
  fetchVulnDetails,
  normalizeAdvisory,
  normalizeSeverity,
  extractFixedVersion
};
