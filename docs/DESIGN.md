# JazzKeys: Instrument Bench

## One physical object, one deliberate workflow

JazzKeys centers an illustrative AK820 MAX above a horizontal mapping rail. The
board is the strongest object; its physical legends remain stable while the rail
explains the selected key and proposed mapping. The only filled primary action in
ordinary editing is Review. No slogan, sidebar, profile picker, dashboard, or
redundant lower footer competes with the task.

The app remains a no-hardware demonstration. The illustrated geometry is not a
verified physical-slot map. Neither the presentation nor a screenshot enables or
establishes device support.

## Composition and material

The native content targets 1180 × 780, with a compact profile at 960 × 680. A
56-pixel header and 64-pixel draft bar stay outside the scrolling workspace. The
16 × 6.35-unit layout uses 48–56 logical pixels per unit, 16-pixel case padding,
and the original physical coordinates, widths and gaps. A normal editing state
fits both target rectangles without workspace scrolling. Exceptional explanations
and taller content may scroll; the keyboard is never scaled as a bitmap.

Warm stone surrounds the forest case. The case, inset well, key edge and face are
separate native rectangles. Function and modifier keys use an alternate material.
The selected face is solid green in light appearance and light green in dark
appearance. Staging adds a square corner marker and an 11-pixel proposed-action
annotation. A separate blue ring marks focus without erasing selection. Protected
keys retain readable physical legends and a dash; the rail supplies their reason.

Colors are semantic, including distinct control boundaries, decorative dividers,
selection, focus, caution and error. Tests measure actual text-role pairs at
4.5:1 and essential focus/control boundaries at 3:1. Native pixel inspection is a
separate requirement. Typography is the platform system sans; fonts are not fetched.

## Mapping and local draft

The mapping rail has four columns: physical identity, observed mapping, searchable
supported target, and the local staging action. Its source label is `On demo board`
or `Last read · demo`, never an implied live hardware mapping. An unavailable Fn
layer says `Not read`. Unknown entries say `Unknown action · preserved`.

Choosing a target only changes the local target field. Stage is a separate action.
The action becomes Update for a changed pending target, Remove staged change for
a return to baseline, and a quiet Staged status when the staged value is already
chosen. A no-op has no active Stage button. Selecting another physical key or
layer resets the un-staged target and remounts the search field, clearing the old
query and popup. Staged work remains intact.

The draft bar shows the count and quiet Undo, Redo and Discard actions. Discard is
reversible through draft history. None of these operations reverses a device
write. Offline drafts remain editable while review/apply are gated. Protected
keys remain inspectable; a read-only session cannot stage.

The target picker opens above the rail with bounded local scrolling. Results are
ordered by semantic groups and carry complete labels, including left/right
modifier identity and GUI / Command / Windows aliases. Unsupported actions are
not offered. Text stays searchable using full semantic labels.

## Review, progress and outcomes

Review is opened deliberately and freezes the complete minimal diff. The dialog
contains physical key, layer, before and after columns. Its list can scroll while
title and controls remain in place. It does not report an invented count of
verified unchanged physical keys. Snapshot evidence is explicitly simulated in
memory, with no file or device traffic. Snapshot scope excludes macro bodies,
lighting and firmware.

Keep editing receives initial focus. The demo primary action is Simulate N
changes. A collapsed Demo outcome control exposes deterministic failure scenarios
without distracting from the ordinary editor. Snapshot, sending, settling and
verification progress come from client events, not a percentage or estimated
completion timer. Stop requests remain visible until a safe boundary; cancellation
never claims rollback.

Outcomes keep their simulated status, mutually exclusive verified/uncertain/not
applied counts and per-key results. Only established matching read-back earns a
verified result. Uncertain work preserves the offline draft and requires fresh
read/review rather than automatic retry or rollback. Real USB persistence,
Bluetooth behavior and any device write remain unverified.

## Native input and accessibility

The board has one roving tab stop. Spatial arrows navigate the existing geometry,
including wide and protected keys. Full spoken labels include physical modifier
side, current or last-read mapping, staged target and protection. Visible short
annotations do not replace these names.

A first-party Button adapter uses stock GPUIX host input. Native click commits on
release; Enter activates once on non-repeat key-down; Space activates on key-up.
Blur and disable clear a held Space state. There is no additional mouse-up commit.
Decorative key layers do not receive input. Focus and selection are separate.

Review and utilities make underlying controls unavailable, scope Tab navigation,
and return native focus to the invoking control. Escape closes a picker before
its containing review; during apply it requests stop. Cmd/Ctrl Z and Shift
Cmd/Ctrl Z are restricted to draft edits while a board key owns focus, leaving
native text-field undo alone. No global typing hook exists.

Stock `@gpuix/react` and `@gpuix/native` 0.10.0 do not export Button or Dialog;
JazzKeys uses first-party adapters and the published Combobox/Select components.
There is no DOM, webview, CSS selector dependency, or framework fork. AccessKit
roles and pure tests do not establish VoiceOver or AT-SPI acceptance.

## Appearance and stillness

Appearance follows the system only. The presentation consumes a read-only host
controller via `getSnapshot` and `subscribe`; it does not run OS queries in render
or offer a manual theme policy. The controller resolves an initial appearance
before rendering, observes host updates, and truthfully labels unavailable or
read-once sources. An unavailable source uses a documented light fallback. Host
OS observation and its actual platform verification are separate integration
work. The internal `initialAppearance` fixture can force either palette for
repeatable native acceptance; it is not a user setting.

There are no decorative animations, sound effects, key bounce, ambient loops or
cosmetic polling timers. Appearance changes preserve the existing editor and
renderer rather than recreating the scene or discarding the draft.

## Verification boundaries

The production scenario model supplies disconnected, read-only, editing, review,
applying, verified and uncertain fixtures. `initialAppearance`, `viewportWidth`
and `viewportHeight` make native comparisons deterministic. Fixtures have no HID
path and accept no arbitrary commands.

Stable native flow locators include `open-demo`, `key-<physical-id>`,
`target-input`, `target-<semantic-action-id>`, `stage-change`, `remove-change`,
`review-changes`, `cancel-review`, `simulate-apply` and `return-to-draft`.
`demo-outcome-options` reveals `demo-outcome-picker`. Utilities use
`more-utilities`, `close-utilities`, `show-help` and `disconnect-demo`.

Pure checks cover geometry fit, honest source labels, staged-action transitions,
protected states, target cancellation, contrast and system appearance updates.
Existing model/client/worker safety checks remain authoritative. Typechecking
uses the exact published framework declarations. None replaces native rendering
or gesture evidence.

For this composition, acceptance must inspect actual native 1180 × 780 and
960 × 680 light/dark pixels and exercise key navigation, target search without
staging, update/remove, undo/redo/discard, complete diff, nested Escape, focus
return, cancellation, snapshot failure and uncertainty. Enlarged text,
VoiceOver/AT-SPI, live OS appearance transitions, Linux rendering and packaged
runtime behavior need their own recorded evidence. See [verification](VERIFICATION.md)
and [runtime verification](RUNTIME-VERIFICATION.md) for exact tested commits;
evidence for an older composition must not be treated as acceptance of this one.

No private source notes, reference images, serial identifiers or local evidence
paths are shipped in the app. The implementation is first-party and is not
affiliated with AJAZZ, NACODEX or GPUIX.
