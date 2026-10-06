# Read-only integration groundwork

This is an implementation and evidence plan, **not device-access authority**.
The shipped app still has no production HID backend. No keyboard report is sent
by these changes, and production Apply remains unavailable.

## First establish which controller is present

The marketing name AK820 MAX does not identify one protocol:

- The [pinned Sharkfin record](https://github.com/dniminenn/sharkfin/blob/4860eafbcb543d93ce09285204b91f6d853f54b1/app/src-tauri/data/devices.extra.json)
  describes another owner's `3151:4015` unit, internal ID `1694`, with unknown
  physical layout. This is the candidate for the existing yc500 encoder.
- The official AJAZZ-linked web-driver catalog also names mechanical AK820MAX
  with `1A2C:A036` and vendor collection `FF02:0002`; its German/French entries
  use `A206`/`A207`. These are a **different driver path**, not additional yc500
  matches. [Vendor catalog source](https://ajazz.shinetek-ic.net/_next/static/chunks/app/page-3a13da3763045144.js)
- MAX PLUS, HE, Ultra, similarly named products, and unidentified generic USB
  keyboards must not inherit either record.

An OS inventory containing several keyboards does not establish which one is
the physical target. First associate the intended keyboard and direct data
cable with one observed device instance. USB transport alone also describes
receivers; it is not proof of direct-cable mode.

## Metadata first, with no device open

The pure Rust `discovery` module assesses supplied metadata only. It has no OS
calls, subprocess, HID handle, or report sender. Synthetic tests cover missing
facts, wrong collections, alternate controller identities, descriptor bounds,
and metadata changes. Its result cannot create an `Identity` or `Capability`.

Missing interface numbers, descriptor bytes, usage, transport, and maximum
feature-report size remain unknown. An OS maximum of 64 bytes does not prove
the report ID, framing, or a command's response shape. A metadata hash detects
changed observations; it does not authenticate a device or identify its instance.

A later Mac provider should copy existing IOKit registry properties only, retain
the selected registry instance privately, and return bounded typed observations.
It must not open services/devices, create input callbacks, read ordinary typing,
or issue feature requests as part of discovery. Its first native validation is
compile/synthetic-provider testing, followed by separately authorized metadata
inspection. [Apple registry API](https://developer.apple.com/documentation/iokit/1514494-ioservicegetmatchingservices)

Do not reuse the core's `Engine::connect` for enumeration. It performs vendor
queries and assumes an already accepted capability. Candidate assessment is a
separate boundary precisely because those facts are not yet available.

## Typed read boundary

`ReadOperation` contains only identify, revision, current-profile, and bounded
base/Fn page reads. `Scheduler::read` cannot accept a slot write. The transport
receives typed operations rather than arbitrary bytes and an independent reply
flag. Encoding remains inside the narrow reviewed protocol boundary.

`ReadTransport` exposes only typed reads to a future native adapter. Its
`ReadOnlyTransport` wrapper rejects either layer's slot-write operation with a
`read_only` fault before encoding or dispatch; the shared simulated engine can
therefore use it without giving the native-facing backend a write operation.

This addresses an internal API trap in the earlier simulation-only core, where
a caller could pass a write operation to a method named `read`. There was no
production HID path, and the change does not enable one. Independent packet
fixtures, zero-write traces, exact framing, reply mismatch, bounds, and pacing
regressions remain required.

## Conditional first probe proposal

Do not use this proposal unless metadata and physical association establish the
exact candidate configuration interface. A mismatch ends this stream; it is not
permission to try another family or interface.

The smallest first yc500 query is **one identify exchange only**:

- Protocol payload: exactly 64 bytes, `8F 00 00 00 00 00 00 70`, then 56 zeros
- Expected interpretation: exact-length response beginning `8F`, followed by a
  little-endian 32-bit internal ID; candidate value `1694` remains unverified
- Report-ID framing and native API buffer lengths must be fixed from the actual
  descriptor and reviewed binding before an executable probe is approved
- One request and one response attempt, a stated deadline, no retry, no alternate
  opcode, no input-report listener, and immediate closure on mismatch or failure
- Preserve the actual reply length and private raw evidence; never zero-pad or
  treat successful transport completion as matching identity

The owner's approval must name the physically associated keyboard, exact
interface, one vendor feature-report exchange, framing, deadline, and retained
evidence. Calling this read-only means no configuration mutation is intended;
it still sends a feature report. No such authority is embedded in this document.

Only after reviewing a matching identity should a separate bounded plan include
revision (`80`) and current profile (`85`). Preserve their raw response bytes.
The [owner report](https://github.com/dniminenn/sharkfin/issues/15) shows profile
byte `04`, while upstream's declared profile count is four. Do not clamp it,
infer a count, scan indexes, or switch profiles. That bundle contains only a
base-page-0 sample and does not prove that `04` addresses the current map.
The revision's displayed number also needs
board-specific interpretation rather than an invented u32 version.

Only after that evidence may a later plan request two full base-map sweeps with
`89`, the observed and evidenced current-profile byte, and pages 0–7. Each reply
is one raw 64-byte page with no echoed opcode or page checksum. Require exactly
512 bytes per sweep and equality between sweeps. Preserve unknown entries.
Fn reads (`90`) are a separate scope, not an automatic extra sweep.

The request checksum at byte 7 is **not** a response-integrity rule: the cited
scalar captures retain the request's checksum even though response fields have
changed. Validate the documented reply header/length and semantics instead.

The current simulated Engine's normal connect plus stable layer read performs
25 query exchanges, including identity/profile rechecks. Do not approve three
queries and then run that sequence. A real commissioning harness needs its own
exact reviewed budget and lifecycle, native deadlines, explicit cancellation,
no ambiguous retries, and narrowly scoped permission behavior.

## What remains before maps can be displayed as real

1. Physical device association and exact interface/descriptor evidence
2. A reviewed native read-only adapter and bounded process supervision
3. Current approval for each exact probe sequence
4. Independently captured identity/profile and stable, complete map replies
5. Physical-key-to-slot evidence; demo geometry and ordinary typing are not it

The last point matters even if raw map reads succeed: a storage slot must not be
painted as a particular physical key without evidence. Keep raw observations,
supported ordinary entries, unknown entries, and layout uncertainty distinct.
No read result creates a write capability. See [hardware gates](HARDWARE.md) and
[safety requirements](SAFETY.md).
