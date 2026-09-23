# Install Zazie

Zazie runs its own API, web application and worker. It requires PostgreSQL, artifact storage and an OIDC identity provider. It does not require an LLM subscription, GPU, or connection to a Zazie-hosted service.

The draft provider profile helps organise evidence and reviews. It is partial and needs your applicability and legal review; see [coverage](coverage.md).

## Local synthetic demonstration

Install Docker with Compose v2 and clone the platform preview branch as shown in the [README](../README.md#see-a-result-with-the-local-demo). The demo uses public, committed credentials and binds exposed services to loopback. Use synthetic data only. It runs Keycloak's development mode, which is not a production identity service.

From the repository root, run:

```sh
bash scripts/demo.sh
```

No host Node.js installation is needed. The launcher builds the application, waits for PostgreSQL, applies migrations, waits for the Keycloak realm, provisions the demo owner, seeds synthetic examples, and starts the API and worker. It waits for API readiness, then prints the URL and credentials. The worker starts alongside the API; check its logs if background jobs do not complete.

Open [Zazie](http://localhost:3000). Sign in as `demo-owner` with password `local-demo-owner-only`. The demo owner's explicit reviewer role allows this person to make release decisions. Merely being an administrator does not grant that permission. Follow the [README walkthrough](../README.md#inspect-an-approval-a-blocked-change-and-an-export) to inspect a completed approval, a blocked prompt change, and an exported dossier.

The default ports are `3000` for Zazie and `8080` for Keycloak. If those ports are occupied, choose alternatives on the first start:

```sh
bash scripts/demo.sh --port 3001 --identity-port 8091
```

The launcher remembers the ports locally and sets the matching application URL, issuer and redirect URI. Once a Keycloak volume exists, the launcher refuses port changes: changing an existing realm requires an explicit identity/client configuration update.

```sh
bash scripts/demo.sh stop    # Retain database, identity and artifact volumes.
bash scripts/demo.sh         # Start again using the saved ports.
bash scripts/demo.sh status
bash scripts/demo.sh logs
```

Repeated starts reuse existing records and skip demonstration systems already seeded. Bootstrap checks that the existing demo owner is active and has the required roles; it does not grant or reinstate permissions. If those permissions have changed, an authorised administrator must resolve that deliberately before rerunning the launcher.

The launcher also supports an existing demo started manually with the `zazie-demo` project and default ports. If that demo used different ports, pass those same ports on the launcher's first run. A deployment using another Compose project name has separate volumes; the launcher does not migrate those records. Do not remove Compose volumes if you want to preserve records and evidence.

The default identity issuer is `http://keycloak.localhost:8080/realms/zazie-demo`. Browsers resolve names ending in `.localhost` to the local machine; inside Compose the same name resolves to Keycloak through its network alias. If your host's resolver does not recognise this name, add `127.0.0.1 keycloak.localhost` to your hosts file. If startup fails, inspect the logs and rerun the launcher after resolving the reported problem.

Keycloak's local administration account is `demo-admin` / `local-demo-admin-only`. The additional `demo-viewer` / `local-demo-viewer-only` identity has subject `22222222-2222-4222-8222-222222222222`; an administrator must grant its Zazie membership explicitly before it can access application records.

## Your organisation

1. Copy `.env.example` to `.env.platform`. Preserve any existing `.env` file. Generate independent secrets for PostgreSQL administration, migrations, runtime database access and sessions, for example with `openssl rand -hex 32`. The Compose URL defaults expect URL-safe passwords.
2. Register a confidential OIDC client with authorization-code flow and PKCE. Set its exact redirect URI to `PUBLIC_URL/auth/callback`. Fill in issuer, client ID and secret. Use HTTPS, `COOKIE_SECURE=true` and `OIDC_ALLOW_INSECURE_HTTP=false`.
3. Configure TLS termination and the trusted proxy as described below. The bundled Compose API binds to `127.0.0.1:3000`, intended for a reverse proxy on the host. Expose only the intended public endpoint; PostgreSQL has no published port. Stop a demo on the same port with `bash scripts/demo.sh stop` before starting this installation.
4. Build, migrate, and bootstrap using your verified identity provider issuer and subject. Subjects are identity IDs, not email addresses. The bootstrap command is deployment-controlled and does not discover an administrator from the first person to log in.

```sh
dc() {
  docker compose --project-name zazie --env-file .env.platform -f deploy/compose/compose.yaml "$@"
}
dc build
dc up -d --wait postgres
dc run --rm migrate
dc run --rm api pnpm bootstrap \
  --issuer https://identity.example.com/realms/organisation \
  --subject YOUR_VERIFIED_SUBJECT --name "System administrator" \
  --organization "Your organisation" --roles admin,editor,reviewer,viewer
dc up -d --wait api worker
```

Choose only the roles that person should hold. Grant reviewer permission explicitly to the people who make release decisions. Do not run `seed` on an installation containing real data.

Database migrations run as `zazie_owner`; API and worker use `zazie_app`. The initialization script creates non-superuser roles only for a new PostgreSQL volume. The migration step grants runtime access and restricts historical records. Changing password environment variables does not rotate roles in an existing PostgreSQL database; follow [operations](operations.md).

For managed PostgreSQL, set both `DATABASE_URL` and `MIGRATION_DATABASE_URL` and provision equivalent owner/runtime roles. The included `postgres` service is a convenience; use your deployment manager to replace that dependency. Ensure your connection enables certificate verification as required by your database provider.

For S3-compatible storage set `STORAGE_DRIVER=s3`, bucket, region and provider credentials. Set `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` for services that require them. Provision a private bucket first. The adapter requires conditional create support and validates content against its recorded hash. Do not give integrations direct bucket credentials.

## HTTPS and reverse proxy setup

In the bundled production topology, the browser reaches your reverse proxy over HTTPS and the proxy forwards requests to `http://127.0.0.1:3000`. Configure the proxy to preserve the original host and overwrite forwarding headers with the original request scheme and client address. For the HTTPS endpoint, `X-Forwarded-Proto` must be `https`; client-supplied forwarding headers must not be trusted as-is.

Uncomment `TRUST_PROXY` in `.env.platform` and set it to the proxy source IP address or CIDR **as seen by the API**, using commas for multiple trusted sources. Compose forwards this setting to the application. For a host proxy crossing Docker's bridge, this may be the bridge gateway address rather than `127.0.0.1`. Check the actual network path before choosing the value. If the proxy runs in a separate container, its network and connection to the API need corresponding configuration.

Keep trust restricted to your controlled proxy hop. Do not use a network range that admits arbitrary clients, and keep the API's upstream port inaccessible to them. Leave `COOKIE_SECURE=true`; the application only issues a secure session cookie when it recognises the request as HTTPS. An empty or incorrect `TRUST_PROXY` value behind TLS termination can therefore prevent login from persisting.

After setting or changing this configuration, recreate the API with `dc up -d api`. Open the public HTTPS URL, sign in, and confirm the browser receives a `Secure`, `HttpOnly` session cookie and remains signed in after reloading. If it does not, inspect the proxy's forwarding configuration and the trusted source address instead of disabling secure cookies.

## Development

Use the pinned Node version from `.node-version` and pnpm from `package.json`. Install with `pnpm install --frozen-lockfile`, then `pnpm check`. The application and worker require their environment variables; do not load unrelated legacy `.env` credentials into the new platform.

Migrations are explicit: `pnpm db:migrate`. Development entrypoints are `pnpm dev` and `pnpm worker`; production entrypoints use the built `apps/api/dist/main.js` and `apps/worker/dist/main.js`. The API serves the built web application. Use the web package's Vite development command when iterating on its UI.

`pnpm test:e2e` requires a running API and worker, the synthetic Keycloak realm and provisioned owner/viewer memberships. The owner's reviewer permission must be explicit. Set the test base URL to the installation under test; do not run these mutation tests against an organisation containing real evidence. PostgreSQL integration tests use an isolated `TEST_DATABASE_URL`; optional S3 parity tests use `ZAZIE_TEST_S3_ENDPOINT` and a pre-created synthetic test bucket.
