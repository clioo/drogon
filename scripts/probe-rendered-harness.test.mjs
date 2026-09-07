import assert from "node:assert/strict";
import test from "node:test";
import { renderedPiIsReady } from "./probe-rendered-harness.mjs";

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
