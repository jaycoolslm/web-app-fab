# Factory harness

A config-driven TypeScript CLI (~1100 lines, zero build step — Node 24 runs the TS directly) that delivers **programmes** through an autonomous pipeline, running every agent, assert, and app as a direct host child process. There is no container layer — the host (or the disposable VM you run the harness in) is the safety boundary. Per slice (one spec), each pass runs:

```
GENERATE → ASSERT → SMOKE → EVALUATE → EVALUATE_UX   (loop until PASS or HARNESS_MAX_PASSES)
```

- **GENERATE** — the Generator agent builds the spec on the programme's branch (see [Workspace](#workspace)). Default model on pass 1; cheaper fix model on later passes, auto-escalating back when a finding survives two passes. The dev server is booted *before* this stage so the Generator's nextjs MCP tools have something to attach to (see [MCP](#mcp)), then stopped again — `next build` can't take `.next/lock` while it's running.
- **ASSERT** — deterministic, no model: the manifest's shell commands run against the repo. Any non-zero exit becomes a synthetic finding and loops straight back to GENERATE without spending the Evaluator.
- **SMOKE** — reboots every app as a detached process against the code GENERATE just wrote; readiness is an HTTP response on its port. A crash or timeout becomes a synthetic finding (with the log tail) and loops.
- **EVALUATE** — the adversarial agent drives the live apps by `http://localhost:<port>` URL and judges *functional correctness* against the spec, writing `findings.json`.
- **EVALUATE_UX** — a second agent judges *visual and interaction quality* only, from headless-browser screenshots against a fixed rubric, and writes `findings-ux.json` (findings, no verdict). **Gated**, and skipped entirely when either holds: EVALUATE returned FAIL (the build is going back to the Generator anyway), or the slice isn't flagged [`ux: true`](#programmes) in its manifest. It gets its own shorter timeout and only the playwright MCP server, so vision spend lands only where it can change something.

The two evaluators split because one agent judging both gives UI quality a perfunctory look once functional bugs are in front of it, and because the two want different evidence (accessibility tree and real output vs. screenshots) and different cost profiles.

### Findings and the blocking policy

The harness merges both files into the canonical `findings.json` before recording the pass, so the single source of truth the Generator reads stays a single file. Ids are namespaced — `fn-` for functional, `ux-` for visual — and re-prefixed by the harness if an agent forgets, so the two can never collide across passes. The merged verdict is:

> **FAIL** if any `fn-` finding is open, **or** any open `ux-` finding is `critical` or `major`.
> Open `ux-` findings of severity `minor` are recorded and handed to the Generator to improve, but do **not** on their own fail the slice.

That last clause is deliberate: without it a slice that behaves correctly but has slightly cramped padding burns all three passes and ends `failed`. So a `findings.json` with `"verdict": "PASS"` *can* legitimately carry open minor UX findings.

`findings.json` carries stable finding ids across passes: the Generator is told exactly what is still open, each Evaluator reuses ids for surviving issues, and repeat survivors trigger model escalation. `ux-` ids are filtered out of that escalation input — a vision model naming slightly different cosmetic nits every pass would churn the id set and escalate on noise — but the full unfiltered set is kept in `state.json`.

## Setup

```bash
npm run factory -- doctor                 # checks everything, prints fixes
```

Requires the `claude` CLI and `bash` on your PATH (on Windows, Git Bash or WSL provides `bash`). `claude` picks up
whatever session `claude login` already set up — no token export needed. If you'd rather use key-based auth instead,
`export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"` or `ANTHROPIC_API_KEY` both work too.

`doctor` also checks the three things a run needs, which `run` re-checks and refuses to start without:

- **Supabase up** on 54321 (`npx supabase start`) — the supabase MCP server is that stack.
- **Port 3000 free** — the harness boots the app there for the length of a run, so stop your own `npm run dev` first.
  Without this the agents would drive *that* app instead of the one they're building.
- **Git tree clean** — the harness builds in this repo (see [Workspace](#workspace)), so uncommitted work must be
  committed or stashed first.

It also reports two soft checks that don't block a run: the auth env var, and whether Playwright's Chromium is
already installed (`npx playwright install chromium`). The playwright MCP server will download one on demand, but
that download lands mid-pass, on the clock, in a programme meant to run unattended.

## MCP

Every agent stage gets MCP servers, but not the same ones — each is spawned with `--mcp-config` plus
`--strict-mcp-config`, so the repo's own `.mcp.json` never leaks in:

| server | Generator | Evaluator | UX Evaluator |
| --- | --- | --- | --- |
| `supabase` (http, 54321) | ✓ | ✓ | |
| `nextjs` (http, 3000) | ✓ | ✓ | |
| `shadcn` (stdio) | ✓ | | |
| `playwright` (stdio, headless) | | ✓ | ✓ |

The UX Evaluator gets playwright and nothing else: it judges what it can see, so a database or a build-error tool
would only invite it back into the functional Evaluator's job.

`playwright` runs `--headless`, at a pinned version rather than `@latest`. Headless costs nothing that matters here —
screenshots, the accessibility tree, video and traces all still work, because the browser still renders internally, it
just isn't drawn to a display — and it is what lets the harness run on a server with no desktop environment. The pin
is because an unpinned `@latest` can change behaviour partway through an hours-long serial programme.

The two HTTP servers are the reason app boot moved above GENERATE: `claude` connects to its MCP servers when the
process spawns, so one that starts mid-turn is never seen. `nextjs` is mounted at `/_next/mcp` by `next dev` only —
`next start` never serves it — which is why the app runs in dev mode. Dev mode is also why `next.config.ts` sets
`devIndicators: false` and why the UX Evaluator's rubric explicitly excludes dev-only chrome, asset optimization,
font loading and hydration timing: a vision model would otherwise faithfully report dev-server artifacts as UI
defects and the Generator would spend a pass "fixing" things that don't exist in production.

## Usage

```bash
npm run factory -- run demo               # deliver programmes/demo.yaml
npm run factory -- run demo other …       # several programmes back to back
npm run factory -- status                 # every slice's state
npm run factory -- clean                  # delete all runs
npm run factory:typecheck
```

Environment knobs: `HARNESS_MODEL` (default `claude-opus-5`), `HARNESS_FIX_MODEL` (`claude-sonnet-5`), `HARNESS_MAX_PASSES` (`3`), `HARNESS_STAGE_TIMEOUT_S` (`1800`), `HARNESS_UX_STAGE_TIMEOUT_S` (`900` — EVALUATE_UX's own, shorter budget; the full 1800 on a fifth stage would add up to 30 minutes of worst-case wall clock to every pass), `HARNESS_APP_READY_S` (`90`).

## Programmes

One YAML manifest per programme under `programmes/` — ordered specs plus optional apps and asserts. Adding a programme is a manifest, never code:

```yaml
name: demo
asserts:                      # deterministic post-GENERATE checks
  - label: hello-runs
    command: test -f hello.py && python3 hello.py
apps:                         # OPTIONAL: an extra process alongside the built-in dev server
  - label: worker
    command: python3 worker.py
    port: 4000
specs:                        # basenames under specs/, delivered strictly in order
  - hello.md                  # plain string: no EVALUATE_UX for this slice
  - spec: board.md            # object form: same slice, plus the UX stage
    ux: true
```

`specs:` accepts either form per entry, so no existing manifest needs changing. `ux: true` is what opts a slice into
EVALUATE_UX; leave it off for slices with no UI worth looking at — running a vision evaluator against a slice that is
only auth, schema and RLS is pure waste. See `programmes/incident-desk.yaml`, which flags its two UI slices and not
its foundation slice.

The Next dev server on 3000 is **not** declared here — the harness boots it for every programme (`apps.ts`), because
it isn't programme-specific and its port is named literally in `mcp/*.json`. Use `apps:` only for something extra on top.

Slices are strictly sequential and share one branch per programme, so later specs build on earlier ones. A failed slice stops its programme (not other programmes); already-passed slices are skipped, and a stopped run resumes at the next pass.

## Workspace

**This repo is the workspace.** It is already the Next + Supabase scaffold with `node_modules` installed, so a
programme gets a branch rather than a copy:

- `run` checks out `factory/<programme>`, cutting it from the current HEAD if it doesn't exist and resuming it if it does.
- Every pass ends in one commit on that branch (`factory(<prog>/<slug>): pass N PASS @ evaluate-ux`, naming the stage
  the verdict came from), so each pass is a reviewable diff and the next programme starts from a clean tree.
- Reset with `git checkout main`; start a programme over with `git branch -D factory/<programme>` plus `factory clean`.

Agents run with `--dangerously-skip-permissions` and full host access — the host (or the disposable VM you run the
harness in) is the only real boundary, which is why the branch, not a directory, is what isolates a programme's output.

## Run state (append-only)

Only traces and verdicts live here — the built code lives on the `factory/<programme>` branch.

```
runs/<programme>/
  <slug>/
    state.json                # the one mutable file: status, pass count, verdict history
    pass-N/                   # never overwritten; pass N+1 gets a new directory
      generate.jsonl          # full agentic trace (every tool call)
      evaluate.jsonl
      evaluate-ux.jsonl       # only when EVALUATE_UX ran for this pass
      screenshots/            # the UX Evaluator's evidence, named after its findings
      findings-ux.json        # UX findings only — no verdict
      findings.json           # the merged verdict for this pass
```

## Layout

```
src/cli.ts        run | status | doctor | clean
src/config.ts     model tiering + limits
src/programme.ts  manifest loader
src/pipeline.ts   the pass loop
src/findings.ts   findings.json contract
src/executor.ts   host child processes: agent runs, shell asserts, detached apps
src/apps.ts       app boot / readiness / teardown
prompts/          generator.md, evaluator.md, evaluator-ux.md
mcp/              per-stage MCP server sets: generator.json, evaluator.json, evaluator-ux.json
programmes/       one manifest per programme
specs/            spec markdown, referenced by manifests
```

## Deliberately not here (yet)

Kept out to stay minimal; the seams exist when they're needed: findings redaction/secret scrubbing, cost budgets, rendered findings.md (JSON is the contract), parallel programmes, human-in-the-loop triage.
