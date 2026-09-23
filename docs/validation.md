# Platform acceptance record

The initial platform implementation was verified locally on 23 September 2026,
before the later onboarding and guided-tour refinements. These checks concern the
platform's behaviour with synthetic records, not the compliance or effectiveness
of a customer's AI system.

| Area                              | Verification and result                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported runtime graph           | Strict type checking, all workspace builds, formatting and 61 unit tests passed on Node 22.22.3 and 24.21.0 with the locked pnpm dependency graph.                                                                                                                                              |
| Database, API, worker and storage | 25 integration tests passed on both runtimes against PostgreSQL 18.6 and a real local MinIO service. They cover scope isolation, relationships, idempotency conflicts, transaction rollback, review races, evidence reuse, stale evidence, export retries, retention and unavailable artifacts. |
| Browser journey                   | Two Chromium tests passed against a fresh local PostgreSQL/Keycloak installation: owner login, system creation, failing evaluation, correction, review and approval, changed-manifest blocking, dossier download, viewer restrictions and mobile navigation.                                    |
| Generated contracts               | Checked-in OpenAPI and Fetch route metadata match generation. Contract regressions cover administration responses, required mutation keys and empty revocation responses.                                                                                                                       |
| SDK packaging                     | Packed contracts, domain and SDK dependencies installed offline into a temporary consumer outside the workspace. Compiled exports, input validation and Fetch requests passed without workspace links. The same check passed in a network-isolated application container.                       |
| SDK portability                   | The compiled SDK smoke passed in Deno and in an actual standalone Supabase Edge user worker (`v1.73.13`, reporting Deno 2.1.4). The portability fixtures use synthetic Fetch transports; the integration examples exercise the real platform API.                                               |
| Clean installation                | The Docker image built from a clean dependency installation. Build, type checking, formatting and unit tests also passed inside the image with networking disabled. Compose installation, explicit migrations, OIDC sign-in, seeding and service restart were exercised.                        |
| Recovery                          | The backup script paused writers, captured the database and artifacts, and resumed services. Restoration into a new empty Compose project succeeded. Verification preserved six artifact/dossier hashes, two snapshot digests and two decision bindings exactly.                                |
| Repository protections            | Existing main protection, linear history, rebase-only merges, `check (22)` / `check (24)` requirements and the outside-contributor CI approval environment were inspected and retained.                                                                                                         |

## PR delivery checks

After the onboarding and guided-tour refinements, the consolidated platform was
checked again on Node 24.21.0:

- `pnpm check`: type checking, 88 unit tests, all workspace builds and formatting passed.
- OpenAPI generation consistency and the offline SDK package smoke passed.
- A new PostgreSQL 18.6 test instance passed migrations and 32 integration tests.
  The S3 test was skipped in this run; the earlier MinIO validation above is separate.
- All 10 Chromium tests passed: eight read-only tour tests with mocked API responses,
  plus the two real OIDC owner/viewer journeys against fresh PostgreSQL and Keycloak
  services. The tour checks include phone and desktop layouts.

The temporary database and identity services were removed after these checks.
The earlier recovery, MinIO and portability checks were not repeated for this
consolidation.

## Repeat the checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm openapi:check
pnpm test:package

# Use a dedicated, migrated PostgreSQL test database.
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/zazie_test \
  pnpm test:integration

# Creates and removes isolated Docker services; uses ports 3002, 55440 and 8182.
pnpm exec playwright install chromium
sh scripts/test-e2e.sh
```

The S3 integration test requires `ZAZIE_TEST_S3_ENDPOINT` and the test bucket and
credentials described in its fixture. Without that configuration it is skipped;
the PostgreSQL suite is also skipped without `TEST_DATABASE_URL`. A skipped suite
does not establish that those integrations work in your installation.

Follow [operations](operations.md) to repeat backup and restoration. Run
`deploy/verify-evidence.mjs` in each installation and compare its proof output.
The [SDK guide](../packages/sdk-typescript/README.md) and
[Edge fixture](../examples/supabase-edge/README.md) provide the portability commands.

## Limits of this acceptance

This is initial MVP acceptance, not a production load test, independent security
audit, hosted Supabase certification, review of an organisation's legal
applicability decisions, or proof that imported evaluations are correct. The
provider profile remains a visibly partial draft. Customer identity providers,
storage policies, operating constraints and recovery procedures require validation
in their actual deployment.

At the time of this initial acceptance, the existing pull request was not merged,
no package or image was published to a registry, and no shared Git history was
rewritten. Hosted CI results and subsequent branch consolidation are separate
from the local checks recorded here.
