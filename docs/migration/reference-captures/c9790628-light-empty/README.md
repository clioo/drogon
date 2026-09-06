# First source-pinned visual reference

Captured 2026-09-05 at 23:31 UTC with Electron 43.4.1 / Playwright, on macOS,
1440 × 1000 renderer viewport, light theme, synthetic empty profile.
This is the legacy Drogon reference, **not the rewritten application**.

| State | Image | SHA-256 |
| --- | --- | --- |
| Initial workspace page | [01-first-window-light.png](01-first-window-light.png) | `e575fe910d1ce9ede244af50fbdf3b03e20177f8df1bbb8fae3e794efc5b2b1d` |
| Bots, empty | [02-bots-light.png](02-bots-light.png) | `df52d59262b5f4737ee630dc60e5a0e6da82eac15765ae9c311d72b835f7ce3d` |
| Meetings, empty | [03-meetings-light.png](03-meetings-light.png) | `43efe02121dfcffc21db533bfdb1fd914e473d3e55f51e361025b5e55f42e66b` |

Frozen source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
The [fixture patch](visual-source.patch) modifies five main-process files to
guard keychain/CLI/hook side effects and bind to loopback; it changes no
renderer source. Patch SHA-256:
`fafa751661885cbd8782d38983d63670bd1428fd1a79974536ba9e299f838874`.

[result.json](result.json) and [application.log](application.log) are exact
copies from the successful run, not rewritten receipts. Their original
temporary paths identify the historical run; the PNGs here preserve the
same bytes durably. Coordinator inspected all three images. The recorded
main PID was absent on a post-close check; detached helpers were not killed
or certified absent. Nothing in this record establishes full runtime
isolation, original-suite success or rewrite parity.

Local detailed build provenance and capture runner remain in
`.preflight/reference-build-Z1ylje/`: `build-result.json`,
`visual-build-result.json`, both build logs, `frozen-out/`, and
`capture-visual-reference.mjs`. The unmodified build and visual build both
exited 0; dependencies were independently copied against the frozen lock,
not freshly installed from a registry. See the parent
[launch audit](../../parity-reference-launch-audit.md) for limitations and
the two failed attempts preceding this result.
