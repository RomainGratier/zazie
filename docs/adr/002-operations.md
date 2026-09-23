# ADR 002: Durable jobs and private artifact storage

Status: accepted for the initial self-hosted platform.

Zazie uses one PostgreSQL database for domain records, audit records and pg-boss jobs. Domain writes and enqueue operations share a transaction through pg-boss's Drizzle adapter. Workers execute outside the request transaction, so every handler must tolerate at-least-once delivery. Retries are bounded and exhausted jobs remain visible to operators.

Artifacts are stored through a filesystem or S3-compatible adapter. Storage keys are generated identifiers; submitted filenames are metadata. Writes create immutable content, accept byte-identical retries and reject replacement. Reads verify hashes when evidence is consumed. The application authorises access and owns retention decisions; the adapter's delete operation is reserved for explicitly eligible cleanup.

Filesystem artifacts use a dedicated private volume shared by API and worker. Symbolic links and unsafe keys are rejected. S3 buckets remain private and require conditional object creation. Neither adapter fetches arbitrary external evidence URLs. Hashes detect changed content relative to a trusted record; they do not make infrastructure administrators unable to alter the system.

Dossiers are deterministic ZIP archives containing readable HTML, structured snapshot and section data, evidence bytes and a hash manifest. Missing or corrupted evidence is listed as an omission. Transient storage failures fail the job so that normal retry and operator visibility apply.

Migrations use a separate owner role. Runtime services receive only the database privileges they need. Artifact retention does not infer legal periods; reviewed evidence is protected from ordinary deletion. Initial cleanup covers transient operational data rather than approved release evidence.

An internally consistent filesystem backup pauses writers, dumps PostgreSQL, copies the artifact volume and records checksums. Restoration uses an isolated empty deployment and verifies the original release snapshots and artifact hashes before traffic is enabled. Managed database and object-store installations must provide an equivalent coordinated recovery procedure.
