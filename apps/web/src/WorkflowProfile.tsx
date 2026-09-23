import { ExternalLink, FileText } from 'lucide-react';
import { items, text, type RecordData } from './api';
import { Badge, Section, Status } from './components';

export function WorkflowProfile({
  pack,
  decisions = [],
  onReview,
}: {
  pack: RecordData;
  decisions?: RecordData[];
  onReview?: (requirement: RecordData) => void;
}) {
  const requirements = items(pack.requirements);
  const lines = (value: unknown) =>
    Array.isArray(value)
      ? value.map((entry, index) => <li key={index}>{text(entry)}</li>)
      : null;
  return (
    <Section
      title="Workflow profile and coverage"
      description={`${text(pack.title, 'Draft starter profile')} · version ${text(pack.version)} · sources checked ${text(pack.checkedOn)}`}
    >
      <div className="profile-content">
        <div className="notice">
          <FileText size={19} />
          <div>
            <strong>{text(pack.scope)}</strong>
            <p>{text(pack.interpretationNotice)}</p>
          </div>
        </div>
        <div className="profile-columns">
          <div>
            <h3>What this profile organises</h3>
            <ul>{lines(pack.coverage)}</ul>
          </div>
          <div>
            <h3>Outside this profile’s coverage</h3>
            <ul>{lines(pack.omissions)}</ul>
          </div>
        </div>
        <div className="profile-requirements">
          {requirements.map((requirement) => {
            const decision = decisions
              .filter((entry) => entry.requirementId === requirement.id)
              .at(-1);
            return (
              <details key={text(requirement.id)}>
                <summary>
                  <span>{text(requirement.title)}</span>
                  <div className="inline-badges">
                    <Badge>
                      {decision?.applicability === 'not_applicable'
                        ? 'Not applicable · reviewed'
                        : 'Applicable'}
                    </Badge>
                    <Badge tone="warning">
                      {text(requirement.interpretationStatus, 'draft')}
                    </Badge>
                  </div>
                </summary>
                <p>{text(requirement.interpretation)}</p>
                <h4>Expected evidence</h4>
                <ul>{lines(requirement.evidenceExpected)}</ul>
                <div className="source-list">
                  {items(requirement.sources).map((source, index) => (
                    <div key={index}>
                      <strong>{text(source.provision)}</strong>
                      <Status value={source.verification} />
                      <p>
                        {text(source.textVersion)} · checked{' '}
                        {text(source.checkedOn)}
                      </p>
                      <p>{text(source.note)}</p>
                      {typeof source.url === 'string' &&
                        /^https?:\/\//.test(source.url) && (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            Read official source
                            <ExternalLink size={12} />
                          </a>
                        )}
                    </div>
                  ))}
                </div>
                {decision && (
                  <div className="applicability-note">
                    <h4>Recorded applicability decision</h4>
                    <p>{text(decision.rationale)}</p>
                    <p>
                      Scope: {text(decision.scope)} · Owner:{' '}
                      {text(decision.ownerId)}
                    </p>
                  </div>
                )}
                {onReview && (
                  <button
                    className="button button-secondary button-small"
                    onClick={() => onReview(requirement)}
                  >
                    Review applicability
                  </button>
                )}
              </details>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

export function ProcedureTemplates({
  templates,
  onUse,
}: {
  templates: RecordData[];
  onUse?: (template: RecordData) => void;
}) {
  return (
    <Section
      title="Procedure starting points"
      description="Draft templates help you write a system-specific procedure. Review and adapt every section before adoption."
    >
      <div className="template-grid">
        {templates.map((template) => (
          <article key={text(template.id)}>
            <Badge tone="warning">Draft template</Badge>
            <h3>{text(template.title)}</h3>
            <p>{text(template.purpose)}</p>
            <details>
              <summary>Preview instructions</summary>
              {items(template.sections).map((section, index) => (
                <div key={index}>
                  <h4>{text(section.title)}</h4>
                  <p>{text(section.instructions)}</p>
                </div>
              ))}
            </details>
            {onUse && (
              <button
                className="button button-secondary button-small"
                onClick={() => onUse(template)}
              >
                Adapt this template
              </button>
            )}
          </article>
        ))}
      </div>
    </Section>
  );
}
