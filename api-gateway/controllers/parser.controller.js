const { pgPool } = require('../config/db.config');
const { supabase } = require('../config/supabase.config');
const axios = require('axios');

/**
 * Controller to retrieve an ingested manifest file from Supabase Storage,
 * parse its dependencies, clean version tags, and record them in PostgreSQL.
 */
const extractDependencies = async (req, res) => {
  const { file_id } = req.body;

  if (!file_id) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameter: file_id.'
    });
  }

  // Self-healing database schema migrations for Phase 5 updates
  try {
    await pgPool.query('ALTER TABLE dependencies ADD COLUMN IF NOT EXISTS original_constraint VARCHAR(100)');
    await pgPool.query('ALTER TABLE dependencies ADD COLUMN IF NOT EXISTS package_manager VARCHAR(50)');
    await pgPool.query('ALTER TABLE dependencies DROP CONSTRAINT IF EXISTS dependencies_repository_id_package_name_key');
    await pgPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'dependencies_repo_pkg_manager_key'
        ) THEN
          ALTER TABLE dependencies ADD CONSTRAINT dependencies_repo_pkg_manager_key UNIQUE (repository_id, package_name, package_manager);
        END IF;
      END $$;
    `);
  } catch (e) {
    console.error('Schema migration failed:', e.message);
  }

  try {
    // 1. Fetch storage reference from public database
    const fileRes = await pgPool.query(
      'SELECT storage_path, repository_id, file_name, package_manager FROM dependency_files WHERE file_id = $1',
      [file_id]
    );

    if (fileRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ingested manifest file reference record not found.'
      });
    }

    const { storage_path, repository_id, file_name, package_manager } = fileRes.rows[0];

    // Authorization check: Verify user has repository membership
    const userOrgRes = await pgPool.query(
      `SELECT 1 FROM users u
       JOIN projects p ON u.organization_id = p.organization_id
       JOIN repositories r ON p.project_id = r.project_id
       WHERE u.user_id = $1 AND r.repository_id = $2`,
      [req.user.sub || req.user.user_id, repository_id]
    );

    if (userOrgRes.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have access to this repository.'
      });
    }

    // Ingestion parser rejects unsupported formats
    if (package_manager !== 'npm' && package_manager !== 'pip') {
      return res.status(400).json({
        success: false,
        message: `Unsupported package manager format: ${package_manager}. Only npm (package.json) and pip (requirements.txt) are supported.`
      });
    }

    // 2. Download manifest file from Supabase Storage
    const { data, error: storageError } = await supabase
      .storage
      .from('manifests')
      .download(storage_path);

    if (storageError) {
      throw new Error(`Failed to download manifest from storage: ${storageError.message}`);
    }

    const fileText = await data.text();

    // 3. Optional: Retrieve owner and repo_name to fetch and parse lockfile from GitHub
    const repoInfoRes = await pgPool.query(
      `SELECT r.repo_name, o.domain, o.organization_name
       FROM repositories r
       JOIN projects p ON r.project_id = p.project_id
       JOIN organizations o ON p.organization_id = o.organization_id
       WHERE r.repository_id = $1`,
      [repository_id]
    );
    const repoInfo = repoInfoRes.rows[0];
    const owner = req.body.owner || repoInfo.domain || repoInfo.organization_name;
    const repo_name = req.body.repo_name || repoInfo.repo_name;
    const githubToken = req.headers['x-github-token'];

    let lockJson = null;
    if (githubToken && owner && repo_name) {
      try {
        const lockFileName = package_manager === 'npm' ? 'package-lock.json' : 'poetry.lock';
        const lockUrl = `https://api.github.com/repos/${owner}/${repo_name}/contents/${lockFileName}`;
        const lockRes = await axios.get(lockUrl, {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        });
        if (lockRes.data && lockRes.data.download_url) {
          const rawLockRes = await axios.get(lockRes.data.download_url, { responseType: 'text' });
          lockJson = JSON.parse(rawLockRes.data);
        }
      } catch (err) {
        console.log('No lockfile found or parsed from GitHub:', err.message);
      }
    }

    // 4. Parse dependencies
    let dependenciesList = [];

    if (package_manager === 'npm') {
      const manifest = JSON.parse(fileText);
      const allDeps = {
        ...manifest.dependencies,
        ...manifest.devDependencies
      };

      for (const [name, constraint] of Object.entries(allDeps)) {
        if (typeof constraint === 'string') {
          // Resolve exact version from lockfile
          let resolvedVersion = constraint.replace(/[\^~*]/g, '');
          if (lockJson) {
            if (lockJson.packages && lockJson.packages[`node_modules/${name}`]) {
              resolvedVersion = lockJson.packages[`node_modules/${name}`].version;
            } else if (lockJson.dependencies && lockJson.dependencies[name]) {
              resolvedVersion = lockJson.dependencies[name].version;
            }
          }
          dependenciesList.push({ name, constraint, version: resolvedVersion });
        }
      }
    } else if (package_manager === 'pip') {
      // Basic parser for requirements.txt (simple text line parser)
      const lines = fileText.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([^>=<~]+)(?:([>=<~]+)(.+))?$/);
          if (match) {
            const name = match[1].trim();
            const operator = match[2] || '';
            const constraintVal = (match[3] || '0.0.0').trim();
            const constraint = operator ? `${operator}${constraintVal}` : constraintVal;
            
            // Resolve exact version from lockfile if available, otherwise clean version
            let resolvedVersion = constraintVal;
            if (lockJson && lockJson.default && lockJson.default[name]) {
              resolvedVersion = lockJson.default[name].version || constraintVal;
            }
            dependenciesList.push({ name, constraint, version: resolvedVersion });
          }
        }
      }
    }

    // empty-manifest branch updates last_scanned through client before returning
    if (dependenciesList.length === 0) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE dependency_files SET last_scanned = NOW() WHERE file_id = $1',
          [file_id]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return res.status(200).json({
        success: true,
        message: 'No dependencies found in the manifest file.',
        data: []
      });
    }

    // 5. Upsert dependencies into the database within a transaction
    const client = await pgPool.connect();
    const insertedDeps = [];

    try {
      await client.query('BEGIN');

      for (const dep of dependenciesList) {
        const result = await client.query(
          `INSERT INTO dependencies (repository_id, package_name, current_version, latest_version, is_deprecated, introduced_at, original_constraint, package_manager)
           VALUES ($1, $2, $3, $3, false, NOW(), $4, $5)
           ON CONFLICT (repository_id, package_name, package_manager) DO UPDATE
           SET current_version = EXCLUDED.current_version,
               original_constraint = EXCLUDED.original_constraint,
               introduced_at = NOW()
           RETURNING *`,
          [repository_id, dep.name, dep.version, dep.constraint, package_manager]
        );
        insertedDeps.push(result.rows[0]);
      }

      // Update last scanned timestamp inside the transaction before Commit
      await client.query(
        'UPDATE dependency_files SET last_scanned = NOW() WHERE file_id = $1',
        [file_id]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: `Successfully extracted and updated ${insertedDeps.length} dependencies.`,
        data: insertedDeps
      });

    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Dependency Extraction Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to extract dependencies from manifest.',
      error: error.message
    });
  }
};

module.exports = {
  extractDependencies
};
