# Mac demo releases

The downloadable target is **macOS ARM64 only**. The release workflow builds a
ZIP containing `Jazzkeys.app`, with all runtimes, its matching private worker,
read-only appearance helper, license texts, and notices. A local development
toolchain is not required to use the download. See [installation](INSTALL.md).

## Scope

This is an experimental **no-hardware demo**, without Developer ID signing or
notarization. It supports the native staged-mapping editor and review flow. It
has no production HID transport and cannot read or change a physical keyboard.
Base/Fn capability, persistence, and actual unit compatibility remain unverified.

Native offscreen light/dark/compact rendering, control interactions, keyboard
focus behavior, core fault tests, and compiled-package relocation are automated.
The release ZIP is re-extracted with macOS `ditto` to a path containing spaces;
all files/modes are verified and both renderer-free compiled self-tests run with
an empty PATH. These checks establish packaging integrity, not ordinary GUI
startup or a screen-reader evaluation.

The packaged macOS app's ordinary GUI runtime network behavior and OS permission
prompts have not been observed. No network-silence or complete installation /
accessibility acceptance claim is made. First-party code has no production HID
backend, network feature, service installer, or Accessibility/Input Monitoring
request. Static absence does not prove all bundled native runtime behavior.
Hosted runner TCC preapprovals further limit permission-prompt observations.
The additional live runtime check requires separately coordinated interaction.

The full distribution-acceptance milestone therefore remains open. A labelled
experimental demo is a narrower deliverable, not a completed write-enabled
mapper or a claim that every acceptance gate passed.

## CI and artifact integrity

`mac-release.yml` runs on reviewed main changes to its release marker and by
manual dispatch on main. It has three stages:

1. A read-only Mac job runs locked checks, Rust formatting/lint/fault tests,
   appearance tests, native offscreen interaction checks, package/bundle builds,
   and the archive round trip. Only this job creates executable release bytes.
2. A read-only source job reconstructs the pinned WebKit subset, collects all
   checksum-pinned corresponding sources plus the exact project commit, and
   verifies the complete archive and retained notice inventory.
3. A separate, main-only publishing job receives only `contents: write` and
   `actions: read`, verifies both asset sets and matching commit/tree, then
   creates a versioned draft, uploads and verifies all assets, and publishes a
   prerelease. Build jobs have no publishing token or signing credentials.

Actions are pinned by full commit; Python 3.13.16, Bun, Rust, native dependencies and lockfiles
are pinned. Each release includes a SHA-256 list, exact source commit/tree,
build-run link, bundle manifest, Mac validation receipt, complete source archive,
and source receipt. These establish traceability and consistency, not independent
publisher authentication, notarization, or reproducible source-to-binary proof.
No artifact attestation or reproducible build claim is currently made.

A published asset is never overwritten. A retry may finish a matching draft by
checking existing asset hashes; a mismatch stops publication. A replacement uses
a new source commit/run version and explains the reason. The pipeline creates no
persistent credential and changes no repository visibility or OS security setting.

## Source and notices

The inventory includes pinned native crate/Git closures, Bun and bundled library
sources, fonts, retained notices, worker dependencies, and build/relink recipes.
The exact complete corresponding-source archive is published beside the app at
equivalent access, including the required GPL/MPL/LGPL source inputs. Upstream
links or GitHub's automatic project-source archive alone are not substitutes.
See [third-party notices](../THIRD-PARTY-NOTICES.md) and
[redistribution evidence](redistribution/README.md).

## Remaining acceptance work

- Observe ordinary packaged Mac startup, bounded runtime network/device access,
  permission behavior, quit/uninstall, and system-appearance changes, with the
  owner's coordinated permission for that interaction
- Test VoiceOver on the native app; static roles and keyboard checks do not imply
  complete screen-reader support
- Acquire signing/notarization facilities only if the owner later authorizes them
- Validate any physical-unit reads and writes through separate scoped hardware
  approvals; keep real-device Apply disabled until reviewed evidence exists

Report ordinary demo bugs in Issues. Follow [SECURITY.md](../SECURITY.md) for
sensitive reports. GitHub private vulnerability reporting is not yet verified
enabled; a minimal public request for a private channel is the supported fallback,
without exploit details or personal/device data. This document replaces the
older source-only publication hold now that a complete-source demo release is
explicitly requested; it does not mark unperformed acceptance tests as passed.
