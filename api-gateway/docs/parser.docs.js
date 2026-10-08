/**
 * @swagger
 * /api/v1/parser/extract:
 *   post:
 *     summary: Parse dependencies from an ingested manifest file
 *     tags: [Parser]
 *     description: Retrieves a manifest file from Supabase Storage using its file_id, parses the raw dependencies (e.g. from package.json), normalizes versions, and writes them into the PostgreSQL dependencies table.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file_id
 *             properties:
 *               file_id:
 *                 type: string
 *                 format: uuid
 *                 description: The internal database UUID of the ingested manifest file.
 *     responses:
 *       200:
 *         description: Successfully parsed the manifest and extracted dependencies.
 *       400:
 *         description: Missing required file_id parameter.
 *       404:
 *         description: Manifest file reference not found in the database.
 *       500:
 *         description: Error fetching from Supabase Storage or writing dependencies to the database.
 */
