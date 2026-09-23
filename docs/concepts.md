# From system registration to release approval

Zazie records what your organisation intends to deploy, the evidence supporting it,
and the people who reviewed it. Your organisation supplies its high-risk
classification, applicable obligations and acceptance criteria. The included
workflow profile is a partial draft, with its sources and omissions visible.

## Describe the system once, version each release

A **system** describes the intended use, affected people, responsible owner and
supplied obligation profile. Updating this context preserves its earlier revision.
A **version manifest** identifies the actual model, prompts, configuration and
other components in a release. Submitted manifests are immutable: a changed
scoring prompt means a new manifest. A **deployment** gives the operating context
for that version, such as a particular staging or production environment.

This separation lets one system have several versions and deployments without
silently extending an approval to another context.

## Define evidence before judging the release

Record the risks, controls, evaluation definitions, dataset versions and adopted
procedures that support the release. An evaluation definition contains explicit
acceptance criteria, such as a named measurement meeting a justified threshold.
Your evaluation runner supplies measurements and stored supporting artifacts,
bound to the exact manifest, definition revision and dataset revision.

Zazie recalculates those criteria. It cannot establish that an external runner
executed correctly, or that your chosen dataset and thresholds are adequate.
Imported results therefore remain labelled as externally supplied evidence with
unverified execution.

Each control has three separate states:

| State         | What it establishes                                                            |
| ------------- | ------------------------------------------------------------------------------ |
| Configuration | The required control, assignment and dependencies have been recorded.          |
| Operation     | The configured evidence requirements are currently satisfied for this version. |
| Review        | An authorised reviewer has assessed the current control and evidence revision. |

A configured control can still lack evidence. Passing measurements can still need
human review. The release screen identifies concrete blockers and their owners.

## Freeze the record, then decide

**Ready for review** means the configured prerequisites have been met. Requesting
review freezes the exact record into an immutable snapshot. An explicitly
authorised reviewer can approve or reject that snapshot, including their own
submission if their role permits it. Being an administrator alone is insufficient.

An approval applies to its manifest, deployment context and evidence revision.
Concurrent evidence or policy changes prevent an outdated review from being
approved. CLI `--purpose review` checks readiness; `--purpose deploy` also requires
an applicable approval and no blocking reassessment work. Both are internal
workflow checks, not regulatory certification.

## Keep decisions readable as things change

New evidence, changed criteria, dataset revisions, changed intended use and
blocking findings can require renewed review. Historical approvals and their
snapshots remain intact. Fixing a blocking finding does not silently reactivate an
old approval.

Reusing an evaluation for a new manifest requires an explicit impact assessment.
That assessment is tied to the current policy dependencies; it does not transfer
the old release approval. The new version still needs current control reviews and
a new release decision.

The worker checks for stale or unavailable evidence and creates assigned findings.
Manual incidents and oversight events provide additional operational records.
A dossier exports the frozen record, readable HTML, structured JSON, evidence
files and hashes. Missing or unreviewed areas remain explicit.

## Explore the synthetic examples

Follow the [installation guide](installation.md), then run the separate seed
command. The [CV-filtering AI system example](../examples/cv-filtering/README.md) shows a failing
measurement, correction, human approval and a changed scoring prompt that needs
review. The [exam example](../examples/exam-monitoring/README.md) uses different
events and measurements through the same contracts. Neither requires a model API
key, and neither contains real candidates or students.
