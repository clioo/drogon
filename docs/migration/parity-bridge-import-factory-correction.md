# Bridge alias correction and usage factory contract

Coordinator source review at frozen c97906287bb7a390b25e2025b600d9fb3c25d9c3.
This corrects enumeration, not product behavior or full audit acceptance.

## GitLab: 28 previously omitted methods

`src/preload/api/gl-bridge.ts:4` exports an imported identifier with a
`satisfies` annotation, not a literal object. The old walker silently skipped
it. The complete `src/preload/gitlab.ts` body was read: its 28 methods all
forward to `gitlab:*` invoke channels. The corrected walker follows relative
import aliases by original exported name, with depth/cycle limits, origin
anchors and hashes. Unknown aliases remain explicit rather than disappearing.

The regenerated census now extracts 975 channels and 981 reachable methods,
up from 947/953. All prior channel entries survive; all 28 additions have
syntactic main-handler matches. The RPC count remains 615. This does not prove
handler behavior, provider authentication or live GitLab execution.

## Three usage factories: known source contract, outside the generic walker

The assembly at `src/preload/index.ts:176` also references `claudeUsage`,
`codexUsage` and `openCodeUsage`. Their three bridge files call the same factory
with those literal prefixes. The generic walker does not expand this factory;
the census now explicitly lists all three in `unresolvedAssemblyExports`.
Extracted totals are bounded subsets, never a complete denominator.

Coordinator read `src/preload/usage-provider-api.ts` and
`src/main/ipc/usage-provider-handlers.ts` completely. Each provider has these
eight request/response operations, with channel `${prefix}:${method}`:

| Method | Store invocation by the main handler |
| --- | --- |
| getScanState | no arguments |
| setEnabled | args.enabled |
| refresh | args?.force ?? false |
| getSnapshot | args.scope, args.range, args.limit |
| getSummary | args.scope, args.range |
| getDaily | args.scope, args.range |
| getBreakdown | args.scope, args.range, args.kind |
| getRecentSessions | args.scope, args.range, args.limit |

The preload forwards its argument object unchanged; no-argument refresh sends
undefined. Main handlers unpack it. No extra validation is present in these
wrappers; actual store validation/return/error behavior is not characterized
by this table. The main register function instantiates all three prefixes at
lines65–67; `register-core-handlers.ts:145` invokes it after its once-only guard.
These are 24 additional explicitly named channels, not 24 extra test cases or
generic-scanner results. The template-built main names also evade literal-only
matching; they are not missing implementations.

## Executed evidence

Three coordinator regressions reproduced the omissions before their fixes:
imported alias missing, cyclic alias disappearing, unwalked factory appearing
empty. Final scanner suite: 37 pass, zero fail/skip/todo, Node24.19.0. The real
source census also passes byte-identical `--verify`. Scanner fixtures are not
Orca behavioral baselines.

Two unchanged original tests each passed once under original Vitest4.1.11:
[preload](reference-captures/c9790628-usage-provider-api/README.md) and
[handlers](reference-captures/c9790628-usage-provider-handlers/README.md).
The first checks all eight invoke shapes for each provider. The second checks
all registrations, getScanState for all three and remaining forwards for
Claude only. No actual IPC, token accounting, stores or UI was executed.

## Source fingerprints

- GitLab object: e1c2ee188d38c82325e5cabf0f1f8a454aa080afbd321d96e445f81be8e380ef
- GitLab bridge: 153bd5e1cc9260087d27cbfd5d7201bca355b543274683d2f2013f71606af7d6
- Usage factory: 1376070698ca3cf469d2134a6dc40ae8544af1ed8f339b683b74fcbbcf08526f
- Usage handlers: 017ae5dbb06052ce73ce1be7094b12ba27bb8114b715a2016017e71bc8623eb1
- Claude bridge: a259f5c5c19e55cfb32b4c05eedb824b1c6cda7717bada80a31c562da9abec70
- Codex bridge: 984ecd79b2869cd7a8464b4fd9df275bae632963dbcb39bde7e250358ef15e47
- OpenCode bridge: 1247230b115d84fe1d0010e7181663c910618113c9626fb537a995105b303de7

E3 owner WP-ENG-IPC retains runtime, subscription and version-skew obligations.
Do not repeat this bounded source trace or label the factory domains absent.
