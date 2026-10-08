# Phase 9: Dashboard, Analytics & Notifications

**Tier:** Must have (overview) · Should have (notifications) · Stretch (trends)

## 1. Goal
The first screen after sign-in gives a complete picture across all repositories, and the user is told when a scan finishes or finds something serious.

## 2. Tasks

### 2.1 Dashboard summary
`GET /api/dashboard/summary` returns everything the overview needs in one call, computed from each repository's **latest completed scan**:

```json
{
  "repositories": 6,
  "scanned": 5,
  "averageScore": 72,
  "vulnerabilities": { "critical": 1, "high": 4, "medium": 9, "low": 3, "unknown": 0 },
  "outdated": 27,
  "riskiest": [{ "id": "...", "full_name": "user/api", "score": 31, "risk_level": "high" }],
  "ecosystems": [{ "ecosystem": "npm", "packages": 812 }, { "ecosystem": "PyPI", "packages": 44 }]
}
```

Only the latest scan per repository counts — otherwise re-scanning a repository would double its numbers. The simplest way to get this right is a Postgres view (for example `latest_scans`, selecting the most recent `done` scan per repository) that the summary queries build on.

### 2.2 Overview page
- **Stat tiles** — repositories tracked, average score, open vulnerabilities, outdated packages.
- **Severity chart** — vulnerabilities by severity (Recharts bar or donut).
- **Riskiest repositories** — the five lowest scores, linking to their detail pages.
- **Ecosystem breakdown** — packages per ecosystem.
- **Scan all** — starts a scan for every repository, a few at a time rather than all at once.
- An empty state for new users that points to the import page.

Use the severity colours consistently everywhere in the app (overview, tables, graph, badges), and never rely on colour alone — always show the severity label as text too.

### 2.3 Notifications
Create notifications at the end of the scan pipeline:

| Event | Notification |
|---|---|
| Scan completed | "Scan finished for `user/repo` — score 72" |
| Scan found critical or high findings | "2 critical vulnerabilities found in `user/repo`" |
| Scan failed | "Scan failed for `user/repo`: <reason>" |

Routes: `GET /api/notifications` (newest first, with an unread count) and `PATCH /api/notifications/:id/read`.

UI: a bell in the app shell with an unread badge and a dropdown list. Clicking a notification marks it read and opens the related repository. Poll every 30 seconds or so while the tab is visible.

### 2.4 Trends (stretch)
Because every scan keeps its own results, trends need no new data — only a query over past scans.

- `GET /api/repos/:id/history` → `[{ finished_at, security_score, vulnerability_count }]` for completed scans, oldest first.
- A line chart of score over time on the repository detail page.

This only becomes interesting once a repository has been scanned several times, so it will look sparse in a one-day demo. Build it last.

### 2.5 Consistency pass
- Every list has loading, empty, and error states.
- Every page works at laptop width and does not break on a phone.
- The same severity order (critical → low) is used in every table and chart.

## 3. Done When
- The overview shows correct totals for a user with several scanned repositories, and the totals do not change when a repository is re-scanned with no changes.
- A new user sees a helpful empty state rather than zeros and blank charts.
- Finishing a scan produces a notification, and the unread badge clears when it is opened.
- A scan with critical findings produces the critical-findings notification.

## 4. If Short on Time
Keep the stat tiles and the riskiest-repositories list. Drop the charts, then notifications, then trends.
