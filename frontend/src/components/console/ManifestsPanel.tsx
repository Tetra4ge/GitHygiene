import { useState } from 'react';
import { FileCode2, PackageSearch } from 'lucide-react';
import { apiError, manifestsApi, parserApi } from '../../lib/api';
import type { Dependency, DependencyFile, Repository } from '../../lib/types';
import { Alert, Button, Field, Panel, Table } from './primitives';

// Quick-fill shortcuts for the common root-level case — the field itself stays
// free text so a monorepo path like "frontend/package.json" can still be typed.
const MANIFEST_PRESETS = [
  { value: 'package.json', label: 'package.json' },
  { value: 'requirements.txt', label: 'requirements.txt' },
  { value: 'go.mod', label: 'go.mod' },
  { value: 'pom.xml', label: 'pom.xml' }
];

export default function ManifestsPanel({ selectedRepo }: { selectedRepo: Repository | null }) {
  // Prefilled from the repo picked in the repositories table. Dashboard keys this
  // component on the repo id, so choosing a different repo remounts with fresh values
  // instead of back-filling through an effect.
  const [repoId, setRepoId] = useState(selectedRepo?.repository_id ?? '');
  const [owner, setOwner] = useState('');
  const [repoName, setRepoName] = useState(selectedRepo?.repo_name ?? '');
  const [filePath, setFilePath] = useState('package.json');

  const [ingesting, setIngesting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ingested, setIngested] = useState<DependencyFile | null>(null);
  const [deps, setDeps] = useState<Dependency[] | null>(null);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngesting(true);
    setError(null);
    setNotice(null);
    setDeps(null);
    try {
      const file = await manifestsApi.ingest({
        repo_id: repoId,
        owner,
        repo_name: repoName,
        file_path: filePath
      });
      setIngested(file);
      setNotice(`Manifest stored as ${file.package_manager} file — ${file.storage_path}`);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setIngesting(false);
    }
  };

  const handleExtract = async () => {
    if (!ingested) return;
    setExtracting(true);
    setError(null);
    try {
      const rows = await parserApi.extract(ingested.file_id);
      setDeps(rows);
      setNotice(`Extracted ${rows.length} dependenc${rows.length === 1 ? 'y' : 'ies'}.`);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Ingest dependency manifest"
        subtitle="CREATE via POST /api/v1/manifests/ingest — GitHub → Supabase Storage → Postgres pointer"
        icon={<FileCode2 size={18} />}
      >
        <form onSubmit={handleIngest} className="flex flex-col gap-4">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Repository ID"
              value={repoId}
              onChange={setRepoId}
              required
              placeholder="uuid from the tracked repositories table"
              hint="Pick a repo in the Repositories tab to fill this automatically."
            />
            <Field
              label="GitHub owner"
              value={owner}
              onChange={setOwner}
              required
              placeholder="your-github-username"
            />
            <Field
              label="GitHub repo name"
              value={repoName}
              onChange={setRepoName}
              required
              hint="Must match the repo_name stored in Postgres."
            />
            <div className="flex flex-col gap-1.5">
              <Field
                label="Manifest file path"
                value={filePath}
                onChange={setFilePath}
                required
                placeholder="package.json"
                hint='Path from the repo root — e.g. "frontend/package.json" for a monorepo.'
              />
              <div className="flex flex-wrap gap-1.5">
                {MANIFEST_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setFilePath(preset.value)}
                    className="px-2 py-1 text-[10px] border border-border/70 text-mist hover:text-paper hover:border-border cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button type="submit" variant="primary" loading={ingesting}>
            Ingest manifest
          </Button>
        </form>
      </Panel>

      {ingested && (
        <Panel
          title="Extract dependencies"
          subtitle="CREATE/UPDATE via POST /api/v1/parser/extract — upserts into the dependencies table"
          icon={<PackageSearch size={18} />}
          actions={
            <Button variant="primary" onClick={() => void handleExtract()} loading={extracting}>
              Parse manifest
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              <div className="bg-ink-soft/50 border border-border/60 p-3">
                <span className="text-[10px] text-mist block mb-1">FILE</span>
                <span className="text-paper font-bold break-all">{ingested.file_name}</span>
              </div>
              <div className="bg-ink-soft/50 border border-border/60 p-3">
                <span className="text-[10px] text-mist block mb-1">PACKAGE MANAGER</span>
                <span className="text-emerald font-bold uppercase">{ingested.package_manager}</span>
              </div>
              <div className="bg-ink-soft/50 border border-border/60 p-3">
                <span className="text-[10px] text-mist block mb-1">FILE ID</span>
                <code className="text-[10px] text-mist select-all break-all">{ingested.file_id}</code>
              </div>
            </div>

            {deps && (
              <Table
                rows={deps}
                keyOf={(d) => d.dependency_id}
                empty="No dependencies found in this manifest."
                columns={[
                  {
                    header: 'Package',
                    cell: (d) => <span className="text-paper font-bold">{d.package_name}</span>
                  },
                  {
                    header: 'Resolved version',
                    cell: (d) => <span className="text-emerald">{d.current_version || '—'}</span>
                  },
                  {
                    header: 'Constraint',
                    cell: (d) => <span className="text-mist">{d.original_constraint || '—'}</span>
                  },
                  {
                    header: 'Manager',
                    cell: (d) => (
                      <span className="text-mist uppercase">{d.package_manager || '—'}</span>
                    )
                  }
                ]}
              />
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
