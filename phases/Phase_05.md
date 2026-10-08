# Phase 5: Real Vulnerability Data (OSV)

**Tier:** Must have — and a hard prerequisite for Phases 7–9.

## 1. Goal
Every scan reports vulnerabilities that are actually real, from OSV.dev, with
severity, affected range and fixed version, plus a security score. After this
phase the product is demoable end to end without any AI at all.

## 2. Why this phase blocks the AI work

The scanner in the repository today matches a package name against CVE
*descriptions* with `ILIKE '%' || package_name || '%'` against a small seeded
table (`api-gateway/services/scanner.service.js`, `utils/seed-cves.js`). Its own
comments say it is a stand-in to demonstrate set-based relational work, not
vulnerability detection. As a detector it is both wrong directions at once: a
package called `core` or `test` matches CVE text about unrelated software, and a
genuine advisory that does not happen to spell the package name in its prose
is missed.

Phases 7–9 build an AI engine whose entire job is deciding whether a finding
matters in your code. Pointed at `ILIKE` matches, it would spend two model calls
writing a careful, well-cited reachability analysis **of a false positive** — and
it would do it convincingly. That is worse than no AI, and it is the failure the
rest of this plan is designed to avoid. Garbage in, eloquent garbage out.

So: real advisory data first. No exceptions, no "we'll swap the source later."

## 3. Tasks

### 3.1 Keep the existing scanner, add beside it

`scanner.service.js`'s transactional, row-locked, set-based scan appears to be
graded separately from the hackathon submission (per its own comments). Do not
delete it. Add OSV as a second detection path writing to a new table
(`osv_vulnerabilities`), feeding the same `security_alerts` table, and point the
UI and everything downstream at the OSV path.

### 3.2 Batch query

`POST https://api.osv.dev/v1/querybatch`, up to 1000 queries per request:

```json
{ "queries": [
  { "package": { "ecosystem": "npm",  "name": "lodash" }, "version": "4.17.20" },
  { "package": { "ecosystem": "PyPI", "name": "django" }, "version": "3.2.0" }
] }
```

`results` comes back in request order; each has a `vulns` list of `{ id, modified }`
or is empty. Ecosystem names are case-sensitive: `npm`, `PyPI`. No API key.

### 3.3 Advisory details

The batch returns ids only. Fetch each unique id with
`GET https://api.osv.dev/v1/vulns/{id}` (a few concurrently) and keep:

| Field | Source |
|---|---|
| Summary | `summary`, falling back to the first line of `details` |
| **Full details** | `details` — **store this.** Phase 7 Stage 1 reads it; the one-line summary is not enough to extract a function name from |
| Aliases | `aliases` (usually holds the CVE id) |
| Severity | `database_specific.severity` when present, else `UNKNOWN` |
| Fixed version | the `fixed` event in `affected[].ranges[].events[]` for this package |
| Ecosystem specifics | `affected[].ecosystem_specific` — rarely populated for npm/PyPI, but when it names affected functions, Phase 7 can skip its LLM call entirely |

Store `MODERATE` as `MEDIUM` so the UI has one vocabulary. Cache advisory bodies
— the same advisory recurs across repositories, and Phase 7 caches on top of this.

### 3.4 Outdated and deprecated packages

For **direct dependencies only**, capped at ~5 concurrent lookups:

- npm: `GET https://registry.npmjs.org/{name}` → `dist-tags.latest`;
  `versions[<installed>].deprecated` is the deprecation message. URL-encode
  scoped names (`@scope%2Fname`).
- PyPI: `GET https://pypi.org/pypi/{name}/json` → `info.version`.

A failed lookup leaves `latest_version` empty and does not fail the scan. Today
`parser.controller.js` sets `latest_version` equal to the installed version on
insert, which makes every package look current — fix that here.

### 3.5 Score

A pure function implementing [TRD §8](../docs/TRD.md): takes findings, returns
`{ score, riskLevel, breakdown }`. Easiest thing in the project to unit test —
clean repo, one critical, penalty cap, floor at zero.

Note for Phase 9: this score ranks *repositories*. It deliberately does not rank
findings within a repository — that is the reachability-weighted ranking, and it
needs Phase 8.

### 3.6 Pipeline order

`fetch manifest → parse → save dependencies → OSV batch → advisory details → registries → score → alerts`

## 4. Done When
- A repository pinned to a known-vulnerable version (an old `lodash` or
  `minimist`) reports the advisories that osv.dev lists for that exact version —
  checked by hand against the website, same ids, same severities.
- A repository with clean, current dependencies reports **nothing**. Run this
  check explicitly: the `ILIKE` scanner cannot pass it, and it is the one test
  that proves the new path is real.
- Advisory `details` text is stored, not just the summary.
- Outdated direct dependencies show a real `latest_version`.
- An OSV outage produces a clearly failed scan, not a crash and not a silent 100.

## 5. If Short on Time
Skip the registry lookups (§3.4) and the Outdated tab. Do **not** skip OSV —
Phases 7–9 have nothing to reason about without it.

## 6. Implementation Status (Current Codebase)
- **Built:** the `ILIKE` CVE scan described in §3.1, with transaction and row
  lock; `security_alerts` and `dependency_vulnerabilities` tables; org-scoped
  access through `getCallerContext`.
- **Not built:** everything else in this phase — OSV, registries, scoring.
- **Schema note:** the real hierarchy is `organizations → projects →
  repositories → dependencies`, not the per-user model the older phase text
  assumed. Scope new queries the way `scanner.controller.js` already does.
- **Parser gap that matters downstream:** `parser.controller.js` reads only
  `package.json`/`requirements.txt` top-level entries, so only *direct*
  dependencies are stored, and the lockfile is consulted only to pin their
  versions. Transitive packages — the majority of real findings, and the whole
  point of the Phase 6 graph — are never recorded. Phase 4 §2.2 describes the
  full lockfile walk; it is worth finishing before this phase to make the
  findings representative.
