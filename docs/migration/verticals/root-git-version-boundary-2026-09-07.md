# Real Git version-boundary characterization

ROOT ran `scripts/probe-git-version-boundary.mjs` on macOS on 2026-09-07,
against locally compiled Git 2.25.5 and Apple Git 2.50.1 (Git-155).
Both invocations exited 0. These are real-binary observations, not tests
of the unregistered candidate Git parser or process wrapper.

| Operation | Git 2.25.5 | Git 2.50.1 |
| --- | --- | --- |
| `worktree list --porcelain -z` | Exit 129; `error: unknown switch ` followed by backtick, `z`, apostrophe | Exit 0; NUL-delimited output |
| `worktree list --porcelain` | Exit 0; literal tab and quote preserved in path | Same |
| `status --porcelain=v2 -z` | Exit 0; literal tab preserved, NUL terminator, empty stderr | Same |

The probe supplies global `-c` options before the subcommand, including
`core.fsmonitor=false`, `core.quotePath=true`, and `color.ui=never`.
It creates only owned temporary repositories, disables hooks, signing,
global/system attributes, and system configuration, and scrubs inherited
Git routing variables. Linked worktrees stay within the fixture directory;
the complete fixture is removed after each run. No user repository or
global Git installation is modified. Control-character paths run only on
non-Windows hosts.

## Reproduction and provenance

Git source: [official Git 2.25.5 archive](https://www.kernel.org/pub/software/scm/git/git-2.25.5.tar.xz).
Archive SHA-256: `164dec6d31843a436c0db2acb79ce49a56f703f587e7c127cf421604d5570bba`.
The archive was downloaded over HTTPS; no separate PGP verification is claimed.

Local build, without installation:

```sh
make -j2 git NO_OPENSSL=YesPlease NO_CURL=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease NO_EXPAT=YesPlease NO_PERL=YesPlease NO_PYTHON=YesPlease
node scripts/probe-git-version-boundary.mjs /absolute/path/to/git /absolute/path/to/result.json
```

Git 2.25.5 binary SHA-256:
`e0f0a79318b7c1c29ed68e78be8f61a719d1c730ef54453af066baae673b1eff`.
Apple launcher SHA-256:
`b8763cf250e607a778bb4603cecb5b90338814d0a3dfcba0d57b1de242f610e9`.

Local archive, binary and JSON receipts are retained under
`.preflight/git-baseline.hYOWaX/`; the JSON names are
`git-2.25.5-result.json` and `git-current-result.json`.
They are test evidence, not packaged assets.

## Still open

The candidate wrapper `cd4ae02` remains held for incomplete-stream success,
read-error/UTF-8 handling, unbounded cleanup, duplicate concurrent probes,
and inherited Git routing environment. Its tests also assume `sleep` exists
and that the installed Git supports `-z`. The maintained CI matrix, actual
Windows/Linux/SSH execution, and end-to-end fallback through the corrected
Drogon wrapper are not established by this characterization.
