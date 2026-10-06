# Contributing

Read [product scope](docs/PRODUCT.md), [safety](docs/SAFETY.md), and
[development](docs/DEVELOPMENT.md) first. Keep changes focused and use an isolated
branch/worktree. The README stays a one-line pitch; substantive guidance belongs
in `docs/`.

Changes must preserve a demo mode that cannot access hardware, explicit staging
and review, candidate/read-only write refusal, unknown-entry preservation, and
honest partial/uncertain outcomes. Do not add a raw command route, bulk fallback,
reset/firmware feature, broad HID rule, hidden daemon, telemetry, or network assets.

For code changes, describe the behavior, relevant safety invariant, tests actually
run, and untested limits. Exercise the public core boundary with independent
fixtures and fake-transport traces; do not treat mocked outcomes or source-grep
checks as hardware acceptance. For native UI work, include actual inspected
platform screenshots and keyboard/accessibility evidence when available, and
explicitly mark blocked checks otherwise.

Hardware support proposals need measured, consented, redacted evidence tying a
specific interface/revision/mode to physical slots and each supported operation.
Similar model names and copied registry IDs are insufficient. Do not ask testers
to try arbitrary commands. [HARDWARE.md](docs/HARDWARE.md) defines the ladder.

By submitting a contribution for inclusion, provide it under the project's
GPL-3.0-or-later terms and identify any third-party material, origin, modifications,
and applicable notices. Do not remove upstream attributions, relabel GPL material
as permissive, claim clean-room work without support, or publish private captures.
Review lockfile and native-binary changes along with source. See
[third-party notices](THIRD-PARTY-NOTICES.md).

Use ordinary issues for sanitized bugs and feature discussions. Follow
[SECURITY.md](SECURITY.md) for vulnerabilities or sensitive device incidents.
