// Builds the committed macOS app icon from the original Drogon SVG mark.
//
//   node scripts/build-app-icon.mjs
//
// Reads apps/desktop/resources/icon.svg and writes icon.icns (the bundle
// icon scripts/package-desktop.mjs passes to @electron/packager) plus
// icon.png (the 512px twin the dev-run dock icon uses). No npm runtime
// dependencies: SVG rasterization prefers rsvg-convert when installed and
// otherwise uses the macOS-native QuickLook thumbnailer, whose opaque
// white backdrop is keyed back to transparency with an embedded Pillow
// step; iconutil assembles the .iconset. Re-run after replacing icon.svg
// (Carlos can swap the artwork freely); the outputs are committed so
// packaging never depends on this toolchain.
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

const execFileAsync = promisify(execFile);

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
// No double hyphens: XML comments forbid them and strict SVG renderers
// (WebKit, rsvg) reject the file with an error page instead of artwork.
for (const match of (await readFile(svg, "utf8")).matchAll(/<!--([\s\S]*?)-->/g)) {
  assert.ok(
    !match[1].includes("--"),
    "icon.svg must not contain -- inside an XML comment (strict renderers fail)",
  );
}

function commandAvailable(name) {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((directory) => {
      try {
        return existsSync(path.join(directory, name));
      } catch {
        return false;
      }
    });
}

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

// qlmanage thumbnails onto an opaque white backdrop, so key near-white
// pixels connected to the border back to transparency and intersect with
// the tile's own rounded-rect mask (the SVG insets the tile 16/512 with
// rx 112/512). Pillow-only, C-speed flood fill; the white D mark is safe
// because the dark tile ring disconnects it from the border seed.
const KEY_WHITE_POST = `import os, subprocess, sys
from PIL import Image, ImageDraw, ImageChops
scratch, svg, sizes_arg, names_arg = sys.argv[1:5]
sizes = [int(x) for x in sizes_arg.split(",")]
names = names_arg.split(",")
for name, size in zip(names, sizes):
    big = size * 2
    done = subprocess.run(
        ["qlmanage", "-t", "-s", str(big), "-o", scratch, svg],
        capture_output=True,
    )
    assert done.returncode == 0, "qlmanage failed for %s: %s" % (
        name, done.stderr.decode()[-500:])
    src = os.path.join(scratch, os.path.basename(svg) + ".png")
    assert os.path.exists(src), "qlmanage produced no thumbnail for %s" % name
    img = Image.open(src).convert("RGBA")
    if img.size != (big, big):
        img = img.resize((big, big))
    os.remove(src)
    rgb = img.convert("RGB")
    ImageDraw.floodfill(rgb, (0, 0), (255, 0, 255), thresh=24)
    magenta = Image.new("RGB", img.size, (255, 0, 255))
    keyed = ImageChops.difference(rgb, magenta).convert("L").point(
        lambda v: 0 if v < 128 else 255)
    inset = round(big * 16 / 512)
    rad = round(big * 112 / 512)
    tile = Image.new("L", img.size, 0)
    ImageDraw.Draw(tile).rounded_rectangle(
        [inset, inset, big - inset, big - inset], radius=rad, fill=255)
    img.putalpha(ImageChops.darker(keyed, tile))
    img.resize((size, size), Image.LANCZOS).save(os.path.join(scratch, name))
`;

const scratch = await mkdtemp(path.join(tmpdir(), "drogon-icon-"));
try {
  if (commandAvailable("rsvg-convert")) {
    for (const [name, size] of ICONSET) {
      await execFileAsync("rsvg-convert", [
        "--width",
        String(size),
        "--height",
        String(size),
        "--output",
        path.join(scratch, name),
        svg,
      ]);
    }
  } else {
    assert.ok(
      commandAvailable("qlmanage") && commandAvailable("python3"),
      "Need rsvg-convert, or macOS qlmanage plus python3, to rasterize icon.svg",
    );
    await assertPythonImaging();
    const post = path.join(scratch, "key-white.py");
    await writeFile(post, KEY_WHITE_POST);
    await execFileAsync("python3", [
      post,
      scratch,
      svg,
      ICONSET.map(([, size]) => size).join(","),
      ICONSET.map(([name]) => name).join(","),
    ]);
  }
  for (const [name, size] of ICONSET) {
    const rendered = path.join(scratch, name);
    assert.ok(existsSync(rendered), `Renderer produced no ${name}`);
    assert.deepEqual(
      await pngDimensions(rendered),
      { width: size, height: size },
      `${name} rendered at the wrong size`,
    );
  }
  // Sanity probe: the tile's dark field must sit left of centre. An XML
  // error page (or any non-artwork fallback) fails here instead of
  // shipping a broken icon.
  await assertTileProbe(path.join(scratch, "icon_512x512.png"));

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

async function assertPythonImaging() {
  try {
    await execFileAsync("python3", ["-c", "import PIL.Image, PIL.ImageDraw, PIL.ImageChops"]);
  } catch {
    assert.fail(
      "build-app-icon: the qlmanage path needs Pillow (pip install pillow) or rsvg-convert",
    );
  }
}

async function pngDimensions(file) {
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function assertTileProbe(png) {
  const probe = await execFileAsync("python3", [
    "-c",
    "import sys; from PIL import Image; " +
      "img = Image.open(sys.argv[1]).convert('RGB'); " +
      "w, h = img.size; " +
      "print('%d,%d,%d' % img.getpixel((int(w * 0.08), int(h * 0.5))))",
    png,
  ]);
  const [red, green, blue] = probe.stdout.trim().split(",").map(Number);
  assert.ok(
    red < 80 && green < 80 && blue < 80,
    `Icon render sanity probe failed (edge pixel ${red},${green},${blue}, expected the dark tile)`,
  );
}
