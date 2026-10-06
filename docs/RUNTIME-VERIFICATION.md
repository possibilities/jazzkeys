# Compiled runtime boundary verification

## Status and scope

The runtime acceptance harness was added on 2026-10-06. Its parser regression
suite and strict TypeScript check passed locally. The local executor denies
`PTRACE_TRACEME`; that is a **blocked runtime observation**, not a successful
network/device check. The restriction was respected. A passing acceptance result
must come from the authorized isolated Linux CI job, with its exact run link,
source commit, package hashes and `runtime-report.json` files. Do not transfer a
result to different binaries or infer GUI acceptance from the package self-test.

This verifies a finite synthetic **no-HID demo** on Linux x86-64. It does not
implement or authorize device access, install services, grant permissions, or
publish executables. Source fixture rendering and physical keyboard behavior are
separate evidence. The production GUI starts only the fixed first-party system-appearance observer;
it does not start a device worker. The packaged device worker is exercised
separately through its private hello pipe.

## Three independent checks

1. **Sensor negative control:** `packaging/runtime-sensor.ts` compiles a small C
   probe and traces it. The probe attempts IPv4/IPv6 loopback sockets/connections,
   opens its own newly created **regular file** named `hidraw0`, attempts an input
   ioctl on that regular file, attempts chmod on a nonexistent path, and executes
   an ordinary helper. No `/dev` hardware path is opened and no permission is
   actually granted. Acceptance requires the analyzer to detect every injected
   class and the child exec. A missing/broken tracer must fail this check
2. **Compiled bootstrap:** trace the relocated compiled `jazzkeys
   --package-self-test` with empty PATH. Require one successful app exec and
   exactly one exec of the matching, hash-verified `jazzkeys-device`. Check the
   no-hardware private-pipe receipt. This intentionally exits before loading GPUIX
   and provides **no GUI runtime assurance**
3. **Compiled native demo:** trace the same production app, without special app
   arguments, while the stock GPUIX stdio automation drives a synthetic native
   select → search → stage → review → Escape → simulate → verified flow. Require
   a rendered window and captured native pixels separately. Only one zero-argument
   exec of the hash-verified adjacent `jazzkeys-appearance` is permitted. The
   device worker, other helpers, daemon-style forks and privilege operations are
   forbidden in this GUI flow

The Linux native orchestrator runs all three inside an isolated Xvfb/software
Vulkan session. The app runs as the ordinary CI user in a separate network
namespace. The setup helper may create that ephemeral namespace with the CI
runner's existing authority, then drops to the ordinary user before starting
Bun, strace or the app. It does not change host AppArmor/sysctls or install app
permission rules. The harness verifies the namespace differs from the recorded
outer namespace, exposes only loopback, and has no IPv4 routes. Networking is
unavailable during the demonstration; successful flow establishes that this
observed flow did not require Internet access.

## Trace contract and policy

`startRuntimeTrace({packageDirectory, evidenceDirectory, env, phase})` in
`packaging/runtime-trace.ts` returns `{child, stop, finish}`. The child has piped
stdin/stdout for GPUIX; stderr is consumed by the wrapper. Use `stop()` to close
the GUI, then await `finish()`. Bootstrap exits normally. Each invocation needs a
fresh evidence directory. The default two-minute watchdog is a failure, never a
successful shortened observation.

strace 6.6 or newer is required. `-ff` follows processes and threads; `-yy`
identifies descriptor paths; timestamps order inherited cwd changes. The trace
includes network, file, process and credential operations plus ioctls, namespace
and privilege operations. `--kill-on-exit` prevents traced descendants from being
left running when the test stops. Both unsuccessful **attempts** and successful
operations are checked. Interrupted final calls are inspected rather than dropped.

The analyzer rejects:

- Internet socket creation or decoded IPv4/IPv6 operations, even when denied
- Unknown remote socket families; Unix-domain display/session sockets and
  kernel-local netlink are counted separately
- HID/input/USB device-node opens, including relative dirfd/cwd paths, and
  decoded HID/input ioctls
- Unexpected executable launches and non-thread process creation in GUI mode.
  The sole exception is the app's directly spawned child that actually executes
  its exact, manifest-hash-verified `jazzkeys-appearance`, with no arguments. One
  canonical unavailable `clone3` probe may accompany its `clone` fallback; a
  missing, repeated, relocated, argument-bearing or independently forking helper
  fails acceptance
- Credential/capability changes, namespace changes, daemon detachment, device
  node creation, ownership changes and unsafe permission grants
- Writes or mutations in system/configuration and known user service/autostart
  locations, while allowing ordinary font/library reads and private caches
- io_uring operations, which would require additional instrumentation before
  their asynchronous file/network effects could be accepted
- Empty, malformed or incomplete tracing, unexpected app/worker exec counts,
  changed package hashes or executable modes, root execution and tracer failure

The manifest is verified before and after execution. Reports bind observations to
source commit/tree, app, device-worker and appearance-helper SHA-256, executable
modes, platform/kernel,
strace version, exact syscall filter, namespace identity, termination reason and
SHA-256 of each trace file. Package checksums bind evidence to bytes; they do not
by themselves prove reproducible builds or publisher identity.

## Appearance helper lifetime

The appearance sidecar reads only the system color preference through the Unix
session bus on Linux. Its launch is not a blanket helper allowance. Its own
threads and Unix-domain connection remain traced, and Internet/device/privilege
rules apply unchanged. The summary includes its hash, exact exec and process
creation edge. Bootstrap must not launch it.

`--kill-on-exit` prevents any traced descendant from surviving test teardown.
Natural cleanup must also be established separately: native appearance tests
close stdin and kill a synthetic parent, then require the observer to stop within
a bounded deadline. Bind those lifecycle tests to the packaged helper hash; do
not infer natural EOF handling solely from the tracer forcibly stopping it.

## Privacy and retained artifacts

Only generated CI data is used. No user desktop, real typing, private keymaps,
clipboard or hardware is observed. No full environment dump is requested. The
isolated session supplies a temporary HOME and sanitized environment without CI
credentials. strace does not log general read/write buffers; network send/receive
calls are printed in raw pointer form so X11 authentication and D-Bus payloads
are not dumped. Socket/connect addresses remain visible for classification.

Default CI uploads should contain the bounded `runtime-report.json` and
`sensor-report.json` summaries, alongside native synthetic screenshots and their
interaction evidence. Do not upload raw `syscalls.*`, Xauthority files, or stderr
by default. Raw traces remain temporary diagnostic inputs and their hashes appear
in the summary. Any exceptional diagnostic retention needs a separate privacy
review and must remain synthetic-only.

## Evidence limits

This is a regression test of the exercised runtime paths, not a security sandbox
or a proof that a malicious dependency cannot act with user permissions. Only
the app and its descendants are traced. Xvfb, the session bus, desktop portals and
other session services are outside that process scope; permitted Unix sockets
are not Internet connections, and observing one does not establish every
service-side effect or absence of all possible permission prompts.

A clean Linux report supports the precise statement that the observed compiled
flow had no direct Internet attempts, HID/input opens, forbidden helper/process
launches or observed permission/service-install mutations, and completed with
networking unavailable. It does not certify macOS Input Monitoring/Accessibility
behavior, global input-listener absence on every OS, Wayland, install/uninstall,
assistive technology, real hardware traffic, persistence or a signed release.
