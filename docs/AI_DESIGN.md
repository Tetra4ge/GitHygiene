# AI Design — GitHygiene

Companion to [PRD.md](PRD.md) and [TRD.md](TRD.md). This document is the single
source of truth for **what the AI in GitHygiene does, why it is AI at all, and
which models run it**. The build order lives in [../phases/](../phases/) —
Phases 7 and 8 implement what is specified here.

Nothing in this document is built yet. It is a design, written to be
implemented. `README.md` §9 tracks what is and is not in the repository.

---

## 1. The problem with the previous AI plan

The AI layer was originally three prompt templates (explain an advisory, write
an upgrade plan, summarise a repository) plus a brainstorm list of ten more
ideas in `Phase_08.md` §8. Two things were wrong with it:

**It was a formatter, not an analyst.** Every one of the three features took
data the platform already had — package name, installed version, fixed version,
advisory summary — and reworded it. A user reading the vulnerability table
already knew all of it. An LLM that turns `lodash@4.17.20 / GHSA-xxxx /
CRITICAL / fixed in 4.17.21` into a paragraph saying "you should upgrade lodash
to 4.17.21" has added presentation, not analysis. That is the "decorative
chatbot" failure mode, just with a nicer prompt.

**It never looked at the repository.** The user's actual question is not "what
is this CVE" — osv.dev answers that for free, in better prose than any 26B
model will write. The question is **"does this CVE matter in _my_ code?"**
Answering it needs the one input the old plan never fetched: the repository's
own source. A scanner that reports every advisory in the dependency tree with
equal weight produces exactly the alert fatigue the PRD complains about, and an
LLM that explains all of them more fluently makes the list longer, not shorter.

So the redesign is not "add more AI." It is: point the AI at the gap between
*a package is present* and *the vulnerable code is actually used here*, which is
where the manual work really is, and cut everything that was reformatting.

---

## 2. The test every AI feature has to pass

A feature stays only if all six answers hold.

1. **Input the platform actually has.** Not assumed data, not model recall.
2. **Repository-specific.** The output would be wrong or different for a
   different repository with the same advisory.
3. **Genuinely non-deterministic.** A regex or a SQL query cannot do it. If one
   can, the rule ships instead and the LLM is not called.
4. **Changes what the user does.** It reorders their work, or tells them not to
   do something. Prose they read and discard does not count.
5. **Demoable in under two minutes** on a real public repository, live.
6. **Buildable in the time left**, by this team, on top of what exists.

Rule 3 is the one that cut the most. Several of the proposed features are
genuinely useful and genuinely not AI — they ship as deterministic code in
Phase 9 and are documented as such, because labelling arithmetic "AI" is the
kind of claim `AGENTS.md` §6 forbids.

---

## 3. Verdicts on the ten proposed features

| # | Proposed | Verdict | Where it went |
|---|---|---|---|
| A | AI Security Explainer | **Merged, reframed** | Not a feature of its own. The engine's Stage 3 verdict *is* the explanation, and it is grounded in cited code rather than written from the advisory alone. Phase 8. |
| B | Attack Path Visualization | **Split** | The reachability half is the core of the MVP (Stages 1–3). The "path to the application's entry point" half — taint analysis — is cut; see §8. What ships is: advisory → vulnerable package → dependency path → **the file and line in your code that calls the vulnerable symbol**. Phases 7–9. |
| C | AI Remediation Planner | **Merged** | Half of Stage 3. Phase 8. |
| D | Contributor Task Generator | **Merged, mostly deterministic** | One feature with E and J: *Contribution Intelligence*. One LLM call drafts the issue prose; everything else is computed. Phase 9. |
| E | Good First Issue Finder | **Merged into D** | Same output, same consumer, same context. Two features would have been one feature with two buttons. |
| F | PR Risk Analyzer | **Deferred, narrowed** | Phase 10 stretch, and only for dependency changes in a PR's manifest diff — which reuses the engine unchanged. General diff review is a different product. |
| G | AI Repository Onboarding | **Cut** | Fails test 4. It explains a repository to someone who could read it, serves a different user than the rest of the product, and is the most generic LLM output in the list. The architecture summary it would produce is the part of the whole brainstorm an LLM with no repository access could fake most convincingly. |
| H | Local AI Mode (Ollama) | **Optional mode, not MVP** | Real value, wrong priority, and it does **not** satisfy the Gemma challenge on its own (§7). Phase 10. |
| I | Security Decision Assistant | **Merged** | The other half of Stage 3. Upgrade / replace / mitigate / accept is one decision; asking the model for a plan and then separately asking it to choose would be two calls arguing with each other. Phase 8. |
| J | Contribution Impact Score | **Merged into D, deterministic** | Severity, blast radius and call-site count are numbers the database has. Ranking them is a sort, not an inference. Phase 9. |

Ten features became **one engine, one contributor tool, and two deferred modes**.

---

## 4. The engine: reachability and remediation

One pipeline, three stages, run per (repository, advisory) pair. Stages 1 and 3
are LLM calls. Stage 2 is not.

```text
OSV advisory (prose)
   │
   ├─ Stage 1 ── LLM ──▶ vulnerable surface: which symbols/APIs/configs are at fault
   │
   ├─ Stage 2 ── code ─▶ evidence: does this repo import the package, and call those symbols?
   │                      (deterministic retrieval — GitHub tarball + symbol search)
   │
   └─ Stage 3 ── LLM ──▶ verdict: reachable? + upgrade / replace / mitigate / accept + why
```

### 4.1 Stage 1 — Advisory → vulnerable surface

**Why an LLM.** OSV advisories are human prose. The schema has no standard
field for affected functions: [the OSV schema](https://ossf.github.io/osv-schema/)
leaves that to `affected[].ecosystem_specific`, whose contents are "entirely
defined by the ecosystem" — Rust puts a `functions` array there, Go records
affected symbols, and **npm and PyPI advisories generally do not**. Which is
precisely the ecosystems this project supports. So for an npm advisory the only
place the vulnerable function name exists is inside sentences like *"The
`merge`, `mergeWith` and `defaultsDeep` functions are vulnerable to prototype
pollution when called with user-controlled input."* Extracting
`["merge","mergeWith","defaultsDeep"]` from arbitrary phrasings of that, across
thousands of advisories written by different people, is text comprehension. A
regex for it would be a bad LLM.

**Input:** `id`, `aliases`, `summary`, `details` (the full advisory markdown),
CWE ids, affected version ranges, ecosystem, package name. Nothing from the
user's repository — this stage is repository-independent, which is what makes
it cacheable.

**Output** — strict JSON, schema-validated on arrival:

```json
{
  "vulnerable_symbols":   ["merge", "mergeWith"],
  "vulnerable_subpaths":  ["lodash/fp/merge"],
  "vulnerable_configs":   ["allowPrototypes: true"],
  "trigger_conditions":   ["called with attacker-controlled object keys"],
  "attack_vector":        "prototype-pollution",
  "needs_untrusted_input": true,
  "exploit_requires_runtime": "server",
  "extraction_confidence": "high",
  "notes": "Advisory names three functions explicitly."
}
```

Every list may be empty. `extraction_confidence: "low"` with empty symbols is a
legitimate and common answer — plenty of advisories genuinely do not name a
function — and it must propagate honestly to Stage 3 rather than being
backfilled with a guess.

**Cached by advisory id, globally.** The extraction for `GHSA-xxxx` is identical
for every repository and every user on the platform, so it is computed once and
stored. This is what makes the demo fast and the token cost negligible: the
twenty advisories a demo repository produces are twenty one-off calls, shared by
every later scan.

### 4.2 Stage 2 — Evidence retrieval (no LLM)

Given the symbols from Stage 1, find out whether this repository's own code
touches them. Deterministic, auditable, and the stage that makes the whole
feature honest — an LLM is never asked *whether* the code calls something, only
to interpret code it has been shown.

1. Fetch the repository once: `GET /repos/{owner}/{repo}/tarball/{ref}`, one
   request, extracted to a temporary directory and deleted after the scan. Cap
   the download (suggested 25 MB) and skip `node_modules`, `.git`, `dist`,
   `build`, `vendor`, and binaries. *(The alternative, `GET /search/code`, is
   rate-limited to a handful of requests per minute and indexes only the default
   branch — viable as a fallback, but verify its current limits before relying
   on it.)*
2. Find **import sites**: files that import or require the package
   (`require('lodash')`, `import ... from 'lodash'`, `from lodash import`,
   `import lodash`). Regex per ecosystem is sufficient and is what ships first.
3. Find **call sites**: within those files, references to the Stage 1 symbols —
   `_.merge(`, `merge(`, `lodash.merge(`, and the names bound by the import.
4. Return evidence with provenance:

```json
{
  "package_imported": true,
  "import_sites":  [{ "file": "server/routes/user.js", "line": 3, "text": "const _ = require('lodash');" }],
  "call_sites":    [{ "file": "server/routes/user.js", "line": 47, "symbol": "merge",
                      "snippet": "  const profile = _.merge({}, defaults, req.body);" }],
  "searched_files": 214,
  "truncated": false
}
```

`call_sites: []` with `package_imported: true` is a meaningful result (the
package is there, the vulnerable function is not used). So is
`package_imported: false` for a transitive dependency — your code never touches
it directly; only another package does.

`ai-service/services/ast_parser.py` exists as a stub. **Do not start with an
AST.** Regex over the files that already import the package is enough for a
demo, works across both supported ecosystems without a parser per language, and
degrades to "not evidenced" rather than crashing on syntax it does not know.
Promote to `tree-sitter` only if regex noise shows up in testing.

### 4.3 Stage 3 — Reachability verdict and remediation decision

**Why an LLM.** This is a judgement over heterogeneous evidence that has no
closed-form rule: a critical advisory in a transitive dev-dependency that never
runs in production outranks nothing, while a medium advisory whose exact
vulnerable call sits in a request handler with `req.body` flowing into it is the
thing to fix this afternoon. Weighing *severity against where the call actually
is, what flows into it, how far behind the fix is, and what upgrading would
break* is the analysis a senior engineer performs per finding, and it is the
reason triage takes a day. It cannot be a scoring formula, because the inputs
include a code snippet.

**Input:** Stage 1 extraction, Stage 2 evidence (with the real snippets),
dependency facts (direct or transitive, dependency path from the graph, installed
version, fixed version, latest version, major-version distance, dev or runtime),
and repository facts (is it a library or an application, which files are entry
points by convention, package manager).

**Output** — strict JSON:

```json
{
  "reachability": "reachable",
  "confidence": "medium",
  "evidence": [{ "file": "server/routes/user.js", "line": 47,
                 "why": "vulnerable merge() receives req.body directly" }],
  "recommendation": "upgrade",
  "target_version": "4.17.21",
  "reasoning": "The advisory's named function is called on a request body in an HTTP handler, so the trigger condition the advisory describes is satisfied by this code path.",
  "breaking_change_risk": "low",
  "breaking_change_note": "Patch release within the same major version.",
  "files_to_change": ["package.json", "package-lock.json"],
  "tests_to_run": ["server/routes/__tests__/user.test.js"],
  "side_effects": [],
  "effort": "minutes",
  "alternatives_considered": [
    { "option": "mitigate", "rejected_because": "Sanitising keys at every call site is more work than a patch bump." }
  ],
  "insufficient_evidence": false
}
```

`reachability` is one of `reachable` · `likely_reachable` · `not_evidenced` ·
`unused`. **`not_evidenced` is not `safe`,** and the UI must never render it as
such — dynamic imports, reflection, string-built requires and transitive callers
all defeat static search. The label means "we found no path from your code,"
which is a reason to deprioritise, never a reason to dismiss. This distinction
is the single most important honesty constraint in the product.

`recommendation` is one of `upgrade` · `replace` · `mitigate` · `accept`.
`accept` is a legitimate output (unreachable, low severity, no fix published) and
the model is explicitly permitted to return it, with its reason.

### 4.4 Rules that stay rules

The LLM is not asked for anything the data already answers:

| Question | Answered by |
|---|---|
| Is a fix published? | OSV `fixed` event |
| Is this a major-version jump? | semver comparison |
| Is it direct or transitive? | the `dependencies` table |
| What pulls in this transitive package? | the Neo4j dependency path |
| How many repositories does this advisory reach? | the blast-radius query |
| What is the repository's score? | the scoring formula, [TRD §8](TRD.md) |

Those values are computed and then *handed to* the model as facts, which is also
what stops it inventing them.

### 4.5 Grounding rules

- The model sees only data supplied in the message. It is never asked to recall
  a package, a version or an advisory from training.
- Both stages return JSON validated against a schema. A response that fails
  validation is retried once, then surfaced as "AI analysis unavailable for this
  finding" — never half-parsed and never shown as prose.
- Every claim about the repository must cite a file and line that Stage 2
  actually returned. A verdict citing a file not in the evidence is a bug, and
  is worth asserting in code.
- Findings are capped per request (suggested 30 most severe) and the prompt says
  when the list was truncated.
- Output is labelled AI-generated in the UI, with the evidence shown beside it so
  the user can check the reasoning against the real snippet.

---

## 5. Model registry

Both models are Gemma 4, reached through the Gemini API. Documented per
`AGENTS.md` §5.

| | **Stage 1 — extraction** | **Stage 3 — reasoning** |
|---|---|---|
| Model | Gemma 4 26B A4B (instruction-tuned) | Gemma 4 31B (instruction-tuned, dense) |
| Gemini API id | `gemma-4-26b-a4b-it` | `gemma-4-31b-it` |
| Hugging Face | `google/gemma-4-26B-A4B-it` | `google/gemma-4-31B-it` |
| Provider | Google DeepMind | Google DeepMind |
| License | Apache 2.0 | Apache 2.0 |
| Parameters | 25.2B total, 3.8B active per token (MoE) | 30.7B dense |
| Context | 256K tokens | 256K tokens |
| Task | Advisory prose → structured vulnerable surface | Evidence + code → reachability verdict and remediation decision |
| Input | Advisory text only (no user code) | Extraction + code snippets + dependency facts |
| Output | JSON, ~200 tokens | JSON, ~500 tokens |
| Inference | Remote, Gemini API `generateContent` | Remote, Gemini API `generateContent` |
| Thinking | minimal | high |
| Resources | None local | None local |

Both support native function calling and a configurable thinking level through
the Gemini API, which is how the JSON contracts in §4 are enforced rather than
parsed out of prose.

**Verify before quoting in the README:** the parameter counts, context lengths
and the two API ids above are from Google's own model cards and the Gemini API
Gemma page as read on 2026-10-08. Google's model card also reports 80.0% on
LiveCodeBench v6 and a 2150 Codeforces ELO for the 31B — vendor-reported
figures, not something this project measured, so if you cite them, cite them as
Google's. The Apache 2.0 licensing is stated on the Hugging Face model cards and
in press coverage; `ai.google.dev` also refers to a "Gemma 4 license," so read
the `LICENSE` file in whichever weights you actually pull before making a
licensing claim in the submission.

### 5.1 Why two models and not one

The honest answer is that one model would work. The reason for two is cost and
latency shape, not capability theatre:

- **Stage 1 is high-volume and easy.** One call per advisory, and a demo
  repository can surface dozens. The task is extraction from prose with no code
  involved — the MoE model activates ~3.8B parameters per token, so it is the
  cheapest and fastest option that still reads English reliably. Thinking off.
- **Stage 3 is low-volume and hard.** One call per finding the user actually
  opens, reasoning over real source code, where a wrong verdict is worse than no
  verdict. The dense 31B is the better coder of the two by Google's own
  benchmarks, and thinking is on.

Both run through the same client with the model id as a parameter, so the split
costs one environment variable. If measurement during the build shows the 26B
handles Stage 3 as well, collapse to one model and say so in the README —
that is a better outcome than keeping two for the diagram.

### 5.2 No embedding model

An earlier draft listed `pgvector`, `langchain-postgres` and a Hugging Face
embeddings key in `ai-service/requirements.txt`. The MVP needs none of it.
Semantic retrieval answers "find code that looks like X"; this product asks
"find the string `merge` in the files that import `lodash`," which is exact
search. An embedding index would be slower to build, fuzzier, and harder to
cite a line number from. Leaving it out is the design decision, not an omission.

---

## 6. Contribution Intelligence (Phase 9)

The three contributor features (D, E, J) collapse into one, and it is mostly not
AI — deliberately.

**Deterministic, no model call:**

- **Impact** — advisory severity × blast-radius size (how many of the
  organisation's repositories reach it) × reachability from the engine. All three
  are stored numbers.
- **Difficulty** — from facts, not vibes: direct dependency with a patch-level
  fix and ≤3 call sites → beginner; transitive, or a major-version jump, or no
  fix published → advanced; otherwise intermediate.
- **Ranking** — sort by impact ÷ effort. This is the "fix this first" list, and
  it is a `ORDER BY`, not an inference.

**One LLM call**, Stage 3's model, only when the user asks to draft an issue:
turn a ranked finding plus its evidence into an issue title, body, reproduction
note, suggested files, and acceptance criteria. Drafting prose from structured
facts is a reasonable use of a model; scoring is not.

**Draft-only, by constraint.** `AGENTS.md`, `CLAUDE.md` and [TRD §11](TRD.md)
all state the platform never writes to a user's repository, and the OAuth scopes
in `Phase_02.md` do not include issue creation. The output is copyable text in
the app. Do not add `issues:write` or call `POST /repos/{owner}/{repo}/issues`
without an explicit, separate decision to change that principle.

---

## 7. The Gemma 4 challenge

The hackathon has an optional **Best Use of Gemma 4** partner challenge. The
MLH Hacktoberfest handbook's own winner-selection note is the constraint that
matters: judges are told to *"confirm that the winning project actually uses a
Gemma model through the Gemini API,"* and that teams should identify the model
in their README and show the integration in code or a demo.

Two consequences:

1. **The primary inference path must be the Gemini API**, not a local runtime.
   A project running Gemma only through Ollama would be using Gemma, and would
   still fail that check as written.
2. **OpenRouter is demoted.** `ai-service/.env.example` currently lists
   `OPENROUTER_API_KEY` as primary with `GEMINI_API_KEY` as fallback. For this
   challenge the order inverts: Gemini API with a Gemma 4 model is the default
   path, and anything else is a fallback that the README must not describe as the
   main one.

Gemma 4 is a genuine fit here rather than a prize-shaped bolt-on: both stages
need structured output from a model with native function calling, Stage 3 needs
code reasoning, the 256K context comfortably holds an advisory plus dozens of
code snippets, and the Apache 2.0 open weights are what make §9's local mode
possible at all — the same model, same prompts, different runtime. A closed
model could do Stage 1 and 3 but could never offer the private-repository mode.

**Do not claim the challenge is satisfied until the integration exists and is
shown in the demo.**

---

## 8. What this is not

Stated plainly so the submission does not overclaim, and because the gap between
"reachability analysis" and what a one-day build can do is where this kind of
project usually starts fabricating.

- **Not taint analysis.** Stage 3 reasons over the snippets it is shown. It does
  not trace data flow from an HTTP entry point through the call graph to the
  vulnerable sink. When it says `req.body` reaches `merge()`, that is because
  both appear in a snippet it was given — a judgement, not a proof.
- **Not a reachability guarantee.** `not_evidenced` means static search found
  nothing. Dynamic `require`, reflection, computed property access, build-time
  codegen and transitive callers all evade it.
- **Not a replacement for Dependabot or Snyk.** Those have mature advisory
  pipelines and open PRs. This project is read-only and is about triage — which
  of the findings deserve your afternoon.
- **Not sound on transitive findings.** When your code never imports the
  vulnerable package, the question becomes whether the intermediate package
  calls the vulnerable function, which would mean analysing dependency source
  too. Out of scope; such findings return `not_evidenced` with that stated as
  the reason.
- **Not measured.** No accuracy claim about the reachability verdict belongs in
  the README unless the team actually builds a labelled set and measures it.
  Saying "we have not evaluated precision" is allowed and is better than a
  number nobody computed.

---

## 9. Local mode (Phase 10, optional)

Running the same Gemma 4 weights under Ollama for private repositories.

**Why it is real:** Stage 2 sends source-code snippets to the model. For a
private repository that is a genuine objection, and "the weights are Apache 2.0,
so run them yourself" is a real answer rather than a slogan. It is the one
feature that an API-only competitor structurally cannot offer.

**Why it is not MVP:** it is an architecture fork, not a config flag. Ollama is a
local HTTP runtime (typically `http://localhost:11434`) with no bearer key, so
the client needs a third branch beside Gemini and OpenRouter, selected by an
`LLM_PROVIDER` variable that does not exist yet. It also does not satisfy §7 on
its own. Build it after the engine works, if time remains.

**Sizes** from the Ollama Gemma 4 library page (verify against the page before
publishing — tag sizes change):

| Tag | Download | Context | Use |
|---|---|---|---|
| `gemma4:e4b` | ~6.6–9.5 GB | 128K | Stage 1 on a laptop |
| `gemma4:12b` | ~7.7–8.0 GB | 256K | Both stages, mid-range GPU |
| `gemma4:26b` | ~16–19 GB | 256K | Stage 3 parity, 24 GB card |
| `gemma4:31b` | ~19–20 GB | 256K | Closest to the hosted path |

Prompts and JSON schemas are unchanged between modes — that is the point of the
split. Expect lower extraction reliability on the smaller tags and keep the
schema validation and single retry in place, so a weak local answer degrades to
"unavailable" rather than to a wrong verdict.

---

## 10. Failure, cost, caching

- **No key configured** → AI routes return `503 { error: "AI features are not configured" }`
  and the UI hides the AI affordances. Scanning, scoring, the graph and the
  dashboard are unaffected. The engine is never load-bearing.
- **Caching.** Stage 1 by advisory id, shared platform-wide and effectively
  permanent. Stage 3 by (advisory, repository, dependency version, commit sha) —
  a new commit invalidates it, because the code it reasoned about changed. Both
  stored with the model id that produced them, so a model change is visible in
  the record. A "Regenerate" action bypasses the cache.
- **Cost shape.** Per repository: one Stage 1 call per distinct advisory (shared,
  so usually zero after the first scans) and one Stage 3 call per finding the
  user opens. A demo costs tens of calls, not thousands. Nothing is pre-computed
  for findings nobody looks at.
- **Timeouts.** A per-call timeout, one retry on schema-validation failure, then
  give up visibly.

---

## 11. Demo path

Two minutes, in this order, because it is the order that shows the engine is
doing something a scanner cannot:

1. A scanned repository with real OSV findings, sorted by the fix-first ranking.
2. Open a **`reachable`** finding: show the verdict, then the cited file and line
   next to it, in the repository. *This is the moment the demo is built around —
   the product points at the user's own code.*
3. Open a **`not_evidenced`** finding of higher severity and show it ranked
   lower, with the UI saying "no evidenced call path — not proof of safety."
   Demonstrating restraint is more convincing than another paragraph of prose.
4. The remediation decision on the first finding: upgrade, target version,
   breaking-change note, tests to run.
5. "Draft issue" on the top-ranked finding.
6. One line on the stack: two open-weight Gemma 4 models through the Gemini API,
   OSV for advisories, deterministic code search in between.
