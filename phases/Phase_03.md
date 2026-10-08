# Phase 3: Import GitHub Repositories

**Tier:** Must have

## 1. Goal
A signed-in user can see their GitHub repositories, choose which ones to track, and see the tracked list in the app.

## 2. Tasks

### 2.1 GitHub service
`server/src/services/github.js` — a thin wrapper around `fetch` for the GitHub REST API. Every call sends:

```text
Authorization: Bearer <req.githubToken>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Functions needed now:
- `listUserRepos(token)` → `GET /user/repos?per_page=100&sort=updated`

Map GitHub error statuses to useful messages: `401` → "GitHub session expired, sign in again", `403` with `x-ratelimit-remaining: 0` → "GitHub rate limit reached".

### 2.2 Routes
| Route | Behaviour |
|---|---|
| `GET /api/github/repos` | Returns the user's GitHub repositories (id, full name, language, default branch, visibility), each flagged with whether it is already imported |
| `POST /api/repos` | Body: `{ repos: [{ github_id, full_name, default_branch, language }] }`. Saves them for `req.user.id` |
| `GET /api/repos` | The user's imported repositories |
| `DELETE /api/repos/:id` | Removes one, only if it belongs to the caller |

Importing the same repository twice must not create a duplicate. Use an upsert on the unique (`user_id`, `github_id`) pair:

```js
await supabase
  .from('repositories')
  .upsert(rows, { onConflict: 'user_id,github_id' });
```

Do not trust repository details sent by the client beyond the `github_id`. Re-read the repository list from GitHub with the caller's token and import only ids that appear in it, so a user cannot import a repository they have no access to.

### 2.3 UI
- **Import page** — searchable list of GitHub repositories with checkboxes and an "Import selected" button. Already-imported repositories are shown as such.
- **Repositories page** — cards for each imported repository showing name, language, and "Not scanned yet". This page becomes the main dashboard in later phases.
- Empty state on the repositories page that points to the import page.

## 3. Done When
- The import page lists the signed-in user's real repositories.
- Selected repositories appear on the repositories page and in the `repositories` table.
- Importing the same repository again leaves a single row.
- A user cannot delete or read another user's repository by id.

## 4. If Short on Time
Drop search and pagination. The first 100 most recently updated repositories are enough for a demo.
