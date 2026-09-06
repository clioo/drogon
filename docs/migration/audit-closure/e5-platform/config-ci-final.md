# E5 configuration, CI and infra entry-source reconciliation

Candidate resolution of **O-CONFIG-CI and O-INFRA-OPS**, for root review. This completes the finite entry-source assignment: 52 remaining workflow bodies, six reused workflow contracts, all 18 named infra/ops paths, and the inherited configuration/runner allocations. It does not accept E5, establish source baseline results, migrate tests or prove candidate parity.

Source: `/Users/carlos/Documents/Drogon-mentu-session`, root-pinned revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only. The machine companion [config-ci-final.json](config-ci-final.json) contains canonical IDs, exact paths, full-file SHA256, inclusive workflow/job ranges and their hashes, triggers, permissions, concurrency, runner/version/identity roles, artifacts, real assertion associations and exact remaining cases. Hashes establish which bytes were reviewed; the behavioral account below comes from reading bodies.

Root progress remains **75% = 9/12 accepted audit groups, delta 0 percentage points**. Confidence is high in this finite entry reconciliation; execution confidence is not inferred. Next milestone is root review alongside concurrent E5 service and asset evidence. The 24-hour deadline risk remains unchanged: real OS/native/cloud/SSH baselines, faithful ports and candidate acceptance are still outstanding.

## Canonical scope and subtraction

`followup-remaining-platform.json#/sourceOmissions` supplies the exact 22 cloud workflow paths and 18 infra/ops paths. CI01–CI22 preserve the cloud list's order; CI23–CI52 cover the remaining desktop/mobile/general workflows. The inherited 58-workflow allocation is reconciled as 52 newly reviewed bodies plus six reused actual contracts, not accepted because a directory contains 58 files.

| Reused workflow | Existing contract |
| --- | --- |
| [.github/workflows/cloud-deploy-relay-fence-broker.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-fence-broker.yml:1) | followup-remaining-platform RP-C4 |
| [.github/workflows/cloud-power-relay-staging.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-power-relay-staging.yml:1) | followup-remaining-platform RP-C4 |
| [.github/workflows/cloud-requeue-relay-staging-c4-recovery.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-requeue-relay-staging-c4-recovery.yml:1) | followup-remaining-platform RP-C4 |
| [.github/workflows/release-cut.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/release-cut.yml:1) | initial report E-CI plus followup-release-entrypoints R1–R4 |
| [.github/workflows/release-mac-build.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/release-mac-build.yml:1) | initial report E-CI plus followup-release-entrypoints R1–R4 |
| [.github/workflows/homebrew-bump.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/homebrew-bump.yml:1) | initial report E-CI plus followup-release-entrypoints R1–R4 |

CFG01–CFG28 characterize configuration consumers and finite entry boundaries. RUN01–RUN13, plus root package CFG01 and root Vitest CFG10, reconcile all 15 WP-SUP-CONFIG entries. Build plugins/target driver reuse B1/B2, packaged runtime modules reuse the initial M3 full-body review, NSIS reuses E-NSIS, and builder reuse remains limited to the previously reviewed selection/packaging contracts. Existing area reports and central ledgers are unchanged.

Documentation, large reliability catalogs, ratchet inputs, patch payloads and generated TypeScript caches are explicitly different evidence tiers. The large reliability manifest is preserved and hashed as data; its checker was read, without reopening every feature gate. Patch paths are joined to their pnpm or regeneration consumer, without claiming that patch-name/hash inspection proves terminal behavior. Root package/workflow calls retain their original implementation owners; this audit does not recursively enumerate the 454 scripts or every import.

## Material findings and source limits

- CI13's clock-skew loop covers the first 22 production cells while INF11 declares 29. Preserve this source gap; seven later cells are not proven by that workflow.
- Capacity plan exit 0 can still lead to singleton VM recreation. Same-cap cleanup restores admission best-effort and does not undo an image change. Explicit recover/resume modes have their own evidence gates, including fixed historical tuples in capacity recovery.
- Mutation workflows distinguish monitor artifact provenance, consumed markers and live recheck. A failed mutation can leave its marker consumed; an uploaded failure artifact or monitor segment exit 0 is not a completed safety window.
- Several release/dev jobs publish before downstream E2E dispatch or validation finishes. Daily dispatch exhaustion can become a warning; golden commands using `--if-present`, skipped jobs, advisory versions and partial test selectors must remain visible.
- The incident Google reader refuses pagination, while the dashboard metric/alert reader has no corresponding pagination refusal. Dashboard missing values may become summary zero, and stale last-good fallback may cross requested windows. These are display behaviors, not health authority.
- Supplied admin tokens are syntactically checked and passed through; token verification is a provider/service seam. Gcloud token cache TTL is not JWT-expiry validation.
- Root typecheck excludes E2E despite an E2E config existing. Root tests ensure native Node ABI; CLI builds install a development launcher. No such commands were run in this audit.
- Native patch entries retain a deliberate Windows desktop/relay teardown divergence and a documented natural-exit leak. Historical source measurements are not new execution evidence. POSIX entry can return `patched-unverified`, and some operations can escape its stated never-throws intent.

## Workflow body contracts

Every row below has a full-file anchor. The JSON adds per-job inclusive range hashes and exact structured trigger/ref/permissions/concurrency/input/action-version/artifact metadata. The summary characterizes actual inline behavior and names downstream script seams; action versions or search hits alone are not evidence of effects. Each CI ID also has an exact future refusal/failure/rollback test matrix in `executionDebt.exactDiscriminatingCases`.

### CI01 — [.github/workflows/cloud-deploy-relay-production.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production.yml:1)

Manual/main/operations-enabled production candidate gate; actions+contents read and OIDC write, shared noncancelling production SQL rollout group. Audit/preflight avoid evidence consumption; every mutation requires numeric exact monitor run+attempt, download private artifact, verify commit/mode before auth, reject existing consumed marker, OIDC deployment identity, lease, exact per-mode confirmation, topology output and fresh selector/live-preflight checks. Upload90-day single-use marker before candidate script; marker/upload failure refuses later mutation, later mutation failure leaves marker consumed. No workflow rollback; resume/recover are explicit modes, downstream candidate script owns actual evacuation.

Remaining tests: Wrong ref/flag/confirmation/digest/attempt or stale/consumed evidence must block before mutation; inject marker race/upload and post-consumption failure; verify no audit/preflight mutation and preserve script seam.

### CI02 — [.github/workflows/cloud-deploy-relay-production-director.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production-director.yml:1)

Manual operations-enabled production OIDC deployment; unlike candidate job, no explicit main-ref predicate in this workflow (trust policy must constrain source). Immutable lowercase digest is registry-verified; booleans, nonnegative rehome generation and service-account shape checked. Bootstrap identity, prune, or disable require distinct exact confirmations; bootstrap forbids prune/placement change, prune requires preserve, ordinary preserve/enable rejects stray confirmation. Require singleton100% serving revision, healthy inherited minimum floor and exact ceiling before deploy. Read served placement secret version, preserve fallback to latest only, add new secret version on change, invoke blue-green with expected rehome generation/identities/digest/scaling, then require singleton served digest, exact secret/version/value and floor/ceiling, smoke service. Shared noncancelling SQL lease; no workflow rollback block; secret version mutation may precede failed script.

Remaining tests: Ref trust negative fixtures; malformed digest/generation/identity; degraded floor/multiple revisions; each confirmation matrix; failed secret version/deploy/postcheck and explicit downstream rollback ownership.

### CI03 — [.github/workflows/cloud-deploy-relay-production-multi-target.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production-multi-target.yml:1)

Manual main/operations-enabled production gate and noncancelling SQL-rollout concurrency/lease. Listed modes distinguish read-only audit/preflight, selector admission changes, execute/recover and private-broker fence/supersede. Direct-runner abort branch explicitly refuses even though abort not offered as an input choice. Execute/recover/fence require exact fresh monitor run/attempt, commit-bound restored artifact and consumption marker; admission mutations and supersede bypass that evidence family but have own confirmation/selector/broker contracts. Fence/supersede require broker environment and provisioned exact-cell allowlist, operation ID shape, coherent optional lease generation/ID/digest; completed-fence recovery requires UUID/40hex commit/operation/state serial/object generations/SHA and a lease. Supersede skips ordinary deploy auth/topology; broker OIDC token uses its own identity/audience, POST max1790s carries explicit v1 payload. Others invoke multi-target deployment script with owner/topology, selector, ceiling1000 and minimum lease600000ms. No workflow rollback, marker persists after downstream failure.

Remaining tests: Per-mode input/confirmation/evidence bypass matrix, malformed optional lease tuple, forbidden cell set/direct abort, private token audience, stale/fenced attempt, marker race and broker/network timeout; downstream mutation internals separately owned.

### CI04 — [.github/workflows/cloud-deploy-relay-production-same-cap.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production-same-cap.yml:1)

Manual main+operations gate10m, production, Node24; verify/canary-apply/batch-apply/rollback validates ordered cell wave and exact image/confirmation contract. Batch downloads exact prior canary authority and verifies current commit/run/digests/selector/rehome generation. Nonverify consumes one aggregate monitor marker90days after positive run/attempt and absence check. Up to4 reusable same-cap jobs execute sequentially; later cells require preceding success, apply modes normalized, exact state memberships/protocols/generations/evidence and wave index forwarded with inherited secrets. Successful canary seals30-day authority only after cell1; always release_lease10m with deployment identity, independently of gate/cell results. Rollback is explicit mode, no whole-wave automatic undo.

Remaining tests: Canary and2-4-cell wave validation, prior commit/digest/generation mismatch, marker race, single later-cell failure halts subsequent cells, canary artifact failure, always-release failure, verify no mutation and rollback isolation.

### CI05 — [.github/workflows/cloud-deploy-relay-production-same-cap-job.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production-same-cap-job.yml:1)

Reusable main-only75m production cell rollout, caller concurrency. Verify/apply/rollback with distinct immutable digests, protocol0/1, nonnegative exact generations, waveindex0..3; effective selector offsets2 per prior cell, mutation reruns refused. Exact monitor authority and current-run aggregate marker required; deploy OIDC+SQL lease, preflight, rehome disabled/exact selector, topology cap1000 or3000/bound60 and immutable image registry check. Rollback accepts already-restored image only in migration-only admission, retains same incarnation on resume; ordinary apply verifies predecessor then isolates/drains with authoritative selector generation and restart-safe activity. Separate capacity identity targets only selected template+MIG, validates plan before apply; resume permits zero changes or validated two-resource rollback-image drift but applies nothing. Fresh post-deploy identity verifies image/protocol/cap/incarnation and disabled rehome, protocol1 per-host trust probe, then restores only selected cell and exact memberships. Failure cleanup best-effort continue-on-error isolates only after MUTATION_STARTED; no automatic image rollback, explicit rollback can resume.

Remaining tests: Selector no-op generation versus offset, stale marker/single-run refusal, legacy missing region/protocol normalization only US/protocol0, rollback image-already-restored/no-restart, plan forbidden changes, post-activation failure isolates, cleanup failure remains failed/isolated-unverifiable; no deployment executed.

### CI06 — [.github/workflows/cloud-deploy-relay-production-capacity.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production-capacity.yml:1)

Manual verify/apply/rollback/wave-apply/wave-resume. Single reusable job gated operations flag without wrapper main check; resume/wave gate explicitly main. Wave30m validates ordered2-4 cells and exact confirmation, restored commit/run/attempt evidence before auth, absence marker, deployment OIDC and persistent SQL lease. Rechecks live selector/preflight and every selected cell against600/60 predecessor bounds, fresh heartbeat/general admission/no drain and pinned predecessor/compatible images; publishes90-day consumed marker before sequential reusable capacity jobs with continuation indices and fixed raise-to1000 confirmation. Resume forwards exact failed wave run with resume evidence mode. Always10m release job depends on all alternatives; no rollback of already successful wave cells, explicit rollback mode delegated.

Remaining tests: Each mode/ref/flag combination incl single wrapper versus reusable main gate; wave membership and predecessor checks, stale/consumed monitor, failed-cell halt, failed-run resume lineage and always release.

### CI07 — [.github/workflows/cloud-deploy-relay-production-capacity-job.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-production-capacity-job.yml:1)

Reusable main-only75m production; exact single/continuation/resume matrix, no own concurrency. Apply requires exact monitor lineage; resume additionally hardcodes three reviewed historical run/commit/attempt/wave tuples (not a general retry capability). Single rejects prior marker; continuation/current-run and resume/failed-run authority markers checked. OIDC deploy plus SQL lease and distinct exact apply/rollback/resume confirmations. Selected16-cell allowlist, desired cap1000 or rollback600/bound60, digest and MIG shape; singleton100% director/image/topology classified, wave predecessor required. Apply live preflight and90d marker; verify observational. Mutation isolate/drain, failed drain allows offline rollback only with stale heartbeat/migration-only/restart-safe/unavailable runtime. 450s restart gate retries only exact one-line timeout shape with refreshed token. Director topology update if not already ready then capacity identity validates targeted template+MIG plan0..2 changes; zero changes still recreates exact singleton running instance, so no-op plan is not no-op workflow. Fresh cap/image/admission check before activate; postfailure best-effort isolate AND drain after armed flag. No automatic image/cap rollback; explicit rollback and historical resume remain operational debt.

Remaining tests: Forbidden invocation tuples/historical resume lineage, incompatible director/cell digest/topology, stale evidence/marker, timeout-only retry discrimination, offline rollback positive/negative, zero-plan recreate, activation/postcheck failure, cleanup partial failure and lease-owner release.

### CI08 — [.github/workflows/cloud-deploy-relay-staging.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-staging.yml:1)

Manual ops-enabled staging, noncancel staging mutation group, OIDC deployment identity/SQL lease; no workflow main guard. Terraform1.15.8 binds supplied lowercase digest to checked-in selected staging cell image and mirrored registry digest. Node24 blue-green director passes capacity/proof identities, numeric latest placement-secret version and min0/max2; smoke served URL. No build or image selection fallback; script owns rollback.

Remaining tests: Wrong request/cell/registry digest, missing secret numericversion/identity, stage trust refusal, deploy/smoke failure.

### CI09 — [.github/workflows/cloud-deploy-relay-staging-gce-candidate.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-staging-gce-candidate.yml:1)

Manual ops-enabled staging candidate preflight(default)/reset-empty-candidate/execute, shared noncancel staging mutation group. OIDC admin identity and SQL lease precede exact RESET_CANDIDATE/EVACUATE confirmation. Terraform topology output and runtime identity then Node24 candidate script with exact source,target,mode/admin audience. Distinct-cell and reset-empty guarantees belong script seam, no workflow fallback/rollback.

Remaining tests: Wrong confirmation/source-target/topology, preflight side-effect boundary, downstream refusal/partialfailure.

### CI10 — [.github/workflows/cloud-deploy-relay-asia-topology.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-deploy-relay-asia-topology.yml:1)

Manual main+opsflag30m stage/prod topology, environment-specific noncancel mutation group; exact reviewed cellset1stage/3prod and environment registrydigest, plan(emptyconfirmation)/apply(exactconfirmation) before topologyOIDC. Terraform1.15.8 SQLlease; localconnectionbudget within bound and productionlive explicit maxflag or exact reviewed DBshape default400 (staging deliberatelydoesnotreadliveSQL). Savedplan targets only additiveAsia subnet/router/NAT,URLmap and selectedtemplate/MIG/backend; input+planvalidator seams, plansha summary, applyexactvalidatedplan and readbackzerochanges. Emits required migration-only registration before directoradvertisement; rollbackdefinedasadmissionisolation, no networkdestroy.

Remaining tests: Wrongenv/cell/image/confirm, SQLflagduplicate/shapechange/budget, forbiddenplantarget ornonconvergence, no secret/runtimevalue transfer; actual deploymentinternals separate.

### CI11 — [.github/workflows/cloud-monitor-relay-production.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-monitor-relay-production.yml:1)

Manual ops-enabled reusable monitor caller, noncancel production SQL group; inputs dry-run/monitor, exact selector generation/memberships and strict/recover-forward/capacity-transition migration policy with source/capacity cell. contents/actions read and OIDC write forwarded; no own body/ref/timeout, reusable job owns actual monitor/evidence.

Remaining tests: Input propagation, reusable main constraint and monitor failure/artifact handling.

### CI12 — [.github/workflows/cloud-monitor-relay-production-job.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-monitor-relay-production-job.yml:1)

Reusable main-only100m production monitor, Node24 frozen cloud install, monitor OIDC audience token. Retry restores exact previous attempt artifact and verifies commit/mode provenance before auth then adds restart. Dry-run15m/60s; monitor90m split at45samples to refresh token, remainingwindow restart. JWT shape check not cryptographic audience verification by itself. Always seal run/attempt/commit provenance, append aggregate summary or failed-before-first-checkpoint message, upload14d private evidence with missingfileserror; failure artifacts not success evidence. No mutation/rollback in monitor entry beyond local outputs.

Remaining tests: Restart mismatch/expired auth, 45sample segment/restart window, interrupted firstcheckpoint, sealing/upload failure and dryrun versus failedmonitor authority.

### CI13 — [.github/workflows/cloud-monitor-relay-clock-skew.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-monitor-relay-clock-skew.yml:1)

Manual/hourly minute17 ops-enabled Ubuntu, contentsread only, no concurrency/auth. Curl health with8s timeout loops hardcoded first22 cells; judges Date only HTTP200, floors seconds and alarms absolute>=2. Nonserving counted/skipped, zero serving fails, any skew fails. Scope defect: production29 declared cells versus loop22 leaves later7 unmonitored; no mutation or rollback.

Remaining tests: HTTPnon200/date missing/zero-serving/skewthreshold/parsing; explicit intended correction for stale22 bound distinct from preserved sourcebehavior.

### CI14 — [.github/workflows/cloud-operate-relay-production-rehome.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-operate-relay-production-rehome.yml:1)

Manual ops-enabled wrapper for inspect/enable/pause/disable, shared noncancel production SQL concurrency, actions/contentsread OIDCwrite. Forwards exact serving/rollbackdigests, selector/control generations and memberships, notbefore/rate/preferenceage/draingrace, monitorrunattempt and confirmation with inheritedsecrets. Reusable main guard and effectbody own acceptance; wrapper itself no mutation.

Remaining tests: Exact field forwarding and mode-specific validation in reusable; no wrappermain predicate.

### CI15 — [.github/workflows/cloud-operate-relay-production-rehome-job.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-operate-relay-production-rehome-job.yml:1)

Reusable main-only30m production, Node24 deployOIDC; inspect/enable require serving+rollback digests/runtime identity while pause/disable require exact generation+confirmation and mutate BEFORE diagnostic setup/SQL lease. Enable exact rate10/positive notbefore, fresh strict monitor authority/unused marker, singleton100% serving and rollback-tag revisions exactimage/SA/rehomeaudience. Collect25h max30000 aggregate logs, seal/verify24h evidence withcommit/digest/generations,90d artifact, live preflight and90d consumptionmarker before durableenable. Allmodes read15m aggregate completion/abort andsummary. Failed enable withsuccessfulauth invokes recover-enable requiringdisabled readback (can fail); emergency pause/disable are intentionally independent of install/diagnostic success.

Remaining tests: Emergency command succeeds but diagnostics fail; auth audience/rollbacktag/24h clippedlogs; markerconsumed-beforefailed-enable; recover-enable generationconflict and failure; no implicit undo of pause/disable.

### CI16 — [.github/workflows/cloud-operate-relay-asia-admission.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-operate-relay-asia-admission.yml:1)

Manual main+opsflag30m stage/prod noncancel admission, Node24. Inputmatrix inspect requires emptygenerations/attempt/confirm; initialize gen0+64hexmembership+uniqueattempt/exactconfirm; verify/configure/register/promote/rollback distinct emptiness/digest/confirm contracts. Productionpromotion wave1requiresstaging evidence, wave2requiresfirstcanary; exactrun/attempt API+success/provenance/evidencevalidator beforeOIDC, sourceevidencecommit extractedfromrun ratherthan implicitlycurrentcommit. Promote verifiesdirectorimage; lease only configure orfirstprodcanary. Generation-bound scriptoperation sanitized7d resultartifact. Firstprodcell runs5m realcontrol+splice with2leasehorizons, collects timebounded20klogs after60s delay, seals7d evidence. Always recover-promotion then generation-bound rollback to migration-only ifcanary uploadnotsuccess, including ambiguouslyfailedpromote. Configure requiresregisteredmigrationonly, singletondirectorconfig+Terraformtopology additive merge, validatesbooleanplacementsecret, bluegreen no prune, exactimage/secretversion/readback andsameisolation. No networkdestroy.

Remaining tests: All seveninputmodes/prod waveevidence lineage, initializefingerprint/race, lostpromotionreply, uploadfailure rollback and rollbackfailure, configure partialfailure leavesadmissionisolated; no loadexecution here.

### CI17 — [.github/workflows/cloud-bootstrap-relay-staging-capacity.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-bootstrap-relay-staging-capacity.yml:1)

Manual ops-enabled staging noncancel group, deploy adminIDtoken plus capacity access-token, SQLlease/Node24/Terraform, exactbootstrapconfirm afterauth. Preconditions bothselectedcells600/60, equalreviewedimages,size1, singletondirector image/capacityidentity/topology equality exceptbootstrapcapfields. Inline500line body classifies legacy/modern and general/migrationonly into normalize-and-roll-both/resume-c2-then-c3/roll-c2/roll-c3/complete; unknownimage/admission/phase refuses. Legacy fixedsingletoninstanceID plus timebounded10aggregate metricentries,18x10s retry, restartboundary/incarnation checks; optional normalizeC3 restart guardedhealthyC2 and EXIT restorefallback. Per-cell subshell requires healthyfallback, isolates/drains target; updates onlytargetdirectorcap via bluegreen/prune, validates exacttemplate+MIG plan0or2; zerochanges explicitlyrecreates. Fresh600/60 migrationonly heartbeat before restorebothgeneral; EXITtraps verifyfallback then restorefallback unlesscompleted. Complete still normalizesgeneral admission, not strictlyreadonly.

Remaining tests: Every phase andlegacyfreshness/instance replacement race, target/fallback failure, EXITtrap failure, precondition now600/60 versus changed committedstagingtargetcap (workflow may intentionally refuse), zero-plan restart, noautomaticimageundo.

### CI18 — [.github/workflows/cloud-prove-relay-staging-capacity.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-prove-relay-staging-capacity.yml:1)

Manual ops-enabled staging sharednoncancelgroup; mainguard only90m Asiarefreshjob, ordinarycapacity noexplicitmain. Capacity verify/apply/restore-admission exactconfirm, desiredtfvars cap/bound/image + singletoncompatible director. Apply supports predecessor600/60->1000/0->1000/60->600/60 only, classifies predecessor/director-ready/cell-ready/cell-active; preservehealthyfallback, isolateunlessready, bluegreen/pruneonlypredecessor, staleheartbeatwhen topologychanged. Validate selectedtemplate+MIG plan0or2; readyrequireszero/no restart, activeorotherzero recreates. Freshcap/heartbeat then targetsolegeneral; failure restorefallback, explicitrestoremode firsthealthyfallback thenhealthy target andrestoreboth. Refresh requiresapprovedpredecessor/distincttarget/exactgen+confirm, immutable topologyshape and registry, same-cap savedplan classification replacement/applied/converging; migrationonly exactselector, quiescent or unavailable/stalerestartsafe; fence andapply onlyneeded, applied/offline recreates. Freshnewincarnation/starttime/readyheartbeat andzero readback, no in-job rollback; separate recoveryworkflow handlesfailedrefresh.

Remaining tests: Allmode/ref/phase matrices, declared600/0 unsupported, fallbackrestorepartialfailure, targetedplan drift/no-oprecreate, refresh lostruntime/managerconvergence/postapplyfailure and downstreamrecoverytrigger.

### CI19 — [.github/workflows/cloud-prove-relay-asia-staging.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-prove-relay-asia-staging.yml:1)

Manual main+opsflag staging75m on dedicated self-hostedAsia x64runner, noncancel staging group; exactconfirm/digest/positivegen/distinctattemptIDs, proofOIDC/SQLlease. Node24 frozenbuild; exactdirectorimage; promoteonlystagingcell. Four sharded launchphase each5controls/5splices; firstshard slow/wedgedreader+region/rebindprobes, fdlimit>=4096,2leasehorizons,210sduration after180sramp, barriers and RSSbounds. Trap kills/waits allshards onfailure; collects only terminalaggregate reports; after60s20k boundedlogs seals readiness. Always recoverpromotion+rollback to migrationonly, success-only7d evidence artifact. Independent always/main15m recoveryjob withfreshidentity retries same durableattempt; doesnotrequireopsflag itself.

Remaining tests: Selfhostedavailability, shard/barrierfailure cleanup, reader/rebind/leaseassertions not established by flags, evidenceclipping, lostpromotionreceipt/rollbackfailure; root must baseline real load suite.

### CI20 — [.github/workflows/cloud-publish-relay-production.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-publish-relay-production.yml:1)

Manual ops-enabled production, noncancel publishgroup, no explicitmain predicate; exact publish(emptydigest/confirm) or mirror-staging(64hex+exactconfirm) validated before OIDC. Buildx/docker registryauth; publish pushes separate relay and fence-broker commit-tagged images, broker build embeds commit, resolves immutable digests and emits candidate-summary (does not deploy). Mirror verifies source digest, pull/tag/pushstaging and exacttarget equality; no deletion rollback after partialpush.

Remaining tests: Ref trust, malformedinput, oneof2push failure, wrong mirrored digest, tagcollision/manifest equality and downstream independentprovisioning.

### CI21 — [.github/workflows/cloud-recover-relay-staging-c4-image.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-recover-relay-staging-c4-image.yml:1)

Completed failed/non-success staging-capacity workflow onmain ormanual exactconfirmation;5m gate requires originalworkflow_dispatch and exactlyone failed/cancelled/timedout named refreshjob (zeronoop), opsflag.90m staging recoveryjob ownnoncancelgroup, capacityOIDC/SQLlease/Terraform1.15.8, hardcoded reviewed predecessor/target pair. Requiremigrationonly; classify two validated target/recoveryplans and stable singleton/MIG/runtime: verifytarget/verifypredecessor no mutation ifexactconverged; else rollbackpredecessor. Fence/drain withquiescence or unavailable-runtime/staleheartbeatrestartsafe; savedplanapply ifchanges, stablewait, recreatesonlyifplan didn'talreadyreplace/converge. Zerochange readback, always freshauth verifiescap3000/bound60/image/readyheartbeat afterstabletimestamp andunchangedselectorisolation. No admissionactivation; laterfailure leaves recoveryunverified.

Remaining tests: Triggerlatestjobs/attemptbinding, zero/multiplematchingjobs, imagepairdrift, malformedplan/changeKind, healthyendstatenoop, offlineruntime/gate refusal, restartduplicateavoidance, alwaysverify missingoutputs and timeout.

### CI22 — [.github/workflows/cloud-verify.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/cloud-verify.yml:1)

PRpathfiltered and mainpush cloud workflows/lease, contentsread, cancel-by-ref. Parallel pinned-digest securityscanner containers readonlysnapshot/history(no verification TruffleHog), Node24 frozen cloud build/typecheck and tests with disposable postgres16alpine healthcheck, Terraform1.15.8 fmt/backendfalseinit/validate. Test invocation is unrun pointer, not assertionproof; no deployment identity/remote backend intended.

Remaining tests: Pathtrigger cases, scanner refusal, postgres health/setup vs behavioraltestfailure, freshfrozeninstall, Terraformvalidation and entire original suite baseline.

### CI23 — [.github/workflows/adhoc-mac-build.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/adhoc-mac-build.yml:1)

Manualrequestedref/label upstreamrepoonly protectedadhocenv150m macOS15 noncancelperref. Before signing rejectPRref andresolvebranch-first/tag/commit inbarefetched graph, require reachabilityfromupstreambranch/tag (resolvableSHAaloneinsufficient). CheckoutimmutableSHA/no credentials, Nodefile/pnpm2/frozeninstallretry3x10m, signingenvverify. Requireversionhelpers/nameoutput; publishedbaseversionlookup toleratesAPI failure. App-token scopedchannelrepo, createDRAFT release, signednotarized Macbuilderpublish retry2x45m, verifylatest-mac.yml+anyZIP thenpublishprerelease/reasserttitle. Failed/cancelled prepublishbest-effortdraftdelete, hardtimeoutmayleaveinvisibledraft. Successful retentionpublishedAt age(notcreatedAt), protectsnewtag/missingdate, max200list. Publishedmac triggersunsignedWindows reusableexactSHA/version; no tests gate.

Remaining tests: Reachability/PR-onlySHA/refcollision, versionlookupfallback, tokenexpiry/retrypartialassets, requiredmanifestcontentsnotcheckedbynamepresence, draftcleanup/hardkill, agepruning andWindowslaterfailure.

### CI24 — [.github/workflows/computer-e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/computer-e2e.yml:1)

PRnamedpathfilter/manual/daily06UTC, cancelonlyPR. PRLinux/Windows native-smoke Node native runs selectedunitpointers/buildCLI/Electron+daemonboot/handover/Windowsclose; macOS15 alltriggers Electronnative ownerloss benchmark1trial+Swift signedhelper verification. NonPRLinuxXvfb/D-Bus accessibilitypackages andWindows realcomputersuites. Thus PRsmokes do notprovefull desktopautomation; permissionsexplicitcontentsread onlysmokejobs, fulljobsinherit. No explicitjobtimeouts/artifacts/rollback.

Remaining tests: Nativepermissions/helperownership and realLinux/Windowsdesktop assertions, skipboundary byevent, dependencytooling vsproductfailure.

### CI25 — [.github/workflows/daemon-relocation-spike.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/daemon-relocation-spike.yml:1)

Manual orspecificlegacybranch pathpush, contentsread cancelbyref, Windows2022 40m. Frozeninstall/cachedunpackedbuild; runsfull/no-gpu/minimaltiers retaininglogs, success ifANYtierpasses (notall); always7d logs warnifmissing. Diagnostic experiment, no release or guarantee completefileset.

Remaining tests: Cachefreshness andany-vs-all tieracceptance; failedtierlogs, original relocation assertions.

### CI26 — [.github/workflows/daily-mac-build.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/daily-mac-build.yml:1)

Daily18:15UTC/manualforce, upstreamrepoonly maincheckout150m noncancelglobal, Nodefile/frozenretry/signing. Freshness latestnondraft among20 parses7..40hexcommitprefix; API/missingmetadata forcesbuild, unchangedskipunlessforce. Versioncontinuesexistingtitle numbersincludingdrafts among200 plusupstreamstabletagsfallback; require name. Remintapp tokenbeforepublish ANDalwaysfinalverify/cleanup. Draftcreate persistsnotesfile, signedMacpublish retry, requiremanifest+ZIP thenliveprerelease reasserttitleANDnotes. Failedprepublishbest-effortdelete; successful retention30shipped sortedpublishedAt/tag protectsnewseat. Independentpostpublished actionwrite E2Edispatch3attemptswarning-onlyfailure, no waitresult; unsignedWindows sameSHA/version. Source wordingno testsran isaccurateatpublication.

Remaining tests: Prefixfreshness/staleAPI, draftnumberreservations, noteoverwrite, 30retentionstabletie, tokenexpiry/cleanup anddispatchfailurewarning remainsgreen; realpostcut testbaseline separate.

### CI27 — [.github/workflows/dev-channel-win-build.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/dev-channel-win-build.yml:1)

Reusable/manualchannel hourly/daily/adhoc withfull40hexSHA,tag==vversion+channelidentifier; upstreamrepo protectedadhocenv Windows2022 90m noncanceltag. Baregraph branch/tag reachabilityrequired, immutablecheckout, channelenv dynamicuppercase andhelperexistence+packagingidentityverify. Nodefile/frozenretry, x64+arm64 processaddon required thenreleasebuild. Scopedapptoken confirmsreleaseexists (doesnotcreateWindowsonly), unsignedbuilderpublishretry2x30m guardsnativefailure, ignoresreleaseage; requirelatest.yml+exactinstaller. No rollbackpartiallyuploadedWindowsassets oralreadygoodMacrelease.

Remaining tests: Channel/tag/SHA/refreachability, cross-archaddonmissing, releaseprunedrace, manifestnameversuscontent, token/buildfailure andunsignedswitchrestrictions.

### CI28 — [.github/workflows/docs.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/docs.yml:1)

Releasepublished/manualstabletag orPRsitepaths, contentsread PRcancel vs noncancelproduction. PRNode22 pnpm10.24 isolatedsitefrozeninstall/tests/lint/tsc/build. Stablegate upstreamrepo5m rejectsRC/mobile/malformedsemver no-op, releasebot+nondraft/nonpre ormanualdefaultbranch+APIstate; API3retries, resolveimmutabletagcommit(oneannotatedtagdereference), missingdocsafter3tries skips. Protectedproduction15m immutablecheckout, requireVercelorg/project/tokenroles, noninteractivepullsettings/tests/lint/tsc/buildprebuiltproddeploy. No deploymentrollback; missingdocsAPIerror indistinguishablefromoldtag afterretries.

Remaining tests: Unauthorizedtag/author/ref, moved/nestedannotatedtags, metadataoutagevsmissingdocs, build/testfailure andalreadydeployedpartialfailure; independenthostingproject.

### CI29 — [.github/workflows/e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/e2e.yml:1)

Reusable optionalref/changedJSON/SSHflag, manualref or twice-daily17/22UTC contentsread. Parallel10m buildrelay+Vite+web aggregateexits,1d hiddenoutartifact missingerror;15m Electronnativecache. Emptychangedinput full14Linuxshards30m; nonempty45m filteredSSHreadiness/nativeIME removedfordedicatedlanes, emptyafterfilter no-op, contentflagDocker/headful detect then workers1. DedicatedSSH60m onfull/SSHsource/readiness spec; threerealDocker suites alwayscontinue retainingseparate traces, failure7d artifact. Build/artifactscopeallselectsame ref; no OSallmatrix/rollback.

Remaining tests: ChangedJSONparse/emptyfilter/dedicatedlanegaps, skippednativeIME notcoverage, all14shards+SSHassertions, buildparallelwaitfailure, tracepreservation andsourceheadselection.

### CI30 — [.github/workflows/golden-e2e-experiment.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/golden-e2e-experiment.yml:1)

Manual optionalcheckoutref,3OS failfastfalse30m, Nodefrommanifest/4GiBheap/Linuxgyp11.5.0/frozeninstall/ViteE2E. Linux/mac core+rendering mandatory andnumerous--if-present goldens, optionalfilegatedfreshprofiles; Windowsmostlyoptional scripts+filegatedspecs. Failure7d traces missingignored; no explicitpermissions/concurrency. Success canomit unavailable optional suites.

Remaining tests: ExactOSsuiteavailability, optionalmissing vsPASS, userref checkout andgolden baseline.

### CI31 — [.github/workflows/hourly-mac-build.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/hourly-mac-build.yml:1)

Hourly/manualforce upstreammain150m noncancelglobal, samefreshness7..40hexnondraftprefix vs20latest andversiontitle/draftnumberbase logic, Nodefile/frozenretry/signing. App-tokenremintbeforepublish only; signedMacdraft->manifest+ZIP->prerelease/reasserttitle (unlikedaily doesnotreassertnotes), failurebest-effortdraftdelete, success72shippedretentionpublishedAt/tag/protectcurrent among200. DependentunsignedWindows exactSHA/version; no E2Edispatch. No transactionrollbackafterpublication.

Remaining tests: Hourlynotesoverwritten affectsnextfreshness, publishtokenexpiry, retention/newtagprotection, no-testpublication andWindowslaterfailure.

### CI32 — [.github/workflows/issue-os-labeler.yaml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/issue-os-labeler.yaml:1)

Issueopened/edited/reopened5m issueswrite github-scriptv8. Parse exactOperating-system heading, missing/unknown no-op; recognizednormalizedOS maps case-sensitive managedlabelnames, removesonlymanagedlabels retainsothers anddedupes viaSet then setLabels. API failure leavesunknownpartialstate, stale payload canoverwriteconcurrentlabels.

Remaining tests: Heading/noop/labelpreservation/mixedcase andconcurrentupdate/permissionfailure.

### CI33 — [.github/workflows/linux-wayland-gpu-sandbox.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/linux-wayland-gpu-sandbox.yml:1)

Manual Ubuntu30m; installsWeston/buildtools/zsh/gyp11.5, deletesrunnernode_modules thenfrozeninstall andmanifestdiffguard. HeadlessWeston runtimedir0700,50x0.2ssocketwait; !cancelled10m forcescheckoutGITHUBSHA/removesout thenWaylandGPUhelper. Always7dWestonlog ignoredmissing; no compositorcleanup inworkflow. Runner-only UIeffects forbiddenhere.

Remaining tests: Sockettimeout/Wayland/GPU/input realassertions, precedingfailurestillverify, processcleanup andmanifestdrift.

### CI34 — [.github/workflows/mobile-android-release.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/mobile-android-release.yml:1)

Mobileandroidtagpush/manual optionalexactversion+publishdefaulttrue, Ubuntucontentswrite, Node24/JDK17, frozenpnpm, preparereleasehelper versioncodeoutputs, ExpoAndroidprebuild andGradle releaseAPK. Uploadartifactv7; ifpublish tagabsent createatGITHUBSHA/push, existingtag acceptedwithoutSHAcomparison; releaseexisting uploadclobber elseprerelease/nonlatest generatednotes. No explicitconcurrency/timeout/signingkey import/rollback; partialtag/releaseupload retained.

Remaining tests: Version/tag assertion, existingtag wrongSHA, APKabsence/buildfailure, concurrentclobber and partialpublication; independentAndroidsigningprovision.

### CI35 — [.github/workflows/mobile-ios-release.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/mobile-ios-release.yml:1)

Mobileiostagpush/manual patchbump/exactversion/changelog, macOS26 Xcode26.5 Node24 Ruby3.3 90m build. ASC credentials resolve marketing/buildmetadata, Expo/CocoaPods, per-runrandompassword keychain importsP12 andnoninteractivepartitionlist; removesdecodedcert but no explicit keychainrestore/delete cleanup. Fastlanebuild/TestFlightupload, alwaysartifactv7 missingIPAignored. DependentUbuntu30m distribution forwardsresolvedversion/build, optionalchangelog; failedprocessing/distribution emitsuploaded-but-notdistributed retry-onlyjob message. No explicitconcurrency/permissions, no rollbackuploadedbuild.

Remaining tests: Versionresolution/assertions, certfailure/keychaincleanup, IPA uploadloss, AppStoreprocessing timeout/rerundistribution exactversion/build, provision independentteam/profile.

### CI36 — [.github/workflows/mobile.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/mobile.yml:1)

PRpathfiltermobile/sharedfilelink andtwoiOSworkflowpaths, Ubuntu Ruby3.3 frozenbundle, Nodeversionrootfile, pnpm/setupv2. Rootfrozenignore-scripts thenmobilefrozeninstall, typecheck/tests plus twoRubytests, Fastlanelanes, lint/format; no explicitpermissions/concurrency/timeout. Runnercommands pointers only, no releasecredentials.

Remaining tests: Pathfilter (Androidworkflow-onlychange omitted), Ruby assertionbody baseline, rootpostinstall suppression vs mobile lifecycle, platformlint/tests.

### CI37 — [.github/workflows/node-next-compat.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/node-next-compat.yml:1)

Daily10UTC/manual, cancelglobal Node26compat, contentsread. Prepare Node26 nativecache then reusableunit-tests Node26 (eightshards/exclusions inherited); no candidatebuild orpublish.

Remaining tests: UnsupportedABI/cache/freshinstall vs behavioral failures; Node26 entire source testmatrix.

### CI38 — [.github/workflows/pr-test-loc.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/pr-test-loc.yml:1)

PRopened/sync/reopened/ready, cancelperPR2m contentsread PRwrite; nocheckout. Fetch twohelperbodies fromtrusteddefaultbranch viaAPI into runner temp thenupdatesPR test/non-testLoCsummary; helper seamnotassertioncoverage. API/base64/script/update failure failsjob, no rollback of priorcomment.

Remaining tests: UntrustedPRdiff withtrustedscript, fork tokenpermission refusal, largepagination/LOC classification helper cases.

### CI39 — [.github/workflows/pr.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/pr.yml:1)

PRopened/sync/reopened/ready contentsread cancelperPR. Fullhistory/no credentials changedpath no-renames mergebase includesdeletions -> canonicalclassifier outputs gate12expensivelanes; alwaysrootdirectoryguard. Staticanalysis includes lint/qualityratchets/localization/skills/VMrollbackconditional/forbidpreloadshared.d.ts; typecache; Git2.25.5 SHAcheckedbuild+2container versions waitsall; pinnedCodex0.150.1 andxtermpatchsync; bounded fish4+ requiredreal18shellcases; Node24eightshards separate nativecache allows skippedcache only. Chromeabsencerejected, explicitwirejourneys, Node18managedhooksmoke. Linuxpackaging90m CLI+parallelrelay/Vite waited,3formats markerchecks Dockerlaunch/shutdown/watchdog; Windows30m separateNode/Electronnativecache, boundarysuite plusunsignedunpackedsmokes. Nondraftcode E2Echangedrouting (differentdiffexcludesD) delegatesheadSHA andIME lane. Alwaysverify requiresclassifier/rootguard success and exactsuccess-ifselected/skipped-ifnot for12lanes; E2E/IME are NOT verify dependencies, sourcecheckgate not fulljourneyacceptance.

Remaining tests: Classifier/deletion/rename routes andskippedselectednegative matrix, E2Edeleted-specgap, shell/Chrome prerequisitefailure, cacheABIseparation, originalallcommands assertionbodies andpackagedOSbaseline; downstreamhelpertests pointersuntilread.

### CI40 — [.github/workflows/pullfrog.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/pullfrog.yml:1)

Manualprompt+runname, Ubuntucontentsread/idtokenwrite, shallowcheckout thenexternalpullfrog@v0 action withprompt andtenprovidercredentialroles. Externalagentbehavior/permissions opaque seam; no explicitrefrestriction/timeout/concurrency/artifacts orrollback. IndependentDrogon provider/appselection required.

Remaining tests: Approvedexternalaction pin/trust, empty/maliciousprompt policy andleastcredentialprovision, no agentrun performed.

### CI41 — [.github/workflows/readme-downloads-badge.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/readme-downloads-badge.yml:1)

Manual6hourly minute17/releasepublished-edited-deleted, upstreamrepoonly contentswrite noncancelglobal, checkoutmain. Renderhelperthen diffonlySVG; unchangedno-op, changedbotcommit+pushmain. Otherworktreechanges ignored; pushconflict/failure leaveslocalcommit, no retryrollback.

Remaining tests: Renderaggregation/assertions andconcurrentmainpush, repoidentityreprovision, releaseeventlatestnumbers.

### CI42 — [.github/workflows/release-policy.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/release-policy.yml:1)

Releasepublished/edited only upstreamrepository, contentswrite, noncancelglobal5m. Inline github-scriptv8 permits onlyactionsbot author plus strictstable/RC/mobile-or-mobileandroidsemvert; fixesprerelease then reselectshighestnumeric stablebotrelease. Unauthorized release firstdraft/prerelease/nonlatest, restorelatest, deleterelease andtag(404onlyignored). Multi-APIpartialfailure no transactionrollback. Not portablepermission policy: independentrepo/identity approvalrequired.

Remaining tests: Malformedzero-prefix/version/author, mobile-ios tag doesnotmatch mobile releaseallowlist, partialdelete/reselectfailure and404vsothererror; preserve source/intendedcorrection distinction.

### CI43 — [.github/workflows/skill-update-roundtrip.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/skill-update-roundtrip.yml:1)

PR/mainpathfilter+mergegroup,3OS xsymlink/copy xautocrlfboolean xCLI1.5.17, extraUbuntu symlinkfalse latestrow allowedfailure. Checkoutfullhistory no creds, Nodefile, helper sourceheadrepository/ref forwarded. No packageinstallhere; helper owns CLIeffects, pinned12cases+1advisorylatest; no explicitpermissions/timeout/concurrency.

Remaining tests: Symlink/copy/CRLF convergence assertions andhelperfetchisolatedeffects, latestfailure nevergatePASS.

### CI44 — [.github/workflows/terminal-ime-e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/terminal-ime-e2e.yml:1)

Reusable/manual/daily09:30UTC Ubuntu22.04 25m contentsread, installsX11IBusHangul tools/gyp11.5/frozendeps, ViteE2E. Deterministic exact-byte spec workers1; nativeIMEscript runs!cancelled evenpriorfailure, always7dtestresults missingignored. Realkeyboardeffects belongisolatedbaseline, no parityinferencefromname.

Remaining tests: Deterministic/native exactbyte assertions, IBusfailure/locale, setupfailure vsbehavior, artifactabsence.

### CI45 — [.github/workflows/terminal-perf.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/terminal-perf.yml:1)

Manualoptionalref+grep/reportpath/frame/interval/output/panecount inputs or daily08:30UTC Ubuntu45m, frozenNode/ViteE2E. Inputs forwardedonlynonempty asquotedargs/env, Xvfbscale reportgate, always14dreport missingwarn andfailure7dtraces missingignored. No inline numericbounds, helper ownsvalidation; no explicitpermissions/concurrency.

Remaining tests: Invalidperfinputs/reportpath, realisticPTYload thresholds andoptionalgrep narrowing, failedreport vswarnartifact.

### CI46 — [.github/workflows/track-community-prs.yaml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/track-community-prs.yaml:1)

pull_request_target opened/reopened/ready ormanualPRnumber,5m contentsread plusprovisionedGitHubApp token. InlineAPI fetchPR, skipactions/dependabot oractiveinternalteammember, 404membership meansnotinternal othererrorfails; resolveorgproject andaddPRnodeviaGraphQL. No untrustedcheckout/script execution. Repo/team/project/app identifiers areprovisionroles, no reverseitemremoval.

Remaining tests: Manualnumbervalidation, bot/internal404/error matrices, missingproject/apppermission andidempotentGraphQL servicebehavior.

### CI47 — [.github/workflows/unit-tests.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/unit-tests.yml:1)

Reusable requiredJSON Nodeversions, eightshards/version Ubuntu failfastfalse, contentsread/checkoutv6 no persistedcredentials. Install-node-dependencies localaction Node native/cacheElectron, binaryinstallhelper thenconfigVitest; sixteen explicit livePTY/shell exclusions plus cross-version-wire tree. Exclusion is omission notpass, original suites retained separately; noartifacts/rollback.

Remaining tests: InvalidmatrixJSON, shard/exclusion allocation and all excluded livecases/8shards baseline; no assertions read fromcommand alone.

### CI48 — [.github/workflows/win-crash-survival-e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/win-crash-survival-e2e.yml:1)

Manualsurvival(default)/orphaned Windows2022 50m contentsread/cancelbyref, branchunsignedinstaller cacheexcludes tests/bench/reliabilityconfig; frozeninstall/builddesktop+builderpublishnever. Silentinstall thencasefallback programspath, failmissingexe; crashharness expectprofile+8ssoak explicitlypropagatesLASTEXITCODE throughTee. Always7ddiagnosticlogs warnmissing. Genuineinstalledprocess effects, no release/updaterollback.

Remaining tests: Cacheinputs/expectedorphaned negativeprofile, actualprocessownership/liveness andinstaller/personalprofile isolation.

### CI49 — [.github/workflows/win-update-e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/win-update-e2e.yml:1)

Manual exactfrom/toassetglob/soak/expect orlegacybranchpathpush withhardcodedRCdefaults, Windows2022 30m cancelbyref contentsread. Downloadreleaseassets eachside selectsfirstEXE (notexactlyone), failnone; harnessinstalls/updates andchecks coldrestore/survival withpropagatedexit; always7dlogs. No publication/undo; release-to-release scope.

Remaining tests: Ambiguousasset/existingreleaseidentity, from-to baseline realharness; expectationprofile notparityproof.

### CI50 — [.github/workflows/win-update-survival-e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/win-update-survival-e2e.yml:1)

Legacybranchpathpush/manual survival/coldrestore Windows2022 50m cancelbyref contentsread. Cachedbranchunsignedinstaller/builddesktoppublishnever; harness uses SAMEinstallerfrom/to60ssoak, explicitexitstatus, always7ddiagnostics. Same-buildoverwrite doesnotcovercross-versionmigration.

Remaining tests: Realupdate/livenessassertions, cachekeyomissions vsfreshbuild andcross-version gap.

### CI51 — [.github/workflows/windows-signing-rehearsal.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/windows-signing-rehearsal.yml:1)

Manual test-signing(default)/release-signing+innerconfiguration, Windows2022 360m contents/actionsread, frozenretry/buildrelease/unpacked. Stageexe/dll/node whoseAuthenticode notValid; requiremainexe+conptyaddon. Uploadinnerartifact, SignPathv2request async thenwait1h, matchfirstreturned suffixpath andrequirecertbeforecopy, prepackagedNSIS. Signinstaller asyncwait4h, rebuildblockmap andSHA512/size metadata aftersignedbytes. Verifyinstaller ANDextractedstagedinnerfiles; testpolicy acceptsnonValidcert exceptNotSigned/missingcert, releasepolicyrequiresValid+expectedsubject. Always7devidence/installerartifact, no releasepublish/installation; no explicitref/environment/concurrency gate andno signingrequestrevoke cleanup.

Remaining tests: Testvsreleaseassertionmatrix, ambiguoussuffixmatching/missinginner, trustedthirdpartyalreadyValid exclusion, extractexitstatus, metadatahash equality andSignPathtimeout; independentcert/serviceapproval.

### CI52 — [.github/workflows/windows-terminal-restart-e2e.yml:1](/Users/carlos/Documents/Drogon-mentu-session/.github/workflows/windows-terminal-restart-e2e.yml:1)

Manualoptionalref Windows2022 30m cancelbyref contentsread/nopersistcredentials, Nodefile/frozeninstall/ViteE2E, requiredrestartflag twoexplicit specs narrowed3grepnames workers1; failure7dtraces ignoredmissing. Actualdaemon/input restoration notassertedbyworkflowitself.

Remaining tests: Threeassertionbodies andcold/live daemon distinctions, grepzero-selection failurepolicy andpackagedversusdevbuild.

## Infra and operational boundaries

INF01–INF14 were the sole disjoint leaf assignment. The lead read the complete [leaf report](config-ci-leaf/infra-entry.md), checked all 14 hashes/inclusive bounds against current source bytes, and cross-checked startup and actual identity assertion bodies. Its enumerated permission/input details remain available there; the following qualifications take precedence over broader leaf wording.

**INF01 — [cloud/infra/terraform/relay-github-actions.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-github-actions.tf:1).** Production deploy/monitor/fence and environment-specific capacity identities have distinct OIDC conditions and workload-identity bindings. Dedicated project/resource roles separate viewers, artifact writers, runtime actAs and bounded capacity/staging-power mutation; exact state/lock object conditions apply to capacity writers, while the deploy state reader is bucket-scoped. Count gates and IAM removal are declarative changes, not an automatic rollback transaction.

**INF02 — [cloud/infra/terraform/relay-asia-proof-iam.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-asia-proof-iam.tf:1).** Staging Asia-proof identity requires main, staging, manual workflow and exact caller trust; project roles are logging/monitoring viewers. Application admin operations authorized by this identity remain downstream and cannot be declared side-effect-free merely from project IAM.

**INF03 — [cloud/infra/terraform/relay-asia-topology-iam.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-asia-topology-iam.tf:1).** Asia-topology identity gates main/environment/manual exact workflow, provides additive compute mutation plus read roles, artifact reader, runtime actAs and exact state/lock object writer with separate list permission. Allowed compute permission families do not prove every unrelated same-family resource mutation is impossible; plan validator remains necessary.

**INF04 — [cloud/infra/terraform/relay-staging-deploy-iam.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-staging-deploy-iam.tf:1).** Staging-deploy provider allowlists exactly five workflows, conditionally grants service-scoped Run developer/auth runtime actAs, compute viewer, artifact reader, exact state/lock objectViewer and bucket metadata/list. Empty auth-service input omits those auth power grants. This file supplies no state writer or artifact writer but does not establish account-wide absence of grants elsewhere.

**INF05 — [cloud/infra/terraform/relay-gce-startup.sh.tftpl:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-gce-startup.sh.tftpl:1).** GCE startup waits for Docker, obtains metadata token, reads two secrets, writes private env file, pulls images, replaces containers, waits for SQL proxy socket, runs relay and starts logging. EXIT removes env file and Docker config, not a proof of deletion from Docker container configuration; force-removal is restart replacement, not transactional idempotence/rollback. Failed pull/start/socket/logging may leave partial running state.

**INF06 — [cloud/infra/terraform/relay-database.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-database.tf:1).** Database resources create isolated database/user, random password and secret version holding connection URL, with runtime/director accessor bindings. Secrets also enter Terraform state according to provider behavior; rotating resources does not implement consumer reconnect or a proven password rollback.

**INF07 — [cloud/infra/terraform/relay-dns.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-dns.tf:1).** Optional Run domain mappings route configured names to director/cells; certificate_mode changes are ignored for director mapping. Authoritative DNS and certificate issuance remain external, and removing a mapping does not itself restore a working hostname.

**INF08 — [cloud/infra/terraform/relay-observability.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/relay-observability.tf:1).** Logging metrics select Run/GCE event families and extract distributions/deltas with role/cell/region labels. Alert policies use per-metric thresholds, aggregation and notification-channel subsets; empty channels retain visibility without paging. Definition is not observed metric arrival/alert delivery, and map removal is destructive desired-state change.

**INF09 — [cloud/infra/terraform/variables.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/variables.tf:1).** Input declarations constrain environment, repository-ID syntax/workflow prefixes, image digests, regions/zones, unique hostnames, capacity/pool/disk ranges and paired cap/headroom values. Required values/type checks and explicit validations differ from comments; provider-accepted account existence, URL reachability and operational approval are not all validated.

**INF10 — [cloud/infra/terraform/versions.tf:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/versions.tf:1).** Terraform floor is >=1.7.0; google ~>6.0, random ~>3.6 and external ~>2.3 are compatibility ranges, not exact resolved versions. GCS backend and project/region provider configuration require independent lockfile/provider and backend validation.

**INF11 — [cloud/infra/terraform/environments/production.tfvars:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/environments/production.tfvars:1).** Production tfvars declare 29 GCE cells (26 primary-region, three Asia), image/boot pins, fencing/rehome memberships, disabled initial admission and configured notification role. These are upstream topology roles to reprovision; initially_enabled is a bootstrap input and must not be treated as proof of current admission or the exclusive operational activation route.

**INF12 — [cloud/infra/terraform/environments/staging.tfvars:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/environments/staging.tfvars:1).** Staging tfvars declare separate project/backend/service roles and four GCE cells with distinct cap classes and initial flags, director min0/max2 and nonempty shared-auth role. Scale-to-zero eligibility/configuration does not prove current stopped state.

**INF13 — [cloud/infra/terraform/backend/production.hcl:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/backend/production.hcl:1).** Production GCS backend selects its own state bucket and shared state prefix. Identity, state locking, migration and recovery are external to this three-line declaration; no offline or rollback implementation appears here.

**INF14 — [cloud/infra/terraform/backend/staging.hcl:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/infra/terraform/backend/staging.hcl:1).** Staging GCS backend selects a separate bucket with the same prefix. Separate names express intended environment isolation, not deployed ACL isolation or protection against selecting the wrong backend.

### INF15 — [cloud/apps/relay-ops/src/incident-monitor-cli.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/incident-monitor-cli.ts:1)

Schema 4 monitor CLI validates production/staging, a safe incident ID, complete normalized unique cell selectors, nonnegative safe generation (generation zero cannot be migration-only), duration 15–90 minutes and interval 1–60 seconds; dry-run requires 15 minutes and policy-specific source/target inputs. Unknown or missing arguments refuse; repeated value arguments use the last value. Existing state requires --restart; restart requires state and exact schema/incident/environment/selector/policy/window parameters. Supplied admin token is shape-checked only (three base64url parts, length bound), then returned for any requested audience; provider verification remains downstream. Creates private directory 0700 and three evidence files 0600; temporary rename and file fsync provide recoverable per-file writes, without a directory fsync or cross-process lock. Checkpoints deduplicate windowSequence/checkpointMinute; malformed JSONL refuses. A max-samples stop returns 0 with an incomplete persisted window, so segment success is not safety-window completion. Failed dry-run or frozen window returns 2; other exceptions reach sanitized direct-entry exit 1. Permission/stat errors are treated as missing files by fileExists. No automatic rollback of evidence files.

Remaining tests: Reject stale/mismatched restart fields, malformed tokens/JSONL, permission errors, concurrent writers and interrupted rename; prove max-samples exit 0 cannot authorize mutation; verify private file modes and exact checkpoint deduplication.

### INF16 — [cloud/apps/relay-ops/src/incident-live-preflight-cli.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/incident-live-preflight-cli.ts:1)

Accepts an optional leading --, one --retry-freshness, one wave-index 0–3, and exactly --state-file path. Validates a production schema-4 completed, unfrozen, 15-minute dry-run with 60-second interval and at least 16 samples, matching strict/recover-forward/capacity-transition policy fields. Pre-drain status, finite timestamps, duration, last-sample gap <=60 seconds, no future evidence and evidence age <=5+75*waveIndex minutes all gate live collection. Live expected generation advances by 2 per wave; selector remains fixed. A supplied admin token uses INF15's override. Default one attempt; retry flag allows five attempts 15 seconds apart only when every failure is missing/stale signal/source. Threshold or generation failures refuse immediately; final error exposes source/code, not provider response. Direct entry catches and exits 1; success prints a green result without mutating cloud state.

Remaining tests: Run every timestamp boundary, wave lineage, strict/recovery/capacity binding, stale-only retry and threshold no-retry assertion in a disposable fixture; exercise schema/type and malformed-date failures.

### INF17 — [cloud/apps/relay-ops/src/gcloud-client.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/gcloud-client.ts:1)

execFile invokes gcloud without a shell, with 90-second timeout and 8 MiB buffer; inherited environment is supplemented to disable prompts, update checks and usage reporting. Failures replace stderr with a generic operation label from the first three arguments. Access tokens require 32–8192 allowed characters, cache for five minutes and coalesce pending requests, clearing pending on failure. Identity tokens require three base64url parts and a length bound, cache per audience for five minutes, and request audience plus email; concurrent identity requests do not coalesce. Cache age does not parse actual JWT expiration or verify its signature/audience.

Remaining tests: Retain access single-flight and per-audience identity cache assertions; add expiry, failed pending reset, invalid output, timeout and concurrent identity-token requests without real credentials.

### INF18 — [cloud/apps/relay-ops/src/dashboard-snapshot.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/dashboard-snapshot.ts:1)

Monitoring, resource inventory and workflow history assemble concurrently with allSettled. Monitoring/inventory rejection throws sanitized component names; workflow-history rejection becomes a warning and empty history. Missing latest metrics become zero in summary fields, which cannot prove healthy traffic; unknown target size preserves null powered capacity and active-cell counts. Configured capacity counts admitted cells; powered state and backend health select active cells. Snapshot includes planning cost, certificate/image warnings and stale=false. Cache TTL is 30 seconds by environment/window and coalesces pending reads; last-good is keyed only by environment, so stale fallback can cross requested windows. Credential warnings/all-core-unavailable or a builder exception reuse last-good with stale reason; without last-good the first incomplete snapshot or exception remains visible. Failed state is also cached until TTL.

Remaining tests: Retain stale credential and sanitized exception assertions; add first-read outage, cross-window TTL/coalescing, mixed healthy/unknown targets and missing-metric zero semantics.

### OPS-C1 — [cloud/apps/relay-ops/src/incident-monitor-sources.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/incident-monitor-sources.ts:1)

Collects dashboard, director administrative status and 11 Google SQL/director/auth metrics in parallel; any top-level rejection fails collection. Google requests have 30-second deadlines, five-minute windows and pageSize 1000; any nextPageToken refuses incomplete evidence. Finite points aggregate by specified latest-max/latest-sum/window-sum rules; designated empty counters become zero while other empty signals retry three times with two-second delays then remain missing. Lock waits use freshest per-series samples and preserve future timestamps for freshness refusal. Relay deltas trim to five minutes, while the dashboard collector itself clamps its request to at least 30 minutes. Missing endpoints/unknown inventory remain absent or null. Director admin POST uses audience-bound identity token, normalized complete selectors and serial cell reads; each source/target evacuation-status query sets completeReady=false, preventing this observational call from finalizing evacuation. Blocked plus expired-unregistered and inactive counts remain discriminating; no source implies no signal rather than invented success.

Remaining tests: Fixture pagination refusal, partial sources, empty-vs-missing counters, future/stale lock waits, completeReady=false, cross-cell selectors and 5-minute delta/30-minute reader distinction.

### OPS-C2 — [cloud/apps/relay-ops/src/monitoring-snapshot.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/monitoring-snapshot.ts:1)

Reads 24 relay metric definitions and prefixed alert policies with bearer GETs and 30-second deadlines. Window clamps to 30–1440 minutes, default 360. Distribution averages multiply by count, gauges use latest samples per series/minute, and per-cell aggregation selects newest buckets; invalid timestamps are dropped but numeric conversion lacks the incident reader's finite check. Time-series pageSize 1000 and alert pageSize 100 have no next-page traversal or explicit incompleteness refusal. Credential failure yields unavailable metrics and a warning; individual allSettled failures degrade one metric, alert failure gives an empty warning-bearing list, and available-but-empty latest remains null.

Remaining tests: Preserve partial/unavailable results; prove multi-page evidence behavior and finite-number handling before treating dashboard values as safety evidence.

### OPS-C3 — [cloud/apps/relay-ops/src/resource-inventory.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/resource-inventory.ts:1)

Google Run/SQL/MIG/template/backend/certificate readers use 30-second requests and schema validation. Endpoint health and ready probes run in parallel with redirect:error and eight-second timeout, then retry once after 11 seconds when unhealthy or slow. A known zero-size MIG never wakes through probing; staging SQL activation NEVER suppresses director/auth probes, while unknown SQL can still probe. Missing MIG preserves unknown fields. Template and backend reads are allSettled; image digest is extracted from startup metadata without returning raw metadata. Backend health requires all reported backends healthy; empty is empty and failure is unknown. Some schema errors inside fulfilled cell responses can still reject the cell collection. runningInstances may fall back to stable targetSize, an infrastructure inference rather than process liveness proof. Credential failure returns unknown inventory and warnings.

Remaining tests: Fixtures for unknown versus zero capacity, failed schemas, no-wake probes, retry timing, mixed backend health and inferred running count; preserve live/unverifiable/exited separately.

### OPS-C4 — [cloud/apps/relay-ops/src/github-runs.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/github-runs.ts:1)

execFile runs gh for the configured repository's actions/runs endpoint, page size 100, timeout 30 seconds and 4 MiB buffer; failure is sanitized. Validated history filters names containing Relay/Auth/Power, keeps at most two per name and 12 overall, and shortens source SHA to eight characters. No pagination or exact target-run/commit proof is provided; this is dashboard history, not mutation authorization.

Remaining tests: Mock absent gh, malformed response, pagination, same-name workflows and target-run mismatch; never use this display history as exact-run authority.

### OPS-C5 — [cloud/apps/relay-ops/src/cost-model.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/cost-model.ts:1)

Pure planning arithmetic estimates fixed machine rates by region/size and target size times 730 hours, assumed disks, SQL ALWAYS allowance, Cloud Run minimum instances, network foundation/NAT floors and observability allowance. Produces rounded 0.85–1.30 range and actualBilling.available=false, excluding egress, credits and tax. These are pinned source assumptions, not current billing measurements.

Remaining tests: Fixture unknown machine/region, zero target, SQL activation policy and null inventory; retain explicit planning-only provenance.

## Configuration and runner contracts

### CFG01

[package.json:1](/Users/carlos/Documents/Drogon-mentu-session/package.json:1)

Root entry manifest pins Node 24 and pnpm 12.0.0 (integrity suffix retained in source). Root install invokes native rebuild and prepare invokes Husky; build:cli also fixes executable/package metadata and installs a development CLI, so neither install nor a build is a read-only validation. Lint sequences native and type-aware audits with --deny-warnings, reliability and three ratchets plus skill/localization checks; React Doctor is separate and its audit command is nonblocking. Typecheck helper runs only node/CLI/web, excluding E2E. Build chains distinguish desktop, native, release, unpack, signed Mac, Win and Linux; preview/dev ensure Electron ABI. Unit test first ensures Node ABI; Playwright entry ensures Electron ABI and selected projects. Named remote/native/repro/benchmark commands may create processes, hosts or real sessions; all remain unexecuted invocation seams, not certified tests.

### CFG02

[pnpm-workspace.yaml:1](/Users/carlos/Documents/Drogon-mentu-session/pnpm-workspace.yaml:1)

Desktop install deliberately has packages:[] so mobile is independent. Minimum release age 4320 minutes has two exact version exemptions, hoisting is enabled, OS/CPU support includes current and all declared desktop arches. allowBuilds explicitly permits selected native dependencies and denies others; override and eight exact version-to-patch paths are authoritative installation routing. Patch application failures remain package-manager failures, not behavioral RED. Patch body fidelity belongs the corresponding terminal/native owners.

### CFG03

[.oxlintrc.json:1](/Users/carlos/Documents/Drogon-mentu-session/.oxlintrc.json:1)

Root lint loads four local plugins and explicit correctness/error rules with selected warning/off exceptions; renderer scrollbar rule applies only renderer TS/TSX, and tests/specs/benchmarks disable selected runtime-style rules. File caps distinguish TS300/TSX400/MJS600/tests800 with comments/blank lines skipped. Cloud, cloud SQL composite action and frozen cross-version checkouts are excluded; root lint is not whole-repository validation.

### CFG04

[config/dev-app-update.yml:1](/Users/carlos/Documents/Drogon-mentu-session/config/dev-app-update.yml:1)

Updater development feed metadata selects GitHub provider, repository roles and cache name. Provision independent Drogon feed/cache identities; metadata presence does not prove update eligibility, download or rollback behavior.

### CFG05

[config/i18next.config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/config/i18next.config.ts:1)

Extraction selects renderer JS/TS source excluding tests/snapshots/assets, English only, named translation functions, no namespace/plural expansion, sorted removal of unused keys; output path can be overridden by environment and otherwise uses a temporary output. Extraction writes generated output and is not translation/runtime coverage proof.

### CFG06

[config/knip.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/knip.json:1)

Unused-code tool declares finite main/preload/daemon/worker/CLI/relay/script/test entries and project globs, excludes mobile/build/dependencies, ignores named tooling dependencies and entry exports. It is a static reachability configuration, not runtime or whole-import completeness.

### CFG07

[config/oxlint-code-quality-native-plugins.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-code-quality-native-plugins.json:1); [config/oxlint-code-quality-type-aware.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-code-quality-type-aware.json:1); [config/oxlint-react-doctor.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-react-doctor.json:1)

Dedicated configs turn categories off and enable named checks: import/cycle depth3, renderer accessibility, test title/focus/conditional assertions, mobile hook dependencies; type-aware await/redundancy/addition/templates and exhaustive-switch; external React Doctor cleanup/state/Zustand rules. Root native/type-aware commands deny warnings, while separate React Doctor invocations have different blocking behavior. Configured severity alone is not CI enforcement.

### CFG08

[config/tsconfig.node.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.node.json:1); [config/tsconfig.web.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.web.json:1); [config/tsconfig.tc.cli.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.tc.cli.json:1); [config/tsconfig.tc.web.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.tc.web.json:1); [config/tsconfig.cli.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.cli.json:1); [config/tsconfig.relay.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.relay.json:1); [config/tsconfig.e2e.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/tsconfig.e2e.json:1)

Node/web extend Electron toolkit projects, CLI uses Node16 modules with explicit source inclusions/output, tc.cli/tc.web specialize no-emit checking, relay has its own output and integration-test exclusion. Web uses React JSX and renderer/shared aliases. E2E config exists but its comment says not enforced; actual root typecheck helper excludes it. Include lists establish compilation entry membership, not imported-module behavior.

### CFG09

[config/scripts/run-typecheck-projects-in-parallel.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/run-typecheck-projects-in-parallel.mjs:1)

Starts installed TypeScript through process.execPath with --noEmit for node, tc.cli, tc.web, concurrent only above one available CPU. allSettled or serialized loop collects every failure; spawn error, signal or nonzero exit yields overall exit1. No E2E/relay project is included; no automatic remediation.

### CFG10

[config/vitest.config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/config/vitest.config.ts:1); [config/scripts/happy-dom-offscreen-canvas.ts:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/happy-dom-offscreen-canvas.ts:1); [config/scripts/happy-dom-mutation-observer-retention.ts:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/happy-dom-mutation-observer-retention.ts:1); [config/scripts/vitest-host-ports-setup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/vitest-host-ports-setup.ts:1)

Root Vitest runs Node with feature wall enabled, renderer aliases, six include patterns, 60s hooks/30s tests and Windows maxWorkers4. Three load-time setups install an idempotent 2D canvas fallback, retain mutation observers until disconnect, and create temporary user-data with fake host/secret ports reset before each test and removed afterAll. Tests may override ports. Fake encrypted prefixes distinguish encrypted state without proving OS keychain security; DOM shims do not prove native canvas or browser behavior. Cloud/mobile suites are separate.

### CFG11

[config/scripts/check-reliability-gates.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/check-reliability-gates.mjs:1)

JSONC checker validates schema1, policy numeric fields, unique IDs, maturity/protection/evidence status consistency, nonempty oracle/owner/criteria, existing test paths, literal command-to-file inclusion, no title selectors, assertionRefs membership, reported passed evidence and covered platform membership. Failure lists issues and returns1. It does not run commands, open assertion bodies, authenticate reported evidence, or enforce numeric soak thresholds against observed runs; a valid manifest is not acceptance.

### CFG12

[config/reliability-gates.jsonc:1](/Users/carlos/Documents/Drogon-mentu-session/config/reliability-gates.jsonc:1)

Inherited reliability declarations retain all gate IDs, suites, maturity, red/green claims and known gaps unchanged. Consumer is check-reliability-gates.mjs; this large evidence catalog is hashed as input, not re-audited gate by gate or promoted to current execution evidence.

### CFG13

[config/scripts/check-max-lines-ratchet.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/check-max-lines-ratchet.mjs:1); [config/scripts/check-ts-nocheck-ratchet.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/check-ts-nocheck-ratchet.mjs:1)

Read tracked files with git ls-files, excluding checker/self-tests; unreadable files are skipped. Parse newline baselines ignoring comments. Added or stale entries fail1. --init writes current entries; --prune writes only surviving baseline entries and still fails if new violations exist. Max-lines scans disable directives and mobile per-glob budget increases; ts-nocheck checks leading comment runs, not arbitrary text. These maintenance modes write source configuration and are not audit commands.

### CFG14

[config/scripts/check-runtime-electron-ratchet.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/check-runtime-electron-ratchet.mjs:1)

Bundles runtime, RPC and orcad entries with esbuild write:false, node20 target, native addons external, then reads metafile electron/subpath importers. Added or removed entries fail1 against baseline; --write replaces baseline. This is graph-specific source portability evidence, not actual plain-Node startup.

### CFG15

[config/max-lines-baseline.txt:1](/Users/carlos/Documents/Drogon-mentu-session/config/max-lines-baseline.txt:1); [config/ts-nocheck-baseline.txt:1](/Users/carlos/Documents/Drogon-mentu-session/config/ts-nocheck-baseline.txt:1); [config/runtime-electron-baseline.txt:1](/Users/carlos/Documents/Drogon-mentu-session/config/runtime-electron-baseline.txt:1)

Ratchet inputs interpreted by the three reviewed checkers, preserved byte-for-byte. Baseline membership permits historical exceptions only and does not attest to current type safety or runtime execution.

### CFG16

[config/localization-coverage-allowlist.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/localization-coverage-allowlist.json:1)

13 data entries identify filePath/kind/text/dynamic/count. audit-localization-coverage consumer compares multiplicity of exact signatures; extra occurrences fail --check, stale allowances are not rejected. This ratchet is not translated-string completeness.

### CFG17

[config/scripts/audit-localization-coverage.mjs:498](/Users/carlos/Documents/Drogon-mentu-session/config/scripts/audit-localization-coverage.mjs:498)

Entry parser accepts --json/--markdown/--check plus allowlist/output/source-root values, ignores unknown flags and tolerates missing values via fallback. Check compares candidate signature multiplicity with allowlist, returning1 for additions and0 otherwise; report mode prints or mkdir/writeFile output. Candidate extraction internals are outside this configuration-entry contract and no translation census is repeated.

### CFG18

[config/localization-audit.md:1](/Users/carlos/Documents/Drogon-mentu-session/config/localization-audit.md:1); [config/i18n-translation-source.md:1](/Users/carlos/Documents/Drogon-mentu-session/config/i18n-translation-source.md:1)

Inherited localization audit/design documents are preserved explanatory inputs, not executable CI gates or current translation evidence. No gate closure is inferred from historical confidence percentages or proposed PO migration.

### CFG19

[config/oxlint-plugins/app-store-performance.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-plugins/app-store-performance.mjs:1)

AST rules track named useAppStore imports and useShallow aliases; refuse no selector, identity selector or allocating returned expression without shallow wrapper. Optional calls are ignored, nested function returns are skipped and dynamic/aliased selector semantics are not evaluated. Reports lint diagnostics, never changes application state.

### CFG20

[config/oxlint-plugins/mobile-pairing-qrcode-import.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-plugins/mobile-pairing-qrcode-import.mjs:1)

Reports qrcode ImportDeclaration with any runtime specifier or bare import; type-only declaration/specifiers pass. Dynamic imports and other packages are not inspected.

### CFG21

[config/oxlint-plugins/quadratic-buffer-concat.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-plugins/quadratic-buffer-concat.mjs:1)

Finds literal Buffer.concat array calls under five loop node types, normalizes reference roots/wrappers, compares self-assignment or assigned loop-carried operands, and excludes loop-local declarations/spread secondary operands. Syntactic rule reports suspected quadratic accumulation without measuring runtime or proving alias identity.

### CFG22

[config/oxlint-plugins/renderer-scrollbar-style.mjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/oxlint-plugins/renderer-scrollbar-style.mjs:1)

Parses literal class tokens with variants/bracket nesting/important flags, requires approved scrollbar classes matching vertical-scroll variants or unconditional styling; inspects inline overflow axes and statically visible JSX spread objects/branches. Conditional/logical styling does not universally satisfy inline-style suppression. Reports only statically visible literals, without resolving dynamic CSS or rendered layout.

### CFG23

[config/docker/cli-launch-contract/Dockerfile:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/cli-launch-contract/Dockerfile:1); [config/docker/cli-launch-contract/run-cli-case.sh:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/cli-launch-contract/run-cli-case.sh:1)

Ubuntu24.04 default image accepts base/libasound overrides and installs Electron link libraries without FUSE/display, creates unprivileged account and enters shell case runner. Runner switches from root, verifies restricted-userns/nofuse preconditions (90), clears display or injects stale display, selects eight exact launcher/direct cases (unknown91), enforces timeout94/crash92 and version-content mismatch93. Normal command nonzero is printed as RESULT while wrapper returns0; host assertion must inspect embedded status. No actual launcher was run.

### CFG24

[config/docker/headless-pairing/Dockerfile:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/headless-pairing/Dockerfile:1); [config/docker/headless-pairing/Dockerfile.build:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/headless-pairing/Dockerfile.build:1); [config/docker/headless-pairing/run-appimage-case.sh:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/headless-pairing/run-appimage-case.sh:1)

Runtime Ubuntu image adds DBus/Xvfb, build image Node24-bookworm adds toolchain and pnpm12. Runner selects direct/Xvfb/DBus/journal, isolated temp HOME/config/cache, AppImage extraction or AppRun, optional no-sandbox/JSON/no-pairing and bind address/port. Unknown case64; keep-running execs indefinitely; otherwise timeout preserves command status and labels124. These fixtures create processes/profiles and are unrun.

### CFG25

[config/docker/headless-serve-shutdown/Dockerfile:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/headless-serve-shutdown/Dockerfile:1); [config/docker/headless-serve-shutdown/run-signal-case.sh:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/headless-serve-shutdown/run-signal-case.sh:1); [config/docker/headless-serve-shutdown/run-appimage-desktop-startup-case.sh:1](/Users/carlos/Documents/Drogon-mentu-session/config/docker/headless-serve-shutdown/run-appimage-desktop-startup-case.sh:1)

Digest-pinned Ubuntu fixture installs DBus/Xvfb and unprivileged runners. Signal runner accepts INT/TERM and app/AppImage/bundled launcher, waits schema1 ready line, verifies listener/tree/start-tick identity and owned Xvfb, optionally verifies registered CLI, then signals exact process/group and requires exit0, no listener/nonzombie descendants/residue/fatal logs while unrelated canary survives. Failure cleanup explicitly owns canary; full app cleanup on early failures is not guaranteed. Desktop runner validates readable executable AppImage, isolated owned temp path, 90s updater-setup marker and live owned Xvfb; EXIT cleans only identity-matching group/tree with TERM then KILL deadlines and guarded temp deletion on success. These are real process assertion bodies read as text, not executed OS proof.

### CFG26

[config/patches/xterm-upstream.json:1](/Users/carlos/Documents/Drogon-mentu-session/config/patches/xterm-upstream.json:1)

Regeneration manifest pins upstream revision, package versions/source patch/output mappings and esbuild/webpack/terser/TypeScript toolchain. Four packages regenerate lib output with sourcemaps; source version stamp is root-only. Development setup/esbuild-watch/dev scripts are forbidden after packaging to avoid overwriting production output. This is patch regeneration routing; compiled terminal behavior and provenance acceptance remain original suite/owner obligations.

### CFG27

[config/relay-assets/node-pty-1.1.0-console-list-agent-patch.cjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/relay-assets/node-pty-1.1.0-console-list-agent-patch.cjs:1); [config/relay-assets/node-pty-1.1.0-windows-pty-teardown-patch.cjs:1](/Users/carlos/Documents/Drogon-mentu-session/config/relay-assets/node-pty-1.1.0-windows-pty-teardown-patch.cjs:1)

Remote relay patch entries require node-pty1.1.0 and exact known source hashes, skip already-patched sources, reject unexpected bytes; write temporary per-file replacement then rename/finally remove temp and assert final hash. Windows teardown checks unique anchors and applies two files sequentially, so atomicity is per file, not whole patch; reconnect can finish known partial state. Console fallback catches AttachConsole failure and uses shellPid. Teardown deliberately releases conin after native kill, differing from desktop patch, and comments preserve an unresolved natural-exit leak; historical measurements are not rerun here.

### CFG28

[config/relay-assets/node-pty-1.1.0-master-cloexec-patch.cjs:340](/Users/carlos/Documents/Drogon-mentu-session/config/relay-assets/node-pty-1.1.0-master-cloexec-patch.cjs:340)

POSIX apply entry skips unsupported platform/earlier failure/unexpected source/missing usable binary, moves original build to backup, patches/rebuilds/probes, removes backup on success, and returns patched versus patched-unverified. Failure invokes rollback and writes one-attempt skip marker. Comment says never throws but backup removal/layout and rollback operations are outside or can escape catches; do not promise universal failure containment. Probe/rebuild internals remain native implementation seams, with exact reviewed entry range.

**RUN01 — [cloud/apps/relay-fence-broker/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-fence-broker/package.json:1).** Private ESM service; build deletes dist then TypeScript compiles, dev watches src/index.ts, start runs dist/index.js, test invokes Vitest and lint/typecheck invoke tsc --noEmit. Manifest routing does not certify broker mutation or identity enforcement.

**RUN02 — [cloud/apps/relay-ops/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/package.json:1).** Private ESM ops service; build cleans dist, compiles and copies public assets; dev watches index, start runs built index, incident-monitor and incident-live-preflight execute the reviewed TS entries. Vitest and no-emit TypeScript commands remain unrun.

**RUN03 — [cloud/apps/relay/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay/package.json:1).** Private ESM relay service; build cleans dist and compiles, dev watches index and start runs built index. pretest builds relay-contract before Vitest, so invoking its test script has build side effects.

**RUN04 — [cloud/apps/relay/vitest.config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay/vitest.config.ts:1).** Two Vitest projects use 15-second hooks/tests. Immediate src/*.test.ts files containing ORCA_CLOUD_TEST_POSTGRES_URL are assigned serial PostgreSQL execution; the remaining recursive src/**/*.test.ts project excludes that selected set. Nested database-dependent tests are not detected by the immediate-directory selector. Test-file content routing is not database execution proof.

**RUN05 — [cloud/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/package.json:1).** Independent cloud workspace requires Node >=24 <27 and pnpm >=10, pins pnpm10.24.0, and routes recursive build/lint/typecheck. pretest names 17 Node script/action test files; test then runs recursive app/package tests plus explicit script suites. Infra init/plan/apply and operational commands are mutation seams owned by service lead; no command was invoked.

**RUN06 — [cloud/packages/relay-contract/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/cloud/packages/relay-contract/package.json:1).** Private ESM contract package exports built JS and declaration files, with clean/TypeScript build, Vitest test and no-emit lint/typecheck. Consumers require its prebuild; missing dist is setup failure.

**RUN07 — [docs/site/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/docs/site/package.json:1).** Independent docs manifest uses Node22/pnpm10.24, Next16.3.4/React19.2.4 and Vercel59.11.1; dev/start use port3004. Both postinstall and prebuild execute MDX generation, while node --test selects tests/*.test.mjs. Native build allowlist and dependency overrides constrain install, not deployment identity.

**RUN08 — [mobile/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/mobile/package.json:1).** Independent Expo55/ReactNative0.83 application with native/emulator/mock/repro commands. postinstall builds terminal and Mermaid webviews; Vitest, typecheck, lint and format are distinct. Native simulator/device sessions are not implied by unit tests.

**RUN09 — [mobile/packages/expo-two-way-audio/package.json:1](/Users/carlos/Documents/Drogon-mentu-session/mobile/packages/expo-two-way-audio/package.json:1).** Private TS-entry Expo module exposes source main/types, tsc build, parent-mobile typecheck and Expo module build/clean/lint/test tools with peer dependencies. Manifest alone does not validate native audio behavior.

**RUN10 — [mobile/vitest.config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/mobile/vitest.config.ts:1).** Node Vitest roots in mobile, disables OXC tsconfig filtering because app excludes tests, uses vitest.setup, selects src TS/TSX tests and suppresses one deprecated renderer console message. It is not a native test environment.

**RUN11 — [native/computer-use-macos/Package.swift:1](/Users/carlos/Documents/Drogon-mentu-session/native/computer-use-macos/Package.swift:1).** Swift6 manifest requires macOS14 and declares core library, dependent executable and dependent test target under explicit directories. Host/version eligibility is source metadata, not permission or native execution proof.

**RUN12 — [tests/e2e/vitest.config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/tests/e2e/vitest.config.ts:1).** Node runner selects computer*.e2e.ts with 60-second test/hooks and fileParallelism=false because fixtures share real focus/clipboard. Must run only on explicitly admitted disposable desktop.

**RUN13 — [tests/playwright.config.ts:1](/Users/carlos/Documents/Drogon-mentu-session/tests/playwright.config.ts:1).** Stably Playwright wrapper selects E2E directory, global setup/teardown, 120-second tests, ten-second expectations, zero retries, CI forbidOnly and one worker versus local parallelism. Headless/headful projects partition @headful tests; traces/screenshots retain failures. Setup/build/profile effects belong existing fixture boundaries; configuration cannot establish a passing installed journey.

Remaining configuration allocation rows, including each generated cache, patch payload and inherited build entry, are preserved individually under `reconciliation.configurationAllocation` in the JSON. Their disposition records the exact consumer/reused boundary; it does not claim full payload behavior review.

## Actual assertion bodies versus unrun pointers

The following files were read as source, including setup and assertion bodies. Nothing was executed. Declaration-line anchors in the JSON make each body locatable; the descriptions below limit the association to what the assertions actually check.

**[cloud/apps/relay-ops/src/incident-monitor-cli.test.ts:114](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/incident-monitor-cli.test.ts:114)** — Six bodies validate selector/duration/interval/policy input cases; a fake collector and clock with real temporary files assert return0, private modes, checkpoints [0,5,15], no token in output, green16 and completed persisted state; recovery fixture accepts inactive source but does not inject a blocked condition despite its title; waiting801 freezes after one sample/code2; restart rejects existing or mismatched generation and retains freeze; two-sample segment returns0 incomplete then restart completes same window.

Collector and time are injected; no real Google/provider/OS-monitor evidence. Temp directory cleanup has filesystem effects. Not run.

**[cloud/apps/relay-ops/src/incident-live-preflight-cli.test.ts:139](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/incident-live-preflight-cli.test.ts:139)** — Thirteen bodies check optional separator, fresh green state, old lineage, exact wave age limits and one-ms-over refusal, invalid/duplicate wave flags, generation+2 lineage, CPU0.9 refusal, strict inactive-source refusal versus recovery acceptance and blocked1 refusal, capacity target binding, stale sample refusal, freshness-only three-attempt success/two waits, threshold zero retry, five stale attempts/four waits, and supplied token bypass of minting.

Collector/time and temporary state injected. Does not exercise cloud authorization or real time. Not run.

**[cloud/apps/relay-ops/src/gcloud-client.test.ts:5](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/gcloud-client.test.ts:5)** — Two bodies assert three concurrent access-token requests plus cached read produce one exact exec call and equal token values; repeated same-audience identity reads produce one command with audiences and include-email arguments.

Mock exec; no gcloud invocation or token authenticity proof. Expiry, failure recovery and concurrent identity requests remain uncovered. Not run.

**[cloud/apps/relay-ops/src/dashboard-snapshot.test.ts:31](/Users/carlos/Documents/Drogon-mentu-session/cloud/apps/relay-ops/src/dashboard-snapshot.test.ts:31)** — Two cache bodies use TTL0: good snapshot followed by credential failure on a different requested window retains prior connection value7 with stale reason; a throwing collector similarly returns stale data without leaking sensitive exception context.

Snapshot builder injected; not an assertion over actual inventory/metric assembly, pagination or zero-filling. Not run.

**[cloud/dev/scripts/relay-production-identity-boundaries.test.mjs:14](/Users/carlos/Documents/Drogon-mentu-session/cloud/dev/scripts/relay-production-identity-boundaries.test.mjs:14)** — Seven bodies assert retired identity names absent and exact reader workflow set; monitor has dedicated pair; multi-target fence/supersede text has required modes, identity, broker, exact-cell and optional recovery gates; Terraform provider/account/broker resource text contains required fields and no public invoker; named outputs exist; live-preflight snippets pass minted token; broker Dockerfile names Terraform1.15.8.

Predominantly source-string regex assertions and exact list checks, not denied OIDC/IAM executions or mutation rollback fixtures. Read as text and not run.

**[cloud/dev/scripts/workload-identity-attribute-conditions.test.mjs:84](/Users/carlos/Documents/Drogon-mentu-session/cloud/dev/scripts/workload-identity-attribute-conditions.test.mjs:84)** — For staging and production, rendered provider roots/keys and complete condition strings equal expected objects; every condition remains <4096 chars, contains repository/main/environment pins, uses equality rather than startsWith/endsWith/matches/in, and relay provider conditions contain only the accepted public-repository arm. Missing private apps Terraform root is filtered from expected roots rather than asserted present.

Real renderer helper association is visible but helper not invoked. Exact text does not prove cloud CEL evaluation or IAM policy deployment. Provisioned identity expectations must be reprovisioned with explicit new golden expectations, not silently discarded.

**[cloud/dev/scripts/relay-staging-deploy-identity.test.mjs:70](/Users/carlos/Documents/Drogon-mentu-session/cloud/dev/scripts/relay-staging-deploy-identity.test.mjs:70)** — Nine bodies assert no shared staging deploy pair; exactly five relay workflows use dedicated pair; production Asia arm stays production; exact five provider refs and equality/main/staging constraints; rendered condition <4096 and exactly791 characters; exact ten grant families plus justifying comments, exact state/lock objects, objectViewer not admin/prefix and sole project compute.viewer; auth service gate, environment-conditional deploy account and output names.

Source regex/list/length checks, not live IAM denial. Literal upstream condition length and identities are source expectations to preserve separately from independent-Drogon corrections. Not run.

The Docker signal/startup/CLI cases under CFG23–CFG25 also contain real shell assertions described above; their process, profile and signal effects were read, never executed. The cloud package's complete explicit pretest/test script pointers are retained in `unrunTestPointers`. Except the three body-reviewed identity files above, those are invocation pointers only. The original app, relay, mobile, docs, Swift, Playwright and native suites remain allocated and unchanged.

Source defect and intended correction must remain separate. For example, retain the exact upstream identity-text assertions, then deliberately replace provisioned identity expectations for independent Drogon with a documented correction and its own denied-caller fixtures. Do not silently delete assertions, turn skips into pass or mock missing candidate behavior.

## Leaf lifecycle and corrections

One approved depth-2 leaf was launched using the documented `opencode --model alibaba-token-plan/deepseek-v4-flash-0731 --auto` invocation. Task `task_78512fb1715b` / dispatch `ctx_121258bcc538` completed with worker_done `msg_875350bf8e1b`. Release receipt `c494e2c8-a09a-4d8a-bdf2-df29434df8ce` reports retained external terminal and no process action; ownership is settled/released. No further child or alternative identity was used. The custom attach receipt does not authenticate an effective model; TUI/self-description is not model proof.

The leaf reported read-only `git rev-parse`/`git hash-object` despite the no-Git instruction. This deviation was reported to root in `msg_c600a1ca76b0`; no Git write was reported and the lead ran no Git. The leaf also incorrectly claimed that no test pointers existed. The actual infra test bodies above supersede that claim. Further corrections are explicit:

- Narrow roles constrain listed permission families, not all possible same-family mutations or grants attached elsewhere; application admin effects require service-boundary review.
- Startup EXIT deletes two temporary paths, not all retained container environment data; force-replacing containers is not transactional rollback or universally safe idempotence.
- Terraform variable comments and required/default values are not all validation rules; initial admission flags are not live state or the exclusive activation mechanism.
- Provider compatibility ranges and lockfile presence are not verified resolved versions; backend state and secret rollback cannot be proven from declarations.

## Proposed closure and exact remaining work

Propose **entry-source reconciliation ready for root review** for these two omissions. There are no unassigned remaining entry IDs within the stated finite scope. This proposal is conditional on root accepting the explicit implementation seams below; it is not a blanket full-source closure claim.

- SEAM-CLOUD: cloud/dev/scripts deployment/infra/power internals and relay stores, concurrent service lead
- SEAM-PATCH: native/xterm patch payload semantics and complete native patch probe/rebuild internals, existing terminal/native owner suites
- SEAM-LOCALIZATION: full translation inventory and extraction AST semantics remain original localization owner; this audit resolves entry/allowlist behavior
- SEAM-GENERAL-SCRIPTS: root package/workflow command targets retain original work-package ownership; not a new blanket claim that all 454 scripts were read

Original source baseline, faithful assertion ports and real candidate acceptance remain separate debt. Each CI/INF/OPS row supplies its exact missing refusal/failure/no-op case; the JSON retains all 52 workflow matrices and nine operational matrices. Infra acceptance still needs rendered denied-caller and exact state-object fixtures, additive/forbidden plan cases, startup partial failures, backend selection/isolation, secret rotation, alerts and staged rollback. Configuration acceptance still needs selector/exclusion parity, actual lint severity, malformed reliability data, ratchet maintenance modes, allowlist multiplicity, partial patch recovery and disposable process ownership/canary cleanup.

Future suite entry commands, **not executed and not authorized for this audit**, are recorded below. They require root-admitted disposable source/candidate environments and side-effect review; invoking an existing test command may build, install native ABI, create temp profiles/processes or require provider fixtures.

```text
pnpm --dir cloud test
pnpm --dir cloud/apps/relay-ops exec vitest run src/incident-monitor-cli.test.ts src/incident-live-preflight-cli.test.ts src/gcloud-client.test.ts src/dashboard-snapshot.test.ts
node --test cloud/dev/scripts/relay-production-identity-boundaries.test.mjs cloud/dev/scripts/workload-identity-attribute-conditions.test.mjs cloud/dev/scripts/relay-staging-deploy-identity.test.mjs
pnpm exec vitest run --config config/vitest.config.ts
pnpm --dir mobile test
pnpm --dir docs/site test
swift test --package-path native/computer-use-macos
pnpm exec playwright test --config tests/playwright.config.ts
```

Independent Drogon needs new repository numeric identities and trust pairs, state buckets/projects, service accounts, secret material and names, artifact/update repositories, signing identities, app distribution registrations, public origins/DNS, monitoring channels and telemetry destinations. Upstream names here identify roles and source contract seams; no credential, environment value or destination is an instruction to transfer a production resource. Provisioning and live policy verification remain implementation acceptance tasks.

## Validation

Data-only validation found zero errors across the exact 22/18 inherited omission sets, the 52+6 workflow partition, all 15 runner allocations, 172 distinct source fingerprints and 221 inclusive ranges. All ten referenced pre-existing document fingerprints remain unchanged. These totals include metadata and reused boundaries; they are not counts of newly proven behavior. No source module or test was executed, and frozen prior reports were not edited.
