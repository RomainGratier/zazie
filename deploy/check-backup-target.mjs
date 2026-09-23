// Read only the resolved Compose configuration. Never print its credentials.
import { readFileSync } from 'node:fs';

try {
  const { services } = JSON.parse(readFileSync(0, 'utf8'));
  for (const name of ['api', 'worker', 'migrate']) {
    const environment = services?.[name]?.environment;
    const database = new URL(environment?.DATABASE_URL);
    if (
      !['postgresql:', 'postgres:'].includes(database.protocol) ||
      database.hostname !== 'postgres' ||
      !['', '5432'].includes(database.port) ||
      database.pathname !== '/zazie' ||
      database.search !== '' ||
      environment.STORAGE_DRIVER !== 'filesystem' ||
      environment.ARTIFACT_ROOT !== '/var/lib/zazie/artifacts'
    ) {
      throw new Error('unsupported_target');
    }
  }
} catch {
  console.error(
    'Backup and restore scripts require the bundled postgres:5432/zazie database and filesystem artifacts. Use the coordinated managed-service recovery procedure for other targets.',
  );
  process.exitCode = 2;
}
