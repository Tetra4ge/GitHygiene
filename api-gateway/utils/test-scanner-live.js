const { pgPool } = require('../config/db.config');
const axios = require('axios');
require('dotenv').config();

// Quick re-verification after batching the scanner's inserts: confirms the
// scan completes fast (single batched round-trip instead of per-match loop)
// and still produces correct, non-duplicated results. Cleans up defensively
// with individual try/catch per statement so a partial failure can't leave
// dangling rows or a mis-set organization_id.

const API_URL = 'http://localhost:4000';
const TOKEN = process.env.SCANNER_TEST_TOKEN;
if (!TOKEN) {
  console.error('Set SCANNER_TEST_TOKEN.');
  process.exit(1);
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

const TEST_ORG_NAME = 'Scanner Live Test Corp';
const TEST_DOMAIN = 'scannerlivetest.org';
const TEST_CVE_NUMBER = 'CVE-2020-8203-LIVE';

async function run() {
  const { sub: userId, email } = decodeJwtPayload(TOKEN);
  console.log(`Running as ${email} (${userId})`);

  const seed = await pgPool.connect();
  let orgId, repositoryId, dependencyId, originalOrgId;
  try {
    await seed.query('BEGIN');
    const userRow = await seed.query('SELECT organization_id FROM public.users WHERE user_id = $1', [userId]);
    originalOrgId = userRow.rows[0].organization_id;

    orgId = (await seed.query(
      `INSERT INTO organizations (organization_name, domain) VALUES ($1,$2) RETURNING organization_id`,
      [TEST_ORG_NAME, TEST_DOMAIN]
    )).rows[0].organization_id;

    await seed.query(`UPDATE public.users SET organization_id = $1 WHERE user_id = $2`, [orgId, userId]);

    const projectId = (await seed.query(
      `INSERT INTO projects (organization_id, project_name, created_by) VALUES ($1,$2,$3) RETURNING project_id`,
      [orgId, 'Scanner-Live-Project-1', userId]
    )).rows[0].project_id;

    repositoryId = (await seed.query(
      `INSERT INTO repositories (project_id, repo_name, default_branch, language, last_synced_at)
       VALUES ($1,'vulnerable-app-live','main','JavaScript',NOW()) RETURNING repository_id`,
      [projectId]
    )).rows[0].repository_id;

    dependencyId = (await seed.query(
      `INSERT INTO dependencies (repository_id, package_name, current_version, latest_version, is_deprecated)
       VALUES ($1,'lodash','4.17.15','4.17.21',false) RETURNING dependency_id`,
      [repositoryId]
    )).rows[0].dependency_id;

    await seed.query(
      `INSERT INTO cves (cve_number, severity, cvss_score, description, published_date)
       VALUES ($1,'HIGH',7.4,'Prototype pollution vulnerability in lodash before 4.17.21.','2020-07-15')
       ON CONFLICT (cve_number) DO NOTHING`,
      [TEST_CVE_NUMBER]
    );
    await seed.query('COMMIT');
    console.log('Seed OK.');
  } catch (e) {
    await seed.query('ROLLBACK');
    console.error('Seed failed:', e.message);
    process.exit(1);
  } finally {
    seed.release();
  }

  const headers = { headers: { Authorization: `Bearer ${TOKEN}` } };
  let pass = 0, fail = 0;
  const check = (name, cond, detail) => {
    if (cond) { console.log(`PASS ${name}`); pass++; }
    else { console.log(`FAIL ${name} ${detail || ''}`); fail++; }
  };

  try {
    const t0 = Date.now();
    const scan = await axios.post(`${API_URL}/api/v1/scanner/scan`, { repository_id: repositoryId }, headers);
    const elapsedMs = Date.now() - t0;
    check('Scan succeeds', scan.status === 200 && scan.data.success, JSON.stringify(scan.data));
    check('Scan is fast (batched, < 10s)', elapsedMs < 10000, `took ${elapsedMs}ms`);
    console.log(`   matchesEvaluated=${scan.data.data.matchesEvaluated}, newAlertsRaised=${scan.data.data.newAlertsRaised}, elapsed=${elapsedMs}ms`);

    // Rescan should raise 0 new alerts (idempotency check).
    const rescan = await axios.post(`${API_URL}/api/v1/scanner/scan`, { repository_id: repositoryId }, headers);
    check('Rescan raises 0 new alerts (no duplicates)', rescan.data.data.newAlertsRaised === 0, JSON.stringify(rescan.data));

    const alertsRes = await axios.get(`${API_URL}/api/v1/scanner/alerts?repository_id=${repositoryId}`, headers);
    check(
      'Alert count matches matchesEvaluated exactly',
      alertsRes.data.data.length === scan.data.data.matchesEvaluated,
      `alerts=${alertsRes.data.data.length}, expected=${scan.data.data.matchesEvaluated}`
    );
  } catch (e) {
    console.log('FAIL unexpected error:', e.response ? JSON.stringify(e.response.data) : e.message);
    fail++;
  }

  // Defensive cleanup — each statement isolated so one failure doesn't block the rest,
  // and the org restoration always runs regardless of what else fails.
  console.log('Cleaning up...');
  const cleanupSteps = [
    ['security_alerts', () => pgPool.query('DELETE FROM security_alerts WHERE repository_id = $1', [repositoryId])],
    ['dependency_vulnerabilities', () => pgPool.query('DELETE FROM dependency_vulnerabilities WHERE dependency_id = $1', [dependencyId])],
    ['dependencies', () => pgPool.query('DELETE FROM dependencies WHERE repository_id = $1', [repositoryId])],
    ['cves', () => pgPool.query('DELETE FROM cves WHERE cve_number = $1', [TEST_CVE_NUMBER])],
    ['repositories', () => pgPool.query('DELETE FROM repositories WHERE repository_id = $1', [repositoryId])],
    ['projects', () => pgPool.query('DELETE FROM projects WHERE organization_id = $1', [orgId])],
    ['restore user org', () => pgPool.query('UPDATE public.users SET organization_id = $1 WHERE user_id = $2', [originalOrgId, userId])],
    ['organizations', () => pgPool.query('DELETE FROM organizations WHERE organization_id = $1', [orgId])]
  ];
  for (const [name, fn] of cleanupSteps) {
    try {
      await fn();
    } catch (e) {
      console.error(`  cleanup step "${name}" failed: ${e.message}`);
    }
  }
  console.log('Cleanup done.');

  console.log(`\nSummary: ${pass} passed, ${fail} failed.`);
  await pgPool.end();
  process.exit(fail > 0 ? 1 : 0);
}

run();
