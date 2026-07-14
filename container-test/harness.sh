#!/usr/bin/env bash
# Trigger the container, which runs the generate->evaluate loop.  Usage: ./harness.sh [spec.md]
set -euo pipefail
cd "$(dirname "$0")"
# Auth: prefer a subscription OAuth token (from `claude setup-token`), else fall back to API key.
if   [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then AUTH=(--env CLAUDE_CODE_OAUTH_TOKEN)
elif [ -n "${ANTHROPIC_API_KEY:-}" ];      then AUTH=(--env ANTHROPIC_API_KEY)
else echo "set CLAUDE_CODE_OAUTH_TOKEN (subscription) or ANTHROPIC_API_KEY"; exit 1; fi
container run --rm \
  --mount type=bind,source="$PWD",target=/workspace \
  "${AUTH[@]}" \
  --env SPEC="${1:-spec.md}" \
  --env IS_SANDBOX=1 \
  factory-agent:latest bash loop.sh
