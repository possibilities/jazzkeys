# Release status and gates

## Current status

As of 2026-10-06, this is source/demo work in progress. M0 (native/packaging spine),
M1 (mock editor), and M2 (safety core) are not yet accepted as complete. No real
hardware access, production HID transport, hardware write verification, native
screenshot acceptance, accessibility acceptance, or installed-package acceptance
is claimed. There is no verified downloadable hardware-mapper release.

The installed Linux addon loads but has no native test renderer; ELF inspection
shows a `GLIBC_2.39` requirement. Bun 1.3.10 references up to `GLIBC_2.25`. The
addon governs the stricter known floor; neither load success nor the Ubuntu 24.04
CI choice establishes full Linux rendering/install support. Initial `bun audit
--json` returned an empty report with exit 0 for the locked JS dependencies; this
is not an audit of native code or bundled assets.

Passing tests or compiling a package alone must not change those labels. Record
later results against an exact commit, target, command, and evidence artifact;
keep failed, blocked, and not-run checks distinct.

## Milestone exit criteria

| Milestone | Required evidence |
| --- | --- |
| M0: feasibility | Stock pinned GPUIX renders a native window; compiled app starts with its matching worker from an installed-style location, without system Bun/Node |
| M1: editor | Demo-only stage/review/cancel flow, essential states, keyboard interaction, actual inspected native screenshots |
| M2: core | Independent fake-transport/clock traces, fail-closed plans, bounded IPC, durable snapshot/journal lifecycle, fault and uncertain-outcome tests |
| M3: reads | Authorized H1–H3 evidence for a specific unit/interface/profile/layout; stable real reads; truthful permission/unsupported states |
| M4: writes | Authorized one-key write and restoration, read-back/preservation, separately measured USB persistence and Bluetooth behavior |
| M5: artifacts | Reviewed source, platform install/uninstall, dependency/license inventory, provenance, permission and network checks, truthful signing status |

Source-only, demo-only, and later read-only releases are legitimate when labelled
accurately. None is a completed write-enabled mapper. Apply remains unavailable
without the complete reviewed capability evidence.

CI may build locally and publish screenshots/manifests, but executable uploads
remain blocked by the specific native/Bun provenance and notice inventory in
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md#remaining-binary-release-inventory).

## Binary publication checklist

- Run required checks against the exact release commit. Pin Actions by full commit,
  tools by exact version, and any build container by digest. Use frozen/locked
  installs. Build jobs use minimal read permissions and no publishing secrets.
- Build on each claimed platform. Establish macOS version and Linux libc/library
  floors experimentally; upstream target availability is not a support guarantee.
- Verify the app/worker identity, protocol compatibility, installed relative paths,
  file modes, cleanup, and operation without development runtime installations.
- Complete the native-library and embedded-font license inventory. Include required
  license texts/notices, source obligations, and an SBOM. Current npm wrapper
  notices alone are insufficient; see [third-party inventory](../THIRD-PARTY-NOTICES.md).
- Capture and inspect native light/dark/narrow-state images and keyboard/accessibility
  behavior. No browser rendering may stand in for native platform acceptance.
- Verify runtime network silence, no hidden process/service, no device opens in
  demo/startup, and narrowly scoped permissions. Do not ship a guessed udev rule.
- Record support labels separately: demo, read-only identified, base single-slot
  write, Fn write, USB persistence, Bluetooth behavior; include unit/revision/mode.
- Publish source commit, exact target, build-run link, SHA-256 manifest, dependency
  inventory, and artifact attestations where supported. Checksums alone do not
  establish publisher identity or source-to-binary reproducibility.
- Use a separate protected publishing step. Do not overwrite verified assets;
  publish a new version for replacements with the reason recorded.
- Label unsigned/ad-hoc macOS builds honestly. Developer ID/notarization require
  authorized signing facilities; never advise globally disabling OS protection.
  Prefer a simple auditable Linux package/archive with uninstall instructions.
- Establish a working private security-reporting route before binary distribution.

## Immediate next evidence

Finish stock-runtime/native packaging and fake-core acceptance first. Then request
metadata-only inspection of the intended unit, followed by a separate bounded
feature-query request. Hardware steps, reversible writes, desktop control,
signing access, and release publication each retain their own authorization gates.
