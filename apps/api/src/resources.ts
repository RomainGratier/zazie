import * as c from '@zazie/contracts';
import { z } from 'zod';
export const ArtifactUploadSchema = c.ArtifactInputSchema.extend({
  contentBase64: z
    .string()
    .max(70 * 1024 * 1024)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const resourceSchemas: Record<string, z.ZodType> = {
  versions: c.VersionInputSchema,
  deployments: c.DeploymentInputSchema,
  risks: c.RiskInputSchema,
  controls: c.ControlInputSchema,
  datasets: c.DatasetInputSchema,
  procedures: c.ProcedureInputSchema,
  'procedure-adoptions': c.ProcedureAdoptionInputSchema,
  'evaluation-definitions': c.EvaluationDefinitionInputSchema,
  evaluations: c.EvaluationInputSchema,
  'release-reviews': c.ReleaseReviewInputSchema,
  findings: c.FindingInputSchema,
  incidents: c.IncidentInputSchema,
  dossiers: c.DossierInputSchema,
  'evidence-reuse': c.EvidenceReuseInputSchema,
  artifacts: ArtifactUploadSchema,
  'applicability-decisions': c.ApplicabilityDecisionInputSchema,
};
export const mutableResources = new Set([
  'deployments',
  'risks',
  'controls',
  'datasets',
  'procedures',
  'evaluation-definitions',
  'incidents',
]);
export const overviewKeys: Record<string, string> = {
  'evaluation-definitions': 'evaluationDefinitions',
  'release-reviews': 'releaseReviews',
  'procedure-adoptions': 'procedureAdoptions',
  'control-reviews': 'controlReviews',
  'evidence-reuse': 'evidenceReuse',
  'finding-resolutions': 'findingResolutions',
  'applicability-decisions': 'applicabilityDecisions',
};
export const evidenceChanging = new Set([
  'risks',
  'controls',
  'datasets',
  'procedures',
  'procedure-adoptions',
  'evaluation-definitions',
  'evaluations',
  'artifacts',
  'evidence-reuse',
  'applicability-decisions',
  'findings',
]);
