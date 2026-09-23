# Operate Zazie

Keep the deployment environment file private. Use a secrets manager or equivalent restricted deployment mechanism for real installations. The API, worker and storage must remain within your organisation's trusted environment; integration clients receive scoped tokens instead of database or storage credentials.

## Health and failures

The API exposes liveness and readiness separately. Readiness checks the installed database schema; application startup does not run migrations. Monitor API readiness, the worker's reported health, failed job attempts, pending findings and evidence availability. A healthy HTTP process does not prove that integrations are sending all expected events.

Use `docker compose ... logs api worker` to inspect structured operational logs. Correlation identifiers help connect a failed operation to a request or job. Do not put raw CVs, model prompts, credentials or other unnecessary personal data into diagnostic messages. Imported event payloads are data records, not permission to copy them into logs.

OpenTelemetry export is opt-in through `OTEL_EXPORTER_OTLP_ENDPOINT`. Leave it unset for no telemetry export. Direct it only to a collector you control, and apply your own access and retention rules. No vendor collector is configured by default.

Jobs are delivered at least once. A retry must not create a second finding, decision or completed export. Investigate exhausted jobs before manually retrying them. A dossier job that cannot reach storage should fail visibly; a dossier with unavailable evidence must list that gap rather than imply a complete record.

Integration SDK memory buffers are not durable. Call `flush()` at an appropriate lifecycle boundary and handle failures. Applications that require durable delivery should retain events in their own transactional outbox until acknowledged. Do not interpret an empty failure queue as proof that a client delivered every event.

## Evidence access and retention

Artifact keys are internal identifiers. Every download is authorised by the application, and evidence reads verify recorded content hashes. The filesystem root must be writable only by the service account and infrastructure administrators. Keep S3 buckets private, restrict credentials to the intended bucket, and enable the provider's encryption and recovery facilities as needed.

The storage adapter exposes deletion for internal cleanup. This is not a supported way to discard approved evidence. Record-class retention is an organisational decision; the software does not invent a legal period. Evidence, review snapshots and audit history support only `retain` mode in this MVP. No automatic deletion of these records or their artifacts is implemented.

A deployment operator can configure cleanup grace periods for expired sessions and inactive integration credentials. The default is zero days after expiry or revocation; this is a technical cleanup default, not a recommended legal period. Configured grace periods must be whole numbers from 0 through 3650 days. Retaining an expired session or revoked credential does not restore its access. Signing out still destroys the browser session immediately, and expired unauthenticated sessions without an organisation membership use the zero-day default.

Save a complete policy in a JSON file, choosing the two grace periods for your organisation. This example retains expired sessions for three days and inactive credentials for seven:

```json
{
  "schemaVersion": "1",
  "expiredSessions": { "graceDays": 3 },
  "inactiveIntegrationCredentials": { "graceDays": 7 },
  "evidence": { "mode": "retain" },
  "reviewSnapshots": { "mode": "retain" },
  "auditHistory": { "mode": "retain" }
}
```

Use the organisation ID returned by `/api/v1/session`. With the deployment's database environment, run `pnpm retention --organization ORGANISATION_ID --policy /path/to/retention.json --reason "Approved operational retention policy"`. In Compose, mount the policy read-only:

```sh
dc run --rm --no-deps -v /absolute/path/retention.json:/tmp/retention.json:ro api \
  pnpm retention --organization ORGANISATION_ID --policy /tmp/retention.json \
  --reason "Approved operational retention policy"
```

The command validates the entire policy and records the settings change and its rationale in one database transaction. It identifies its authority as a deployment-controlled command, not an OIDC reviewer action. Hourly housekeeping uses the policy recorded for each organisation; malformed stored policies stop cleanup instead of silently reverting to shorter defaults. Policy changes do not delete anything synchronously.

An infrastructure administrator can alter a database or storage system outside application controls. Append-only application history and checksums do not make this impossible. Restrict administrator access and maintain independently protected backups when stronger assurance is required.

## Backup

Back up the PostgreSQL database, artifact bytes and necessary deployment configuration together. The identity provider's configuration, users and recovery keys are a separate dependency; follow that provider's backup process. The bundled demo realm import can recreate the original synthetic identities but does not back up later Keycloak changes.

For the bundled PostgreSQL and filesystem deployment, the included script pauses active API and worker services, writes a database dump and artifact archive, copies the environment configuration and records SHA-256 checksums. Previously active services restart even if backup fails. The destination directory must not already exist.

```sh
ZAZIE_ENV_FILE=.env.platform bash deploy/backup.sh /secure/backups/zazie-2026-09-23
```

For a local synthetic demonstration:

```sh
COMPOSE_PROJECT_NAME=zazie-demo ZAZIE_ENV_FILE=deploy/compose/demo.env ZAZIE_DEMO=1 \
  bash deploy/backup.sh /private/tmp/zazie-demo-backup
```

Use the same Compose project name that created the installation's volumes. The current quick-start uses `zazie-demo` for synthetic data and `zazie` for an organisation. If your installation uses another name, set `COMPOSE_PROJECT_NAME` accordingly; selecting a different project does not back up the original volumes.

The backup includes `deployment.env` and the resolved `deployment.compose.json`, which contain secrets and effective configuration overrides. Encrypt the directory before transferring it and restrict access. Checksums detect accidental or externally verifiable changes; someone who can replace both the archive and its checksum file can forge that local check. Keep a checksum or signature in a separately trusted location when required.

For managed PostgreSQL or S3 storage, use a coordinated backup process provided by your infrastructure. Quiesce writes or establish a consistent recovery point across records and artifacts, preserve object versions referenced by evidence records, and test restoration of a reviewed release. The included scripts refuse external database targets and S3 mode before stopping writers or restoring data.

## Restore and verify

Use a separate empty installation with the same code and schema version first. Set `COMPOSE_PROJECT_NAME` to an isolated project name so the restored volumes cannot collide with your running installation. Create a private environment file for that target, preserving the identity issuer/subject mapping and the necessary secrets. Do not copy a production configuration to a publicly reachable test host.

```sh
COMPOSE_PROJECT_NAME=zazie-restore ZAZIE_ENV_FILE=.env.restore \
  bash deploy/restore.sh /secure/backups/zazie-2026-09-23 --confirm-empty-target
```

The script verifies checksums, refuses running writers or a non-empty target, restores database and artifact content, and runs the explicit migration command to reapply runtime grants. It does not start the public application. If it fails partway through, keep the isolated target stopped and diagnose the failure; do not point clients at it.

After restoration:

1. Start API and worker in the isolated installation and check readiness and worker health.
2. Sign in using the same verified identity mapping. Open a previously approved release and compare its manifest, snapshot digest, decision and evidence references with the original recorded values.
3. Download referenced evidence and compare each SHA-256 with its record. Generate a dossier and verify every file listed in `manifest.json`. Historical artifact references must resolve; missing files are a failed recovery check even if the database restored successfully.
4. Confirm event ingestion, queued-job execution, reviewer permissions and the changed-manifest regression before accepting production traffic.

A backup is not considered recoverable merely because `pg_restore` exits successfully. Record the restoration exercise, its evidence and any unresolved findings. The shell scripts' successful checksum checks cover the backup files; application-level release and artifact checks remain necessary.

The built image includes a read-only verification command. Run it before backup and again after restore using each installation's Compose configuration:

```sh
dc run --rm --no-deps api node deploy/verify-evidence.mjs
```

It verifies every stored artifact and completed dossier, recomputes release-snapshot digests, checks decision bindings and prints record IDs with hashes. Compare the results across installations. The command fails on missing content, corruption or a broken decision binding; it does not assess whether an evaluation or legal interpretation was substantively correct.

## Upgrade and rotation

Before upgrading, back up and test the target release in an isolated copy. Stop writers, run the dedicated migration command once, and start the matching API and worker images. They must not silently migrate the database on startup. Use the new version's documented rollback procedure; restoring an older application image against a newer schema is not automatically safe.

Rotate integration tokens by issuing a replacement, updating the client, verifying delivery, and revoking the old token. Rotate the OIDC client secret at the identity provider and in the deployment configuration. Rotate session secrets during a planned sign-in reset. Verify what data encryption or signing depends on a secret before deleting the old value.

Database passwords stored in an existing volume are not changed by editing Compose environment variables. Change each PostgreSQL login using an administrator's protected connection, then update the matching runtime or migration URL and restart the affected services. Never run API or worker using the database-owner or PostgreSQL administrator credential.

For S3 credential rotation, grant the replacement only the intended bucket permissions, update both API and worker, verify an upload and a reviewed-artifact read, and then revoke the old credential. Changing the bucket or artifact root is a data migration: copy and verify existing evidence before switching the application.

TLS termination must preserve the configured public origin. Configure `TRUST_PROXY` only for the proxy addresses observed by the API, and have that proxy overwrite client-supplied forwarding headers; see [HTTPS setup](installation.md#https-and-reverse-proxy-setup). Keep secure cookies enabled outside the loopback-only demonstration. Do not expose Keycloak development mode, Docker's socket, PostgreSQL, internal job administration or artifact directories to the public network.
