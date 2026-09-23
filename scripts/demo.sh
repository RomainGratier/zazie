#!/usr/bin/env bash
# Local synthetic demonstration only. Production setup is documented separately.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'HELP'
Usage: bash scripts/demo.sh [start|stop|status|logs] [--port PORT] [--identity-port PORT]

Start (the default) builds Zazie, prepares its database and demo login, seeds
synthetic examples, and waits for the application. Docker Compose v2 is required.
Stop preserves all data. Status and logs help diagnose startup problems.

Defaults: application 3000, identity 8080. Custom ports are remembered in
.data/demo-ports. Choose them before the first start; an existing identity realm
cannot be moved to other ports by this launcher. Uses Compose project zazie-demo.
HELP
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
valid_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && (( $1 <= 65535 )); }

command=start
port=3000
identity_port=8080
if [[ -f .data/demo-ports ]]; then
  read -r port identity_port extra < .data/demo-ports || fail 'Cannot read .data/demo-ports.'
  [[ -z "${extra:-}" ]] && valid_port "$port" && valid_port "$identity_port" \
    || fail 'Invalid saved ports in .data/demo-ports.'
fi
saved_ports="$port $identity_port"

if [[ "${1:-}" =~ ^(start|stop|status|logs)$ ]]; then
  command=$1
  shift
fi
while (( $# )); do
  case "$1" in
    --port|--identity-port)
      (( $# >= 2 )) && valid_port "$2" || fail "$1 requires a port between 1 and 65535."
      if [[ "$1" == --port ]]; then port=$2; else identity_port=$2; fi
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $1" ;;
  esac
done
[[ "$port" != "$identity_port" ]] || fail 'Application and identity ports must differ.'

command -v docker >/dev/null || fail 'Install Docker with Compose v2 first.'
docker compose version >/dev/null || fail 'Docker Compose v2 is required.'
docker info >/dev/null 2>&1 || fail 'Start Docker, then run this command again.'

# Shell variables override Compose env files. Never let a production connection,
# storage account, or telemetry endpoint leak into the synthetic demonstration.
unset DATABASE_URL MIGRATION_DATABASE_URL TRUST_PROXY ARTIFACT_MAX_BYTES \
  S3_BUCKET S3_REGION S3_ENDPOINT S3_FORCE_PATH_STYLE \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN \
  OTEL_EXPORTER_OTLP_ENDPOINT OTEL_SERVICE_NAME COMPOSE_ENV_FILES COMPOSE_PROFILES
set -a
source deploy/compose/demo.env
ZAZIE_PORT=$port
ZAZIE_IDENTITY_PORT=$identity_port
PUBLIC_URL="http://localhost:$port"
OIDC_ISSUER="http://keycloak.localhost:$identity_port/realms/zazie-demo"
set +a

dc() {
  docker compose --ansi never --project-name zazie-demo \
    --env-file deploy/compose/demo.env \
    -f deploy/compose/compose.yaml -f deploy/compose/demo.yaml \
    --profile demo "$@"
}

case "$command" in
  stop) dc stop; exit ;;
  status) dc ps; exit ;;
  logs) dc logs --tail=100 api worker postgres keycloak; exit ;;
esac

if docker volume inspect zazie-demo_keycloak-demo >/dev/null 2>&1; then
  if [[ -f .data/demo-ports && "$saved_ports" != "$port $identity_port" ]]; then
    fail 'The existing demo identity realm uses the previous ports. Keep them; changing an existing realm needs a manual identity/client update (see docs/installation.md).'
  fi
  # Adopt a manually started demo only if its imported realm has the same URLs.
  identity_container=$(dc ps --all --quiet keycloak)
  if [[ -n "$identity_container" ]]; then
    identity_environment=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$identity_container")
    for setting in "KC_HOSTNAME=http://keycloak.localhost:$identity_port" "ZAZIE_DEMO_PUBLIC_URL=$PUBLIC_URL"; do
      [[ $'\n'"$identity_environment"$'\n' == *$'\n'"$setting"$'\n'* ]] \
        || fail 'Use the same ports as the existing demo identity container (see docs/installation.md).'
    done
  elif [[ ! -f .data/demo-ports ]]; then
    fail 'Existing identity data has no container or saved ports. Restore the previous demo configuration before using the launcher.'
  fi
fi

# Fail before importing a realm with unusable callback URLs. A running demo may
# already own its ports, in which case restarting it is safe.
running=$(dc ps --status running --services)
check_port() {
  local service=$1 candidate=$2
  if ! [[ $'\n'"$running"$'\n' == *$'\n'"$service"$'\n'* ]] && \
    (echo >/dev/tcp/127.0.0.1/"$candidate") 2>/dev/null; then
    fail "Port $candidate is occupied. Choose free ports before first start: bash scripts/demo.sh --port 3001 --identity-port 8091"
  fi
}
check_port api "$port"
check_port keycloak "$identity_port"
mkdir -p .data
printf '%s %s\n' "$port" "$identity_port" > .data/demo-ports

step='building the application'
trap 'printf "\nDemo startup failed while %s. Data has been preserved.\nInspect: bash scripts/demo.sh logs\nRetry:   bash scripts/demo.sh\n" "$step" >&2' ERR
printf '\nBuilding the local demo (the first run downloads images and dependencies)…\n'
dc build
step='starting PostgreSQL'
dc up -d --wait --wait-timeout 120 postgres
step='starting the identity provider'
dc up -d keycloak
step='applying database migrations'
dc run --rm -T --no-deps migrate
step='waiting for the demo login'
dc run --rm -T --no-deps api node --input-type=module -e '
  const issuer = process.env.OIDC_ISSUER;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok && (await response.json()).issuer === issuer) process.exit(0);
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  console.error("The demo identity provider did not become ready within two minutes.");
  process.exit(1);
'
step='provisioning the demo owner'
member_id=$(dc run --rm -T --no-deps api pnpm --silent bootstrap \
  --issuer "$OIDC_ISSUER" --subject 11111111-1111-4111-8111-111111111111 \
  --name 'Demo owner' --organization 'Synthetic demonstration' \
  --roles admin,editor,reviewer,viewer --if-matching --id-only)
[[ "$member_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || fail 'Bootstrap did not return a membership ID; the seed was not run.'
step='loading the synthetic examples'
dc run --rm -T --no-deps --env "ZAZIE_SEED_MEMBER_ID=$member_id" api pnpm --silent seed
step='starting the API and worker'
dc up -d --wait --wait-timeout 120 api worker
trap - ERR

cat <<READY

Zazie is ready: $PUBLIC_URL
Username: demo-owner
Password: local-demo-owner-only

Open “Synthetic CV filtering” to inspect its approved release and blocked
prompt change. These public credentials and examples are for local synthetic data.

Stop:    bash scripts/demo.sh stop
Restart: bash scripts/demo.sh
Status:  bash scripts/demo.sh status
Logs:    bash scripts/demo.sh logs
READY
