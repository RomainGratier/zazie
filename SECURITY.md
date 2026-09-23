# Security

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/RomainGratier/zazie/security/advisories/new).
Include affected versions, a minimal synthetic reproduction, and impact. Do not
include credentials or personal data. This early project has no response-time SLA.

Zazie 0.2 is self-hosted. It has no mandatory model provider or vendor telemetry.
OIDC authenticates people; application membership and system scopes authorize
operations. Credentials are hashed, revocable, and scoped. Browser mutations use
CSRF protection. Demo identities and passwords are only for localhost synthetic data.

Artifacts are untrusted content, downloaded as attachments rather than rendered
as executable HTML. Evidence URLs are not fetched automatically. No submitted
code executes inside the API or worker. Do not mount a Docker socket into either.

Use a restricted runtime database role, separate migration credentials, TLS,
protected object storage, and backups of both the database and artifacts. Review
retention and access with the responsible organisation. Application append-only
history cannot protect against an infrastructure administrator changing storage.

See [operations](docs/operations.md) for restoration, rotation, and installation
limits. The supported development line is 0.2.x. Report security defects without
assuming that this draft workflow profile provides complete legal coverage.
