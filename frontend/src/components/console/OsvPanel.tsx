import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import { aiApi, apiError, osvApi, reposApi } from '../../lib/api';
import { useAuthStore } from '../../lib/authStore';
import { useResource } from '../../lib/useResource';
import type {
  AssessmentResult,
  IssueDraft,
  OsvFinding,
  Repository
} from '../../lib/types';
import { Alert, Button, Panel, Select, Spinner } from './primitives';

// ── severity colour helpers ───────────────────────────────────────────────────

const SEV_BG: Record<string, string> = {
  CRITICAL: 'bg-danger/10 text-danger border-danger/20',
  HIGH: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  MEDIUM: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  LOW: 'bg-mist/10 text-mist border-mist/20',
  UNKNOWN: 'bg-mist/10 text-mist border-mist/20'
};

const REACH_COLOR: Record<string, string> = {
  reachable: 'text-danger',
  likely_reachable: 'text-orange-400',
  not_evidenced: 'text-mist',
  unused: 'text-mist/50'
};

const REACH_LABEL: Record<string, string> = {
  reachable: 'Reachable',
  likely_reachable: 'Likely reachable',
  not_evidenced: 'No call path found',
  unused: 'Unused'
};

// ── sub-components ────────────────────────────────────────────────────────────

function SevBadge({ severity }: { severity: string }) {
  const s = (severity || 'UNKNOWN').toUpperCase();
  return (
    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${SEV_BG[s] || SEV_BG.UNKNOWN}`}>
      {s}
    </span>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative">
      <pre className="bg-ink border border-border/60 text-[11px] text-emerald font-mono p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
        {code}
      </pre>
      <button
        onClick={copy}
        title="Copy"
        className="absolute top-2 right-2 text-mist hover:text-paper transition-colors"
      >
        <ClipboardCopy size={13} />
      </button>
      {copied && (
        <span className="absolute top-2 right-7 text-[9px] text-emerald font-mono">copied</span>
      )}
    </div>
  );
}

// ── assessment panel ──────────────────────────────────────────────────────────

function AssessmentDetail({
  result,
  onDraftIssue,
  draftLoading,
  draft,
  owner,
  repoName
}: {
  result: AssessmentResult;
  onDraftIssue: () => void;
  draftLoading: boolean;
  draft: IssueDraft | null;
  owner: string;
  repoName: string;
}) {
  const v = result.verdict;
  const r = result.remediation;
  const ev = result.evidence;
  const [showDraft, setShowDraft] = useState(false);

  return (
    <div className="flex flex-col gap-4 text-[11px]">

      {/* verdict banner */}
      <div className="flex items-center gap-3 border border-border/70 px-4 py-3">
        <Bot size={16} className="text-azure shrink-0" />
        <div>
          <span className="text-[9px] uppercase tracking-widest text-mist">AI Verdict · {v.model}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`font-bold text-sm ${REACH_COLOR[v.reachability] || 'text-mist'}`}>
              {REACH_LABEL[v.reachability] || v.reachability}
            </span>
            <span className="text-mist">·</span>
            <span className="text-paper capitalize">{v.recommendation}</span>
            <span className="text-mist">·</span>
            <span className="text-mist capitalize">{v.confidence} confidence</span>
          </div>
        </div>
      </div>

      {/* reachability safety note */}
      {(v.reachability === 'not_evidenced' || v.reachability === 'unused') && (
        <div className="flex gap-2 border border-yellow-400/20 bg-yellow-400/5 text-yellow-400 p-3 leading-relaxed">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            No evidenced call path — <strong>this is not proof of safety.</strong> Dynamic require,
            reflection, and transitive callers defeat static search. Deprioritise; do not dismiss.
          </span>
        </div>
      )}

      {v.insufficient_evidence && (
        <div className="border border-border/50 bg-ink-soft/40 p-3 text-mist leading-relaxed">
          The advisory names no specific function, and the static search found no import sites.
          There is nothing concrete to reason about — the verdict is based on severity alone.
        </div>
      )}

      {/* reasoning */}
      <div>
        <p className="text-[9px] uppercase tracking-widest text-mist mb-1.5">Reasoning</p>
        <p className="text-paper leading-relaxed">{v.reasoning}</p>
      </div>

      {/* evidence */}
      {ev && (ev.call_sites.length > 0 || ev.import_sites.length > 0) && (
        <div>
          <p className="text-[9px] uppercase tracking-widest text-mist mb-1.5">
            Code Evidence ({ev.call_sites.length} call site{ev.call_sites.length !== 1 ? 's' : ''},{' '}
            {ev.searched_files} files searched{ev.truncated ? ', truncated' : ''})
          </p>
          <div className="flex flex-col gap-2">
            {ev.call_sites.map((cs, i) => (
              <div key={i} className="border border-border/60 p-2.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-azure">{cs.file}</span>
                  <span className="text-mist">:{cs.line}</span>
                  <span className="text-mist">·</span>
                  <span className="font-mono text-emerald">{cs.symbol}</span>
                  <a
                    href={`https://github.com/${owner}/${repoName}/blob/HEAD/${cs.file}#L${cs.line}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-mist hover:text-paper transition-colors ml-auto"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
                <pre className="bg-ink font-mono text-[10px] text-paper p-2 overflow-x-auto whitespace-pre-wrap">
                  {cs.snippet}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* remediation */}
      {r && (
        <div>
          <p className="text-[9px] uppercase tracking-widest text-mist mb-1.5">Remediation</p>
          <div className="border border-border/60 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-mist">Strategy:</span>
              <span className="text-paper capitalize">{r.strategy}</span>
              {v.target_version && (
                <>
                  <span className="text-mist">Target:</span>
                  <span className="font-mono text-emerald">{v.target_version}</span>
                </>
              )}
              <span className="text-mist">Effort:</span>
              <span className="text-paper capitalize">{v.effort}</span>
            </div>
            {v.breaking_change_risk !== 'low' && v.breaking_change_note && (
              <div className="flex gap-2 text-yellow-400 border border-yellow-400/20 bg-yellow-400/5 p-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{v.breaking_change_note}</span>
              </div>
            )}
            {r.patch && <CodeBlock code={r.patch} />}
            {r.note && <p className="text-mist leading-relaxed">{r.note}</p>}
          </div>
        </div>
      )}

      {/* draft issue */}
      <div className="border-t border-border/50 pt-3 flex items-center gap-3">
        <Button onClick={onDraftIssue} loading={draftLoading} disabled={draftLoading}>
          <Sparkles size={12} />
          Draft GitHub Issue
        </Button>
        <span className="text-[10px] text-mist">AI-drafted · copy-paste only · platform never writes to your repo</span>
      </div>

      {draft && (
        <div className="border border-border/60 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-widest text-mist">Draft Issue</p>
            <button
              onClick={() => setShowDraft((v) => !v)}
              className="text-mist hover:text-paper transition-colors"
            >
              {showDraft ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          </div>
          {showDraft && (
            <>
              <p className="font-bold text-paper">{draft.title}</p>
              <p className="text-mist leading-relaxed">{draft.problem_statement}</p>
              <p className="leading-relaxed">{draft.why_it_matters}</p>
              <div>
                <p className="text-[9px] uppercase tracking-widest text-mist mb-1">Acceptance criteria</p>
                <ul className="list-disc list-inside space-y-0.5 text-mist">
                  {draft.acceptance_criteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
              {draft.skills_needed.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] uppercase tracking-widest text-mist">Skills:</span>
                  {draft.skills_needed.map((s, i) => (
                    <span key={i} className="border border-border/70 px-2 py-0.5 text-[9px] text-mist">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── main panel ────────────────────────────────────────────────────────────────

interface OsvPanelData {
  repos: Repository[];
  findings: OsvFinding[];
}

const EMPTY_DATA: OsvPanelData = { repos: [], findings: [] };

export default function OsvPanel() {
  const profile = useAuthStore((s) => s.profile);
  const [repoId, setRepoId] = useState('');
  const [owner, setOwner] = useState('');
  const [repoName, setRepoName] = useState('');

  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [assessingId, setAssessingId] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Record<string, AssessmentResult>>({});
  const [drafts, setDrafts] = useState<Record<string, IssueDraft>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // repos list
  const fetchRepos = useCallback(() => reposApi.list(), []);
  const {
    data: repos,
    loading: reposLoading,
    reload: reloadRepos
  } = useResource(fetchRepos, [] as Repository[]);

  // findings for selected repo
  const fetchFindings = useCallback(async (): Promise<OsvFinding[]> => {
    if (!repoId) return [];
    return osvApi.listFindings(repoId);
  }, [repoId]);

  const {
    data: findings,
    loading: findingsLoading,
    reload: reloadFindings
  } = useResource(fetchFindings, [] as OsvFinding[]);

  // When repo selector changes, update owner/repoName for GitHub links
  const handleRepoChange = (id: string) => {
    setRepoId(id);
    setExpanded(null);
    const repo = repos.find((r) => String(r.repository_id) === id);
    if (repo) {
      // repo_name may be "owner/name" or just "name"; use org domain as owner fallback
      const parts = (repo.repo_name || '').split('/');
      if (parts.length >= 2) {
        setOwner(parts[0]);
        setRepoName(parts[1]);
      } else {
        setOwner(profile?.organization_name || '');
        setRepoName(repo.repo_name || '');
      }
    }
  };

  const runScan = async () => {
    if (!repoId) return;
    setScanning(true);
    setNotice(null);
    setError(null);
    try {
      const result = await osvApi.scan(repoId);
      setNotice(
        `Scan complete. ${result.packagesChecked} packages checked · ${result.advisoriesFound} advisories found · score ${result.score}/100 (${result.riskLevel})`
      );
      reloadFindings();
    } catch (e) {
      setError(apiError(e as Error));
    } finally {
      setScanning(false);
    }
  };

  const runAssess = async (finding: OsvFinding) => {
    setAssessingId(finding.finding_id);
    setError(null);
    try {
      const result = await aiApi.assess({
        finding_id: finding.finding_id,
        owner,
        repo_name: repoName
      });
      setAssessments((prev) => ({ ...prev, [finding.finding_id]: result }));
      setExpanded(finding.finding_id);
    } catch (e) {
      setError(`AI assess failed: ${apiError(e as Error)}`);
    } finally {
      setAssessingId(null);
    }
  };

  const runDraftIssue = async (finding: OsvFinding) => {
    const a = assessments[finding.finding_id];
    if (!a) return;
    setDraftingId(finding.finding_id);
    try {
      const draft = await aiApi.draftIssue(a.assessment_id);
      setDrafts((prev) => ({ ...prev, [finding.finding_id]: draft }));
    } catch (e) {
      setError(`Draft failed: ${apiError(e as Error)}`);
    } finally {
      setDraftingId(null);
    }
  };

  const repoOptions = [
    { value: '', label: '— select a repository —' },
    ...repos.map((r) => ({ value: String(r.repository_id), label: r.repo_name }))
  ];

  const grouped: Record<string, OsvFinding[]> = {};
  for (const f of findings) {
    const s = (f.severity || 'UNKNOWN').toUpperCase();
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(f);
  }
  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

  return (
    <Panel
      title="Security Findings"
      icon={<ShieldAlert size={16} />}
      subtitle="Real advisories from OSV.dev, matched by exact package + version. Run the AI engine to assess reachability."
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={repoId}
            onChange={handleRepoChange}
            options={repoOptions}
            disabled={reposLoading}
          />
          <Button onClick={runScan} loading={scanning} disabled={!repoId || scanning}>
            <RefreshCw size={12} />
            {scanning ? 'Scanning…' : 'Run OSV Scan'}
          </Button>
        </div>
      }
    >
      {notice && <Alert variant="success" className="mb-4">{notice}</Alert>}
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {!repoId && (
        <p className="text-[11px] text-mist">Select a repository, then click "Run OSV Scan" to see findings.</p>
      )}

      {repoId && findingsLoading && <Spinner label="LOADING FINDINGS..." />}

      {repoId && !findingsLoading && findings.length === 0 && (
        <p className="text-[11px] text-mist">
          No findings yet for this repository. Run an OSV scan to populate them.
        </p>
      )}

      {findings.length > 0 && (
        <div className="flex flex-col gap-6">
          {severityOrder
            .filter((s) => grouped[s]?.length)
            .map((severity) => (
              <div key={severity}>
                <div className="flex items-center gap-2 mb-3">
                  <SevBadge severity={severity} />
                  <span className="text-[10px] text-mist">{grouped[severity].length} finding{grouped[severity].length !== 1 ? 's' : ''}</span>
                </div>

                <div className="flex flex-col gap-2">
                  {grouped[severity].map((finding) => {
                    const assessment = assessments[finding.finding_id];
                    const isExpanded = expanded === finding.finding_id;
                    const isAssessing = assessingId === finding.finding_id;

                    return (
                      <div key={finding.finding_id} className="border border-border/60">
                        {/* finding row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5">
                          <div className="flex items-start gap-3 min-w-0">
                            <button
                              onClick={() => setExpanded(isExpanded ? null : finding.finding_id)}
                              className="text-mist hover:text-paper mt-0.5 shrink-0 transition-colors"
                              disabled={!assessment}
                              title={assessment ? 'Toggle assessment' : 'Run assessment first'}
                            >
                              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-paper text-[12px]">{finding.package_name}</span>
                                <span className="font-mono text-mist text-[10px]">{finding.current_version}</span>
                                {finding.is_direct && (
                                  <span className="border border-azure/30 text-azure text-[9px] px-1.5 py-0.5">direct</span>
                                )}
                                {finding.ecosystem && (
                                  <span className="border border-border/50 text-mist text-[9px] px-1.5 py-0.5">
                                    {finding.ecosystem}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-mist mt-0.5 truncate max-w-xs sm:max-w-md">
                                {finding.osv_id}
                                {finding.fixed_version && (
                                  <> · fix: <span className="text-emerald font-mono">{finding.fixed_version}</span></>
                                )}
                              </p>
                              <p className="text-[10px] text-mist/80 mt-0.5 line-clamp-2">{finding.summary}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-6 sm:ml-0">
                            {assessment && (
                              <span className={`text-[10px] font-bold ${REACH_COLOR[assessment.verdict.reachability] || 'text-mist'}`}>
                                {REACH_LABEL[assessment.verdict.reachability] || assessment.verdict.reachability}
                              </span>
                            )}
                            <Button
                              onClick={() => runAssess(finding)}
                              loading={isAssessing}
                              disabled={!!assessingId}
                              variant={assessment ? 'ghost' : 'default'}
                              title="Run AI reachability assessment"
                            >
                              <Bot size={12} />
                              {assessment ? 'Re-assess' : 'Assess'}
                            </Button>
                          </div>
                        </div>

                        {/* expanded assessment */}
                        {isExpanded && assessment && (
                          <div className="border-t border-border/60 px-4 py-4 bg-ink-soft/20">
                            <AssessmentDetail
                              result={assessment}
                              onDraftIssue={() => runDraftIssue(finding)}
                              draftLoading={draftingId === finding.finding_id}
                              draft={drafts[finding.finding_id] ?? null}
                              owner={owner}
                              repoName={repoName}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}
    </Panel>
  );
}
