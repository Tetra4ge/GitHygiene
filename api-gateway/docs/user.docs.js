/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Fetch current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile details from database.
 *       404:
 *         description: User profile not synced.
 *
 * /api/v1/users:
 *   get:
 *     summary: List organization members (Admin only)
 *     tags: [Users]
 *     description: Returns every user in the caller's own organization.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of organization members.
 *       403:
 *         description: Forbidden (insufficient permissions).
 *
 * /api/v1/users/{userId}/role:
 *   put:
 *     summary: Modify user role (Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, manager, developer]
 *     responses:
 *       200:
 *         description: Updated user profile details.
 *       400:
 *         description: Invalid role.
 *       403:
 *         description: Forbidden (insufficient permissions).
 */
