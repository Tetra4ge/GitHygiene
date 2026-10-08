# GitHygiene — Build Plan

Ten phases, in order. Each is self-contained, tiered, and ends in a "Done when"
checklist. Build must-haves first so the project is always demoable.

| Phase | Title | Tier | State |
|---|---|---|---|
| [1](Phase_01.md) | Project Scaffold & Environment | Must | Mostly built |
| [2](Phase_02.md) | Sign In with GitHub | Must | Built |
| [3](Phase_03.md) | Import GitHub Repositories | Must | Built |
| [4](Phase_04.md) | Manifest Fetching & Dependency Extraction | Must | Built — full lockfile walk, direct + transitive, with edges |
| [5](Phase_05.md) | **Real Vulnerability Data (OSV)** | Must | Built — OSV batch scan, registry lookups, scoring |
| [6](Phase_06.md) | Dependency Graph and Blast Radius | Should | Built — write + read, 503 on Neo4j failure (unverified live, see §8 note) |
| [7](Phase_07.md) | **AI Engine 1 — Vulnerable Surface & Code Evidence** | Must | Built — npm full, PyPI best-effort |
| [8](Phase_08.md) | **AI Engine 2 — Reachability Verdict & Remediation** | Must | Built — direct-bump/override only (no lift-parent) |
| [9](Phase_09.md) | Fix-First Ranking, Contribution Intelligence & Dashboard | Must | Built — ranking, dashboard, notifications, issue drafting. Trends not built |
| [10](Phase_10.md) | Local Mode, Polish, Deployment & Submission | Must | Code-level cleanup done (schema doc, dead deps, README); local mode, actual deployment, demo video and Devpost not done |

## What changed in this plan

The earlier plan had one AI phase containing three prompt templates that
reworded data the user could already see, plus a brainstorm list of ten more
ideas. It has been replaced by **one engine across Phases 7 and 8** that answers
the question a scanner leaves on the user's desk: *does this vulnerability
actually matter in my code?*

- Graph writing and graph querying merged into Phase 6, freeing a phase.
- Phase 5 is now explicitly a prerequisite for the AI, because the current
  scanner's `ILIKE` matching would feed the engine false positives to analyse.
- Phase 4's missing transitive dependency walk is called out as blocking.
- Ranking, difficulty rating and impact scoring are **deterministic** in Phase 9
  and documented as not-AI.
- Repository onboarding was cut; local Ollama mode and PR analysis deferred.

Rationale for every one of those decisions, the per-feature verdicts, the model
registry and the honest limits: **[docs/AI_DESIGN.md](../docs/AI_DESIGN.md)**.

## The critical path

```text
Phase 4 (transitive deps) ──▶ Phase 5 (OSV) ──▶ Phase 7 (evidence) ──▶ Phase 8 (verdict) ──▶ Phase 9 (ranking)
                                    └──────────▶ Phase 6 (graph) ─────────┘
```

Phase 6 is a should-have: the engine runs without it, with "dependency path
unknown" as an input. Phases 4, 5, 7 and 8 are the spine — if time runs out,
cut breadth (one ecosystem, fewer repositories) rather than cutting a stage out
of the middle of that chain.
