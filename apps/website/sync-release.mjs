import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPage, releaseUrl, resolveReleaseTruth } from './release-source.mjs';

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(websiteDir, 'dist', 'index.html');

const VERSION_SPAN = /<span id="release-version">v[^<]*<\/span>/;
const RELEASE_HREF = /https:\/\/github\.com\/clioo\/drogon\/releases\/tag\/v[^"]*/g;

/**
 * Stamps the committed landing page from the repo's release truth so the
 * advertised version and every release link move together. Run after cutting
 * a release (or with --version to pin one), then deploy `dist/`:
 *
 *   node apps/website/sync-release.mjs [--version 0.1.0-rc.4]
 */
export async function syncReleasePage({ version = null } = {}) {
  const truth = await resolveReleaseTruth({ version });
  const before = await readPage();
  const versionSpan = `<span id="release-version">v${truth.version}</span>`;
  if (!VERSION_SPAN.test(before)) {
    throw new Error('dist/index.html has no #release-version span to stamp');
  }
  const matches = before.match(RELEASE_HREF) ?? [];
  if (matches.length === 0) {
    throw new Error('dist/index.html has no release links to stamp');
  }
  const after = before.replace(VERSION_SPAN, versionSpan).replace(RELEASE_HREF, releaseUrl(truth.tag));
  await writeFile(pagePath, after);
  return { ...truth, spans: 1, links: matches.length };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--version');
  const version = flag === -1 ? null : process.argv[flag + 1] ?? null;
  if (flag !== -1 && !version) throw new Error('Usage: sync-release.mjs [--version 0.1.0-rc.4]');
  console.log(JSON.stringify(await syncReleasePage({ version })));
}
