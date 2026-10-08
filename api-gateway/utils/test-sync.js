const { pgPool } = require('../config/db.config');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config();

const API_URL = 'http://localhost:4000';
const rawSecret = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-key-for-local-testing-purposes-only-123';
const JWT_SECRET = rawSecret.length > 32 ? Buffer.from(rawSecret, 'base64') : rawSecret;

const TEST_USER_ID = 'b3d92da2-564a-4a51-87ab-8de1b32bb9a9';
const TEST_ORG_NAME = 'Sync Test Corp';
const TEST_DOMAIN = 'synctest.org';
const TEST_PROJECT_NAME = 'Sync-Project-1';

async function runTests() {
  console.log('🧪 Starting Phase 3 GitHub Repository Sync Verification Tests...');

  // 1. Redeploy Schema to ensure the new UNIQUE constraint is applied
  console.log('🔄 Re-deploying database schema with new UNIQUE constraint...');
  try {
    execSync('node utils/init-db.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
    console.log('✅ Database schema redeployed successfully!');
  } catch (error) {
    console.error('❌ Failed to redeploy schema:', error.message);
    process.exit(1);
  }

  // 2. Seed Test Organization and User
  console.log('👤 Seeding test organization and user...');
  const client = await pgPool.connect();
  let orgId;
  try {
    await client.query('BEGIN');
    
    const orgRes = await client.query(
      `INSERT INTO organizations (organization_name, domain)
       VALUES ($1, $2) RETURNING organization_id`,
      [TEST_ORG_NAME, TEST_DOMAIN]
    );
    orgId = orgRes.rows[0].organization_id;

    // Trigger sync test
    await client.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, $3)`,
      [TEST_USER_ID, 'syncuser@example.com', JSON.stringify({ full_name: 'Sync Tester' })]
    );

    // Bind user to org
    await client.query(
      `UPDATE public.users SET organization_id = $1 WHERE user_id = $2`,
      [orgId, TEST_USER_ID]
    );

    await client.query('COMMIT');
    console.log('✅ Seeding complete!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed environment:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }

  const token = jwt.sign({ sub: TEST_USER_ID, email: 'syncuser@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  let passedCount = 0;
  let failedCount = 0;

  async function assertTest(name, actionFn, checkFn) {
    try {
      const response = await actionFn();
      if (checkFn(response)) {
        console.log(`✅ [PASS] ${name}`);
        passedCount++;
      } else {
        console.log(`❌ [FAIL] ${name} (Custom check assertion failed)`);
        failedCount++;
      }
    } catch (error) {
      console.log(`❌ [FAIL] ${name} - Error: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
      failedCount++;
    }
  }

  // Test 1: First sync operation (inserts project and repos)
  const reposPayload = [
    { name: 'app-frontend', default_branch: 'main', language: 'TypeScript' },
    { name: 'api-service', default_branch: 'develop', language: 'JavaScript' }
  ];

  await assertTest(
    'Sync Repositories - First Ingestion',
    () => axios.post(
      `${API_URL}/api/v1/repos/sync`,
      { org_id: orgId, project_name: TEST_PROJECT_NAME, repos: reposPayload },
      authHeaders
    ),
    (res) => {
      return res.status === 200 && res.data.success && res.data.data.repositories.length === 2;
    }
  );

  // Test 2: Verify database records exist
  const verifyClient = await pgPool.connect();
  try {
    const projectRes = await verifyClient.query('SELECT * FROM projects WHERE organization_id = $1', [orgId]);
    const reposRes = await verifyClient.query('SELECT * FROM repositories WHERE project_id = $1', [projectRes.rows[0].project_id]);
    
    if (projectRes.rows.length === 1 && reposRes.rows.length === 2) {
      console.log('✅ [PASS] Verify records exist in database');
      passedCount++;
    } else {
      console.log('❌ [FAIL] Verify records exist in database - Count mismatch');
      failedCount++;
    }
  } catch (error) {
    console.log('❌ [FAIL] Verify database records - Query error:', error.message);
    failedCount++;
  } finally {
    verifyClient.release();
  }

  // Test 3: Duplicate Sync (Upsert verification)
  // Modify default branch and language of one repo to test update
  const duplicatePayload = [
    { name: 'app-frontend', default_branch: 'prod', language: 'React' }, 
    { name: 'api-service', default_branch: 'develop', language: 'JavaScript' }
  ];

  await assertTest(
    'Sync Repositories - Duplicate Ingestion (Upsert Check)',
    () => axios.post(
      `${API_URL}/api/v1/repos/sync`,
      { org_id: orgId, project_name: TEST_PROJECT_NAME, repos: duplicatePayload },
      authHeaders
    ),
    async (res) => {
      if (res.status !== 200 || !res.data.success) return false;
      
      // Query db to check if app-frontend was updated and NOT duplicated
      const checkClient = await pgPool.connect();
      try {
        const checkRes = await checkClient.query(
          `SELECT count(*), 
                  max(CASE WHEN repo_name = 'app-frontend' THEN default_branch END) as branch,
                  max(CASE WHEN repo_name = 'app-frontend' THEN language END) as lang
           FROM repositories r
           JOIN projects p ON r.project_id = p.project_id
           WHERE p.organization_id = $1`,
          [orgId]
        );
        const count = parseInt(checkRes.rows[0].count);
        const branch = checkRes.rows[0].branch;
        const lang = checkRes.rows[0].lang;
        return count === 2 && branch === 'prod' && lang === 'React';
      } finally {
        checkClient.release();
      }
    }
  );

  // Test 4: Atomicity Rollback Test (Forcing insert error to test rollback)
  const failedPayload = [
    { name: 'valid-repo-1', default_branch: 'main' },
    { name: 'failed-repo-2', force_rollback_error: true } // Triggers forced error in syncRepositories
  ];

  try {
    await axios.post(
      `${API_URL}/api/v1/repos/sync`,
      { org_id: orgId, project_name: 'Rollback-Project', repos: failedPayload },
      authHeaders
    );
    console.log('❌ [FAIL] Atomicity Rollback (Failed to throw error)');
    failedCount++;
  } catch (error) {
    if (error.response && error.response.status === 500) {
      // Query database to ensure 'Rollback-Project' was NOT created
      const checkClient = await pgPool.connect();
      try {
        const checkRes = await checkClient.query("SELECT * FROM projects WHERE project_name = 'Rollback-Project'");
        if (checkRes.rows.length === 0) {
          console.log('✅ [PASS] Atomicity Rollback - Project rolled back and NOT committed');
          passedCount++;
        } else {
          console.log('❌ [FAIL] Atomicity Rollback - Project was found in database');
          failedCount++;
        }
      } finally {
        checkClient.release();
      }
    } else {
      console.log('❌ [FAIL] Atomicity Rollback - Expected status 500, got:', error.message);
      failedCount++;
    }
  }

  // Test 5: Query/List repositories via GET
  await assertTest(
    'GET /api/v1/repos (Fetch synced list)',
    () => axios.get(`${API_URL}/api/v1/repos`, authHeaders),
    (res) => {
      return res.status === 200 && res.data.success && res.data.data.length === 2 && res.data.data[0].project_name === TEST_PROJECT_NAME;
    }
  );

  // Final database cleanup
  console.log('🧹 Cleaning up test database...');
  const cleanupClient = await pgPool.connect();
  try {
    await cleanupClient.query('BEGIN');
    await cleanupClient.query('DELETE FROM public.repositories WHERE project_id IN (SELECT project_id FROM public.projects WHERE organization_id = $1)', [orgId]);
    await cleanupClient.query('DELETE FROM public.projects WHERE organization_id = $1', [orgId]);
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
    console.error('❌ Phase 3 GitHub Repository Sync verification failed!');
    process.exit(1);
  } else {
    console.log('🎉 Phase 3 GitHub Repository Sync verification completed successfully!');
    process.exit(0);
  }
}

// Give gateway nodemon server 1.5 seconds to restart
setTimeout(runTests, 1500);
