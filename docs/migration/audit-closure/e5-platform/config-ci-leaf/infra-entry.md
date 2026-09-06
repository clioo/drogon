# E5 leaf: config/CI infra entry — O-INFRA-OPS first 14 paths, full-body source semantics

Candidate leaf source audit, **not** closure. The E5 lead independently reviews
this evidence and owns aggregate `report.md` / `closure.json`. This leaf never
ran, built, deployed, signed, installed, solved Terraform or touched any cloud
service. It reports live depth/invocation evidence without treating
self-description as authentication.

- Task `task_78512fb1715b`, Dispatch `ctx_121258bcc538`, leaf terminal
  `term_c469ce94-bf2b-4ba0-ba12-06cb450de4b5`, coordinator terminal
  `term_06b0aa79-c95c-4be8-826e-7fc44e92ad71`.
- **Live depth/invocation evidence:** dispatcher preamble states explicitly
  "Audit-only depth2 leaf, NO descendants", provides task/dispatch/terminal IDs
  and a dispatch capability; the OpenCode launch is the user-authorized
  `--auto` invocation (`--model alibaba-token-plan/deepseek-v4-flash-0731`),
  with explicit denies still enforced. The reported model name is
  self-description in the preamble, not a server-authenticated model certificate.
  No child Run was created and no delegation was attempted; leaf, no descendants.
- Source read-only: `/Users/carlos/Documents/Drogon-mentu-session` pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (`git rev-parse HEAD` read-only;
  the only dirty path is an unrelated untracked `.mentu/plans/...` file, not
  any reviewed path). `git hash-object` (read-only, no objects written) shows
  each reviewed file's working bytes match the pinned blob. Root owns pinned
  Git-blob verification; this leaf's `rev-parse`/`hash-object` calls are
  not presented as a cleanliness proof.
- No credential value, provider transcript, deploy/signing execution, install,
  source import into the rewrite, Git write, background service or global
  setting was touched. No test was executed by this leaf.
- **Scope:** exactly the **first 14 paths** of `O-INFRA-OPS` in
  `docs/migration/audit-closure/e5-platform/followup-remaining-platform.json`,
  resolved in the listed order as INF01–INF14 (all full-body reads). The
  remaining 4 `O-INFRA-OPS` paths (`cloud/apps/relay-ops/src/...`) are
  lead-owned. Deployment scripts/stores (`O-CLOUD-STATE`) are the concurrent
  service lead's; not duplicated here. CI/workflow bodies are lead-owned.
  Machine companion: `infra-entry.json` (same directory).

## Read-tier honesty (what was actually opened vs. what is asserted from prior evidence)

**Full-body reads this leaf (14/14):**
`relay-github-actions.tf` (1–669), `relay-asia-proof-iam.tf` (1–79),
`relay-asia-topology-iam.tf` (1–207), `relay-staging-deploy-iam.tf` (1–170),
`relay-gce-startup.sh.tftpl` (1–136), `relay-database.tf` (1–54),
`relay-dns.tf` (1–47), `relay-observability.tf` (1–525),
`variables.tf` (1–480), `versions.tf` (1–27),
`environments/production.tfvars` (1–410), `environments/staging.tfvars` (1–83),
`backend/production.hcl` (1–3), `backend/staging.hcl` (1–3). Inclusive line
anchors, full-file and range SHA256 for every entry are in the JSON companion.
Each file is newline-terminated, so the inclusive range 1–N hash equals the
full-file hash.

**Named seams (referenced but NOT read this leaf):** `relay-shared.tf`
(shared locals used below), `relay-github-workflow-trust.tf` (workflow
condition strings), `relay.tf` (runtime/director service accounts and Cloud
Run services), `relay-gce-cells.tf` (GCE cell resources and startup template
inputs), `relay-gce-foundation.tf`, `outputs.tf`, `relay-fence-broker.tf`,
`.terraform.lock.hcl` (provider checksum pin), the `infra/terraform-apps`
staging root, out-of-band DNS records and the Relay/ops GitHub workflows that
consume these identities. Those are the lead's or another owner's named
boundaries, not claims made here.

**No test pointers exist for these 14 paths.** A filesystem search found no
test file referencing any reviewed Terraform path and no Terraform runner test
(`*_test.go`, `.tftest*`) under `cloud/infra`. There are consequently no
"unrun pointers" to distinguish: the missing artifact is a missing fixture
capability, not an unchanged pointer.

---

## INF01 — `cloud/infra/terraform/relay-github-actions.tf` (1–669)

**Role.** The relay root's GitHub Actions identity surface: workload identity
providers on the foundation-owned pool, per-role service accounts,
WorkloadIdentityUser grants, deploy/capacity artifacts grants, and the exact
staging/production custom roles. Two identities are production-only
(`relay_create_production_ops_identity`) and the capacity identities are
environment-partitioned (`create_{staging,production}_relay_capacity_identity`).

**Declarative inputs.** `var.project_id`, `var.region`, `var.environment`,
`var.name_prefix`, `var.artifact_repository_id`,
`var.relay_cloud_run_service_name`, `var.relay_fence_broker_service_name`;
from `relay-shared.tf` (not read here): pool ID/name, primary and accepted
repository sets, leading-repository/ref/environment claim strings, workflow
condition map, deploy-identity gate and deploy service account member local;
from `relay.tf`: `relay_runtime` and `relay_director_runtime` service accounts.

**Identity/providers (all OIDC issuer `https://token.actions.githubusercontent.com`).**
Attribute maps copy asserting claims; every provider pins `google.subject =
assertion.sub` plus repository/ref/environment and a literal
`attribute.relay_ops_identity` string per role.
1. `github` (production): ref==main, environment==production, exact
   workflow-ref allowlist for the seven production relay workflow files, plus
   the rehome caller/job pair (caller must at `.yml@refs/heads/main`, rehome
   requires job_workflow_ref match) and the same-cap caller/job pair. The
   allowlist bullets the exact file names carried by the relay repository,
   rendered under every repository-ref prefix.
2. `github_monitor` (production: `monitor-relay-production.yml` caller +
   `monitor-relay-production-job.yml` job).
3. `github_fence` (production: `deploy-relay-production-multi-target.yml` both
   caller and job).
4. `github_staging_relay_capacity` (staging): the three staging capacity
   workflow files under `github_staging_relay_capacity_workflow_files`.
5. `github_production_relay_capacity` (production): the capacity
   caller/job pair and the same-cap caller/job pair.

**Service accounts.** GitHub deploy/monitor/fence (`-gha-deploy`,
`-gha-monitor`, `-gha-fence`; production), staging/production capacity
(`-gha-cap`; per environment). Role descriptors: deploy "Deploys Orca Cloud
from GitHub Actions"; monitor "Reads aggregate Relay production telemetry";
fence "Requests exact reviewed Relay cell fences through the private broker";
capacity "Runs the exact reviewed Relay {staging,production} capacity
workflow".

**Binding/roles.**
- `roles/iam.workloadIdentityUser` on each account. GitHub deploy is bound via
  the repository attribute (`principalSet://…/attribute.repository/<primary
  repo>`), and each additional accepted repository gets its own binding
  (slice of accepted names beyond index 0; empty redundant when only the
  primary is present). Monitor/fence/capacity accounts are bound via
  `attribute.relay_ops_identity/<literal>`.
- Deploy account: `artifactregistry.writer` (repository), `run.developer`
  (relay director and fence broker services), project roles `compute.viewer`,
  `monitoring.viewer`, `logging.viewer`, `cloudsql.viewer`, and a GCS
  `storage.objectViewer` over the `${project_id}-terraform-state` bucket —
  read-only by the candidate-preflight/`github_terraform_state_reader`
  rationale, deliberately without state mutation.
- Staging mirror writer: literal-email member to the artifact registry
  `artifactregistry.writer` (staging-only), separate from the local deploy
  member form.
- Monitor account: project `monitoring.viewer`, `logging.viewer`,
  `cloudsql.viewer`, `compute.viewer` (aggregate telemetry/inventory, no
  mutation).
- Fence account: the same four project viewers; mutation is intentionally not
  granted outside the broker path.
- Staging power custom role `orcaRelayStagingPower` (staging-only, created
  only when `create_staging_relay_power_role`): exact permission list —
  `cloudsql.instances.get`, `cloudsql.instances.update`,
  `cloudsql.operations.get`, `compute.instanceGroupManagers.get`,
  `compute.instanceGroupManagers.update`, `compute.zoneOperations.get`.
  Comment states it must never be created in production.
- Staging capacity mutation custom role `orcaRelayStagingCapacity`:
  `compute.disks.create`, `compute.healthChecks.use`,
  `compute.images.useReadOnly`, `compute.instanceGroupManagers.get/update`,
  `compute.instances.create`, `compute.instances.setLabels/setMetadata/setTags`,
  `compute.instanceTemplates.create/delete/get/useReadOnly`,
  `compute.networks.use`, `compute.subnetworks.use`,
  `compute.zoneOperations.get`. Plus project `roles/viewer`,
  `artifactregistry.reader`, `run.developer` on the relay service.
- Production capacity mutation custom role `orcaRelayProductionCapacity`: the
  identical compute permission list, plus project `roles/viewer`,
  `artifactregistry.reader`, `run.developer`.
- State IAM: both capacity accounts get storage `objectAdmin` over the GCS
  state bucket via **IAM condition on exact object names** — only
  `…/terraform/state/default.tfstate` and `…/terraform/state/default.tflock`
  in the environment bucket. No other object is writable.
- `roles/iam.serviceAccountUser` to `relay_runtime` for both capacity accounts
  and `github_relay_runtime_service_account_user`, and to
  `relay_director_runtime` for the deploy account. Comment: image-only deploys
  retain the Terraform-owned runtime identity and service shape.

**Failure/refusal.** Any workflow whose ref, environment or job/caller pairing
falls outside its provider's exact allowlist cannot mint an identity: OIDC
token validation fails at the provider. Conditions pin `refs/heads/main`, the
correct environment, and workflow-file clauses so the same pool cannot grant
another workflow or branch. State-conditioned bindings refuse access to any
other object of the shared bucket.

**Rollback.** All resources are count-conditional on environment/identity
gates: flipping the gate or `count` to zero destroys the binding/account in
the next apply; provider allowlists are rendered from locals, so removing a
workflow file from the list revokes it. Terraform owns the state transitions;
no separate rollback step exists in this file.

---

## INF02 — `cloud/infra/terraform/relay-asia-proof-iam.tf` (1–79)

**Role.** Staging-only read-only identity for the Asia proof workflow.

**Inputs/conditions.** `create_relay_asia_proof_identity` = deploy-identity
gate AND environment==staging. Provider `github-relay-asia-proof` maps
subject + repository/ref/environment/event/relay_ops_identity, with literal
`attribute.relay_ops_identity = 'staging-asia-proof'`; condition requires
refs/main, staging, `workflow_dispatch`, leading-repository claims and the
exact `prove-relay-asia-staging.yml` clause from the shared workflow condition
map.

**Account/roles.** Service account `-gha-aproof` ("reads staging telemetry and
performs only Relay's bounded Asia proof operations"), bound with
`workloadIdentityUser` via `attribute.relay_ops_identity/staging-asia-proof`.
Project roles: **only** `logging.viewer` and `monitoring.viewer`. The
`relay_asia_proof_service_account_email` local (`try(...,"")`) feeds other
roots/consumers downstream.

**Failure/refusal/rollback.** No compute mutation permission exists for this
identity by construction; the bounded proof surface is observation only.
Refusal: token minting requires exactly the one workflow, on main, via
workflow_dispatch, in staging. Rollback: count-conditional creation; staging
off means no resources.

---

## INF03 — `cloud/infra/terraform/relay-asia-topology-iam.tf` (1–207)

**Role.** Environment-parameterized identity ("Asia topology") for the
additive Asia network/cell topology workflow, in the environment carrying
`deploy-relay-asia-topology.yml`.

**Inputs/conditions.** Gate = deploy-identity gate (environment literally via
`var.environment`). Provider `github-relay-asia` uses literal
`relay_ops_identity = '<env>-asia-topology'`, requires refs/main, matching
environment, `workflow_dispatch`, leading-repository claims and the single
topology-workflow clause. Account `-gha-asia` ("Applies only validated
additive Relay Asia topology plans"), bound via the env-qualified identity
attribute.

**Custom roles (exact permissions).**
- `orcaRelayAsiaTopology` (mutation): `compute.backendServices.create/get/update/use`,
  `compute.disks.create`, `compute.globalOperations.get`,
  `compute.healthChecks.use/useReadOnly`, `compute.images.useReadOnly`,
  `compute.instanceGroupManagers.create/get/update`,
  `compute.instanceGroups.create/get/use`, `compute.instances.create/use`
  and `setLabels/setMetadata/setTags`,
  `compute.instanceTemplates.create/get/useReadOnly`,
  `compute.networks.get/updatePolicy/use`, `compute.regionOperations.get`,
  `compute.routers.create/get/update`, `compute.subnetworks.create/get`
  plus `setPrivateIpGoogleAccess/use`, `compute.urlMaps.get/update`,
  `compute.zoneOperations.get`.
- `orcaRelayAsiaTopologyRead`: `artifactregistry.repositories.get`,
  `cloudsql.instances.get`, compute `backendServices/healthChecks/
  instanceGroupManagers/instanceGroups/instanceTemplates/instances/networks/
  routers/subnetworks/urlMaps` get, `iam.serviceAccounts.get`/`getIamPolicy`,
  `resourcemanager.projects.get`/`getIamPolicy`, `run.revisions.get`,
  `run.services.get`, `secretmanager.secrets.get`/`getIamPolicy`,
  `serviceusage.services.get/list`. Read role keeps plan/refresh scoped.
- `orcaRelayAsiaStateList`: `storage.objects.list` only (backend
  initialization — bucket list without object data access).

**Other bindings.** `artifactregistry.reader` (repository);
`storage.objectAdmin` over the GCS state bucket conditioned to the exact
`default.tfstate`/`default.tflock` objects; bucket `storage.objects.list`
member via the custom state-list role; `iam.serviceAccountUser` on
`relay_runtime`.

**Failure/refusal/rollback.** Same OIDC allowlist/ref-env/event refusals;
mutations bounded to the additive topology roles; a failed plan/apply that
touches unrelated resources is refused at the IAM layer by the narrow
permission list (no broad editor/owner). Count-conditional construction.

---

## INF04 — `cloud/infra/terraform/relay-staging-deploy-iam.tf` (1–170)

**Role.** Staging-only deploy identity replacing, for the five staging relay
workflows, grants the apps root previously gave the shared staging deploy
account. Header comment: bindings already made to
`relay_github_deploy_service_account_member` (staging power role,
serviceAccountUser on runtime/director, regional-placement secret bindings)
are declared in `relay-shared.tf` and intentionally not repeated here.

**Inputs/conditions.** Gate = deploy-identity gate AND staging. Exact
workflow allowlist of five workflow files (`bootstrap-relay-staging-capacity`,
`deploy-relay-staging-gce-candidate`, `deploy-relay-staging`, `operate-relay-asia-admission`,
`power-relay-staging`). Provider `github-relay-deploy` with literal
`relay_ops_identity = 'staging-deploy'`; comment is explicit: allowlist of
exact workflow refs, never a prefix, because "a namespace grant would hand
this account to any future staging workflow with no Terraform diff."
`staging_auth_runtime_service_account_email` local derives the shared staging
auth service's runtime account from name prefix + project (role only; value not
reproduced).

**Account/roles.** `-gha-relay` ("Runs the exact reviewed Relay staging deploy,
candidate, power, and admission workflows") + `workloadIdentityUser` via the
staging-deploy identity attribute.
- GCS `roles/storage.legacyBucketReader` (bucket metadata/list for
  `terraform init`, no object access — mirrors the fence-broker bucket reader).
- GCS `storage.objectViewer` over the exact default state/lock objects
  (conditional) for reviewed-topology reads (`terraform output -json` /
  console binds); no step in the five applies, so objectViewer not objectAdmin.
- `artifactregistry.reader` (mirrored-immutable-image proof via image
  describe; nothing writes the repository).
- `run.developer` on the staging relay director service (blue/green, additive
  director topology, scale-to-zero path).
- `run.developer` on the shared staging auth service plus
  `iam.serviceAccountUser` on its runtime account — both gated on
  `relay_staging_power_auth_service_name != ""`; the power workflow's
  scale-to-zero mints a revision and Cloud Run gates it on actAs over the
  runtime account.
- `compute.viewer` (GCE candidate inspectCell preflight; the power role's
  instanceGroupManagers.get does not cover MIG/backend-service reads).

**Failure/refusal/rollback.** Non-allowlisted workflows are refused at the
provider; no apply authority exists here (objectViewer, developer-only).
Count-conditional creation; the auth-service gate means power coverage is
absent until the auth service name is set.

---

## INF05 — `cloud/infra/terraform/relay-gce-startup.sh.tftpl` (1–136)

**Role.** GCE cell bootstrap script (COS, bash, `set -euo pipefail`): fetch
metadata token, read two secrets from Secret Manager, render the cell
environment file, pull images, start the Cloud SQL Auth Proxy and the relay
containers, start the logging agent — all without a long-lived registry
credential. Direct **provider seams**: GCE metadata server
(`http://metadata.google.internal/...` with `Metadata-Flavor: Google`);
Secret Manager REST API (`/v1/projects/<project>/secrets/<name>/versions/latest:access`);
Artifact Registry Docker login (`docker login … oauth2accesstoken`);
Cloud SQL Auth Proxy (unix socket under the state dir); `systemctl`
(systemd) for docker and logging-agent targets.

**Template inputs (interpolated by owning Terraform, roles only):** the GCP
project, two secret names (relay database credential; relay assignment signing
key), cell URL, auth issuer, cell id, optional cell region, capacity requests,
optional database pool max, optional connection hard cap and unobserved bound,
director URL, the deploy/capacity/Asia-proof/runtime service accounts, optional
rehome director account and audience, the digest-pinned relay image and its
registry host, the digest-pinned Cloud SQL proxy image, and the Cloud SQL
connection name; conditional flags (`include_cell_region`, `include_database_pool_max`,
`connection_hard_cap != null`, `asia_proof_service_account != ""`,
`rehome_source_enabled`). `$${…}` escapes keep shell variables literal.

**Effects.** Sets `0700` state/docker-config dirs and `0777` cloudsql dir;
starts docker and waits up to 60s; obtains a metadata access token (fails on
empty); reads/decodes the two secrets (fails on empty encoded data); writes
the env file under `umask 077` with: `DATABASE_URL`, the assignment signing
key, public/cell URLs, auth issuer/audience (`orca-relay` literal) and JWKS
URL, `ORCA_RELAY_ROLE=cell`, cell id/region/capacity (conditionals), cells
JSON literal `[]`, admin/heartbeat audiences under the director URL drain and
cell-heartbeat paths, the deploy/capacity/Asia-proof/runtime service-account
envs, optional rehome envs, director URL, and an image digest derived from the
image's `@sha256:…` suffix via `regex`. Logs in to the registry with the short
token, pulls the relay image, logs out, unset the token, pulls the proxy
image; force-removes prior containers; deletes any stale proxy socket; runs
the proxy container (no-new-privileges, cap-drop ALL, restart always, user
0:0, shared cloudsql volume, unix-socket mode against the connection name);
waits up to 60s for the `.s.PGSQL.5432` socket; runs the relay container
(no-new-privileges, cap-drop ALL, publish 8080, stop-timeout 300, env-file),
then starts the logging agent.

**Failure/refusal/rollback.** `set -euo pipefail` halts on any failed command;
the **EXIT trap removes the env file and docker config dir**, so neither the
plaintext environment nor the pull credential survives bootstrap (COS mounts
/root read-only — no durable copy exists). Empty token, empty secret payload,
missing socket after the wait loop, and a final non-reachable docker all abort
the run. Any unfinished startup leaves the VM unready (healthcheck/pool treat
the cell as down); re-runs are idempotent because containers are force-removed
and sockets deleted first. The database URL and relay role literals mean the
cell cannot be adopted by a different environment without a template change.

---

## INF06 — `cloud/infra/terraform/relay-database.tf` (1–54)

**Role.** Relay database/principal/credential: isolated database on the shared
existing Cloud SQL instance with `local.relay_database_instance_name` and
`local.relay_database_connection_name` (from `relay-shared.tf`), plus a
Secret Manager-stored connection URL read only by the two relay runtime
accounts.

**Effects.** `google_sql_database orca_relay`; `random_password` (32 chars,
`special=false`); `google_sql_user orca_relay` with that password; secret
`orca-cloud-relay-database-url` (auto replication) with a version whose data
is the formatted `postgresql://user:pass@/<db>?host=/cloudsql/<connection
name>` URL; `secretmanager.secretAccessor` granted to `relay_runtime` and
`relay_director_runtime` service accounts.

**Failure/refusal/rollback.** Declarative: any drift between the password,
secret text, and the URL format regresses the connection. Changing the
password rolls the secret version and the applications must reconnect;
rollback is a TF state change (re-apply previous password/labels). No other
principal is granted the URL accessor; the Cloud SQL instance itself is
owned elsewhere (shared, not defined here).

---

## INF07 — `cloud/infra/terraform/relay-dns.tf` (1–47)

**Role.** Cloud Run custom-domain mappings (the only DNS-relevant pieces this
root owns). DNS records pointing at Google's `ghs.googlehosted.com` and the
auth/artifact records are explicitly managed outside this root.

**Effects.** Local `relay_fqdn` (scheme stripped from `relay_base_url`) and a
per-cell FQDN map (scheme stripped from each cell URL). `google_cloud_run_domain_mapping`
for the relay (count 1 when `manage_relay_domain_mapping`) routing to
`google_cloud_run_v2_service.relay`, and one per relay cell routing to
`google_cloud_run_v2_service.relay_cell[each.key]`. The relay mapping carries
`lifecycle.ignore_changes` on `spec[0].certificate_mode` because a gcloud-created
mapping reports an empty legacy certificate_mode even though Google provisions
the same automatic certificate — forcing it would reset issuance for no
behavioral change.

**Failure/refusal/rollback.** Domain mapping only exists when the manage flag
is on (production/staging both set it true). Certificate issuance and renewal
are Google-owned; the live authoritative DNS records are out-of-band. Removing
the mapping reverts to default Hostname verification; no records are edited by
Terraform here.

---

## INF08 — `cloud/infra/terraform/relay-observability.tf` (1–525)

**Role.** Relay logging metrics and alerting: per-service log filters, a
DELTA/DISTRIBUTION snapshot metric for runtime gauge fields, DELTA/INT64
incident metrics, and monitoring alert policies with Cloud Run + GCE limbs.

**Effects.**
- `relay_runtime_log_filter`: cloud-run-revision service filter (union over
  director + cell service names) OR `gce_instance` with `jsonPayload.role="cell"`,
  AND `jsonPayload.event="orca_relay_runtime_metrics"`.
- Snapshot metric per runtime field from the `relay_runtime_metrics` map
  (e.g. total connections, controls, splices, pending splices, queued bytes,
  HTTP/SQL latency, control renewal latency buckets/attempts/successes/lease
  misses/recoveries, heap, event loop p99, forwarded bytes, auth successes/
  failures, reconnects, SQL queries/failures, db pool total/idle/waiting,
  waits/oldest wait), `value_extractor = EXTRACT(jsonPayload.<field>)`,
  label extractors role/cell_id/region, exponential buckets (24, growth 2,
  scale 1), metric unit "ms"/"By"/"1" by field class.
- Incident metrics (`relay_incident_metrics`): assignment 5xx, assignment edge
  429 (assign/resolve), postgres retry, postgres retry exhausted — each with
  its exact filter expression over the director service or GCE instances.
- `relay_custom` alert policy `for_each`: `connection_headroom`,
  `queue_pressure`, `auth_failures`, `reconnects`, `sql_failures`, `sql_latency`,
  `database_pool_waiters`, `database_pool_wait`, `http_latency`, `heap_pressure`,
  `event_loop_delay` — each with a reviewed threshold (Cloud Run and, except
  connection_headroom, a GCE-cell limb), `ALIGN_PERCENTILE_99`/`REDUCE_MAX`,
  duration, group_by service/instance, and `notification_channels` only for the
  `pages_oncall` subset (`var.relay_alert_notification_channels`; empty list =
  visible but not paging). Threshold basis: `connection_headroom` GCE warning
  per cell derives from `(hard_cap - 100 - unobserved_bound) * 0.85`
  (or 550 when no cap); the Cloud Run headroom was set live to sit ≈85% of the
  modeled usable connection units. Exact numeric thresholds are environment
  calibration and are pinned by the range hash, not reproduced here.
- Remaining policies: `relay_assignment_5xx` (ALIGN_SUM/REDUCE_SUM, runs on
  any service), `relay_assignment_edge_429` (threshold 100), per-GCE-threshold
  `relay_gce_connection_headroom` policies grouped by equal computed
  thresholds, `relay_postgres_retry_exhausted` (Cloud Run + GCE legs), and
  `relay_cloud_sql_backends` (Cloud SQL `num_backends` above the reviewed
  backends value on the relay's shared instance). Each carries
  `documentation` content (runbook role) and `depends_on` the metric it reads.
  Comments record that several thresholds were tuned live to stop Slack noise
  and are codified so an apply cannot revert them.

**Failure/refusal/rollback.** Metrics/policies are always-enabled declarative
resources; `notification_channels` emptiness or the single page-on-call subset
controls paging. Wrong/missing metric events simply produce no series; alert
fire is a monitoring-side outcome, never a mutation. Removing an entry from a
map destroys that policy/metric.

---

## INF09 — `cloud/infra/terraform/variables.tf` (1–480)

**Role.** The Terraform root's complete input contract. Every variable below is
described by role; literal default identifiers (owner/repo names, numeric
IDs, cell IDs, project names, image paths/digests, pending domains) are not
reproduced — they are pinned by the range hash.)

- `artifact_repository_id` (string, required), `environment` (string, required,
  validated `contains(["staging","production"])`), `name_prefix` (required),
  `project_id` (required), `region` (default `us-central1`).
- GitHub identity block: `github_owner`/`github_repo` (string defaults kept —
  lowercase identifiers, no validation beyond description), `github_repo_id` /
  `github_owner_id` (string defaults, validated numeric-only `^[0-9]+$` —
  "numeric IDs survive a rename or transfer"), `github_workflow_file_prefix`
  (default prefix for the relay copy of workflow files, validated
  `^[a-z0-9-]*$`), `github_accepted_repositories` (list of
  owner/repo/ids/prefix objects; default empty — each accepted repository
  renders its own OR arm in provider conditions; validation: numeric ids and
  lowercase-hyphen prefixes).
- `auth_base_url` (required public https origin). `manage_relay_domain_mapping`
  (bool, default false), `relay_base_url` (required), `relay_cloud_run_service_name`
  (required), `relay_staging_power_auth_service_name` (default empty;
  "empty outside staging"), `relay_cloud_run_image` (default bootstrap
  placeholder), `relay_cloud_run_cpu` ("1"), `relay_cloud_run_memory` ("512Mi").
- Fence broker: `relay_fence_broker_service_name` (default), `relay_fence_broker_image`
  (placeholder or `^<path>@sha256:[a-f0-9]{64}$`), `relay_fence_source_cell_id`,
  `relay_fence_failed_target_cell_id`, `relay_fence_replacement_target_cell_id`
  (durable production GCE cell-id defaults), `relay_fence_unobserved_connection_bound`
  (validated `>=0 && <500`).
- Scaling/concurrency: `relay_director_concurrency` (80), `relay_director_request_timeout_seconds`
  (30), `relay_concurrency` (1000), `relay_request_timeout_seconds` (3600),
  `relay_public_assignments_enabled` (default true, emergency switch),
  `relay_regional_placement_enabled` (default true), `relay_region_rehome_source_cell_ids`
  (set of cell ids, default empty), public assignment/sticky lanes
  (`relay_public_assignment_concurrency` 2, retry_after 5, queue_max 128,
  wait_ms 4000; sticky concurrency 1, queue_max 64, wait_ms 2000, retry_after
  2) — comments document why each was pinned (code-side default changes must
  not silently re-tune production; the sticky lane previously lived only as a
  code default, so raising placement alone exceeded the pool and the director
  refused to boot).
- `relay_director_database_pool_max` (3; validated >=3 "must fit placement plus
  sticky admission slots"), `relay_min_instances` (1), `relay_max_instances`
  (2; validated >=1).
- `relay_cells` (map of stamped max-one Cloud Run cells keyed by durable cell
  id: service_name/url/capacity/min/max/deletion_protection; validation:
  HTTPS origin, capacity 1..1000, max exactly one, min <= max enforced by the
  human gate comment "max exactly one").
- `relay_alert_notification_channels` (list of Cloud Monitoring channel
  resource names; empty keeps policies visible without paging).
- GCE cells: `relay_gce_domain` (empty or lowercase DNS without wildcard/
  scheme), `relay_gce_subnetwork_cidr` (default RFC1918 /24, valid IPv4
  CIDR), `relay_gce_additional_region_subnetwork_cidrs` (map region→CIDR;
  **validation allowlists only `asia-east2`** as an additive region and
  requires valid CIDRs), `relay_gce_cells` (map keyed by durable cell id:
  hostname/zone/region(optional, default `us-central1`)/machine_type/boot_disk_gb/
  boot_image/capacity/database_pool_max(10)/image/initially_enabled(1)/optional
  connection cap and unobserved bound; **tight validation**: cell id
  `^[a-z][a-z0-9-]{0,39}$`, hostname DNS-label regex, region in
  {`us-central1`,`asia-east2`}, zone begins `<region>-`, COS
  `cos-stable-...` boot image pinned, disk 20..100, capacity 1..100000, pool
  1..100, connection caps paired-and-absent or one of {600,1000,3000} with
  unobserved bound ∈ [0, cap−100) leaving rebind headroom, image digest-pinned
  `@sha256:64hex`, and unique hostnames across all cells).
- `relay_gce_cell_log_sample_rate` (0..1; 1 keeps assign-to-connection joins
  exact), `relay_gce_fenced_cells` (set of reviewed cell ids whose
  Terraform-owned MIG target size is zero), `relay_gce_cloud_sql_proxy_image`
  (digest-pinned default, validation asserts the digest regex).

**Failure/refusal.** `validation` blocks are Terraform-level refusals: invalid
inputs abort plan/apply with the stated `error_message` before any resource
effect. Combined with the required-variable list (no default), any missing
identity/value fails closed at plan time.

---

## INF10 — `cloud/infra/terraform/versions.tf` (1–27)

**Role.** Tool/provider floor and backend registration.

**Effects.** `required_version = ">= 1.7.0"`; providers `google ~> 6.0`
(hashicorp/google), `random ~> 3.6`, `external ~> 2.3`; `backend "gcs" {}`
(the concrete backend blocks live in `backend/production.hcl` /
`backend/staging.hcl`, selected by the init call — INF13/INF14); the
`google` provider block pins project and region from variables.

**Failure/refusal/rollback.** Terraform refuses to run below 1.7.0 or with
provider major versions outside the `~>` ranges. `.terraform.lock.hcl`
(presence, not read here) pins provider checksums so identical byte
environments are reproducible. Backend selection is switch-time, not declared
here.

---

## INF11 — `cloud/infra/terraform/environments/production.tfvars` (1–410)

**Role.** The production input set. Values (project identity, domains, image
digests, channel ids, cell ids, CIDRs, COS images) are pinned by the range
hash and deliberately not reproduced; the *shape* is recorded for audit.

- Pins environment=production; project id/name-prefix for production; region
  default us-central1; artifact repository id; GitHub owner/repo/prefix kept
  at defaults with repo id override; auth base URL is a production https
  origin (login origin used by the desktop client).
- Relay: service name, base URL; `min_instances = max_instances = 5` (comment:
  "public admission is a per-instance semaphore… scaling to 2 instances took
  placement failures 35% -> 70%"); cells empty (production GCE data plane);
  `manage_relay_domain_mapping = true`.
- GCE: parent domain (exact hosts below it; wildcard only handles DNS/TLS, LB
  rejects unknown hosts), primary and asia-east2 secondary CIDR blocks,
  fenced cell ids (6 listed; initial cells stay admission-disabled until
  production preflight/go-live approval), and **29 cell entries**: 26
  us-central1 (`e2-standard-4`, 30 GB boot, COS image pins, capacity 4000) and
  3 asia-east2 (capacity 6000, `database_pool_max=10`); every cell
  `initially_enabled=false`; a digests-pinned relay image per cell (distinct
  digests by origin so each cell drains without an in-place swap; several
  cells carry explicit canary comments for control-activation fence PR and
  halved control-lease-renewal PR, and c21 carries a control-close attribution
  note); connection caps only defined on the 600/1000/3000 classes with
  unobserved bound 60.
- `relay_region_rehome_source_cell_ids` (16 of the us cells as reviewed
  rehome sources) and `relay_alert_notification_channels` (one reference,
  created out of band, "declared here because an apply was otherwise going to
  strip it from every policy, leaving the alerts firing at nobody").

**Failure/refusal/rollback.** Feed-into-constraints: every cell must pass the
variables.tf validations (hostname uniqueness, cap classes, digest pins, COS
images) or plan refuses. Because every cell is `initially_enabled=false`, the
declared gate for capacity activation is the operator toggling the flag after
preflight — rollout back-pressure is a planned apply, not implicit.

---

## INF12 — `cloud/infra/terraform/environments/staging.tfvars` (1–83)

**Role.** The staging input set (shape only; values pinned by range hash).

- environment=staging; distinct project id and name prefix; region us-central1;
  artifact repository id; GitHub identity with repo id override; auth base URL
  is a staging https origin.
- Relay: staging service name, staging shared auth service name (non-empty, so
  the power/actAs bindings in INF04 are active), base URL; min 0 / max 2;
  "Staging now exercises the production-shaped GCE data plane exclusively";
  `relay_cells = {}`; domain mapping managed.
- GCE: staging parent domain, primary + asia CIDRs, no fenced cells, and
  **4 cell entries** (c1 left with no connection cap; c2 us with cap 600 /
  bound 60; c3 us, differently sized worker, cap 1000 / bound 60 and
  `initially_enabled=false`; c4 asia-east2 worker with capacity 6000,
  pool 10, cap 3000 / bound 60, disabled), all with digest-pinned relay
  images and COS pins.
- `relay_region_rehome_source_cell_ids` = 2 of the us cells.

**Failure/refusal/rollback.** Same validation funnel as INF11; staging min 0
means the director can be scaled to zero (the power workflows' target).

---

## INF13 / INF14 — `cloud/infra/terraform/backend/production.hcl` (1–3) and `backend/staging.hcl` (1–3)

**Role.** Concrete `gcs` backend blocks for each environment.

**Effects.** Each file configures a GCS state backend: an environment-scoped
state bucket name and the shared `prefix = "terraform/state"`. No credentials
or workspace metadata are stored in the files; state lives in the
corresponding bucket. The two names differ by environment so production and
staging state are physically separate.

**Failure/refusal/rollback.** If the bucket/metadata is unreachable, Terraform
refuses to run (backend init failure) before any plan; there is no offline
fallback. State corruption/partial applies are mitigated outside this file by
the conditioned storage bindings in INF01/INF03/INF04 (exact object names for
the default state + lock). Changing these files moves state/environment
boundaries and is reserved for the root owner.

---

## Source-test linkage for O-INFRA-OPS first 14

No test bodies, files or pointers exist for any of the 14 reviewed paths.
Related live fixtures/observability work remains **real execution debt**, kept
separate from source closure: a discriminating Terraform plan with an IAM
denied-caller matrix, the exact GCS state/lock condition objects, a binder
startup/virtual-boot failure matrix for template rendering, a Cloud Run domain
mapping certificate-mode churn case, alert threshold dead-fires, and a backend
split/prod-staging state isolation fixture. Those are root/lead future
acceptance commands, not this leaf's claims.

## Progress reporting (survey only, no gate movement)

- This leaf adds **no accepted group, no percentage change**: the root index
  stays frozen at **75% = 9/12** (unweighted accepted audit groups, per
  `audit-progress.md`). Source completion of 14 named O-INFRA-OPS paths is
  "source reviewed, candidate for parent review" — it is not a baseline, port,
  test-migration or real candidate completion.
- Delta this leaf: from `source-unknown-beyond-declared-read-ranges`
  (O-INFRA-OPS, Terraform half) to full-body coverage of exactly those 14
  paths; the lead's 4 `relay-ops` TS paths and all CI workflows remain the
  lead's own open obligations.
- Next closure milestone for this thread: E5 lead review of this entry plus
  its own 4 ops-TS/workflow resolution before O-INFRA-OPS can move from
  `source-unknown` to a reviewed state; root samples and accepts.
- 24-hour-deadline risk: unchanged — this leaf neither extends nor reduces it;
  real OS/SSH/cloud/render/native obligations remain unsupported by source
  enumeration alone (see `following progress` notes in the parent artifacts).
- Disposition: **candidate-for-parent-review**; no values, secrets, account/
  project/domain/destination identifiers were imported into this report; all
  byte evidence is the SHA256 range hashes in `infra-entry.json`.