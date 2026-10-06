# Hardware status

**No device is currently verified writable by JazzKeys.** No physical keyboard has
been accessed during this implementation. Production HID access is not yet
implemented. Candidate IDs and simulated success cannot enable public writes.

## Candidate evidence, not support

| Field | Candidate / unresolved evidence |
| --- | --- |
| Target | AK820 MAX mechanical long-battery-life variant |
| Connection | Direct USB data cable; receiver and Bluetooth configuration excluded |
| Reported USB ID | `3151:4015`, from another unit |
| Reported internal ID | `1694` / `0x069E`, from another unit |
| Candidate family | `yc500` |
| Candidate interface | Vendor usage page/usage `0xFFFF:2`, subject to actual descriptor |
| Candidate reports | 64-byte feature payload; report ID 0 |
| Exact controller/firmware/mode | Not measured |
| Physical-key → slot map | Unknown; provisional demo geometry is not evidence |
| Profile count | Unknown; reference count and observed index conflict |
| Base/Fn write, knob, reserved keys | Not verified |
| USB persistence / Bluetooth behavior | Not tested |

See [pinned protocol sources](PROTOCOL.md). Similarly named Pro, HE, Ultra, Max
Plus, or other variants are unsupported. No QMK/VIA compatibility is asserted.

## Authorization and validation ladder

Each hardware step needs current, scoped owner authorization. Building software
or publishing source does not authorize device access. Inspecting a desktop app
also requires a separately coordinated interaction where applicable.

1. **H0, no hardware:** complete the demo and core/fake-transport behavior matrix.
2. **H1, metadata only:** authorize inspection of the named connected unit; record
   actual USB identity, bus, interface/descriptor, mode, and selection ambiguity.
   Do not send feature reports as part of metadata enumeration.
3. **H2, bounded queries:** separately authorize the exact read-only feature-report
   queries. Capture identity/profile and two matching exact-length keymap sweeps.
   These GETs send traffic even though they must not mutate configuration.
4. **H3, layout:** establish geometry and physical-slot evidence independently.
   Normal typing events show output usages, not necessarily vendor matrix slots.
5. **H4, one-key commissioning:** after the earlier evidence, obtain authorization
   for one named nonessential physical key, exact before-entry, ordinary target,
   expected slot, and single-send/read-back procedure. Save the before-snapshot;
   have another input method available. Obtain deliberate approval for the scoped
   restoration too. A successful probe establishes only the tested slot.
6. **H5, persistence/preservation:** separately check USB replug, ordinary Bluetooth
   typing, supported layers, and all supposedly preserved entries.
7. **H6, release:** reconcile source tests, native design/accessibility, packaging,
   permissions, offline behavior, provenance, and the measured support record.

A commissioning record is local, experimental, and bound to that measured unit;
it is not a public `--unsafe` switch. Reuse the normal core and do not expose raw
commands. No write-capability record enters release assets before review.

Stop on mismatch, unstable reads, timeout, stall, contention, or missing evidence.
Do not brute-force queries, replay uncertain writes, reset, or flash to pass a
test. Close other configurators before authorized testing. Preserve the draft,
snapshot, journal, exact failure, and redacted evidence; never publish serials,
private paths, raw identity captures, or identifying product-label photographs by
default. No udev rule should be guessed before the real interface is known.
