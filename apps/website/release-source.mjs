import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSemanticVersion } from '../../scripts/release-version.mjs';

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(websiteDir, '..', '..');

export const RELEASE_TAG_PREFIX = 'v';
export const GITHUB_REPO = 'clioo/drogon';
export const TAP = 'clioo/drogon';
export const CASK = 'clioo/drogon/drogon';
export const EXPECTED_TAP_COMMAND = `brew tap ${TAP}`;
export const EXPECTED_INSTALL_COMMAND = `brew install --cask ${CASK}`;

export function releaseUrl(tag) {
  return `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;
}

function newestTag(tags) {
  const versions = [];
  for (const tag of tags) {
    if (!tag.startsWith(RELEASE_TAG_PREFIX)) continue;
    try {
      versions.push(validateSemanticVersion(tag.slice(RELEASE_TAG_PREFIX.length)));
    } catch {
      // Not a release tag (e.g. a test fixture tag); ignore it.
    }
  }
  versions.sort((a, b) => (a === b ? 0 : semverLess(a, b) ? -1 : 1));
  return versions.length > 0 ? RELEASE_TAG_PREFIX + versions[versions.length - 1] : null;
}

// Numeric-aware semver ordering: compare major.minor.patch numerically,
// then rank a final release above its prereleases, then order prerelease
// identifiers with numeric parts compared as numbers (rc.9 < rc.10).
function semverLess(a, b) {
  const split = (v) => {
    const hyphen = v.indexOf('-');
    const base = (hyphen === -1 ? v : v.slice(0, hyphen)).split('.').map(Number);
    const pre = hyphen === -1 ? null : v.slice(hyphen + 1).split('.');
    return { base, pre };
  };
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.base[i] !== pb.base[i]) return pa.base[i] < pb.base[i];
  }
  if (pa.pre === null && pb.pre === null) return false;
  if (pa.pre === null) return false;
  if (pb.pre === null) return true;
  const ident = (p) => (/^\d+$/.test(p) ? { n: Number(p) } : { s: p });
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i += 1) {
    if (i >= pa.pre.length) return true;
    if (i >= pb.pre.length) return false;
    const x = ident(pa.pre[i]);
    const y = ident(pb.pre[i]);
    if (x.n !== undefined && y.n !== undefined) {
      if (x.n !== y.n) return x.n < y.n;
    } else if (x.n !== undefined) {
      return true;
    } else if (y.n !== undefined) {
      return false;
    } else if (x.s !== y.s) {
      return x.s < y.s;
    }
  }
  return false;
}

function listLocalTags(repoDir) {
  return new Promise((resolve) => {
    execFile('git', ['tag', '--list', `${RELEASE_TAG_PREFIX}*`], { cwd: repoDir }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(String(stdout).split('\n').map((t) => t.trim()).filter(Boolean));
    });
  });
}

async function readManifestVersion() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  return validateSemanticVersion(manifest.version);
}

/**
 * The repo's release truth: the newest downloadable Drogon release.
 *
 * Resolution order keeps the committed page honest without network access:
 * an explicit override (the offline CI fixture `DROGON_RELEASE_VERSION`),
 * then the newest local `v*` tag (what was actually cut), then the
 * `package.json` version the release process bumps before tagging.
 */
export async function resolveReleaseTruth({ version = null, repoDir = repoRoot } = {}) {
  const override = version ?? process.env.DROGON_RELEASE_VERSION ?? null;
  if (override !== null) {
    const clean = validateSemanticVersion(override);
    return { version: clean, tag: RELEASE_TAG_PREFIX + clean, source: 'override' };
  }
  const tag = newestTag(await listLocalTags(repoDir));
  if (tag !== null) {
    return {
      version: validateSemanticVersion(tag.slice(RELEASE_TAG_PREFIX.length)),
      tag,
      source: 'git-tag',
    };
  }
  const manifestVersion = await readManifestVersion();
  return { version: manifestVersion, tag: RELEASE_TAG_PREFIX + manifestVersion, source: 'package.json' };
}

export async function readPage() {
  return readFile(path.join(websiteDir, 'dist', 'index.html'), 'utf8');
}
