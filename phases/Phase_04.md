# Phase 4: Manifest Fetching & Dependency Extraction

**Tier:** Must have

## 1. Goal
Starting a scan on a repository produces a stored list of every package it depends on, with exact versions, and which ones are direct.

## 2. Tasks

### 2.1 Fetch manifests
Add to `server/src/services/github.js`:

- `getFile(token, fullName, path, ref)` → `GET /repos/{owner}/{repo}/contents/{path}?ref={ref}` with `Accept: application/vnd.github.raw+json`. The raw media type returns the file body directly and works for large lockfiles. Return `null` on `404`.

For each scan, look in the repository root for:

| File | Ecosystem | Gives |
|---|---|---|
| `package-lock.json` | npm | Full resolved tree with exact versions |
| `package.json` | npm | Which packages are direct; fallback when there is no lockfile |
| `requirements.txt` | PyPI | Direct dependencies |

If none are found, mark the scan `failed` with the error "No supported manifest found".

### 2.2 Parsers
One module per format under `server/src/services/parsers/`. Each returns the same shape so the rest of the pipeline does not care about the ecosystem:

```js
{
  packages: [{ ecosystem, name, version, isDirect }],
  edges: [{ from: 'npm:a@1.0.0', to: 'npm:b@2.1.0' }],
}
```

**`package-lock.json` (lockfile v2 / v3)**
- Iterate the `packages` object. The `""` key is the project itself; its `dependencies` and `devDependencies` identify direct packages.
- Every other key is a path such as `node_modules/a/node_modules/b`. The package name is the part after the last `node_modules/`; the entry's `version` is the resolved version.
- Skip entries with `link: true` (workspace links).
- For edges: each entry's `dependencies` lists the names it requires. Resolve each name the way Node does — look for `<entry path>/node_modules/<name>`, then walk up one `node_modules` level at a time to the root — and add an edge to the entry found.

**`package.json` (no lockfile)**
- Take `dependencies` and `devDependencies`. Strip range prefixes (`^`, `~`, `>=`) to get an approximate version, and skip anything that is not a plain version (git URLs, `workspace:*`, `*`, `latest`).
- All packages are direct; there are no edges. Flag the scan result as "approximate — no lockfile" so the UI can say so.

**`requirements.txt`**
- Skip blank lines, comments, and option lines (starting with `-`).
- Keep only pinned lines (`name==version`). Unpinned requirements cannot be matched to a vulnerability by version, so count them and report "N unpinned requirements skipped".
- Normalise names: lower-case, with runs of `-`, `_`, `.` replaced by `-`.
- All packages are direct; there are no edges.

Wrap parsing in `try / catch`. A malformed file fails that scan with a readable message.

### 2.3 Scan lifecycle
`POST /api/repos/:id/scan`:
1. Check the repository belongs to the caller.
2. Insert a `scans` row with status `queued` and respond `202 { scan_id }` immediately.
3. Continue in the background (not awaited by the request): set `running`, fetch, parse, bulk-insert into `dependencies`, then set `done` and update `repositories.last_scanned_at`. On any error set `failed` and store the message in `scans.error`.

Put the pipeline in `server/src/services/scanner.js` as a sequence of steps. Phases 5 and 6 add steps to it.

`GET /api/scans/:id` returns status, error, and counts. `GET /api/scans/:id/dependencies` returns the package list.

Insert dependencies in chunks (for example 500 rows per insert); large lockfiles contain thousands of packages.

### 2.4 UI
- "Scan" button on each repository card.
- While a scan is `queued` or `running`, poll `GET /api/scans/:id` every couple of seconds and show progress.
- **Repository detail page** with a dependency table: name, version, ecosystem, direct / transitive. Filter by direct only.

## 3. Done When
- Scanning a repository with a `package-lock.json` stores its full package list, with direct packages marked correctly.
- Scanning a Python repository with a pinned `requirements.txt` stores its packages.
- A repository with no supported manifest ends in `failed` with a clear message shown in the UI.
- The request that starts a scan returns immediately; the UI updates when the scan finishes.

## 4. If Short on Time
Parse packages only and leave `edges` empty. Vulnerability scanning (Phase 5) works without edges; only the transitive paths in the graph phases need them.
