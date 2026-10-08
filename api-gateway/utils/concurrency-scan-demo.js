// Phase 6 deliverable: prove that two security scans fired at the same
// repository at (as close as JS can manage to) the same instant are
// serialized by the SELECT ... FOR UPDATE row lock in scanner.controller.js,
// rather than racing each other and — worst case — producing duplicate
// dependency_vulnerabilities/security_alerts rows under Read Committed.
//
// This talks to Postgres directly (two separate pool clients standing in for
// two separate concurrent HTTP requests) rather than going over HTTP, so it
// doesn't need a live JWT — the thing being demonstrated is a database-level
// guarantee, not the auth layer.

const { pgPool } = require('../config/db.config');
const { performScan } = require('../services/scanner.service');

async function lockedScan(label, repositoryId, timeline) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    timeline.push(`${label}: requesting row lock at ${Date.now()}`);
    const lockStart = Date.now();
    await client.query('SELECT repository_id FROM repositories WHERE repository_id = $1 FOR UPDATE', [
      repositoryId
    ]);
    timeline.push(`${label}: acquired lock after ${Date.now() - lockStart}ms (blocked if > ~0ms)`);

    const result = await performScan(client, repositoryId);
    timeline.push(`${label}: scan done — ${result.totalMatches} matches, ${result.newAlerts.length} new alerts`);

    await client.query('COMMIT');
    timeline.push(`${label}: committed at ${Date.now()}`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    timeline.push(`${label}: rolled back — ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  const client = await pgPool.connect();
  let repositoryId;
  try {
    const repoRes = await client.query('SELECT repository_id FROM repositories ORDER BY repository_id LIMIT 1');
    if (repoRes.rows.length === 0) {
      console.error('❌ No repositories found — sync at least one repo before running this demo.');
      process.exitCode = 1;
      return;
    }
    repositoryId = repoRes.rows[0].repository_id;
  } finally {
    client.release();
  }

  console.log(`🔒 Firing two concurrent scans at repository_id=${repositoryId}...\n`);

  const timeline = [];
  // Promise.all starts both requests in the same tick — as close to "the exact
  // same millisecond" as Node can get without literal thread-level parallelism.
  const [resultA, resultB] = await Promise.all([
    lockedScan('Transaction A', repositoryId, timeline),
    lockedScan('Transaction B', repositoryId, timeline)
  ]);

  console.log(timeline.join('\n'));

  console.log('\n📊 Result:');
  console.log('  Transaction A:', resultA.totalMatches, 'matches,', resultA.newAlerts.length, 'new alerts');
  console.log('  Transaction B:', resultB.totalMatches, 'matches,', resultB.newAlerts.length, 'new alerts');
  console.log(
    '  Combined new alerts:',
    resultA.newAlerts.length + resultB.newAlerts.length,
    '— exactly one transaction should report new alerts; the other (running after the first',
    'committed) should find everything already present and report 0 new alerts.'
  );

  await pgPool.end();
}

run();
