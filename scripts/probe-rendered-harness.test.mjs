import assert from "node:assert/strict";
import test from "node:test";
import {
  renderedPiIsReady,
  sessionTabShowsVerdict,
} from "./probe-rendered-harness.mjs";

function terminal(textContent) {
  return {
    querySelector(selector) {
      assert.equal(selector, ".xterm-screen");
      return textContent === null ? null : { textContent };
    },
  };
}

test("missing terminal is not Pi readiness", () => {
  assert.equal(renderedPiIsReady(terminal(null)), false);
});

test("Pi download paths and generic model words are not readiness", () => {
  assert.equal(
    renderedPiIsReady(
      terminal(
        "fd not found. Downloading... ripgrep installed to /tmp/fixture/pi/bin/rg model ctrl",
      ),
    ),
    false,
  );
});

test("a Pi version without its interactive controls is not readiness", () => {
  assert.equal(renderedPiIsReady(terminal("pi v0.84.1")), false);
});

test("the rendered Pi version and compact interactive controls prove TUI readiness", () => {
  assert.equal(
    renderedPiIsReady(
      terminal(
        "pi v0.84.1 escape interrupt · ctrl+c/ctrl+d clear/exit · / commands",
      ),
    ),
    true,
  );
});

test("an older Pi banner cannot prove a newly launched session is ready", () => {
  const previous = globalThis.window;
  const entry = (text) => ({ buffer: { active: { length: 1, getLine: () => ({ translateToString: () => text }) } } });
  globalThis.window = { __drogonTerminals: new Map([
    ["old", entry("pi v0.84.1 clear/exit")], ["new", entry("starting")],
  ]) };
  try {
    assert.equal(renderedPiIsReady("new"), false);
    assert.equal(renderedPiIsReady("missing"), false);
    globalThis.window.__drogonTerminals.set("new", entry("pi v0.84.1 clear/exit"));
    assert.equal(renderedPiIsReady("new"), true);
  } finally { globalThis.window = previous; }
});

function stubDom(tab) {
  let seen = "";
  globalThis.document = {
    querySelector(selector) {
      seen = selector;
      return tab;
    },
  };
  globalThis.CSS = { escape: (value) => value };
  return () => seen;
}

function ariaTab(name) {
  return { getAttribute: (attr) => (attr === "aria-label" ? name : null) };
}

test("the session tab matches its verdict suffix on the R16-E Terminal N name", () => {
  const seen = stubDom(ariaTab("Terminal 1 live"));
  try {
    assert.equal(
      sessionTabShowsVerdict({ id: "ses-1", suffix: " live" }),
      true,
    );
    assert.match(
      seen(),
      /\[role="tablist"\]\[aria-label="Sessions"\].*\[data-tab-id="ses-1"\]/,
    );
  } finally {
    delete globalThis.document;
    delete globalThis.CSS;
  }
});

test("an unverifiable tab keeps matching through its recovery id suffix", () => {
  const seen = stubDom(ariaTab("Terminal 1 · ses-1:inc-2 unverifiable"));
  try {
    assert.equal(
      sessionTabShowsVerdict({ id: "ses-1", suffix: " unverifiable" }),
      true,
    );
    assert.equal(
      sessionTabShowsVerdict({ id: "ses-1", suffix: " live" }),
      false,
    );
    assert.ok(seen().length > 0);
  } finally {
    delete globalThis.document;
    delete globalThis.CSS;
  }
});

test("a missing tab or a missing accessible name never matches", () => {
  let seen = stubDom(null);
  try {
    assert.equal(
      sessionTabShowsVerdict({ id: "ses-1", suffix: " live" }),
      false,
    );
    assert.ok(seen().length > 0);
  } finally {
    delete globalThis.document;
    delete globalThis.CSS;
  }
  seen = stubDom({ getAttribute: () => null });
  try {
    assert.equal(
      sessionTabShowsVerdict({ id: "ses-1", suffix: " live" }),
      false,
    );
    assert.ok(seen().length > 0);
  } finally {
    delete globalThis.document;
    delete globalThis.CSS;
  }
});
