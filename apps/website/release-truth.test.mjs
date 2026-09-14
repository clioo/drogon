import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  EXPECTED_INSTALL_COMMAND,
  EXPECTED_TAP_COMMAND,
  EXPECTED_TRUST_COMMAND,
  readPage,
  releaseUrl,
  resolveReleaseTruth,
} from './release-source.mjs';

// Offline by default: the expected release comes from DROGON_RELEASE_VERSION,
// the local v* tags, or package.json — never the network. A human can compare
// the committed page against the live GitHub release with:
//   DROGON_WEBSITE_LIVE_CHECK=1 node --test apps/website/release-truth.test.mjs
const truth = await resolveReleaseTruth();
const html = await readPage();

function liveLatestTag() {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['release', 'list', '--repo', 'clioo/drogon', '--limit', '1', '--json', 'tagName', '--jq', '.[0].tagName'],
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`gh release list failed: ${stderr || error.message}`));
        resolve(String(stdout).trim());
      },
    );
  });
}

test('the page advertises the repo release version', () => {
  assert.match(html, new RegExp(`<span id="release-version">v${truth.version}</span>`));
});

test('every release link points at the repo release tag', () => {
  const hrefs = [...html.matchAll(/href="(https:\/\/github\.com\/clioo\/drogon\/releases\/tag\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(hrefs.length > 0, 'the page links to at least one release');
  assert.deepEqual([...new Set(hrefs)], [releaseUrl(truth.tag)]);
});

test('the Homebrew commands match the public install path', () => {
  const command = html.match(/<code id="install-command">([^<]+)<\/code>/)?.[1].replace(/&amp;/g, '&');
  assert.ok(command, 'the page shows an install command');
  assert.deepEqual(command.trim().split('\n'), [
    EXPECTED_TRUST_COMMAND,
    EXPECTED_TAP_COMMAND,
    EXPECTED_INSTALL_COMMAND,
  ]);
});

test('the requirements line names Apple Silicon and macOS 14+', () => {
  assert.match(html, /Apple Silicon/);
  assert.match(html, /macOS (Sonoma \(14\)|14\+)/);
});

test('the signing caveat matches the shipped release truth', () => {
  assert.doesNotMatch(html, /Ad-hoc signed and not notarized/);
  assert.match(html, /Developer ID signed and notarized/);
});

test('the live GitHub release agrees with the page', { skip: !process.env.DROGON_WEBSITE_LIVE_CHECK }, async () => {
  const latest = await liveLatestTag();
  assert.equal(latest, truth.tag);
  assert.ok(html.includes(releaseUrl(latest)));
});
