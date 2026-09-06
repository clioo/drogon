# G12 — original Node runtime launch contract

Coordinator source review at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Owner: WP-ENG-DAEMON; CLI/install consumers: WP-ENG-CLI, WP-ENG-INSTALL.
This resolves the old **flag enumeration** omission, not runtime acceptance.
No source imports, test execution, listening port or profile mutation occurred.

## Entrypoint and complete parser surface

`src/main/orcad/main.ts:10` recognizes `--orcad-smoke-load-check` anywhere
in process.argv and exits before native preflight or main. Static module
resolution has already happened. This is an entrypoint-only build probe,
not a sixth option accepted by `parseArgs`.

`orcad-entry.ts:281-316` is the complete five-option parser:

| Option | Exact parser behavior |
| --- | --- |
| `--port` | Consumes the following token using Number; requires an integer in 0–65535. Empty/whitespace strings become 0; numeric hexadecimal/exponent notation can pass. Missing value becomes NaN and rejects. Zero is explicitly allowed. |
| `--json` | Sets json:true; no value consumed. |
| `--no-pairing` | Sets noPairing:true; no value consumed. |
| `--bind` | Consumes any defined following token, including an empty string or `--json`. Address validation happens later, not in this parser. |
| `--pairing-address` | Consumes a truthy following string; empty/missing reject, whitespace and flag-looking strings pass this parser. Endpoint validation is downstream. |

Unknown tokens reject with `Unknown argument: <token>`. There is no parser
support for positionals, `--name=value`, aliases, `--help`, `--version`,
`--data-root`, or `--` terminator. Repeated value options overwrite earlier
ones; boolean options remain true. With no tokens it returns an empty object,
not an object filled with defaults. Do not infer a port default here.

The old G12 wording “beyond bind/data-root” is inaccurate: the data root is
not a parsed flag. `orcad-app-paths.ts:22` selects nonempty ORCA_USER_DATA,
else XDG_DATA_HOME joined with Orca, else the home directory joined with
.orca. Values are not trimmed. These are original names, not instructions
to reuse the user's Orca profile for rewrite tests.

`orca serve` is a separate entrypoint. Its command spec includes port,
pairing-address, mobile-pairing, no-pairing, project-root, recipe-json, plus
GLOBAL_FLAGS. Registry metadata already records it; its execution contract
remains G7/E4. Do not merge the two parsers into one inferred surface.

## Downstream launch boundaries observed

- `resolveOrcadBindHost` defaults undefined to 127.0.0.1, trims supplied
  strings, accepts localhost as that loopback, otherwise requires a literal
  IP. Empty, other hostnames and flag-looking values reject. The RPC server
  receives pinnedBindHost; explicit port also sets preferPinnedWsPort:true.
- `startOrcad` installs adapters, resolves the data root, takes its instance
  lock, resolves the browser provider, then starts runtime setup. The browser
  provider resolution is before the visible try/catch; this review does not
  certify complete failure cleanup across that boundary.
- Runtime initialization creates the runtime-authority Store, initializes
  SSH host-key persistence, starts the terminal daemon, installs PTY routing,
  rehydrates browser rows and reconciles orchestration before binding RPC.
  These are source call ordering, not verified effects of those callees.
- `--no-pairing` produces disabled_by_operator; otherwise a runtime-scope
  pairing offer is requested. Readiness includes collected health; publication
  chooses json or human mode. Actual readiness output is not tested here.
- Shutdown stops RPC, disconnects the daemon via stopOrcadDaemon, stops the
  browser provider, runs quit callbacks and releases the instance lock.
  SIGINT/SIGTERM share a stopping flag; a second signal exits 1; a 15-second
  deadline exits 1; resolved stop exits 0. Exit classification maps bind/lock
  error instances to 78, other errors to 1. Parser errors are ordinary errors,
  so not every invalid argument receives configuration exit 78.

Read operations guide through its initial supervision section only. It warns
that detached PTYs are not isolated from a shared systemd cgroup stop; a
PID-scoped restart claim cannot be widened to service-restart survival.
No live process was stopped to inspect this contract.

## Test boundary and source fingerprints

Read the complete three-case `orcad-launch-contract.test.ts`: ordinary bind
parsing/default omission, missing bind rejection with a flag-looking value
accepted by the parser, and exit-class separation. **Not executed**; those
three cases do not establish all five options, signals, bind/listen, locks,
restart or durability. Preserve those assertions and add absent edge cases
in the owned test-port wave, without treating import failures as behavioral RED.

All files below were read completely and hashed from the frozen checkout:

| Source-relative path | SHA-256 |
| --- | --- |
| src/main/orcad/main.ts | 0a64c1b03308c514de7986d6a2e9d333b47580a4e1952826359aaca56d0a78f6 |
| src/main/orcad/orcad-entry.ts | fc0ea63d05d19f9335e114d05afebabdfbd82c4955c77757e9f700813accd54a |
| src/main/orcad/orcad-app-paths.ts | 8d8bf885d609c6b949cbd4d657641fc6875db0abc9854eb796b58223ce74f06d |
| src/main/orcad/orcad-bind-address.ts | 5f7e49d9142ca826f9b2456a2cb8f4d27ddab643f3207000c98c25625e7cfa47 |
| src/main/orcad/orcad-launch-contract.test.ts | 78e4428e13735a9d3704ee2af8b97154e6b6ef5c17a7fd7b99d9f1475005d09d |
| src/cli/specs/serve.ts | 39842b1270df4121a2968acceba8782904efa9388042829b9dfd16320cbc6c1f |
