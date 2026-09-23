#!/bin/sh
# A fresh local-only installation for real OIDC browser acceptance. No SaaS keys.
set -eu
cd "$(dirname "$0")/.."
run_id="zazie-e2e-$$"
artifacts=$(mktemp -d)
api_pid=''
worker_pid=''
cleanup() {
  if [ -n "$api_pid" ]; then kill "$api_pid" 2>/dev/null || true; fi
  if [ -n "$worker_pid" ]; then kill "$worker_pid" 2>/dev/null || true; fi
  docker rm -f "$run_id-db" "$run_id-idp" >/dev/null 2>&1 || true
  # Keep logs and test artifacts on failure for diagnosis; these contain only synthetic records.
  printf 'Browser-test diagnostics: %s\n' "$artifacts"
}
trap cleanup EXIT INT TERM
export DATABASE_URL=postgresql://zazie:synthetic-browser-only@127.0.0.1:55440/zazie
export PUBLIC_URL=http://localhost:3002
export ZAZIE_E2E_URL="$PUBLIC_URL"
export PORT=3002
export SESSION_SECRET=synthetic-browser-session-secret-not-for-production
export OIDC_ISSUER=http://localhost:8182/realms/zazie-demo
export OIDC_CLIENT_ID=zazie-demo
export OIDC_CLIENT_SECRET=local-demo-client-secret
export OIDC_ALLOW_INSECURE_HTTP=true
export COOKIE_SECURE=false
export ARTIFACT_ROOT="$artifacts/evidence"
export ZAZIE_E2E_OUTPUT="$artifacts/test-results"
docker run -d --name "$run_id-db" -p 127.0.0.1:55440:5432 \
  -e POSTGRES_USER=zazie -e POSTGRES_PASSWORD=synthetic-browser-only -e POSTGRES_DB=zazie \
  postgres:18.6-alpine >/dev/null
docker run -d --name "$run_id-idp" -p 127.0.0.1:8182:8080 \
  -e KC_HOSTNAME=http://localhost:8182 -e ZAZIE_DEMO_PUBLIC_URL="$PUBLIC_URL" \
  -v "$PWD/deploy/compose/keycloak-realm.json:/opt/keycloak/data/import/zazie-demo-realm.json:ro" \
  quay.io/keycloak/keycloak:26.7.4 start-dev --import-realm >/dev/null
attempt=0
until docker exec "$run_id-db" pg_isready -U zazie -d zazie >/dev/null 2>&1; do
  attempt=$((attempt+1)); [ "$attempt" -lt 60 ] || exit 1; sleep 1
done
attempt=0
until curl --fail --silent "$OIDC_ISSUER/.well-known/openid-configuration" >/dev/null; do
  attempt=$((attempt+1)); [ "$attempt" -lt 90 ] || { docker logs "$run_id-idp"; exit 1; }; sleep 1
done
pnpm db:migrate
pnpm bootstrap --issuer "$OIDC_ISSUER" --subject 11111111-1111-4111-8111-111111111111 \
  --name 'Synthetic browser owner' --roles admin,editor,reviewer,viewer --organization 'Browser acceptance'
node --conditions=development --import tsx apps/api/src/main.ts >"$artifacts/api.log" 2>&1 &
api_pid=$!
node --conditions=development --import tsx apps/worker/src/main.ts >"$artifacts/worker.log" 2>&1 &
worker_pid=$!
attempt=0
until curl --fail --silent "$PUBLIC_URL/health/ready" >/dev/null; do
  attempt=$((attempt+1)); [ "$attempt" -lt 30 ] || { cat "$artifacts/api.log"; exit 1; }; sleep 1
done
pnpm test:e2e
