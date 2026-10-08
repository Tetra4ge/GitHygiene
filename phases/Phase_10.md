# Phase 10: Polish, Deployment & Submission

**Tier:** Must have

## 1. Goal
A deployed, working application, a README that matches what was actually built, a demo video, and a completed Devpost submission.

Start this phase with time to spare. A smaller project that is deployed and documented beats a larger one that only runs on one laptop.

## 2. Tasks

### 2.1 End-to-end test
Run the full flow on a fresh account, against the deployed build, not localhost:

1. Sign in with GitHub.
2. Import two or three repositories — at least one npm project with a lockfile, one Python project, and one with a known-vulnerable dependency.
3. Scan them and check the results against the advisories listed on osv.dev for the same package versions.
4. Open a vulnerability and check its blast radius.
5. Generate an explanation and an upgrade plan.
6. Check the overview totals and notifications.

Also try the failure paths: a repository with no manifest, an expired GitHub session, signing out mid-scan. Fix anything that crashes or shows a blank screen.

### 2.2 Cleanup
- Remove debugging code, unused files, and unused dependencies.
- Confirm no secret is committed: check `git log -p` for keys, and that `.env` is ignored.
- Confirm `.env.example` lists every variable the code reads.
- Run the tests and the production build for both `client/` and `server/`.

### 2.3 Deployment
| Part | Needs |
|---|---|
| Client | A static host (for example Vercel or Netlify). Set `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Server | A Node host (for example Render or Railway). Set every server variable from `.env.example`, with `CLIENT_ORIGIN` set to the deployed client URL |

After deploying:
- Add the deployed client URL to Supabase → Authentication → URL Configuration, or sign-in will redirect to localhost.
- Check `GET /api/health` on the deployed server.
- Free hosting tiers often sleep when idle. Open the app a few minutes before any demo so the first request is not a cold start.

### 2.4 README
Fill in every section of [README.md](../README.md) from the template, describing what exists — not what was planned:

- **Pitch, problem, solution** — adapt from [PRD.md](../docs/PRD.md), trimmed to the features that shipped.
- **Architecture** — the Mermaid diagram from [TRD.md](../docs/TRD.md), with anything not built removed.
- **Technology stack** — fill every row; write `N/A` where a category is not used.
- **Implementation during the hackathon** — what was built during the Hack Day and who did what.
- **Open source and AI usage** — the LLM provider and model and what each AI feature does; OSV.dev, the GitHub API, and the npm / PyPI registries as data sources; the main libraries with their licenses.
- **Setup and usage** — follow the instructions on a clean clone to confirm they work.
- **Challenges and learnings** — what was hard and what was learned.
- **Credits and license** — add a `LICENSE` file (MIT is a common choice for Hacktoberfest projects) and name it in the README.

Features from the PRD that were not finished belong in a short "Future work" list, not in the feature list. Do not include scores, benchmarks, or claims that were not measured.

### 2.5 Demo video
A short walkthrough of the main flow. A script that works:

1. The problem, in one or two sentences.
2. Sign in and import repositories.
3. Run a scan; show vulnerabilities and the score.
4. Blast radius: one advisory, several repositories, the dependency chain.
5. AI explanation and upgrade plan.
6. The overview dashboard.
7. One line on the stack and the open data sources.

Record against the deployed app with repositories already imported, so the video is not spent waiting for scans.

### 2.6 Devpost
Complete the Devpost project page — description, links to the repository, live app, and video, screenshots, and all team members — then add the Devpost URL to the README.

## 3. Done When
Every item in the README's submission checklist and in [AGENTS.md §11](../AGENTS.md) is ticked honestly:

- The deployed application works for a new user from sign-in to results.
- A clean clone runs by following the README alone.
- The README describes the project as built, with team, architecture, AI and open-source usage, challenges, credits, and license.
- The live URL, demo video URL, and Devpost URL are in the README.
- No secrets are in the repository or its history.
