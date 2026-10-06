# Third-party notices and provenance

Jazzkeys source is GPL-3.0-or-later; see [LICENSE](LICENSE). Individual dependencies
and retained third-party material keep their own licenses. The pinned dependency notices and source inventories are retained in
[docs/licenses](docs/licenses) and [docs/redistribution](docs/redistribution).
The inventories deliberately include unused-target/build inputs; they are not a
claim that every listed component is embedded. A release still needs its actual
source companion and the integration checks described below.

## Protocol references

Jazzkeys consulted Sharkfin v0.9.3 at
[`4860eafbcb543d93ce09285204b91f6d853f54b1`](https://github.com/dniminenn/sharkfin/tree/4860eafbcb543d93ce09285204b91f6d853f54b1),
whose [license is GPLv3](https://github.com/dniminenn/sharkfin/blob/4860eafbcb543d93ce09285204b91f6d853f54b1/LICENSE).
The candidate packet facts and device-evidence references are attributed in
[PROTOCOL.md](docs/PROTOCOL.md). The application and orchestration are first-party;
no clean-room claim is made. Do not infer a legal conclusion about copyright in
protocol facts from this conservative project license selection. Any later copied
or adapted source/fixture must retain its precise origin and applicable notices.

## Installed JavaScript packages

Versions and notices below were inspected in the installed lockfile-resolved
packages on 2026-10-06. Initial installation disabled lifecycle scripts.

| Component | Version | License / retained text |
| --- | --- | --- |
| `@gpuix/react`, `@gpuix/native` | 0.10.0 | Apache-2.0, Copyright 2026 remorses; [text](docs/licenses/GPUIX-Apache-2.0.txt) |
| `@gpuix/native-linux-x64-gnu` | 0.10.0 | Metadata declares Apache-2.0; native closure remains under review |
| `react`, `react-reconciler`, `scheduler` | 19.0.0 / 0.31.0 / 0.25.0 | MIT, Meta Platforms, Inc. and affiliates; [shared text](docs/licenses/React-MIT.txt) |
| `eventsource-parser` | 4.1.1 | MIT, Espen Hovlandsdal; [text](docs/licenses/eventsource-parser-MIT.txt) |
| `zod` | 4.6.5 | MIT, Colin McDonnell; [text](docs/licenses/Zod-MIT.txt) |
| TypeScript | 5.9.3 | Apache-2.0; [license](docs/licenses/TypeScript-Apache-2.0.txt), [notices](docs/licenses/TypeScript-THIRD-PARTY-NOTICES.txt) |
| `@types/react`, `@types/bun`, `@types/node` | 19.0.0 / 1.3.10 / 26.6.4 | MIT, Microsoft Corporation; [text](docs/licenses/DefinitelyTyped-MIT.txt) |
| `csstype` | 3.2.3 | MIT, Fredrik Nicol; [text](docs/licenses/CSSType-MIT.txt) |
| `undici-types` | 8.9.0 | MIT, Matteo Collina and Undici contributors; [text](docs/licenses/Undici-MIT.txt) |
| `bun-types` | 1.3.10 | Package metadata declares MIT; part of the Bun source/runtime inventory below |

Type-only/development packages are distinguished from the runtime closure by the
build manifest; listing them here does not assert they are embedded in an app.

## Native GPUIX and fonts

The 0.10.0 React/native release tags resolve to
[`9fcd628863e354e9c58019fc3bf38981a1e64158`](https://github.com/remorses/gpuix/tree/9fcd628863e354e9c58019fc3bf38981a1e64158).
The official [release-commit CI run](https://github.com/remorses/gpuix/actions/runs/35834240883)
built both target addons and completed its native-publish step successfully; a
later React build failed. Exact npm tarball integrity and addon digests are in
[npm inventory](docs/redistribution/npm-inventory.json). The registry supplies no
`gitHead` or `dist.attestations`; this documented provenance is not a claim of a
byte-reproducible or independently attested build. The later
source-reference pin `4ecca30f68057b4d9830d32675ba4ed999eeeaaa` is not treated as the
published React API contract.

The release source pins its Zed/GPUI submodule to
[`81c99f816b4a5f69d3c014774068034c24d1d7af`](https://github.com/remorses/zed/tree/81c99f816b4a5f69d3c014774068034c24d1d7af).
Retained [GPUI Apache text](docs/licenses/GPUI-Apache-2.0.txt) credits Zed Industries.
The complete native closure is not Apache-only: `zlog`, `ztracing`, and
`ztracing_macro` declare GPL-3.0-or-later, and the pinned Zed repository applies
that default to unmarked source. Its [GPL text](docs/licenses/Zed-GPL-3.0.txt) and
[exact path-crate inventory](docs/redistribution/native-source-inventory.json) are retained.

Font-path strings in the Linux addon are asset lookup names, not proof of
embedded fonts. None of the eight release-source TTFs occurs verbatim in it.
Matching source-font notices are retained for the source companion and any
package that actually includes those fonts:

- [IBM Plex Sans OFL 1.1](docs/licenses/IBM-Plex-Sans-OFL.txt): Copyright © 2017
  IBM Corp.; reserved font name “Plex”
- [Lilex OFL 1.1](docs/licenses/Lilex-OFL.txt): Copyright 2019 The Lilex Project Authors

See the [upstream GPUIX notices](docs/licenses/GPUIX-THIRD-PARTY-NOTICES.md) for
Comet-derived components, updater code, syntax definitions, and dependencies. This
upstream notice is retained unmodified, including components/examples Jazzkeys may
not use. The exact [two-face grammar notices](docs/licenses/two-face-0.5.2-acknowledgements.md),
[Comet license](docs/licenses/native-git/comet/LICENSE), and
[updater notices](docs/licenses/cargo-packager-updater) are also retained. Desktop
0.10.0 uses Oniguruma; the upstream notice describes fancy-regex too broadly.

## Bun and Rust worker

Bun 1.3.10 resolves to
[`30e609e08073cf7114bfb278506962a5b19d0677`](https://github.com/oven-sh/bun/tree/30e609e08073cf7114bfb278506962a5b19d0677).
Its [retained official notice](docs/licenses/Bun-LICENSE.md) describes MIT Bun
source and statically linked LGPL JavaScriptCore/WebCore and TinyCC. The actual
pinned build configuration and expanded native/polyfill notice inventory are in
[redistribution materials](docs/redistribution). The old notice's build commands
and some library versions/licenses are stale; use the pinned-source recipe.

The worker's complete **21-crate** locked source/notice inventory is in
[worker-inventory.json](docs/redistribution/worker-inventory.json), with original
texts under [worker notices](docs/licenses/worker). Rust 1.90.0 worker and 1.97.1
upstream-native standard-library notices are retained under
[Rust runtime notices](docs/licenses/rust-runtime). These inventories include
build/proc-macro inputs without claiming they are linked into every binary.

## Appearance helper and host system libraries

The first-party appearance helper uses host-provided GLib, GIO and GObject on
Linux, under LGPL-2.1-or-later. It dynamically links those shared libraries;
Jazzkeys does not copy them into its current package. The
[system-library inventory](docs/redistribution/system-library-inventory.json)
records an existing local helper's exact hash, measured ELF dependencies, and the
GLib 2.84.4 development metadata used for that build. The library version loaded
on a recipient's machine is host-dependent; the local metadata is not a claim
about the separate Ubuntu CI runner or every supported installation.

The [upstream LGPL text](docs/licenses/system/GLib-2.84.4-LGPL-2.1-or-later.txt)
and [distribution copyright notices](docs/licenses/system/GLib-2.84.4-Debian-copyright)
are retained. The latter cover the distribution's broader GLib package, including
tools not shipped by Jazzkeys. The helper has no RPATH/RUNPATH; ordinary dynamic
loading permits ABI-compatible replacement libraries. Recipients may also rebuild
the GPL helper/application using their chosen GLib build through pkg-config.
No restriction on library modification, relinking, or debugging is imposed.
If a future package copies or statically links these libraries, review that
changed distribution and its source obligations separately.

On macOS the helper uses the system Foundation framework; its build script does
not copy Apple framework binaries into Jazzkeys. Exact final-package linkage and
platform support remain release checks.

## Remaining binary-release inventory

The dependency **notice/source inventory work is now concrete**, rather than a
request to investigate unspecified native licenses: 784 checksum-verified native
registry sources, six pinned Git dependency repositories, release-pinned Zed
path crates, exact embedded grammar acknowledgements, both addon digests, the
worker closure, and pinned Bun/library materials are recorded. See the
[redistribution record](docs/redistribution/README.md) for scope and evidence.

Before publishing executables:

1. Include this notice, the project GPL, and the complete retained notice tree in
   the actual artifact, with working links and nested-file checksums.
2. Assemble the exact release's complete corresponding-source companion and
   provide equivalent access beside the binary. Upstream links and an SBOM alone
   are not the source delivery. Include GPL native components and MPL/LGPL
   library sources, not just Jazzkeys' own files.
3. Supply the pinned build/relink recipe and practical replacement-runtime path.
   LGPL 2.1 §6(a) accepts application source as an alternative to object files;
   complete GPL Jazzkeys/Bun/library source plus usable build instructions is the
   chosen route. A demonstrated modified-library build on every platform or
   byte-for-byte reproduction is additional engineering confidence, not an added
   license condition. Do not restrict modifying/relinking or debugging those
   modifications. Resolve any concrete missing build input if review finds one.
4. Complete the independent runtime, installation, signing-status and security
   gates. Notice collection does not establish those results or hardware support.

CI may build and validate locally. No downloadable binary is approved merely
because this inventory exists. Source bundles may retain upstream assets under
their own licenses; vendor logos, product-label photos, or example artwork are
not licensed for separate Jazzkeys branding merely by appearing upstream.
