# ADR: native UI and constrained device worker

Status: selected architecture; native integration and safety acceptance pending.

## Decision

Use unmodified GPUIX `@gpuix/react` and `@gpuix/native` 0.10.0, React/TypeScript,
and a first-party Rust worker. Pin both GPUIX packages directly. Bun 1.3.10 is the
development/runtime packaging baseline. A compiled application-plus-worker ship
path is an experiment until verified on the intended targets.

The UI owns selection, draft state, and review presentation. The worker owns
identity, capabilities, complete validation, snapshots/journals, the serialized
scheduler, narrow packet builders, and receipts. Connect them with bounded,
versioned JSON over private child-process pipes. One app owns one child; do not
install a daemon, service, local network server, or host-level remapper.

Launch only the packaged worker using direct process arguments, never a shell
string or caller-supplied executable. Validate its packaged version/hash and
protocol before hardware use. GPUIX stdin automation is a separate local surface
from worker IPC and must not bypass any plan or capability checks.

## Reasons and limits

The native renderer fits a focused keyboard-first desktop UI. A worker keeps
blocking HID off the UI thread and isolates recoverable process failures, while
a fake transport makes the core testable without hardware. This is architectural
fault containment, **not an OS security sandbox**. Signed provenance, dependency
review, narrow OS permissions, and user authorization remain necessary.

The published npm API takes precedence over an upstream checkout. Its 0.10.0
exports lack the proposed headless Button/Dialog controls, so first-party native
host controls must provide and prove keyboard/focus/accessibility behavior. Do
not replace them with browser DOM controls or silently patch GPUIX/its GPUI fork.

The public build has no write-enabled candidate record and no production HID
transport. UI warnings are not a replacement for worker-side refusal. Unknown
hardware stays unsupported/read-only; no bulk fallback or generic command API is
permitted.

GPL-3.0-or-later was selected conservatively because protocol/source references
include Sharkfin GPL material. The structure is first-party; it is not a patched
Sharkfin distribution and is not represented as clean-room work. Preserve all
applicable upstream notices and finish native/font provenance before binaries.

## Revisit only with evidence

A framework/fork patch, platform expansion, alternate transport, wider write
scope, or licensing change needs an explicit decision and updated tests/evidence.
See [protocol provenance](../PROTOCOL.md), [safety](../SAFETY.md),
[development](../DEVELOPMENT.md), and [release gates](../RELEASE.md).
