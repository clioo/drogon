# Drogon: install the app you just built, in one command.
#
#   make install                 build this checkout, replace the installed
#                                Drogon, restart the service and the app
#   make install-main            same, from a fresh origin/main build
#   make install BUNDLE=<path>   install an already-packaged Drogon.app
#   make install-test            run the installer's tests
#
# Extra flags reach the installer through FLAGS, e.g.
#   make install FLAGS=--no-restart
#   make install FLAGS="--applications $HOME/Applications --keep 3"
SHELL := /bin/bash
.DEFAULT_GOAL := help

# Node 24 lives outside PATH on the maintainer machine; prefer it when present
# and otherwise trust whatever `node` the caller has (the workspace needs >=24).
NODE_RUNTIME := $(HOME)/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
ifneq ($(wildcard $(NODE_RUNTIME)/node),)
export PATH := $(NODE_RUNTIME):$(PATH)
endif

INSTALLER := scripts/install-drogon.mjs
FLAGS ?=
BUNDLE ?=

.PHONY: help install install-main install-test

help:
	@awk '/^#/ { sub(/^# ?/, ""); print; next } { exit }' Makefile

# Packaging imports the workspace's dev dependencies; a fresh worktree would
# otherwise fail deep inside the packager instead of here.
node_modules:
	pnpm install --frozen-lockfile

install: $(if $(BUNDLE),,| node_modules)
	@node $(INSTALLER) $(if $(BUNDLE),--bundle "$(BUNDLE)") $(FLAGS)

install-main:
	@node $(INSTALLER) --from-main $(FLAGS)

install-test:
	@node --test scripts/install-drogon.test.mjs
