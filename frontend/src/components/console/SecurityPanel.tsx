import { useState } from 'react';
import { ShieldAlert, ShieldCheck, Radar } from 'lucide-react';
import { apiError, scannerApi } from '../../lib/api';
import type { Repository, SecurityAlert } from '../../lib/types';
import { Alert, Button, Field, Panel, Table } from './primitives';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'text-danger',
  HIGH: 'text-orange-400',
  MODERATE: 'text-yellow-400',
  LOW: 'text-mist'
};

export default function SecurityPanel({ selectedRepo }: { selectedRepo: Repository | null }) {
  const [repoId, setRepoId] = useState(selectedRepo?.repository_id ?? '');

  const [scanning, setScanning] = useState(false);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await scannerApi.scan(repoId);
      setNotice(
        `Scan complete — ${result.matchesEvaluated} vulnerability match${result.matchesEvaluated === 1 ? '' : 'es'} found, ` +
          `${result.newAlertsRaised} new alert${result.newAlertsRaised === 1 ? '' : 's'} raised.`
      );
      await loadAlerts();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setScanning(false);
    }
  };

  const loadAlerts = async () => {
    if (!repoId) return;
    setLoadingAlerts(true);
    setError(null);
    try {
      setAlerts(await scannerApi.listAlerts(repoId));
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoadingAlerts(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Run a security scan"
        subtitle="CREATE via POST /api/v1/scan — JOINs dependencies against cves, populates the dependency_vulnerabilities junction table"
        icon={<Radar size={18} />}
      >
        <form onSubmit={handleScan} className="flex flex-col gap-4">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <Field
              label="Repository ID"
              value={repoId}
              onChange={setRepoId}
              required
              placeholder="uuid from the tracked repositories table"
              hint="Pick a repo in the Repositories tab to fill this automatically."
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={scanning} disabled={!repoId}>
                <Radar size={13} />
                Run scan
              </Button>
              <Button onClick={() => void loadAlerts()} disabled={!repoId} loading={loadingAlerts}>
                View alerts
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-mist leading-relaxed">
            Matching is simulated against a synthetic CVE dataset (see <code>seed-cves.js</code>) — a
            real package name found inside a mock CVE's description counts as a match. Re-running a
            scan never creates duplicate alerts: only newly detected vulnerability pairings raise one.
          </p>
        </form>
      </Panel>

      {alerts && (
        <Panel
          title="Security alerts"
          subtitle="READ via GET /api/v1/scan/:repositoryId — joined with the offending dependency"
          icon={alerts.length > 0 ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
        >
          <Table
            rows={alerts}
            keyOf={(a) => a.alert_id}
            empty="No vulnerabilities detected for this repository yet."
            columns={[
              {
                header: 'Severity',
                cell: (a) => (
                  <span className={`font-bold uppercase ${SEVERITY_COLOR[a.severity] || 'text-paper'}`}>
                    {a.severity}
                  </span>
                )
              },
              {
                header: 'Package',
                cell: (a) => <span className="text-paper font-bold">{a.package_name}</span>
              },
              {
                header: 'Version',
                cell: (a) => <span className="text-mist">{a.current_version || '—'}</span>
              },
              { header: 'Message', cell: (a) => <span className="text-mist">{a.message}</span> },
              {
                header: 'Status',
                cell: (a) => <span className="text-emerald uppercase">{a.status}</span>
              },
              {
                header: 'Detected',
                cell: (a) => (
                  <span className="text-mist whitespace-nowrap">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                )
              }
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
