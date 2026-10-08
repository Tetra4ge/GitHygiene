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

Scope is tiered so the build can stop at any tier and still be a working
submission. The AI engine is the differentiator, so it sits in the must-have
tier and breadth is what gets cut — one ecosystem analysed well beats two
analysed shallowly.

### Must have
- **GitHub sign-in** and repository import.
- **Dependency extraction** from `package.json` / `package-lock.json` (npm) and
  `requirements.txt` (PyPI), including transitive packages from the lockfile.
- **Real vulnerability detection** against OSV.dev, with severity and the fixed
  version where one exists.
- **Reachability and remediation engine** — for each finding: is the vulnerable
  code actually called from this repository, and should the user upgrade,
  replace, mitigate or accept it. Grounded in the repository's own source, cited
  to a file and a line. Specified in [AI_DESIGN.md](AI_DESIGN.md).
- **Fix-first ranking** — findings ordered by impact over effort, so a reachable
  medium outranks an unreachable critical.
- **Security score and risk level** per repository, from a simple documented
  formula.
- **Dashboard** listing repositories, scores, and findings by severity *and by
  reachability*.

### Should have
- **Dependency graph** across repositories: blast radius (which repositories one
  advisory reaches, and through which chain), shared dependencies, most-used
  packages.
- **Contribution intelligence** — findings turned into ranked, difficulty-rated,
  draft GitHub issues a new contributor can pick up. Ranking and difficulty are
  computed, not inferred; only the issue prose is model-written.
- **Outdated and deprecated package detection** from the npm and PyPI registries.
- **In-app notifications** when a scan finishes or finds something reachable.

### Stretch
- **Local AI mode** — the same open-weight Gemma 4 models under Ollama, so a
  private repository's code never leaves the machine.
- **PR dependency-risk analysis** — run the engine over the packages a pull
  request adds or bumps.
- Trend charts across repeated scans; more ecosystems (`go.mod`, `Cargo.toml`,
  `pom.xml`); licence compliance.

### Out of scope
- Automatically opening pull requests or modifying user repositories. The
  platform is read-only.
- General source-code bug finding (SAST). Code is read only to answer whether a
  known-vulnerable dependency symbol is used.
- **Sound reachability analysis.** The engine reports evidence, not proof — see
  [AI_DESIGN.md](AI_DESIGN.md) §8. "No evidenced call path" is never presented
  as "safe."
- A general-purpose repository chatbot, architecture explainer, or onboarding
  assistant. Considered and cut: they do not serve this user and an LLM with no
  repository access could fake them convincingly.
- Billing, multi-tenant administration, on-premise deployment.

## 6. Innovation and Differentiation

- **It answers "does this matter in my code?"** Every scanner lists advisories
  present in the dependency tree. This one goes to the repository's own source,
  finds whether the function the advisory blames is actually called, and shows
  the line. That is the manual work the tools leave behind, and it is why their
  output gets muted.
- **It is willing to say no.** Marking a critical finding unreachable, and
  ranking it below a reachable medium, is the output that makes the rest
  credible — and the one a reformatting AI layer can never produce.
- **Cross-repository view.** The graph answers which of an organisation's
  repositories one advisory reaches, and through what chain of packages.
- **Open models, open data.** Two open-weight Gemma 4 models (Apache 2.0) over
  OSV.dev and the public registries — no proprietary feed, and the same weights
  can run locally for private code.
- **Honest about its limits.** The limits are documented in the product, not
  only in the README: a judgement from evidence, not a proof.

## 7. Success Criteria for the Hack Day

The submission succeeds if, in a live demo, a judge can:

1. Sign in with GitHub and scan a real repository.
2. See its findings ordered fix-first, with reachability shown alongside severity.
3. Open a reachable finding, read the verdict, **and open the cited file at the
   cited line to confirm it says what the verdict says it says.**
4. See a higher-severity finding ranked lower because nothing calls it — and see
   the UI decline to call it safe.
5. Read the remediation decision: upgrade, replace, mitigate or accept, with the
   reason, the breaking-change risk and the tests to run.
6. Pick an advisory and see which other repositories it reaches.

Criterion 3 is the demo. Everything else supports it.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Too much scope for one day | Tiered above; phases ordered so each ends demoable; cut breadth before depth |
| The engine analyses false positives | OSV lands before the AI (`Phase_05.md` §2). The current `ILIKE` scanner must not feed the engine |
| The model invents a call site | Evidence retrieval is deterministic and separate; every repository claim must cite a file the search returned, asserted in code |
| "Unreachable" read as "safe" | Fixed UI wording, stated in the README and the demo. The strongest honesty constraint in the project |
| Model returns unparseable output | Strict JSON schemas via function calling, one retry, then a visible "unavailable" |
| LLM cost or latency in the demo | Advisory extraction cached platform-wide; verdicts computed on demand, not for every finding |
| GitHub / OSV / registry rate limits | One tarball per scan rather than per-file fetches; batch OSV; cap registry concurrency |
| A repository has no supported manifest | Report "no supported manifest found" rather than a perfect score |
| AI service cold-start mid-demo | Warm all three services a few minutes before demoing |
