// Thin HTTP client for ai-service (the FastAPI engine). api-gateway owns
// Postgres, GitHub tokens, RBAC and org-scoping; ai-service owns prompts and
// model calls only (phases/Phase_07.md §2).

const axios = require('axios');

function aiServiceUrl() {
  return process.env.NODE_ENV === 'production'
    ? process.env.AI_SERVICE_PRO_URL
    : process.env.AI_SERVICE_DEV_URL || 'http://127.0.0.1:8000';
}

const AI_REQUEST_TIMEOUT_MS = 45000;

/** Raised for both "not configured" (503) and "validation failed twice" (502) — callers distinguish by .status. */
class AiServiceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function extractSurface(advisory) {
  try {
    const { data } = await axios.post(`${aiServiceUrl()}/v1/extract-surface`, advisory, {
      timeout: AI_REQUEST_TIMEOUT_MS
    });
    return data;
  } catch (err) {
    if (err.response) {
      throw new AiServiceError(err.response.data?.detail || err.message, err.response.status);
    }
    throw new AiServiceError(`ai-service unreachable: ${err.message}`, 503);
  }
}

async function assess(payload) {
  try {
    const { data } = await axios.post(`${aiServiceUrl()}/v1/assess`, payload, {
      timeout: AI_REQUEST_TIMEOUT_MS
    });
    return data;
  } catch (err) {
    if (err.response) {
      throw new AiServiceError(err.response.data?.detail || err.message, err.response.status);
    }
    throw new AiServiceError(`ai-service unreachable: ${err.message}`, 503);
  }
}

async function draftIssue(payload) {
  try {
    const { data } = await axios.post(`${aiServiceUrl()}/v1/draft-issue`, payload, {
      timeout: AI_REQUEST_TIMEOUT_MS
    });
    return data;
  } catch (err) {
    if (err.response) {
      throw new AiServiceError(err.response.data?.detail || err.message, err.response.status);
    }
    throw new AiServiceError(`ai-service unreachable: ${err.message}`, 503);
  }
}

module.exports = { extractSurface, assess, draftIssue, AiServiceError };
