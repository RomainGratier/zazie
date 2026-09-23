import { z } from 'zod';

const graceDays = z.number().int().min(0).max(3650);
const protectedClass = z.strictObject({ mode: z.literal('retain') });

/** Deployment-selected technical cleanup policy, not a statement of statutory periods. */
export const RetentionPolicySchema = z.strictObject({
  schemaVersion: z.literal('1'),
  expiredSessions: z.strictObject({ graceDays }),
  inactiveIntegrationCredentials: z.strictObject({ graceDays }),
  evidence: protectedClass,
  reviewSnapshots: protectedClass,
  auditHistory: protectedClass,
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  schemaVersion: '1',
  expiredSessions: { graceDays: 0 },
  inactiveIntegrationCredentials: { graceDays: 0 },
  evidence: { mode: 'retain' },
  reviewSnapshots: { mode: 'retain' },
  auditHistory: { mode: 'retain' },
};

/** Invalid stored policy fails closed; it must never silently shorten retention. */
export function retentionPolicyFromSettings(
  settings: unknown,
): RetentionPolicy {
  const parsed = z.record(z.string(), z.unknown()).parse(settings);
  return RetentionPolicySchema.parse(
    parsed.retentionPolicy === undefined
      ? DEFAULT_RETENTION_POLICY
      : parsed.retentionPolicy,
  );
}
