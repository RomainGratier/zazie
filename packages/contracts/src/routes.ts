export interface RouteDefinition {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  schema?: string;
  update?: boolean;
  public?: boolean;
  response?: 'list' | 'resource' | 'readiness' | 'binary' | 'health' | 'empty';
  responseSchema?: string;
}

const system = '/systems/{systemId}';
const resources = [
  ['versions', 'VersionInput', false],
  ['deployments', 'DeploymentInput', true],
  ['risks', 'RiskInput', true],
  ['controls', 'ControlInput', true],
  ['datasets', 'DatasetInput', true],
  ['procedures', 'ProcedureInput', true],
  ['procedure-adoptions', 'ProcedureAdoptionInput', false],
  ['applicability-decisions', 'ApplicabilityDecisionInput', false],
  ['evaluation-definitions', 'EvaluationDefinitionInput', true],
  ['evaluations', 'EvaluationInput', false],
  ['findings', 'FindingInput', false],
  ['incidents', 'IncidentInput', true],
  ['release-reviews', 'ReleaseReviewInput', false],
  ['dossiers', 'DossierInput', false],
] as const;

/** One route catalog generates public documentation and SDK transport metadata. */
export const routes: RouteDefinition[] = [
  {
    id: 'healthLive',
    method: 'GET',
    path: '/health/live',
    public: true,
    response: 'health',
  },
  {
    id: 'healthReady',
    method: 'GET',
    path: '/health/ready',
    public: true,
    response: 'health',
  },
  { id: 'listSystems', method: 'GET', path: '/systems', response: 'list' },
  {
    id: 'createSystem',
    method: 'POST',
    path: '/systems',
    schema: 'SystemInput',
    response: 'resource',
  },
  { id: 'getSystem', method: 'GET', path: system, response: 'resource' },
  {
    id: 'updateSystem',
    method: 'PUT',
    path: system,
    schema: 'SystemInput',
    update: true,
    response: 'resource',
  },
  ...resources.flatMap(([resource, schema, update]): RouteDefinition[] => [
    {
      id: `list:${resource}`,
      method: 'GET',
      path: `${system}/${resource}`,
      response: 'list',
    },
    {
      id: `create:${resource}`,
      method: 'POST',
      path: `${system}/${resource}`,
      schema,
      response: 'resource',
    },
    {
      id: `get:${resource}`,
      method: 'GET',
      path: `${system}/${resource}/{resourceId}`,
      response: 'resource',
    },
    ...(update
      ? [
          {
            id: `update:${resource}`,
            method: 'PUT' as const,
            path: `${system}/${resource}/{resourceId}`,
            schema,
            update: true,
            response: 'resource' as const,
          },
        ]
      : []),
  ]),
  {
    id: 'listEvents',
    method: 'GET',
    path: `${system}/events`,
    response: 'list',
  },
  {
    id: 'submitEvents',
    method: 'POST',
    path: `${system}/events`,
    schema: 'EventBatchInput',
    response: 'list',
  },
  {
    id: 'listArtifacts',
    method: 'GET',
    path: `${system}/artifacts`,
    response: 'list',
  },
  {
    id: 'uploadArtifact',
    method: 'POST',
    path: `${system}/artifacts`,
    schema: 'ArtifactUploadInput',
    response: 'resource',
  },
  {
    id: 'getArtifact',
    method: 'GET',
    path: `${system}/artifacts/{resourceId}`,
    response: 'resource',
  },
  {
    id: 'downloadArtifact',
    method: 'GET',
    path: `${system}/artifacts/{resourceId}/content`,
    response: 'binary',
  },
  {
    id: 'reviewControl',
    method: 'POST',
    path: `${system}/controls/{resourceId}/reviews`,
    schema: 'ControlReviewInput',
    response: 'resource',
  },
  {
    id: 'decideRelease',
    method: 'POST',
    path: `${system}/release-reviews/{resourceId}/decisions`,
    schema: 'ReviewDecisionInput',
    response: 'resource',
  },
  {
    id: 'reuseEvidence',
    method: 'POST',
    path: `${system}/evidence-reuse`,
    schema: 'EvidenceReuseInput',
    response: 'resource',
  },
  {
    id: 'resolveFinding',
    method: 'POST',
    path: `${system}/findings/{resourceId}/resolutions`,
    schema: 'FindingResolutionInput',
    response: 'resource',
  },
  {
    id: 'checkRelease',
    method: 'GET',
    path: `${system}/releases/check`,
    response: 'readiness',
  },
  {
    id: 'downloadDossier',
    method: 'GET',
    path: `${system}/dossiers/{resourceId}/download`,
    response: 'binary',
  },
  { id: 'logout', method: 'DELETE', path: '/session', response: 'empty' },
  {
    id: 'getSession',
    method: 'GET',
    path: '/session',
    response: 'resource',
    responseSchema: 'SessionResponse',
  },
  {
    id: 'listMemberships',
    method: 'GET',
    path: '/memberships',
    response: 'list',
    responseSchema: 'MembershipListResponse',
  },
  {
    id: 'createMembership',
    method: 'POST',
    path: '/memberships',
    schema: 'MembershipInput',
    response: 'resource',
    responseSchema: 'MembershipResponse',
  },
  {
    id: 'revokeMembership',
    method: 'DELETE',
    path: '/memberships/{resourceId}',
    response: 'empty',
  },
  {
    id: 'updateMembership',
    method: 'PUT',
    path: '/memberships/{resourceId}',
    schema: 'MembershipUpdateInput',
    response: 'resource',
    responseSchema: 'MembershipResponse',
  },
  {
    id: 'listTokens',
    method: 'GET',
    path: '/tokens',
    response: 'list',
    responseSchema: 'TokenListResponse',
  },
  {
    id: 'createToken',
    method: 'POST',
    path: '/tokens',
    schema: 'TokenInput',
    response: 'resource',
    responseSchema: 'TokenCreationResponse',
  },
  {
    id: 'revokeToken',
    method: 'DELETE',
    path: '/tokens/{resourceId}',
    response: 'empty',
  },
];
export type OperationId = (typeof routes)[number]['id'];
