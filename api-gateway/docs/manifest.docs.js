/**
 * @swagger
 * /api/v1/manifests/ingest:
 *   post:
 *     summary: Ingest a repository dependency manifest file
 *     tags: [Manifests]
 *     description: Fetches a dependency manifest (e.g. package.json) from GitHub using the provided repository coordinates, uploads it to Supabase Storage, and records the file reference in PostgreSQL.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-github-token
 *         schema:
 *           type: string
 *         required: true
 *         description: GitHub OAuth token with repository read access.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - repo_id
 *               - owner
 *               - repo_name
 *               - file_path
 *             properties:
 *               repo_id:
 *                 type: integer
 *                 description: Internal database ID of the repository.
 *               owner:
 *                 type: string
 *                 description: GitHub organization or user that owns the repository.
 *               repo_name:
 *                 type: string
 *                 description: Name of the GitHub repository.
 *               file_path:
 *                 type: string
 *                 description: Path to the manifest file within the repository (e.g. 'package.json').
 *     responses:
 *       200:
 *         description: Successfully ingested the manifest file into Supabase Storage and database.
 *       400:
 *         description: Missing required parameters or x-github-token header.
 *       403:
 *         description: Forbidden (insufficient permissions to ingest this repository).
 *       500:
 *         description: Error fetching from GitHub, uploading to Supabase, or writing to the database.
 */
