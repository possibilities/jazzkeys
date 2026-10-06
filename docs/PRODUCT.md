# Product

Jazzkeys is a focused native key mapper for the AJAZZ × NACODEX AK820 MAX
mechanical, long-battery-life variant. It is an independent project, unaffiliated
with AJAZZ, NACODEX, GPUIX, or Sharkfin.

## Current status

This is an early source/demo implementation. The project/packaging spike (M0),
mock editor (M1), and device safety core (M2) are in progress. No physical keyboard
has been accessed or validated by this implementation. There is no production
HID transport or accepted write-capable hardware record. Native screenshots,
accessibility acceptance, installed-package validation, and hardware acceptance
are pending. See [release gates](RELEASE.md) and [hardware evidence](HARDWARE.md).

Passing simulated tests never establishes device support. Demo geometry, slots,
keymaps, progress, and outcomes are illustrative and must remain visibly labelled.

## Intended first release

- Configure through a direct USB-C **data** cable in the keyboard's USB mode.
- Inspect only the currently observed onboard profile; do not switch profiles.
- Map an evidenced physical key to one ordinary keyboard usage or standalone
  modifier. Unsupported, firmware-special, macro, consumer, and unknown entries
  remain unchanged. Fn-layer editing requires separate evidence.
- Stage changes locally, undo/redo draft edits, and review the complete diff.
- Save a scoped before-snapshot before applying a minimal changed-slot plan.
- Verify by reading back the affected layer, including preserved entries, and
  distinguish verified, partial, rejected, and uncertain outcomes.
- Restore compatible keymap entries through a new review/apply operation.
- Keep drafts offline after disconnect; require a fresh read before applying.

Apple Silicon macOS and Linux x86-64 GNU are initial validation targets, not
currently verified distribution promises. Other architectures, Windows, and
similarly named keyboard models are outside the initial support contract.

## Deliberate limits

No firmware flashing, bootloader entry, erase, reset, bulk fallback, lighting,
screen images, sleep/debounce settings, wireless setup, macro execution, chords,
profile switching, raw command console, or general device registry. There is no
hidden daemon, global typing hook, host-level remapper, kernel extension, network
service, analytics, account, remote asset, or automatic updater in the product
contract. Runtime offline behavior still needs verification on built artifacts.

Bluetooth can be used for ordinary typing after wired configuration only to the
extent separately confirmed by persistence testing. Bluetooth and receiver
configuration are not implemented; no receiver is required for the intended flow.

## Reading guide

- [Design and interaction](DESIGN.md)
- [Safety contract](SAFETY.md)
- [Protocol scope and provenance](PROTOCOL.md)
- [Hardware status and validation ladder](HARDWARE.md)
- [Development](DEVELOPMENT.md), [release gates](RELEASE.md), [glossary](GLOSSARY.md)
- [Architecture decision](adr/architecture.md)
