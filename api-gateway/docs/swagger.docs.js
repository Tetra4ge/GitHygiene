/**
 * @swagger
 * /api/protected:
 *   get:
 *     summary: Dummy Protected Route
 *     tags: [Auth]
 *     description: Returns a success message if the user provides a valid JWT.
 *     responses:
 *       200:
 *         description: Successfully authenticated.
 *       401:
 *         description: Unauthorized.
 */
