# Packaging icon invariant (R16-BO, fixes #319)

The Drogon bundle must never carry the stock Electron icon, and a sealed
acceptance PASSED must imply installable.

- `node scripts/package-desktop.mjs` calls `ensureAppIcon` (in
  `scripts/desktop-artifacts.mjs`) before any bundle byte exists: a missing
  `apps/desktop/resources/icon.icns`, or one older than `icon.svg` or
  `scripts/build-app-icon.mjs`, is rebuilt in-process through the same
  `buildAppIcon` code path (stdout keeps the `ICON-BUILT` record). A failed
  rebuild aborts packaging outright — no bundle with stock `electron.icns`
  is ever produced.
- `node scripts/accept-desktop.mjs --bundle` records the sealed check
  `bundle-carries-drogon-icon`: `CFBundleIconFile == icon.icns`, the `.icns`
  exists at more than 50 KB, and its sha256 equals
  `apps/desktop/resources/icon.icns` when that file is present.
- `node scripts/install-preview.mjs` verifies the incoming bundle strictly
  but reads the previous preview build leniently: an old preview that fails
  a newer invariant only logs `PREVIOUS-BUILD-LENIENT` with its recovery
  revision and the install continues (the previous build is kept for
  rollback only).

Unit coverage lives in `scripts/desktop-artifacts.test.mjs` and runs under
`pnpm test:packaging`.
