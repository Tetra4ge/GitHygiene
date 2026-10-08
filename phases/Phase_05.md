# Phase 5: Vulnerability & Package Health Scanning

**Tier:** Must have

## 1. Goal
Every scan reports which packages are vulnerable, which are outdated or deprecated, and a security score for the repository. After this phase the product is demoable end to end.

## 2. Tasks

### 2.1 Vulnerabilities from OSV
`server/src/services/osv.js`

**Step 1 — batch query.** Send every package from the scan (direct and transitive) to OSV in batches of up to 1000:

```http
POST https://api.osv.dev/v1/querybatch

{
  "queries": [
    { "package": { "ecosystem": "npm",  "name": "lodash" }, "version": "4.17.20" },
    { "package": { "ecosystem": "PyPI", "name": "django" }, "version": "3.2.0" }
  ]
}
```

The response's `results` array is in the same order as `queries`. Each result has a `vulns` list of `{ id, modified }`, or is empty when the version is clean. Ecosystem names are case-sensitive: `npm` and `PyPI`.

**Step 2 — details.** The batch response contains ids only. Collect the unique ids and fetch each with `GET https://api.osv.dev/v1/vulns/{id}`, a few at a time. From each advisory take:

| Field | Source |
|---|---|
| Summary | `summary` (fall back to the first line of `details`) |
| Aliases | `aliases` — usually contains the CVE id |
| Severity | `database_specific.severity` when present (`LOW` / `MODERATE` / `HIGH` / `CRITICAL`); otherwise `UNKNOWN` |
| Fixed version | The `fixed` event in `affected[].ranges[].events[]` for the matching package |

Store `MODERATE` as `MEDIUM` so the UI has one vocabulary.

Cache advisory details in memory for the life of the process — the same advisory appears across many repositories.

**Step 3 — save.** Insert one `vulnerabilities` row per (dependency, advisory) pair.

### 2.2 Outdated and deprecated packages
`server/src/services/registry.js` — for **direct dependencies only**:

- **npm:** `GET https://registry.npmjs.org/{name}` → `dist-tags.latest` is the latest version; `versions[<installed>].deprecated`, when present, is the deprecation message. Scoped names must be URL-encoded (`@scope%2Fname`).
- **PyPI:** `GET https://pypi.org/pypi/{name}/json` → `info.version` is the latest version.

Run lookups with capped concurrency (around 5 at a time). A failed lookup leaves `latest_version` empty; it does not fail the scan.

Update each dependency row with `latest_version` and `is_deprecated`. A package is "a major version behind" when the first number of `latest_version` is greater than that of `version`.

### 2.3 Score
`server/src/services/scoring.js` — a pure function implementing the table in [TRD §8](../docs/TRD.md). It takes the scan's findings and returns `{ score, riskLevel, breakdown }`. Store `security_score` and `risk_level` on the scan; return `breakdown` from `GET /api/scans/:id` so the UI can show how the score was reached.

Being a pure function, this is the easiest part of the project to unit test — add a few cases (clean repo, one critical, penalty cap, floor at zero).

### 2.4 Pipeline order
`fetch → parse → save dependencies → OSV → registries → score → done`

`GET /api/scans/:id/vulnerabilities` returns findings joined with their package name and version, sorted by severity.

### 2.5 UI
On the repository detail page:
- Score badge coloured by risk level, with the breakdown available on click.
- **Vulnerabilities tab** — severity, package and version, advisory id (linked to `https://osv.dev/vulnerability/{id}`), summary, fixed version.
- **Outdated tab** — package, installed version, latest version, deprecated flag.
- Repository cards on the main page now show the latest score.

## 3. Done When
- Scanning a repository with a known-vulnerable pinned version (for example an old `lodash` or `minimist`) lists the expected advisories with severity and a fixed version.
- Outdated direct dependencies show their latest version.
- A clean repository scores 100; findings reduce the score according to the table.
- An OSV or registry outage produces a failed or partial scan with a clear message, not a crashed server.

## 4. If Short on Time
Skip registry lookups and the Outdated tab. Vulnerabilities and the score are the core of the demo.

## 5. Implementation Status (Current Codebase)

What's actually in the repository today, so this phase's "must have" tasks aren't mistaken for done:

- **Built, but different:** `api-gateway/controllers/scanner.controller.js` runs a different kind of scan than §2.1 describes — it matches the repository's `dependencies` rows against a small seeded `cves` table with an `ILIKE` string search (see `api-gateway/utils/seed-cves.js`), inside a transaction that row-locks the repository for concurrency safety. The controller's own comments describe this as a stand-in "to demonstrate the relational-algebra and normalization requirements," not real vulnerability detection.
- **Not built:** OSV.dev integration (§2.1), npm/PyPI registry lookups for outdated/deprecated packages (§2.2), and the scoring formula (§2.3). `dependencies.latest_version` exists as a column but is currently just set equal to `current_version` on insert (`api-gateway/controllers/parser.controller.js`) — no registry call happens anywhere.
- **Schema difference:** the real schema is `organizations → projects → repositories → dependencies`, not the flat per-user `repositories` this phase's text assumes. Any OSV/scoring work should scope access the same way `scanner.controller.js` already does — `getCallerContext`, an admin bypass, and an org-scoped JOIN — rather than a bare `userId` check.
- **Suggested approach:** add OSV as a second, additive detection path (e.g. a new `osv_vulnerabilities` table) feeding the existing `security_alerts` table, rather than replacing the CVE/`ILIKE` scan above — that scan appears to be graded separately from the hackathon submission (per its own comments) and removing it would be a regression for that purpose.
