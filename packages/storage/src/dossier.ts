import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  sha256,
  StorageError,
  validateMaxBytes,
  type ArtifactStore,
} from './types.js';

export interface DossierSection {
  id: string;
  title: string;
  status: 'provided' | 'missing' | 'unreviewed';
  content?: unknown;
  note?: string;
}

export interface DossierEvidence {
  id: string;
  key: string;
  sha256: string;
  name: string;
}

export interface DossierInput {
  id: string;
  createdAt: string;
  snapshot: unknown;
  sections: DossierSection[];
  evidence: DossierEvidence[];
  store: ArtifactStore;
  maxTotalBytes?: number;
}

export interface DossierManifest {
  schemaVersion: '1';
  dossierId: string;
  createdAt: string;
  snapshotSha256: string;
  files: { path: string; sha256: string; size: number }[];
  evidence: {
    id: string;
    name: string;
    path: string | null;
    sha256: string;
    status: 'included' | 'unavailable' | 'integrity_failure';
  }[];
  omissions: string[];
}

/** Stable serialization for exported JSON. Domain snapshot hashing has its own contract. */
export function canonicalJson(value: unknown): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === 'object') {
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      ) {
        throw new TypeError('Dossier data must contain JSON values only.');
      }
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, sorted(entry)]),
      );
    }
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean' ||
      (typeof input === 'number' && Number.isFinite(input))
    )
      return input;
    throw new TypeError('Dossier data must contain JSON values only.');
  }
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

/** Fixed ZIP metadata and stable file ordering make retries byte-identical. */
export async function createDossierArchive(input: DossierInput): Promise<{
  bytes: Uint8Array;
  sha256: string;
  manifest: DossierManifest;
}> {
  const maxBytes = validateMaxBytes(input.maxTotalBytes ?? 128 * 1024 * 1024);
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  function add(path: string, bytes: Uint8Array): void {
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes)
      throw new StorageError(
        'too_large',
        'Dossier exceeds the configured size limit.',
      );
    files.set(path, bytes);
  }
  const snapshotBytes = strToU8(canonicalJson(input.snapshot));
  add('snapshot.json', snapshotBytes);
  add('sections.json', strToU8(canonicalJson(input.sections)));
  const manifest: DossierManifest = {
    schemaVersion: '1',
    dossierId: input.id,
    createdAt: input.createdAt,
    snapshotSha256: sha256(snapshotBytes),
    files: [],
    evidence: [],
    omissions: input.sections
      .filter((section) => section.status !== 'provided')
      .map(
        (section) =>
          `${section.title}: ${section.status}${section.note ? ` — ${section.note}` : ''}`,
      ),
  };
  const evidence = [...input.evidence].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (new Set(evidence.map((entry) => entry.id)).size !== evidence.length)
    throw new TypeError('Dossier evidence IDs must be unique.');
  for (const [index, entry] of evidence.entries()) {
    // The submitted name is metadata only, never an archive path or executable extension.
    const path = `evidence/${String(index + 1).padStart(5, '0')}.bin`;
    try {
      const bytes = await input.store.get(entry.key, {
        expectedSha256: entry.sha256,
      });
      add(path, bytes);
      manifest.evidence.push({
        id: entry.id,
        name: entry.name,
        path,
        sha256: entry.sha256,
        status: 'included',
      });
    } catch (error) {
      if (
        !(error instanceof StorageError) ||
        (error.code !== 'not_found' && error.code !== 'integrity')
      )
        throw error;
      const status =
        error.code === 'not_found' ? 'unavailable' : 'integrity_failure';
      manifest.evidence.push({
        id: entry.id,
        name: entry.name,
        path: null,
        sha256: entry.sha256,
        status,
      });
      manifest.omissions.push(`Evidence ${entry.id}: ${status}`);
    }
  }
  const sectionsHtml = input.sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.title)}</h2><p>Status: <strong>${escapeHtml(section.status)}</strong></p>${section.note ? `<p>${escapeHtml(section.note)}</p>` : ''}${section.content !== undefined ? `<pre>${escapeHtml(canonicalJson(section.content))}</pre>` : ''}</section>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Zazie dossier ${escapeHtml(input.id)}</title><style>body{font:16px system-ui;max-width:1000px;margin:3rem auto;padding:0 1.5rem;line-height:1.6;color:#18232b}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem;background:#f1f5f7}section{margin:2rem 0;border-top:1px solid #ccd5da}li{margin:.4rem 0}</style></head>
<body><h1>Zazie evidence dossier</h1><p>Dossier ${escapeHtml(input.id)} · ${escapeHtml(input.createdAt)}</p><p>This archive records supplied evidence and internal decisions. It is not a certificate of legal compliance. Imported evaluation execution is not independently verified by Zazie.</p><h2>Missing or unreviewed material</h2>${manifest.omissions.length ? `<ul>${manifest.omissions.map((omission) => `<li>${escapeHtml(omission)}</li>`).join('')}</ul>` : '<p>No omissions were recorded for the selected sections. Other obligations may be outside this dossier.</p>'}${sectionsHtml}<section><h2>Evidence index</h2><pre>${escapeHtml(canonicalJson(manifest.evidence))}</pre></section><section><h2>Exact recorded snapshot</h2><pre>${escapeHtml(canonicalJson(input.snapshot))}</pre></section><p>The hash manifest covers every payload file. Verify against the archive hash recorded by your installation; hashes alone do not prove who created the evidence.</p></body></html>\n`;
  add('dossier.html', strToU8(html));
  manifest.files = [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, bytes]) => ({
      path,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    }));
  add('manifest.json', strToU8(canonicalJson(manifest)));
  const archive: Zippable = Object.create(null) as Zippable;
  for (const [path, bytes] of [...files.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    archive[path] = [bytes, { mtime: new Date(1980, 0, 1), level: 6 }];
  }
  const bytes = zipSync(archive);
  if (bytes.byteLength > maxBytes)
    throw new StorageError(
      'too_large',
      'Dossier exceeds the configured size limit.',
    );
  return { bytes, sha256: sha256(bytes), manifest };
}
