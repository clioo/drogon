import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Reuses the admitted local capsule; no source execution directory or file writes.
export function providerSourceBoundaryCases() {
  const manifestPath = path.join(root, 'tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/agent-session-provider-handle-transition.manifest.json');
  const manifestBytes = readFileSync(manifestPath);
  assert.equal(digest(manifestBytes), 'f38718fcc8f000a67eafc8166d96141d6a9a6a6ba052370714b1df4e89e32eda');
  const manifest = JSON.parse(manifestBytes);
  const stage = path.join(root, '.preflight/parity-baseline/eng-identity-provider-20260906-a1-p6nXh6');
  for (const entry of [...manifest.files, manifest.license]) {
    assert.equal(digest(readFileSync(path.join(stage, entry.path))), entry.sha256, entry.path);
  }
  const require = createRequire('/Users/carlos/Documents/Drogon-mentu-session/package.json');
  const esbuild = require('esbuild');
  const allowed = new Set(manifest.files.map((entry) => path.resolve(stage, entry.path)));
  const load = (entry) => {
    const bundle = esbuild.buildSync({
      entryPoints: [path.join(stage, entry)], bundle: true, write: false,
      platform: 'node', format: 'cjs', packages: 'external', metafile: true,
      logLevel: 'silent',
    });
    for (const input of Object.keys(bundle.metafile.inputs)) assert(allowed.has(path.resolve(input)), input);
    for (const output of Object.values(bundle.metafile.outputs)) assert.equal(output.imports.length, 0);
    const module = { exports: {} };
    new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
    return module.exports;
  };
  const recordSource = load('src/shared/agent-session-record.ts');
  const handleSource = load('src/shared/agent-session-provider-handle.ts');
  const { agentSessionRecordFixture } = load('src/shared/agent-session-record.test-fixture.ts');
  const validators = {
    record: recordSource.isAgentSessionRecord,
    process: recordSource.isAgentSessionProcessIdentity,
    handle: handleSource.isAgentSessionProviderHandle,
    link: handleSource.isAgentSessionProviderHandleLink,
  };
  const cases = [];
  const add = (id, target, rawJson) => {
    assert(!cases.some((item) => item.id === id), id);
    const accepted = validators[target](JSON.parse(rawJson));
    assert.equal(typeof accepted, 'boolean');
    cases.push({ id, target, rawJson, accepted });
  };
  const set = (value, keys, replacement) => {
    let parent = value;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    parent[keys.at(-1)] = replacement;
  };
  const rawNumber = (value, keys, token) => {
    const copy = structuredClone(value);
    set(copy, keys, '__DROGON_RAW_NUMBER__');
    return JSON.stringify(copy).replace('"__DROGON_RAW_NUMBER__"', token);
  };
  const sample = agentSessionRecordFixture();
  sample.lease.processlessAt = null;
  sample.lease.journalCheckpoint = { epoch: 1, sequence: 2 };
  sample.lease.deathEvidence = { kind: 'exit-observed', detail: 'fixture-only', observedAt: 1 };
  assert(validators.record(sample));
  const numberTokens = ['0', '-0', '1', '1.0', '1e0', '2.0', '7.0', '7e0', '0.5', '-1', '9007199254740991', '9007199254740992', '-9223372036854775808'];
  const numberFields = [
    ['schemaVersion'], ['createdAt'], ['updatedAt'], ['lease', 'runtimeFence'],
    ['lease', 'leaseDeadlineAt'], ['lease', 'lastRenewedAt'], ['lease', 'processlessAt'],
    ['lease', 'journalCheckpoint', 'epoch'], ['lease', 'journalCheckpoint', 'sequence'],
    ['lease', 'deathEvidence', 'observedAt'], ['lease', 'ownerProcess', 'pid'],
    ['lease', 'ownerProcess', 'processStartTimeMs'],
    ['providerHandleChain', 0, 'mintedAtFence'], ['providerHandleChain', 0, 'observedAt'],
  ];
  for (const keys of numberFields) {
    for (const token of numberTokens) add(`record:${keys.join('.')}:${token}`, 'record', rawNumber(sample, keys, token));
  }
  for (const key of ['pid', 'processStartTimeMs']) {
    for (const token of numberTokens) add(`process:${key}:${token}`, 'process', rawNumber(sample.lease.ownerProcess, [key], token));
  }
  for (const key of ['mintedAtFence', 'observedAt']) {
    for (const token of numberTokens) add(`link:${key}:${token}`, 'link', rawNumber(sample.providerHandleChain[0], [key], token));
  }
  for (const [name, text] of [
    ['leading-NEL', '\u0085x'], ['trailing-NEL', 'x\u0085'],
    ['leading-BOM', '\uFEFFx'], ['trailing-BOM', 'x\uFEFF'],
    ['leading-MVS', '\u180Ex'], ['leading-zero-width', '\u200Bx'],
    ['astral-512-units', '😀'.repeat(256)], ['astral-514-units', '😀'.repeat(257)],
  ]) {
    add(`handle:codex:${name}`, 'handle', JSON.stringify({ provider: 'codex', threadId: text }));
    add(`handle:claude:${name}`, 'handle', JSON.stringify({ provider: 'claude', sessionId: text, leafUuid: null }));
  }
  for (const value of [null, 0.5, -1, 'future-fence', { future: true }, []]) {
    const record = structuredClone(sample);
    record.lease.minimumNextFence = value;
    add(`record:unvalidated-minimumNextFence:${JSON.stringify(value)}`, 'record', JSON.stringify(record));
  }
  for (const key of ['processlessAt', 'settlementRetryRequired', 'settlementRetryId', 'ownerProcess', 'handoffStage']) {
    for (const mode of ['missing', 'null']) {
      const record = structuredClone(sample);
      if (mode === 'missing') delete record.lease[key];
      else record.lease[key] = null;
      add(`record:lease.${key}:${mode}`, 'record', JSON.stringify(record));
    }
  }
  assert.equal(cases.length, 266);
  return {
    sourceRevision: manifest.sourceRevision,
    sourceFilesVerified: manifest.files.length + 1,
    nodeVersion: process.version,
    esbuildVersion: esbuild.version,
    cases,
    casesSha256: digest(JSON.stringify(cases)),
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--fixtures'));
  const data = providerSourceBoundaryCases();
  if (process.argv[2] === '--fixtures') console.log(JSON.stringify(data));
  else {
    const { cases, ...metadata } = data;
    console.log(JSON.stringify({ ...metadata, sourceCases: cases.length,
      accepted: cases.filter((item) => item.accepted).length,
      rejected: cases.filter((item) => !item.accepted).length,
      writes: false, nativeTestExecution: false }));
  }
}
