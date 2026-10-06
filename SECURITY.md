# Security policy

Jazzkeys is pre-release source/demo software. No physical device is verified
writable; there is no production HID transport. Do not use an experimental build
to test commands on a daily-use keyboard without scoped authorization and an
independent input/recovery plan. See [safety](docs/SAFETY.md) and
[hardware status](docs/HARDWARE.md).

## Report safely

Use this repository's **Security → Report a vulnerability** route if it is
available. Private vulnerability reporting has not yet been verified as enabled.
If unavailable, open a minimal public issue asking the maintainer for a private
reporting channel. Do not publish exploit details, device dumps, snapshots,
serials, private paths, credentials, or personally identifying images there.
A verified private channel is a binary-release requirement; no response-time SLA
is promised.

A useful private report names the affected commit/package/platform, expected and
observed behavior, whether hardware was touched, and a bounded reproduction using
simulated data where possible. Redact identifiers and explain any remaining risk.

## Device incident

Stop further device operations if a send stalls, times out, or read-back differs.
Do not retry, auto-restore, reset, flash, or broaden the protocol. Preserve the
local before-snapshot, journal, draft, and version details. An interrupted write
can be uncertain even if the app exited. Never assume a complete firmware backup
exists: keymap snapshots have [limited scope](docs/SAFETY.md#snapshots-and-restoration).

The worker boundary is not an OS sandbox. There is no supported raw-command,
plugin, daemon, remote-control, or network API. Security reports concerning a
native dependency or a bypass of the intent/capability boundary are in scope.
