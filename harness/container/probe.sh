#!/usr/bin/env bash
# Runs INSIDE the container. Proves the container can reach Supabase and query it.
set -uo pipefail

URL="${SUPABASE_URL:?SUPABASE_URL not set}"
KEY="${SUPABASE_KEY:?SUPABASE_KEY not set}"
echo "[probe] target: $URL"

# 1) GoTrue auth health — no auth required, cheapest reachability check.
echo "[probe] auth health:"
if curl -fsS --max-time 10 "$URL/auth/v1/health"; then
  echo "  ✓ auth/v1/health reachable"
else
  echo "  (auth/v1/health not reachable — continuing to REST check)"
fi

# 2) PostgREST root — needs the anon/publishable key; returns the OpenAPI schema whose
#    `definitions` are the exposed tables. This is our "basic query": it proves the key
#    is valid AND the database is reachable behind the gateway.
echo "[probe] REST root — exposed tables:"
if body=$(curl -fsS --max-time 10 "$URL/rest/v1/" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"); then
  echo "$body" | jq -r '(.definitions // {}) | keys[]' 2>/dev/null | sed 's/^/  - /' \
    || echo "  (reachable; empty or non-standard schema)"
  echo "[probe] ✓ container reached Supabase and queried it"
else
  echo "[probe] ✗ could not reach $URL/rest/v1/"
  echo "        checklist: (a) is Supabase running on the host? (b) if the URL uses"
  echo "        host.container.internal, does the DNS bridge exist? (run: factory doctor)"
  exit 1
fi
