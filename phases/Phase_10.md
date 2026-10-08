# Phase 10: Local Mode, Polish, Deployment & Submission

**Tier:** Must have (polish, deployment, submission) · Optional (local mode) · Stretch (PR analysis)

Start this phase with time to spare. A smaller project that is deployed and
documented beats a larger one that only runs on one laptop.

## 1. Optional: local AI mode

Design: [docs/AI_DESIGN.md](../docs/AI_DESIGN.md) §9.

Run the same Gemma 4 weights under Ollama so private repositories never leave the
machine. Stage 2 sends source snippets to the model, so for a private repository
this is a real objection and "the weights are Apache 2.0, run them yourself" is a
real answer — the one thing an API-only competitor structurally cannot offer.

**It is not MVP, for two reasons.** It is an architecture fork, not a config
flag: Ollama is a local HTTP runtime (`http://localhost:11434`) with no bearer
key, so the client needs a third branch beside Gemini and OpenRouter, behind an
`LLM_PROVIDER` variable that does not exist yet. And on its own it does **not**
satisfy the Gemma challenge, which requires Gemma through the Gemini API (§3).

Prompts and schemas are identical across modes — that is the point. Expect
weaker extraction on smaller tags; keep schema validation and the single retry,
so a poor local answer degrades to "unavailable" rather than to a wrong verdict.
Sizes in `AI_DESIGN.md` §9; verify against the Ollama library page before
quoting them.

## 2. Stretch: PR dependency-risk analysis

Narrow version of the PR analyzer: when a pull request changes a manifest or
lockfile, fetch the diff (`GET /repos/{owner}/{repo}/pulls/{n}/files`), resolve
the added or bumped packages, and run the existing engine over them — "this PR
introduces a package with a reachable critical advisory." Reuses Phases 7–8
unchanged, needs one new read call, stays read-only.

General diff review — missing tests, suspicious changes, breaking changes across
arbitrary code — is a different product with a different context builder. Out of
scope; say so rather than half-building it.

## 3. Gemma 4 challenge check

The MLH handbook tells judges to confirm the project *uses a Gemma model through
the Gemini API*, with the model identified in the README and the integration
visible in code or the demo. Before submitting:

- [ ] Both stages call the Gemini API with a Gemma 4 model id
      (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`).
- [ ] The README names both models, their roles, licensing and source.
- [ ] The demo shows AI output that is visibly grounded in the repository.
- [ ] If local mode exists, it is described as an **additional** mode, with the
      Gemini API path as primary.

## 4. End-to-end test

On a fresh account, against the deployed build, not localhost:

1. Sign in with GitHub; import an npm project with a lockfile, a Python project,
   and one with a known-vulnerable dependency.
2. Scan, and check the findings against osv.dev for the same versions by hand.
3. Open a reachable finding; **open the cited file at the cited line and confirm
   it says what the verdict says it says.** If this fails, nothing else in the
   demo matters.
4. Open an unreachable finding; confirm the UI does not call it safe.
5. Blast radius across two repositories.
6. Draft an issue; check the files it names appear in the evidence.
7. Dashboard totals and notifications.

Failure paths too: a repository with no manifest, an expired GitHub session, an
AI key removed mid-session, a repository too large for the tarball cap. Fix
anything that crashes or shows a blank screen.

## 5. Cleanup

- Remove debugging code and unused dependencies. In `api-gateway`: `archiver`
  and `multer` are declared and never imported. In `ai-service`: the vector
  store, Celery and Redis lines, unless Phase 7's build actually used them.
- `docs/DB_SCHEMA.md` **is missing** and `api-gateway/utils/init-db.js` reads it
  to provision a database. A clean clone cannot currently set up its schema.
  Write it — this is the single biggest obstacle to a judge running the project.
- Confirm no secret is committed (`git log -p`), `.env` is ignored, and every
  `.env.example` lists exactly what the code reads.
- Run the production build for `frontend/` and `api-gateway/`.

## 6. Deployment

| Part | Host | Needs |
|---|---|---|
| Frontend | static (Vercel, Netlify) | `VITE_API_*`, `VITE_SUPABASE_*` |
| api-gateway | Node host (Render, Railway) | every server variable; `CLIENT_ORIGIN` = deployed client |
| ai-service | Python host | `GEMINI_API_KEY`, both Gemma model ids |

Add the deployed client URL to Supabase → Authentication → URL Configuration or
sign-in redirects to localhost. Check `/health`. Free tiers sleep — open the app
a few minutes before demoing so the first request is not a cold start, and note
that `ai-service` cold-starting mid-demo is the most likely live failure.

## 7. README

Fill in every section from what exists, not what was planned:

- **Problem, solution, differentiation** — adapted from
  [PRD.md](../docs/PRD.md), trimmed to what shipped.
- **AI usage** — both Gemma 4 models, their ids, licences, sources, what each
  does, input and output, and where inference runs. Per `AGENTS.md` §5.
- **Honest limits** — `AI_DESIGN.md` §8, in the README's own words. A submission
  that states what its reachability analysis cannot do is more credible than one
  that implies soundness, and a judge who finds the limit themselves will
  discount everything else.
- **No unmeasured numbers.** No accuracy or precision claim for the reachability
  verdict unless the team built a labelled set and measured it. "We have not
  evaluated precision" is an acceptable sentence.
- Unfinished PRD features go in "Future work," never in the feature list.

## 8. Demo video

Follow the order in `AI_DESIGN.md` §11 — findings list, a reachable finding with
its cited line open in the repository, an unreachable one ranked lower, the
remediation decision, a drafted issue, one line on the stack. Record against the
deployed app with repositories already imported so the video is not spent
waiting for scans.

Lead with the cited line of code. It is the only thing in the demo that no other
dependency scanner shows.

## 9. Devpost

Complete the project page — description, repository, live app, video,
screenshots, all team members — then add the Devpost URL to the README.

## 10. Done When
Every item in the README's checklist and [AGENTS.md §11](../AGENTS.md) is ticked
honestly:

- The deployed app works for a new user from sign-in to a cited verdict.
- A clean clone runs by following the README alone — **including the database
  schema**.
- The README describes what was built, names both models, and states the limits.
- Live URL, demo video and Devpost URL are in the README.
- No secrets in the repository or its history, and no fabricated claims.
