import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Building2, FileCode2, GitBranch, ScanSearch, ShieldCheck, Users } from 'lucide-react';
import { dashboardApi, orgsApi, reposApi, usersApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { useResource } from '../../lib/useResource';
import type { DashboardSummary, Organization, OrgMember, Repository } from '../../lib/types';
import { Spinner } from '../../components/console/primitives';

interface OverviewData {
  orgs: Organization[];
  repos: Repository[];
  members: OrgMember[];
  summary: DashboardSummary | null;
}

const EMPTY: OverviewData = { orgs: [], repos: [], members: [], summary: null };

const RISK_TEXT_COLOR: Record<string, string> = {
  low: 'text-emerald',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-danger'
};

export default function Overview() {
  const profile = useAuthStore((s) => s.profile);
  const role = profile?.role;
  const canSeeTeam = role === 'admin' || role === 'manager';

  const fetchOverview = useCallback(async (): Promise<OverviewData> => {
    const [orgs, repos, members, summary] = await Promise.all([
      orgsApi.list(),
      reposApi.list(),
      canSeeTeam ? usersApi.listOrgMembers() : Promise.resolve([] as OrgMember[]),
      dashboardApi.summary().catch(() => null)
    ]);
    return { orgs, repos, members, summary };
  }, [canSeeTeam]);

  const { data, loading } = useResource(fetchOverview, EMPTY);
  const summary = data.summary;

  const greeting = profile?.full_name || profile?.email || 'there';

  const stats =
    role === 'admin'
      ? [
          { label: 'Organizations (platform)', value: data.orgs.length, icon: Building2 },
          { label: 'Repositories (platform)', value: data.repos.length, icon: GitBranch },
          { label: 'Users (platform)', value: data.members.length, icon: Users }
        ]
      : role === 'manager'
        ? [
            { label: 'Your organization', value: data.orgs.length > 0 ? 1 : 0, icon: Building2 },
            { label: 'Repositories', value: data.repos.length, icon: GitBranch },
            { label: 'Team members', value: data.members.length, icon: Users }
          ]
        : [
            { label: 'Repositories', value: data.repos.length, icon: GitBranch },
            { label: 'Organization', value: profile?.organization_name ? 1 : 0, icon: Building2 }
          ];

  const actions = [
    { to: '/dashboard/repositories', label: 'Repositories', icon: GitBranch },
    { to: '/dashboard/manifests', label: 'Manifests', icon: FileCode2 },
    { to: '/dashboard/scanner', label: 'Security Scanner', icon: ScanSearch },
    ...(canSeeTeam ? [{ to: '/dashboard/team', label: 'Team', icon: Users }] : []),
    ...(canSeeTeam ? [{ to: '/dashboard/organizations', label: 'Organizations', icon: Building2 }] : [])
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display font-bold text-xl text-paper">Welcome back, {greeting}</h1>
        <p className="text-[11px] text-mist mt-1">
          {role === 'admin' && "You're an admin — you see every organization on the platform."}
          {role === 'manager' && "You're a manager — scoped to your own organization."}
          {role === 'developer' && "You're a developer — scoped to your own organization's repositories."}
          {!role && 'Loading your role...'}
        </p>
      </div>

      {loading ? (
        <Spinner label="LOADING OVERVIEW..." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="glass border border-border p-5 flex items-start gap-4">
              <span className="text-emerald bg-emerald/5 border border-emerald/10 p-2.5 shrink-0">
                <Icon size={18} />
              </span>
              <div>
                <div className="font-display text-2xl font-bold text-paper">{value}</div>
                <div className="text-[10px] text-mist uppercase tracking-widest mt-1">{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="glass border border-border p-5">
        <h2 className="font-display font-bold text-sm text-paper mb-4">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {actions.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2 bg-ink-soft border border-border hover:bg-border/60 hover:text-paper px-3.5 py-2 text-xs font-bold transition-all"
            >
              <Icon size={13} />
              {label}
            </Link>
          ))}
        </div>
      </div>

      {summary && !summary.empty && (
        <>
          <div className="glass border border-border p-5">
            <h2 className="font-display font-bold text-sm text-paper mb-1">Vulnerabilities by reachability</h2>
            <p className="text-[10px] text-mist mb-4">
              The question a plain scanner can't answer — of {Object.values(summary.severityCounts).reduce((a, b) => a + b, 0)}{' '}
              open findings, how many have an evidenced call path in your own code.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['reachable', 'likely_reachable', 'not_evidenced', 'unused', 'unknown']
                .filter((k) => summary.reachabilityCounts[k])
                .map((k) => (
                  <div key={k} className="border border-border/70 p-3">
                    <div className="font-display text-xl font-bold text-paper">{summary.reachabilityCounts[k]}</div>
                    <div className="text-[10px] text-mist uppercase tracking-widest mt-1">{k.replace('_', ' ')}</div>
                  </div>
                ))}
              {Object.keys(summary.reachabilityCounts).length === 0 && (
                <span className="text-[11px] text-mist col-span-4">
                  No findings yet — run an OSV scan from the Security tab.
                </span>
              )}
            </div>
          </div>

          {summary.fixFirst.length > 0 && (
            <div className="glass border border-border p-5">
              <h2 className="font-display font-bold text-sm text-paper mb-1">Fix this first</h2>
              <p className="text-[10px] text-mist mb-4">
                Ranked by impact ÷ effort (severity × reachability × blast radius, over difficulty) — a
                deterministic sort, not a model call.
              </p>
              <div className="flex flex-col gap-2">
                {summary.fixFirst.map((f) => (
                  <div
                    key={f.finding_id}
                    className="flex items-center justify-between border border-border/70 px-3 py-2 text-[11px]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-paper">{f.package_name}</span>
                      <span className="text-mist">in {f.repo_name}</span>
                      <span className="uppercase text-mist">{f.severity}</span>
                      <span className="text-azure">{f.reachability.replace('_', ' ')}</span>
                    </div>
                    <span className="text-emerald font-mono">rank {f.rank}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.riskiestRepos.length > 0 && (
            <div className="glass border border-border p-5">
              <h2 className="font-display font-bold text-sm text-paper mb-4">Riskiest repositories</h2>
              <div className="flex flex-col gap-2">
                {summary.riskiestRepos.map((r) => (
                  <div
                    key={r.repository_id}
                    className="flex items-center justify-between border border-border/70 px-3 py-2 text-[11px]"
                  >
                    <span className="font-bold text-paper">{r.repo_name}</span>
                    <span className={`font-bold ${RISK_TEXT_COLOR[r.risk_level] || 'text-mist'}`}>
                      {r.security_score}/100 ({r.risk_level})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {summary?.empty && (
        <div className="glass border border-border p-5 text-center">
          <p className="text-[12px] text-mist">{summary.message}</p>
          <Link
            to="/dashboard/repositories"
            className="inline-flex items-center gap-2 mt-3 bg-emerald/10 border border-emerald/20 text-emerald px-3.5 py-2 text-xs font-bold hover:bg-emerald/20 transition-all"
          >
            <GitBranch size={13} />
            Import a repository
          </Link>
        </div>
      )}

      {role === 'admin' && (
        <div className="flex items-start gap-2 border border-emerald/20 bg-emerald/5 text-emerald p-3 text-[11px] leading-relaxed">
          <ShieldCheck size={14} className="shrink-0 mt-0.5" />
          <span>
            Admin view: Organizations, Repositories, and Team all show data across every
            organization on the platform, not just your own.
          </span>
        </div>
      )}
    </div>
  );
}
