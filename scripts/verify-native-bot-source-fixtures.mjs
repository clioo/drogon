import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { snapshotTransportPackage } from './transport-capsule-runtime.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// Local verification requires the retained, previously admitted source capsule.
export function verifyNativeBotSourceFixtures() {
  const stage = path.join(repoRoot, '.preflight/parity-baseline/wp-cap-bots-schemas-otoIL4');
  const manifestFile = path.join(repoRoot, 'tests/parity/ports/WP-CAP-BOTS/source-baselines/schemas/bot-schemas.source-baseline.json');
  assert.equal(sha(manifestFile), 'fac50877e931e7db2f807ec708167b3ad4417303e589f2569fd2dd06ec0ba5cd');
  const manifest = JSON.parse(readFileSync(manifestFile));
  for (const entry of [...manifest.files, manifest.license]) {
    assert.equal(sha(path.join(stage, entry.path)), entry.sha256, entry.path);
  }
  const stagedRequire = createRequire(path.join(stage, 'package.json'));
  const zodFile = stagedRequire.resolve('zod/package.json');
  assert.equal(stagedRequire('zod/package.json').version, manifest.transportRuntime.zod.version);
  const zodTree = snapshotTransportPackage(path.dirname(zodFile));
  assert.equal(zodTree.treeSha256, manifest.transportRuntime.zod.treeSha256);
  const sourceRequire = createRequire('/Users/carlos/Documents/Drogon-mentu-session/package.json');
  const esbuild = sourceRequire('esbuild');
  const allowed = new Set(manifest.files.map((entry) => path.resolve(stage, entry.path)));
  const loadSource = (file) => {
    const bundle = esbuild.buildSync({
      entryPoints: [path.join(stage, file)], bundle: true, write: false,
      platform: 'node', format: 'cjs', packages: 'external', metafile: true,
      logLevel: 'silent',
    });
    for (const input of Object.keys(bundle.metafile.inputs)) assert(allowed.has(path.resolve(input)), input);
    for (const output of Object.values(bundle.metafile.outputs)) {
      for (const dependency of output.imports) assert.equal(dependency.path, 'zod');
    }
    const module = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(stagedRequire, module, module.exports);
    return module.exports;
  };
  const parsers = loadSource('src/main/ipc/bot-schemas.ts');
  const parserNames = new Map(Object.entries({
    botCreate: 'parseBotCreate', botUpdate: 'parseBotUpdate', botSession: 'parseBotSession',
    responsibilityCreate: 'parseResponsibilityCreate', botId: 'parseBotId',
  }));
  const fixtureFile = path.join(repoRoot, 'tests/parity/ports/WP-CAP-BOTS/native-input/fixtures/expected.json');
  const { fixtures } = JSON.parse(readFileSync(fixtureFile));
  assert(Array.isArray(fixtures) && fixtures.length >= 144 && fixtures.length <= 1000);
  const ids = new Set();
  let accepted = 0;
  let rejected = 0;
  for (const fixture of fixtures) {
    assert(!ids.has(fixture.id), 'Duplicate fixture ID');
    ids.add(fixture.id);
    assert(parserNames.has(fixture.parser), 'Unknown fixture parser');
    let output;
    let rejectedBySource = false;
    try { output = parsers[parserNames.get(fixture.parser)](fixture.input); }
    catch { rejectedBySource = true; }
    if (fixture.expect === 'accept') {
      assert(!rejectedBySource, fixture.id);
      assert.deepEqual(JSON.parse(JSON.stringify(output)), fixture.output, fixture.id);
      accepted++;
    } else {
      assert.equal(fixture.expect, 'reject', fixture.id);
      assert(rejectedBySource, fixture.id);
      rejected++;
    }
  }
  assert(accepted > 0 && rejected > 0);
  const actualIds = Object.keys(loadSource('src/shared/tui-agent-config.ts').TUI_AGENT_CONFIG).sort();
  const nativeSource = readFileSync(path.join(repoRoot, 'crates/drogon-harness/src/known_tui_agents.rs'), 'utf8');
  const table = nativeSource.split('pub const KNOWN_TUI_AGENT_IDS: &[&str] = &[')[1]?.split('];')[0];
  assert(table, 'Missing native recognition catalog');
  assert.deepEqual([...table.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort(), actualIds);
  return {
    sourceFixturesMatched: fixtures.length, accepted, rejected,
    fixtureSha256: sha(fixtureFile), sourceRevision: manifest.sourceRevision,
    sourceFilesVerified: manifest.files.length + 1, zodTreeSha256: zodTree.treeSha256,
    actualSourceCatalogIds: actualIds.length, writes: false, nativeTestExecution: false,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert.equal(process.argv.length, 2, 'No arguments accepted; verifies the retained local capsule only.');
  console.log(JSON.stringify(verifyNativeBotSourceFixtures()));
}
