#!/usr/bin/env bash
# Refuses an existing database or non-empty artifact volume; restore into an isolated installation.
set -euo pipefail
umask 077

if [[ $# != 2 || "$2" != --confirm-empty-target ]]; then
  echo "Usage: ZAZIE_ENV_FILE=.env.platform [ZAZIE_DEMO=1] bash deploy/restore.sh BACKUP_DIRECTORY --confirm-empty-target" >&2
  exit 2
fi
backup_dir="$(cd "$1" && pwd -P)"
cd "$(dirname "$0")/.."
compose_args=(--env-file "${ZAZIE_ENV_FILE:-.env.platform}" -f deploy/compose/compose.yaml)
if [[ "${ZAZIE_DEMO:-0}" == 1 ]]; then compose_args+=(-f deploy/compose/demo.yaml --profile demo); fi
dc() { docker compose "${compose_args[@]}" "$@"; }
dc --profile tools config --format json | dc run --rm -T --no-deps --entrypoint node api deploy/check-backup-target.mjs
(
  cd "$backup_dir"
  if command -v sha256sum >/dev/null; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi
)

if dc ps --status running --services | grep -Eq '^(api|worker)$'; then
  echo "Stop API and worker before restoring into an isolated target." >&2
  exit 2
fi
dc up -d --wait postgres
table_count="$(dc exec -T postgres psql -U postgres -d zazie -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','pgboss')")"
if [[ "$table_count" != 0 ]]; then echo "Refusing to overwrite a non-empty database." >&2; exit 2; fi
dc run --rm --no-deps --entrypoint node api -e '
const fs = require("node:fs");
if (process.env.STORAGE_DRIVER !== "filesystem" || fs.readdirSync(process.env.ARTIFACT_ROOT).length !== 0) {
  console.error("Restore requires filesystem storage and an empty artifact volume."); process.exit(2);
}'

dc exec -T postgres pg_restore -U zazie_owner -d zazie --no-owner --no-acl --exit-on-error < "$backup_dir/database.dump"
dc run --rm --no-deps --entrypoint tar api -C /var/lib/zazie/artifacts -xzf - --no-same-owner --keep-old-files < "$backup_dir/artifacts.tar.gz"
dc run --rm migrate
echo "Restore complete. Start the API and worker, then verify historical snapshots and evidence hashes before enabling traffic."
