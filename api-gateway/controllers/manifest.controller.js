const { pgPool } = require('../config/db.config');
const { getCallerContext } = require('../utils/rbac.util');
const { supabase } = require('../config/supabase.config');
const axios = require('axios');

/**
 * Controller to fetch dependency manifests from GitHub, stream/upload them to Supabase Storage,
 * and reference the resulting path in PostgreSQL. Includes clean-up fallback on failure.
 */
const ingestManifest = async (req, res) => {
  const { repo_id, owner, repo_name, file_path } = req.body;
  const githubToken = req.headers['x-github-token'];

  if (!repo_id || !owner || !repo_name || !file_path) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters: repo_id, owner, repo_name, or file_path.'
    });
  }

  if (!githubToken) {
    return res.status(400).json({
      success: false,
      message: 'Missing required x-github-token authorization header.'
    });
  }

  // Pre-authorization check: validate user's database membership and canonical GitHub remote.
  // Admins bypass the organization-membership check — they can ingest manifests
  // for any repository on the platform, not just their own organization's.
  try {
    const callerId = req.user.sub || req.user.user_id;
    const caller = await getCallerContext(callerId);
    const authCheck = caller?.role === 'admin'
      ? await pgPool.query(`SELECT repo_name FROM repositories WHERE repository_id = $1`, [repo_id])
      : await pgPool.query(
          `SELECT r.repo_name, p.organization_id
           FROM repositories r
           JOIN projects p ON r.project_id = p.project_id
           JOIN users u ON p.organization_id = u.organization_id
           WHERE r.repository_id = $1 AND u.user_id = $2`,
          [repo_id, callerId]
        );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have membership access to this repository.'
      });
    }

    const dbRepo = authCheck.rows[0];
    if (dbRepo.repo_name !== repo_name) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Repository name mismatch.'
      });
    }

    // Verify access to the canonical remote on GitHub
    try {
      await axios.get(`https://api.github.com/repos/${owner}/${repo_name}`, {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });
    } catch (ghErr) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access to GitHub repository denied or not found.'
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Authorization check failed.',
      error: err.message
    });
  }

  const storagePath = `${repo_id}/${Date.now()}_${file_path}`;

  try {
    // 1. Fetch file content details from GitHub API
    const contentsUrl = `https://api.github.com/repos/${owner}/${repo_name}/contents/${file_path}`;
    let githubResponse;
    try {
      githubResponse = await axios.get(contentsUrl, {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });
    } catch (contentsErr) {
      // A 404 here means the path genuinely doesn't exist in this repo (wrong
      // directory, wrong branch, or the repo just doesn't use this package
      // manager) — that's a normal, expected outcome, not a server failure,
      // so it gets its own 404 with a message the frontend can show as-is
      // instead of falling through to the generic 500 handler below.
      if (contentsErr.response?.status === 404) {
        return res.status(404).json({
          success: false,
          message: `No file found at "${file_path}" in ${owner}/${repo_name} (checked the default branch). Double-check the path — for a monorepo, try prefixing the subfolder, e.g. "frontend/${file_path}".`
        });
      }
      throw contentsErr;
    }

    const downloadUrl = githubResponse.data.download_url;
    if (!downloadUrl) {
      throw new Error('Raw download URL not provided in GitHub contents metadata.');
    }

    // 2. Fetch raw text content from the download URL
    const rawContentResponse = await axios.get(downloadUrl, {
      responseType: 'text'
    });
    const fileContent = rawContentResponse.data;

    // 3. Upload content to Supabase Storage Bucket
    const { data: uploadData, error: storageError } = await supabase
      .storage
      .from('manifests')
      .upload(storagePath, fileContent, {
        contentType: 'text/plain',
        upsert: false
      });

    if (storageError) {
      throw new Error(`Supabase Storage upload failed: ${storageError.message}`);
    }

    // 4. Determine package manager from filename
    let packageManager = 'npm';
    if (file_path.endsWith('requirements.txt')) {
      packageManager = 'pip';
    } else if (file_path.endsWith('go.mod')) {
      packageManager = 'go';
    } else if (file_path.endsWith('pom.xml')) {
      packageManager = 'maven';
    }

    // 5. Save the pointer reference in PostgreSQL
    try {
      const result = await pgPool.query(
        `INSERT INTO dependency_files (repository_id, file_name, package_manager, storage_path, last_scanned)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [repo_id, file_path, packageManager, uploadData.path]
      );

      return res.status(200).json({
        success: true,
        message: 'Manifest ingested and referenced successfully.',
        data: result.rows[0]
      });

    } catch (dbError) {
      // Cleanup uploaded file if PostgreSQL metadata insertion fails (ensuring atomic consistency)
      console.error('PostgreSQL Insertion Failed. Cleaning up storage upload:', dbError.message);
      const { error: removeError } = await supabase.storage.from('manifests').remove([storagePath]);
      if (removeError) {
        console.error('Failed to cleanup manifest file from storage:', removeError.message);
        try {
          await pgPool.query('CREATE TABLE IF NOT EXISTS cleanup_tasks (id SERIAL PRIMARY KEY, storage_path TEXT NOT NULL, created_at TIMESTAMP DEFAULT now())');
          await pgPool.query('INSERT INTO cleanup_tasks (storage_path) VALUES ($1)', [storagePath]);
        } catch (taskErr) {
          console.error('Failed to persist retryable cleanup task:', taskErr.message);
        }
      }
      throw dbError;
    }

  } catch (error) {
    console.error('Manifest Ingestion Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to ingest dependency manifest.',
      error: error.message
    });
  }
};

module.exports = {
  ingestManifest
};
