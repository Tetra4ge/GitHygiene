import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Building2, FileCode2, GitBranch, ScanSearch, ShieldCheck, Users } from 'lucide-react';
import { orgsApi, reposApi, usersApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { useResource } from '../../lib/useResource';
import type { Organization, OrgMember, Repository } from '../../lib/types';
import { Spinner } from '../../components/console/primitives';

interface OverviewData {
  orgs: Organization[];
  repos: Repository[];
  members: OrgMember[];
}

const EMPTY: OverviewData = { orgs: [], repos: [], members: [] };

export default function Overview() {
  const profile = useAuthStore((s) => s.profile);
  const role = profile?.role;
  const canSeeTeam = role === 'admin' || role === 'manager';

  const fetchOverview = useCallback(async (): Promise<OverviewData> => {
    const [orgs, repos, members] = await Promise.all([
      orgsApi.list(),
      reposApi.list(),
      canSeeTeam ? usersApi.listOrgMembers() : Promise.resolve([] as OrgMember[])
    ]);
    return { orgs, repos, members };
  }, [canSeeTeam]);

  const { data, loading } = useResource(fetchOverview, EMPTY);

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
