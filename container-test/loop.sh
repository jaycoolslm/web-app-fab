#!/usr/bin/env bash
# Runs INSIDE the container: generate -> evaluate, looping until PASS (max 3).
# Full agentic trace (every tool call + step) is streamed to logs/*.jsonl on the host;
# jq pulls the final text back out so the PASS check stays clean.
set -euo pipefail
mkdir -p logs

agent() { # $1=prompt file  $2=trace log  -> prints the agent's final text
  claude -p "$(cat "$1")"$'\n\nSpec:\n'"$(cat "$SPEC")" \
    --model sonnet \
    --dangerously-skip-permissions --verbose --output-format stream-json |
    tee "$2" | jq -rj 'select(.type=="result") | .result'
}

for i in 1 2 3; do
  echo "=== pass $i: GENERATE (trace: logs/gen-$i.jsonl) ==="
  agent generator.md "logs/gen-$i.jsonl"
  echo
  echo "=== pass $i: EVALUATE (trace: logs/eval-$i.jsonl) ==="
  agent evaluator.md "logs/eval-$i.jsonl" | tee eval.txt
  echo
  head -1 eval.txt | grep -q '^PASS' && {
    echo "PASS on pass $i"
    exit 0
  }
done
echo "no PASS after 3 passes — see eval.txt and logs/"
