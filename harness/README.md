# Factory harness

Runs coding agents inside Apple `container` micro-VMs to build software against a spec, fully unattended. Each run is a generate → evaluate loop: a Generator agent writes code into an isolated workspace, an Evaluator agent verdicts it against the spec, and the loop repeats (feeding the verdict back) until `PASS` or the pass budget runs out.

The VM is the safety boundary: agents run with `--dangerously-skip-permissions`, but they can only see the per-run job directory (read-write) and the harness scripts/prompts (read-only).

## One-time setup

1. Install the [Apple container CLI](https://github.com/apple/container) and start it:

   ```bash
   container system start
   ```

2. Create the DNS bridge so containers can reach services on your host's localhost (Supabase, the dev server):

   ```bash
   sudo container system dns create host.container.internal --localhost 203.0.113.113
   ```

3. Give the agent credentials — either a subscription token or an API key:

   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"   # or: export ANTHROPIC_API_KEY=...
   ```

4. Build the agent image and check everything:

   ```bash
   ./harness/bin/factory build
   ./harness/bin/factory doctor
   ```

`factory doctor` is the source of truth — it checks each requirement and prints the fix for anything missing.

## Usage

All commands work as `./harness/bin/factory <cmd>` or `npm run factory -- <cmd>`.

```bash
factory run harness/specs/hello.md          # run a spec (also: factory run hello)
factory run my-spec.md --model opus --max-passes 5 --timeout 3600
factory run my-spec.md --supabase           # pass Supabase URL/key into the VM
factory runs                                # list runs and statuses
factory logs                                # verdict + trace paths for the latest run
factory probe                               # verify container -> Supabase connectivity
factory shell                               # interactive debug shell in the agent image
factory clean                               # delete past runs (prompts; -f to skip)
```

Exit codes from `factory run`: `0` PASS, `2` the evaluator never passed it, anything else is an operational error.

## Runs

Every run gets an isolated directory under `harness/runs/<timestamp>-<spec>/` (gitignored):

```
spec.md         frozen copy of the spec
run.json        model, pass budget, status (running | pass | fail | error)
workspace/      the agent's working directory — final artifacts land here
logs/           full agentic traces (every tool call), one .jsonl per pass
eval.txt        the evaluator's latest verdict
```

Nothing in the repo is mounted into the VM, so runs can't touch your checkout.

## Layout

```
bin/factory     host CLI (the only thing you invoke)
image/          Dockerfile for the agent image (claude binary + node, python, jq)
container/      scripts that run inside the VM (loop.sh, probe.sh)
prompts/        Generator and Evaluator system prompts
specs/          bundled example specs
runs/           run outputs (gitignored)
```

## Troubleshooting

- **Builds can't resolve hosts** (`Temporary failure resolving deb.debian.org`): the builder VM has no nameserver. Durable fix: `container builder stop && container builder start --dns 8.8.8.8`. `factory build` also passes `--dns 8.8.8.8` (override with `CONTAINER_DNS=<ip>`).
- **Agent can't reach Supabase**: run `factory doctor`, then `factory probe`. Local `localhost:54321` URLs are rewritten to `host.container.internal` automatically; the DNS bridge from setup step 2 must exist.
- **A run went sideways**: `factory logs <run-id>` shows the verdict and where the full `.jsonl` traces live; `factory shell` gives you the exact environment the agents saw.
