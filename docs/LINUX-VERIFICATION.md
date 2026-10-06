# Linux native acceptance

## Scope and measured status

Linux acceptance targets Ubuntu 24.04 x86-64 GNU, Bun 1.3.10, and unmodified
published `@gpuix/react` / `@gpuix/native` 0.10.0. The current harness is intended
to exercise a real **Wayland** application surface through Weston 13's kiosk
shell, with Mesa lavapipe software Vulkan. Weston uses its X11 backend inside a
fresh, authenticated Xvfb server solely to expose the dedicated output pixels.
This is not the unavailable GPUIX Linux offscreen test renderer, a browser app,
an inherited desktop session, or evidence of native X11 support.

[Run 37459777622](https://github.com/possibilities/jazzkeys/actions/runs/37459777622),
commit `70086523f77c02bfdab38164f8252aa0a285f72b`, passed typechecking, 86 JS tests,
compiled package construction and relocated native-loader/worker smoke checks.
Its original direct-X11 visual step failed at the stock automation bounds query.
The retained `evidence.json` was empty: no system-follow pixels, interactions or
fixture screenshots were established. Bootstrap and bounded early-GUI runtime
receipts passed, including zero Internet/HID attempts, uid 1001, one verified
appearance helper, an isolated loopback-only network namespace and unchanged
package hashes. Those finite early traces do not establish a complete GUI flow.

[Run 37463394496](https://github.com/possibilities/jazzkeys/actions/runs/37463394496),
commit `6a7bc868065acc5b59658e2ca0267dbb8377e417`, successfully exercised the
corrected nested-Wayland route. Its 35 PNGs cover the installed flow and 28
fixtures. Actual canvas RGB values were `[23,28,25]` for both dark captures and
`[243,241,235]` for both light captures. The native select/search/stage/review,
Escape/Enter focus-return, simulate and verified flow passed. Every capture's
before/after scene attested the expected sole fullscreen app surface. Sensor,
bootstrap and GUI traces passed; the GUI trace recorded 2,602 syscalls, zero
Internet/HID attempts, the exact private Wayland socket, one hash-verified
appearance helper, uid 1001, no routes and unchanged package hashes.

Direct inspection of all 35 images found coherent readable layouts and dialogs,
with one explicit caveat: warning banners push part of the mapping rail below
the initial scroll position in read-only/offline states.

[Run 37464547938](https://github.com/possibilities/jazzkeys/actions/runs/37464547938),
commit `8caa3a8ffdd98cc9d3d645ca846f1cdf5d7425b8`, also passed all four read-only
native-wheel assertions and retained 39 PNGs. Inspected scrolled images show
the complete rail and controls above the unchanged footer in both themes/sizes.
Offsets changed from zero to -56 pixels at 1180×780 and -55 at 960×680. Reported
bordered footer bounds are y=717/617 and height=63; their sum reaches the viewport
bottom. The gate compares stable before/after geometry and that bottom alignment,
rather than confusing the reported content box with the CSS outer height.
Runtime/sensor and system-follow checks passed again. X11 and physical keyboard
or screen-reader acceptance remain outside these results.

## Why the stock addon cannot select X11

The published addon used by that run has SHA-256
`a907deb0557f57d698599d635b02bd1452eeeeb0af44a0fe5029e4d4a70ea44d`.
Its ELF symbol `gpui_linux::linux::current_platform` is at `0xec60a0`.
Read-only disassembly of that same hash shows checks for `ZED_HEADLESS` and
`WAYLAND_DISPLAY`, followed only by `WaylandClient::new` or
`HeadlessClient::new`. There is no `DISPLAY` lookup or X11 selection branch.

The pinned release source explains the omission:

- [Native Cargo features](https://github.com/remorses/gpuix/blob/9fcd628863e354e9c58019fc3bf38981a1e64158/packages/native/Cargo.toml)
  enable `gpui_platform/x11`
- [Platform Cargo features](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/crates/gpui_platform/Cargo.toml)
  forward that to `gpui_linux/x11`
- [Linux Cargo features](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/crates/gpui_linux/Cargo.toml)
  omit `gpui/x11` from that feature, while Wayland forwards `gpui/wayland`
- [Compositor selection](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/crates/gpui/src/platform.rs)
conditionally compiles its `DISPLAY` read under the missing `gpui/x11` feature;
  [workspace dependencies](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/Cargo.toml)
  disable GPUI default features

The matched addon can be inspected without executing or changing native code:

```sh
sha256sum node_modules/@gpuix/native-linux-x64-gnu/*.node
nm -C node_modules/@gpuix/native-linux-x64-gnu/*.node | grep 'gpui_linux::linux::current_platform'
objdump -d -C --start-address=0xec60a0 --stop-address=0xec62af node_modules/@gpuix/native-linux-x64-gnu/*.node
```

With no Wayland display, the addon selects GPUI's headless platform. Its
[window implementation](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/crates/gpui_linux/src/linux/headless/window.rs)
no-ops drawing/frame callbacks, explaining the bounds timeout and absent X11
connection in the receipt. Increasing the test timeout cannot create a window.
An upstream correction would forward `gpui/x11` and rebuild the addon. Jazzkeys
neither patches that binary nor substitutes a fork: the supported stock Wayland
branch is used instead. X11 remains unverified/unavailable for this release.

## Isolated native route

[Ubuntu Noble's Weston manual](https://manpages.ubuntu.com/manpages/noble/man1/weston.1.html)
documents the X11 backend, one output, pixman renderer, kiosk shell, explicit
socket/dimensions/scale, no-config/no-input modes and disabled idle timeout. The
[official Weston 13 source](https://wayland.freedesktop.org/releases/weston-13.0.0.tar.xz)
confirms that kiosk makes the sole application fullscreen and output-sized.
No shell panel or launcher is created. No Xwayland, DRM backend, real device,
framework patch, or dependency change is part of this route.

The X11 backend's `--no-input` still creates a `wl_seat` global, then skips
keyboard/pointer-device creation (`x11_input_create` in Weston 13's
`libweston/backend-x11/x11.c`). GPUI requires the seat, but its keyboard/pointer
capabilities are optional. All test input uses stock GPUI native UI-thread
automation. This also avoids a Weston 13 cursor trap: X11 LeaveNotify calls
`clear_pointer_focus`, which is an empty stub in `libweston/input.c`; merely
moving the outer X11 pointer away does not reliably remove a Wayland cursor.
No-input initialization and the actual input flow still require a CI receipt.

The workflow is designed to:

1. Install native tools from official Ubuntu repositories, use pinned actions and
   Bun/Rust, and run frozen package installation with lifecycle scripts disabled
2. Build the actual compiled executable and reviewed sidecars, verify integrity,
   then relocate them into a directory containing spaces, with no system Bun/Node
   or PATH dependency in the compiled executable
3. Start a fresh authenticated Xvfb server with TCP disabled, private D-Bus,
   mode-0700 runtime directory, temporary HOME and the sole lavapipe Vulkan ICD
4. Create a disposable network namespace, drop to the ordinary runner account
   before running app/test/native code, and require only loopback with no routes;
   host network settings and AppArmor are not changed
5. Validate the negative-control syscall sensor; trace the compiled bootstrap and
   GUI separately under the existing runtime policy and package-hash checks
6. Start a new Weston kiosk compositor for the installed app and for each fixture.
   It inherits only the private Xvfb display. The app receives its fresh Wayland
   socket with `DISPLAY` and `WAYLAND_SOCKET` removed, so it cannot silently use
   an inherited X11 or Wayland connection
7. Start the test-only Settings portal on the private bus. Require initial dark
   and live light → dark → light transitions through the packaged observer and
   React app. Every transition must repaint a known canvas margin to the exact
   expected palette in real output pixels; no user theme setting is changed
8. Exercise stock GPUI native hit testing/key dispatch: open demo → select Caps →
   search/choose Escape → stage → review → Escape dismissal → Enter reopen through
   restored focus → simulate → verified. This is synthetic local editor input,
   not physical keyboard or HID evidence
9. Capture disconnected, read-only, editing, review, applying, verified and
   uncertain fixtures in light/dark at 1180×780 and 960×680. Each new compositor
   has exactly that output size, avoiding inferred crop coordinates or scaling
10. In every read-only fixture, dispatch an actual stock-native wheel event into
    the workspace and require the complete mapping rail above the fixed footer.
    Retain initial/scrolled pixels, before/after rail/footer geometry and reported
    scroll offsets; save failure pixels and fail if the rail remains occluded

## Pixel ownership and evidence

Before and after each capture, `weston-debug scene-graph` obtains the one-shot
scene from the private compositor. The parser requires one output with exact
size and scale 1; one mapped `xdg_toplevel` surface with the expected native PID,
title and app ID; exact full-output bounds; and no other client surface. Only the
fixed compositor-owned kiosk background is allowed. Weston obtains PID from
`wl_client_get_credentials`, independently of the application automation tree.
Cursor/unknown client surfaces fail the gate; no compositor pointer device is
created, while stock native GPUI automation remains mandatory.

Weston 13's output window sets class `Weston Compositor` and name
`Weston Compositor - screen0` (the actual scene output name is checked), but no
`_NET_WM_PID`. The harness requires no pre-existing compositor window, exactly one
new visible class match, a stable XID, matching `xprop` identity, exact
`xwininfo` dimensions and zero border. ImageMagick captures only that XID,
never the X11 root, a screen crop, or any user desktop. Pixel dimensions and
nonblank content remain mandatory; system-follow checks also validate the
actual canvas color.

The ephemeral compositor enables `--debug` only to attest scene ownership.
Weston's debug interface can expose sensitive information and must never be
enabled on a user's compositor. Here the socket lives in a newly created private
0700 directory, only synthetic Jazzkeys windows exist, and the process/socket
are destroyed at the end of each test. Protocol traffic, credentials, and user
files are not collected.

`artifacts/linux-native/` retains environment/package versions, native-addon
hash/ELF requirements, Weston logs, per-output startup identity, scene graphs,
X11 output identity/geometry, PNGs, native trees/text and `evidence.json`.
`artifacts/runtime/` retains only summary receipts described in
[runtime verification](RUNTIME-VERIFICATION.md); raw traces and traced-process
stderr stay on the disposable runner. Artifacts expire after 14 days. The
workflow never publishes release binaries.

Stock automation's initialization size is not an acceptance measurement.
Native painted bounds, compositor geometry and pixel size are independent
gates. Linux's thread-local painted-text registry remains informational only.
Inspect all final screenshots for clipping, labels, contrast, spacing and focus;
nonblank pixels do not prove visual quality. This route does not establish
AT-SPI, actual distribution installation, a physical GPU, native X11, macOS
permissions, hardware safety, or a lower libc floor. The measured addon requires
GLIBC 2.39; Ubuntu 22.04 support is not claimed.

## Failure handling

Missing compositor/window identity, mapped surface, native bounds, software
Vulkan, namespace/display isolation, expected interaction, trace permission or
valid pixels fails the job. There is no success-by-skip or mock/browser fallback.
All processes have bounded startup/runtime/shutdown deadlines. Diagnose the
retained receipts before changing the app or claiming the new route works.
