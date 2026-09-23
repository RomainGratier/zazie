#!/usr/bin/env bash
# Offline, consistent backup for the bundled PostgreSQL + filesystem deployment.
set -euo pipefail
umask 077

if [[ $# != 1 ]]; then
  echo "Usage: ZAZIE_ENV_FILE=.env.platform [ZAZIE_DEMO=1] bash deploy/backup.sh NEW_BACKUP_DIRECTORY" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
env_file="${ZAZIE_ENV_FILE:-.env.platform}"
compose_args=(--env-file "$env_file" -f deploy/compose/compose.yaml)
if [[ "${ZAZIE_DEMO:-0}" == 1 ]]; then compose_args+=(-f deploy/compose/demo.yaml --profile demo); fi
dc() { docker compose "${compose_args[@]}" "$@"; }

dc --profile tools config --format json | dc run --rm -T --no-deps --entrypoint node api deploy/check-backup-target.mjs
mkdir -m 700 "$1"
backup_dir="$(cd "$1" && pwd -P)"
resume=()
while IFS= read -r service; do
  if [[ "$service" == api || "$service" == worker ]]; then resume+=("$service"); fi
done < <(dc ps --status running --services)
restart_services() { if [[ ${#resume[@]} -gt 0 ]]; then dc start "${resume[@]}"; fi; }
trap restart_services EXIT
if [[ ${#resume[@]} -gt 0 ]]; then dc stop "${resume[@]}"; fi

dc exec -T postgres pg_dump -U postgres -d zazie --format=custom --no-owner --no-acl > "$backup_dir/database.dump"
dc run --rm --no-deps --entrypoint tar api -C /var/lib/zazie/artifacts -czf - . > "$backup_dir/artifacts.tar.gz"
cp "$env_file" "$backup_dir/deployment.env"
dc --profile tools config --format json > "$backup_dir/deployment.compose.json"
printf '{"formatVersion":1,"storage":"filesystem","createdAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$backup_dir/metadata.json"
(
  cd "$backup_dir"
  if command -v sha256sum >/dev/null; then
    sha256sum database.dump artifacts.tar.gz deployment.env deployment.compose.json metadata.json > SHA256SUMS
  else
    shasum -a 256 database.dump artifacts.tar.gz deployment.env deployment.compose.json metadata.json > SHA256SUMS
  fi
)
echo "Backup written to $backup_dir. Encrypt it before moving it: deployment.env contains credentials."
