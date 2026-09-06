"""Build bounded E1 evidence without executing or modifying the source checkout."""
import hashlib
import json
import re
import shlex
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[3]
SOURCE = Path('/Users/carlos/Documents/Drogon-mentu-session')
REVISION = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
MIGRATION = REPO / 'docs/migration'


def read_json(name):
    return json.loads((MIGRATION / name).read_text())


def fingerprint(path):
    data = path.read_bytes()
    return {'sha256': hashlib.sha256(data).hexdigest(), 'lines': len(data.splitlines())}


def source_ref(spec, tier='source-body-read'):
    path, ranges = spec.rsplit(':', 1)
    spans = []
    for value in ranges.split(','):
        numbers = list(map(int, value.split('-')))
        spans.append({'start': numbers[0], 'end': numbers[-1]})
    evidence = {'path': path, **fingerprint(SOURCE / path), 'reviewedRanges': spans,
                'tier': tier, 'executed': False}
    assert all(1 <= r['start'] <= r['end'] <= evidence['lines'] for r in spans), spec
    return evidence


def document_ref(name, needle=None):
    path = MIGRATION / name
    lines = path.read_text().splitlines()
    anchor = next((i for i, line in enumerate(lines, 1) if needle and needle in line), 1)
    return {'path': str(path.relative_to(REPO)), 'line': anchor, **fingerprint(path)}


def note(card, contract, correction, sources, tests, remaining):
    return {'cardId': card, 'contract': contract, 'correction': correction,
            'sourceEvidence': [source_ref(s) for s in sources],
            'assertionEvidence': [source_ref(s, 'selected-assertion-bodies-read') for s in tests],
            'remainingAcceptance': remaining, 'execution': 'not-run',
            'disposition': 'source-characterized-with-explicit-limits'}


NOTES = [
    note('PUI-ONBOARD-001',
         'Onboarding visibility is exactly non-null state with closedAt null. Completed and dismissed close paths write flowVersion, closedAt, outcome, lastCompletedStep and checklist.dismissed through onboarding.update; a close latch admits one close, resets on rejection and reports error. A successful completion schedules the star notice.',
         'No-reappearance depends on receiving persisted closedAt, not an unconditional promise that onboarding can never reopen. The existing persistence test checks notification settings and a scheduled callback with a mocked API, not a disk/app relaunch.',
         ['src/renderer/src/components/onboarding/should-show-onboarding.ts:1-7',
          'src/renderer/src/components/onboarding/use-onboarding-flow-persistence.ts:71-129',
          'src/renderer/src/app-shell/use-onboarding-and-feature-tips.ts:44-65'],
         ['src/renderer/src/components/onboarding/use-onboarding-flow-persistence.test.ts:119-165'],
         ['Preserve unchanged OnboardingFlow and persistence tests; characterize skip confirmation click through update and failed-close retry, then isolated disk restart for completed/dismissed outcomes.',
          'Keep explicit onboarding-reopen behavior; independently exercise step skipping, Windows terminal step and async preflight.']),
    note('PUI-FEATURETIPS-001',
         'Automatic tours require hydrated UI, eligibility, no onboarding/blocking surface/active tour, an unseen tour and an unused session allowance. Start chooses the required starting target, not a persisted arbitrary mid-step. Interaction persistence is awaited before requesting; source disable/unmount suppresses the active attached tour. Dismissal tests clear active tour and persist the tour ID as seen; stale dismissal of another tour does nothing.',
         'The earlier no-contextual-tour-tests claim is false: store, gate, overlay, control and hook tests exist. The verified persistence unit is a whole tour ID; an invented per-step durable-resume contract must not be ported as an unchanged expectation.',
         ['src/renderer/src/components/contextual-tours/use-contextual-tour.ts:44-52,127-175,183-249',
          'src/renderer/src/components/contextual-tours/contextual-tour-gate.ts:73-84,127-169'],
         ['src/renderer/src/store/slices/ui-contextual-tours.test.ts:122-139,495-542',
          'src/main/persistence-ui-state.test.ts:359-401'],
         ['Baseline and port complete contextual-tour/feature-tip suites from the existing M1 allocation, including overlay target visibility, cleanup and per-tip dialogs.',
          'Execute restart with whole-tour seen IDs, failed persistence, onboarding suppression and a missing/reappearing target; no mocked-store result is app restart evidence.']),
    note('PUI-PLUGINCATALOG-001',
         'Capability requests are strict objects with a closed kind enum; invalid manifests are rejected during install inspection. Rollback serializes mutation, requires one retained predecessor, validates key/safety-list/provenance/integrity, then publishes its immutable version and returns the consent fingerprint. Rollback/remove dialogs focus Cancel, block busy confirmation and pass the selected pluginKey; removal also removes stored plugin data.',
         'Rollback is source-backed and a real installer test reads its lock record; it is not proved merely by the dialog name. The test uses fixture Git and local temporary files, not a marketplace network or renderer consent journey.',
         ['src/shared/plugins/plugin-capabilities.ts:15-29',
          'src/shared/plugins/plugin-manifest.ts:129-162',
          'src/main/plugins/plugin-install-staging.ts:56-79',
          'src/main/plugins/plugin-install.ts:195-285',
          'src/renderer/src/components/settings/PluginRollbackDialog.tsx:15-68',
          'src/renderer/src/components/settings/PluginRemoveDialog.tsx:15-65'],
         ['src/main/plugins/plugin-marketplace-installer.test.ts:144-197'],
         ['Exercise malformed capability object/kind through preview/install and assert no publication; separately retain current consent/fingerprint tests.',
          'Rendered rollback/remove/consent flow; exact previous fingerprint re-consent, no/ambiguous predecessor, stale preview, integrity failure and interrupted publication.']),
    note('PUI-NOTIF-001',
         'Probe is unsupported off macOS or without native support. Native authorized/denied readout is authoritative; pending authorization triggers only one probe even with force. With no readout, force bypasses cached session evidence, but joins a pending probe. A show/failed event updates observed evidence; timeout returns blocked non-authoritatively without recording failed. Mobile fanout precedes desktop-focus suppression and has independent cooldown.',
         'force:true is not a universal guarantee of corrected permission state. Existing notifications-permission-onboarding tests directly cover force/cache, pending authorization and timeout recovery; native permission remains an OS integration obligation.',
         ['src/main/ipc/notifications.ts:28-85,112-184',
          'src/main/ipc/notification-permission-probe.ts:5-30,40-112'],
         ['src/main/ipc/notifications-permission-onboarding.test.ts:102-229'],
         ['Run unchanged permission/onboarding and mobile-fanout cases, including failed-event then forced successful-event transition.',
          'Exercise NotificationsPane settings interactions, actual macOS permission changes, native banner/tray and mobile dismissal/focus behavior with isolated profiles.']),
    note('PUI-WEBMODE-001',
         'installWebPreloadApi wraps a partial concrete API in a fallback proxy. Missing on* returns unsubscribe; is*/has*/pathExists resolve false; list*/detect* resolve []; preview* returns found:false; write/resize/reportGeometry return undefined; other methods resolve undefined. Bots explicitly reject desktop-only operations. stats.summary catches failure and returns zero counters/null firstEventAt.',
         'Both inherited universal claims are unsupported: not every desktop capability has an implemented web projection, and not every missing method produces a visible unavailable message. Preserve explicit rejection, synthetic/empty fallback and implemented runtime route as distinct source behaviors; this is not permission to remove required web functionality.',
         ['src/renderer/src/web/preload-api/web-fallback-api.ts:1-63',
          'src/renderer/src/web/web-preload-api.ts:55-154'], [],
         ['OPEN ENUMERATION: reconcile each concrete web factory and fallback caller against domain contracts and full web tests; root/E3 owns shared bridge linkage, E1 owns visible states.',
          'Run complete web-preload and runtime-client suites with the pinned config, then connected/disconnected/mixed-version web journeys; assert actual current fallback behavior, never invented blanket copy.']),
    note('PUI-PETS-001',
         'Bundle import rejects invalid/oversized manifest, final manifest symlink, lexical absolute/escaping spritesheet paths, final spritesheet symlink and oversized/non-file/unsupported sheet. Limits are 64 KiB manifest and 64 MiB image; manifest length is checked again after reading. Copies stage to a fresh UUID sibling temporary directory then rename, removing temporary data on failure.',
         'This does not establish universal symlink confinement: O_NOFOLLOW protects the final open when supported, and the fallback copies on platforms without it; parent-component symlink races and cross-platform behavior still need characterization. Do not elevate the broad malicious-bundle expectation above the exact guards read.',
         ['src/main/ipc/pet-import-size-limits.ts:1-2',
          'src/main/ipc/pet-symlink-safe-copy.ts:1-27',
          'src/main/ipc/pet-bundle-import.ts:25-100',
          'src/main/ipc/pet-bundle-spritesheet-source.ts:8-55'], [],
         ['Preserve pet-bundle and pet-agent-state tests; add or locate path traversal, final/intermediate symlink, TOCTOU growth, 64 KiB/64 MiB boundary and partial-copy cleanup fixtures.',
          'Render agent-state animation, import/cancel/failure and persisted pet selection on supported OSes.']),
    note('PUI-STATS-001',
         'StatsPane records usage-tracking and fetches stats on mount. Missing summary hides only summary area; both zero agent/PR totals show the first-agent empty message; otherwise three cards show agents, worked duration and PRs, with optional tracking date. Usage Analytics always remains and mounts only the selected Overview/Claude/Codex/OpenCode/Grok pane. stats:summary returns four collector aggregate fields.',
         'StatsPane is located at components/stats, not components/settings. The earlier import-isolation test is neither its behavior nor IPC round-trip coverage. A rejected web stats call synthesizes zeros (WEBMODE contract), so zero is not universally a successful measured result.',
         ['src/renderer/src/components/stats/StatsPane.tsx:21-218',
          'src/main/ipc/stats.ts:1-8', 'src/main/stats/collector.ts:114-120'], [],
         ['Characterize null/zero/nonzero summaries, duration/date formatting, provider switch mount cleanup and summary errors through the real store/IPC path.',
          'Port existing collector and usage-provider suites; actual provider availability, usage/error states, rendered layouts and restart remain.']),
    note('PUI-SPARSE-001',
         'New/edit drafts trim names, reject blank/>80/case-insensitive collisions and parse directories. Save closes draft only on successful returned preset, retains errors and clears submitting while mounted. Delete first requests confirmation; successful removal clears matching draft/confirmation, rejection retains confirmation, and finally clears deleting ID. Repo IPC normalizes directories, retains existing ID/createdAt, changes preset storage and broadcasts sparsePresets:changed.',
         'Settings edits are preset mutations; the inspected handler does not run checkout mutations. This alone does not prove existing-worktree path consistency across other consumers or remote persistence. The prior assertion that one render-error test covers add/edit/delete is not accepted.',
         ['src/renderer/src/components/settings/SparsePresetSettingsSection.tsx:34-153,187-239',
          'src/main/ipc/repos/sparse-preset-handlers.ts:8-90'],
         ['src/main/ipc/repos-sparse-presets.test.ts:102-148'],
         ['Port full repo sparse and creation-time tests. Add rendered new/edit/delete success, false-return/rejection, unmount and confirmation-state cases.',
          'Verify settings edit versus existing-worktree snapshot and later creation application locally and on SSH; read indirect storage/subscription consumers before claiming no mutation outside this handler.']),
    note('PUI-QUICKCMD-001',
         'Settings scopeSelection is a local view filter (null means sticky all); a single repo/global filter only seeds a new draft. Commands carry their own normalized global/repo scope. Host editors are fenced by available host and runtime connection generation; stale editors close. Menu receives already partitioned repo/global host entries and separately searches them. Host keys combine host ID and command ID; remote commands join local commands only for supported current generation.',
         'Do not equate the Settings list filter with a saved command scope or assume the menu owns host filtering. The shared repo-match test covers global/null and matching/nonmatching repo, not a full Settings-create-to-menu journey.',
         ['src/renderer/src/components/settings/QuickCommandsPane.tsx:49-84,90-198',
          'src/renderer/src/components/tab-bar/TabBarQuickCommandsMenu.tsx:36-80',
          'src/renderer/src/hooks/use-terminal-quick-command-hosts.ts:64-99,125-198'],
         ['src/shared/terminal-quick-commands.test.ts:249-286'],
         ['Trace partitioning consumer and render Settings-created global/repo commands in matching/nonmatching workspace, folder workspace and runtime-host contexts.',
          'Exercise unsupported/stale host loads, generation changes during edits, search, keyboard/IME, delete/run, exact saved scope and command IDs.']),
    note('PUI-CONN-001',
         'Startup partitions targets into passphrase-deferred, awaited eager and background; background targets are deferred before connecting and removed from deferred only on connected publication. Eager connection waits at most 15 seconds; timed-out IDs remain deferred for focus reattach. Non-timed-out eager targets poll getState for old/wrapped providers. Active workspace targets derive from repo connection plus tab/pending/split PTY IDs.',
         'These helpers publish connection state or report timeout/failure; they do not themselves emit live/unverifiable/exited process verdicts. Missing contact cannot be translated to exited. Startup and settings CRUD/passphrase/destructive actions remain distinct seams.',
         ['src/renderer/src/startup/ssh-startup-reconnect.ts:7-45',
          'src/renderer/src/startup/startup-ssh-connection-restore.ts:5-128',
          'src/renderer/src/startup/active-workspace-ssh-targets.ts:24-49'], [],
         ['Run all three located startup suites and SshTargetForm unchanged; verify unresolved passphrase/destructive dialogs and settings CRUD-to-startup identity.',
          'Real SSH unavailable/late-connected/passphrase and mixed-version restore with host-owned liveness; assert tabs/workspaces retained without treating timeout as exit.']),
    note('PUI-CONN-002',
         'Pair generation sends trimmed address, rotate:true and explicit reach intent; unavailable clears generated links and reports guidance. Grant/network loads discard stale/unmounted replies. Successful revoke removes matching grant and clears current generated link; already-revoked reloads grants. Host access form requires nonblank name and parsed link; loopback needs explicit tunnel override; busy disables submission. Grant rows distinguish current/unused/last-used and per-row revoking.',
         'Pair-link generation is not second-device attachment. UI copy about disconnecting immediately is not an observed transport result; actual verification/connection/save sequence and runtime grant enforcement remain integration work.',
         ['src/renderer/src/components/settings/RuntimePairingUrlGenerator.tsx:72-168,180-303',
          'src/renderer/src/components/settings/RuntimeHostAccessForm.tsx:33-67,240-285',
          'src/renderer/src/components/settings/RuntimeAccessGrantList.tsx:26-160'], [],
         ['Port form/generator/status tests; exercise reach intent, stale loads, unavailable generation, copy/revoke failure and loopback gating.',
          'Read and test add-host verification/save controller, actual second-device pairing, identity mismatch, version skew, revocation/disconnect and active-host removal policy.']),
    note('PUI-KEYS-001',
         'Keep KEYS-001 catalog and KEYS-002 UI as separate IDs. Recorder notifies main to suspend global dispatch and clears focus on cleanup. saveBindings normalizes/parses, validates available definition, checks conflicts, then chooses reset or override and surfaces rejection. Keybinding store awaits api.keybindings.setAction and applies returned snapshot; it does not persist via GlobalSettings.',
         'Reuse accepted M4 catalog counts; recount is not E1 closure. The current UI/backend snapshot path is source-characterized, while actual OS activation and watcher persistence remain E2/T4. Do not promise instantaneous effects before the async action returns.',
         ['src/renderer/src/components/settings/ShortcutsPane.tsx:44-100,159-221',
          'src/renderer/src/store/slices/keybindings.ts:25-31,66-93'], [],
         ['Port recorder/list/visibility/mutation tests and E2 dedicated keybinding persistence tests; cover reset/common override, duplicate conflict, removed plugin action and rejection.',
          'Actual macOS/Linux/Windows chords, recorder cleanup, terminal policy, generated agents/plugins and persisted file reload are execution obligations.']),
    note('PUI-FILEEXP-001',
         'Name filtering is Files-view query state backed by runtime file list; oversized query disables loading, initial load has null paths, and clearing the filter resets query. Separate collapsed-path projection tests cover toggling and unrelated-path retention. Row action tests inspect visibility and mock clipboard/download calls, including remote host/SSH/web capability gates and error toasts.',
         'FileExplorerRow.actions is not a rendered row CRUD test. The 24-line projection test does not assert matching-node autoexpansion. Preserve rename/delete/reveal, virtualized tree/watch/drag and filter integration as exact remaining obligations rather than treating the Actions filename as coverage.',
         ['src/renderer/src/components/right-sidebar/use-file-explorer-name-filter.ts:24-86'],
         ['src/renderer/src/components/right-sidebar/file-explorer-name-filter-projection.test.ts:1-24',
          'src/renderer/src/components/right-sidebar/FileExplorerRow.actions.test.tsx:49-236'],
         ['OPEN ENUMERATION: read row CRUD/reveal callbacks and runtime mutation authority, tree projection/watch/drag source; characterize exact current behavior before adding assertions.',
          'Port complete existing row/projection tests; rendered filtering with autoexpanded matches, selection, rename/delete/reveal across local/SSH/runtime and failure/recovery.']),
    note('PUI-PORTS-001',
         'Forward dialog distinguishes add/edit, defaults privileged remote ports to local port+10000, and uses saved targetId/entry ownership. Submit validates both ports 1..65535, sends add/updatePortForward, closes after success and reports EADDRINUSE/EACCES specially. Remove calls removePortForward by ID, swallows rejection and expects broadcast state; it does not optimistically remove a row.',
         'Add/remove cannot be described as one generic guaranteed list update. Dialog/default target binding and asynchronous broadcasts are separate contracts; remove failure is not currently an inline error contract. Scanner and panel tests must remain distinct.',
         ['src/renderer/src/components/right-sidebar/ssh-port-forward-dialog.tsx:13-32,49-85,159-215',
          'src/renderer/src/components/right-sidebar/ssh-forwarded-port-row.tsx:13-39',
          'src/renderer/src/components/network/AddressPicker.tsx:30-77'], [],
         ['Run full scanner/panel/section tests; exercise add/edit/remove plus authoritative broadcasts, errors and target switch while dialog open.',
          'Read remaining AddressPicker/CustomAddressDialog validation and host scan consumers; real SSH tunnel/browser opening and stale scan retention, not scanner mocks alone.'])
]

SUPPLEMENTAL = [
    {'id': 'PUI-SHELL-001', 'mapsTo': ['PUI-SIDEBAR-001', 'E5'],
     'contract': 'Local Windows AND Linux use custom 138px/36px controls; paired web clients do not. Mac traffic-light gutter is 80px. Correct original audit claim that Linux is not customized.',
     'sources': ['src/renderer/src/app-shell/app-window-chrome.ts:6-22', 'src/renderer/src/lib/desktop-window-chrome.ts:1-23'],
     'remaining': 'Root shell/inset/fullscreen/narrow window rendering and platform tests; not closed by chrome constants.'},
    {'id': 'PUI-SHELL-003', 'mapsTo': ['PUI-KEYS-001', 'PUI-KEYS-002', 'E2'],
     'contract': 'Global dispatcher remains separate from catalog and editor.', 'sources': [],
     'remaining': 'Trace use-global-keybindings dispatcher to actions and OS/terminal policy; owned jointly with E2.'},
    {'id': 'PUI-TERM-003', 'mapsTo': ['PUI-QUICKCMD-001'],
     'contract': 'Terminal command creation/editor/launch identity is retained separately from Settings filtering.', 'sources': [],
     'remaining': 'TerminalQuickCommandDialog and launch integration, persisted scope, appendEnter and host ownership.'},
    {'id': 'PUI-SETTINGS-001', 'mapsTo': ['PUI-SETTINGS-000', 'E2'],
     'contract': 'Original 001..035 notation is a pane-range proposal, not 35 stable standalone cards; numeric IDs 002/003 already denote search/deep links.', 'sources': [],
     'remaining': 'Root must ratify pane-qualified identities preserving every fixed and dynamic pane; retain E2 214 fields and pane controls without inventing a new acceptance denominator.'},
    {'id': 'PUI-SETTINGS-003', 'mapsTo': ['PUI-SETTINGS-000', 'E2'],
     'contract': 'Target watcher observes late child mounts, settles once, disconnects on cancel/success/5-second timeout, and no-ops without root/MutationObserver.',
     'sources': ['src/renderer/src/components/settings/settings-deep-link-target-watcher.ts:9-54'],
     'remaining': 'Port watcher tests; actual pane/repo/host/section/intent navigation and target scroll/focus across async mounts.'},
    {'id': 'PUI-KEYS-002', 'mapsTo': ['PUI-KEYS-001', 'E2'],
     'contract': 'Separate shortcut-editor ID retained; source contract in KEYS-001 note does not merge catalog and UI acceptance.', 'sources': [],
     'remaining': 'Recorder, rows, reset/remove/disable, errors and actual key dispatch.'},
    {'id': 'PUI-DROGON-001', 'mapsTo': ['PUI-BOTS-001', 'PUI-MEETINGS-001'],
     'contract': 'DrogonProductSectionPage is a bots/meetings placeholder component with close action; it is not a Bots/Meetings/Mentu parent-tab container. Current AppWorkspaceShell directly mounts BotsPage and MeetingsPage.',
     'sources': ['src/renderer/src/components/drogon/DrogonProductSectionPage.tsx:6-75', 'src/renderer/src/app-shell/AppWorkspaceShell.tsx:70-89'],
     'remaining': 'No import was found by bounded renderer-source name search; absence is not global/history reachability proof. Root decides archival classification; required implemented pages remain.'},
    {'id': 'PUI-CONN-004', 'mapsTo': ['PUI-TABS-001', 'PUI-SETTINGS-000', 'E2', 'E5'],
     'contract': 'Windows/WSL shell settings, launch and CLI registration remain named obligations.', 'sources': [],
     'remaining': 'Coordinate settings selectors and Windows-shell launch/file setup with E2/E5; source names are not actual Windows acceptance.'}
]


DROGON_RESIDUAL = {
    'PUI-BOTS-001': [
        'The old createResponsibility-after-line-60 gap is superseded by coordinator v3 BOT-S-respform and additional owner/automation contracts; do not repeat accepted enumeration.',
        'Execute unchanged historical Bot tests and separate current minimal form, persistence/restart, scheduling/history and real host delegation; reactive adapters remain explicitly foundation/pending scope in delta ledger.'
    ],
    'PUI-MENTU-001': [
        'Accepted v3 covers review/admission/execution/evidence limits. Fresh coalescer read additionally resolves discoveryRequestForScope and recipeLoadRequestForScope bodies: caller-keyed in-flight promises, identity-checked deletion on settle, no cancellation/subscriber ownership API.',
        'Discovery converts capability rejection to unavailable and listRecipes rejection to null; recipe loading propagates its promise result/rejection. Read consumer key construction and stale-response guards before asserting scope equivalence; execute dedup/rejection/cleanup/current-form and actual admission/retry/cancel/restart journeys.'
    ],
    'PUI-MEETINGS-001': [
        'The old unverified Open as Workspace gap is superseded by coordinator v3 MEE-S-source and temporary-file bridge assertions; current folder-mount integration is required behavior.',
        'Actual host-owned persisted mount, default harness delegation, load/action races, protected Escape targets and error retention remain execution/characterization obligations; deeper shared-space design stays distinct from implemented folder mounting.'
    ]
}


def build():
    primary = read_json('parity-ui-capability-cards.json')
    remaining = read_json('parity-ui-remaining-surface-cards.json')
    reconciliation = read_json('parity-ui-surface-reconciliation.json')
    drog = read_json('parity-drogon-ui-state-contracts.json')
    packages = read_json('parity-test-work-packages.json')
    note_by_id = {n['cardId']: n for n in NOTES}
    rows_by_id = {r['id']: r for r in reconciliation['rows']}
    wp = {f['path']: p['id'] for p in packages['packages'] for f in p['files']}
    test_files = {}
    cards = []
    for name, collection in [('parity-ui-capability-cards.json', primary['cards']),
                             ('parity-ui-remaining-surface-cards.json', remaining['cards'])]:
        for card in collection:
            cid = card['id']
            tests = {t['path'] for t in card['originalTests'] if 'path' in t}
            tests.update(t['path'] for t in rows_by_id.get(cid, {}).get('testDeclarationAnchors', []))
            tests.update(t['path'] for t in note_by_id.get(cid, {}).get('assertionEvidence', []))
            if cid in drog['cards']:
                for state in drog['cards'][cid]:
                    tests.update(a['path'] for a in state['assertions'])
            for path in sorted(tests):
                entry = test_files.setdefault(path, {'path': path, 'cardIds': [],
                    'allocation': wp.get(path, 'NOT-IN-EXISTING-WP-MANIFEST'),
                    'tier': 'inherited-test-pointer-hash-verified', 'executedThisDispatch': False,
                    'candidateTestCommand': None})
                entry['cardIds'].append(cid)
                if (SOURCE / path).is_file():
                    entry.update(fingerprint(SOURCE / path))
                    entry['baselineCommandInIsolatedCheckout'] = 'pnpm exec vitest run --config config/vitest.config.ts ' + shlex.quote(path)
                else:
                    entry['missingPath'] = True
            inherited_gaps = card['gaps'] if isinstance(card['gaps'], list) else [card['gaps']]
            cards.append({'id': cid, 'title': card['title'], 'ownerFromExistingCard': card['wpAllocation'],
                'cardEvidence': document_ref(name, '"id": "' + cid + '"'),
                'originalObligationsRetainedAsInheritedNotAssertions': card['obligations'],
                'inheritedGapsVerbatim': inherited_gaps,
                'inheritedMissingInvariants': card['missingInvariants'],
                'priorPointerReconciliationEvidence': document_ref('parity-ui-surface-reconciliation.json', '"id": "'+cid+'"') if cid in rows_by_id else None,
                'priorPointerDebtsRetained': rows_by_id.get(cid, {}).get('perStateDebt', []),
                'sourceCharacterization': note_by_id.get(cid),
                'acceptedDrogonStateIds': [s['id'] for s in drog['cards'].get(cid, [])],
                'acceptedStateEvidence': document_ref('parity-drogon-ui-state-contracts.json', '"'+cid+'"') if cid in drog['cards'] else None,
                'sourceTestPaths': sorted(tests), 'renderedStatesRetained': card['screenshotStatesNeeded'],
                'classification': 'accepted-bounded-Drogon-states-reused' if cid in drog['cards'] else 'fresh-bounded-source-reconciliation' if cid in note_by_id else 'inherited-open-semantics-preserved',
                'enumerationClosed': False, 'renderedAcceptance': 'not-executed',
                'remainingObligations': DROGON_RESIDUAL.get(cid, note_by_id.get(cid, {}).get('remainingAcceptance', inherited_gaps))})
    for n in NOTES:
        for evidence in n['assertionEvidence']:
            test_files[evidence['path']]['tier'] = 'selected-assertion-bodies-read'
            test_files[evidence['path']]['reviewedRanges'] = evidence['reviewedRanges']
    supplements = []
    for s in SUPPLEMENTAL:
        supplements.append({**s, 'evidence': document_ref('parity-ui-audit.md', s['id']),
                            'sourceEvidence': [source_ref(p) for p in s['sources']],
                            'enumerationClosed': False, 'executed': False})
    card_ids = {c['id'] for c in cards}
    all_named = set()
    for name in ['parity-ui-audit.md', 'parity-ui-journeys.md']:
        all_named.update(re.findall(r'PUI-[A-Z]+-\d+', (MIGRATION / name).read_text()))
    omissions = sorted(all_named - card_ids - {s['id'] for s in supplements})
    assert len(cards) == 42 and len(card_ids) == 42 and not omissions
    assert len(NOTES) == 14 and sum(len(c['missingInvariants']) for c in remaining['cards']) == 19
    assert sum(map(len, drog['cards'].values())) == 45
    state_hash_checks = []
    for path, expected in drog['files'].items():
        actual = fingerprint(SOURCE / path)
        state_hash_checks.append({'path': path, 'expectedSha256': expected['sha256'], **actual,
                                 'matches': actual['sha256'] == expected['sha256']})
    assert all(c['matches'] for c in state_hash_checks)
    journeys = []
    lines = (MIGRATION / 'parity-ui-journeys.md').read_text().splitlines()
    headings = [(i, line) for i, line in enumerate(lines, 1) if line.startswith('## ')]
    for index, (start, title) in enumerate(headings):
        end = headings[index+1][0]-1 if index+1 < len(headings) else len(lines)
        body = '\n'.join(lines[start-1:end])
        ids = sorted(set(re.findall(r'PUI-[A-Z]+-\d+', body)))
        journeys.append({'section': title, 'start': start, 'end': end, 'cardIds': ids,
                         'unmappedIds': sorted(set(ids)-card_ids),
                         'screenshotTokensVerbatim': sorted(set(re.findall(r'SHOT-[A-Za-z0-9.<>,_-]+', body))),
                         'status': 'mapped-not-executed; hypotheses remain subject to source corrections'})
    inputs = [document_ref(name) for name in [
        'parity-ui-audit.md', 'parity-ui-capability-cards.json', 'parity-ui-capability-cards.md',
        'parity-ui-remaining-surface-cards.json', 'parity-ui-remaining-surface-cards.md',
        'parity-ui-surface-reconciliation.json', 'parity-ui-surface-reconciliation.md',
        'parity-ui-evidence-corrections.json', 'parity-ui-evidence-corrections.md',
        'parity-ui-journeys.md', 'parity-drogon-delta-audit.md',
        'parity-drogon-ui-state-contracts.json', 'parity-drogon-ui-state-contracts.md',
        'parity-test-work-packages.json', 'parity-audit-gate-ledger.json', 'audit-progress.md',
        'audit-closure-coordination.md']]
    invariant_map = []
    for card in remaining['cards']:
        for index, invariant in enumerate(card['missingInvariants']):
            invariant_map.append({'input': document_ref('parity-ui-remaining-surface-cards.json', '"id": "'+card['id']+'"'),
                'cardId': card['id'], 'invariantIndex': index,
                'inheritedObligation': invariant['obligation'],
                'inheritedExpectation': invariant['invariant'],
                'reconciliation': note_by_id[card['id']]['correction'],
                'sourceContract': note_by_id[card['id']]['contract'],
                'sourceEvidence': note_by_id[card['id']]['sourceEvidence'],
                'remainingTests': note_by_id[card['id']]['remainingAcceptance'],
                'status': 'expectation-corrected-with-open-per-domain-enumeration' if card['id']=='PUI-WEBMODE-001' else 'bounded-source-characterized-further-acceptance-explicit',
                'executed': False})
    package_refs = [{'id': p['id'], 'fileCount': p['fileCount'], 'testPortBoundary': p.get('testPortBoundary'),
                     'evidence': document_ref('parity-test-work-packages.json', '"id": "'+p['id']+'"'),
                     'status': 'accepted-M1-allocation-reused-not-recensused'}
                    for p in packages['packages'] if p['id'].startswith('WP-UI-')]
    closure = {'schema': 'drogon.audit-closure.e1-ui/1', 'groupId': 'E1',
        'sourceRevision': REVISION, 'sourceRoot': str(SOURCE), 'sourceMode': 'read-only',
        'proposedDisposition': 'open', 'auditClosed': False,
        'scope': 'Complete reconciliation of supplied named cards/IDs/remaining obligations; bounded source review, not exhaustive renderer behavior closure.',
        'lifecycle': {'taskId': 'task_671da369fc93', 'dispatchId': 'ctx_2b1bbe519b1c',
            'runId': 'run_97a755fdd5dd', 'requestedModel': 'gpt-6-astra', 'requestedEffort': 'high',
            'effectiveModel': None, 'modelEvidence': 'Root owns provenance; reused-terminal worker receipt has null requested/effective launch metadata, live Codex terminal and ready/input_accepted verified.',
            'depth': 1, 'maxDepth': 1, 'canDispatchSubWorkers': False,
            'depthEvidence': 'dispatch-show depth=1; root message msg_d03920a4b7d8 reports persisted max=1 and prohibits child launch pending root revalidation.',
            'injectedMaxDepth': None, 'injectedCanDispatchSubWorkers': None,
            'children': [], 'depthDenialCommandAttempted': False,
            'limitation': 'No child launched, no nesting bypass, no child resources to settle/release.'},
        'progress': {'estimatePercent': 60, 'confidence': 'medium-low', 'acceptedGroups': 7,
            'denominatorGroups': 12, 'closedGroupDelta': 0,
            'nextMilestone': 'Root reviews this candidate and assigns still-open semantic blocks.',
            'deadline': '24-hour target flexible per root; full fidelity remains higher priority; no product ETA inferred from audit mapping.'},
        'counts': {'inputCardRecords': 42, 'freshRemainingCardNotes': 14,
            'inheritedRemainingInvariantsRetained': 19, 'supplementalNamedIds': 8,
            'namedIdsReconciled': len(card_ids | {s['id'] for s in supplements}),
            'unmappedNamedIds': len(omissions), 'drogonStatesRetained': 45,
            'drogonSourceFingerprintsMatched': len(state_hash_checks), 'referencedSourceTestFiles': len(test_files),
            'executedTests': 0, 'newRenderedCaptures': 0, 'acceptedGroupsClosed': 0},
        'inputs': inputs, 'cards': cards, 'supplementalNamedSurfaces': supplements,
        'inputOmissionMap': reconciliation['scopeMap'],
        'remainingInvariantReconciliation': invariant_map,
        'fullUiTestAllocationReferences': package_refs,
        'additionalMentuCoalescerEvidence': source_ref('src/renderer/src/components/mentu/mentu-session-request-coalescer.ts:15-105'),
        'unassignedNamedSurface': {'name': 'ActivityPrototypePage', 'evidence': source_ref('src/renderer/src/app-shell/AppWorkspaceShell.tsx:70-89'),
            'status': 'route-mounted-by-activeView; controller entry/reachability/behavior requires source review; no new global capability ID invented',
            'ownerNeeded': 'Root/WP-UI-WORK; retain sidebar agent activity and page relationship'},
        'settingsRangeAmbiguity': 'PUI-SETTINGS-001..035 collides with explicit SETTINGS-002 search/003 deep links; preserve 35-pane taxonomy and dynamic panes via SETTINGS-000/E2, do not silently expand duplicate IDs.',
        'journeyEvidence': document_ref('parity-ui-journeys.md'), 'journeys': journeys,
        'drogonStateFingerprintChecks': state_hash_checks,
        'drogonPrecedence': ['UI-C01-C11 plus coordinator state v3 supersede old implemented+proven prose in delta audit.',
            'Preserve two historical Bot test conflicts separately from current minimal form, never restore stale overwritten purpose or skip assertions.',
            '19 Bots/16 Mentu/10 Meetings state IDs remain required; accepted fingerprint reuse is not another census or test run.',
            'Mentu coalescing/loading bodies now separately source-read; do not conflate caller-keyed in-flight caching with cancellation isolation, consumer identity correctness, evidence restoration or backend approval coalescing.',
            'Reactive Bot adapter/delegation integration, deeper meeting shared spaces, Qwen comparison and packaging drafts retain their existing planned/foundation/dependency statuses; already-implemented behavior is never moved to postmigration.'],
        'testManifest': sorted(test_files.values(), key=lambda t:t['path']),
        'executionDebt': ['T1: isolated original baseline using reviewed pinned native runtime/config; report drift/skips/setup failures honestly.',
            'T2: port complete source assertions per existing M1/M7/WP allocation; sourceTestPaths here are cited E1 evidence, not the whole UI suite denominator.',
            'T3: behavioral candidate RED then GREEN; candidate per-test paths/commands must be ratified before feature work.',
            'T4: original and candidate rendered journeys, light/dark/narrow layouts, OS/SSH/folder/version-skew/permissions/restart/recovery/performance.',
            'Packaged-app test and latest accepted installed preview remain coordinator handoff obligations; no app/profile/service touched here.'],
        'enumerationStillOpen': ['Per-domain web factories/callers and fallback-visible-state reconciliation; synthetic API existence is not implementation.',
            'Remaining inherited semantic gaps in non-Drogon cards (source control, PR, accounts, browser, native chat, automations, tasks, editor, drag/floating, shell and others) are retained individually in cards[].',
            'Supplemental shell/global shortcuts/deep links/Windows and ambiguous pane identities need explicit central linkage; Activity route needs ownership/reachability characterization.',
            'Selected file explorer mutation/virtualization, quick-command partitioning, runtime host-attachment controller and other remainingAcceptance source gaps are not converted into execution-only debt.'],
        'omissionsAndLimits': ['No M1-M7 census repeated; complete means all finite supplied card/ID references reconciled, not all renderer functions read.',
            'Only explicit reviewedRanges were semantically inspected this dispatch; all other test/source pointers retain inherited tier even when their hash was verified.',
            'No global absence-of-tests assertion follows from filename search. Partial searches and file reads are not assertion coverage.',
            'Original source tests are not executed; no source module imported or evaluated; no installs/services/Git mutations.',
            'Three existing light empty-state screenshots remain reference-only, not execution acceptance or per-state evidence.'],
        'futureAcceptanceCommands': {'workingDirectory': 'Coordinator-prepared isolated copy of pinned original, never the read-only reference or personal profile',
            'unit': 'Use each testManifest baselineCommandInIsolatedCheckout after native runtime/environment prerequisite gate; do not run repository pnpm test implicitly because it prepares native runtime.',
            'rendered': ['pnpm exec playwright test tests/e2e/golden-quit-relaunch-session.spec.ts --config tests/playwright.config.ts --project electron-headless --workers=1',
                         'pnpm exec playwright test tests/e2e/golden-source-control-commit.spec.ts --config tests/playwright.config.ts --project electron-headless --workers=1'],
            'candidate': 'Not yet assigned; coordinator must map unchanged source assertions to actual candidate runner before feature dispatch.',
            'prohibition': 'Listed commands are future execution requirements, not permission to operate personal Orca or execute frozen inputs.'}}
    assert len(invariant_map) == 19
    (OUT / 'closure.json').write_text(json.dumps(closure, indent=2, ensure_ascii=False)+'\n')
    render_report(closure)
    print(json.dumps({'counts': closure['counts'], 'missingTestPaths': [t['path'] for t in test_files.values() if t.get('missingPath')],
                      'unallocatedTests': [t['path'] for t in test_files.values() if t['allocation']=='NOT-IN-EXISTING-WP-MANIFEST']}))


def render_report(c):
    lines = ['# E1 UI reconciliation — candidate remains open', '',
        'Pinned source: `'+REVISION+'` (read-only). Lead Task `task_671da369fc93`, Dispatch `ctx_2b1bbe519b1c`.', '',
        '**Proposed disposition: open.** All 42 supplied card records and eight additional named IDs are linked below, including all 19 remaining-card invariants and the accepted 45 Bots/Mentu/Meetings states. This closes no accepted audit group: important semantic obligations remain beyond absent screenshots. No tests or app were executed.', '',
        'Audit orientation remains approximately 60%, medium-low confidence, 7/12 accepted groups, delta 0. The next milestone is root review and allocation of the finite residual source blocks. The 24-hour target is flexible; no product/test-migration percentage is inferred from this mapping.', '',
        '## Runtime and authority', '',
        'Requested launch was gpt-6-astra/high. Live worker inspection proved Codex, ready/input_accepted, depth 1; reused-terminal launch metadata does not authenticate effective model. Root owns model provenance. Preamble omitted maxDepth/canDispatchSubWorkers; root message `msg_d03920a4b7d8` supplied max=1 and instructed no children until revalidation. No child was launched, no denial bypassed, and no child requires release.', '',
        '## Completeness and precedence', '',
        '- The 42-card union alone omits SHELL-001/003, TERM-003, SETTINGS-001/003, KEYS-002, DROGON-001 and CONN-004. All 50 named IDs are accounted for; this is an ID map, not 50 accepted capabilities.',
        '- SETTINGS-001..035 is an ambiguous pane-range proposal, overlapping the explicit search/deep-link IDs. Preserve the fixed/dynamic pane topology through SETTINGS-000/E2; root must ratify unambiguous pane identities.',
        '- ActivityPrototypePage is mounted by activeView in AppWorkspaceShell:78 and needs explicit ownership/reachability characterization. It is not silently removed because its name says Prototype.',
        '- Coordinator state v3 and UI-C01–C11 supersede old delta-audit proof claims. All 42 source fingerprints in that accepted package match; its 45 states remain 19 Bots, 16 Mentu, 10 Meetings, with zero new execution receipts. Old Bot createResponsibility and meeting-mount enumeration gaps are explicitly superseded, not assigned again.',
        '- A separate fresh read of mentu-session-request-coalescer.ts:15-105 resolves the two old unreviewed exports: caller-keyed in-flight promises, identity-checked deletion on either settlement; discovery maps API rejection to unavailable/null, load propagates its promise. No cancellation/subscriber isolation is implemented in that module. Consumer key and stale-response behavior still require their own tests.',
        '- The manifest references '+str(c['counts']['referencedSourceTestFiles'])+' concrete source test files and reuses their existing work-package allocation. It is a cited-evidence manifest, not a repeat of M1 or a replacement for the full UI suite.', '',
        '## Fresh reconciliation of all 14 remaining cards', '']
    for n in NOTES:
        lines += ['### '+n['cardId'], '', n['contract'], '', '**Correction/limit:** '+n['correction'], '',
                  '**Source:** '+ '; '.join('`'+e['path']+':'+','.join(str(r['start'])+'-'+str(r['end']) for r in e['reviewedRanges'])+'`' for e in n['sourceEvidence'])+'.', '',
                  '**Still required:** '+' '.join(n['remainingAcceptance']), '']
        if n['assertionEvidence']:
            lines += ['**Selected assertion bodies read, not run:** '+ '; '.join('`'+e['path']+':'+','.join(str(r['start'])+'-'+str(r['end']) for r in e['reviewedRanges'])+'`' for e in n['assertionEvidence'])+'.', '']
    lines += ['## Complete card ledger', '', '| ID | Evidence disposition | Input anchor |', '| --- | --- | --- |']
    for r in c['cards']:
        e=r['cardEvidence'];lines.append('| '+r['id']+' | '+r['classification']+' | `'+e['path']+':'+str(e['line'])+'` |')
    lines += ['', 'Every card retains its original obligations, gaps, missing invariants, test paths, owner and rendered states in closure.json. Its 19-row remainingInvariantReconciliation maps each original obligation independently; fullUiTestAllocationReferences points to all existing UI package manifests without recensus. Inherited claims remain inherited until the fresh correction or accepted v3 contract specifically supersedes them. No blanket all-state closure is claimed.', '', '## Supplemental IDs retained', '']
    for s in c['supplementalNamedSurfaces']:
        lines += ['- **'+s['id']+'** → '+', '.join(s['mapsTo'])+'. '+s['contract']+' Remaining: '+s['remaining']]
    lines += ['', '## Source-enumeration debt versus execution debt', '',
        'E1 stays open because web-domain semantics, inherited non-Drogon card gaps, supplemental identities/activity routing and the explicit remaining source seams still require characterization. Missing screenshot/runtime receipts alone are not reasons to call a known source behavior unenumerated.', '',
        'All original journey sections are mapped in closure.json with line windows, card IDs and unchanged screenshot tokens. Preserve light/dark/narrow and OS/host variants; three prior light empty-state captures do not establish those journeys. Bot legacy test drift must retain unchanged baseline receipts alongside current minimal-form tests. Mentu mocks/record-derived liveness, meeting platform overrides and in-memory stores remain bounded evidence.', '',
        'Execution proceeds only in coordinator-prepared isolated checkouts. closure.json supplies an exact pinned-config Vitest command for every cited file and future Playwright commands; candidate commands remain unassigned until real source-to-candidate ports exist. Native runtime preparation is a prerequisite, compile/setup errors are not RED, skips are not PASS, and the full M1/M7 suite remains mandatory.', '',
        '## Artifact verification', '',
        '`build-reconciliation.py` regenerates only this directory. It checks the 42-card set, all 50 named IDs, all 19 inherited remaining invariants, 45 accepted Drogon states and 42 matching fingerprints; closure.json contains full SHA-256, source reviewed ranges, document anchors, complete residual lists and execution limits. This is metadata validation, not product testing. Root independently reviews before changing central ledgers.', '']
    (OUT/'report.md').write_text('\n'.join(lines))


if __name__ == '__main__':
    build()
