const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');

/**
 * Controller powering the Security Scanner engine (Phase 6).
 *
 * Cross-references a repository's `dependencies` against the `cves` dataset
 * using a set-based SQL JOIN, then persists the results into the
 * `dependency_vulnerabilities` junction table (many-to-many, 3NF) and the
 * `security_alerts` table.
 *
 * Concurrency: the repository row is locked with `SELECT ... FOR UPDATE`
 * before scanning so two simultaneous scans of the same repository are
 * serialized instead of racing to insert duplicate alerts.
 */
const runSecurityScan = async (req, res) => {
  const { repository_id } = req.body;
  const userId = req.user.sub || req.user.user_id;

  if (!repository_id) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameter: repository_id.'
    });
  }

  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Confirm the repository belongs to the caller's organization AND
    //    acquire a row lock — a concurrent scan on the same repository will
    //    block here until this transaction commits or rolls back, preventing
    //    duplicate alert generation (DBMS isolation demo). Admins bypass the
    //    organization check — they can scan any repository on the platform.
    const caller = await getCallerContext(userId);
    const ownershipCheck = caller?.role === 'admin'
      ? await client.query(
          `SELECT repository_id FROM repositories WHERE repository_id = $1 FOR UPDATE`,
          [repository_id]
        )
      : await client.query(
          `SELECT r.repository_id
           FROM repositories r
           JOIN projects p ON r.project_id = p.project_id
           JOIN users u ON p.organization_id = u.organization_id
           WHERE r.repository_id = $1 AND u.user_id = $2
           FOR UPDATE OF r`,
          [repository_id, userId]
        );

    if (ownershipCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Repository not found or not accessible to your organization.'
      });
    }

    // 2. Execute the core relational JOIN: match active dependencies against
    //    the CVE dataset. Pushing this to Postgres (rather than looping in
    //    Node) is the whole point of the set-based approach.
    const scanQuery = `
      SELECT d.dependency_id, c.cve_id, c.severity, c.cve_number
      FROM dependencies d
      INNER JOIN cves c ON c.description ILIKE '%' || d.package_name || '%'
      WHERE d.repository_id = $1
        AND d.is_deprecated = false
    `;
    const matches = await client.query(scanQuery, [repository_id]);

    // 3. Populate the junction table and raise an alert only for
    //    newly-detected (dependency, cve) pairs — ON CONFLICT DO NOTHING
    //    both enforces the junction's uniqueness and tells us whether this
    //    is a fresh finding or one already on record, so rescans don't spam
    //    duplicate alerts.
    //
    //    Batched via unnest() instead of one INSERT per match: a repo can
    //    legitimately match hundreds of CVEs, and looping a round-trip per
    //    match turns a scan into hundreds of sequential network calls.
    let newAlerts = 0;
    if (matches.rows.length > 0) {
      const dependencyIds = matches.rows.map((m) => m.dependency_id);
      const cveIds = matches.rows.map((m) => m.cve_id);

      const junctionInsert = await client.query(
        `INSERT INTO dependency_vulnerabilities (dependency_id, cve_id, status)
         SELECT dependency_id, cve_id, 'open'
         FROM unnest($1::int[], $2::int[]) AS t(dependency_id, cve_id)
         ON CONFLICT (dependency_id, cve_id) DO NOTHING
         RETURNING dependency_id, cve_id`,
        [dependencyIds, cveIds]
      );

      const freshPairs = new Set(junctionInsert.rows.map((r) => `${r.dependency_id}:${r.cve_id}`));
      const freshMatches = matches.rows.filter((m) => freshPairs.has(`${m.dependency_id}:${m.cve_id}`));

      if (freshMatches.length > 0) {
        await client.query(
          `INSERT INTO security_alerts (repository_id, dependency_id, severity, message)
           SELECT $1, dependency_id, severity, message
           FROM unnest($2::int[], $3::text[], $4::text[]) AS t(dependency_id, severity, message)`,
          [
            repository_id,
            freshMatches.map((m) => m.dependency_id),
            freshMatches.map((m) => m.severity),
            freshMatches.map((m) => `Vulnerability ${m.cve_number} detected in package.`)
          ]
        );
        newAlerts = freshMatches.length;
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Security scan completed.',
      data: {
        repository_id,
        matchesEvaluated: matches.rows.length,
        newAlertsRaised: newAlerts
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Security Scan Transaction Failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Database transaction failed during security scan.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Fetch security alerts for the caller's organization, optionally scoped to
 * a single repository. Demonstrates a multi-table JOIN across the
 * alerts -> dependencies -> repositories -> projects -> users chain.
 */
const getAlerts = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  const { repository_id } = req.query;

  try {
    const caller = await getCallerContext(userId);
    const isAdmin = caller?.role === 'admin';

    // Admins see alerts across every organization; everyone else stays scoped
    // to their own (the base query differs because the admin path drops the
    // users join entirely rather than trying to match a caller-specific row).
    const params = isAdmin ? [] : [userId];
    let repoFilter = '';
    if (repository_id) {
      params.push(repository_id);
      repoFilter = `AND sa.repository_id = $${params.length}`;
    }

    const result = await pgPool.query(
      `SELECT sa.alert_id, sa.severity, sa.message, sa.status, sa.created_at, sa.resolved_at,
              r.repository_id, r.repo_name, d.package_name, d.current_version
       FROM security_alerts sa
       JOIN repositories r ON sa.repository_id = r.repository_id
       JOIN projects p ON r.project_id = p.project_id
       JOIN dependencies d ON sa.dependency_id = d.dependency_id
       ${isAdmin ? '' : 'JOIN users u ON p.organization_id = u.organization_id'}
       WHERE ${isAdmin ? 'TRUE' : 'u.user_id = $1'} ${repoFilter}
       ORDER BY sa.created_at DESC`,
      params
    );

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get Alerts Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving security alerts.'
    });
  }
};

/**
 * Mark a security alert as resolved. Scoped to the caller's organization so
 * one org cannot resolve another org's alerts.
 */
const resolveAlert = async (req, res) => {
  const userId = req.user.sub || req.user.user_id;
  const { alert_id } = req.params;

  try {
    const caller = await getCallerContext(userId);
    const result = caller?.role === 'admin'
      ? await pgPool.query(
          `UPDATE security_alerts
           SET status = 'resolved', resolved_at = NOW()
           WHERE alert_id = $1
           RETURNING alert_id, status, resolved_at`,
          [alert_id]
        )
      : await pgPool.query(
          `UPDATE security_alerts sa
           SET status = 'resolved', resolved_at = NOW()
           FROM repositories r
           JOIN projects p ON r.project_id = p.project_id
           JOIN users u ON p.organization_id = u.organization_id
           WHERE sa.repository_id = r.repository_id
             AND u.user_id = $1
             AND sa.alert_id = $2
           RETURNING sa.alert_id, sa.status, sa.resolved_at`,
          [userId, alert_id]
        );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found or not accessible to your organization.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Alert marked as resolved.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Resolve Alert Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error resolving alert.'
    });
  }
};

module.exports = {
  runSecurityScan,
  getAlerts,
  resolveAlert
};
