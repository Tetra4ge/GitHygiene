// Phase 5 deliverable: bulk-load the `cves` table using PostgreSQL's COPY
// protocol instead of batched INSERTs. COPY streams rows directly into the
// table's storage, skipping the per-statement parse/plan/execute overhead of
// INSERT — the standard way to load large datasets in Postgres, and the
// mechanism phases/Phase_05.md explicitly asks this script to demonstrate.
//
// Note: the dataset itself is synthetically generated (see generateMockCVEs),
// not downloaded from the real NVD database — this project doesn't ship a
// network fetch step, so treat the CVE numbers/descriptions as realistic
// sample data for exercising the schema and bulk-load path, not real records.

const fs = require('fs');
const path = require('path');
const { pgPool } = require('../config/db.config');
const { from: copyFrom } = require('pg-copy-streams');

const PACKAGES = [
  'lodash', 'express', 'react', 'react-dom', 'axios',
  'cors', 'morgan', 'nodemon', 'pg', 'neo4j-driver',
  'redis', 'uuid', 'moment', 'jsonwebtoken', 'helmet'
];

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

const CSV_PATH = path.join(__dirname, 'cves_sample.csv');

function generateMockCVEs(count) {
  const cves = [];
  const startYear = 2020;

  for (let i = 1; i <= count; i++) {
    const year = startYear + (i % 6); // Years 2020 to 2025
    const idNum = String(1000 + i);
    const cveNumber = `CVE-${year}-${idNum}`;

    const pkg = PACKAGES[i % PACKAGES.length];
    const severity = SEVERITIES[i % SEVERITIES.length];

    let cvssScore = 3.5;
    if (severity === 'MODERATE') cvssScore = 5.8;
    else if (severity === 'HIGH') cvssScore = 7.8;
    else if (severity === 'CRITICAL') cvssScore = 9.8;

    cvssScore = Math.min(10, Math.max(1, cvssScore + ((i % 10) - 5) * 0.1)).toFixed(1);

    const description = `Vulnerability in package '${pkg}' leads to prototype pollution, cross-site scripting (XSS), or remote execution issues when processing untrusted inputs. Affected versions before v${i % 10}.0.0.`;

    const day = (i % 28) + 1;
    const month = (i % 12) + 1;
    const publishedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    cves.push({ cveNumber, severity, cvssScore, description, publishedDate });
  }
  return cves;
}

// Minimal CSV field escaper — wraps in quotes and doubles any embedded quotes,
// which is all `description` (the only field with commas/quotes) ever needs.
function csvField(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(cves) {
  const header = 'cve_number,severity,cvss_score,description,published_date';
  const rows = cves.map((c) =>
    [c.cveNumber, c.severity, c.cvssScore, csvField(c.description), c.publishedDate].join(',')
  );
  fs.writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n', 'utf8');
  return CSV_PATH;
}

// Streams cves_sample.csv into Postgres via COPY FROM STDIN — this is the
// actual bulk-load path; everything above it just prepares the CSV file.
function copyCsvIntoTable(client, csvPath) {
  return new Promise((resolve, reject) => {
    const stream = client.query(
      copyFrom(`COPY cves (cve_number, severity, cvss_score, description, published_date)
                 FROM STDIN WITH (FORMAT csv, HEADER true)`)
    );
    const fileStream = fs.createReadStream(csvPath);

    fileStream.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
    fileStream.pipe(stream);
  });
}

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Seeding is rejected in production environments!');
    process.exitCode = 1;
    return;
  }

  if (process.env.SEED_OPT_IN !== 'true' && !process.argv.includes('--seed-opt-in')) {
    console.error('❌ Explicit seed opt-in is required! Please set SEED_OPT_IN=true or pass --seed-opt-in.');
    process.exitCode = 1;
    return;
  }

  console.log('🌱 Starting CVE dataset seeding...');
  const count = Number(process.env.SEED_CVE_COUNT) || 5000;
  const cves = generateMockCVEs(count);

  console.log(`📄 Writing ${cves.length} rows to ${CSV_PATH}...`);
  writeCsv(cves);

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing CVEs (and dependents) to keep the unique cve_number
    // constraint happy across repeated runs of this script.
    console.log('🧹 Clearing existing CVE database records...');
    await client.query('DELETE FROM dependency_vulnerabilities');
    await client.query('DELETE FROM security_alerts');
    await client.query('DELETE FROM cves');

    console.log(`🚀 Bulk-loading ${cves.length} CVEs via COPY...`);
    const startedAt = process.hrtime.bigint();
    await copyCsvIntoTable(client, CSV_PATH);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    await client.query('COMMIT');
    console.log(`🎉 Seeding complete — ${cves.length} CVEs loaded via COPY in ${elapsedMs.toFixed(1)}ms.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pgPool.end();
  }
}

seed();
