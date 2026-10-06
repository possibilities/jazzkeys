# Third-party notices and provenance

Jazzkeys source is GPL-3.0-or-later; see [LICENSE](LICENSE). Individual dependencies
and retained third-party material keep their own licenses. This is a reviewed
initial inventory, **not a completed binary-distribution compliance manifest**.
Required upstream texts collected so far are in [docs/licenses](docs/licenses).

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
The inspected npm metadata supplies no `gitHead` or `dist.attestations`, so tag
agreement alone does not prove how the downloaded addon was built. The later
source-reference pin `4ecca30f68057b4d9830d32675ba4ed999eeeaaa` is not treated as the
published React API contract.

The release source pins its Zed/GPUI submodule to
[`81c99f816b4a5f69d3c014774068034c24d1d7af`](https://github.com/remorses/zed/tree/81c99f816b4a5f69d3c014774068034c24d1d7af).
Retained [GPUI Apache text](docs/licenses/GPUI-Apache-2.0.txt) credits Zed Industries.
The installed Linux addon references IBM Plex Sans and Lilex asset paths; it ships
no loose font/license files. Matching release-source font notices are retained:

- [IBM Plex Sans OFL 1.1](docs/licenses/IBM-Plex-Sans-OFL.txt): Copyright © 2017
  IBM Corp.; reserved font name “Plex”
- [Lilex OFL 1.1](docs/licenses/Lilex-OFL.txt): Copyright 2019 The Lilex Project Authors

See the [upstream GPUIX notices](docs/licenses/GPUIX-THIRD-PARTY-NOTICES.md) for
Comet-derived components, updater code, syntax definitions, and dependencies. This
upstream notice is retained unmodified, including components/examples Jazzkeys may
not use; it is not a claim that every listed component ships in Jazzkeys.

## Bun and Rust worker

Bun 1.3.10 resolves to
[`30e609e08073cf7114bfb278506962a5b19d0677`](https://github.com/oven-sh/bun/tree/30e609e08073cf7114bfb278506962a5b19d0677).
Its [retained official notice](docs/licenses/Bun-LICENSE.md) describes MIT Bun
source, statically linked LGPL JavaScriptCore/WebCore, TinyCC LGPL-2.1, other
linked libraries, and embedded polyfills. A compiled Bun application includes
runtime material; the source/runtime and relinking obligations must be resolved
before distributing one. The Bun notice alone is not a complete bundle of all
those licenses or a compliance determination.

The worker directly pins `serde` 1.0.228, `serde_json` 1.0.145, and `sha2` 0.10.9.
Its Cargo lockfile identifies the exact transitive closure. Collect and review
that closure's copyright/license texts for the built targets before distribution.

## Remaining binary-release inventory

1. Establish the npm addon build's source correspondence and provenance; retain
   its exact target and digest. Release tags plus wrapper metadata are insufficient.
2. Reconcile the target-specific GPUIX/GPUI Rust/native dependency closure and
   embedded assets against the actual addon. The release lockfile includes
   Syntect 5.3.0, `two-face` 0.5.2+bat-0.26.1, Oniguruma bindings, napi, and
   Zed HTTP/TLS dependencies. Grammar assets have independent licenses, not merely
   the `two-face` crate's MIT/Apache choice; collect the matching acknowledgements.
   Preserve applicable Comet and updater-derived source notices as well.
3. Complete Bun's matching linked-library/polyfill notices and the corresponding
   source/relinking materials needed for a compiled distribution.
4. Complete the worker's locked dependency license inventory and include the
   result with the actual packaged files/SBOM.

Until these are resolved, CI may build and validate locally but should publish
only source, inspected screenshots, and manifests, not downloadable executables.
No vendor logos, product-label photos, or upstream example artwork are licensed
for reuse merely because they appear in a reference repository.
