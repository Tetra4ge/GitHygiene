/**
 * @swagger
 * /api/v1/orgs:
 *   post:
 *     summary: Create a new organization
 *     tags: [Organizations]
 *     description: Restricts access to admins and managers. Enforces unique domain constraints.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - org_name
 *             properties:
 *               org_name:
 *                 type: string
 *               domain:
 *                 type: string
 *               subscription_plan:
 *                 type: string
 *                 enum: [free, startup, enterprise]
 *     responses:
 *       201:
 *         description: Created organization details.
 *       400:
 *         description: Missing fields or domain already exists.
 *       403:
 *         description: Forbidden.
 *
 *   get:
 *     summary: Get all organizations
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of organizations.
 */
