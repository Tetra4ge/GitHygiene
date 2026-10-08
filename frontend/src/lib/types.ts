// Shared domain types mirroring the api-gateway PostgreSQL schema.

export type Role = 'admin' | 'manager' | 'developer';

export interface Organization {
  organization_id: string;
  organization_name: string;
  domain: string | null;
  subscription_plan: string;
  created_at: string;
}

export interface UserProfile {
  user_id: string;
  organization_id: string | null;
  full_name: string | null;
  email: string;
  role: Role;
  created_at: string;
  last_login: string | null;
  organization_name: string | null;
}

/**
 * Row shape from GET /users (admin/manager roster). `organization_name` and
 * `organization_id` are only populated for admins — the platform-wide view —
 * since a manager's roster is implicitly scoped to their own organization.
 */
export interface OrgMember {
  user_id: string;
  full_name: string | null;
  email: string;
  role: Role;
  created_at: string;
  last_login: string | null;
  organization_id?: string | null;
  organization_name?: string | null;
}

export interface Repository {
  repository_id: string;
  repo_name: string;
  default_branch: string;
  language: string | null;
  last_synced_at: string;
  project_name: string;
  organization_id: string;
  organization_name: string;
}

/** Shape returned by GET /github/repos — a remote repo, not yet synced to Postgres. */
export interface GitHubRepo {
  name: string;
  full_name: string;
  default_branch: string;
  language: string | null;
  html_url: string;
}

export interface DependencyFile {
  file_id: string;
  repository_id: string;
  file_name: string;
  package_manager: string;
  storage_path: string;
  last_scanned: string;
}

export interface Dependency {
  dependency_id: string;
  repository_id: string;
  package_name: string;
  current_version: string | null;
  latest_version: string | null;
  is_deprecated: boolean;
  introduced_at: string;
  original_constraint: string | null;
  package_manager: string | null;
}

export type AlertStatus = 'open' | 'resolved';

export interface SecurityAlert {
  alert_id: string;
  severity: string;
  message: string;
  status: AlertStatus;
  created_at: string;
  resolved_at: string | null;
  repository_id: string;
  repo_name: string;
  package_name: string;
  current_version: string | null;
}

export interface ScanResult {
  repository_id: string;
  matchesEvaluated: number;
  newAlertsRaised: number;
}

/** Every api-gateway controller wraps its payload in this envelope. */
export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  /** Some controllers (e.g. manifest ingestion) attach the raw underlying error here. */
  error?: string;
  data: T;
}
