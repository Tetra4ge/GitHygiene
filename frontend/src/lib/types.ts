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

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ScoreBreakdown {
  vulnerabilities: Record<string, number>;
  deprecatedDirectCount: number;
  majorVersionsBehindCount: number;
  penalties: { vulnerabilities: number; deprecated: number; outdated: number };
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
  security_score?: number | null;
  risk_level?: RiskLevel | null;
  score_breakdown?: ScoreBreakdown | null;
  last_scanned_at?: string | null;
  last_scan_error?: string | null;
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

export interface OsvScanResult {
  repository_id: string;
  packagesChecked: number;
  advisoriesFound: number;
  newFindings: number;
  score: number;
  riskLevel: RiskLevel;
  breakdown: ScoreBreakdown;
}

export type Reachability = 'reachable' | 'likely_reachable' | 'not_evidenced' | 'unused';
export type Recommendation = 'upgrade' | 'replace' | 'mitigate' | 'accept';

export interface VerdictEvidenceItem {
  file: string;
  line: number;
  why: string;
}

export interface AssessmentVerdict {
  reachability: Reachability;
  confidence: 'low' | 'medium' | 'high';
  evidence: VerdictEvidenceItem[];
  recommendation: Recommendation;
  target_version: string | null;
  reasoning: string;
  breaking_change_risk: 'low' | 'medium' | 'high';
  breaking_change_note: string;
  effort: 'minutes' | 'hours' | 'days';
  insufficient_evidence: boolean;
  model: string;
}

export interface AssessmentRemediation {
  strategy: 'direct-bump' | 'override';
  direct_dependency: string | null;
  patch: string | null;
  note?: string;
  files_to_change: string[];
}

export interface IssueDraft {
  title: string;
  problem_statement: string;
  why_it_matters: string;
  suggested_files: string[];
  scope: string;
  acceptance_criteria: string[];
  skills_needed: string[];
  model: string;
}

export interface AssessmentResult {
  assessment_id: string;
  osv_id: string;
  commit_sha: string;
  model: string;
  verdict: AssessmentVerdict;
  evidence: {
    package_imported: boolean;
    import_sites: Array<{ file: string; line: number; text: string }>;
    call_sites: Array<{ file: string; line: number; symbol: string; snippet: string }>;
    searched_files: number;
    truncated: boolean;
  };
  remediation: AssessmentRemediation;
  created_at: string;
}

export interface OsvFinding {
  finding_id: string;
  osv_id: string;
  fixed_version: string | null;
  status: AlertStatus;
  created_at: string;
  dependency_id: string;
  package_name: string;
  current_version: string | null;
  is_direct: boolean;
  ecosystem: string;
  severity: string;
  summary: string;
  aliases: string[] | null;
}

export interface FixFirstItem {
  finding_id: string;
  repository_id: string;
  repo_name: string;
  package_name: string;
  severity: string;
  reachability: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  rank: number;
}

export interface DashboardSummary {
  empty: boolean;
  message?: string;
  reposTracked: number;
  reposScanned: number;
  averageScore: number | null;
  severityCounts: Record<string, number>;
  reachabilityCounts: Record<string, number>;
  fixFirst: FixFirstItem[];
  riskiestRepos: Array<{ repository_id: string; repo_name: string; security_score: number; risk_level: RiskLevel }>;
  ecosystemBreakdown: Array<{ ecosystem: string; count: number }>;
}

export interface Notification {
  notification_id: string;
  organization_id: string;
  repository_id: string | null;
  repo_name: string | null;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

/** Every api-gateway controller wraps its payload in this envelope. */
export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  /** Some controllers (e.g. manifest ingestion) attach the raw underlying error here. */
  error?: string;
  data: T;
}
