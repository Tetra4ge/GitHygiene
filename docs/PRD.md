# Product Requirements Document (PRD) — GitHygiene

Built for **Hacktoberfest Hack Day — Coimbatore 2026** (INIT CLUB × iDEA CLUB, in collaboration with MLH).

## 1. Vision

One dashboard that tells a developer, for every GitHub repository they own: what it depends on, which of those dependencies are vulnerable or stale, how far the damage spreads, and what to do about it — in plain language.

GitHygiene is not tied to one language ecosystem. It reads dependency manifests from multiple package ecosystems (npm and PyPI first) and puts them in a single view.

## 2. Problem Statement

### The problem
Modern projects are mostly other people's code. A typical repository pulls in hundreds of open-source packages, most of them transitively, and the maintainer never sees them. When a vulnerability is published, answering "am I affected, and through which package?" means jumping between GitHub, a scanner's output, advisory databases, and package registries.

The people hit hardest are the ones with the least tooling: students, solo maintainers, and small open-source teams who look after several repositories and have no security team.

### Why this problem
- Hacktoberfest is about the health of open source, and dependency hygiene is the least glamorous, most neglected part of it.
- Existing tools report findings per repository as long lists of advisory IDs. They rarely answer the cross-repository question ("which of my projects does this one advisory reach?") or explain a finding to someone who is not a security specialist.
- All the data needed is already open: GitHub's API, the OSV vulnerability database, and the public package registries.

## 3. Target Users

| User | What they need |
|---|---|
| Student / solo developer | A quick, understandable health check for their projects |
| Open-source maintainer | To know which advisories actually reach their repositories, and what to upgrade first |
| Small team lead | One view across all the team's repositories instead of one report per repo |

## 4. Solution

The user signs in with GitHub, picks repositories to import, and runs a scan. The platform:

1. Reads the dependency manifests and lockfiles from the repository.
2. Checks every package version against the OSV open vulnerability database and the package registries.
3. Builds a dependency graph across all of the user's repositories.
4. Scores each repository and shows the results on a dashboard.
5. Uses an LLM to explain findings and propose an ordered upgrade plan.

**User flow:**
Sign in with GitHub → Import repositories → Scan → Review vulnerabilities and outdated packages → Explore the dependency graph → Ask the AI what to fix first

## 5. Features and Scope

Scope is tiered so the build can stop at any tier and still be a working submission.

### Must have (the demo depends on these)
- **GitHub sign-in** and repository import.
- **Dependency extraction** from `package.json` / `package-lock.json` (npm) and `requirements.txt` (PyPI).
- **Vulnerability detection** against OSV, with severity and the fixed version where one exists.
- **Outdated and deprecated package detection** from the npm and PyPI registries.
- **Security score and risk level** per repository, from a simple documented formula.
- **Dashboard** listing repositories, their scores, and scan results.

### Should have (what makes it different)
- **Dependency graph** across repositories, with:
  - *Blast radius* — every repository reached by one advisory, and the path it takes.
  - *Shared dependencies* — packages used by several repositories.
  - *Most used packages* — where an upgrade pays off most.
- **AI insights**:
  - Advisory explainer — what the vulnerability is and whether it matters here.
  - Upgrade planner — ordered, concrete upgrade steps for a repository.
  - Repository health summary.
- **In-app notifications** when a scan finishes or finds critical issues.

### Stretch (only if time remains)
- Chat with a repository's scan results in natural language.
- Trend charts across repeated scans.
- More ecosystems (`go.mod`, `Cargo.toml`, `pom.xml`).
- License compliance checks.
- Email delivery of reports.
- Organizations, teams, and roles.

### Out of scope
- Automatically opening pull requests or modifying user repositories. The platform is read-only.
- Scanning source code for bugs (SAST). Only dependencies are analysed.
- Billing, multi-tenant administration, on-premise deployment.

## 6. Innovation and Differentiation

- **Cross-repository view.** Most scanners answer "what is wrong with this repo". The graph answers "which of my repos does this advisory reach, and through what chain of packages".
- **Explanations, not ID lists.** Each finding can be turned into a plain-language explanation and a prioritised plan, grounded in the actual scan data rather than generic advice.
- **Built on open data.** Vulnerability data comes from OSV and package data from public registries — no proprietary feeds, no paid API needed to run the core product.
- **Multi-ecosystem from the start.** One model for packages regardless of where they come from.

## 7. Success Criteria for the Hack Day

The submission is successful if, in a live demo, a judge can:

1. Sign in with a GitHub account.
2. Import a real repository and scan it.
3. See its vulnerable and outdated dependencies with a score.
4. Pick an advisory and see which repositories it reaches.
5. Get an AI-written explanation and upgrade plan for that repository.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Too much scope for one day | Tiered scope above; phases are ordered so each one ends in something demoable |
| GitHub / OSV / registry rate limits | Batch OSV queries, cap concurrency on registry calls, scan on demand rather than on a schedule |
| Large lockfiles slow down scans | Scans run in the background; the UI polls for status |
| LLM gives generic or wrong advice | Prompts contain only the scan's own data; the UI labels AI output as AI-generated |
| A repository has no supported manifest | Report it clearly as "no supported manifest found" rather than showing a perfect score |
