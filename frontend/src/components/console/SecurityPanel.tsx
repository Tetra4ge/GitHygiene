import { useState } from 'react';
import { ShieldAlert, ShieldCheck, Radar, ExternalLink, Sparkles } from 'lucide-react';
import { aiApi, apiError, osvApi, scannerApi } from '../../lib/api';
import type { AssessmentResult, IssueDraft, OsvFinding, OsvScanResult, Repository, SecurityAlert } from '../../lib/types';
import { Alert, Button, Field, Panel, Table } from './primitives';

const REACHABILITY_LABEL: Record<string, string> = {
  reachable: 'Reachable',
  likely_reachable: 'Likely reachable',
  not_evidenced: 'No evidenced call path — not proof of safety',
  unused: 'Imported, not used'
};

const REACHABILITY_COLOR: Record<string, string> = {
  reachable: 'text-danger',
  likely_reachable: 'text-orange-400',
  not_evidenced: 'text-mist',
  unused: 'text-emerald'
};

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'text-danger',
  HIGH: 'text-orange-400',
  MODERATE: 'text-yellow-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-mist',
  UNKNOWN: 'text-mist'
};

const RISK_COLOR: Record<string, string> = {
  low: 'text-emerald',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-danger'
};

export default function SecurityPanel({ selectedRepo }: { selectedRepo: Repository | null }) {
  const [repoId, setRepoId] = useState(selectedRepo?.repository_id ?? '');

  const [scanning, setScanning] = useState(false);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);

  const [osvScanning, setOsvScanning] = useState(false);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const [osvError, setOsvError] = useState<string | null>(null);
  const [osvResult, setOsvResult] = useState<OsvScanResult | null>(null);
  const [findings, setFindings] = useState<OsvFinding[] | null>(null);

  const [owner, setOwner] = useState('');
  const [assessingId, setAssessingId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [activeVerdict, setActiveVerdict] = useState<{ finding: OsvFinding; result: AssessmentResult } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [issueDraft, setIssueDraft] = useState<IssueDraft | null>(null);

  const handleDraftIssue = async () => {
    if (!activeVerdict) return;
    setDrafting(true);
    setAiError(null);
    try {
      setIssueDraft(await aiApi.draftIssue(activeVerdict.result.assessment_id));
    } catch (err) {
      setAiError(apiError(err));
    } finally {
      setDrafting(false);
    }
  };

  const handleAssess = async (finding: OsvFinding) => {
    if (!owner) {
      setAiError('Enter the GitHub owner (org/user) below the findings table first.');
      return;
    }
    setAssessingId(finding.finding_id);
    setAiError(null);
    try {
      const result = await aiApi.assess({ finding_id: finding.finding_id, owner });
      setActiveVerdict({ finding, result });
      setIssueDraft(null);
    } catch (err) {
      setAiError(apiError(err));
    } finally {
      setAssessingId(null);
    }
  };

  const handleOsvScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setOsvScanning(true);
    setOsvError(null);
    try {
      const result = await osvApi.scan(repoId);
      setOsvResult(result);
      await loadFindings();
    } catch (err) {
      setOsvError(apiError(err));
    } finally {
      setOsvScanning(false);
    }
  };

  const loadFindings = async () => {
    if (!repoId) return;
    setLoadingFindings(true);
    setOsvError(null);
    try {
      setFindings(await osvApi.listFindings(repoId));
    } catch (err) {
      setOsvError(apiError(err));
    } finally {
      setLoadingFindings(false);
    }
  };

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
        title="Real vulnerability scan (OSV.dev)"
        subtitle="CREATE via POST /api/v1/osv/scan — batch-queries osv.dev for every dependency's exact version, no seeded data"
        icon={<ShieldAlert size={18} />}
      >
        <form onSubmit={handleOsvScan} className="flex flex-col gap-4">
          {osvError && <Alert kind="error">{osvError}</Alert>}
          {osvResult && (
            <Alert kind="success">
              Scan complete — {osvResult.packagesChecked} packages checked, {osvResult.advisoriesFound}{' '}
              advisories found ({osvResult.newFindings} new). Score:{' '}
              <span className={`font-bold ${RISK_COLOR[osvResult.riskLevel]}`}>
                {osvResult.score}/100 ({osvResult.riskLevel})
              </span>
            </Alert>
          )}

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
              <Button type="submit" variant="primary" loading={osvScanning} disabled={!repoId}>
                <ShieldAlert size={13} />
                Run OSV scan
              </Button>
              <Button onClick={() => void loadFindings()} disabled={!repoId} loading={loadingFindings}>
                View findings
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-mist leading-relaxed">
            Matches dependencies against real osv.dev advisories by exact package + version. Direct
            dependencies are also checked against the npm/PyPI registries for outdated and deprecated
            packages. The repository score (TRD §8) is recomputed on every scan.
          </p>
        </form>
      </Panel>

      {findings && (
        <Panel
          title="OSV findings"
          subtitle="READ via GET /api/v1/osv/findings — joined with the cached advisory and the offending dependency"
          icon={findings.length > 0 ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
        >
          <div className="mb-4 flex items-end gap-4">
            <Field
              label="GitHub owner (org/user)"
              value={owner}
              onChange={setOwner}
              placeholder="octocat"
              hint="Needed to fetch the repository's source for the AI reachability check (Phases 7-8)."
            />
          </div>
          {aiError && <Alert kind="error">{aiError}</Alert>}
          <Table
            rows={findings}
            keyOf={(f) => f.finding_id}
            empty="No real advisories found for this repository's current dependencies."
            columns={[
              {
                header: 'Severity',
                cell: (f) => (
                  <span className={`font-bold uppercase ${SEVERITY_COLOR[f.severity] || 'text-paper'}`}>
                    {f.severity}
                  </span>
                )
              },
              {
                header: 'Package',
                cell: (f) => (
                  <span className="text-paper font-bold">
                    {f.package_name}
                    {!f.is_direct && <span className="text-mist font-normal"> (transitive)</span>}
                  </span>
                )
              },
              { header: 'Version', cell: (f) => <span className="text-mist">{f.current_version || '—'}</span> },
              { header: 'Fixed in', cell: (f) => <span className="text-emerald">{f.fixed_version || 'none published'}</span> },
              { header: 'Summary', cell: (f) => <span className="text-mist">{f.summary}</span> },
              {
                header: 'Advisory',
                cell: (f) => (
                  <a
                    href={`https://osv.dev/vulnerability/${f.osv_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-azure flex items-center gap-1 whitespace-nowrap"
                  >
                    {f.osv_id}
                    <ExternalLink size={11} />
                  </a>
                )
              },
              {
                header: 'AI',
                cell: (f) => (
                  <Button
                    onClick={() => void handleAssess(f)}
                    loading={assessingId === f.finding_id}
                    disabled={!owner}
                    title="Is this reachable from this repository's own code?"
                  >
                    <Sparkles size={13} />
                    Assess
                  </Button>
                )
              }
            ]}
          />
        </Panel>
      )}

      {activeVerdict && (
        <Panel
          title={`AI verdict — ${activeVerdict.finding.package_name} (${activeVerdict.result.osv_id})`}
          subtitle={`AI-generated via ${activeVerdict.result.model} — POST /api/v1/ai/assess`}
          icon={<Sparkles size={18} />}
          actions={
            <Button variant="ghost" onClick={() => setActiveVerdict(null)}>
              Close
            </Button>
          }
        >
          <div className="flex flex-col gap-4 text-[11px]">
            <div className="flex items-center gap-3">
              <span
                className={`font-bold uppercase ${REACHABILITY_COLOR[activeVerdict.result.verdict.reachability]}`}
              >
                {REACHABILITY_LABEL[activeVerdict.result.verdict.reachability]}
              </span>
              <span className="text-mist">confidence: {activeVerdict.result.verdict.confidence}</span>
              {activeVerdict.result.verdict.insufficient_evidence && (
                <span className="text-yellow-400">insufficient evidence</span>
              )}
            </div>

            <p className="text-mist leading-relaxed">{activeVerdict.result.verdict.reasoning}</p>

            {activeVerdict.result.verdict.evidence.length > 0 && (
              <div className="border border-border/70 p-3 flex flex-col gap-2">
                <span className="text-paper font-bold">Cited evidence</span>
                {activeVerdict.result.verdict.evidence.map((e, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-azure">
                      {e.file}:{e.line}
                    </span>
                    <span className="text-mist">{e.why}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-paper font-bold">Recommendation: </span>
                <span className="text-emerald uppercase">{activeVerdict.result.verdict.recommendation}</span>
                {activeVerdict.result.verdict.target_version && (
                  <span className="text-mist"> → {activeVerdict.result.verdict.target_version}</span>
                )}
              </div>
              <div>
                <span className="text-paper font-bold">Effort: </span>
                <span className="text-mist">{activeVerdict.result.verdict.effort}</span>
                <span className="text-paper font-bold"> · Breaking risk: </span>
                <span className="text-mist">{activeVerdict.result.verdict.breaking_change_risk}</span>
              </div>
            </div>

            {activeVerdict.result.remediation.patch && (
              <div className="flex flex-col gap-1">
                <span className="text-paper font-bold">
                  Remediation ({activeVerdict.result.remediation.strategy})
                </span>
                <pre className="bg-ink-soft/50 border border-border/70 p-3 overflow-x-auto whitespace-pre-wrap">
                  {activeVerdict.result.remediation.patch}
                </pre>
                {activeVerdict.result.remediation.note && (
                  <span className="text-mist">{activeVerdict.result.remediation.note}</span>
                )}
              </div>
            )}

            <p className="text-[10px] text-mist leading-relaxed">
              AI-generated — static search, not a reachability guarantee. "No evidenced call path" means
              nothing was found, not that the code is safe.
            </p>

            <div className="border-t border-border/50 pt-4 flex flex-col gap-3">
              <Button onClick={() => void handleDraftIssue()} loading={drafting}>
                <Sparkles size={13} />
                Draft a contributor issue
              </Button>

              {issueDraft && (
                <div className="border border-border/70 p-3 flex flex-col gap-2">
                  <span className="text-paper font-bold">{issueDraft.title}</span>
                  <p className="text-mist leading-relaxed">{issueDraft.problem_statement}</p>
                  <p className="text-mist leading-relaxed">
                    <span className="text-paper font-bold">Why it matters: </span>
                    {issueDraft.why_it_matters}
                  </p>
                  <p className="text-mist leading-relaxed">
                    <span className="text-paper font-bold">Scope: </span>
                    {issueDraft.scope}
                  </p>
                  {issueDraft.suggested_files.length > 0 && (
                    <div>
                      <span className="text-paper font-bold">Suggested files: </span>
                      <span className="text-azure">{issueDraft.suggested_files.join(', ')}</span>
                    </div>
                  )}
                  {issueDraft.acceptance_criteria.length > 0 && (
                    <div>
                      <span className="text-paper font-bold">Acceptance criteria:</span>
                      <ul className="list-disc list-inside text-mist">
                        {issueDraft.acceptance_criteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button
                    onClick={() => {
                      const body = [
                        issueDraft.problem_statement,
                        '',
                        `**Why it matters:** ${issueDraft.why_it_matters}`,
                        '',
                        `**Scope:** ${issueDraft.scope}`,
                        issueDraft.suggested_files.length
                          ? `\n**Suggested files:** ${issueDraft.suggested_files.join(', ')}`
                          : '',
                        issueDraft.acceptance_criteria.length
                          ? `\n**Acceptance criteria:**\n${issueDraft.acceptance_criteria.map((c) => `- ${c}`).join('\n')}`
                          : ''
                      ].join('\n');
                      void navigator.clipboard.writeText(`${issueDraft.title}\n\n${body}`);
                    }}
                  >
                    Copy to clipboard
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}

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
