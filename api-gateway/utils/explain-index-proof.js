// Phase 5 deliverable: demonstrate the query-plan/performance difference an
// index makes on `dependencies.package_name`, per phases/Phase_05.md section 4.
//
// With only a handful of rows the planner will pick a Seq Scan regardless of
// whether the index exists — there's nothing for an index to save on a table
// that small. So this script first bulk-loads a realistic volume of sample
// dependency rows (via COPY, same mechanism as seed-cves.js), then runs
// EXPLAIN ANALYZE on the same query with the index absent and then present,
// so the before/after difference is real and visible in the output.

const fs = require('fs');
const path = require('path');
const { pgPool } = require('../config/db.config');
const { from: copyFrom } = require('pg-copy-streams');

const CSV_PATH = path.join(__dirname, 'dependencies_sample.csv');
// `dependencies` has a UNIQUE (repository_id, package_name, package_manager)
// constraint, so every generated row needs a distinct name — we pick one of
// the generated names up front as the EXPLAIN ANALYZE lookup target instead
// of inserting a duplicate 'react' row that would violate the constraint.
const TARGET_INDEX = 25000;
const TARGET_PACKAGE = `pkg-${String(TARGET_INDEX).padStart(6, '0')}`;

function csvField(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function generateSampleDeps(repositoryId, count) {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      repositoryId,
      packageName: `pkg-${String(i).padStart(6, '0')}`,
      currentVersion: `${(i % 9) + 1}.${i % 20}.${i % 10}`
    });
  }
  return rows;
}

function writeCsv(rows) {
  const header = 'repository_id,package_name,current_version';
  const lines = rows.map((r) =>
    [r.repositoryId, csvField(r.packageName), r.currentVersion].join(',')
  );
  fs.writeFileSync(CSV_PATH, [header, ...lines].join('\n') + '\n', 'utf8');
  return CSV_PATH;
}

function copyCsvIntoDependencies(client, csvPath) {
  return new Promise((resolve, reject) => {
    const stream = client.query(
      copyFrom(`COPY dependencies (repository_id, package_name, current_version)
                 FROM STDIN WITH (FORMAT csv, HEADER true)`)
    );
    const fileStream = fs.createReadStream(csvPath);
    fileStream.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
    fileStream.pipe(stream);
  });
}

async function explain(client, label) {
  const result = await client.query(
    `EXPLAIN ANALYZE SELECT * FROM dependencies WHERE package_name = $1`,
    [TARGET_PACKAGE]
  );
  const plan = result.rows.map((r) => r['QUERY PLAN']).join('\n');
  console.log(`\n--- ${label} ---`);
  console.log(plan);
  return plan;
}

async function run() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ This script inserts bulk sample data and is rejected in production.');
    process.exitCode = 1;
    return;
  }

  if (process.env.SEED_OPT_IN !== 'true' && !process.argv.includes('--seed-opt-in')) {
    console.error('❌ Explicit seed opt-in is required! Please set SEED_OPT_IN=true or pass --seed-opt-in.');
    process.exitCode = 1;
    return;
  }

  const client = await pgPool.connect();
  try {
    const repoRes = await client.query('SELECT repository_id FROM repositories ORDER BY repository_id LIMIT 1');
    if (repoRes.rows.length === 0) {
      console.error('❌ No repositories found — sync at least one repo before running this script.');
      process.exitCode = 1;
      return;
    }
    const repositoryId = repoRes.rows[0].repository_id;

    const countRes = await client.query('SELECT COUNT(*) FROM dependencies');
    const existing = Number(countRes.rows[0].count);
    const targetCount = Math.max(Number(process.env.SEED_DEP_COUNT) || 50000, TARGET_INDEX);

    if (existing < targetCount) {
      console.log(`📄 Generating ${targetCount} sample dependency rows for repository_id=${repositoryId}...`);
      const rows = generateSampleDeps(repositoryId, targetCount);
      writeCsv(rows);

      console.log('🚀 Bulk-loading sample dependencies via COPY...');
      await client.query('BEGIN');
      await copyCsvIntoDependencies(client, CSV_PATH);
      await client.query('COMMIT');
    } else {
      console.log(`ℹ️ dependencies already has ${existing} rows — skipping bulk load.`);
    }

    console.log('🧹 Dropping idx_dependencies_package (if present) to establish the baseline...');
    await client.query('DROP INDEX IF EXISTS idx_dependencies_package');
    await client.query('ANALYZE dependencies');

    // The table's own UNIQUE (repository_id, package_name, ...) constraint backs
    // an index too, and Postgres may still pick it for a package_name-only filter
    // even without idx_dependencies_package — which would show "Index Scan" on
    // both sides and hide the point of this demo. Forcing scans/bitmap plans off
    // for the "before" run isolates exactly what a package_name lookup costs with
    // no usable index at all, which is the real baseline this index is compared
    // against in phases/Phase_05.md.
    await client.query('SET enable_indexscan = off');
    await client.query('SET enable_bitmapscan = off');
    const before = await explain(client, `BEFORE INDEX — WHERE package_name = '${TARGET_PACKAGE}'`);
    await client.query('RESET enable_indexscan');
    await client.query('RESET enable_bitmapscan');

    console.log('\n⚡ Creating idx_dependencies_package...');
    await client.query('CREATE INDEX idx_dependencies_package ON dependencies(package_name)');
    await client.query('ANALYZE dependencies');
    const after = await explain(client, `AFTER INDEX — WHERE package_name = '${TARGET_PACKAGE}'`);

    console.log('\n📊 Summary:');
    console.log('  Before:', /Seq Scan/.test(before) ? 'Seq Scan (full table read)' : 'not a Seq Scan — unexpected');
    console.log('  After: ', /Index Scan|Bitmap/.test(after) ? 'Index Scan / Bitmap Heap Scan (index used)' : 'not using the index — unexpected');
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
