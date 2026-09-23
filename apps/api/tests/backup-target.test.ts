import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../../deploy/check-backup-target.mjs', import.meta.url),
);
function check(overrides: Record<string, string> = {}) {
  const services = Object.fromEntries(
    ['api', 'worker', 'migrate'].map((name) => [
      name,
      {
        environment: {
          DATABASE_URL:
            overrides[name] ?? 'postgresql://test:secret@postgres:5432/zazie',
          STORAGE_DRIVER: 'filesystem',
          ARTIFACT_ROOT: '/var/lib/zazie/artifacts',
        },
      },
    ]),
  );
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ services }),
    encoding: 'utf8',
  });
}
describe('bundled backup and restore target guard', () => {
  it('accepts the bundled database used by all writers and migrations', () => {
    expect(check().status).toBe(0);
  });
  it.each(['api', 'worker', 'migrate'])(
    'refuses an external %s connection without exposing its credentials',
    (service) => {
      const result = check({
        [service]:
          'postgresql://private-user:private-secret@managed.example.test/zazie',
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('bundled');
      expect(result.stderr).not.toContain('private-secret');
      expect(result.stderr).not.toContain('managed.example.test');
    },
  );
  it('refuses connection parameters that override the parsed target', () => {
    expect(
      check({
        api: 'postgresql://test@postgres/zazie?host=managed.example.test',
      }).status,
    ).toBe(2);
  });
});
