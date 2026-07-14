#!/usr/bin/env bash
# Little end-to-end test for the containerized agent + Supabase connection.
#
#   ./test.sh              build image, then verify container -> Supabase connectivity
#   ./test.sh --claude     also run `claude -p` headless and let the AGENT hit Supabase itself
#                          (needs ANTHROPIC_API_KEY in your shell)
#
# Reads Supabase config from ../.env.local (or ../.env). If the URL points at
# localhost/127.0.0.1 (local `supabase start`), it's rewritten to the host DNS bridge
# so the container can reach the host — create that bridge once with:
#   sudo container system dns create host.container.internal --localhost 203.0.113.113
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

# ── load Supabase env from the app's dotenv ──────────────────────────────────
ENV_FILE=""
for f in "$ROOT/.env.local" "$ROOT/.env"; do [ -f "$f" ] && ENV_FILE="$f" && break; done
[ -n "$ENV_FILE" ] || {
  echo "no .env.local/.env in $ROOT."
  echo "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY there first"
  echo "(run 'supabase start' in $ROOT and copy the printed API URL + anon/publishable key)."
  exit 1
}
echo "==> loading env from $ENV_FILE"
set -a; . "$ENV_FILE"; set +a

RAW_URL="${NEXT_PUBLIC_SUPABASE_URL:?missing NEXT_PUBLIC_SUPABASE_URL in $ENV_FILE}"
KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in $ENV_FILE}"

# ── containers can't see the host's localhost → rewrite to the DNS bridge ─────
URL="$RAW_URL"
case "$RAW_URL" in
  *localhost*|*127.0.0.1*)
    URL="$(printf '%s' "$RAW_URL" | sed -E 's#(localhost|127\.0\.0\.1)#host.container.internal#')"
    echo "==> local URL detected; using $URL from inside the container"
    echo "    (needs: sudo container system dns create host.container.internal --localhost 203.0.113.113)"
    ;;
esac

echo "==> building image"
# The BuildKit builder VM needs a working nameserver to fetch apt packages / the claude
# installer. If yours has none (error: 'Temporary failure resolving deb.debian.org'), the
# durable fix is:  container builder stop && container builder start --dns 8.8.8.8
# We also pass --dns here as a fallback. Override with CONTAINER_DNS=<ip>.
container build --dns "${CONTAINER_DNS:-8.8.8.8}" --tag factory-agent:latest --file Dockerfile .

echo "==> probing Supabase from inside the container"
container run --rm \
  --env SUPABASE_URL="$URL" \
  --env SUPABASE_KEY="$KEY" \
  factory-agent:latest \
  probe.sh

if [ "${1:-}" = "--claude" ]; then
  : "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in your shell for --claude}"
  echo "==> claude headless: let the agent reach Supabase itself"
  # --dangerously-skip-permissions: the agent needs to run a shell (curl) unattended;
  # safe here because it's confined to a throwaway micro-VM.
  container run --rm \
    --env ANTHROPIC_API_KEY \
    --env SUPABASE_URL="$URL" \
    --env SUPABASE_KEY="$KEY" \
    factory-agent:latest \
    claude -p 'Run: curl -fsS "$SUPABASE_URL/auth/v1/health". Then state in one line whether Supabase is reachable from here.' \
    --dangerously-skip-permissions
fi

echo "==> OK"
