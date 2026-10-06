# Linux native acceptance

## Scope and status

The Linux acceptance workflow targets Ubuntu 24.04 x86-64 GNU, Bun 1.3.10,
and the unmodified published `@gpuix/react` and `@gpuix/native` 0.10.0 packages.
It uses a real native application window in a new Xvfb X11 session, with Mesa
lavapipe software Vulkan. It is not a browser edition or the unavailable Linux
offscreen test renderer. A workflow definition, tree dump, or PNG file alone is
not a visual acceptance receipt: inspect the images from the exact tested commit
and record the run before claiming a pass.

The production entrypoint stays disconnected and does not interpret fixture
arguments. A separate `packaging/linux-fixture.ts` entrypoint mounts the existing
bounded synthetic scenarios with the same production components. No hardware
backend, device enumeration, device write, framework patch, or dependency change
is part of this route.

## Why a live X11 window

The [exact 0.10.0 release source](https://github.com/remorses/gpuix/tree/9fcd628863e354e9c58019fc3bf38981a1e64158)
and the installed package were checked rather than assuming Linux support from
the macOS test harness:

- [`lib.rs`](https://github.com/remorses/gpuix/blob/9fcd628863e354e9c58019fc3bf38981a1e64158/packages/native/src/lib.rs)
  makes `TestGpuixRenderer` unavailable on Linux and explicitly retains
  `GpuixRenderer` there
- [`renderer.rs`](https://github.com/remorses/gpuix/blob/9fcd628863e354e9c58019fc3bf38981a1e64158/packages/native/src/renderer.rs)
  implements the live Linux UI thread, native input dispatch, tree/bounds/text
  queries, and focus operations. Its `capture_screenshot` implementation requires
  a macOS or Windows test-support build, so this harness never calls it on Linux
- The published `@gpuix/native/automation` API supports private stdio `App`
  connections to live renderers. It dispatches clicks and keystrokes through GPUI,
  rather than invoking React handlers or changing the model directly
- The release's [GPUI X11 implementation](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/crates/gpui_linux/src/linux/x11/window.rs)
  uses `WgpuRenderer`. Xvfb supplies an X11 window and Mesa supplies the software
  Vulkan device. X11's window-image capture supplies the pixels without needing
  GPUI's unsupported Linux render-to-image API

The stock stdio initialization reply in this version reports an 800×600 default;
it is not trusted as the actual window size. Each screenshot must have the exact
requested dimensions and is accompanied by `xwininfo` and native painted bounds.
The live automation tree intentionally omits style fields. The paint-text registry
is thread-local, while Linux runs painting on its UI thread, so retained text plus
actual UI-thread painted bounds are used for readiness; `getPaintedText` is not a
Linux acceptance gate. Pixel evidence remains independent of those metadata APIs.

## Reproduction and artifacts

Run `.github/workflows/linux-native.yml` on the reviewed commit. The workflow:

1. Installs native display/runtime tools only from the official Ubuntu package
   repositories, uses pinned action commits and Bun/Rust versions, and performs a
   frozen dependency installation with lifecycle scripts disabled
2. Builds the actual UI executable and reviewed worker, checks package integrity,
   then relocates the shipset into a directory containing spaces. This is an
   installed-style executable check, not proof of distribution/package-manager or
   desktop-menu installation
3. Starts a new authenticated Xvfb display with TCP disabled, a private D-Bus
   session, a fresh runtime directory, and the sole Mesa lavapipe ICD. It does not
   connect to an inherited display or any user's desktop
4. Creates a disposable network namespace, drops back to the ordinary runner
   account with an explicit clean environment and temporary HOME before executing
   application code, and checks that only loopback and
   no routes remain. It does not modify host network settings or AppArmor policy
5. Traces the compiled bootstrap/private-worker handshake separately, then the
   compiled GUI demo. The executable runs with an empty PATH. Runtime evidence
   comes from the app descendants, not from the screenshot/test driver
6. Starts the test-only Settings portal on that private bus before the compiled
   app. Checks an initial dark read and live light → dark → light signals through
   the actual packaged appearance observer and React app. Every transition must
   repaint a known canvas margin to the expected palette in captured X11 pixels.
   No actual desktop preference or user-facing appearance override is changed
7. Exercises native hit testing and native key dispatch through open demo → select
   Caps → search/choose Escape → stage → review → Escape dismissal → Enter reopen
   through restored focus → simulate → verified. These are synthetic local editor
   actions; they do not test physical key input
8. Captures light/dark disconnected, read-only, editing, review, applying, verified
   and uncertain states at 1180×780 and 960×680 in the single Instrument Bench
   composition, including its height-aware compact geometry. Captures only the single visible window matching the native app's
   PID and expected title, never a desktop/root-window image

`artifacts/linux-native/` records the source commit, runner image version, OS,
kernel, Bun, libc, package versions, Vulkan device, native addon SHA-256 and ELF
version requirements, individual window geometry, PNGs, text and tree records.
`artifacts/runtime/` contains the bounded syscall evidence and reports documented
in [runtime verification](RUNTIME-VERIFICATION.md). Only its summary reports are
uploaded; raw syscall streams and traced-process stderr stay on the ephemeral
runner. Uploaded artifacts are retained for 14 days; the workflow does not
publish binary releases or send screenshots to users.

The pixel checker rejects wrong-sized or essentially blank images and verifies
the explicit system-follow canvas-color assertions. It cannot
judge text clipping, hierarchy, focus clarity, readable labels, or visual polish.
Those still require inspecting the actual output pixels. A screenshot matrix
does not establish AT-SPI/screen-reader behavior, Wayland, a physical GPU,
distribution installation, hardware correctness, or a lower glibc floor. The
published Linux addon requires GLIBC 2.39; Ubuntu 22.04 is not claimed.

## Failure handling

Missing native rendering, software Vulkan, isolated network/display setup,
automation responses, expected states, trace permissions, or valid images fails
the job. There is no success-by-skip and no fallback to a mock/browser renderer.
The app runs under bounded timeouts; Xvfb and the namespace end with the test.
Inspect the uploaded stderr, Vulkan report, screenshots, and syscall report to
diagnose a failure before changing the app or declaring Linux unavailable.
