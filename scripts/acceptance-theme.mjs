import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";

export function verifyThemeCaptures(captures) {
  assert.equal(captures.length, 2, "both explicit themes must be captured");
  for (const theme of ["light", "dark"]) {
    const capture = captures.find((item) => item.theme === theme);
    assert.ok(capture, `${theme} capture missing`);
    assert.equal(capture.choice, theme, `${theme} choice did not persist`);
    assert.equal(capture.radioChecked, "true", `${theme} radio was not selected`);
    assert.equal(capture.dark, theme === "dark", `${theme} root class is wrong`);
    assert.ok(capture.background, `${theme} computed background missing`);
    assert.match(capture.sha256, /^[a-f0-9]{64}$/, `${theme} screenshot hash missing`);
  }
  const [first, second] = captures;
  assert.notEqual(first.background, second.background, "theme backgrounds are identical");
  assert.notEqual(first.sha256, second.sha256, "light/dark screenshots are identical");
}

// Use the real preference controls: Electron's native-theme bridge can override
// media emulation, making differently named screenshots show the same theme.
export async function captureSettingsThemes(page, output) {
  const captures = [];
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).click();
    await page.keyboard.press(`${modifier}+,`);
    await page.locator('section[aria-label="Settings"]').waitFor();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const radio = page
      .getByRole("radiogroup", { name: "Theme", exact: true })
      .getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true });
    await radio.click();
    const radioChecked = await radio.getAttribute("aria-checked");
    await page.waitForFunction((wanted) => {
      const raw = window.localStorage.getItem("drogon:settings:ui");
      return raw && JSON.parse(raw).settings?.theme === wanted &&
        document.documentElement.classList.contains("dark") === (wanted === "dark");
    }, theme, { timeout: 10000, polling: 100 });
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.getByRole("button", { name: "New tab", exact: true }).waitFor();
    const png = await page.screenshot({
      path: path.join(output, `${theme}.png`),
      animations: "disabled",
    });
    const rendered = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      if (!shell) throw new Error("app shell missing after theme selection");
      const raw = window.localStorage.getItem("drogon:settings:ui");
      return {
        choice: raw ? JSON.parse(raw).settings?.theme : null,
        dark: document.documentElement.classList.contains("dark"),
        // The shell is transparent; main.css paints the theme on body.
        background: getComputedStyle(document.body).backgroundColor,
        foreground: getComputedStyle(document.body).color,
      };
    });
    captures.push({ theme, radioChecked, ...rendered, sha256: createHash("sha256").update(png).digest("hex") });
  }
  return captures;
}
