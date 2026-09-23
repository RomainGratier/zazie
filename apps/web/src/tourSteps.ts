export interface TourStep {
  page: 'overview' | 'systems' | 'system';
  tab?: string;
  title: string;
  location: string;
  target: string;
  anchor: string;
  introduction: string;
  points: readonly string[];
  example?: string;
  reminder: string;
}

export const tourSteps: readonly TourStep[] = [
  {
    page: 'overview',
    title: 'Your workspace at a glance',
    location: 'Workspace → Overview',
    target: 'workspace-overview',
    anchor: '#nav-overview',
    introduction:
      'Zazie brings together your AI systems, their evidence, and your team’s decisions. This overview summarises the systems you can access across your organisation.',
    points: [
      'Your team defines requirements. Your application sends events and evaluation results. Zazie checks configured criteria and records human review.',
      'The workspace overview helps you see systems and follow-up work across the organisation.',
      'Use Next and Back to follow one system from setup and incoming data through evidence, approval, and a shareable record.',
    ],
    reminder:
      'The tour explains the flow without creating or changing any records. You can end it at any time.',
  },
  {
    page: 'systems',
    title: 'Your AI systems',
    location: 'Workspace → AI systems',
    target: 'system-list',
    anchor: '#system-list h2',
    introduction:
      'Each AI system has its own purpose, owners, versions, evidence, and decisions. Next takes you into an existing system to see how those pieces fit together.',
    points: [
      'The walkthrough uses an existing system. You can inspect another system after ending the tour.',
      'If no system exists, use the normal Register system flow when you have permission. Your team supplies its purpose, owner, classification, and profile.',
      'The tabs inside a system guide you from its context to configuration, operations, evidence, release review, and documents.',
    ],
    reminder:
      'The walkthrough opens existing records. The tour does not create a demonstration system or register one for you.',
  },
  {
    page: 'system',
    title: 'Understand the flow',
    tab: 'overview',
    location: 'System context',
    target: 'system-context',
    anchor: '#system-context > header h2',
    introduction:
      'Zazie keeps the requirements, evidence, and human decisions for your AI system. Your application continues running in its own environment.',
    points: [
      'Start small: collect events to keep a history of what happens.',
      'Add release requirements when you want evidence checks and human approval.',
      'Your team chooses the safeguards, investigates issues, and owns the decisions.',
    ],
    example:
      'For a CV-filtering system, record recruiter corrections during operation and collect evaluation results before approving a new scoring prompt.',
    reminder:
      'This tour explains the screens. It does not create or change any records.',
  },
  {
    page: 'system',
    title: 'Start with a system version',
    tab: 'configuration',
    location: 'Risks & configuration → Versions',
    target: 'section-versions',
    anchor: '#section-versions > header h2',
    introduction:
      'The system describes its purpose and owner. A version identifies the exact model, prompt, and application you are monitoring.',
    points: [
      'To send events, you need a registered system, a version, and an integration credential.',
      'A deployment adds an operating context, such as production. It is optional for events and required for release approval.',
      'You can collect events before configuring risks, controls, or evaluation criteria.',
    ],
    example:
      'Record “CV filter v1” with its model and scoring-prompt versions. A changed scoring prompt needs a new version and a fresh release review.',
    reminder:
      'Recording a version or deployment does not deploy your application.',
  },
  {
    page: 'system',
    title: 'Define what a release must satisfy',
    tab: 'configuration',
    location: 'Risks & configuration → Risks, Controls, and Procedures',
    target: 'section-controls',
    anchor: '#system-tabs [aria-current="page"]',
    introduction:
      'Release approval needs your team’s requirements. A control is a safeguard you expect to work, supported by evidence and review.',
    points: [
      'Record risks, assign owners, and justify the decision about the remaining risk.',
      'Link controls to risks and applicable profile requirements. Each control needs evaluation criteria and an evidence freshness window.',
      'Write and adopt any procedures those controls require. Configuration, observed operation, and human review are separate states.',
    ],
    example:
      'Risk: recommendations contain unsupported claims. Control: test recommendations against the supplied evidence before each release.',
    reminder:
      'The starter profile is a partial draft. Your team reviews its applicability and omissions; saving a control does not prove it works.',
  },
  {
    page: 'system',
    title: 'Connect your application',
    tab: 'operations',
    location: 'Operations → Events',
    target: 'section-events',
    anchor: '#system-tabs [aria-current="page"]',
    introduction:
      'Your engineer adds sending code to your application or pipeline. The events it sends appear here.',
    points: [
      'Ask an administrator for a credential in Administration → Integration credentials, with Submit events permission for this system.',
      'Configure the sender with the Zazie API URL, credential, system ID, and version ID. Send through the REST API or SDK.',
      'The Events list shows the type, source, and timestamps. Open Inspect record to read the submitted details.',
    ],
    example:
      'A recruiter corrects an AI suggestion. Your application sends an oversight.override_recorded event describing the correction.',
    reminder:
      'Choose what to send in your application code. Zazie has no event-subscription screen and collects no application content automatically.',
  },
  {
    page: 'system',
    title: 'Turn observations into follow-up',
    tab: 'operations',
    location: 'Operations → Findings and Incidents',
    target: 'section-findings',
    anchor: '#section-findings > header h2',
    introduction:
      'An event says “something happened.” A finding says “someone needs to investigate or fix this.”',
    points: [
      'A person inspects events and creates a finding when follow-up is needed, with an owner, severity, and optional due date.',
      'Mark a finding as blocking when it must prevent release approval. Record an incident when appropriate.',
      'Fix the application outside Zazie, upload supporting evidence, and have an authorised reviewer record the finding’s resolution.',
    ],
    example:
      'Repeated unsupported screening suggestions lead your team to create an assigned finding. A new prompt and evaluation report document the correction.',
    reminder:
      'Events do not create findings or notifications automatically. Background checks can create findings for stale or unavailable release evidence.',
  },
  {
    page: 'system',
    title: 'Bring the evidence',
    tab: 'evidence',
    location: 'Evaluations & evidence',
    target: 'section-evaluation-definitions',
    anchor: '#system-tabs [aria-current="page"]',
    introduction:
      'Define what to measure and what result is acceptable. Your evaluation pipeline runs the tests and sends the results with supporting files.',
    points: [
      'Create an evaluation definition with numeric criteria, and a dataset record when the evaluation uses one.',
      'Upload the report as an artifact, then submit measurements for the exact system version, definition revision, and dataset revision when required.',
      'Zazie checks the measurements against your criteria. Failing results, missing evidence, or stale evidence can block release.',
    ],
    example:
      'Illustrative team-defined rule: error rate must be at most 5%. A submitted result of 8% fails that rule; an event saying “test completed” is not an evaluation result.',
    reminder:
      'Zazie does not run these tests or verify their execution. Your team must assess whether the tests and thresholds are appropriate.',
  },
  {
    page: 'system',
    title: 'Review, then approve',
    tab: 'release',
    location: 'Release review',
    target: 'release-check',
    anchor: '#system-tabs [aria-current="page"]',
    introduction:
      'Choose the exact version and deployment to see what is missing. Ready for review and approved for deployment are different states.',
    points: [
      'Resolve blockers and have an authorised reviewer assess the current controls and evidence.',
      'Request release review to freeze the record. Someone with reviewer permission approves or rejects that snapshot; administrator access alone is not enough.',
      'Your CI can query the release check and enforce the result before deploying. Changed evidence or a new version can require fresh review.',
    ],
    example:
      'After a corrected evaluation and human review, approve CV filter v1 for its production context. That decision does not automatically cover v2.',
    reminder:
      'Zazie records the decision. It does not deploy, roll back, stop your application, or send outbound webhooks.',
  },
  {
    page: 'system',
    title: 'Keep a shareable record',
    tab: 'documents',
    location: 'Documents → Dossier exports and Procedure templates',
    target: 'dossier-exports',
    anchor: '#system-tabs [aria-current="page"]',
    introduction:
      'Export the review record for your team or an external reviewer, and use procedure templates to document how your team works.',
    points: [
      'A dossier contains the frozen record, an HTML report, structured data, evidence files, and content hashes.',
      'Missing or unreviewed sections stay explicit. Historical decisions remain tied to their original snapshots.',
      'Adapt procedure templates to your actual responsibilities and operating instructions before adopting them.',
    ],
    example:
      'Share the evidence and decision behind CV filter v1, including what was tested, who reviewed it, and which limitations were recorded.',
    reminder:
      'A dossier supports review; it is not a compliance certificate. You can replay this tour at any time.',
  },
];
