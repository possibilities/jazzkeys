# License-text provenance

These upstream texts accompany the exact source/notice inventories in
[docs/redistribution](../redistribution/README.md). They include a conservative
native all-target/build/development superset, worker and Rust runtime notices,
Bun/library/polyfill texts, source-derived copyright notices, and exact grammar
acknowledgements. Retained hashes are checked by
`python docs/redistribution/verify_inventory.py`. This is not by itself a shipped
binary SBOM or a complete corresponding-source archive. Remaining integration
gates are in [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

## Official pinned sources

- `GPUIX-Apache-2.0.txt`: installed native 0.10.0 `LICENSE`; matches
  [release-source LICENSE](https://github.com/remorses/gpuix/blob/9fcd628863e354e9c58019fc3bf38981a1e64158/LICENSE),
  Git blob `a0c83841dcc112f1fc9d222eb3128f2e50f07635`
- `GPUIX-THIRD-PARTY-NOTICES.md`:
  [release-source notice](https://github.com/remorses/gpuix/blob/9fcd628863e354e9c58019fc3bf38981a1e64158/THIRD_PARTY_NOTICES.md),
  Git blob `a17980fec42ccb89a6b07d578615acf4d5a19424`; also identical at the later
  design-reference source pin
- `GPUI-Apache-2.0.txt`:
  [release-pinned Zed notice](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/LICENSE-APACHE),
  Git blob `461a0fe5ba20a096c281a2686da08fef79f534a3`
- `IBM-Plex-Sans-OFL.txt`:
  [release-pinned font license](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/assets/fonts/ibm-plex-sans/license.txt),
  Git blob `f72f76504cd73cf2c00b140b2743c138320597b6`
- `Lilex-OFL.txt`:
  [release-pinned font license](https://github.com/remorses/zed/blob/81c99f816b4a5f69d3c014774068034c24d1d7af/assets/fonts/lilex/OFL.txt),
  Git blob `156240bc907aa14571afb18b4b1bde62d3ea33e0`
- `Bun-LICENSE.md`:
  [Bun 1.3.10 notice](https://github.com/oven-sh/bun/blob/30e609e08073cf7114bfb278506962a5b19d0677/LICENSE.md),
  Git blob `170bc19e1aab7b6d1f4721f98b19bf3bc9879d53`

The GPUI and font texts were first retrieved from Zed reference commit
`ea042f2f045157ada1d0ad71009520931dcace83`, then verified to have the same Git blob
IDs at the release-pinned commit above. Strings in the installed addon support
the font-path association; they do not prove full artifact/source correspondence.

## Installed package texts

React-MIT is shared verbatim by React 19.0.0, react-reconciler 0.31.0, and scheduler
0.25.0. DefinitelyTyped-MIT is shared by the inspected `@types/react`, `@types/bun`,
and `@types/node` packages. The remaining named MIT/TypeScript texts were copied
from those exact installed packages' LICENSE/ThirdPartyNoticeText files, without
changes. Versions are listed in the root inventory. Preserve the complete texts
and copyright statements in any distribution where applicable.

## Expanded inventory provenance

- `native-registry/`: unmodified license/notice files from all 784 SHA256-verified
  GPUIX native lockfile registry archives
- `native-upstream/`: omitted monorepo notices recovered at the exact crate VCS
  commit; archive and retained file hashes are recorded
- `native-declarations/`: eighteen published crates without a separate notice
  file; original Cargo grants and copyright-bearing source plus explicitly
  labelled standard SPDX license terms, with no fabricated copyright statements
- `native-git/`: pinned Git dependency notices and Comet source-port notice
- `cargo-packager-updater/`: pinned 0.2.3 original licensing and copyright-bearing
  source, including Tauri and CrabNebula attributions
- `two-face-0.5.2-acknowledgements.md`: exact pinned human-readable grammar/theme
  acknowledgements, verified against all 78 embedded license entries
- `worker/`: all 21 locked worker crates, byte-for-byte verified source notices
- `rust-runtime/`: standard-library copyright and terms from checksum-verified
  official Rust 1.90.0 and 1.97.1 distributions
- `bun/`: Bun 1.3.10's pinned linked-library, embedded-package and WebKit notices;
  consult the companion Bun inventories for target scope and exact source pins
- `system/`: GLib/GIO/GObject shared-system-library notice, distribution copyright
  metadata and pkg-config version evidence for the Linux appearance helper;
  see `system-library-inventory.json`. These records do not assert that the host
  libraries are bundled or that another machine loads the same library version

Some license terms are duplicated to preserve package-specific upstream files
and copyrights. Some alternative licenses are retained although a permissive
branch was elected. Do not infer a GPL-only obligation from an unused alternative
text, nor discard AND terms such as Unicode, NCSA or BSD notices. Unmodified
upstream text can contain links to mutable branches; use the pinned provenance
manifest for source identity rather than interpreting those links as version pins.
