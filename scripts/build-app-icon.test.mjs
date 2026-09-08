// Unit tests for the app-icon generator's PNG decoder and pixel-statistics
// verification (scripts/build-app-icon.mjs). Synthetic rasters only — no
// Chromium needed. The committed-artifact regression check lives in
// scripts/desktop-artifacts.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import {
  assertIconRaster,
  decodePng,
  iconRasterStats,
} from "./build-app-icon.mjs";

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 8 + data.length);
  return out;
}

// Filter-0 RGBA encoder: just enough PNG for decodePng round-trips.
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paint(pixels, width, box, [red, green, blue, alpha]) {
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const at = (y * width + x) * 4;
      pixels[at] = red;
      pixels[at + 1] = green;
      pixels[at + 2] = blue;
      pixels[at + 3] = alpha;
    }
  }
}

// A 64px stand-in for the real mark: dark tile (inset 16/512 → 2px),
// white D stroke, orange flame, transparent corners.
function goodIcon(size = 64) {
  const pixels = Buffer.alloc(size * size * 4);
  const inset = Math.round((size * 16) / 512);
  const span = size - inset * 2;
  paint(pixels, size, { x: inset, y: inset, w: span, h: span }, [23, 23, 23, 255]);
  paint(pixels, size, { x: inset + 4, y: inset + 4, w: 4, h: span - 8 }, [250, 250, 250, 255]);
  paint(pixels, size, { x: inset + span - 12, y: inset + 2, w: 6, h: 8 }, [249, 115, 22, 255]);
  return decodePng(encodePng(size, size, pixels));
}

test("decodePng round-trips RGBA pixels through filter-0 PNG", () => {
  const raster = goodIcon(32);
  assert.equal(raster.width, 32);
  assert.equal(raster.height, 32);
  assert.deepEqual([...raster.pixels.subarray(0, 4)], [0, 0, 0, 0]);
  const inset = Math.round((32 * 16) / 512);
  const at = (inset * 32 + inset) * 4;
  assert.deepEqual([...raster.pixels.subarray(at, at + 4)], [23, 23, 23, 255]);
});

test("decodePng rejects non-PNG input", () => {
  assert.throws(() => decodePng(Buffer.from("not a png")), /not a PNG/);
});

test("assertIconRaster accepts the Drogon mark proportions", () => {
  const stats = iconRasterStats(goodIcon());
  assert.ok(stats.darkCoverage > 0.5);
  assert.ok(stats.orange > 0);
  assert.deepEqual(stats.corners, [0, 0, 0, 0]);
  assertIconRaster(stats, "synthetic");
});

test("assertIconRaster rejects the #201 white-blob regression", () => {
  // What the broken committed icon.png looked like: the white D on a
  // transparent backdrop, no dark tile at all.
  const size = 64;
  const pixels = Buffer.alloc(size * size * 4);
  paint(pixels, size, { x: 16, y: 16, w: 12, h: 32 }, [250, 250, 250, 255]);
  const stats = iconRasterStats(decodePng(encodePng(size, size, pixels)));
  assert.equal(stats.darkCoverage, 0);
  assert.throws(() => assertIconRaster(stats, "blob"), /dark tile/);
});

test("assertIconRaster rejects an opaque white backdrop", () => {
  // The qlmanage failure shape: artwork thumbnailed onto opaque white.
  const raster = goodIcon();
  for (let at = 0; at < raster.pixels.length; at += 4) {
    if (raster.pixels[at + 3] === 0) {
      raster.pixels[at] = 255;
      raster.pixels[at + 1] = 255;
      raster.pixels[at + 2] = 255;
      raster.pixels[at + 3] = 255;
    }
  }
  const stats = iconRasterStats(raster);
  assert.throws(() => assertIconRaster(stats, "opaque"), /corners must be transparent/);
});

test("assertIconRaster rejects a mark that lost the flame", () => {
  const size = 64;
  const pixels = Buffer.alloc(size * size * 4);
  const inset = Math.round((size * 16) / 512);
  const span = size - inset * 2;
  paint(pixels, size, { x: inset, y: inset, w: span, h: span }, [23, 23, 23, 255]);
  const stats = iconRasterStats(decodePng(encodePng(size, size, pixels)));
  assert.ok(stats.darkCoverage > 0.5);
  assert.equal(stats.orange, 0);
  assert.throws(() => assertIconRaster(stats, "flameless"), /flame/);
});
