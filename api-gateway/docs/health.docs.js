/**
 * @swagger
 * /health:
 *   get:
 *     summary: API Gateway Health Check
 *     tags: [Health]
 *     description: Returns the operational status of the gateway and databases.
 *     responses:
 *       200:
 *         description: Gateway and databases are healthy.
 *       500:
 *         description: Database connectivity degraded.
 *
 * /api/v1/health:
 *   get:
 *     summary: API Gateway Health Check (v1 alias)
 *     tags: [Health]
 *     description: Returns the operational status of the gateway and databases.
 *     responses:
 *       200:
 *         description: Gateway and databases are healthy.
 *       500:
 *         description: Database connectivity degraded.
 */
