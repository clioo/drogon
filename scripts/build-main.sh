#!/bin/bash
# Build a fresh main without checking out or stashing the caller's work.
set -euo pipefail

verify=0
case "${1:-}" in
  '') ;;
  --verify) verify=1 ;;
  -h|--help)
    printf 'Usage: ./scripts/build-main.sh [--verify]\nBuild origin/main in isolation; optionally run packaged acceptance. Does not install or stop the running app.\n'
    exit 0 ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { printf 'Too many arguments\n' >&2; exit 2; }

root=$(cd "$(dirname "$0")/.." && pwd)
node_bin=/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
if [[ -x "$node_bin/node" ]]; then export PATH="$node_bin:$PATH"; fi
for tool in git node npm cargo; do
  command -v "$tool" >/dev/null || { printf 'Required tool missing: %s\n' "$tool" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Node 24 is required; put it on PATH."); process.exit(1); }'

remote=$(git -C "$root" remote get-url origin)
mkdir -p "$root/.preflight/build-main"
run=$(mktemp -d "$root/.preflight/build-main/run-XXXXXXXX")
printf 'Build directory (retained, including on failure): %s\n' "$run"
trap 'printf "Build failed. Files retained at: %s\n" "$run" >&2' ERR
# Resolve main from the remote now, not from a potentially stale local ref.
git clone --single-branch --branch main -- "$remote" "$run/source"
cd "$run/source"
printf 'Source revision: '
git rev-parse HEAD
manager=$(node -p 'require("./package.json").packageManager')
[[ "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  printf 'Expected a pinned pnpm packageManager, got: %s\n' "$manager" >&2; exit 1;
}
# Install the exact package manager locally, never change global tooling.
npm install --prefix "$run/toolchain" --no-audit --no-fund --ignore-scripts "$manager"
export PATH="$run/toolchain/node_modules/.bin:$PATH"
pnpm install --frozen-lockfile
# Packaging builds offline. Populate the locked Rust dependency cache first.
cargo fetch --locked
node scripts/package-desktop.mjs | tee "$run/package.log"

if [[ "$verify" == 1 ]]; then
  bundle=$(node -e '
    const fs = require("node:fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const records = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const result = records.findLast(record => record.status === "PACKAGED");
    if (!result?.bundle) throw new Error("Packager did not report a bundle");
    process.stdout.write(result.bundle);
  ' "$run/package.log")
  DROGON_BACKGROUND_WINDOW=1 DROGON_VERIFY_OS_FOCUS=1 \
    node scripts/accept-desktop.mjs --bundle "$bundle" --files | tee "$run/acceptance.log"
fi
printf '\nBuild complete. Receipt: %s/package.log\nNo installed app or user data was replaced.\n' "$run"
