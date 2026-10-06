# Jazzkeys device core

This worker is intentionally **no-hardware**. Its release entrypoint never enumerates or opens a device. There is no HID dependency, hardware transport, writable production record, fake-device CLI, or generic command endpoint. Candidate protocol facts are not support evidence for the owner's keyboard.

See [IPC.md](IPC.md) for the exact app/worker contract. Run from the repository root:

```sh
cargo fmt --manifest-path device/Cargo.toml --check
cargo test --manifest-path device/Cargo.toml --locked
cargo clippy --manifest-path device/Cargo.toml --locked --all-targets -- -D warnings
cargo build --manifest-path device/Cargo.toml --locked --release
```

Rust is exactly pinned in `rust-toolchain.toml`. Direct dependencies are exact and the complete resolution/checksums are committed in `Cargo.lock`.

## Implemented safety boundaries

- Strict, bounded NDJSON; typed semantic operations, physical IDs and target enum; no caller-supplied profiles, slots or raw transport messages
- Fixed 512-byte maps and exact 64-byte payload framing, explicit report-ID normalization, stable double sweeps
- A single private mutable owner; full interface/internal identity/current-profile matching, one-connection session lifetime, baseline-bound expiring single-use plans
- Narrow opcode constructors; no settings, profile SET, bulk, reset, firmware or automatic fallback operation
- Validation of the entire draft/restore, explicit protected/unsupported preservation, minimal changed slots, full-layer read-back
- Monotonic completion-based wire pacing (provisional 1 second after writes; 2 second final settling), cancellation at safe boundaries, no retry or recovery traffic after transport errors
- Real filesystem snapshots and append-safe journal evidence: private directory/files, exclusive evidence owner, synced complete-file installation without overwrite, read-back verification, exact before/after intent and complete outcome
- Read-only crash inspection rejects inconsistent journal transitions/key sets. Interrupted, partial, rejected, uncertain, corrupt and torn evidence is never auto-replayed or deleted
- Engine-owned error receipts distinguish attempted, verified, unknown and unattempted keys. Read-back observations survive a later final-journal failure

Tests use an independent byte-parsing fake device and virtual monotonic clock. Synthetic write capability is constructed only inside library tests and is not a release mode. Tests also exercise the compiled executable with an empty environment and the production filesystem implementation. Passing these tests does not verify a real AK820 MAX.

## Deliberate remaining integration gates

No real hardware transport, real writable record, OS HID exclusion, device-specific timeout/watchdog implementation, concurrent IPC cancellation reader, H1–H5 acceptance, platform permissions, or hardware commissioning is included. The no-hardware worker does not create app-data files; filesystem evidence is exercised by the private engine tests. A future hardware owner must use the same core and wire in startup inspection before opening devices.

The Engine is single-connection. Reconnection needs a new owner, transport and unpredictable per-worker nonce. Snapshot identity currently binds the full accepted interface identity; a changed instance/path conservatively blocks restore rather than guessing unit compatibility. Revision/mode parsing and every read/write path remain synthetic/candidate evidence until commissioned.

Storage requires an existing trusted app-data parent. An abrupt crash leaves `owner.lock`; read-only inspection works without clearing it. A future deliberate recovery flow must reconcile actual state and clear stale ownership with authorization. No automatic evidence retention/eviction runs: unresolved evidence is always retained, and disk exhaustion blocks writes. Multi-layer restoration is rejected as a whole; one layer is restored only through a new reviewed plan.

`fsync`/atomic filesystem evidence is tested on this Linux cloud filesystem, not a power-loss rig or macOS. This is an application boundary, not an OS sandbox against another malicious process running as the same user.

## Encoding provenance

The implementation is independently structured from the documented yc500 facts in the pinned [Sharkfin protocol reference](https://github.com/dniminenn/sharkfin/blob/4860eafbcb543d93ce09285204b91f6d853f54b1/docs/PROTOCOL.md). The tests' packet fixture is a synthetic slot/profile example, not a device capture. The crate follows the project's GPL-3.0-or-later choice; no Sharkfin implementation files were copied.
