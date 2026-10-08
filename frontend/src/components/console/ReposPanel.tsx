import { useState } from 'react';
import { CloudDownload, GitBranch, RefreshCw, ScanSearch, UploadCloud } from 'lucide-react';
import { apiError, githubApi, orgsApi, reposApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { useResource } from '../../lib/useResource';
import type { GitHubRepo, Organization, Repository } from '../../lib/types';
import { Alert, Button, Field, Panel, Select, Spinner, Table } from './primitives';

// The panel needs repos and the org list together, so it loads them as one resource.
interface RepoPanelData {
  repos: Repository[];
  orgs: Organization[];
}

const EMPTY_DATA: RepoPanelData = { repos: [], orgs: [] };

const fetchPanelData = async (): Promise<RepoPanelData> => {
  const [repos, orgs] = await Promise.all([reposApi.list(), orgsApi.list()]);
  return { repos, orgs };
};

export default function ReposPanel({
  onSelectRepo,
  onSelectRepoForScan,
  remoteRepos: remote,
  onRemoteReposChange: setRemote
}: {
  /** Hands a synced repository to the manifest panel so ingestion can target it. */
  onSelectRepo: (repo: Repository) => void;
  /** Hands a synced repository to the scanner panel so a scan can target it. */
  onSelectRepoForScan: (repo: Repository) => void;
  /**
   * Owned by Dashboard, not this panel — Dashboard stays mounted across tab
   * switches while this panel unmounts, so keeping the loaded GitHub list here
   * as local state would wipe it out (and force a re-fetch) every time you
   * left and came back to this tab.
   */
  remoteRepos: GitHubRepo[];
  onRemoteReposChange: (repos: GitHubRepo[]) => void;
}) {
  const profile = useAuthStore((s) => s.profile);

  const {
    data: { repos, orgs },
    loading,
    error,
    setError,
    reload
  } = useResource(fetchPanelData, EMPTY_DATA);
  const [notice, setNotice] = useState<string | null>(null);

  // Sync form state. The org defaults to the caller's own organization and is only
  // tracked as state once they override it — derived beats an effect that back-fills.
  const [orgIdOverride, setOrgIdOverride] = useState<string | null>(null);
  const orgId = orgIdOverride ?? profile?.organization_id ?? '';
  const [projectName, setProjectName] = useState('');
  const [syncing, setSyncing] = useState(false);

  // GitHub import state — the list itself is lifted to Dashboard (see props above);
  // only the in-flight/selection state below is local to this panel.
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadRemote = async () => {
    setLoadingRemote(true);
    setError(null);
    try {
      setRemote(await githubApi.listRepos());
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoadingRemote(false);
    }
  };

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const payload = remote
        .filter((r) => selected.has(r.name))
        .map((r) => ({ name: r.name, default_branch: r.default_branch, language: r.language }));

      if (payload.length === 0) {
        throw new Error('Select at least one GitHub repository to sync.');
      }

      const result = await reposApi.sync({ org_id: orgId, project_name: projectName, repos: payload });
      setNotice(
        `Synced ${result.repositories.length} repositor${
          result.repositories.length === 1 ? 'y' : 'ies'
        } into project "${projectName}".`
      );
      setSelected(new Set());
      reload();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Sync repositories from GitHub"
        subtitle="CREATE + UPDATE via POST /api/v1/repos/sync (transactional upsert)"
        icon={<CloudDownload size={18} />}
        actions={
          <Button onClick={() => void loadRemote()} loading={loadingRemote}>
            <RefreshCw size={13} />
            Load GitHub repos
          </Button>
        }
      >
        <form onSubmit={handleSync} className="flex flex-col gap-4">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Target organization"
              value={orgId}
              onChange={setOrgIdOverride}
              required
              options={[
                { value: '', label: '— select organization —' },
                ...orgs.map((o) => ({ value: o.organization_id, label: o.organization_name }))
              ]}
            />
            <Field
              label="Project name"
              value={projectName}
              onChange={setProjectName}
              placeholder="platform-services"
              required
              hint="Created automatically if it does not exist."
            />
          </div>

          {remote.length > 0 && (
            <div className="border border-border/70 max-h-64 overflow-y-auto">
              {remote.map((r) => (
                <label
                  key={r.full_name}
                  className="flex items-center gap-3 px-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-ink-soft/40 cursor-pointer text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.name)}
                    onChange={() => toggle(r.name)}
                    className="accent-azure cursor-pointer"
                  />
                  <span className="text-paper font-bold flex-1 truncate">{r.full_name}</span>
                  <span className="text-mist">{r.language || '—'}</span>
                  <span className="text-emerald flex items-center gap-1">
                    <GitBranch size={11} />
                    {r.default_branch}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" loading={syncing} disabled={!orgId || !projectName}>
              <UploadCloud size={13} />
              Sync {selected.size > 0 ? `${selected.size} selected` : ''}
            </Button>
            {remote.length === 0 && !loadingRemote && (
              <span className="text-[10px] text-mist">
                Load your GitHub repositories first to pick sync targets.
              </span>
            )}
          </div>
        </form>
      </Panel>

      <Panel
        title="Tracked repositories"
        subtitle="READ via GET /api/v1/repos — joined across repositories → projects → users"
        icon={<GitBranch size={18} />}
        actions={
          <Button variant="ghost" onClick={reload} title="Refresh list">
            <RefreshCw size={13} />
          </Button>
        }
      >
        {loading ? (
          <Spinner label="LOADING REPOSITORIES..." />
        ) : (
          <Table
            rows={repos}
            keyOf={(r) => r.repository_id}
            empty="No repositories synced yet."
            columns={[
              {
                header: 'Repository',
                cell: (r) => <span className="text-paper font-bold">{r.repo_name}</span>
              },
              { header: 'Project', cell: (r) => <span className="text-mist">{r.project_name}</span> },
              {
                header: 'Organization',
                cell: (r) => <span className="text-emerald">{r.organization_name}</span>
              },
              { header: 'Branch', cell: (r) => <span className="text-emerald">{r.default_branch}</span> },
              {
                header: 'Language',
                cell: (r) => <span className="text-mist">{r.language || '—'}</span>
              },
              {
                header: 'Score',
                cell: (r) =>
                  r.security_score != null ? (
                    <span
                      className={
                        r.risk_level === 'low'
                          ? 'text-emerald font-bold'
                          : r.risk_level === 'medium'
                            ? 'text-yellow-400 font-bold'
                            : r.risk_level === 'high'
                              ? 'text-orange-400 font-bold'
                              : 'text-danger font-bold'
                      }
                    >
                      {r.security_score}/100 ({r.risk_level})
                    </span>
                  ) : (
                    <span className="text-mist">not scanned</span>
                  )
              },
              {
                header: 'Last synced',
                cell: (r) => (
                  <span className="text-mist whitespace-nowrap">
                    {r.last_synced_at ? new Date(r.last_synced_at).toLocaleString() : '—'}
                  </span>
                )
              },
              {
                header: '',
                cell: (r) => (
                  <div className="flex items-center gap-2">
                    <Button onClick={() => onSelectRepo(r)} title="Ingest a manifest from this repo">
                      Ingest
                    </Button>
                    <Button onClick={() => onSelectRepoForScan(r)} title="Run a security scan on this repo">
                      <ScanSearch size={13} />
                      Scan
                    </Button>
                  </div>
                )
              }
            ]}
          />
        )}
        <p className="text-[10px] text-mist leading-relaxed mt-4">
          Re-syncing the same repo name updates its branch and language in place (ON CONFLICT DO
          UPDATE). Delete is not exposed by the gateway yet.
        </p>
      </Panel>
    </div>
  );
}
