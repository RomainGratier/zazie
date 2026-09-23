import { z } from 'zod';

const sourceSchema = z.strictObject({
  title: z.string().min(1),
  url: z.url(),
  provision: z.string().min(1),
  textVersion: z.string().min(1),
  checkedOn: z.iso.date(),
  verification: z.enum([
    'retrieved',
    'reference_only',
    'amendment_review_pending',
  ]),
  note: z.string().min(1),
});

export const workflowPackSchema = z
  .strictObject({
    id: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: z.string().min(1),
    status: z.enum(['draft', 'reviewed', 'superseded']),
    scope: z.string().min(1),
    applicabilityInputs: z.array(z.string().min(1)).min(1),
    checkedOn: z.iso.date(),
    interpretationNotice: z.string().min(1),
    coverage: z.array(z.string().min(1)).min(1),
    omissions: z.array(z.string().min(1)).min(1),
    requirements: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          title: z.string().min(1),
          interpretation: z.string().min(1),
          interpretationStatus: z.enum(['draft', 'reviewed', 'superseded']),
          evidenceExpected: z.array(z.string().min(1)).min(1),
          sources: z.array(sourceSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((pack, context) => {
    if (
      new Set(pack.requirements.map((requirement) => requirement.id)).size !==
      pack.requirements.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requirements'],
        message: 'Requirement IDs must be unique.',
      });
    }
    if (
      pack.status === 'reviewed' &&
      pack.requirements.some(
        (requirement) => requirement.interpretationStatus !== 'reviewed',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'A reviewed pack must contain reviewed interpretations.',
      });
    }
  });

export type WorkflowPack = z.infer<typeof workflowPackSchema>;

function source(
  article: number,
  paragraphs: string,
  amended = false,
): z.infer<typeof sourceSchema> {
  return {
    title: `European Commission AI Act Service Desk — Article ${article}`,
    url: `https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-${article}`,
    provision: `Article ${article}, paragraphs ${paragraphs}`,
    textVersion:
      'Regulation (EU) 2024/1689, original 13 June 2024 text displayed by the Service Desk',
    checkedOn: '2026-09-23',
    verification: amended ? 'amendment_review_pending' : 'retrieved',
    note: amended
      ? 'The official page warns that this provision was amended and its displayed text has not been updated. Review the current consolidated provision before relying on this mapping.'
      : 'Original provision retrieved from an official explanatory service. Retrieval is not legal review or confirmation that all later amendments and guidance have been reconciled.',
  };
}

/** Draft workflow suggestions, not an exhaustive legal rule engine or classification service. */
export const providerStarterPack: WorkflowPack = workflowPackSchema.parse({
  id: 'eu-ai-act-provider-starter',
  version: '0.1.0',
  title: 'EU AI Act provider starter — draft',
  status: 'draft',
  scope:
    'Operational evidence for an organisation that has independently classified its software AI system as high-risk and identified its provider responsibilities.',
  applicabilityInputs: [
    'Customer-supplied high-risk classification and rationale',
    'Operator role, intended purpose, deployment context and affected people',
    'Applicable jurisdiction, transition arrangements and sector-specific obligations reviewed by the organisation',
  ],
  checkedOn: '2026-09-23',
  interpretationNotice:
    'This partial draft organises evidence and internal decisions. Source retrieval dates do not indicate legal approval. Confirm applicability and current law before adopting it; release approval in Zazie is an internal decision, not conformity certification.',
  coverage: [
    'Risk records, mitigations and residual-risk decisions',
    'Version-bound evaluation definitions, measurements and evidence',
    'Human-oversight procedures and recorded interventions',
    'Monitoring ownership, evidence freshness and follow-up',
  ],
  omissions: [
    'High-risk classification and prohibited-practice assessment',
    'Complete Article 10 data-governance and Annex IV technical-documentation assessment',
    'Complete quality-management, deployer instructions, logging and retention requirements',
    'Conformity-assessment route, declaration, CE marking and registration',
    'Deployer obligations, fundamental-rights impact assessment applicability and sector-specific rules',
    'Regulatory incident qualification, reporting destinations and legal deadlines',
    'Consolidated amendment review, harmonised standards and complete transition analysis',
  ],
  requirements: [
    {
      id: 'risk-management',
      title: 'Maintain and review system risks',
      interpretationStatus: 'draft',
      interpretation:
        'Record intended-use and foreseeable-misuse risks, selected mitigations and the accountable review of residual risk. Refresh the assessment when the system or its operating context changes.',
      evidenceExpected: [
        'Versioned risk register',
        'Linked mitigation controls',
        'Residual-risk rationale and reviewer decision',
      ],
      sources: [source(9, '1–2 and 5')],
    },
    {
      id: 'evaluation-evidence',
      title: 'Evaluate against defined acceptance criteria',
      interpretationStatus: 'draft',
      interpretation:
        'Define relevant metrics and thresholds before reviewing results. Record the exact tested system and dataset versions, measurements, limitations and supporting evidence.',
      evidenceExpected: [
        'Versioned evaluation definition and dataset',
        'System manifest and evaluation measurements',
        'Evidence artifacts and limitations',
      ],
      sources: [source(9, '6 and 8'), source(15, '1 and 3–5')],
    },
    {
      id: 'human-oversight',
      title: 'Make oversight practicable and record its operation',
      interpretationStatus: 'draft',
      interpretation:
        'Specify who can interpret, challenge and override outputs and intervene safely. Record relevant oversight exercises and interventions; a written procedure alone does not demonstrate effective operation.',
      evidenceExpected: [
        'Adopted oversight procedure and responsible people',
        'Evidence of intervention or an oversight exercise',
        'Recorded limitations and follow-up work',
      ],
      sources: [source(14, '1–4')],
    },
    {
      id: 'monitoring-follow-up',
      title: 'Assign monitoring and follow up on issues',
      interpretationStatus: 'draft',
      interpretation:
        'Describe monitoring sources, responsible people and review intervals. Record discovered issues and follow-up decisions. The current Article 72 mapping needs amendment review before legal adoption.',
      evidenceExpected: [
        'Adopted monitoring procedure',
        'Operational events and assigned findings',
        'Reviewed follow-up decisions',
      ],
      sources: [source(72, '1–3', true)],
    },
  ],
});

export const procedureTemplateSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  status: z.literal('draft'),
  purpose: z.string().min(1),
  requirementIds: z.array(z.string().min(1)),
  sections: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        instructions: z.string().min(1),
      }),
    )
    .min(1),
});

export type ProcedureTemplate = z.infer<typeof procedureTemplateSchema>;

export const procedureTemplates: ProcedureTemplate[] = z
  .array(procedureTemplateSchema)
  .parse([
    {
      id: 'human-oversight',
      version: '0.1.0',
      title: 'Human oversight and intervention',
      status: 'draft',
      purpose:
        'Prepare a system-specific procedure for accountable human intervention.',
      requirementIds: ['human-oversight'],
      sections: [
        {
          title: 'Scope and responsibilities',
          instructions:
            'Identify the system versions and deployment contexts covered, authorised operators, training and escalation contacts.',
        },
        {
          title: 'Interpret and challenge outputs',
          instructions:
            'Explain known limitations, uncertainty, automation bias and the checks an operator performs before acting.',
        },
        {
          title: 'Override, stop and recover',
          instructions:
            'Describe available controls, safe intervention, recovery criteria and a practical exercise that verifies these actions.',
        },
        {
          title: 'Record and review',
          instructions:
            'Define minimal event data, access and retention decisions, issue ownership and review of intervention outcomes.',
        },
      ],
    },
    {
      id: 'monitoring-and-incidents',
      version: '0.1.0',
      title: 'Monitoring and incident triage',
      status: 'draft',
      purpose:
        'Define operational monitoring and accountable handling of reported issues.',
      requirementIds: ['monitoring-follow-up'],
      sections: [
        {
          title: 'Monitoring plan',
          instructions:
            'Select relevant measures and data sources, review intervals, thresholds and an owner. Justify what is collected and avoid unnecessary personal data.',
        },
        {
          title: 'Triage and containment',
          instructions:
            'Record occurrence, receipt and awareness times separately; assess impact, preserve evidence and assign containment and investigation.',
        },
        {
          title: 'External reporting assessment',
          instructions:
            'Assign a qualified person to determine reportability, applicable authority and legal deadlines. Zazie does not calculate statutory reporting deadlines.',
        },
        {
          title: 'Follow-up and effectiveness',
          instructions:
            'Link corrective work to evidence, review whether measures worked and update risk and release reviews as needed.',
        },
      ],
    },
    {
      id: 'change-and-release',
      version: '0.1.0',
      title: 'Change assessment and release review',
      status: 'draft',
      purpose:
        'Review changes against the evidence and responsibilities of a specific release.',
      requirementIds: ['risk-management', 'evaluation-evidence'],
      sections: [
        {
          title: 'Identify the change',
          instructions:
            'Record the new manifest and changes to purpose, components, prompts, datasets, acceptance criteria and deployment context.',
        },
        {
          title: 'Assess impact',
          instructions:
            'Identify affected risks and controls. Justify any evidence reuse and define new validation or oversight work.',
        },
        {
          title: 'Review and decide',
          instructions:
            'Resolve blockers and record an authorised reviewer decision against the frozen snapshot, with rationale and residual-risk consideration.',
        },
        {
          title: 'Monitor the release',
          instructions:
            'Define monitoring ownership, operational signals and conditions for reassessment or withdrawal.',
        },
      ],
    },
  ]);

export const workflowPackJsonSchema = z.toJSONSchema(workflowPackSchema);
