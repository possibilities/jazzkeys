# Safety contract

These are implementation and release acceptance requirements. They do not certify
unfinished code or an untested keyboard. The current public candidate record must
not enable writes; production HID transport is not yet implemented.

## Boundaries

The native UI stages intent. A first-party Rust worker owns identity checks,
validation, scheduling, snapshots, plans, and receipts. Its API must not accept
raw opcodes, arbitrary send buffers, caller-chosen profiles/slots, or an arbitrary
worker executable. Private child-process pipes provide a narrow interface and
fault containment; **they are not an OS sandbox**. A malicious native dependency
can act with the user's permissions. Descriptor hashes identify a known shape;
they do not authenticate hardware cryptographically.

One selected, direct-cable configuration interface has one serialized I/O owner.
Enumeration is metadata-only. Vendor GET queries send feature reports and need
separate authorization; “read-only” means no configuration or flash mutation,
not no device traffic. A high opcode bit does not prove a command is safe.

No firmware, bootloader, erase/reset, profile SET, bulk upload, receiver relay,
alternate-family fallback, or raw-command path belongs in the production surface.
No startup, render, reconnect, import, or recovery event may apply a draft.

## Preconditions for every apply

1. Accept a complete device capability record: descriptor/interface, internal
   identity, relevant revision/mode, evidenced profile/layer, physical geometry,
   unique editable slots, encodings, and operation-specific provenance.
2. Bind the session to that exact interface instance and connection generation.
   Ambiguous matching devices require explicit selection. Reconnect, worker
   restart, mode/profile/identity changes, or plan expiry invalidates old plans.
3. Accept two identical complete layer sweeps. Each normalized page is exactly
   64 bytes; each layer is 512 bytes. Never pad short data or ignore extra bytes.
4. Validate the whole semantic draft/import before any mutation: schema and size,
   identity/layout compatibility, supported ordinary usage, protected entries,
   duplicate keys/slots, before-values, baseline, and preservation. Remove no-ops.
5. Under exclusive scheduler ownership, revalidate identity, profile, and current
   contents immediately before mutation. Stale state is a conflict, not a rebase
   silently performed on the user's behalf.
6. Durably save and verify a before-snapshot and intended-change journal. Storage
   failure blocks the first write. Preserve journals for unresolved outcomes.
7. Consume a bounded, expiring plan only once. Duplicate requests cannot repeat
   its writes. Send only its minimal allowlisted single-slot changes.

## Timing and uncertain outcomes

Measure quiet periods from **actual wire completion** using a monotonic clock,
inside serialized ownership. Background reads cannot cut into write quiet time.
The provisional simulation policy is at least one second between writes or a
write and the next read, and two seconds before the final verification sweep.
These are conservative design inputs, not timings validated for this keyboard.

A send completion is not a verified mapping. Compare the entire affected layer
with the expected result, including untouched entries. Stop remaining mutations
on timeout, stall, failure, identity mismatch, unplug, or differing read-back.
Never retry an uncertain write, replay after worker restart, auto-rollback, or
escalate to bulk/reset. A killed worker may leave an accepted write behind.

Multi-key updates are not atomic. Cancellation before the first send changes no
mapping; after a send it stops remaining work at the next safe boundary and can
leave partial changes. Distinguish confirmed entries from unknown outcomes.
“Verified” describes the exact read-back scope; it says nothing by itself about
USB-replug persistence, Bluetooth behavior, or flash endurance.

## Snapshots and restoration

A **keymap snapshot** is current-profile layer data, not a firmware or complete
configuration backup. It includes schema/capability/layout versions, compatible
identity scope, profile, layer bytes, capture time, integrity hash, and preservation
limits. Macro references can be preserved, but macro bodies, lighting, sleep,
firmware, and other settings are not backed up.

Import is untrusted and bounded to 64 KiB. Validate all records before preparing
any change. Hashes detect corruption, not authorship. Restore uses the same new
identity check, fresh before-snapshot, review, scheduler, single-slot writes, and
read-back as an ordinary edit. Crash recovery initially examines only the local
journal; reconnect/reconciliation must be deliberate and must not replay writes.

## Privacy and permissions

Run as an ordinary user. No root service, setuid helper, global input listener,
clipboard read, or world-writable HID grant. Linux permission rules are deferred
until a verified product/configuration-interface match exists; a permission for
the active user also benefits their other processes. Never install a vendor-wide
rule. On macOS, establish the actual permission need rather than preemptively
requesting Input Monitoring or Accessibility.

Keep assets local. Do not call framework remote-image/update features. Verify
network silence on the packaged app; source inspection alone is insufficient.
Default diagnostics must omit typing, full keymaps, serials, private paths, and
raw device identifiers. Export only on request, with preview/redaction. Preserve
private snapshots and unresolved journals; do not upload them automatically.

For authorization and acceptance steps, see [HARDWARE.md](HARDWARE.md). For safe
reporting, see [SECURITY.md](../SECURITY.md).
