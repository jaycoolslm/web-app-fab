#!/usr/bin/env bash
# Runs INSIDE the container. Generate -> evaluate loop until the evaluator
# says PASS, up to MAX_PASSES.
#
# Layout (mounted by `factory run`):
#   /harness/prompts/   generator.md + evaluator.md   (read-only)
#   /job/spec.md        the spec for this run
#   /job/workspace/     the agent's working directory  (artifacts land here)
#   /job/logs/          full agentic traces, one .jsonl per agent pass
#   /job/eval.txt       latest evaluator verdict (kept out of the workspace)
#
# Exit codes: 0 = PASS, 2 = no PASS within MAX_PASSES, 1 = operational error.
set -euo pipefail

RUN_DIR="${RUN_DIR:-/job}"
PROMPTS="${PROMPTS:-/harness/prompts}"
MODEL="${MODEL:-sonnet}"
MAX_PASSES="${MAX_PASSES:-3}"
PASS_TIMEOUT="${PASS_TIMEOUT:-1800}" # seconds per agent invocation

SPEC_FILE="$RUN_DIR/spec.md"
WORKSPACE="$RUN_DIR/workspace"
LOGS="$RUN_DIR/logs"
EVAL_FILE="$RUN_DIR/eval.txt"

[ -f "$SPEC_FILE" ] || { echo "loop: missing $SPEC_FILE" >&2; exit 1; }
mkdir -p "$WORKSPACE" "$LOGS"
cd "$WORKSPACE"

# $1=role (generator|evaluator)  $2=trace log path  -> prints the agent's final text
agent() {
  local prompt
  prompt="$(cat "$PROMPTS/$1.md")"$'\n\n## Spec\n\n'"$(cat "$SPEC_FILE")"
  # Feed the previous verdict back to the generator without polluting the workspace.
  if [ "$1" = generator ] && [ -s "$EVAL_FILE" ]; then
    prompt+=$'\n\n## Previous evaluation (fix everything raised here)\n\n'"$(cat "$EVAL_FILE")"
  fi
  # --verbose is required for stream-json; the full tool-call trace goes to the
  # log while jq pulls just the final text back out for the PASS check.
  timeout "$PASS_TIMEOUT" claude -p "$prompt" \
      --model "$MODEL" \
      --dangerously-skip-permissions --verbose --output-format stream-json \
    | tee "$2" \
    | jq -rj 'select(.type=="result") | if .is_error then ("agent error: " + (.result // "unknown") + "\n") | halt_error(1) else .result end'
}

for i in $(seq 1 "$MAX_PASSES"); do
  echo "=== pass $i/$MAX_PASSES: GENERATE (trace: logs/gen-$i.jsonl) ==="
  agent generator "$LOGS/gen-$i.jsonl" || { echo "loop: generator failed on pass $i" >&2; exit 1; }
  echo
  echo "=== pass $i/$MAX_PASSES: EVALUATE (trace: logs/eval-$i.jsonl) ==="
  agent evaluator "$LOGS/eval-$i.jsonl" | tee "$EVAL_FILE" || { echo "loop: evaluator failed on pass $i" >&2; exit 1; }
  echo
  if head -1 "$EVAL_FILE" | grep -q '^PASS'; then
    echo "loop: PASS on pass $i"
    exit 0
  fi
done

echo "loop: no PASS after $MAX_PASSES passes — see eval.txt and logs/" >&2
exit 2
