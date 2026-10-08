const fs = require('fs');
const path = require('path');
const { pgPool } = require('../config/db.config');

const indexesSqlPath = path.join(__dirname, 'indexes.sql');

async function run() {
  console.log('⚡ Deploying database performance indexes...');
  
  let sqlContent;
  try {
    sqlContent = fs.readFileSync(indexesSqlPath, 'utf8');
  } catch (error) {
    console.error('❌ Could not read indexes.sql:', error.message);
    process.exit(1);
  }

  let client;

  try {
    client = await pgPool.connect();
    await client.query('BEGIN');
    await client.query(sqlContent);
    await client.query('COMMIT');
    console.log('✅ Performance indexes successfully deployed to PostgreSQL!');
  } catch (error) {
    process.exitCode = 1;
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('⚠️ Rollback failed:', rollbackError.message);
      }
    }
    console.error('❌ Index deployment failed:', error.message);
  } finally {
    if (client) {
      client.release();
    }
    await pgPool.end();
  }
}

run();
