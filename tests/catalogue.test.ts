import { describe, expect, it } from 'vitest';
import draftPack from '../src/catalogue/0.1.0-draft.1.json' with { type: 'json' };
import { hypothesisPack } from '../src/catalogue/index.js';
import { HypothesisPackSchema, HypothesisSchema } from '../src/contracts.js';

const expectedIds = [
  'purpose-expansion',
  'unsupported-assertion',
  'source-contradiction',
  'missing-required-information',
  'explicit-unequal-treatment',
  'unrelated-sensitive-disclosure',
  'embedded-instructions',
  'safeguard-bypass',
  'unsupported-certainty',
  'rule-conflict',
  'urgency-omission',
  'conflicting-source-records',
];

function firstDefinition() {
  const first = draftPack.hypotheses[0];
  if (first === undefined) throw new Error('The fixed catalogue is empty.');
  return structuredClone(first);
}

describe('versioned research catalogue', () => {
  it('loads exactly the release definitions with stable, ordered IDs', () => {
    expect(hypothesisPack).toEqual(HypothesisPackSchema.parse(draftPack));
    expect(hypothesisPack.version).toBe('0.1.0-draft.1');
    expect(hypothesisPack.status).toBe('draft-research');
    expect(hypothesisPack.sourceCheckedOn).toBe('2026-09-21');
    expect(hypothesisPack.hypotheses.map(({ id }) => id)).toEqual(expectedIds);
  });

  it('requires a question, applicability, evidence, boundaries, and research sources for every definition', () => {
    for (const hypothesis of hypothesisPack.hypotheses) {
      expect(HypothesisSchema.parse(hypothesis)).toEqual(hypothesis);
      expect(hypothesis.question.endsWith('?')).toBe(true);
      for (const text of [
        hypothesis.title,
        hypothesis.question,
        hypothesis.applicability,
        ...hypothesis.evidenceRequirements,
        ...hypothesis.counterexamples,
        ...hypothesis.limitations,
      ]) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
      for (const mapping of hypothesis.sourceMappings) {
        expect(mapping.relationship).toBe('research-mapping');
        const url = new URL(mapping.url);
        expect(url.protocol).toBe('https:');
        expect(url.hostname).toBe('ai-act-service-desk.ec.europa.eu');
        expect(mapping.article.trim().length).toBeGreaterThan(0);
        expect(mapping.note.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects duplicate hypothesis IDs before an ambiguous pack can be used', () => {
    const pack = structuredClone(draftPack);
    pack.hypotheses.push(firstDefinition());
    const result = HypothesisPackSchema.safeParse(pack);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(({ message }) => message.includes('unique')),
      ).toBe(true);
    }
  });

  it.each([
    'id',
    'title',
    'question',
    'applicability',
    'evidenceRequirements',
    'counterexamples',
    'limitations',
    'sourceMappings',
  ])('rejects a missing %s instead of silently supplying defaults', (field) => {
    const incomplete: Record<string, unknown> = { ...firstDefinition() };
    delete incomplete[field];
    expect(HypothesisSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each([
    { id: 'Invalid ID' },
    { question: '' },
    { applicability: '' },
    { evidenceRequirements: [] },
    { evidenceRequirements: [''] },
    { counterexamples: [] },
    { limitations: [] },
    { sourceMappings: [] },
    {
      sourceMappings: [
        {
          article: '9',
          url: 'not-a-url',
          relationship: 'research-mapping',
          note: 'Draft mapping.',
        },
      ],
    },
    {
      sourceMappings: [
        {
          article: '9',
          url: 'https://example.com',
          relationship: 'proves-compliance',
          note: 'Unreviewed assertion.',
        },
      ],
    },
  ])('rejects an incomplete or malformed definition %#', (overrides) => {
    expect(
      HypothesisSchema.safeParse({ ...firstDefinition(), ...overrides })
        .success,
    ).toBe(false);
  });

  it.each([
    { hypotheses: [] },
    { version: '' },
    { sourceCheckedOn: '2026-02-30' },
    { status: 'validated' },
    { accuracy: 0.99 },
    { precision: 0.99 },
    { complianceScore: 100 },
  ])(
    'rejects invalid provenance and unsupported measured-performance claims %#',
    (overrides) => {
      expect(
        HypothesisPackSchema.safeParse({ ...draftPack, ...overrides }).success,
      ).toBe(false);
    },
  );

  it('rejects per-hypothesis tuning and invented legal-verdict fields', () => {
    for (const extra of [
      { threshold: 0.9 },
      { precision: 0.99 },
      { legalVerdict: 'compliant' },
    ]) {
      expect(
        HypothesisSchema.safeParse({ ...firstDefinition(), ...extra }).success,
      ).toBe(false);
    }
  });

  it('freezes every nested object and prevents accidental cross-evaluation mutation', () => {
    const before = JSON.stringify(hypothesisPack);
    function assertFrozen(value: unknown): void {
      if (value === null || typeof value !== 'object') return;
      expect(Object.isFrozen(value)).toBe(true);
      expect(Reflect.set(value, '__catalogueMutationProbe', true)).toBe(false);
      for (const child of Object.values(value)) assertFrozen(child);
    }
    assertFrozen(hypothesisPack);

    const first = hypothesisPack.hypotheses[0];
    if (first === undefined) throw new Error('The fixed catalogue is empty.');
    expect(Reflect.set(first, 'question', 'Changed after publication?')).toBe(
      false,
    );
    expect(() =>
      first.evidenceRequirements.push('Injected requirement'),
    ).toThrow(TypeError);
    const mapping = first.sourceMappings[0];
    if (mapping === undefined)
      throw new Error('The first hypothesis has no mapping.');
    expect(Reflect.set(mapping, 'note', 'Invented validation')).toBe(false);
    expect(JSON.stringify(hypothesisPack)).toBe(before);
  });

  it('parsing a separate copy does not expose mutable references into the exported pack', () => {
    const copy = HypothesisPackSchema.parse(hypothesisPack);
    const first = copy.hypotheses[0];
    if (first === undefined) throw new Error('The fixed catalogue is empty.');
    first.question = 'A different question?';
    first.counterexamples.push('A different boundary case.');
    expect(hypothesisPack).toEqual(draftPack);
  });
});
