const axios = require('axios');

/**
 * Exchanges a GitHub OAuth authorization code for an access token.
 * Securely uses server-side client secrets.
 */
const exchangeGitHubCode = async (req, res) => {
  const { code, redirect_uri } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      message: 'GitHub authorization code is required.'
    });
  }

  try {
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri
      },
      {
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (response.data.error) {
      return res.status(400).json({
        success: false,
        message: response.data.error_description || response.data.error
      });
    }

    return res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('GitHub OAuth Exchange Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to exchange authorization code for token.',
      error: error.message
    });
  }
};

/**
 * Fetches user repositories directly from GitHub using a valid OAuth token.
 */
const fetchGitHubRepositories = async (req, res) => {
  const githubToken = req.headers['x-github-token'];

  if (!githubToken) {
    return res.status(400).json({
      success: false,
      message: 'Missing x-github-token authorization header.'
    });
  }

  try {
    const response = await axios.get('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json'
      },
      params: {
        per_page: 100,
        sort: 'updated'
      }
    });

    const repos = response.data.map(repo => ({
      name: repo.name,
      full_name: repo.full_name,
      default_branch: repo.default_branch,
      language: repo.language,
      html_url: repo.html_url
    }));

    return res.status(200).json({
      success: true,
      data: repos
    });
  } catch (error) {
    console.error('Fetch GitHub Repositories Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve repositories from GitHub.',
      error: error.message
    });
  }
};

module.exports = {
  exchangeGitHubCode,
  fetchGitHubRepositories
};
