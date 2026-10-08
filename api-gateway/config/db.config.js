const { Pool } = require('pg');
const neo4j = require('neo4j-driver');
require('dotenv').config();

// PostgreSQL Connection Pool Setup
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10 // Maximum connections in the pool
});

pgPool.on('error', (err, client) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

// Neo4j Driver Setup
let neo4jDriver;
try {
  neo4jDriver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    )
  );
} catch (error) {
  console.error('Failed to initialize Neo4j driver:', error.message);
}

/**
 * Helper function to acquire a new Neo4j session.
 * Always make sure to close the session when done!
 */
const getNeo4jSession = () => {
  if (!neo4jDriver) {
    throw new Error('Neo4j driver is not initialized');
  }
  return neo4jDriver.session();
};

module.exports = {
  pgPool,
  getNeo4jSession,
  neo4jDriver
};
