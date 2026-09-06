# Skills and provider registry census

Source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only).
Machine artifact: `parity-skill-provider-catalog.json`.
Reproduce without evaluating source code:

```sh
node scripts/inventory-source-skill-providers.mjs /path/to/frozen-source
node --test scripts/inventory-source-skill-providers.test.mjs
```

The checker parses a deliberately restricted literal AST, checks the clean
source revision and compares each of 35 file hashes to its pinned Git blob.
It refuses calls, functions, computed/spread properties, duplicate keys,
unknown constants, cycles and holes. Its six regression tests passed on
Node 24.19.0. It does not execute guide instructions or install anything.

| Distinct registry | Enumerated source | Owner |
| --- | --- | --- |
| Bundled guide topics | 8 canonical topics, all aliases empty | WP-ENG-CLI |
| Native skill placement destinations | 9 providers, separate global/workspace paths | WP-ENG-PLUGINS |
| Community skills CLI agent mapping | 36 harness IDs: 30 mappings and 6 explicit nulls | WP-ENG-CLI |
| Task providers | GitHub, GitLab, Linear, Jira | WP-CAP-INT |
| Skill wire capability constants | 10 declarations | WP-ENG-PLUGINS |

The eight guide topics are computer-use, linear-tickets, orca-cli,
orca-emulator, orca-emulator-android, orca-linear, orca-per-workspace-env,
and orchestration. Each embedded guide equals the normalized Markdown source;
`--full` has the same content at this revision. All eight installable stubs
equal the generator's frontmatter-plus-stub projection. These checks preserve
the discovery/content distinction rather than replacing full guides with stubs.

Do not conflate these registries. The native install destination list is not
the list of supported harnesses; a null community mapping is not an unavailable
harness. The universal community destination is separate and always added by
the source mapping function. Null native path segments mean the canonical
`.agents/skills` root, not inability to use skills. Explicit provider selection
and detected-provider filtering are separate source behaviors.

Task availability also differs from authentication success: source keeps GitHub
and Jira reachable as task sources; GitLab depends on its installation signal,
and Linear on connection state. Default/visible-source normalization and the
GitHub fallback must be characterized, not replaced with one global connected
provider filter. This source reading does not prove real provider connectivity.

## Remaining proof (not waived)

- Guide command semantics, aliases/branding migration and version-matched serving
  belong to WP-ENG-CLI tests; byte checks do not validate instructional meaning.
- Native versus community install paths, explicit targets, dry-run/no-write,
  forwarded-host refusal, cancellation and mixed-version negotiation remain
  behavior tests under WP-ENG-CLI / WP-ENG-PLUGINS.
- Four task providers are not the universe of Git hosts, credentials, model
  providers or runtime transports. Their CRUD/identity/auth/SSH journeys remain
  WP-CAP-INT and host-owner test obligations.
- Four source test pointers are hash-pinned, not executed or fully read by this
  census. No claim of full feature parity or audit closure is made.

MIT source provenance is retained in the machine artifact. No user-installed
skills, credentials, personal profiles, apps or model providers were accessed.
