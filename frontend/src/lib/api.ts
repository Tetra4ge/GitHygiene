import axios, { AxiosError } from 'axios';
import { supabase } from './supabase';
import type {
  ApiEnvelope,
  AssessmentResult,
  DashboardSummary,
  Dependency,
  DependencyFile,
  GitHubRepo,
  IssueDraft,
  Notification,
  Organization,
  OrgMember,
  OsvFinding,
  OsvScanResult,
  Repository,
  Role,
  ScanResult,
  SecurityAlert,
  UserProfile
} from './types';

const baseURL =
  import.meta.env.VITE_MODE === 'production'
    ? import.meta.env.VITE_API_PRO_URL
    : import.meta.env.VITE_API_DEV_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: `${baseURL}/api/v1`,
  headers: { 'Content-Type': 'application/json' }
});

/**
 * The gateway's requireAuth middleware verifies the Supabase JWT, so every call
 * needs a live access token. Read it per-request rather than at module load:
 * Supabase rotates the token on refresh and a cached one would 401 after an hour.
 */
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** GitHub OAuth token, captured from session.provider_token at sign-in. */
const GITHUB_TOKEN_KEY = 'githygiene.github-token';

export const githubToken = {
  get: () => localStorage.getItem(GITHUB_TOKEN_KEY),
  set: (token: string) => localStorage.setItem(GITHUB_TOKEN_KEY, token),
  clear: () => localStorage.removeItem(GITHUB_TOKEN_KEY)
};

function githubHeaders() {
  const token = githubToken.get();
  if (!token) {
    throw new Error(
      'No GitHub token in this session. Sign out and re-authorize with GitHub to grant repo access.'
    );
  }
  return { 'x-github-token': token };
}

/** Unwraps the controllers' { success, message, data } envelope into a readable Error. */
export function apiError(err: unknown): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as ApiEnvelope<unknown> | undefined;
    const summary = body?.message || err.message;
    // Some controllers attach the raw underlying error (e.g. a GitHub API or
    // Supabase Storage failure) separately from the generic message — surface
    // it too, otherwise the UI only ever shows "Failed to ..." with no cause.
    return body?.error && body.error !== summary ? `${summary} — ${body.error}` : summary;
  }
  return err instanceof Error ? err.message : 'Unexpected error.';
}

// --- Organizations ------------------------------------------------------

export interface CreateOrgInput {
  org_name: string;
  domain?: string;
  subscription_plan?: string;
}

export const orgsApi = {
  list: async (): Promise<Organization[]> => {
    const { data } = await api.get<ApiEnvelope<Organization[]>>('/orgs');
    return data.data;
  },
  create: async (input: CreateOrgInput): Promise<Organization> => {
    const { data } = await api.post<ApiEnvelope<Organization>>('/orgs', input);
    return data.data;
  }
};

// --- Users --------------------------------------------------------------

export const usersApi = {
  me: async (): Promise<UserProfile> => {
    const { data } = await api.get<ApiEnvelope<UserProfile>>('/users/me');
    return data.data;
  },
  /** Admin/manager only — admins get every org's roster, managers get their own. */
  listOrgMembers: async (): Promise<OrgMember[]> => {
    const { data } = await api.get<ApiEnvelope<OrgMember[]>>('/users');
    return data.data;
  },
  updateRole: async (userId: string, role: Role): Promise<UserProfile> => {
    const { data } = await api.put<ApiEnvelope<UserProfile>>(`/users/${userId}/role`, { role });
    return data.data;
  }
};

// --- Repositories -------------------------------------------------------

export interface SyncRepoInput {
  org_id: string;
  project_name: string;
  repos: Array<{ name: string; default_branch?: string; language?: string | null }>;
}

export const reposApi = {
  list: async (): Promise<Repository[]> => {
    const { data } = await api.get<ApiEnvelope<Repository[]>>('/repos');
    return data.data;
  },
  /** Upsert — creates the project if absent, then inserts-or-updates each repo in one transaction. */
  sync: async (
    input: SyncRepoInput
  ): Promise<{ project_id: string; repositories: Repository[] }> => {
    const { data } = await api.post<
      ApiEnvelope<{ project_id: string; repositories: Repository[] }>
    >('/repos/sync', input);
    return data.data;
  }
};

// --- GitHub -------------------------------------------------------------

export const githubApi = {
  listRepos: async (): Promise<GitHubRepo[]> => {
    const { data } = await api.get<ApiEnvelope<GitHubRepo[]>>('/github/repos', {
      headers: githubHeaders()
    });
    return data.data;
  }
};

// --- Manifests & dependency parsing -------------------------------------

export interface IngestManifestInput {
  repo_id: string;
  owner: string;
  repo_name: string;
  file_path: string;
}

export const manifestsApi = {
  ingest: async (input: IngestManifestInput): Promise<DependencyFile> => {
    const { data } = await api.post<ApiEnvelope<DependencyFile>>('/manifests/ingest', input, {
      headers: githubHeaders()
    });
    return data.data;
  }
};

export const parserApi = {
  extract: async (fileId: string): Promise<Dependency[]> => {
    const { data } = await api.post<ApiEnvelope<Dependency[]>>('/parser/extract', {
      file_id: fileId
    });
    return data.data;
  }
};

// --- Security scanner -----------------------------------------------------

export const scannerApi = {
  scan: async (repositoryId: string): Promise<ScanResult> => {
    const { data } = await api.post<ApiEnvelope<ScanResult>>('/scanner/scan', {
      repository_id: repositoryId
    });
    return data.data;
  },
  listAlerts: async (repositoryId?: string): Promise<SecurityAlert[]> => {
    const { data } = await api.get<ApiEnvelope<SecurityAlert[]>>('/scanner/alerts', {
      params: repositoryId ? { repository_id: repositoryId } : undefined
    });
    return data.data;
  },
  resolveAlert: async (alertId: string): Promise<SecurityAlert> => {
    const { data } = await api.patch<ApiEnvelope<SecurityAlert>>(`/scanner/alerts/${alertId}/resolve`);
    return data.data;
  }
};

// --- OSV.dev real vulnerability scanner ----------------------------------

export const osvApi = {
  scan: async (repositoryId: string): Promise<OsvScanResult> => {
    const { data } = await api.post<ApiEnvelope<OsvScanResult>>('/osv/scan', {
      repository_id: repositoryId
    });
    return data.data;
  },
  listFindings: async (repositoryId: string): Promise<OsvFinding[]> => {
    const { data } = await api.get<ApiEnvelope<OsvFinding[]>>('/osv/findings', {
      params: { repository_id: repositoryId }
    });
    return data.data;
  }
};

// --- AI reachability engine (Phases 7-8) ---------------------------------

export interface AssessInput {
  finding_id: string;
  owner: string;
  repo_name?: string;
  regenerate?: boolean;
}

export const aiApi = {
  assess: async (input: AssessInput): Promise<AssessmentResult> => {
    const { data } = await api.post<ApiEnvelope<AssessmentResult>>('/ai/assess', input, {
      headers: githubHeaders()
    });
    return data.data;
  },
  draftIssue: async (assessmentId: string): Promise<IssueDraft> => {
    const { data } = await api.post<ApiEnvelope<IssueDraft>>('/ai/draft-issue', {
      assessment_id: assessmentId
    });
    return data.data;
  }
};

// --- Dashboard & notifications (Phase 9) ---------------------------------

export const dashboardApi = {
  summary: async (): Promise<DashboardSummary> => {
    const { data } = await api.get<ApiEnvelope<DashboardSummary>>('/dashboard/summary');
    return data.data;
  }
};

export const notificationsApi = {
  list: async (): Promise<{ notifications: Notification[]; unreadCount: number }> => {
    const { data } = await api.get<ApiEnvelope<Notification[]> & { unreadCount: number }>('/notifications');
    return { notifications: data.data, unreadCount: data.unreadCount };
  },
  markRead: async (id: string): Promise<Notification> => {
    const { data } = await api.patch<ApiEnvelope<Notification>>(`/notifications/${id}/read`);
    return data.data;
  }
};
