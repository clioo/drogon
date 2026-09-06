"""Build the E4 review receipt from static audit artifacts, without source execution."""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path('/Users/carlos/Documents/Drogon-rewrite')
SOURCE = Path('/Users/carlos/Documents/Drogon-mentu-session')
OUT = ROOT / 'docs/migration/audit-closure/e4-cli'
SHA = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')


mapping = json.loads((OUT / 'command-map.json').read_text())
tests = json.loads((OUT / 'source-tests.json').read_text())
catalog = json.loads((ROOT / 'docs/migration/parity-source-contracts.json').read_text())
rows = mapping['commands']
nodes = {n['id']: n for n in mapping['semanticNodes']}
canonical = [' '.join(s['path']) for s in catalog['cli']['specs']]
assert mapping['sourceRevision'] == SHA
assert [r['command'] for r in rows] == canonical
assert len(canonical) == len(set(canonical)) == 234
assert sum(bool(r['acceptedContract']) for r in rows) == 30
assert sum(len(r['aliases']) for r in rows) == 8
assert sum(r['hidden'] for r in rows) == 1
assert len(tests['tests']) == 150
for record in mapping['sourceFiles'] + mapping['boundarySources']:
    assert digest(SOURCE / record['file']) == record['sha256'], record['file']
for record in tests['tests']:
    assert digest(SOURCE / record['path']) == record['sha256'], record['path']
for row in rows:
    assert row['semanticNode'] in nodes
    assert all(node in nodes for node in row['observableContract']['helperNodes'])
    assert len(row['allowedFlags']) == len(row['flagRouting'])
assert (OUT / 'source-LICENSE').read_bytes() == (SOURCE / 'LICENSE').read_bytes()

evidence_paths = [
    'docs/migration/parity-source-contracts.json',
    'docs/migration/parity-cli-argument-contract.json',
    'docs/migration/parity-cli-skills-contracts.json',
    'docs/migration/parity-cli-terminal-contracts.json',
    'docs/migration/parity-cli-workspace-contracts.json',
    'docs/migration/parity-cli-audit.md',
    'docs/migration/parity-source-tests.json',
    'docs/migration/parity-audit-gate-ledger.json',
    'docs/migration/audit-progress.md',
    'docs/migration/audit-closure-coordination.md',
]
evidence = [dict(repository='rewrite', path=p, line=1, sha256=digest(ROOT / p)) for p in evidence_paths]
for record in mapping['sourceFiles']:
    evidence.append(dict(repository='pinned-source', path=record['file'], line=1, sha256=record['sha256']))


def commands(*groups):
    return [r['command'] for r in rows if r['group'] in groups]


def source_refs(paths):
    return [dict(path=p, line=1, sha256=digest(SOURCE / p)) for p in paths]


open_obligations = [
    dict(id='E4-S1', kind='source-contract-normalization',
         obligation='Finish scope-aware, per-command required/optional/default/enum and control-flow acceptance for the 204 newly mapped rows. Manual family summaries and exact expressions exist, but identifier/literal traversal can overassociate shadowed/property names and does not specialize factory parameters or prove all callback/catch paths.',
         commands=[r['command'] for r in rows if not r['acceptedContract']],
         exactPairLocation='command-map.json.commands[].flagRouting (754 declared flag occurrences over all 234 rows; do not interpret the zero lexical misses as zero semantic gaps)',
         factoryCommands=[r['command'] for r in rows if r['binding'] in ['checkHandler(true)', 'checkHandler(false)', "linearRelationWriteHandler('add')", "linearRelationWriteHandler('remove')"]],
         acceptance='Root verifies full normalized field contracts against the anchored bodies and accepts the existing 30 links unchanged; no new command census is needed.'),
    dict(id='E4-S2', kind='shared-validator-boundary',
         obligation='Reconcile external shared validators and normalization constants that materially constrain CLI requests. Family rules are source-backed, but this lead has not fully reviewed every called shared function.',
         commands=commands('automations', 'computer', 'linear', 'project', 'emulator'),
         sourceEvidence=source_refs([
             'src/shared/automation-schedule-occurrences.ts', 'src/shared/automation-schedule-parsing.ts',
             'src/shared/task-source-context.ts', 'src/shared/computer-use-key-spec.ts',
             'src/shared/linear/agent-access.ts', 'src/shared/linear/uuid.ts',
             'src/shared/tui-agent-config.ts', 'src/shared/cross-platform-path.ts',
             'src/shared/execution-host.ts', 'src/shared/wsl-paths.ts']),
         acceptance='Confirm accepted E2/E3/E5/source artifacts cover these named function contracts or review the bounded functions, retaining exact defaults and refusals.'),
    dict(id='E4-S3', kind='transport-and-compatibility-boundary',
         obligation='Client dispatch/timeout/recovery entry behavior was read; finish the transport, protocol-envelope and compatibility helper contracts reached by class methods/dynamic imports, including both version skews and loss-of-contact semantics.',
         commands=[r['command'] for r in rows if r['observableContract']['rpcCalls'] or r['command'] in ['open', 'status', 'serve']],
         sourceEvidence=source_refs([
             'src/cli/runtime/transport.ts', 'src/cli/runtime/websocket-transport.ts',
             'src/cli/runtime/envelope-schema.ts', 'src/cli/runtime/metadata.ts',
             'src/cli/runtime/status.ts', 'src/cli/runtime/launch.ts',
             'src/shared/orchestration-check-output.ts', 'src/shared/orchestration-rpc-contract.ts']),
         acceptance='Reconcile the existing relay/platform and E3 reviews at these exact boundaries; do not treat an RPC name or client-side type as a fully verified response contract.'),
    dict(id='E4-S4', kind='local-effect-boundary',
         obligation='CLI branches for account isolation/cleanup, hooks fallback and VM provision/cleanup were read. Their imported filesystem/keychain/process implementations remain separate source acceptance boundaries, not effects exercised by this audit.',
         commands=commands('account', 'agent-hooks', 'vm', 'environment', 'artifacts'),
         sourceEvidence=source_refs([
             'src/main/claude-accounts/keychain.ts', 'src/main/agent-hooks/managed-agent-hook-controls.ts',
             'src/shared/ephemeral-vm-recipe-doctor.ts', 'src/shared/ephemeral-vm-recipe-runner.ts',
             'src/shared/runtime-environment-store.ts', 'src/shared/runtime-environments.ts',
             'src/shared/artifact-file-read.ts', 'src/shared/artifact-cli-bridge.ts',
             'src/shared/windows-batch-spawn.ts', 'src/shared/windows-console-input.ts']),
         acceptance='Match existing E5/platform evidence or inspect the named helper functions; preserve host ownership, rollback/cleanup, content limits and fail-closed behavior.'),
    dict(id='E4-S5', kind='formatter-and-result-contract-boundary',
         obligation='Exact output call sites and reachable formatter expressions are retained, and unusual JSON/exit branches were manually read. Complete golden field/value semantics for imported result formatting and shared output projections without claiming lexical extraction proves all returned variants.',
         commands=[r['command'] for r in rows if not r['acceptedContract']],
         sourceEvidence=source_refs([
             'src/cli/browser-format.ts', 'src/cli/computer-format.ts', 'src/cli/linear-format.ts',
             'src/cli/automation-format.ts', 'src/cli/project-format.ts',
             'src/cli/handlers/orchestration/worker-output.ts', 'src/shared/orchestration-check-output.ts']),
         acceptance='Review affected formatters/result shapes and retain null/absent/false, warning and JSON envelope exceptions as distinct contracts.'),
]

verification = dict(
    schema='drogon.e4.static-verification/1', sourceRevision=SHA,
    outcome='passed-static-artifact-checks-only',
    checks={
        'canonicalOrderedJoin': 234, 'uniqueHandlerKeys': 234,
        'groups': len(Counter(r['group'] for r in rows)), 'acceptedContractLinks': 30,
        'newlyMappedRows': 204, 'aliasSpellings': 8, 'hiddenRows': 1,
        'declaredFlagOccurrences': sum(len(r['flagRouting']) for r in rows),
        'semanticNodeReferencesValid': True,
        'sourceFileHashesVerified': len(mapping['sourceFiles']),
        'boundaryFileHashReferencesVerified': len(mapping['boundarySources']),
        'sourceTestHashesVerified': len(tests['tests']),
        'upstreamLicensePreservedByteForByte': True,
    },
    commandsRun=['node docs/migration/audit-closure/e4-cli/reconcile-cli.mjs',
                 'python3 docs/migration/audit-closure/e4-cli/finalize-report.py'],
    notProven=['behavioral source baseline', 'candidate RED or GREEN',
               'full per-flag semantics', 'runtime method behavior',
               'provider subprocess behavior', 'OS/remote parity', 'installed product fidelity'])
write('verification.json', verification)

artifacts = ['report.md', 'command-map.json', 'source-tests.json', 'verification.json',
             'reconcile-cli.mjs', 'finalize-report.py', 'source-LICENSE']
closure = dict(
    schema='drogon.audit-closure.e4/1', groupId='E4', proposedDisposition='open',
    sourceRevision=SHA,
    sourceRoot=str(SOURCE), evidence=evidence,
    task=dict(taskId='task_75e78e6ac486', dispatchId='ctx_902b01623a5b',
              terminal='term_628055f8-e9bc-4f00-995c-0f119af80751',
              coordinator='term_fa0de916-26da-4394-ba54-86a2ab8597e7',
              requestedModel='gpt-6-astra', effectiveModel='unverifiable from runtime terminal/dispatch inspection',
              runtimeAgentIdentity='codex', depth=1, injectedMaxDepth=None,
              injectedCanDispatchSubWorkers=None, children=[],
              hierarchy='No child attempted; root directed continued direct audit.'),
    coverage=dict(canonicalCommands=234, previouslyAcceptedContracts=30, remainingRowsMapped=204,
                  commandsOmitted=[], newInterceptionOutsideCanonicalDenominator=['agent-teams-tmux'],
                  additionalEntryBehavior=['help', '--version/-v', 'packaged CLI launch redirect'],
                  groups=dict(Counter(r['group'] for r in rows)),
                  semanticClosure=False,
                  methodLimitations=['lexical identifier/property/shadowing overapproximation',
                                     'factory binding recorded but parameters not evaluated',
                                     'dynamic imports/class methods/non-CLI functions are not a complete interprocedural proof',
                                     'flag literal presence does not prove value/default/required semantics',
                                     'source test associations do not establish assertion coverage']),
    resolvedObligations=[
        dict(id='E4-R1', description='Complete accepted command-to-actual-handler reconciliation, with exact code anchors/hashes and no omitted canonical commands.'),
        dict(id='E4-R2', description='Thirty accepted per-handler contract links retained; 204 additional rows include lexical request/output/error/helper evidence and manual family behavior summaries.'),
        dict(id='E4-R3', description='Passthrough bypass is first-token-only; claude-teams raw argv and internal tmux shim are characterized separately from generic parser mode.'),
        dict(id='E4-R4', description='Eight aliases, hidden terminal stop, retired-command errors and non-RPC observable operations explicitly accounted for.'),
        dict(id='E4-R5', description='Host-routing, local/remote cwd, JSON/exit exceptions and compatibility refusal/recovery branches characterized at the CLI entry/handler layer.'),
    ],
    stillOpenObligations=open_obligations,
    dependencyInventory='command-map.json.boundarySources: 75 exact boundary source files; discovery/hash list, not 75 new capability groups or 75 proven defects',
    sourceTests=dict(manifest='source-tests.json', cliFiles=111, adjacentBoundaryFiles=39,
                     executedHere=0, fullBodyReads=3, partialBodyReads=1,
                     assertionAcceptance='pending; retain accepted complete source-suite map and runner plan'),
    executionDebt=[
        'Run all applicable original tests from accepted manifest using verified isolated runner/environment, with versions and actual receipts.',
        'Port assertions before feature implementation; demonstrate behavioral RED and GREEN, never setup failures or skipped tests as success.',
        'Execute first-token/leading-flag passthrough, aliases/hidden/retired, stdout/stderr/exit and packaged launcher cases named in report.md.',
        'Compare both remote version skews and OS/SSH/folder boundaries; preserve pending operation identity and live/unverifiable/exited distinctions.',
        'Validate real provider/runtime/application behavior and installed preview only in the authorized implementation phase.'
    ],
    futureAcceptanceCommands=verification['commandsRun'] + [
        'In authorized disposable source baseline: pnpm exec vitest run --config config/vitest.config.ts src/cli',
        'In authorized disposable source baseline: pnpm exec vitest run --config config/vitest.config.ts src/main/startup/cli-launch-redirect.test.ts src/shared/cli-argument-boundary.test.ts',
        'Run every additional exact source-tests.json.tests path with its retained runner membership as part of full accepted baseline plan.'
    ],
    auditProgress=dict(estimatePercent=60, confidence='medium-low', denominator='7/12 accepted unweighted groups',
                       acceptedGroupDelta=0, nextMilestone='root reviews full reconciliation and resolves E4-S1 through E4-S5',
                       deadlineRisk24h='high for full-fidelity rewrite; target flexible',
                       testMigrationDelta='no pass or migration progress claimed', productFidelityDelta='none claimed'),
    artifacts=[dict(path=str((OUT/p).relative_to(ROOT)), line=1, sha256=digest(OUT/p)) for p in artifacts],
    acceptanceAuthority='external root coordinator; no shared ledger modified')
write('closure.json', closure)
print(json.dumps({'disposition': 'open', 'commands': 234, 'newRows': 204,
                  'semanticObligations': len(open_obligations), 'sourceTestsNotExecutedHere': 150,
                  'staticVerification': 'passed'}))
