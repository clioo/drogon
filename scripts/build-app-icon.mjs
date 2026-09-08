// Builds the committed macOS app icon from the original Drogon SVG mark.
//
//   node scripts/build-app-icon.mjs
//
// Reads apps/desktop/resources/icon.svg and writes icon.icns (the bundle
// icon scripts/package-desktop.mjs passes to @electron/packager) plus
// icon.png (the 512px twin the dev-run dock icon uses). Rasterization is
// deterministic: the repo-pinned Playwright Chromium renders the SVG at
// every iconset size with a transparent backdrop (omitBackground) — the
// previous qlmanage/white-key fallback dropped the dark #171717 tile and
// shipped a white blob (#201). iconutil assembles the .iconset. After
// rendering, assertIconRaster verifies the dark tile, the orange flame
// and the transparent corners so a bad raster cannot be committed again.
// Re-run after replacing icon.svg (Carlos can swap the artwork freely);
// the outputs are committed so packaging never depends on this toolchain.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);

// iconset members: [file name, pixels]. Every slot renders from the vector
// source (never an upscale) so small sizes stay crisp.
const ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

// Minimal PNG reader for the renderer's own output: 8-bit RGBA/RGB,
// non-interlaced (what Chromium screenshots always produce).
export function decodePng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("latin1"), "\x89PNG\r\n\x1a\n", "not a PNG");
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "only 8-bit PNGs are supported");
      colorType = data[9];
      assert.equal(data[12], 0, "interlaced PNGs are not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.ok(colorType === 6 || colorType === 2, `unsupported PNG colour type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  assert.equal(raw.length, (stride + 1) * height, "unexpected PNG scanline payload");
  const pixels = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = raw[cursor + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else assert.equal(filter, 0, `unknown PNG filter ${filter}`);
      line[x] = value & 0xff;
    }
    cursor += stride;
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      pixels[to] = line[from];
      pixels[to + 1] = line[from + 1];
      pixels[to + 2] = line[from + 2];
      pixels[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous.set(line);
  }
  return { width, height, pixels };
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

// Pixel statistics over the rendered mark, in the SVG's own proportions:
// the dark tile is inset 16/512 with 112/512 corner radius, the flame is
// #f97316 with a #fdba74 core and the backdrop stays transparent.
export function iconRasterStats({ width, height, pixels }) {
  const inset = Math.round((width * 16) / 512);
  const tileSpan = width - inset * 2;
  const tileArea = tileSpan * tileSpan;
  let dark = 0;
  let orange = 0;
  for (let y = inset; y < inset + tileSpan; y += 1) {
    for (let x = inset; x < inset + tileSpan; x += 1) {
      const at = (y * width + x) * 4;
      const alpha = pixels[at + 3];
      if (alpha < 200) continue;
      const red = pixels[at];
      const green = pixels[at + 1];
      const blue = pixels[at + 2];
      if (red < 80 && green < 80 && blue < 80) dark += 1;
      else if (red > 150 && red - green > 30 && green > blue) orange += 1;
    }
  }
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ].map(([x, y]) => pixels[(y * width + x) * 4 + 3]);
  return { tileArea, dark, darkCoverage: dark / tileArea, orange, corners };
}

export function assertIconRaster(stats, label) {
  assert.ok(
    stats.darkCoverage > 0.5,
    `${label}: dark tile covers ${(stats.darkCoverage * 100).toFixed(1)}% of the tile area (need > 50%) — the raster lost the #171717 tile (#201)`,
  );
  assert.ok(
    stats.orange >= Math.max(1, Math.floor(stats.tileArea * 0.0002)),
    `${label}: found ${stats.orange} orange flame pixels — the raster lost the #f97316 flame (#201)`,
  );
  assert.ok(
    stats.corners.every((alpha) => alpha === 0),
    `${label}: icon corners must be transparent, got alpha ${stats.corners.join(",")} (#201)`,
  );
}

async function main() {
  assert.equal(process.argv.length, 2, "Use: node scripts/build-app-icon.mjs");
  assert.equal(
    process.platform,
    "darwin",
    "App-icon assembly uses macOS iconutil",
  );

  const root = fileURLToPath(new URL("..", import.meta.url));
  const resources = path.join(root, "apps", "desktop", "resources");
  const svg = path.join(resources, "icon.svg");
  assert.ok(existsSync(svg), `Missing icon source: ${svg}`);
  const svgSource = await readFile(svg, "utf8");
  // No double hyphens: XML comments forbid them and strict SVG renderers
  // reject the file with an error page instead of artwork.
  for (const match of svgSource.matchAll(/<!--([\s\S]*?)-->/g)) {
    assert.ok(
      !match[1].includes("--"),
      "icon.svg must not contain -- inside an XML comment (strict renderers fail)",
    );
  }

  const scratch = await mkdtemp(path.join(tmpdir(), "drogon-icon-"));
  // Imported lazily so test files can use decodePng/iconRasterStats
  // without loading (or installing browsers for) Playwright.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, size] of ICONSET) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      const sized = svgSource.replace(
        "<svg ",
        `<svg width="${size}" height="${size}" `,
      );
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;padding:0}</style>${sized}`,
      );
      const shot = await page.screenshot({ omitBackground: true });
      await page.close();
      const rendered = path.join(scratch, name);
      await writeFile(rendered, shot);
      const raster = decodePng(shot);
      assert.deepEqual(
        { width: raster.width, height: raster.height },
        { width: size, height: size },
        `${name} rendered at the wrong size`,
      );
      assertIconRaster(iconRasterStats(raster), name);
    }
  } finally {
    await browser.close();
  }
  try {
    const iconset = path.join(scratch, "icon.iconset");
    await execFileAsync("/bin/mkdir", ["-p", iconset]);
    for (const [name] of ICONSET) {
      await execFileAsync("/bin/cp", [
        path.join(scratch, name),
        path.join(iconset, name),
      ]);
    }
    const icns = path.join(resources, "icon.icns");
    await execFileAsync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", icns]);
    const { size } = await stat(icns);
    assert.ok(size > 10_000, `Suspiciously small icon.icns (${size} bytes)`);
    // 512px twin for the dev-run dock icon (main sets it when not packaged).
    await execFileAsync("/bin/cp", [
      path.join(scratch, "icon_512x512.png"),
      path.join(resources, "icon.png"),
    ]);
    console.log(JSON.stringify({ status: "ICON-BUILT", icns, bytes: size }));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
