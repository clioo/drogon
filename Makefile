# Drogon: install the app you just built, in one command.
#
#   make install                 build this checkout, replace the installed
#                                Drogon, restart the service and the app
#   make install-main            same, from a fresh origin/main build
#   make install BUNDLE=<path>   install an already-packaged Drogon.app
#   make install-test            run the installer's tests
#
#   make repro                   reproduce a whole run: pick the harnesses,
#                                watch the adversarial rounds, read the
#                                receipt with the evidence and the cost.
#                                Every invocation is a new run.
#   make repro-list              every run this checkout has produced
#   make repro-test              run the reproducible run's own tests
#
# Extra flags reach the installer through FLAGS, e.g.
#   make install FLAGS=--no-restart
#   make install FLAGS="--applications $HOME/Applications --keep 3"
SHELL := /bin/bash
.DEFAULT_GOAL := help

# Node 24 lives outside PATH on the maintainer machine; prefer it when present
# and otherwise trust whatever `node` the caller has (the workspace needs >=24).
NODE_RUNTIME := $(HOME)/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
# Keep the package manager project-local as well. Some Node distributions do
# not ship Corepack, and `packageManager` alone does not put pnpm on PATH.
PNPM_TOOLCHAIN_DIR ?= $(CURDIR)/.mentu/runtime/toolchain
PNPM_BIN := $(PNPM_TOOLCHAIN_DIR)/node_modules/.bin
# A missing directory in PATH is harmless, and keeping this unconditional
# also works with the BSD make shipped by macOS (which does not implement
# GNU make's `wildcard` conditional function).
export PATH := $(PNPM_BIN):$(NODE_RUNTIME):$(PATH)

INSTALLER := scripts/install-drogon.mjs
FLAGS ?=
BUNDLE ?=

.PHONY: help install install-main install-test pnpm-toolchain repro repro-list repro-test

REPRO := scripts/reproduce-adversarial-run.mjs

help:
	@awk '/^#/ { sub(/^# ?/, ""); print; next } { exit }' Makefile

# Packaging imports the workspace's dev dependencies; a fresh worktree would
# otherwise fail deep inside the packager instead of here.
# Resolve the exact package manager declared by package.json before any
# packaging command runs. This is intentionally local and ignored by git.
pnpm-toolchain:
	@PATH="$(PATH)"; export PATH; \
	manager="$$(node -p 'require("./package.json").packageManager')"; \
	printf '%s' "$$manager" | grep -Eq '^pnpm@[0-9]+\.[0-9]+\.[0-9]+$$' || { \
		echo "package.json must declare a pinned pnpm version" >&2; exit 1; }; \
	expected="$${manager#pnpm@}"; \
	if [ ! -x "$(PNPM_BIN)/pnpm" ] || [ "$$("$(PNPM_BIN)/pnpm" --version 2>/dev/null || true)" != "$$expected" ]; then \
		echo "Installing $$manager in $(PNPM_TOOLCHAIN_DIR)" >&2; \
		npm install --prefix "$(PNPM_TOOLCHAIN_DIR)" --no-audit --no-fund --ignore-scripts "$$manager"; \
	fi; \
	resolved="$$("$(PNPM_BIN)/pnpm" --version)"; \
	[ "$$resolved" = "$$expected" ] || { echo "packageManager pins $$manager but resolved pnpm is $$resolved" >&2; exit 1; }

node_modules: pnpm-toolchain
	@PATH="$(PATH)"; export PATH; "$(PNPM_BIN)/pnpm" install --frozen-lockfile

install: $(if $(BUNDLE),,pnpm-toolchain | node_modules)
	@PATH="$(PATH)"; export PATH; node $(INSTALLER) $(if $(BUNDLE),--bundle "$(BUNDLE)") $(FLAGS)

install-main:
	@PATH="$(PATH)"; export PATH; node $(INSTALLER) --from-main $(FLAGS)

install-test:
	@PATH="$(PATH)"; export PATH; node --test scripts/install-drogon.test.mjs

# The reproducible demonstration run. It asks which harnesses to use, builds the
# core if this checkout has not built it yet, and leaves a receipt behind. It
# never touches the developer's own Drogon, data directory or sessions.
repro:
	@PATH="$(PATH)"; export PATH; node $(REPRO) $(FLAGS)

repro-list:
	@PATH="$(PATH)"; export PATH; node $(REPRO) --list

repro-test:
	@PATH="$(PATH)"; export PATH; node --test scripts/reproduce-adversarial-run.test.mjs
