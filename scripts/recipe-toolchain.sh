#!/bin/sh
# MIT Copyright (c) 2026 Lovecast Inc.
#
# Resolve the Drogon recipe toolchain honestly. Mentu shell steps run with the
# launcher's sanitized PATH, where the pinned pnpm is unavailable to this
# recipe shell (run_20260910064001_ADB6B84E evidence: clean-checkout exited 127
# on `pnpm: command not found`). This script prepares the environment the same
# way scripts/build-main.sh does: prefer the pinned Node 24 runtime, install
# the packageManager-pinned pnpm project-locally, never touch global tooling,
# and verify the resolved pnpm matches the pin.
#
# Usage (from the repository root, inside a recipe step):
#   toolchain_env=$(sh scripts/recipe-toolchain.sh) && eval "$toolchain_env" && pnpm install ...
# On stdout it prints only `export PATH=...` with the project-local pnpm bin
# and the pinned Node 24 runtime prepended; diagnostics go to stderr.

set -eu

# Prefer the pinned Node 24 runtime when present; otherwise trust ambient PATH.
node24_bin="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
node24_prefix=""
if [ -x "$node24_bin/node" ]; then
  PATH="$node24_bin:$PATH"
  node24_prefix="$node24_bin"
fi
export PATH

command -v node >/dev/null 2>&1 || {
  printf 'recipe-toolchain: node is not on PATH; install the pinned Node 24 runtime\n' >&2
  exit 1
}
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" = "24" ] || {
  printf 'recipe-toolchain: Node 24 is required for Drogon builds; resolved node is %s\n' "$(node --version)" >&2
  exit 1
}
command -v cargo >/dev/null 2>&1 || {
  printf 'recipe-toolchain: cargo is not on PATH\n' >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  printf 'recipe-toolchain: npm is not on PATH; it ships with node\n' >&2
  exit 1
}

# The only approved pnpm source: the version pinned by packageManager.
manager=$(node -p 'require("./package.json").packageManager')
printf '%s' "$manager" | grep -Eq '^pnpm@[0-9]+\.[0-9]+\.[0-9]+$' || {
  printf 'recipe-toolchain: expected a pinned pnpm packageManager, got: %s\n' "$manager" >&2
  exit 1
}
pnpm_version=${manager#pnpm@}

# Project-local install directory; .mentu/runtime/ is gitignored.
toolchain_dir="${DROGON_RECIPE_TOOLCHAIN_DIR:-$PWD/.mentu/runtime/toolchain}"
pnpm_bin="$toolchain_dir/node_modules/.bin"
if [ ! -x "$pnpm_bin/pnpm" ]; then
  npm install --prefix "$toolchain_dir" --no-audit --no-fund --ignore-scripts "$manager" >/dev/null
fi

PATH="$pnpm_bin:$PATH"
export PATH

resolved=$(pnpm --version)
[ "$resolved" = "$pnpm_version" ] || {
  printf 'recipe-toolchain: packageManager pins %s but resolved pnpm is %s\n' "$manager" "$resolved" >&2
  exit 1
}

# Hand the resolved toolchain back to the step shell: pnpm first, then the
# pinned runtime, so `node` resolves to Node 24 for the rest of the step.
if [ -n "$node24_prefix" ]; then
  printf 'export PATH="%s:%s:$PATH"\n' "$pnpm_bin" "$node24_prefix"
else
  printf 'export PATH="%s:$PATH"\n' "$pnpm_bin"
fi
