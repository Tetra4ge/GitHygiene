/**
 * @swagger
 * /api/v1/github/token:
 *   post:
 *     summary: Exchange GitHub code for access token
 *     tags: [GitHub]
 *     description: Securely exchanges a GitHub OAuth authorization code for an access token using server-side client secrets.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *                 description: GitHub authorization code
 *               redirect_uri:
 *                 type: string
 *                 description: Optional redirect URI used during the initial OAuth flow
 *     responses:
 *       200:
 *         description: Successfully retrieved the GitHub access token.
 *       400:
 *         description: Missing authorization code or invalid code error from GitHub.
 *
 * /api/v1/github/repos:
 *   get:
 *     summary: Fetch repositories from GitHub
 *     tags: [GitHub]
 *     description: Retrieves the list of repositories accessible to the user using their GitHub access token.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: access_token
 *         schema:
 *           type: string
 *         required: true
 *         description: The GitHub OAuth access token.
 *     responses:
 *       200:
 *         description: List of GitHub repositories.
 *       400:
 *         description: Missing GitHub access token.
 *       500:
 *         description: Error fetching repositories from GitHub.
 */
