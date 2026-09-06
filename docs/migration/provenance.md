# Source provenance

Reference implementation: https://github.com/clioo/drogon-orca, originally forked from https://github.com/stablyai/orca.

Reference main: `34ae1a1c926fd1ce1f174f7c6ef2f65e0a0c4168`; historical implementation branch: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

The reference code is MIT licensed, copyright (c) 2026 Lovecast Inc. Preserve its full notice in any migrated code. The original bootstrap had not copied product source or third-party artwork; that historical statement is not the current source-reuse status. Each migrated subsystem must record its source revision, license and acceptance evidence here or in a linked inventory.

Renaming retains the old repository ID, history and PRs. Its privacy conversion remains pending because GitHub currently treats it as a public fork. No history was deleted to work around that restriction.

## Verified checkpoint — 2026-09-06

At `bb85b83`, nine preload close/restart and shared event/type modules reuse the
pinned MIT source at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Source/candidate
digests, exact type-extraction differences and limited acceptance are recorded in
`sol-wave/ui-preload/implementation.json` and its root review. They have individual
provenance headers; the exact original license is retained at
`../../tests/parity/ports/LICENSE.orca`. Distribution still requires final package
notice inspection; module tests do not accept the packaged application. Frozen
test ports likewise retain their pinned source attribution. No character artwork
rights are inferred from the code license.

GitHub API recheck: `clioo/drogon` is public, independent (`isFork:false`), with
default branch `main`; `clioo/drogon-orca` is still public and a fork of
`stablyai/orca`. Its privacy is not resolved. GitHub's current
[detachment documentation](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork)
warns that leaving the network does not retain issues, PRs, wikis, stars, comments
or other repository metadata. Therefore the self-service operation is not accepted
as a no-data-loss route. No detach, deletion/recreation, mirror overwrite or
visibility mutation was attempted. A supported metadata-preserving route remains
to be established; a Git-only clone does not preserve this full obligation.
