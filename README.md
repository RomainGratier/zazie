# Zazie

Zazie is a free, MIT-licensed application that your team runs on its own infrastructure to manage evidence and human release decisions for already-classified high-risk AI systems.

It connects a proposed release to its risks, controls, evaluation results, supporting documents and reviewer decisions. Your team can see what blocks a release, preserve the evidence behind an approval, follow up on stale evidence, and export a readable dossier.

**Current status: initial MVP.** The included AI Act provider profile is a **partial draft**, with visible sources and omissions. Zazie does not classify your system, certify compliance, or replace your team's technical and legal judgment. It needs no model API key, GPU, or Zazie-hosted account.

- [See a result with the local demo](#see-a-result-with-the-local-demo)
- [Send data from your AI system](#send-data-from-your-ai-system)
- [Deploy on your own infrastructure](#deploy-on-your-own-infrastructure)
- [Set up your first real AI system](#set-up-your-first-real-ai-system)
- [Understand your team's responsibilities](#what-your-team-still-needs-to-do)
- [Get implementation help](#implementation-services)

## See a result with the local demo

You need **Git and Docker with Compose v2**. Docker builds the application; you do not need Node.js installed on the host. The first build downloads container images and dependencies.

Start from a new checkout:

```sh
git clone https://github.com/RomainGratier/zazie.git
cd zazie
bash scripts/demo.sh
```

The launcher builds the application, starts PostgreSQL and Keycloak, applies migrations, provisions the demo owner, loads synthetic examples, and starts the API and worker. It waits for identity and API readiness, then prints the application URL and login details.

Open **[http://localhost:3000](http://localhost:3000)** and sign in:

- **Username:** `demo-owner`
- **Password:** `local-demo-owner-only`

These public credentials are for synthetic local data only. The demo has its own `zazie-demo` database and artifact volumes. Running the launcher again reuses those records and preserves existing demonstration systems. It checks the existing owner's permissions without restoring or expanding them.

The default ports are **3000** for Zazie and **8080** for identity. If they are occupied, choose different ports on the first start; the launcher remembers them:

```sh
bash scripts/demo.sh --port 3001 --identity-port 8091
```

### Inspect an approval, a blocked change, and an export

The seed creates a completed simulation, including failed and corrected results and an authorised review. No real model is evaluated.

On the workspace **Overview**, choose **Start guided tour** for a ten-step walkthrough of setup, incoming events, evidence, and release approval. Use **Back** and **Next** to move from the organisation overview into an existing AI system, then through its context and tabs in order: Risks & configuration, Operations, Evaluations & evidence, Release review, and Documents. If no system exists yet, register one first when you have permission. Larger guide cards point to the relevant tab or section, with the full explanation and examples in a scrollable reading area. Cards attached to tabs leave the horizontal navigation visible. **Start guided tour** stays available on the workspace and system **Overview** pages; the walkthrough does not change your records.

1. Open **AI systems → Synthetic CV filtering**.
2. In **Evaluations & evidence**, inspect the failing and corrected reports and their provenance. The illustrative recall measurement changes from `0.40` to `0.95`, against a configured threshold of `0.90`.
3. In **Release review**, select **synthetic-v1**, **Synthetic staging**, and **Approved for deployment**. You should see **Approved for this deployment** and the recorded review and decision.
4. Select **synthetic-v2-new-prompt** and **Synthetic changed-prompt candidate**. The changed scoring prompt needs evidence and fresh review; the earlier approval remains readable.
5. In **Documents**, choose **Download dossier** after the worker finishes the export. Unzip it to inspect the HTML dossier, structured JSON, evidence and hash manifest.

Then open **Synthetic university exam monitoring**. Its **Operations** tab contains timestamped flags and reviewer interventions, using the same platform contracts with different data.

These examples demonstrate the workflow, not suitable thresholds or evaluation designs for your own hiring or education system.

### Stop, restart, or troubleshoot the demo

```sh
bash scripts/demo.sh stop    # Preserve the database and evidence volumes.
bash scripts/demo.sh         # Start again with the saved ports.
bash scripts/demo.sh status
bash scripts/demo.sh logs
```

If startup fails, inspect the logs and rerun the launcher after resolving the problem. Keep the Compose volumes to preserve your records. If `keycloak.localhost` does not resolve in your browser, add `127.0.0.1 keycloak.localhost` to your hosts file. See the [installation guide](docs/installation.md#local-synthetic-demonstration) for existing installations and identity settings.

## Send data from your AI system

Connect Zazie from your **application backend or evaluation job**. Your AI keeps running where it already runs. Your code sends selected results and events to Zazie; installing Zazie does not automatically collect model calls, prompts, CVs, or video.

| When your system…                 | Send to Zazie                                                                                                   | What your team sees                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runs an evaluation                | Measurements and a supporting report, tied to the tested model/prompt version, dataset and evaluation criteria. | Results checked against your configured thresholds in **Evaluations & evidence**.                       |
| Records a human intervention      | An event describing what happened, when, and which system version was involved.                                 | A record in **Operations → Events**. Your team or integration must identify issues that need follow-up. |
| Changes its model, prompt or code | A new version manifest identifying those components.                                                            | A new release candidate that needs its own evidence and review.                                         |

Start by sending one synthetic event to confirm the connection. Then connect the evaluation job that produces your real evidence. No SDK installation is needed for the first request below.

### 1. Choose the system and version

For this walkthrough, open **AI systems → Synthetic CV filtering** in the local demo. Use fictional data only.

- Copy the system ID from the browser URL: `#/systems/SYSTEM_ID/...`.
- Open **Risks & configuration → Versions → synthetic-v1 → Inspect record** and copy its **Id**. This is the version ID, not the `synthetic-v1` label.

For your own AI system, first [register it and create its version manifest](#set-up-your-first-real-ai-system). Registration describes the system; the manifest identifies the particular model, prompt and code you are monitoring.

### 2. Give your application permission to send events

In **Administration → Create credential**, enter an integration name, select only this system under **Permitted systems**, choose **Submit events** under **Permitted actions**, and set an expiry. This grants `events:write`. Copy the secret when it is shown; it is displayed once.

Use this credential in your backend or CI secret store. Do not put it in browser code or commit it to Git. The local test below prompts for it without adding the value to shell history.

### 3. Send a first event and find it in Zazie

Run this in Bash with `curl`. Replace `SYSTEM_ID` and `VERSION_ID` with the IDs you copied. Use the application URL printed by the launcher if you chose another port; on your own infrastructure, use your HTTPS URL.

```bash
read -r -s -p 'Integration token: ' ZAZIE_API_TOKEN; printf '\n'
ZAZIE_REQUEST_KEY="readme-cv-review-$(date +%s)-$RANDOM"

curl --fail-with-body \
  'http://localhost:3000/api/v1/systems/SYSTEM_ID/events' \
  --header "Authorization: Bearer $ZAZIE_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --header "Idempotency-Key: $ZAZIE_REQUEST_KEY" \
  --data '{
    "events": [{
      "schemaVersion": "1.0",
      "eventId": "readme-cv-review-001",
      "source": "cv-filtering-example",
      "type": "oversight.override_recorded",
      "versionId": "VERSION_ID",
      "occurredAt": "2026-01-01T12:00:00Z",
      "payload": {
        "synthetic": true,
        "candidateRef": "fictional-applicant-001",
        "action": "advance_to_human_review",
        "reason": "A reviewer corrected the generated screening suggestion."
      }
    }]
  }'
```

This sends a fictional event with a fixed example date. A successful response includes the stored event's ID. Open the system's **Operations → Events → Inspect record** to see the payload. Repeating the same request returns the existing result without creating a duplicate.

In your application, make this request when the intervention actually happens. Supply its real occurrence time, a stable event ID, the version involved, and the fields your team needs to understand the intervention. Keep that event body and ID for retries; a new event needs a new ID and idempotency key.

**Receiving an event does not mean Zazie has assessed it.** This request records the intervention; it does not judge a candidate, detect a compliance breach, create a finding automatically, or approve a release.

### 4. Connect evaluation results

Your team defines what to test and runs the evaluation in its own environment. In Zazie, register the dataset and create an evaluation definition containing the metrics and acceptance criteria. Then your evaluation job makes two requests:

1. Upload its supporting report as an **artifact** and keep the returned artifact ID.
2. Submit the measured values, that artifact ID, the tested version ID, and the exact dataset and evaluation-definition IDs and revisions.

Zazie stores the report and calculates whether those measurements satisfy your configured criteria. It labels them as externally supplied evidence; it has not independently run or verified your evaluation. New evaluation evidence requires fresh human review before it can support deployment approval.

Follow the [integration guide](docs/integrations.md) for a complete report-upload and evaluation example, the fields to configure once, and release checks for CI. The [TypeScript SDK](packages/sdk-typescript/README.md), [CLI](packages/cli/README.md), and [REST/OpenAPI contract](openapi.json) use the same API. SDK and CLI packages are currently supplied from this checkout; they are not published to npm.

## Deploy on your own infrastructure

The smallest supported topology is one Docker host running the **API and web UI**, a separate **worker**, **PostgreSQL**, and a persistent **artifact volume**. Your organisation supplies an OIDC identity provider and an HTTPS reverse proxy. S3-compatible artifact storage and managed PostgreSQL are alternatives described in the [installation guide](docs/installation.md).

The demo Keycloak configuration uses development mode. For your organisation's installation, use your own configured identity service and the base Compose file, without the demo override or seed data.

### 1. Prepare the host and identity provider

Use a dedicated host or VM with Docker Compose, persistent disk space and a backup destination. Choose a public application URL, such as `https://zazie.example.com`, and configure its DNS and TLS certificate. The bundled API binds to `127.0.0.1:3000` for a reverse proxy on that host; PostgreSQL and artifact storage are not public endpoints.

Register a confidential OIDC client using authorization-code flow and PKCE. Its redirect URI must be exactly:

```text
https://zazie.example.com/auth/callback
```

Obtain the verified **issuer URL** and **subject ID** of the person who will be the first administrator. A subject is the identity provider's stable identifier, not an email address.

### 2. Configure secrets, HTTPS and storage

In the platform checkout on your server:

```sh
cp -n .env.example .env.platform
chmod 600 .env.platform
openssl rand -hex 32
```

Run the last command separately for each generated secret and fill in `.env.platform`. Preserve any existing environment file; no unrelated `.env` needs to be loaded.

| Setting                                                            | What your team supplies                                                                                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`, `MIGRATION_PASSWORD`, `APP_DATABASE_PASSWORD` | Three independent passwords for database administration, migrations and runtime access. Generated hexadecimal values work with the bundled connection URLs.    |
| `SESSION_SECRET`                                                   | A separate random secret of at least 32 characters.                                                                                                            |
| `PUBLIC_URL`                                                       | Your HTTPS application origin, without a trailing slash.                                                                                                       |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`              | The identity provider and registered client details.                                                                                                           |
| `COOKIE_SECURE=true`, `OIDC_ALLOW_INSECURE_HTTP=false`             | Keep these production settings.                                                                                                                                |
| `TRUST_PROXY`                                                      | The reverse proxy's source IP address or CIDR as seen by the API; comma-separated if more than one is needed. Uncomment and set this entry in `.env.platform`. |
| `STORAGE_DRIVER=filesystem`                                        | Uses the persistent artifact volume. Use `s3` and the documented bucket settings for object storage.                                                           |

The reverse proxy must forward the original host and `X-Forwarded-Proto: https`, and overwrite client-supplied forwarding headers. Configure `TRUST_PROXY` for that trusted hop only. Docker may present a bridge gateway address instead of the host's loopback address. Without a correctly trusted proxy, the application will not issue its secure session cookie behind TLS termination. See [HTTPS and proxy setup](docs/installation.md#https-and-reverse-proxy-setup).

### 3. Start an empty organisation

If you ran the demo on this host, stop it with `bash scripts/demo.sh stop` before starting this installation on the same port. This installation uses the separate Compose project `zazie`, preserving the demo's volumes.

```sh
zc() {
  docker compose --project-name zazie --env-file .env.platform \
    -f deploy/compose/compose.yaml "$@"
}

zc build
zc up -d --wait postgres
zc run --rm migrate
zc run --rm api pnpm bootstrap \
  --issuer https://identity.example.com/realms/organisation \
  --subject YOUR_VERIFIED_SUBJECT --name 'System administrator' \
  --organization 'Your organisation' --roles admin,editor,reviewer,viewer
zc up -d --wait api worker
```

Replace the issuer, subject, name and organisation with your own values. The issuer must match `.env.platform`. This example explicitly grants the first person all four roles; select roles according to your organisation's policy. **Administrator access alone does not grant release-review permission.** Additional memberships are managed in the application after bootstrap.

Migrations run through a dedicated command using the database owner. API and worker use a separate runtime account and refuse incompatible schemas. Do not run the synthetic seed against this organisation.

### 4. Confirm the installation and arrange operations

Visit your HTTPS URL and sign in as the bootstrapped person. You should see an empty organisation where you can register a system. Check the API and worker before onboarding real evidence:

```sh
curl --fail https://zazie.example.com/health/ready
zc ps
zc logs --tail=100 api worker
```

Before relying on the installation, configure your organisation's retention settings and practise restoring **both the database and artifacts**. The [operations guide](docs/operations.md) covers backup and restore commands, hash verification, upgrades, credential rotation and health monitoring. If you use another Compose project name, pass the same `COMPOSE_PROJECT_NAME` to the backup and restore commands.

## Set up your first real AI system

Start with one system, one deployment context and one release. Your domain, engineering and review owners should agree what evidence will support that decision before you connect an evaluation pipeline.

| Step                              | In Zazie                                                                 | What to prepare                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Assign people                  | **Administration → Add member**                                          | Each person's verified OIDC issuer and subject, roles and permitted systems. Assign reviewer permission explicitly.                                                                                                      |
| 2. Register the system            | **AI systems → Register system**                                         | Intended use, affected people, owner, your supplied classification and role, and the applicable workflow profile. Review the draft profile's coverage and applicability decisions.                                       |
| 3. Identify the release and risks | **Risks & configuration**                                                | An immutable version manifest identifying model, prompt, code and configuration versions; a deployment context; risks and residual-risk decisions.                                                                       |
| 4. Define the evidence            | **Evaluations & evidence**, plus procedures in **Risks & configuration** | Dataset provenance and coverage, evaluation definitions with justified thresholds, and procedures your team has adapted and adopted.                                                                                     |
| 5. Connect controls to evidence   | **Risks & configuration → Controls**                                     | Owners and links to the relevant requirements, risks, evaluation definitions and procedures. Create these referenced records first.                                                                                      |
| 6. Submit and review              | **Evaluations & evidence**, then **Release review**                      | Stored artifacts and measurements for the exact version and criterion/dataset revisions. Resolve blockers, review each control, request a release review, and record an authorised decision against the frozen snapshot. |
| 7. Operate and retain the record  | **Operations** and **Documents**                                         | Oversight events, findings, incident follow-up and a dossier of the decision. New manifests and relevant changes require renewed review.                                                                                 |

Owner fields refer to active organisation members with access to that system; they are not free-text team names. The registration form defaults to your membership. Resource IDs link records across the UI, API and integrations.

**Your first useful result** is a release page showing its concrete blockers and owners, followed by a reviewed snapshot and export when the required evidence and decisions are in place. See the [workflow guide](docs/concepts.md) for configured, operating and reviewed controls, and for review readiness versus deployment approval.

## What your team still needs to do

Installing Zazie gives you a shared evidence and review process. Its usefulness depends on the evidence, policies and real safeguards your organisation provides.

| Team responsibility                         | What Zazie helps with                                                                                    | What remains your team's work                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product, domain and legal/compliance owners | Record intended use, supplied classification, applicability and requirement sources.                     | Determine your system's classification, organisational role, applicable obligations and acceptable use; review legal interpretations and missing coverage.                  |
| ML, engineering and domain experts          | Version evaluation definitions and datasets; recalculate configured criteria from imported measurements. | Choose representative data, investigate blind spots, justify metrics and thresholds, run trustworthy evaluations, and fix the AI system when results are inadequate.        |
| Engineering and operations                  | Record controls, adopted procedures, artifacts and oversight events.                                     | Implement and test actual safeguards, human intervention paths, downstream behaviour and reliable evidence delivery in your application.                                    |
| Authorised reviewers and accountable owners | Preserve the exact evidence and rationale behind a decision.                                             | Assess whether the evidence is adequate, accept or reject residual risk, and make the release decision. A document or passing metric alone does not settle these questions. |
| Platform and security teams                 | Provide self-hosted services, scoped credentials, health information and recovery tools.                 | Operate identity, TLS, storage, access reviews, retention, backups, upgrades and incident response.                                                                         |

For a CV-filtering system, your team must decide what a harmful screening error is, build a suitable evaluation set, justify acceptance criteria, and show that a recruiter's intervention actually changes the downstream process. Zazie can preserve and check that evidence against your configured criteria; it cannot supply those decisions from a CV or prompt alone.

## Limits of the current release

- **Partial regulatory coverage.** The draft provider starter profile covers selected evidence workflows for already-classified Annex III software systems. It is not a complete AI Act assessment, a deployer-specific programme, a certificate or a regulatory submission. Sources, interpretation status and omissions are listed in [coverage](docs/coverage.md) and the UI.
- **Imported execution is not independently verified.** Zazie recalculates acceptance criteria but does not run your model, verify the evaluation runner, or prove that its dataset and reported measurements are sound. Example thresholds are illustrative.
- **Controls must exist in your system.** Zazie does not automatically add safeguards, improve model behaviour, enforce recruiter overrides, or stop deployment unless your team integrates and enforces the release gate.
- **Human judgment stays explicit.** Reviewers must judge the adequacy of evidence and procedures. Historical approvals remain readable; they do not silently apply to a new manifest. Relevant evidence changes conservatively require renewed review.
- **Operational boundaries.** One organisation per installation, with multiple systems and deployments. SDK memory buffering is bounded but not durable; important events need a customer-owned outbox. Follow-up is currently in the application, without notification connectors. Audit history is append-only for the application role, while infrastructure administrators still control the database and backups.
- **Initial MVP acceptance.** Local workflow, isolation, browser, packaging and recovery checks are documented in the [acceptance record](docs/validation.md). This is not an independent security audit or a production load certification. Validate your own infrastructure and workload before relying on them.

Python, advanced connectors, notifications, regulatory submissions, custom evaluation execution, additional sector profiles, collectors and Helm remain later work. No telemetry is sent to a vendor by default; OpenTelemetry export is opt-in to a collector you configure.

## Development and further reading

For development outside Docker, use the Node version in `.node-version` and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm openapi:check
pnpm test:package
```

The [installation guide](docs/installation.md) covers development entrypoints and test prerequisites. The [acceptance record](docs/validation.md) includes integration, browser and recovery commands. [Contributing](CONTRIBUTING.md) explains rebase-only merges and the approval gate for outside-contributor CI.

Zazie is [MIT-licensed](LICENSE). The [architecture decisions](docs/adr/001-platform-restart.md) explain the platform restart. Earlier prototype work remains in Git history and is not validation of the current application.

## Implementation services

For hands-on help deploying Zazie on your infrastructure, connecting your AI systems, or setting up evidence and review workflows, contact **Romain Gratier** at **[romain.gratier@zoey-hire.ch](mailto:romain.gratier@zoey-hire.ch)** to discuss personal implementation services. Zazie remains free and MIT-licensed; hiring me is optional.
