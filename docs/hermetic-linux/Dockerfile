# Hermetic Linux check: prove the repo builds with no state from any Mac.
#
# Covers ONLY the portable gates against a fresh public clone:
#   pnpm install --frozen-lockfile, pnpm typecheck,
#   cargo check --workspace --locked, pnpm check:hygiene (script suites),
#   node scripts/e2e-fresh-clone.mjs (static check mode).
#
# It CANNOT cover: the Drogon.app bundle, Electron rendering, packaging,
# Gatekeeper/notarization, or any macOS-only acceptance. A green container is
# not a validated desktop; run scripts/accept-desktop.mjs on macOS for that.
#
# One command: ./docs/hermetic-linux/run-check.sh
#
# Toolchain floors must match scripts/check-toolchains.mjs (Node range and
# RUST_FLOOR) and the README. There is no rust-toolchain.toml in the repo, so
# the Rust version is pinned here explicitly; keep the three in sync.

ARG NODE_IMAGE=node:24-bookworm
FROM ${NODE_IMAGE}

ARG REPO=https://github.com/clioo/drogon.git
ARG REF=main
# Keep in sync with RUST_FLOOR in scripts/check-toolchains.mjs.
ARG RUST_VERSION=1.98

ENV DEBIAN_FRONTEND=noninteractive \
  CARGO_HOME=/usr/local/cargo \
  RUSTUP_HOME=/usr/local/rustup \
  PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates build-essential pkg-config libssl-dev \
  && rm -rf /var/lib/apt/lists/* \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain "$RUST_VERSION" --profile minimal \
  && rm -rf "$RUSTUP_HOME"/downloads \
  && rustc --version && cargo --version && node --version

WORKDIR /src/drogon
RUN git clone --depth 1 --branch "$REF" "$REPO" . \
  && npm install -g "$(node -p 'require("./package.json").packageManager')" --no-audit --no-fund \
  && pnpm --version

RUN pnpm install --frozen-lockfile
RUN pnpm typecheck
RUN cargo check --workspace --locked
RUN node --test scripts/check-repo-hygiene.test.mjs scripts/check-docs-links.test.mjs \
  && node scripts/check-repo-hygiene.mjs \
  && node scripts/check-docs-links.mjs
RUN node --test scripts/check-toolchains.test.mjs scripts/e2e-fresh-clone.test.mjs \
  && node scripts/e2e-fresh-clone.mjs
