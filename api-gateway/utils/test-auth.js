const { pgPool } = require('../config/db.config');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:4000';
const rawSecret = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-key-for-local-testing-purposes-only-123';
const JWT_SECRET = rawSecret.length > 32 ? Buffer.from(rawSecret, 'base64') : rawSecret;

const DEV_ID = 'e8a93da2-564a-4a51-87ab-8de1b32bb9a9';
const ADMIN_ID = 'a7c8b0d4-1a2b-3c4d-5e6f-7a8b9c0d1e2f';

async function runTests() {
  console.log('🧪 Starting Phase 2 Auth & RBAC Verification Tests...');

  // 1. Set up test users in local database using auth triggers
  console.log('👤 Seeding test users into auth schema...');
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    
    // Clear any previous test entries
    await client.query('DELETE FROM auth.users WHERE id IN ($1, $2)', [DEV_ID, ADMIN_ID]);
    await client.query('DELETE FROM public.users WHERE user_id IN ($1, $2)', [DEV_ID, ADMIN_ID]);

    // Insert developer into auth.users (trigger handles public.users sync)
    await client.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, $3)`,
      [DEV_ID, 'developer@example.com', JSON.stringify({ full_name: 'Jane Developer' })]
    );

    // Insert admin into auth.users (trigger handles sync, then manually upgrade role to admin)
    await client.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, $3)`,
      [ADMIN_ID, 'admin@example.com', JSON.stringify({ full_name: 'Arthur Admin' })]
    );
    await client.query(
      `UPDATE public.users SET role = 'admin' WHERE user_id = $1`,
      [ADMIN_ID]
    );

    await client.query('COMMIT');
    console.log('✅ Test users seeded and synchronized successfully via triggers!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed test users:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // 2. Generate signed JWTs
  const devToken = jwt.sign({ sub: DEV_ID, email: 'developer@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  const adminToken = jwt.sign({ sub: ADMIN_ID, email: 'admin@example.com' }, JWT_SECRET, { expiresIn: '1h' });

  // 3. Perform HTTP requests using Axios
  let passedCount = 0;
  let failedCount = 0;

  async function assertRequest(name, requestFn, expectedStatus, checkFn = () => true) {
    try {
      const response = await requestFn();
      if (response.status === expectedStatus && checkFn(response.data)) {
        console.log(`✅ [PASS] ${name} - Status: ${response.status}`);
        passedCount++;
      } else {
        console.log(`❌ [FAIL] ${name} - Expected: ${expectedStatus}, Got: ${response.status}`);
        failedCount++;
      }
    } catch (error) {
      const status = error.response ? error.response.status : 'NO_RESPONSE';
      if (status === expectedStatus && checkFn(error.response ? error.response.data : {})) {
        console.log(`✅ [PASS] ${name} - Status: ${status} (Expected error matched)`);
        passedCount++;
      } else {
        console.log(`❌ [FAIL] ${name} - Expected: ${expectedStatus}, Got: ${status}. Error message: ${error.message}`);
        failedCount++;
      }
    }
  }

  // Test 1: Access protected user profile without token
  await assertRequest(
    'GET /api/v1/users/me (No token)',
    () => axios.get(`${API_URL}/api/v1/users/me`),
    401
  );

  // Test 2: Access user profile with developer token
  await assertRequest(
    'GET /api/v1/users/me (Developer JWT)',
    () => axios.get(`${API_URL}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${devToken}` }
    }),
    200,
    (data) => data.success === true && data.data.role === 'developer' && data.data.full_name === 'Jane Developer'
  );

  // Test 3: Create organization with developer token (RBAC check)
  await assertRequest(
    'POST /api/v1/orgs (Developer JWT - Forbidden)',
    () => axios.post(
      `${API_URL}/api/v1/orgs`,
      { org_name: 'Hacker Corp', domain: 'hacker.org' },
      { headers: { Authorization: `Bearer ${devToken}` } }
    ),
    403
  );

  // Test 4: Create organization with admin token (RBAC check)
  let testOrgId;
  await assertRequest(
    'POST /api/v1/orgs (Admin JWT - Authorized)',
    () => axios.post(
      `${API_URL}/api/v1/orgs`,
      { org_name: 'Enterprise Inc', domain: 'enterprise.com' },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    ),
    201,
    (data) => {
      if (data.success && data.data.organization_id) {
        testOrgId = data.data.organization_id;
        return true;
      }
      return false;
    }
  );

  // Test 5: Handle unique constraint violation on duplicate domain
  await assertRequest(
    'POST /api/v1/orgs (Admin JWT - Duplicate domain)',
    () => axios.post(
      `${API_URL}/api/v1/orgs`,
      { org_name: 'Duplicate Inc', domain: 'enterprise.com' },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    ),
    400
  );

  // Clean up database entries
  console.log('🧹 Cleaning up test users and organizations...');
  const cleanupClient = await pgPool.connect();
  try {
    await cleanupClient.query('BEGIN');
    if (testOrgId) {
      await cleanupClient.query('DELETE FROM public.organizations WHERE organization_id = $1', [testOrgId]);
    }
    await cleanupClient.query('DELETE FROM auth.users WHERE id IN ($1, $2)', [DEV_ID, ADMIN_ID]);
    await cleanupClient.query('DELETE FROM public.users WHERE user_id IN ($1, $2)', [DEV_ID, ADMIN_ID]);
    await cleanupClient.query('COMMIT');
    console.log('✅ Database cleaned.');
  } catch (error) {
    await cleanupClient.query('ROLLBACK');
    console.error('⚠️ Cleanup failed:', error.message);
  } finally {
    cleanupClient.release();
    await pgPool.end();
  }

  // Report final results
  console.log(`\n📊 Verification Summary: ${passedCount} passed, ${failedCount} failed.`);
  if (failedCount > 0) {
    console.error('❌ Phase 2 Auth & RBAC verification failed!');
    process.exit(1);
  } else {
    console.log('🎉 Phase 2 Auth & RBAC verification completed successfully!');
    process.exit(0);
  }
}

// Give Nodemon a second to reload if the test script starts immediately
setTimeout(runTests, 1500);
