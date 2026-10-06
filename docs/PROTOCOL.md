# Protocol scope and provenance

This is a bounded reference for implementation and review, **not permission to
send these commands to a keyboard**. The candidate remains read-only and no
production HID transport is implemented. Public support cannot be inferred from
a matching product name, VID/PID, or successful mock test.

## Evidence baseline

The packet facts below come from Sharkfin v0.9.3, pinned at
[`4860eafbcb543d93ce09285204b91f6d853f54b1`](https://github.com/dniminenn/sharkfin/tree/4860eafbcb543d93ce09285204b91f6d853f54b1):
its [protocol reference](https://github.com/dniminenn/sharkfin/blob/4860eafbcb543d93ce09285204b91f6d853f54b1/docs/PROTOCOL.md),
[device record](https://github.com/dniminenn/sharkfin/blob/4860eafbcb543d93ce09285204b91f6d853f54b1/app/src-tauri/data/devices.json#L5057-L5080),
and [additional evidence](https://github.com/dniminenn/sharkfin/blob/4860eafbcb543d93ce09285204b91f6d853f54b1/app/src-tauri/data/devices.extra.json#L712-L715).
[Report #15](https://github.com/dniminenn/sharkfin/issues/15) concerns another unit;
its mutable discussion is supporting evidence, not a measured Jazzkeys unit.

Jazzkeys uses independently structured first-party code informed by these GPL
references. It is licensed GPL-3.0-or-later and does **not** claim clean-room
provenance. Retain source/license attribution for any adapted fixtures or code.

## Candidate yc500 subset

| Purpose | Reference encoding | Gate |
| --- | --- | --- |
| Identify | `0x8F`; opcode then little-endian u32 internal ID | Bounded read authority |
| Revision | `0x80` | Board-specific interpretation required |
| Current profile | `0x85`; index at reply byte 1 | Observe only; no count inference |
| Base map read | `0x89`, `[profile, page]`, pages 0–7 | Evidenced read capability |
| Fn map read | `0x90`, same candidate shape | Separately evidenced |
| Base single-slot write | `0x13`; profile/slot at bytes 1/2, entry at 8–11 | Verified capability and explicit plan |
| Fn single-slot write | `0x15`, same candidate shape | Separate write evidence |

The protocol payload is 64 bytes. Report ID 0 and the OS API's possible report-ID
prefix are framing, not an extra payload byte. Normalize deliberately; require
exact lengths. Eight raw pages form one 512-byte layer of 128 four-byte entries.
Raw pages do not echo command headers. Never interpret them as acknowledgement
packets or repair them by zero-padding.

The candidate bit7 checksum is `0xFF - (sum(bytes 0..6) & 0xFF)` at byte 7;
bytes after it retain command-specific meaning. An ordinary keyboard entry is
`[0x00, 0x00, HID_usage, 0x00]` for the explicitly supported subset. Decoding an
unknown entry never authorizes rewriting it. Fn/reserved/special slots remain
protected until their physical and semantic meaning is evidenced.

There is no documented profile-count query in this evidence. An observed index
of 4 is not proof of four profiles. Do not scan arbitrary profiles or set one.
The reference bulk format transfers nine 56-byte pages (504 bytes), less than a
complete 512-byte layer. Jazzkeys has no bulk fallback. Some related boards ignore
single-slot commands; that is a reason to remain read-only, not expand opcodes.

## Worker boundary

The intended interface exposes candidate selection, bounded connect/read,
prepare, apply, cancel, disconnect, snapshot staging, and diagnostics intents.
Rust owns wire addresses and validation; TypeScript receives typed state/results.
An IPC schema/version is not a hardware-support version. Frame requests with a
strict 64 KiB limit, IDs, version checks, enum validation, and an explicit unknown
field policy. Reserve stdout for protocol frames and stderr for bounded logs.
Do not expose numeric opcodes, arbitrary send buffers, or unbounded path access.

The current [worker v1 contract](../device/IPC.md) uses NDJSON (65,536 bytes per
frame excluding newline) and worker version 0.1.0. `hello`, `list_candidates`,
`list_snapshots`, `export_diagnostics`, and `disconnect` work without hardware;
candidate/snapshot lists are empty. Hardware-dependent requests return
`hardware_unavailable`; cancellation returns `no_active_plan`. Unknown fields and
enum variants fail closed. The worker accepts no CLI arguments or fake-device CLI.

This no-hardware worker is synchronous. Concurrent IPC cancellation, production
transport deadlines/watchdog, and OS HID exclusivity remain integration work.
Core cancellation-token tests are not proof of those live transport properties.
A fake transport must never fall back to a real interface.

## Evidence needed for promotion

A write record must identify the measured descriptor/interface and mode, internal
ID/revision, current-profile behavior, unique physical-slot mapping, exact allowed
commands, framing, timing, read-back/preservation results, date, and tested source
commit. Fixtures need independent origins and redaction/license review. A packet
constructed by the encoder under test is not an independent expected fixture.
See [hardware acceptance](HARDWARE.md) and [safety invariants](SAFETY.md).
