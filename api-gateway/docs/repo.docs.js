/**
 * @swagger
 * /api/v1/repos/sync:
 *   post:
 *     summary: Synchronize GitHub repositories
 *     tags: [Repositories]
 *     description: Ingests repositories under a project inside a single relational database transaction.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - org_id
 *               - project_name
 *               - repos
 *             properties:
 *               org_id:
 *                 type: integer
 *               project_name:
 *                 type: string
 *               repos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - name
 *                   properties:
 *                     name:
 *                       type: string
 *                     default_branch:
 *                       type: string
 *                     language:
 *                       type: string
 *     responses:
 *       200:
 *         description: Sync successful.
 *       500:
 *         description: Database transaction aborted.
 *
 * /api/v1/repos:
 *   get:
 *     summary: List synced repositories
 *     tags: [Repositories]
 *     description: Returns repositories owned by the caller's organization.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of synced repositories.
 */
