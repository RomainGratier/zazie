import { describe, expect, it } from 'vitest';
import {
  procedureTemplates,
  providerStarterPack,
  workflowPackJsonSchema,
  workflowPackSchema,
} from '../src/index.js';

describe('versioned workflow content', () => {
  it('keeps starter coverage explicitly draft, scoped and incomplete', () => {
    expect(providerStarterPack.status).toBe('draft');
    expect(providerStarterPack.omissions.length).toBeGreaterThan(0);
    expect(
      providerStarterPack.requirements.every(
        (requirement) => requirement.interpretationStatus === 'draft',
      ),
    ).toBe(true);
    expect(
      providerStarterPack.requirements.find(
        (requirement) => requirement.id === 'monitoring-follow-up',
      )?.sources[0]?.verification,
    ).toBe('amendment_review_pending');
    expect(JSON.stringify(workflowPackJsonSchema)).toContain('requirements');
  });

  it('rejects duplicate requirement IDs and unexplained promotion to reviewed', () => {
    expect(
      workflowPackSchema.safeParse({
        ...providerStarterPack,
        requirements: [
          ...providerStarterPack.requirements,
          providerStarterPack.requirements[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      workflowPackSchema.safeParse({
        ...providerStarterPack,
        status: 'reviewed',
      }).success,
    ).toBe(false);
  });

  it('links every procedure to a real requirement without implying adoption', () => {
    const requirements = new Set(
      providerStarterPack.requirements.map((requirement) => requirement.id),
    );
    for (const procedure of procedureTemplates) {
      expect(procedure.status).toBe('draft');
      for (const id of procedure.requirementIds)
        expect(requirements.has(id)).toBe(true);
    }
  });
});
