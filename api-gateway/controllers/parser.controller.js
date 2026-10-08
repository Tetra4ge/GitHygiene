const { pgPool } = require('../config/db.config');
const { supabase } = require('../config/supabase.config');
const axios = require('axios');
const { parseNpmLock } = require('../services/parsers/npmLockParser');
const { parsePackageJson } = require('../services/parsers/packageJsonParser');
const { parsePipRequirements } = require('../services/parsers/pipRequirementsParser');

const INSERT_CHUNK_SIZE = 500;

/**
 * Controller to retrieve an ingested manifest file from Supabase Storage,
 * parse its full dependency tree (direct + transitive, per phases/Phase_04.md
 * §2.2), and record it in PostgreSQL.
 */
const extractDependencies = async (req, res) => {
  const { file_id } = req.body;

  if (!file_id) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameter: file_id.'
    });
  }

  // Self-healing database schema migrations for Phase 4/5 updates.
  try {
    await pgPool.query('ALTER TABLE dependencies ADD COLUMN IF NOT EXISTS original_constraint VARCHAR(100)');
    await pgPool.query('ALTER TABLE dependencies ADD COLUMN IF NOT EXISTS package_manager VARCHAR(50)');
    await pgPool.query('ALTER TABLE dependencies ADD COLUMN IF NOT EXISTS is_direct BOOLEAN DEFAULT true');
    await pgPool.query('ALTER TABLE dependencies ADD COLUMN IF NOT EXISTS ecosystem VARCHAR(20)');
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
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS dependency_edges (
        edge_id SERIAL PRIMARY KEY,
        repository_id INT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
        package_manager VARCHAR(50) NOT NULL,
        parent_name VARCHAR(255) NOT NULL,
        child_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        UNIQUE (repository_id, package_manager, parent_name, child_name)
      )
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

    const { storage_path, repository_id, package_manager } = fileRes.rows[0];

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

    // 3. For npm, fetch package-lock.json from GitHub to walk the full
    //    resolved tree (Phase 4 §2.2). Without it, fall back to package.json
    //    alone — direct dependencies only, flagged approximate.
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
    if (package_manager === 'npm' && githubToken && owner && repo_name) {
      try {
        const lockUrl = `https://api.github.com/repos/${owner}/${repo_name}/contents/package-lock.json`;
        const lockRes = await axios.get(lockUrl, {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        });
        if (lockRes.data && lockRes.data.download_url) {
          const rawLockRes = await axios.get(lockRes.data.download_url, { responseType: 'text' });
          lockJson = typeof rawLockRes.data === 'string' ? JSON.parse(rawLockRes.data) : rawLockRes.data;
        }
      } catch (err) {
        console.log('No package-lock.json found or parsed from GitHub:', err.message);
      }
    }

    // 4. Parse dependencies — malformed manifests fail with a readable message
    //    rather than a generic 500.
    let parseResult;
    let approximate = false;
    let unpinnedSkipped = 0;

    try {
      if (package_manager === 'npm') {
        const manifestJson = JSON.parse(fileText);
        if (lockJson && Number(lockJson.lockfileVersion) >= 2) {
          parseResult = parseNpmLock(lockJson);
        } else {
          parseResult = parsePackageJson(manifestJson);
          approximate = true;
        }
      } else {
        parseResult = parsePipRequirements(fileText);
        unpinnedSkipped = parseResult.unpinnedSkipped || 0;
      }
    } catch (parseErr) {
      return res.status(422).json({
        success: false,
        message: `Malformed ${package_manager === 'npm' ? 'package.json / package-lock.json' : 'requirements.txt'}: ${parseErr.message}`
      });
    }

    const { packages, edges } = parseResult;

    if (packages.length === 0) {
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
        message:
          package_manager === 'pip'
            ? `No pinned dependencies found in the manifest file (${unpinnedSkipped} unpinned requirement(s) skipped).`
            : 'No dependencies found in the manifest file.',
        data: []
      });
    }

    // 5. Upsert dependencies + edges into the database within a transaction,
    //    in chunks — large lockfiles can contain thousands of packages.
    const client = await pgPool.connect();
    const insertedDeps = [];

    try {
      await client.query('BEGIN');

      for (let i = 0; i < packages.length; i += INSERT_CHUNK_SIZE) {
        const chunk = packages.slice(i, i + INSERT_CHUNK_SIZE);
        for (const dep of chunk) {
          const result = await client.query(
            `INSERT INTO dependencies
               (repository_id, package_name, current_version, latest_version, is_deprecated, introduced_at, original_constraint, package_manager, is_direct, ecosystem)
             VALUES ($1, $2, $3, NULL, false, NOW(), $4, $5, $6, $7)
             ON CONFLICT (repository_id, package_name, package_manager) DO UPDATE
             SET current_version = EXCLUDED.current_version,
                 original_constraint = EXCLUDED.original_constraint,
                 is_direct = EXCLUDED.is_direct OR dependencies.is_direct,
                 ecosystem = EXCLUDED.ecosystem,
                 introduced_at = NOW()
             RETURNING *`,
            [repository_id, dep.name, dep.version, dep.constraint || null, package_manager, dep.isDirect, dep.ecosystem]
          );
          insertedDeps.push(result.rows[0]);
        }
      }

      // Replace this repository's edges wholesale — re-parsing always
      // reflects the current lockfile, never an accumulation of stale ones.
      await client.query('DELETE FROM dependency_edges WHERE repository_id = $1 AND package_manager = $2', [
        repository_id,
        package_manager
      ]);
      for (let i = 0; i < edges.length; i += INSERT_CHUNK_SIZE) {
        const chunk = edges.slice(i, i + INSERT_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const values = [];
        const placeholders = chunk.map((edge, idx) => {
          const offset = idx * 4;
          values.push(repository_id, package_manager, edge.from, edge.to);
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
        });
        await client.query(
          `INSERT INTO dependency_edges (repository_id, package_manager, parent_name, child_name)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT (repository_id, package_manager, parent_name, child_name) DO NOTHING`,
          values
        );
      }

      // Update last scanned timestamp inside the transaction before Commit
      await client.query(
        'UPDATE dependency_files SET last_scanned = NOW() WHERE file_id = $1',
        [file_id]
      );

      await client.query('COMMIT');

      const directCount = insertedDeps.filter((d) => d.is_direct).length;
      return res.status(200).json({
        success: true,
        message:
          `Successfully extracted ${insertedDeps.length} dependencies ` +
          `(${directCount} direct, ${insertedDeps.length - directCount} transitive)` +
          (approximate ? ' — approximate: no lockfile, versions are not exact.' : '') +
          (unpinnedSkipped > 0 ? ` (${unpinnedSkipped} unpinned requirement(s) skipped)` : ''),
        data: insertedDeps,
        meta: { approximate, unpinnedSkipped, edgeCount: edges.length }
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
