// Run inside the built application image with its normal database/storage environment.
import {
  createDatabase,
  digest,
  rows,
  sql,
} from '../packages/database/dist/index.js';
import { loadConfig, storageFromConfig } from '../apps/api/dist/config.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const storage = storageFromConfig(config);
try {
  const records = await rows(
    database.db,
    sql`
    SELECT id,organization_id,system_id,kind,data FROM records
    WHERE kind IN ('artifacts','dossiers','release-reviews','decisions') ORDER BY id
  `,
  );
  const reviews = new Map(
    records
      .filter((record) => record.kind === 'release-reviews')
      .map((record) => [record.id, record]),
  );
  const proof = [];
  let files = 0;
  let snapshots = 0;
  let decisions = 0;
  for (const record of records) {
    const { id, kind, data } = record;
    if (
      kind === 'artifacts' ||
      (kind === 'dossiers' && data.status === 'completed')
    ) {
      if (
        typeof data.storageKey !== 'string' ||
        typeof data.sha256 !== 'string'
      )
        throw new Error(`Missing artifact metadata: ${id}`);
      await storage.get(data.storageKey, { expectedSha256: data.sha256 });
      files += 1;
      proof.push({ id, kind, sha256: data.sha256 });
    }
    if (kind === 'release-reviews') {
      if (digest(data.snapshot) !== data.snapshotDigest)
        throw new Error(`Snapshot digest mismatch: ${id}`);
      snapshots += 1;
      proof.push({ id, kind, sha256: data.snapshotDigest });
    }
    if (kind === 'decisions') {
      const review = reviews.get(data.reviewId);
      if (
        !review ||
        review.organization_id !== record.organization_id ||
        review.system_id !== record.system_id ||
        review.data.snapshotDigest !== data.snapshotDigest ||
        review.data.versionId !== data.versionId ||
        review.data.deploymentId !== data.deploymentId
      ) {
        throw new Error(`Decision snapshot binding mismatch: ${id}`);
      }
      decisions += 1;
    }
  }
  console.log(JSON.stringify({ files, snapshots, decisions, proof }, null, 2));
} finally {
  await database.close();
}
