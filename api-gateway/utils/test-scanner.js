const { pgPool } = require('../config/db.config');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

/**
 * Phase 6 verification: proves the Security Scanner engine
 *   1) correctly correlates dependencies against CVEs via SQL JOIN,
 *   2) populates the dependency_vulnerabilities junction table,
 *   3) and that firing two identical
 *      scan requests at the exact same repository simultaneously does NOT
 *      produce duplicate alerts, because SELECT ... FOR UPDATE serializes
 *      the two transactions on the repository row.
 */

const API_URL = 'http://localhost:4000';
const rawSecret = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-key-for-local-testing-purposes-only-123';
const JWT_SECRET = rawSecret.length > 32 ? Buffer.from(rawSecret, 'base64') : rawSecret;

const TEST_USER_ID = 'c7a1e3f4-9b2d-4e6a-8f3c-1a2b3c4d5e6f';
const TEST_ORG_NAME = 'Scanner Test Corp';
const TEST_DOMAIN = 'scannertest.org';
const TEST_PROJECT_NAME = 'Scanner-Project-1';
const TEST_REPO_NAME = 'vulnerable-app';
const TEST_CVE_NUMBER = 'CVE-2020-8203';

let passedCount = 0;
let failedCount = 0;

function assert(name, condition, detail) {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passedCount++;
  } else {
    console.log(`❌ [FAIL] ${name}${detail ? ` - ${detail}` : ''}`);
    failedCount++;
  }
}

async function run() {
  console.log('🧪 Starting Phase 6 Security Scanner verification...');

  const seedClient = await pgPool.connect();
  let orgId, repositoryId, dependencyId;

  try {
    await seedClient.query('BEGIN');

    const orgRes = await seedClient.query(
      `INSERT INTO organizations (organization_name, domain) VALUES ($1, $2) RETURNING organization_id`,
      [TEST_ORG_NAME, TEST_DOMAIN]
    );
    orgId = orgRes.rows[0].organization_id;

    await seedClient.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, 'scanneruser@example.com', JSON.stringify({ full_name: 'Scanner Tester' })]
    );
    await seedClient.query(`UPDATE public.users SET organization_id = $1 WHERE user_id = $2`, [orgId, TEST_USER_ID]);

    const projectRes = await seedClient.query(
      `INSERT INTO projects (organization_id, project_name, created_by) VALUES ($1, $2, $3) RETURNING project_id`,
      [orgId, TEST_PROJECT_NAME, TEST_USER_ID]
    );

    const repoRes = await seedClient.query(
      `INSERT INTO repositories (project_id, repo_name, default_branch, language, last_synced_at)
       VALUES ($1, $2, 'main', 'JavaScript', NOW()) RETURNING repository_id`,
      [projectRes.rows[0].project_id, TEST_REPO_NAME]
    );
    repositoryId = repoRes.rows[0].repository_id;

    const depRes = await seedClient.query(
      `INSERT INTO dependencies (repository_id, package_name, current_version, latest_version, is_deprecated)
       VALUES ($1, 'lodash', '4.17.15', '4.17.21', false) RETURNING dependency_id`,
      [repositoryId]
    );
    dependencyId = depRes.rows[0].dependency_id;

    // CVE description deliberately contains the package name so the
    // scanner's ILIKE join in scanner.controller.js matches it.
    await seedClient.query(
      `INSERT INTO cves (cve_number, severity, cvss_score, description, published_date)
       VALUES ($1, 'HIGH', 7.4, 'Prototype pollution vulnerability in lodash before 4.17.21 allows attackers to add arbitrary properties.', '2020-07-15')
       ON CONFLICT (cve_number) DO NOTHING`,
      [TEST_CVE_NUMBER]
    );

    await seedClient.query('COMMIT');
    console.log('✅ Seed data created (org, user, repo, dependency, CVE).');
  } catch (error) {
    await seedClient.query('ROLLBACK');
    console.error('❌ Failed to seed environment:', error.message);
    process.exit(1);
  } finally {
    seedClient.release();
  }

  const token = jwt.sign({ sub: TEST_USER_ID, email: 'scanneruser@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  try {
    // --- Test 1: Basic scan finds the match ---
    const firstScan = await axios.post(`${API_URL}/api/v1/scanner/scan`, { repository_id: repositoryId }, authHeaders);
    assert(
      'First scan finds the seeded CVE match',
      firstScan.status === 200 && firstScan.data.data.matchesEvaluated === 1 && firstScan.data.data.newAlertsRaised === 1,
      JSON.stringify(firstScan.data)
    );

    // Reset the junction/alert rows so the concurrency test below starts clean.
    const resetClient = await pgPool.connect();
    try {
      await resetClient.query('DELETE FROM security_alerts WHERE repository_id = $1', [repositoryId]);
      await resetClient.query('DELETE FROM dependency_vulnerabilities WHERE dependency_id = $1', [dependencyId]);
    } finally {
      resetClient.release();
    }

    // --- Test 2: Concurrent scan test — fire two identical scans simultaneously ---
    console.log('⚡ Firing two concurrent scan requests at the same repository...');
    const [scanA, scanB] = await Promise.all([
      axios.post(`${API_URL}/api/v1/scanner/scan`, { repository_id: repositoryId }, authHeaders),
      axios.post(`${API_URL}/api/v1/scanner/scan`, { repository_id: repositoryId }, authHeaders)
    ]);

    const totalNewAlerts = scanA.data.data.newAlertsRaised + scanB.data.data.newAlertsRaised;
    assert(
      'Concurrent scans: exactly one call raised the new alert (no duplicate)',
      totalNewAlerts === 1,
      `scanA.newAlertsRaised=${scanA.data.data.newAlertsRaised}, scanB.newAlertsRaised=${scanB.data.data.newAlertsRaised}`
    );

    const verifyClient = await pgPool.connect();
    let alertCount, junctionCount;
    try {
      const alertRes = await verifyClient.query(
        'SELECT count(*) FROM security_alerts WHERE repository_id = $1 AND dependency_id = $2',
        [repositoryId, dependencyId]
      );
      alertCount = parseInt(alertRes.rows[0].count, 10);

      const junctionRes = await verifyClient.query(
        'SELECT count(*) FROM dependency_vulnerabilities WHERE dependency_id = $1',
        [dependencyId]
      );
      junctionCount = parseInt(junctionRes.rows[0].count, 10);
    } finally {
      verifyClient.release();
    }

    assert('Exactly one security_alerts row exists after the race', alertCount === 1, `found ${alertCount}`);
    assert('Exactly one dependency_vulnerabilities row exists (junction UNIQUE held)', junctionCount === 1, `found ${junctionCount}`);

    // --- Test 3: GET /alerts returns the alert, scoped to this repo ---
    const alertsRes = await axios.get(`${API_URL}/api/v1/scanner/alerts?repository_id=${repositoryId}`, authHeaders);
    assert(
      'GET /alerts returns the raised alert',
      alertsRes.status === 200 && alertsRes.data.data.length === 1 && alertsRes.data.data[0].package_name === 'lodash',
      JSON.stringify(alertsRes.data)
    );

    // --- Test 4: PATCH /alerts/:id/resolve ---
    const alertId = alertsRes.data.data[0].alert_id;
    const resolveRes = await axios.patch(`${API_URL}/api/v1/scanner/alerts/${alertId}/resolve`, {}, authHeaders);
    assert(
      'PATCH /alerts/:id/resolve marks the alert resolved',
      resolveRes.status === 200 && resolveRes.data.data.status === 'resolved',
      JSON.stringify(resolveRes.data)
    );
  } catch (error) {
    console.log('❌ [FAIL] Unexpected error during scan tests:', error.response ? JSON.stringify(error.response.data) : error.message);
    failedCount++;
  }

  // --- Cleanup ---
  console.log('🧹 Cleaning up test database...');
  const cleanupClient = await pgPool.connect();
  try {
    await cleanupClient.query('BEGIN');
    await cleanupClient.query('DELETE FROM security_alerts WHERE repository_id = $1', [repositoryId]);
    await cleanupClient.query('DELETE FROM dependency_vulnerabilities WHERE dependency_id = $1', [dependencyId]);
    await cleanupClient.query('DELETE FROM dependencies WHERE repository_id = $1', [repositoryId]);
    await cleanupClient.query('DELETE FROM cves WHERE cve_number = $1', [TEST_CVE_NUMBER]);
    await cleanupClient.query('DELETE FROM repositories WHERE repository_id = $1', [repositoryId]);
    await cleanupClient.query('DELETE FROM projects WHERE organization_id = $1', [orgId]);
    await cleanupClient.query('DELETE FROM auth.users WHERE id = $1', [TEST_USER_ID]);
    await cleanupClient.query('DELETE FROM public.users WHERE user_id = $1', [TEST_USER_ID]);
    await cleanupClient.query('DELETE FROM public.organizations WHERE organization_id = $1', [orgId]);
    await cleanupClient.query('COMMIT');
    console.log('✅ Cleanup complete.');
  } catch (err) {
    await cleanupClient.query('ROLLBACK');
    console.error('⚠️ Cleanup failed:', err.message);
  } finally {
    cleanupClient.release();
    await pgPool.end();
  }

  console.log(`\n📊 Verification Summary: ${passedCount} passed, ${failedCount} failed.`);
  if (failedCount > 0) {
    console.error('❌ Phase 6 Security Scanner verification failed!');
    process.exit(1);
  } else {
    console.log('🎉 Phase 6 Security Scanner verification completed successfully!');
    process.exit(0);
  }
}

run();
