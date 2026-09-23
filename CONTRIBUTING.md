# Contributing to Zazie

Zazie is an initial self-hosted evidence and review platform. Contributions should
make real installation, integration, review, or operation easier to verify.

## Local checks

Use the pinned Node LTS and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm openapi:check
```

Run the PostgreSQL integration suite when changing authorization, persistence,
release decisions, or worker behavior. Follow the isolated test-database setup in
[installation](docs/installation.md). Browser tests require the synthetic OIDC
installation; they do not replace login with a test-only authentication endpoint.

Run `pnpm format` after editing. Generate contracts with `pnpm openapi` and commit
both definitions and generated output. Keep strict TypeScript checks enabled.
Never put credentials, real candidate data, or private operating records in
fixtures, logs, issues, or pull requests.

## Changes and review

Outside contributors should fork the repository and open a pull request against `main`. The owner and invited collaborators with write access can create repository branches and merge pull requests through GitHub's normal merge flow. This personal-account repository has owner and collaborator access levels; invitations grant trusted write access. Public access alone does not permit pushing branches or merging changes.

For everyone, including the owner, `main` requires a pull request, passing Node.js 22 and 24 checks against an up-to-date base, and resolved review conversations. Rebase is the only allowed merge method, and linear history is required. Force pushes and branch deletion are blocked on `main`. The main protection rules have no bypass actors; trusted collaborators do not need an exception to merge a pull request that satisfies them.

Outside pull requests require maintainer approval before GitHub Actions runs. CI also uses the `contribution-ci` environment, whose sole reviewer is `@RomainGratier`, for every pull request authored by someone else, including invited collaborators and Dependabot. Each new run using that environment waits for approval before allocating a runner. The owner reviews the proposed code and workflow changes, then uses GitHub's workflow approval and **Review deployments** controls as applicable to authorize testing. This environment is an approval gate for tests; it does not deploy the package. Owner-authored changes use `maintainer-ci`. Invited collaborators have write access and must be trusted with workflows; the environment gate in this workflow is not a security boundary against malicious changes by a write-access collaborator.

Dependabot groups routine minor and patch updates monthly, with at most one open version-update pull request per ecosystem (npm and GitHub Actions). Major upgrades are handled deliberately. Dependency updates still require approval to run CI and are never automatically merged.

Make atomic commits: each commit should explain one coherent change and include its meaningful tests and documentation. A larger initial feature can still be coherent. Use descriptive imperative messages, for example `fix: reject approval after evidence changes`.

In pull requests, describe the concrete behavior before and after, why it matters, and the commands actually run. Explain remaining limits. Review authorization, evidence revisions, transaction boundaries, privacy, recovery behavior, and public contract compatibility. Avoid broad refactors alongside behavior changes.

## Workflow content

Version requirement records, source references, interpretation status, and known
omissions together. A source retrieval is not a legal review. Preserve historical
snapshots when publishing updated packs or changing current policy. Synthetic
thresholds must remain visibly illustrative. Software tests do not validate an
actual high-risk AI system.

Contributions of original work are accepted under the repository's MIT licence.
External source material retains its own applicable terms.
