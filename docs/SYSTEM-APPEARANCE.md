# System appearance

Jazzkeys follows the operating system's light/dark preference. There is no manual
appearance picker, persisted theme setting, environment theme override, timer
that polls for cosmetic changes, renderer fork, or hardware dependency.

## Host contract

`await createSystemAppearanceSource()` from `app/client/system-appearance.ts`
returns `getSnapshot()`, `subscribe(listener)`, and `dispose()`. Resolve it before
mounting the native renderer, then pass it to `createAppearanceController({source})`.
The source waits for the first helper frame (at most two seconds) so a known dark
preference is available before the first frame. Dispose both controller and source
when the application stops. An exit handler is also installed by the source.

The existing controller maps an unavailable preference to light with an explicit
unavailability label. If a live helper or portal disappears after a successful
read, the last observed preference is retained and labelled read-once. A later
portal owner can restore live status without restarting the app. No-theme or
unknown numeric portal values mean no preference, for which light is selected.
Malformed/missing settings are unavailable rather than interpreted as dark.

Uncompiled development launches have no compiled helper digest and deliberately
use the labelled fallback. Packaged launches are the system-following path.

## Read-only native boundary

The first-party `jazzkeys-appearance` executable is adjacent to the installed
Jazzkeys executable. The host requires an exact compile-time SHA-256, a regular
non-symlink file, an executable bit, a size below 4 MiB, and no group/world write
bits before launch. There is no PATH search or caller-supplied helper path.
The child inherits only the minimum home/session-bus environment, never loader
or theme overrides. Linux accepts only a single local Unix D-Bus transport.

Stdout is a fixed JSON-lines protocol with three fields: version 1, appearance
(`light`, `dark`, or null), and availability (`live`, `read-once`, `unavailable`).
The host rejects extra fields and frames over 160 bytes. Stderr is discarded;
no private paths, complete preferences or other OS settings are logged.
Stdin is solely a lifetime pipe: any input, EOF, hangup or error ends the helper.
Consequently even abrupt parent termination closes the pipe; no daemon, installed
service, privilege elevation, OS permission, credential, global input observer,
settings mutation, or generic command endpoint is involved.

### macOS ARM64

`appearance/native/macos.m` uses Foundation to read only `AppleInterfaceStyle`
from `NSGlobalDomain`. An absent preference means light. It subscribes to
`AppleInterfaceThemeChangedNotification` through
`NSDistributedNotificationCenter` and performs a fresh read on the next main-queue
turn. It creates no window and makes no preference setter/synchronize call.

`NSUserDefaults` and distributed notifications are public Foundation APIs;
`AppleInterfaceStyle` and the notification name are established OS conventions,
not a documented Apple stability guarantee. Actual system-change acceptance on
each supported macOS release remains required. The safe CI fixture compiles the
same observer against its own `io.jazzkeys.appearance-test` domain and notification;
only that separate test driver writes that test domain. Neither production argv
nor environment can select a test domain. The fixture is not packaged.

### Linux x86-64 GNU

`appearance/native/linux.c` uses system GLib/GIO, with no GTK/window dependency.
It reads only `org.freedesktop.appearance` / `color-scheme` using the
`org.freedesktop.portal.Settings.Read` method at the standard desktop portal.
`Read` preserves compatibility with version 1 portals; one or two variant layers
are accepted, then the value must be uint32. `SettingChanged` notifications are
filtered to the exact namespace/key and the proxy's current service owner.
Owner changes invalidate in-flight reads, preventing stale replies from replacing
newer observations. A received setting signal also supersedes an in-flight read.

No portal autostart is requested. An absent running portal remains unavailable
until it acquires the bus name. If the entire session bus dies, the source degrades
to read-once/unavailable; reopening Jazzkeys reconnects. There is no reconnect
polling loop. Desktops without a running Settings portal retain the documented
light fallback. GLib/GIO runtime libraries are platform prerequisites, not bundled
copies; see the package's platform dependency check.

## Build integration

Host-platform builds only:

```sh
bun run appearance/build.ts dist/example/jazzkeys-appearance
```

Or import `buildAppearanceHelper(outputPath)` from `appearance/build.ts` in the
package build. Compute SHA-256 from that output and add the following Bun define
when compiling the main executable:

```text
JAZZKEYS_APPEARANCE_SHA256="<64 lowercase hex digits>"
```

Include `jazzkeys-appearance` in the package manifest, executable-mode verification,
relocation test, and platform dependency reporting. Never package the test helper
or driver. Building needs the platform C compiler; macOS links Foundation, Linux
uses `pkg-config --cflags --libs gio-2.0 glib-2.0` from official development packages.
No downloads or installs are performed by this build script.

## Verification and CI

Add these commands to both the existing macOS ARM64 and Linux GNU CI jobs:

```sh
bun test appearance
bun run appearance/test-package.ts
bun run appearance/test-native.ts
```

Linux CI additionally needs `libglib2.0-dev`, `pkg-config`, `dbus`, `python3`, and
`python3-gi` from its distribution. `test-native.ts` creates a temporary isolated
D-Bus session and uses an in-process fake portal over real GIO/D-Bus APIs. It never
connects the fake portal to the user's desktop session. Coverage includes initial
dark read, live light/dark, both variant encodings, no preference, unknown values,
malformed/unrelated signals, service loss/recovery, unavailable/read-error paths,
stdin EOF/input, and abrupt parent death. macOS compiles its separate synthetic
domain fixture, tests light/dark/invalid/absent changes through actual Foundation
notifications, tests parent death/EOF, and performs a production read without
changing the real preference.

`test-package.ts` compiles a renderer-free Bun executable and a tiny first-party
pipe fixture. It verifies app-relative resolution from a different working
directory, exact digest, modified/missing helper refusal, symlink refusal,
unsafe-mode refusal, initial-state delivery, and prompt disposal. These checks
exercise packaging/lifecycle, not the real OS preference.

Local implementation evidence (2026-10-06):

- Linux helper compiled with warnings treated as errors against GLib 2.84
- TypeScript protocol/lifecycle checks and compiled-host integrity checks passed
- Production Linux missing/failed-session fallback, stdin-EOF shutdown and abrupt
  parent-death shutdown passed (`bun run appearance/test-native.ts --fallback-only`)
- Isolated native portal tests could not run in this executor: creating a Unix
  socket is prohibited (`Failed to open socket: Operation not permitted`), even
  after the permitted execution retry; CI execution is required
- macOS compilation/notification tests require a macOS ARM64 runner and were not
  executed in the Linux implementation environment
- No actual user theme setting, desktop app, or hardware was controlled

A passing fake-portal/synthetic-domain suite proves the adapter and OS IPC paths,
not actual desktop theme-change acceptance or the native UI's reaction. Record
those separately after authorized platform testing.

On October 6, 2026, both platforms passed these native and compiled-host suites
in [CI for exact commit 7008652](https://github.com/possibilities/jazzkeys/actions/runs/37459777643).
The test production-helper binary matched the packaged binary byte-for-byte.
The separate Linux live-window run failed before capturing pixels; it does not
yet establish portal signals repainting the app. Actual macOS OS preference
changes remain an explicit separate acceptance step.

## References

- [XDG Settings portal specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html)
- [GIO DBusProxy owner tracking and signals](https://docs.gtk.org/gio/class.DBusProxy.html)
- [Apple global defaults domain](https://developer.apple.com/documentation/foundation/userdefaults/globaldomain)
- [Apple UserDefaults suite initializer restrictions](https://developer.apple.com/documentation/foundation/userdefaults/init(suitename:))
- [Apple distributed notifications](https://developer.apple.com/documentation/foundation/distributednotificationcenter)
