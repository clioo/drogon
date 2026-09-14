#!/bin/bash
# One-command hermetic Linux check: build the recipe and run the portable
# gates in a clean node:24 container with Rust 1.98.
#
#   ./docs/hermetic-linux/run-check.sh [--tag <name>] [--repo <url>] [--ref <ref>]
#
# Proves the repo builds with no state from any Mac. It does NOT validate the
# desktop: the .app, Electron rendering, packaging and Gatekeeper need macOS
# (see the Dockerfile header). Fails fast with a clear message when the
# Docker daemon is unreachable instead of hanging.
set -euo pipefail

tag="drogon-fresh-clone"
repo="https://github.com/clioo/drogon.git"
ref="main"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) tag="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --ref) ref="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

root=$(cd "$(dirname "$0")" && pwd)
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is unreachable (start Docker Desktop and retry).\n' >&2
  exit 1
fi
exec docker build --pull -t "$tag" --build-arg REPO="$repo" --build-arg REF="$ref" "$root"
