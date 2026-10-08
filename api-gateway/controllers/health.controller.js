const { pgPool, getNeo4jSession } = require('../config/db.config');

/**
 * Controller to check the health of the API Gateway and its databases.
 */
const checkHealth = async (req, res) => {
  const status = {
    success: true,
    service: 'api-gateway',
    status: 'up',
    databases: {
      postgres: 'OFFLINE',
      neo4j: 'OFFLINE'
    },
    timestamp: new Date().toISOString()
  };

  let hasError = false;

  // 1. Check PostgreSQL Connectivity
  try {
    const pgResult = await pgPool.query('SELECT NOW() AS current_time;');
    if (pgResult.rows.length > 0) {
      status.databases.postgres = 'ONLINE';
    }
  } catch (error) {
    console.error('🔴 PostgreSQL Health Check Failed:', error.message);
    status.databases.postgres = `ERROR: ${error.message}`;
    hasError = true;
  }

  // 2. Check Neo4j Connectivity
  try {
    const session = getNeo4jSession();
    try {
      const neo4jResult = await session.run('RETURN 1 AS num');
      if (neo4jResult.records.length > 0) {
        status.databases.neo4j = 'ONLINE';
      }
    } finally {
      await session.close();
    }
  } catch (error) {
    console.error('🔴 Neo4j Health Check Failed:', error.message);
    status.databases.neo4j = `ERROR: ${error.message}`;
    hasError = true;
  }

  // If any DB is offline/errored, reflect it in the general status and status code
  if (hasError || status.databases.postgres !== 'ONLINE' || status.databases.neo4j !== 'ONLINE') {
    status.success = false;
    status.status = 'degraded';
    return res.status(500).json(status);
  }

  return res.status(200).json(status);
};

module.exports = {
  checkHealth
};
