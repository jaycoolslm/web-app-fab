# Factory harness

A config-driven TypeScript CLI (~750 lines, zero build step — Node 24 runs the TS directly) that delivers **programmes** through an autonomous pipeline, running every agent, assert, and app as a direct host child process. There is no container layer — the host (or the disposable VM you run the harness in) is the safety boundary. Per slice (one spec), each pass runs:

```
GENERATE → ASSERT → SMOKE → EVALUATE      (loop until PASS or HARNESS_MAX_PASSES)
```

- **GENERATE** — the Generator agent builds the spec on the programme's branch (see [Workspace](#workspace)). Default model on pass 1; cheaper fix model on later passes, auto-escalating back when a finding survives two passes. The dev server is booted *before* this stage so the Generator's nextjs MCP tools have something to attach to (see [MCP](#mcp)), then stopped again — `next build` can't take `.next/lock` while it's running.
- **ASSERT** — deterministic, no model: the manifest's shell commands run against the repo. Any non-zero exit becomes a synthetic finding and loops straight back to GENERATE without spending the Evaluator.
- **SMOKE** — reboots every app as a detached process against the code GENERATE just wrote; readiness is an HTTP response on its port. A crash or timeout becomes a synthetic finding (with the log tail) and loops.
- **EVALUATE** — the adversarial agent drives the live apps by `http://localhost:<port>` URL and writes `findings.json` — the verdict and the single source of truth.

`findings.json` carries stable finding ids across passes: the Generator is told exactly what is still open, the Evaluator reuses ids for surviving issues, and repeat survivors trigger model escalation.

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

## MCP

Both agents get MCP servers, but not the same ones — each stage is spawned with `--mcp-config` plus
`--strict-mcp-config`, so the repo's own `.mcp.json` never leaks in:

| server | Generator | Evaluator |
| --- | --- | --- |
| `supabase` (http, 54321) | ✓ | ✓ |
| `nextjs` (http, 3000) | ✓ | ✓ |
| `shadcn` (stdio) | ✓ | |
| `playwright` (stdio) | | ✓ |

The two HTTP servers are the reason app boot moved above GENERATE: `claude` connects to its MCP servers when the
process spawns, so one that starts mid-turn is never seen. `nextjs` is mounted at `/_next/mcp` by `next dev` only —
`next start` never serves it — which is why the app runs in dev mode.

## Usage

```bash
npm run factory -- run demo               # deliver programmes/demo.yaml
npm run factory -- run demo other …       # several programmes back to back
npm run factory -- status                 # every slice's state
npm run factory -- clean                  # delete all runs
npm run factory:typecheck
```

Environment knobs: `HARNESS_MODEL` (default `claude-opus-5`), `HARNESS_FIX_MODEL` (`claude-sonnet-5`), `HARNESS_MAX_PASSES` (`3`), `HARNESS_STAGE_TIMEOUT_S` (`7200`), `HARNESS_APP_READY_S` (`90`).

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
  - hello.md
  - goodbye.md
```

The Next dev server on 3000 is **not** declared here — the harness boots it for every programme (`apps.ts`), because
it isn't programme-specific and its port is named literally in `mcp/*.json`. Use `apps:` only for something extra on top.

Slices are strictly sequential and share one branch per programme, so later specs build on earlier ones. A failed slice stops its programme (not other programmes); already-passed slices are skipped, and a stopped run resumes at the next pass.

## Workspace

**This repo is the workspace.** It is already the Next + Supabase scaffold with `node_modules` installed, so a
programme gets a branch rather than a copy:

- `run` checks out `factory/<programme>`, cutting it from the current HEAD if it doesn't exist and resuming it if it does.
- Every pass ends in one commit on that branch (`factory(<prog>/<slug>): pass N PASS @ evaluate`), so each pass is a
  reviewable diff and the next programme starts from a clean tree.
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
      findings.json           # the verdict for this pass
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
prompts/          generator.md, evaluator.md
mcp/              per-stage MCP server sets: generator.json, evaluator.json
programmes/       one manifest per programme
specs/            spec markdown, referenced by manifests
```

## Deliberately not here (yet)

Kept out to stay minimal; the seams exist when they're needed: findings redaction/secret scrubbing, cost budgets, rendered findings.md (JSON is the contract), parallel programmes, human-in-the-loop triage.
