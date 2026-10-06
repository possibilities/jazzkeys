# Jazzkeys: a quiet green instrument

## The job and the focal object

The owner wants to change a small number of physical keys on one AK820 MAX, with a clear account of what will change and what is still unknown. The board, a stable physical-key identity, and the before/after mapping carry the design. There is no general-device sidebar, gaming dashboard, account, remote asset or browser edition.

The implemented direction uses forest/stone semantic colors, native system typography, softly raised key faces, restrained dividers and an explicit pending-change dot. Physical legends never change when their mapping changes. Fn, knob and an illustrative unknown entry have a protected mark plus a written explanation in the inspector. A key layout has physical coordinates and IDs, deliberately no invented protocol slots.

## Two composition alternatives

Both alternatives use the same native components and deterministic `editing` scenario. `JazzkeysApp` accepts the bounded `designComposition` prop for a matched native comparison:

| Composition | Structure | Tradeoff |
| --- | --- | --- |
| `board-and-inspector` | Dominant spatial board with persistent selected-key inspector to its right; draft controls below | Short eye travel between physical position, current action and target. The complete task fits the intended wide window. Selected for the shipping default |
| `stacked-workbench` | Full-width keyboard first, then the selected-key controls and review actions below | Gives the board more visual independence and works when the window cannot accommodate the split, but introduces vertical travel and scrolling at the normal desktop size |

The split automatically adopts the stacked layout below 1110 logical pixels rather than shrinking the key labels. Main content scrolls within a bounded page region at 960 × 680; header and state footer remain stable. The board stays proportionate at a fixed 43-pixel unit rather than distorting key widths.

Selection is provisional design judgment from composition and fit calculations. Actual native captures of both matched alternatives are still required before visual acceptance. This document does not claim a rendered comparison has been reviewed.

## Truthful states and local interaction

- Launch is disconnected. `Open demo` is explicit. No constructor, render, selection, target choice, staged edit, screenshot fixture or reconnect attempt enumerates or opens HID
- Every non-disconnected scenario is identified as simulated. Geometry and slots are unverified. Real hardware actions are unavailable
- The target picker offers only semantic ordinary keyboard usages and standalone modifiers. GUI labels include Command / Windows aliases without guessing an OS-dependent encoding
- Choosing a target does not stage it. Stage is explicit. Selecting the baseline removes the no-op
- Undo, redo, individual removal and discard affect only the in-memory draft. Undo never claims to reverse a device operation
- Review freezes the complete diff and shows its actual simulated write count, current-profile scope, unchanged pictured keys and snapshot limits
- Apply is explicitly labelled `Simulate N changes`. Failure presets cover verified read-back, response loss, partial result, stale baseline and snapshot failure
- Progress reports snapshot, sending, settling and verification phases from the simulated client. There is no fake time-to-completion bar
- A simulated plan is single-use. Repeated starts are rejected; editing is unavailable during review/apply
- Cancellation before sending reports no simulated writes. Cancellation after any sends marks every attempted, unread-back key uncertain. It never reports automatic rollback
- Verified changes update the simulated baseline; unknown changes preserve an offline draft. A new demo reset is explicit and does not auto-replay the old draft
- The pre-apply snapshot demonstration is in memory. It is not a claim that a durable real-device snapshot exists

## Native input and accessibility

The board has one roving tab stop. Arrow keys navigate physical geometry, including wide keys and protected keys. Enter and Space select. Normal Tab order moves to the inspector and draft controls. Cmd/Ctrl Z and Shift Cmd/Ctrl Z operate on draft history only while a board key owns focus; native text-field undo is left alone.

Review/help/outcome surfaces make underlying controls unavailable. Review initially focuses the safe `Keep editing` button; closing returns to the saved native focus ID. Tab uses the public native scoped focus methods, and Escape closes the top local layer. Escape during apply requests cancellation. A nested outcome picker tracks closure so the same Escape is not intentionally used to close its parent review.

Accessible keys announce physical legend, current mapping, pending mapping and protection. Pending state is both a dot and text; protection is both a dash and inspector explanation. Focus is a distinct high-contrast border, including on the primary button. Disabled actions retain readable labels and an accessible unavailable description.

### Actual published API findings

The exact npm tarballs `@gpuix/react@0.10.0` and `@gpuix/native@0.10.0` differ from later repository API descriptions:

- React publishes Select, Combobox and Tooltip primitives, but does **not** publish Button or Dialog exports/subpaths
- Native host props include role, labels, description, selected/value fields, tabIndex, native refs, focus/blur/key events and scoped focus methods
- The published style/window types do **not** expose `focusVisible` or `keyboardFocusDim`

Jazzkeys therefore uses the stock Select/Combobox and a small first-party native Button adapter, not DOM buttons or an upstream fork. Native click handles pointer-release activation; Enter activates on non-repeat key-down; Space on key-up; blur and disable clear a held Space state. Focus visuals use explicit focus/blur state. The review uses supported native containers and focus APIs, without claiming unsupported ARIA or CSS behavior.

Native keyboard event propagation can differ from the DOM. In particular, double Tab movement from native default handling must be checked on the actual renderer, along with popup Escape ordering, pointer drag-out cancellation, focus restoration and screen-reader output. The pure tests do not establish these native behaviors.

## Appearance and motion

Light and dark palettes share semantic roles rather than inverted values. Main text, secondary text, button text, warning and error pairs are numerically tested at 4.5:1 or better for their stated solid backgrounds. That does not certify rendered glyph quality, global framework focus behavior or screen-reader support.

There are no decorative animations, remote fonts, sound effects or idle frame polling added by Jazzkeys. A native system sans face is used. The stock GPUIX runtime itself owns its event/frame loop. Important labels remain 13–17 pixels; the small secondary pending-key annotation supplements the readable physical legend and inspector rather than replacing them.

## Reproducible verification

`scenarioState` and the `initialScenario` prop expose a bounded set of synthetic fixtures using production model/UI components: disconnected, read-only, editing, review, applying, verified and uncertain. `initialAppearance`, `viewportWidth` and `designComposition` make matched native checks deterministic. No fixture starts real operations or accepts arbitrary commands.

Stable native `testId` locators include:

- `open-demo`
- `key-caps-lock` and `key-<physical-id>`
- `target-input` and `target-<semantic-action-id>`
- `stage-change`
- `review-changes`
- `cancel-review`
- `simulate-apply`

`bun test app` verifies pure draft transitions, protection, spatial navigation, cancellation, single-use simulation plans and solid-color contrast. Strict TypeScript checks the actual pinned API types.

Not yet established by the implementation worker: native pixel inspection, VoiceOver, AT-SPI, actual mouse/keyboard event behavior, Linux live rendering, or any device operation. No desktop app was launched or controlled. macOS native renderer captures and authorized platform interaction checks are release acceptance work; a browser preview is not a substitute.

## Reference provenance

The implementation was independently authored from the product handoff and its design principles. No private guide text, label photo, private hardware identifier, serial, local evidence path or reference screenshot is shipped as an app asset. Framework API observations above refer to the published npm 0.10.0 tarballs. The product is not affiliated with AJAZZ, NACODEX or GPUIX.
