# Factory harness

A config-driven TypeScript CLI (~750 lines, zero build step — Node 24 runs the TS directly) that delivers **programmes** through an autonomous pipeline, running every agent, assert, and app as a direct host child process. There is no container layer — the host (or the disposable VM you run the harness in) is the safety boundary. Per slice (one spec), each pass runs:

```
GENERATE → ASSERT → SMOKE → EVALUATE      (loop until PASS or HARNESS_MAX_PASSES)
```

- **GENERATE** — the Generator agent builds the spec in the programme's shared workspace. Default model on pass 1; cheaper fix model on later passes, auto-escalating back when a finding survives two passes.
- **ASSERT** — deterministic, no model: the manifest's shell commands run against the workspace. Any non-zero exit becomes a synthetic finding and loops straight back to GENERATE without spending the Evaluator.
- **SMOKE** — boots every app the manifest declares as a detached process; readiness is an HTTP response on its port. A crash or timeout becomes a synthetic finding (with the log tail) and loops.
- **EVALUATE** — the adversarial agent drives the live apps by `http://localhost:<port>` URL and writes `findings.json` — the verdict and the single source of truth.

`findings.json` carries stable finding ids across passes: the Generator is told exactly what is still open, the Evaluator reuses ids for surviving issues, and repeat survivors trigger model escalation.

## Setup

```bash
export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"   # or ANTHROPIC_API_KEY
npm run factory -- doctor                 # checks everything, prints fixes
```

Requires the `claude` CLI and `bash` on your PATH (on Windows, Git Bash or WSL provides `bash`).

## Usage

```bash
npm run factory -- run demo               # deliver programmes/demo.yaml
npm run factory -- run demo other …       # several programmes back to back
npm run factory -- status                 # every slice's state
npm run factory -- clean                  # delete all runs
npm run factory:typecheck
```

Environment knobs: `HARNESS_MODEL` (default `opus`), `HARNESS_FIX_MODEL` (`sonnet`), `HARNESS_MAX_PASSES` (`3`), `HARNESS_STAGE_TIMEOUT_S` (`1800`), `HARNESS_APP_READY_S` (`90`).

## Programmes

One YAML manifest per programme under `programmes/` — ordered specs plus optional apps and asserts. Adding a programme is a manifest, never code:

```yaml
name: demo
asserts:                      # deterministic post-GENERATE checks (run in a container)
  - label: hello-runs
    command: test -f hello.py && python3 hello.py
apps:                         # booted for evaluation, each in its own container
  - label: web
    command: python3 -m http.server 3000
    port: 3000
specs:                        # basenames under specs/, delivered strictly in order
  - hello.md
  - goodbye.md
```

Slices are strictly sequential and share one workspace per programme, so later specs build on earlier ones. A failed slice stops its programme (not other programmes); already-passed slices are skipped, and a stopped run resumes at the next pass.

## Run state (append-only)

```
runs/<programme>/
  workspace/                  # the shared workspace all slices build in
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
programmes/       one manifest per programme
specs/            spec markdown, referenced by manifests
```

## Deliberately not here (yet)

Kept out to stay minimal; the seams exist when they're needed: findings redaction/secret scrubbing, cost budgets, rendered findings.md (JSON is the contract), parallel programmes, human-in-the-loop triage, per-stage MCP configs.
