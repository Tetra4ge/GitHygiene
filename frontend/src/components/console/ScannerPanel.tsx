import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, ScanSearch, ShieldAlert } from 'lucide-react';
import { apiError, reposApi, scannerApi } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import type { Repository, SecurityAlert } from '../../lib/types';
import { Alert, Button, Panel, Select, Spinner, Table } from './primitives';

interface ScannerPanelData {
  repos: Repository[];
  alerts: SecurityAlert[];
}

const EMPTY_DATA: ScannerPanelData = { repos: [], alerts: [] };

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'text-danger',
  HIGH: 'text-danger',
  MEDIUM: 'text-warning',
  LOW: 'text-mist'
};

// Severities with lots of alerts stay usable: grouped under a collapsible
// header (collapsed by default once a group crosses this size) and revealed
// a page at a time instead of dumping hundreds of rows into one table.
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const COLLAPSE_THRESHOLD = 8;
const PAGE_SIZE = 8;

function severityRank(severity: string): number {
  const idx = SEVERITY_ORDER.indexOf(severity);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

export default function ScannerPanel({ selectedRepo }: { selectedRepo: Repository | null }) {
  // Mirrors ManifestsPanel: prefilled from the repo picked in the repositories
  // table, then only tracked as state once the user overrides it.
  const [repoIdOverride, setRepoIdOverride] = useState<string | null>(null);
  const repoId = repoIdOverride ?? selectedRepo?.repository_id ?? '';

  const fetchPanelData = useCallback(async (): Promise<ScannerPanelData> => {
    const [repos, alerts] = await Promise.all([
      reposApi.list(),
      scannerApi.listAlerts(repoId || undefined)
    ]);
    return { repos, alerts };
  }, [repoId]);

  const {
    data: { repos, alerts },
    loading,
    error,
    setError,
    reload
  } = useResource(fetchPanelData, EMPTY_DATA);

  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<Record<string, number>>({});

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of alerts) {
      const key = a.severity?.toUpperCase() || 'UNKNOWN';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [alerts]);

  const severityKeys = useMemo(
    () => Object.keys(severityCounts).sort((a, b) => severityRank(a) - severityRank(b)),
    [severityCounts]
  );

  const groups = useMemo(() => {
    const bySeverity = new Map<string, SecurityAlert[]>();
    for (const a of alerts) {
      const key = a.severity?.toUpperCase() || 'UNKNOWN';
      if (severityFilter !== 'ALL' && key !== severityFilter) continue;
      if (!bySeverity.has(key)) bySeverity.set(key, []);
      bySeverity.get(key)!.push(a);
    }
    return Array.from(bySeverity.entries()).sort(([a], [b]) => severityRank(a) - severityRank(b));
  }, [alerts, severityFilter]);

  const isCollapsed = (severity: string, total: number) =>
    collapsed[severity] ?? total > COLLAPSE_THRESHOLD;

  const toggleCollapsed = (severity: string, total: number) =>
    setCollapsed((prev) => ({ ...prev, [severity]: !isCollapsed(severity, total) }));

  const showMore = (severity: string) =>
    setVisibleCount((prev) => ({ ...prev, [severity]: (prev[severity] ?? PAGE_SIZE) + PAGE_SIZE }));

  const handleScan = async () => {
    if (!repoId) return;
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await scannerApi.scan(repoId);
      setNotice(
        `Scan complete: evaluated ${result.matchesEvaluated} dependency-CVE match${
          result.matchesEvaluated === 1 ? '' : 'es'
        }, raised ${result.newAlertsRaised} new alert${result.newAlertsRaised === 1 ? '' : 's'}.`
      );
      reload();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (alertId: string) => {
    setResolvingId(alertId);
    setError(null);
    try {
      await scannerApi.resolveAlert(alertId);
      reload();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Run security scan"
        subtitle="CREATE via POST /api/v1/scanner/scan — dependencies JOIN cves, locked with SELECT ... FOR UPDATE"
        icon={<ScanSearch size={18} />}
      >
        <div className="flex flex-col gap-4">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <Select
              label="Repository to scan"
              value={repoId}
              onChange={setRepoIdOverride}
              required
              options={[
                { value: '', label: '— select repository —' },
                ...repos.map((r) => ({ value: r.repository_id, label: `${r.project_name} / ${r.repo_name}` }))
              ]}
            />
            <Button variant="primary" onClick={() => void handleScan()} loading={scanning} disabled={!repoId}>
              <ScanSearch size={13} />
              Run scan
            </Button>
          </div>
          <p className="text-[10px] text-mist leading-relaxed">
            Matches this repository's dependencies against the CVE dataset. Rescanning only raises alerts for
            newly-detected vulnerabilities — already-known ones are not duplicated.
          </p>
        </div>
      </Panel>

      <Panel
        title="Security alerts"
        subtitle={
          repoId
            ? 'READ via GET /api/v1/scanner/alerts?repository_id= — scoped to the selected repository'
            : 'READ via GET /api/v1/scanner/alerts — across your organization'
        }
        icon={<ShieldAlert size={18} />}
        actions={
          <Button variant="ghost" onClick={reload} title="Refresh list">
            <RefreshCw size={13} />
          </Button>
        }
      >
        {loading ? (
          <Spinner label="LOADING ALERTS..." />
        ) : alerts.length === 0 ? (
          <div className="border border-dashed border-border/70 py-8 text-center text-[11px] text-mist">
            No security alerts yet. Run a scan to check for known vulnerabilities.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSeverityFilter('ALL')}
                  className={`px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border transition-colors cursor-pointer ${
                    severityFilter === 'ALL'
                      ? 'border-emerald text-emerald bg-emerald/10'
                      : 'border-border text-mist hover:text-paper hover:border-border/90'
                  }`}
                >
                  All · {alerts.length}
                </button>
                {severityKeys.map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverityFilter(severityFilter === sev ? 'ALL' : sev)}
                    className={`px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border transition-colors cursor-pointer ${
                      severityFilter === sev
                        ? 'border-emerald bg-emerald/10'
                        : 'border-border hover:border-border/90'
                    } ${SEVERITY_COLOR[sev] || 'text-mist'}`}
                  >
                    {sev} · {severityCounts[sev]}
                  </button>
                ))}
              </div>
              <div className="w-40">
                <Select
                  label="Filter by severity"
                  value={severityFilter}
                  onChange={setSeverityFilter}
                  options={[
                    { value: 'ALL', label: `All (${alerts.length})` },
                    ...severityKeys.map((sev) => ({ value: sev, label: `${sev} (${severityCounts[sev]})` }))
                  ]}
                />
              </div>
            </div>

            {groups.map(([severity, rows]) => {
              const collapsedGroup = isCollapsed(severity, rows.length);
              const visible = visibleCount[severity] ?? PAGE_SIZE;
              const shown = rows.slice(0, visible);
              const remaining = rows.length - shown.length;

              return (
                <div key={severity} className="border border-border/70">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(severity, rows.length)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-ink-soft/60 text-left cursor-pointer hover:bg-ink-soft transition-colors"
                  >
                    {collapsedGroup ? (
                      <ChevronRight size={13} className="text-mist shrink-0" />
                    ) : (
                      <ChevronDown size={13} className="text-mist shrink-0" />
                    )}
                    <span className={`font-bold text-[11px] tracking-widest uppercase ${SEVERITY_COLOR[severity] || 'text-mist'}`}>
                      {severity}
                    </span>
                    <span className="text-[10px] text-mist">
                      {rows.length} alert{rows.length === 1 ? '' : 's'}
                    </span>
                  </button>

                  {!collapsedGroup && (
                    <div className="p-3 pt-0 flex flex-col gap-2">
                      <Table
                        rows={shown}
                        keyOf={(a) => a.alert_id}
                        empty="No alerts in this group."
                        columns={[
                          { header: 'Package', cell: (a) => <span className="text-paper font-bold">{a.package_name}</span> },
                          { header: 'Repository', cell: (a) => <span className="text-mist">{a.repo_name}</span> },
                          { header: 'Message', cell: (a) => <span className="text-mist">{a.message}</span> },
                          {
                            header: 'Status',
                            cell: (a) => (
                              <span className={a.status === 'resolved' ? 'text-emerald-400' : 'text-emerald'}>
                                {a.status}
                              </span>
                            )
                          },
                          {
                            header: 'Detected',
                            cell: (a) => (
                              <span className="text-mist whitespace-nowrap">
                                {new Date(a.created_at).toLocaleString()}
                              </span>
                            )
                          },
                          {
                            header: '',
                            cell: (a) =>
                              a.status === 'open' ? (
                                <Button
                                  onClick={() => void handleResolve(a.alert_id)}
                                  loading={resolvingId === a.alert_id}
                                  title="Mark this alert resolved"
                                >
                                  <CheckCircle2 size={13} />
                                  Resolve
                                </Button>
                              ) : (
                                <span className="text-[10px] text-mist">
                                  {a.resolved_at ? new Date(a.resolved_at).toLocaleDateString() : ''}
                                </span>
                              )
                          }
                        ]}
                      />
                      {remaining > 0 && (
                        <Button onClick={() => showMore(severity)}>
                          Show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
