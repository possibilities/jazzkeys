# Development

Start with [product scope](PRODUCT.md), [safety](SAFETY.md), and
[architecture](adr/architecture.md). Work in an isolated owned worktree; preserve
unrelated edits. The README intentionally stays a one-line pitch.

## Pinned baseline

| Input | Version |
| --- | --- |
| `@gpuix/react` | `0.10.0` |
| `@gpuix/native` | `0.10.0` |
| React | `19.0.0` |
| Bun | `1.3.10` |
| TypeScript | `5.9.3` |
| Rust | `1.90.0`, matching `rust-toolchain.toml` |

Pin both GPUIX packages directly: the adapter's transitive native range alone is
insufficient. Commit Bun/Cargo lockfiles and use frozen/locked commands. Initial
dependency installation used `--ignore-scripts` after registry metadata review;
that does not constitute a complete native binary audit.

The 0.10.0 package release tags point to
[`9fcd628863e354e9c58019fc3bf38981a1e64158`](https://github.com/remorses/gpuix/tree/9fcd628863e354e9c58019fc3bf38981a1e64158).
The later upstream design reference is GPUIX commit
[`4ecca30f68057b4d9830d32675ba4ed999eeeaaa`](https://github.com/remorses/gpuix/tree/4ecca30f68057b4d9830d32675ba4ed999eeeaaa).
The installed npm 0.10.0 package is authoritative for actual exports: unlike that
source reference, it does not export the proposed headless Button/Dialog APIs.
Jazzkeys uses first-party native host controls and must validate their focus,
keyboard activation, accessibility, and dialog behavior on the native runtime.
Do not silently import DOM/shadcn controls or patch the framework/fork.

## Local checks

With the pinned tools installed, use the repository scripts:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test app packaging
cargo test --manifest-path device/Cargo.toml --locked
cargo fmt --manifest-path device/Cargo.toml -- --check
```

These are contributor commands, not a claim that all checks or builds have passed.
Consult CI for the exact commit and [release status](RELEASE.md). The initial
workspace was Node-only; native build/render tooling and its dependencies need
explicit verification. Do not infer native acceptance from TypeScript checks.

`bun run dev` starts a native window and needs an authorized desktop session.
`bun run build:worker` and `bun run build` are the packaging experiment entrypoints;
the app must find its reviewed worker relative to the installed artifact without
system Bun/Node. `bun run test:native` is a native acceptance path, not a browser
preview. Check actual platform support and obtain desktop permission before
running windowed automation. No development command may silently access HID.

## Test design

Exercise the public domain/worker boundary and an independent fake-transport
trace. Cover exact-length and unstable reads, whole-plan rejection, preservation,
read-only capability refusal, stale/replaced sessions, duplicate Apply, no-ops,
snapshot/journal failure, completion-based pacing, cancellation, uncertainty,
restart, and restore through the same pipeline. Avoid self-generated expected
packets and source-grep substitutes for behavioral tests.

Demo mode cannot open devices. Native screenshots and keyboard-only testing must
cover disconnected, read-only, editing, review, applying, verified, uncertain,
and narrow-window states. Inspect pixels and behavior; generated files alone do
not prove acceptance. Linux native headless screenshot support is not assumed.
Native macOS screenshot and focused interaction evidence is recorded in
[verification](VERIFICATION.md); VoiceOver and AT-SPI acceptance is not claimed.
The installed Linux addon loads, but reports `hasNativeTestRenderer: false`; its
ELF version requirements include `GLIBC_2.39`. Do not claim Ubuntu 22.04 or a
lower libc floor without a different verified artifact.

## Dependency and contribution hygiene

Review installation scripts, binary origins, lockfile changes, and license notices
before executing or distributing changed dependencies. Keep assets local and
review the packaged app for network activity. Do not add telemetry, updater
calls, broad HID rules, raw command endpoints, or hidden daemons. See
[CONTRIBUTING.md](../CONTRIBUTING.md) and
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
