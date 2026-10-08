# Phase 9: Fix-First Ranking, Contribution Intelligence & Dashboard

**Tier:** Must have (ranking, dashboard) · Should have (issue drafting) · Stretch (trends)

Design: [docs/AI_DESIGN.md](../docs/AI_DESIGN.md) §6.

## 1. Goal
Turn a list of findings into an ordered list of work, and turn the top of that
list into something a contributor can pick up. Most of this phase is
deterministic, on purpose.

## 2. Fix-first ranking (no model)

The per-repository score from Phase 5 ranks repositories. This ranks findings
*within* one, and it is the list the dashboard opens on.

```text
impact  = severity_weight × reachability_weight × blast_radius_count
effort  = f(direct/transitive, major-version distance, call-site count, fix published?)
rank    = impact ÷ effort
```

Every input is a stored number: severity from OSV, reachability from Phase 8,
blast radius from the Phase 6 graph, call-site count from Phase 7 Stage 2.
Sorting them is a `ORDER BY`, not an inference, and calling it AI would be the
kind of claim `AGENTS.md` §6 forbids. Keep the weights in one documented
constant so the ordering can be explained on demand, exactly like the score.

A reachable medium outranking an unreachable critical is the output that shows
the engine is doing something — make sure the demo repository produces it.

## 3. Difficulty rating (no model)

From facts, not vibes:

| Rating | When |
|---|---|
| Beginner | direct dependency, patch or minor fix available, ≤3 call sites |
| Intermediate | direct dependency with a minor-version jump, or 4–10 call sites |
| Advanced | transitive, or a major-version jump, or no fix published |

## 4. Issue drafting (one model call)

The only LLM call in this phase, on demand, using Phase 8's model: take a ranked
finding plus its evidence and draft a GitHub issue — title, problem statement,
why it matters, suggested files (from the evidence), scope, acceptance criteria,
skills needed. Difficulty and ranking come from §2–3 and are passed in as facts,
not asked for. Drafting prose from structured facts is a fair use of a model;
scoring is not.

**Draft-only, by constraint.** `AGENTS.md`, `CLAUDE.md` and
[TRD §11](../docs/TRD.md) state the platform never writes to a user's
repository, and the OAuth scopes in `Phase_02.md` do not include issue creation.
The draft is copyable text in the app, with a "copy to clipboard" button and
optionally a prefilled GitHub `new issue` link the *user* submits. Do not request
`issues:write` or call `POST /repos/{owner}/{repo}/issues` without an explicit,
separate decision to change that principle — and if that decision is ever made,
it changes the README's differentiation section too.

## 5. Dashboard

`GET /api/v1/dashboard/summary` — one call, computed from each repository's
latest completed scan (count only the latest, or re-scanning doubles the
numbers; a `latest_scans` view is the simplest way to get that right):

- Repositories tracked, scanned, average score.
- Vulnerability counts by severity **and by reachability** — the second
  breakdown is the one that shows what this product does that others do not.
  "3 reachable of 47 findings" is the whole pitch in one tile.
- The fix-first list, top five, linking to finding detail.
- Riskiest repositories; ecosystem breakdown.
- An empty state pointing at the import page.

Severity colours used consistently everywhere, and never colour alone — always
the label as text too.

## 6. Notifications

At the end of the scan pipeline: scan completed (with score), critical/high
findings raised, scan failed (with reason). The `notifications` table is already
provisioned and currently unused by any route.

Prefer **"2 reachable vulnerabilities found in user/repo"** over a raw count
where reachability is known — a notification nobody trusts gets muted, and raw
counts are what trained people to mute them.

Routes: `GET /notifications` (newest first, unread count),
`PATCH /notifications/:id/read`. Bell with unread badge; poll ~30s while the tab
is visible.

## 7. Trends (stretch)

Every scan keeps its own results, so this is a query, not new data:
`GET /repos/:id/history` → score and finding counts over completed scans; a line
chart on the repository page. It looks sparse in a one-day demo. Build it last,
or not at all.

## 8. Done When
- The fix-first list puts a reachable medium above an unreachable critical, and
  you can explain the ordering from the documented weights.
- Totals do not change when a repository is re-scanned with no changes.
- Difficulty ratings are derived from the table in §3, with no model call.
- A drafted issue names files that appear in that finding's evidence.
- A new user sees a helpful empty state, not zeros and blank charts.
- Nothing in the app claims the ranking or the difficulty rating is AI.

## 9. If Short on Time
Keep the fix-first list and the reachability tile — they are the dashboard's
reason to exist. Drop, in order: trends, notifications, charts, issue drafting.
