#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import {
  EvaluationInputSchema,
  VersionInputSchema,
  type ArtifactInput,
  type Resource,
} from '@zazie/contracts';
import { ZazieClient } from '@zazie/sdk-typescript';

interface GlobalOptions {
  url?: string;
  json?: boolean;
}
interface SystemOptions {
  system: string;
}
type Output = (message: string) => void;
export interface CliDependencies {
  environment?: NodeJS.ProcessEnv;
  stdout?: Output;
  stderr?: Output;
  client?: ZazieClient;
  sleep?: (milliseconds: number) => Promise<void>;
}

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/** Returns the process exit status so release gates and errors can be tested without exiting. */
export async function runCli(
  args: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const environment = dependencies.environment ?? process.env;
  const stdout =
    dependencies.stdout ?? ((value) => process.stdout.write(`${value}\n`));
  const stderr =
    dependencies.stderr ?? ((value) => process.stderr.write(`${value}\n`));
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  let status = 0;
  const program = new Command('zazie')
    .description(
      'Evidence collection and internal release review for a self-hosted Zazie installation.',
    )
    .version('0.2.0', '-V, --cli-version')
    .option(
      '--url <url>',
      'API URL including /api/v1',
      environment['ZAZIE_API_URL'] ?? 'http://localhost:3000/api/v1',
    )
    .option('--json', 'Write machine-readable JSON')
    .exitOverride();
  program.configureOutput({
    writeOut: (value) => stdout(value.trimEnd()),
    writeErr: (value) => stderr(value.trimEnd()),
  });
  const client = () =>
    dependencies.client ??
    new ZazieClient({
      baseUrl: program.opts<GlobalOptions>().url!,
      ...(environment['ZAZIE_API_TOKEN']
        ? { token: environment['ZAZIE_API_TOKEN'] }
        : {}),
    });
  const output = (value: unknown) =>
    stdout(
      JSON.stringify(value, null, program.opts<GlobalOptions>().json ? 0 : 2),
    );

  program
    .command('init')
    .description(
      'Write a synthetic version manifest; never overwrites an existing file',
    )
    .argument('[path]', 'Destination', 'zazie-manifest.json')
    .action(async (path: string) => {
      await writeFile(
        path,
        `${JSON.stringify({ label: 'synthetic-v1', components: { model: 'synthetic-fixture-1', prompt: 'sha256:replace-with-your-prompt-digest', code: 'replace-with-your-commit' }, changeSummary: 'Initial synthetic example. Replace every component with the actual immutable version.' }, null, 2)}\n`,
        { flag: 'wx' },
      );
      output({ created: resolve(path), synthetic: true });
    });

  program
    .command('doctor')
    .description(
      'Check API readiness and authenticated access without displaying credentials',
    )
    .action(async () => {
      const api = client();
      const health = await api.request<{
        status?: string;
        apiVersion?: string;
      }>('healthReady');
      await api.request('listSystems', { query: { limit: 1 } });
      if (health.apiVersion !== '1.0')
        throw new Error(
          `Unsupported or missing API version: ${health.apiVersion ?? 'unknown'}`,
        );
      if (!health.status || !['ok', 'ready'].includes(health.status))
        throw new Error('API is not ready');
      output({
        ready: true,
        authenticated: true,
        apiVersion: health.apiVersion,
      });
    });

  program
    .command('validate')
    .description('Validate a local version manifest or evaluation report')
    .argument('<kind>', 'manifest | evaluation')
    .argument('<file>')
    .action(async (kind: string, file: string) => {
      const schema =
        kind === 'manifest'
          ? VersionInputSchema
          : kind === 'evaluation'
            ? EvaluationInputSchema
            : undefined;
      if (!schema)
        throw new Error('Validation kind must be manifest or evaluation');
      schema.parse(await jsonFile(file));
      output({ valid: true, kind, file });
    });

  program
    .command('versions')
    .description('Immutable system version manifests')
    .command('submit')
    .requiredOption('--system <id>', 'System ID')
    .argument('<file>')
    .action(async (file: string, options: SystemOptions) => {
      output(
        await client().submitVersion(
          options.system,
          VersionInputSchema.parse(await jsonFile(file)),
        ),
      );
    });
  program
    .command('evaluations')
    .description('Imported evaluation evidence')
    .command('submit')
    .requiredOption('--system <id>', 'System ID')
    .argument('<file>')
    .action(async (file: string, options: SystemOptions) => {
      output(
        await client().submitEvaluation(
          options.system,
          EvaluationInputSchema.parse(await jsonFile(file)),
        ),
      );
    });
  program
    .command('artifacts')
    .description('Stored evidence artifacts')
    .command('submit')
    .requiredOption('--system <id>', 'System ID')
    .requiredOption('--provenance <text>', 'Who produced this evidence and how')
    .option('--type <mime>', 'MIME type', 'application/octet-stream')
    .argument('<file>')
    .action(
      async (
        file: string,
        options: SystemOptions & { provenance: string; type: string },
      ) => {
        const metadata: ArtifactInput = {
          filename: basename(file),
          contentType: options.type,
          provenance: options.provenance,
        };
        output(
          await client().uploadArtifact(
            options.system,
            metadata,
            new Uint8Array(await readFile(file)),
          ),
        );
      },
    );

  program
    .command('releases')
    .description('Configured release gates; not a legal compliance certificate')
    .command('check')
    .requiredOption('--system <id>', 'System ID')
    .requiredOption('--version <id>', 'Immutable system version ID')
    .requiredOption('--deployment <id>', 'Deployment ID')
    .option('--purpose <purpose>', 'review | deploy', 'deploy')
    .action(
      async (
        options: SystemOptions & {
          version: string;
          deployment: string;
          purpose: string;
        },
      ) => {
        if (options.purpose !== 'review' && options.purpose !== 'deploy')
          throw new Error('Purpose must be review or deploy');
        const result = await client().checkRelease(
          options.system,
          options.version,
          options.deployment,
          options.purpose,
        );
        if (
          typeof result.satisfied !== 'boolean' ||
          result.purpose !== options.purpose ||
          typeof result.approvedForDeployment !== 'boolean' ||
          typeof result.readyForReview !== 'boolean'
        )
          throw new Error(
            'Invalid release-check response; the gate is unknown',
          );
        if (
          options.purpose === 'deploy' &&
          result.satisfied &&
          !result.approvedForDeployment
        )
          throw new Error(
            'Invalid release-check response: readiness alone cannot approve deployment',
          );
        status = result.satisfied ? 0 : 1;
        output(result);
      },
    );

  program
    .command('dossiers')
    .description('Evidence-linked dossier archives')
    .command('export')
    .requiredOption('--system <id>', 'System ID')
    .requiredOption('--review <id>', 'Release review ID')
    .requiredOption(
      '--out <file>',
      'Destination ZIP; will not overwrite an existing file',
    )
    .option('--timeout <seconds>', 'Maximum generation wait', '60')
    .action(
      async (
        options: SystemOptions & {
          review: string;
          out: string;
          timeout: string;
        },
      ) => {
        const timeout = Number(options.timeout);
        if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600)
          throw new Error('Timeout must be between 1 and 600 seconds');
        const api = client();
        let dossier = (await api.submitResource(options.system, 'dossiers', {
          releaseReviewId: options.review,
        })) as Resource<{ status?: string }>;
        const deadline = Date.now() + timeout * 1000;
        while (!['completed', 'ready'].includes(dossier.data.status ?? '')) {
          if (dossier.data.status === 'failed')
            throw new Error(
              'Dossier generation failed; inspect the job in Zazie',
            );
          if (Date.now() >= deadline)
            throw new Error(
              `Dossier ${dossier.id} is still pending; inspect or download it in Zazie`,
            );
          await sleep(1_000);
          dossier = await api.request('get:dossiers', {
            path: { systemId: options.system, resourceId: dossier.id },
          });
        }
        const contents = await api.request<ArrayBuffer>('downloadDossier', {
          path: { systemId: options.system, resourceId: dossier.id },
        });
        await writeFile(options.out, new Uint8Array(contents), { flag: 'wx' });
        output({ dossierId: dossier.id, path: resolve(options.out) });
      },
    );

  try {
    await program.parseAsync(args, { from: 'user' });
    return status;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    const message =
      error instanceof Error ? error.message : 'Unknown CLI error';
    const redacted = environment['ZAZIE_API_TOKEN']
      ? message.replaceAll(environment['ZAZIE_API_TOKEN'], '[redacted]')
      : message;
    stderr(JSON.stringify({ error: redacted, status: 'unknown' }));
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runCli(process.argv.slice(2));
