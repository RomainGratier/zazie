import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { jsonSchemas, routes } from '../packages/contracts/src/index.js';

const check = process.argv.includes('--check');
const resource = {
  type: 'object',
  required: ['id', 'revision', 'data'],
  properties: {
    id: { type: 'string' },
    organizationId: { type: 'string' },
    systemId: { type: 'string', nullable: true },
    revision: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
    data: { type: 'object', additionalProperties: true },
  },
};
const list = {
  type: 'object',
  required: ['items'],
  properties: {
    items: { type: 'array', items: resource },
    nextCursor: { type: 'string' },
  },
};
const paths: Record<string, Record<string, unknown>> = {};

for (const route of routes) {
  const parameters: Record<string, unknown>[] = [
    ...route.path.matchAll(/\{([^}]+)\}/g),
  ].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (route.method !== 'GET')
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: route.method === 'POST' || route.method === 'PUT',
      schema: { type: 'string', format: 'uuid' },
      description:
        'Reuse the same key only for identical requests. Conflicting reuse returns 409.',
    });
  if (route.response === 'list' && route.method === 'GET')
    parameters.push(
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: 'offset',
        in: 'query',
        schema: { type: 'integer', minimum: 0, default: 0 },
      },
    );
  if (route.id === 'checkRelease')
    parameters.push(
      ...['versionId', 'deploymentId'].map((name) => ({
        name,
        in: 'query',
        required: true,
        schema: { type: 'string' },
      })),
      {
        name: 'purpose',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['review', 'deploy'],
          default: 'deploy',
        },
      },
    );
  const requestSchema = route.schema
    ? { $ref: `#/components/schemas/${route.schema}` }
    : undefined;
  const responseSchema = route.responseSchema
    ? { $ref: `#/components/schemas/${route.responseSchema}` }
    : route.response === 'list'
      ? list
      : route.response === 'binary'
        ? { type: 'string', format: 'binary' }
        : route.response === 'resource'
          ? resource
          : { type: 'object', additionalProperties: true };
  const contentType =
    route.response === 'binary'
      ? 'application/octet-stream'
      : 'application/json';
  const operation = {
    operationId: route.id,
    tags: [route.path.split('/')[1]],
    security: route.public ? [] : [{ bearerAuth: [] }, { sessionCookie: [] }],
    parameters,
    ...(requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: route.update
                  ? {
                      type: 'object',
                      required: ['expectedRevision', 'data'],
                      additionalProperties: false,
                      properties: {
                        expectedRevision: { type: 'integer', minimum: 1 },
                        data: requestSchema,
                      },
                    }
                  : requestSchema,
              },
            },
          },
        }
      : {}),
    responses: {
      ...(route.response === 'empty'
        ? { '204': { description: 'Successful operation; no response body' } }
        : {
            '200': {
              description: 'Successful operation',
              content: { [contentType]: { schema: responseSchema } },
            },
          }),
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 413, 429, 503].map((status) => [
          String(status),
          {
            description: 'Structured API error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        ]),
      ),
    },
  };
  (paths[route.path] ??= {})[route.method.toLowerCase()] = operation;
}

const document = {
  openapi: '3.0.3',
  info: {
    title: 'Zazie API',
    version: '1.0',
    description:
      'Self-hosted evidence collection and internal release decisions. No automatic legal certification. Browser mutations require the session CSRF token.',
  },
  servers: [{ url: '/api/v1' }],
  paths,
  components: {
    schemas: jsonSchemas(),
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'zazie_session' },
    },
  },
};
const generated = await format(
  `// Generated by scripts/generate-openapi.ts. Do not edit.\nexport const operations = ${JSON.stringify(Object.fromEntries(routes.map(({ id, method, path, response }) => [id, { method, path, response }])), null, 2)} as const;\nexport type OperationId = keyof typeof operations;\n`,
  { parser: 'typescript', singleQuote: true },
);
const openapi = await format(JSON.stringify(document), { parser: 'json' });
for (const [relative, contents] of [
  ['../openapi.json', openapi],
  ['../packages/sdk-typescript/src/generated/operations.ts', generated],
] as const) {
  const target = fileURLToPath(new URL(relative, import.meta.url));
  if (check) {
    if ((await readFile(target, 'utf8').catch(() => '')) !== contents)
      throw new Error(`Generated contract is stale: ${target}`);
  } else await writeFile(target, contents);
}
