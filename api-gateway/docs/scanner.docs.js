/**
 * @swagger
 * /api/v1/scanner/scan:
 *   post:
 *     summary: Run a security scan on a repository
 *     tags: [Scanner]
 *     description: >
 *       Cross-references the repository's dependencies against the CVE dataset via a SQL JOIN,
 *       populates the dependency_vulnerabilities junction table, and raises security_alerts for
 *       newly-detected vulnerabilities. Locks the repository row (SELECT ... FOR UPDATE) so
 *       concurrent scans of the same repository are serialized rather than racing.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - repository_id
 *             properties:
 *               repository_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Scan completed; returns match/alert counts.
 *       404:
 *         description: Repository not found or not accessible to your organization.
 *       500:
 *         description: Database transaction aborted.
 *
 * /api/v1/scanner/alerts:
 *   get:
 *     summary: List security alerts
 *     tags: [Scanner]
 *     description: Returns security alerts for the caller's organization, optionally scoped to one repository.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: repository_id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Restrict results to a single repository.
 *     responses:
 *       200:
 *         description: List of security alerts.
 *
 * /api/v1/scanner/alerts/{alert_id}/resolve:
 *   patch:
 *     summary: Resolve a security alert
 *     tags: [Scanner]
 *     description: Marks an alert as resolved, scoped to the caller's organization.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: alert_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Alert marked as resolved.
 *       404:
 *         description: Alert not found or not accessible to your organization.
 */
