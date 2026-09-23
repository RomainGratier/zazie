import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION_POLICY,
  RetentionPolicySchema,
  retentionPolicyFromSettings,
} from '../src/retention.js';

describe('deployment retention policy', () => {
  it('defaults to technical transient cleanup and protected evidence retention', () => {
    expect(retentionPolicyFromSettings({})).toEqual(DEFAULT_RETENTION_POLICY);
  });

  it('rejects deletion modes for protected classes and unbounded grace periods', () => {
    for (const field of ['evidence', 'reviewSnapshots', 'auditHistory'])
      expect(
        RetentionPolicySchema.safeParse({
          ...DEFAULT_RETENTION_POLICY,
          [field]: { mode: 'delete', graceDays: 1 },
        }).success,
      ).toBe(false);
    for (const graceDays of [-1, 0.5, 3651])
      expect(
        RetentionPolicySchema.safeParse({
          ...DEFAULT_RETENTION_POLICY,
          expiredSessions: { graceDays },
        }).success,
      ).toBe(false);
  });

  it('fails closed on malformed stored policy', () => {
    expect(() =>
      retentionPolicyFromSettings({ retentionPolicy: null }),
    ).toThrow();
    expect(() =>
      retentionPolicyFromSettings({ retentionPolicy: { schemaVersion: '2' } }),
    ).toThrow();
  });
});
