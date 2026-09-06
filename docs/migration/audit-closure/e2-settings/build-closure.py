"""Assemble source-audit evidence. This does not execute or import the product."""
import csv
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
SOURCE = Path('/Users/carlos/Documents/Drogon-mentu-session')
REVISION = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
PREFIXES = {'S': 'src/shared', 'M': 'src/main', 'R': 'src/renderer/src'}
EXCEPTIONS = {'markdownReviewToolsEnabled', 'artifactsEnabled', 'experimentalMobile'}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read_json(name):
    return json.loads((ROOT / 'docs/migration' / f'parity-settings-{name}.json').read_text())

def read_tsv(name):
    with (OUT / name).open() as f:
        return list(csv.DictReader(f, delimiter='\t'))

def expand(anchor):
    return PREFIXES.get(anchor[0], anchor[0]) + anchor[1:]

def evidence(anchor):
    anchor = expand(anchor) if anchor[:2] in ('S/', 'M/', 'R/') else anchor
    path, number = anchor.rsplit(':', 1)
    line = int(number.split('-')[0])
    lines = (SOURCE / path).read_text().splitlines()
    assert 1 <= line <= len(lines), anchor
    return {'path': path, 'line': line, 'sha256': digest(SOURCE / path),
            'anchorText': lines[line - 1].strip()}

def write_json(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

def build():
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
    assert head == REVISION
    subprocess.run(['git', 'diff', '--quiet', REVISION, '--', 'src'], cwd=SOURCE, check=True)
    routing = read_json('field-routing')
    properties = {x['name']: x for x in read_json('properties')['fields']}
    consumers = {x['name']: x for x in read_json('consumers')['fields']}
    notes = read_tsv('field-contracts.tsv')
    assert [x['field'] for x in notes] == [x['field'] for x in routing['fields']]
    assert len({x['field'] for x in notes}) == 214
    inputs = []
    source_files = {}
    for name in ('field-routing', 'properties', 'persistence-contracts', 'unobserved-contracts', 'consumers', 'keybindings'):
        for ext in ('md', 'json'):
            p = ROOT / 'docs/migration' / f'parity-settings-{name}.{ext}'
            inputs.append({'path': str(p.relative_to(ROOT)), 'sha256': digest(p), 'line': 1})
    verified_reused_hashes = []
    for name, key in (('persistence-contracts', 'files'), ('unobserved-contracts', 'fileHashes'), ('field-routing', 'sourceFingerprints')):
        for path, expected in read_json(name)[key].items():
            assert digest(SOURCE / path) == expected, path
            source_files[path] = expected
            verified_reused_hashes.append({'input': name, 'path': path, 'sha256': expected})
    fields = []
    tests = set((OUT / 'source-test-files.txt').read_text().splitlines())
    for i, (row, note) in enumerate(zip(routing['fields'], notes), 1):
        name = row['field']
        ev = evidence(note['anchor'])
        source_files[ev['path']] = ev['sha256']
        refs = [r for r in consumers[name]['references'] if re.search(r'\.(test|spec)\.[cm]?[jt]sx?$', r['path'])]
        tests.update(r['path'] for r in refs)
        prop = properties[name]
        is_stamp = any(token in name for token in ('Defaulted', 'Migrated', 'Seed'))
        role = 'migration-state' if is_stamp else 'consumer-setting'
        if name in ('experimentalSidekick', 'experimentalCompactWorktreeCards', 'rightSidebarOpenByDefault', 'experimentalActivity'):
            role = 'legacy-migration-input'
        if name == 'keybindings': role = 'legacy-input-to-dedicated-file-authority'
        if name == 'markdownReviewToolsEnabled': role = 'settings-toggle-only-in-located-evidence'
        if name in ('experimentalMobile', 'artifactsEnabled'): role = 'metadata-only-in-located-evidence'
        fields.append({
            'id': f'E2-F{i:03}', 'field': name,
            'originalClassification': row['classification'],
            'originalEvidenceTier': row['evidenceTier'],
            'semanticRole': role,
            'sourceDisposition': 'no-downstream-runtime-read-located' if name in EXCEPTIONS else 'bounded-source-contract-characterized',
            'consumerEvidence': ev, 'contract': note['contract'],
            'originalRoutingEvidence': row['citations'],
            'declarationEvidence': evidence(prop['anchor']),
            'default': prop.get('default'),
            'persistenceContracts': ['SP01', 'SP02', 'SP03', 'SP04', 'SP05', 'SP06', 'SP09', 'SP10', 'SP11', 'SP12', 'SP13'],
            'persistenceBoundary': 'Common pipeline is reused, not blanket authority to write this field. SP05 blocks protected renderer mutations; activeRuntimeEnvironmentId uses dedicated preference routing; visibility adds SP07; host overrides add SP08; keybindings additionally follows SK02-SK05/SK16.',
            'sourceTestReferences': refs,
            'sourceTestReferenceBoundary': 'Accepted scanner pointers only; may be fixtures/type usage and are not assertion coverage. Empty does not mean no tests exist.',
            'remainingAcceptance': {'id': f'E2-A{i:03}', 'status': 'not-executed',
                'required': f'Characterize {name} with source and candidate cases for the stated contract, allowed mutation owner, absent/current value and explicit false/null/empty where the declared type permits; save, reload and observe the actual consumer without substituting a mock of missing product behavior.',
                'expected': note['contract']}
        })
    shortcut_contracts=[]
    for row in read_tsv('shortcut-contracts.tsv'):
        ev=evidence(row.pop('anchor'))
        source_files[ev['path']]=ev['sha256']
        shortcut_contracts.append({**row, 'evidence':ev, 'executionStatus':'not-executed'})
    persistence=[]
    for row in read_json('persistence-contracts')['contracts']:
        ev=evidence(row['source']['path']+':'+str(row['source']['line']))
        source_files[ev['path']]=ev['sha256']
        persistence.append({**row, 'evidence':ev, 'disposition':'reused-coordinator-reviewed-source-contract',
                            'remainingAcceptanceId':'E2-'+row['id'], 'executionStatus':'inherited-receipts-only'})
    test_rows=[]
    for path in sorted(tests):
        p=SOURCE/path
        assert p.is_file(), path
        source_files[path]=digest(p)
        declarations=[]
        for line, text in enumerate(p.read_text().splitlines(), 1):
            if re.search(r'\b(?:it|test)\s*(?:\.|\()',text):
                declarations.append({'line':line,'text':text.strip()})
        test_rows.append({'path':path,'sha256':digest(p),'declarationPointers':declarations,
                         'status':'not-executed-in-this-dispatch',
                         'boundary':'Named declaration pointers are not expanded parameterized counts or assertion-body acceptance.'})
    write_json('source-test-plan.json', {'sourceRevision':REVISION,
        'scope':'Bounded E2 execution candidates, combined with accepted consumer test pointers; supplements and never replaces accepted M7 whole-source test map.',
        'fileCount':len(test_rows), 'files':test_rows,
        'futureAcceptanceArgv':['pnpm','exec','vitest','run','--config','config/vitest.config.ts',*sorted(tests)],
        'executionLocation':'Coordinator-prepared isolated source checkout at pinned revision with native runtime/dependencies verified; never run setup or tests against the read-only migration reference.',
        'candidateCommandBoundary':'Candidate test-port paths do not exist in this assignment; root must map each source suite/acceptance ID before implementation. No invented cargo/UI command is reported as runnable parity proof.'})
    write_json('closure.json', {
        'schema':'drogon.audit-closure.e2-settings/1', 'groupId':'E2', 'sourceRevision':REVISION,
        'taskId':'task_34d223f6c73e','dispatchId':'ctx_4d1d028772be',
        'proposedDisposition':'open',
        'dispositionReason':'Complete 214-row bounded reconciliation delivered; three downstream-route exceptions and full per-action shortcut consumer proof remain open. Source characterization does not close behavioral execution.',
        'runtime':{'requestedModel':'gpt-6-astra high (root-owned launch provenance)','effectiveModelFromWorkerShow':None,
                   'agentIdentity':'codex','depth':1,'maxDepth':1,'maxDepthEvidence':'root status msg_11c03836d8fa',
                   'canDispatchSubWorkers':False,'children':[], 'limitation':'No leaf dispatched; continued locally under root direction.'},
        'counts':{'canonicalFields':len(fields),'uniqueFields':len({x['field'] for x in fields}),
                  'inheritedFieldsReconciled':sum(x['originalEvidenceTier']=='base-census-inherited' for x in fields),
                  'consumerOrMigrationRoutesCharacterized':sum(x['field'] not in EXCEPTIONS for x in fields),
                  'downstreamRouteExceptions':len(EXCEPTIONS),'persistenceContracts':len(persistence),
                  'shortcutBoundaryContracts':len(shortcut_contracts),'sourceTestFilesQueued':len(test_rows),
                  'originalClassificationCounts':dict(Counter(x['originalClassification'] for x in fields)),
                  'productTestsRunThisDispatch':0},
        'resolvedObligations':['All 214 canonical fields reconciled in declaration order with specific contract and hashed source anchor.',
                               'All 180 inherited rows now have an explicit bounded characterization or named exception; none silently treated as behaviorally proved.',
                               'SP01-SP13 preserved by verified fingerprints and source contracts; Store and dedicated keybinding write semantics separated.',
                               'Legacy keybindings startup getter corrected; platform/dynamic/context/cache/override boundaries characterized in SK01-SK16.'],
        'stillOpenObligations':[
            {'id':'E2-O01','fields':['markdownReviewToolsEnabled'], 'kind':'enumeration-semantic-limit',
             'required':'Resolve whether any generic/dynamic route implements the advertised review-tools gating; the exact-name production TS scan locates only Settings toggle, default and type. Preserve toggle/persistence pending decision, and test actual review-tool visibility under both values.'},
            {'id':'E2-O02','fields':['experimentalMobile','artifactsEnabled'], 'kind':'enumeration-semantic-limit',
             'required':'Root review of metadata-only treatment: artifactsEnabled is explicitly deprecated and rejected by RPC grant test; experimentalMobile has default/type/telemetry whitelist only in located source. No unused/removal conclusion from search absence.'},
            {'id':'E2-O03','kind':'enumeration-semantic-limit',
             'required':'Per-action handler/effect coverage for all 88 static shortcut actions is not established by SK boundary modules; retain accepted catalog and port each actual consumer suite. Dynamic agent eligibility and plugin context are characterized, not an exhaustive runtime plugin inventory.'}],
        'executionDebt':{'fieldAcceptanceIds':[x['remainingAcceptance']['id'] for x in fields],
                         'persistenceAcceptanceIds':['E2-SP'+str(i).zfill(2) for i in range(1,14)],
                         'shortcutAcceptanceIds':[x['id'] for x in shortcut_contracts],
                         'baselineReceiptsReused':read_json('persistence-contracts')['baselineEvidence'],
                         'boundary':'14 prior macOS durable primitive cases only; zero new source or candidate tests, no real OS keyboard/SSH/package execution. No skipped or setup-failed case is a pass.'},
        'completeness':{'enumeratedFieldOmissions':[], 'inheritedUncertaintySilentlyDropped':False,
                        'readScope':'Anchored source neighborhoods and named central/shortcut function bodies; file hashes establish identity, not full-file/full-callgraph review.',
                        'limits':['Not a full TypeScript type-checker proof or exhaustive dynamic property analysis.',
                                  'Composite nested settings and downstream consumer algorithms remain domain execution contracts; top-level pointer is not all nested behavior.',
                                  'No product installation handoff is due because this assignment contains no accepted implementation block.']},
        'progress':{'auditEstimatePercent':60,'referenceDenominator':'7/12 accepted groups','confidence':'medium-low','deltaAcceptedGroups':0,
                    'nextClosureMilestone':'Root independently reviews 214-row matrix and resolves E2-O01 through E2-O03.',
                    'deadlineRisk':'24-hour target flexible per root; full-fidelity delivery still high risk, no numerical ETA asserted.',
                    'testMigrationProgress':'No new ports or execution','productFidelityProgress':'No implementation claim'},
        'inputEvidence':inputs,'verifiedReusedSourceHashes':verified_reused_hashes,
        'sourceFiles':dict(sorted(source_files.items())), 'fields':fields,
        'persistenceContracts':persistence,'shortcutContracts':shortcut_contracts,
        'futureAcceptanceCommands':{'metadata':['python3','docs/migration/audit-closure/e2-settings/build-closure.py','verify'],
                                    'sourceTests':'Exact argv in source-test-plan.json; run all cases unchanged in a prepared isolated checkout.'}
    })
    print(json.dumps({'fields':len(fields),'testsQueued':len(test_rows),'sourceFiles':len(source_files),'disposition':'open'}))

def verify():
    d=json.loads((OUT/'closure.json').read_text())
    names=[x['field'] for x in d['fields']]
    assert names==[x['field'] for x in read_json('field-routing')['fields']]
    assert len(names)==len(set(names))==214
    assert sum(x['originalEvidenceTier']=='base-census-inherited' for x in d['fields'])==180
    assert [x['id'] for x in d['persistenceContracts']]==[f'SP{i:02}' for i in range(1,14)]
    for path,h in d['sourceFiles'].items(): assert digest(SOURCE/path)==h,path
    for inp in d['inputEvidence']: assert digest(ROOT/inp['path'])==inp['sha256'],inp['path']
    for row in d['fields']:
        ev=row['consumerEvidence']; text=(SOURCE/ev['path']).read_text().splitlines()
        assert text[ev['line']-1].strip()==ev['anchorText']
    print(json.dumps({'status':'verified','fields':214,'inherited':180,'SP':13,'SK':len(d['shortcutContracts']),
                      'sourceHashes':len(d['sourceFiles']),'scope':'artifact consistency only; no behavioral tests'}))

if __name__=='__main__':
    import sys
    verify() if sys.argv[1]=='verify' else build()
