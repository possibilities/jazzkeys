# Verification receipt

## Instrument Bench, October 6, 2026

Exact reviewed public source:
[`7008652`](https://github.com/possibilities/jazzkeys/commit/70086523f77c02bfdab38164f8252aa0a285f72b).

- [Mac ARM64 and Ubuntu 24.04 checks](https://github.com/possibilities/jazzkeys/actions/runs/37459777643)
  passed: strict TypeScript, 86 JavaScript tests, Rust formatting/clippy, 37 core
  unit tests and 2 executable-boundary tests, native appearance fixtures, compiled
  packaging and install-layout checks
- The compiled UI now explicitly embeds the published native addon through Bun's
  file loader. Its renderer-free native-binding self-test passes after relocation
  with an empty PATH. Earlier private-worker handshakes did not establish this
  native-UI loader property; they exercised only the worker bootstrap
- [Native macOS screenshots and interaction](https://github.com/possibilities/jazzkeys/actions/runs/37459777478)
  passed on the stock renderer. The four unobstructed editing views in light/dark
  at 1180×780 and 960×680 were visually inspected. Review, uncertain, disconnected
  and read-only captures were also inspected. Warning banners make the workbench
  scroll; the action footer remains fixed. These are isolated demo pixels
- The system appearance helper's native IPC/lifetime and compiled-host integrity
  tests passed on both hosts. CI compares the tested production helper byte-for-byte
  against the packaged helper. Actual macOS preference toggling was not performed
- [Linux live-window acceptance](https://github.com/possibilities/jazzkeys/actions/runs/37459777622)
  failed at the native layout-bounds query before any screenshot. Its bootstrap
  and bounded demo runtime reports passed: ordinary runner account, separate
  loopback-only namespace, no Internet/HID attempts, one exact adjacent appearance
  helper, no package changes. These reports cover the observed startup interval,
  not the unfinished interaction flow. Linux pixels and portal-to-pixel following
  remain unverified

The palettes, controller fixtures, and helper notifications are separate evidence
from real desktop theme changes. There is no user appearance override. No hardware
backend or release binary was enabled by this revision. Full screen-reader,
desktop integration, distribution, and hardware gates below remain open.

## Reviewed source

The first corrected native demo is commit
[`cd2c85a`](https://github.com/possibilities/jazzkeys/commit/cd2c85a0b81e5775ab38f11825e9f1f288f5a91b),
checked on October 6, 2026. Subsequent commits retain these regression checks;
consult the workflow run for the exact later commit rather than transferring this
receipt to changed source.

## Observed results

- [macOS ARM64 and Ubuntu 24.04 checks](https://github.com/possibilities/jazzkeys/actions/runs/37403333438) passed: frozen installation with hooks disabled, strict TypeScript, 30 JS/model/package tests, Rust formatting and strict clippy, 37 core unit tests and 2 executable-boundary tests
- Both host platforms compiled the UI and Rust worker. The installed-style package was relocated into a path containing spaces and completed its private-pipe handshake with an empty PATH and no Bun/Node runtime. A tampered sidecar was rejected before launch
- [Native macOS demo checks](https://github.com/possibilities/jazzkeys/actions/runs/37403333454) passed on macOS 14.8.9 ARM64 with the stock GPUIX 0.10.0 offscreen GPU renderer
- Captured light/dark disconnected, read-only, editing, review, applying, verified and uncertain states at 1180×780 and 960×680, plus a matched stacked-composition alternative
- Inspected native pixels for key proportions/legends, change marks, text contrast, inspector layout, fixed review actions, modal content and narrow reflow. The first capture revealed wrapping labels and an offscreen review button; both were corrected and recaptured
- Actual native hit testing completed select → searchable target → stage → review → Escape with focus return → simulate → verified. This is an isolated demo, not a physical-device experiment
- The AccessKit tree contains labelled buttons, selected physical keys, pending mappings, protected descriptions and the review dialog. This does not establish VoiceOver or AT-SPI usability
- Independent safety review exercised real private filesystem boundaries with fake transport/monotonic clock traces. Regressions cover interrupted journals, exact readback/preservation, target corruption, stale plans, sticky identity faults, cancellation, no replay and bounded malformed requests

All device traffic in safety tests is simulated. No HID device was opened. The
production worker deliberately has no hardware backend or writable capability.
No user desktop application was controlled.

## Evidence limits and next gates

1. Full native keyboard/assistive-technology acceptance still needs its own
   evidence. Disabled host controls have an unavailable description; the pinned
   bridge does not expose every conventional ARIA state. Do not claim full
   screen-reader conformance from a tree dump
2. Linux addon loading and compiled packaging passed; Linux window rendering,
   accessibility, and distribution/session-manager installation remain untested.
   The measured addon floor is GLIBC 2.39
3. The engine cancellation token is not yet a concurrent production IPC/HID
   cancellation reader. A real backend needs deadline/watchdog containment,
   OS ownership, fresh-transport lifecycle, and snapshot/reconciliation wiring
4. Filesystem tests include simulated crashes/torn tails, not actual power-loss
   experiments. Arbitrary-input parser tests are deterministic, not
   coverage-guided fuzzing. Fn has no independent wire-fixture acceptance
5. Binary distribution remains gated on the native/Bun license and source
   inventory, runtime network/permission checks, installation and signing status
6. Hardware metadata, bounded feature queries, slot mapping, a reversible write,
   restoration, USB persistence and Bluetooth behavior are entirely unverified
   and require separate scoped authority

No automatic restoration, daemon, installer permission change, firmware action,
or real mapping operation is part of this receipt.
