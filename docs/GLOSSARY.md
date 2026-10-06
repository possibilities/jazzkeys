# Glossary

- **Physical key:** a fixed position and legend on the keyboard, independent of
  its assigned action.
- **Slot:** a vendor-protocol storage address. A visual position is not proof of
  its slot; not all 128 stored entries correspond to editable physical keys.
- **Base layer / Fn layer:** separate stored mapping layers, supported only where
  their read/write behavior is independently evidenced.
- **Current profile:** the profile index actually observed from the connected
  board. It is not a profile count or an invitation to switch profiles.
- **Entry:** four raw bytes; unknown encodings stay raw and preserved.
- **Draft:** local proposed edits. Undo/redo changes the draft, not the keyboard.
- **Change plan:** the worker's validated, bounded, expiring, single-use set of
  exact changes tied to a baseline and session.
- **Session:** one accepted device/interface instance, generation, identity,
  capability scope, and observed state. Reconnection invalidates old authority.
- **Capability record:** reviewed evidence binding identity, layout, operations,
  profile/layer scope, encodings, and timing. Candidate IDs are not a write grant.
- **Keymap snapshot:** scoped current-profile mapping bytes and compatibility
  metadata. It excludes firmware, macro bodies, lighting, and other settings.
- **Journal:** durable record of intended and observed operation progress used to
  reconcile interruption; it never authorizes automatic replay.
- **Verified:** requested and preserved data matched the specific read-back.
- **Partial:** only part of the requested operation is established as completed.
- **Uncertain:** a write may have reached the device, but its result is not known.
- **Read-only:** no configuration mutation; vendor GETs still send device traffic.
- **Metadata-only:** OS-provided enumeration without vendor feature-report queries.
- **Demo:** simulated data and outcomes, incapable of opening real HID devices.
