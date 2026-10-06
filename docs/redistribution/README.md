# Redistribution materials

This directory records the 2026-10-06 review of Jazzkeys' pinned macOS ARM64 and
Linux x86-64 distribution inputs. It is an engineering evidence record, not a
claim that an unpublished binary has passed every release gate.

## What is resolved

- All **784 registry packages** in the GPUIX 0.10.0 native Cargo.lock were fetched
  from the official registry and verified against the lockfile SHA-256. Their
  license expressions, explicit license choices, copyright/notice files and
  immutable archive URLs are recorded in `native-registry-inventory.json`.
  This is an intentionally conservative **all-target/build/dev superset**, not
  an assertion that all 784 packages are linked into either desktop addon.
- The nine Git-package entries resolve to six pinned repositories. Their source
  archive digests and notices are in `native-git-inventory.json`, together with
  the Comet source-port attribution. Updater-derived code is separately covered
  in `updater-inventory.json`.
- The release-pinned Zed path crates and source archives are enumerated in
  `native-source-inventory.json`. `zlog`, `ztracing`, and `ztracing_macro` declare
  GPL-3.0-or-later. `gpui_shared_string` and `gpui_util` lack a package-level
  license marker; the pinned repository's README supplies its GPL-3.0-or-later
  default for unmarked components. Do not label the complete addon Apache-only.
  GPUI's ordinary dependency graph references `ztracing`; this is not merely a
  GPL crate found in an unrelated editor workspace.
- The exact two-face 0.5.2+bat-0.26.1 grammar acknowledgement Markdown is retained.
  All 66 syntax and 12 theme license entries from the published crate's compressed
  acknowledgement data were decoded and their complete license texts verified
  as present verbatim in that pinned document. Themes are retained as a safe
  attribution superset; Jazzkeys does not use syntax themes. Desktop GPUIX uses
  Oniguruma. Its upstream notice's blanket fancy-regex description is stale.
- All **21 worker registry dependencies** have verified source archives and
  retained original grants/notices, including Unicode data and Ryu's distinct
  copyright-bearing code. `worker-inventory.json` distinguishes source/build
  roles instead of claiming each crate is linked into each target.
- The published Rust 1.90.0 and 1.97.1 distribution hashes were checked before
  extracting their standard-library copyright and license notices. Rust's
  `COPYRIGHT-library.html` is kept separately from Cargo/crate notices. Rustc and
  Cargo themselves are not shipped by Jazzkeys.
- `npm-inventory.json` verifies the 16 in-scope locked npm archives against
  `bun.lock`, records tarball and addon SHA-256 values, and separates platform
  binaries from source/build inputs. Windows is outside this release scope.

## Source provenance is not reproducibility

The official GPUIX native/react 0.10.0 tags point to
`9fcd628863e354e9c58019fc3bf38981a1e64158`, with Zed gitlink
`81c99f816b4a5f69d3c014774068034c24d1d7af`. The official
[CI run](https://github.com/remorses/gpuix/actions/runs/35834240883) built both
native targets successfully. In its publish job, **Publish @gpuix/native
succeeded**; a later **Build @gpuix/react** step failed. The overall failed job
must not be misreported as a failed native publication. The exact workflow,
Cargo manifest/lock and toolchain declaration are retained in `upstream/`.

The npm tarballs have integrity metadata but no `gitHead` or `dist.attestations`.
Tags, source manifests, the successful native-publish step, exact official
registry bytes and observed native behavior establish useful documented
provenance. Missing attestations alone do not forbid redistribution. This record
does not claim a byte-reproducible build, an upstream signature, or a successful
independent rebuild of the native addon.

## Fonts: do not infer embedded bytes from strings

The inspected Linux addon contains font asset lookup names. None of the eight
release-pinned IBM Plex Sans/Lilex TTF files occurs verbatim in that addon.
The source's SVG font loader asks an AssetSource for paths; its adjacent TTF
`include_bytes!` expressions are under `cfg(test)`. The inspected GPUIX native
source does not itself embed those fonts. This evidence corrects the earlier
inference that font-name strings established embedded font payloads. It does not
exclude a transformed/compressed font by itself. Retain the original OFL texts
with a source bundle containing those fonts and with any later package that
actually adds them. No font modification or reserved-name change is authorized.

## Omitted upstream license files

Some crates omit monorepo-root license texts from their published archives.
The inventory recovers these texts from the exact `.cargo_vcs_info.json` source
commit whenever available. Eighteen entries have no separate text in the crate
(and in several cases none in the pinned repository). For these entries,
`docs/licenses/native-declarations/` retains the actual unmodified Cargo license
declaration and all UTF-8 copyright-bearing source files up to 1 MiB, alongside
the declared license's standard SPDX terms. Canonical text is explicitly labelled;
its template placeholders are **not** invented author or year statements. The
complete original source archive also belongs in the source companion. This
fallback is inspectable in each entry's `notice_basis`, not hidden as an exact
upstream LICENSE copy. Original source files and manifests may contain trailing
whitespace; do not normalize bytes covered by these hashes.

## Distribution shape

A binary archive/app bundle must contain the project `LICENSE`, root
`THIRD-PARTY-NOTICES.md`, and the retained `docs/licenses/` and
`docs/redistribution/` tree (or a deliberately rewritten, verified equivalent).
Keep relative links working. Hash every nested file; a flat top-level manifest
is insufficient. Avoid shipping source-cache machine paths, generated secrets,
private handoff notes, or temporary inspection logs.

Offer a **complete corresponding-source companion from the same release
location**, with the exact Jazzkeys release source, GPL native source, locked
crate/Git/npm sources, Bun and its covered libraries, and scripts/instructions
needed to rebuild. A list of third-party URLs is an inventory, not the source
companion. Do not rely on upstream hosting continuing forever or on a written
source offer that the project has not actually committed to fulfilling.

Under GPLv3 §6(d), network distribution can provide equivalent source access
alongside the object download. LGPL 2.1 §6(a) expressly allows the work using the
library as **object code and/or source code**. Because Jazzkeys' app source is
available, a proprietary-object kit is not inherently necessary. The practical
route is complete source plus a working recipe to rebuild the LGPL components,
Bun, and the compiled app. Preserve users' rights to modify/relink and reverse
engineer for debugging library modifications. Do not add distribution terms or
technical restrictions that remove those rights.

The Bun source recipe and its exact native/embedded dependency notices are
recorded separately in this directory. MPL-covered files should travel in their
original source archives as well; they are not satisfied merely by an MIT label
on the top-level runtime.

## Final integration checks

1. Run `python docs/redistribution/verify_inventory.py`. It verifies retained
   bytes and detects missing/changed notice files; it does not certify linkage.
2. Assemble and verify the actual source companion, including the final Jazzkeys
   commit. Record its SHA-256 and contents; do not call a manifest-only artifact
   “complete corresponding source.”
3. Supply a usable pinned native/Bun build/relink recipe. The archive hash and
   static closure checks are recorded. A bounded configure-only check is a useful
   next engineering check for missing inputs; a full rebuild and observable
   modified-library run is stronger optional evidence. LGPL §6(a) does not add a
   requirement to demonstrate a changed-library build on every host or reproduce
   upstream output byte-for-byte. Report any actual missing file/recipe step
   separately from those unperformed confidence checks.
4. Verify the final binary archive and app resources include the notice tree,
   source-access instructions and checksums. Add no EULA that restricts the
   modification/relink rights above. Signing/install/runtime/hardware gates are
   separate and are not lifted by this inventory.

Primary license texts: [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html),
[LGPL 2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html), and the exact
upstream files retained under `docs/licenses/`. Source identity evidence and
license obligations are intentionally described separately.

## Re-create the retained companion

`source-inputs.json` pins 1,010 original/source-subset archives totaling
479,366,080 bytes. `collect_sources.py` copies matching cached bytes (or downloads
checksum-pinned inputs only when `--download` is supplied), then writes a receipt.
The locally generated, Git-verified WebKit source subset must be supplied from its
retained cache; it is not falsely represented as an official downloadable asset.

```sh
python docs/redistribution/collect_sources.py \
  --output /path/outside/checkout/jazzkeys-source \
  --cache /path/to/native-and-app-archives \
  --cache /path/to/bun-source-archives \
  --cache /path/to/worker-crate-archives \
  --project-ref FULL_FINAL_JAZZKEYS_COMMIT
python docs/redistribution/collect_sources.py \
  --output /path/outside/checkout/jazzkeys-source \
  --verify-only --project-ref FULL_FINAL_JAZZKEYS_COMMIT
```

Use the exact release commit, not a research branch's earlier parent. With no
`--project-ref`, the tool explicitly labels the result incomplete. The source
receipt records the manifest, project-archive hash and original source tree.
The collector obtains both dependency inputs and instructions from the exact
`--project-ref`, even when invoked from a different checkout revision. Schema-2
receipts additionally hash every instruction file. Verification checks the copied
manifest and instructions, receipt hashes/counts, the archive's independently
computed Git source tree, and the exact companion file set. A rehashed but changed
project archive cannot pass merely by editing its receipt. Older schema-1 receipts
must be reassembled with the updated collector before release verification.
For a source-archive rebuild, follow the clean local Git reconstruction and
addon-placement flow in [BUN-RELINKING.md](BUN-RELINKING.md); the package manifest
will honestly record the recipient's local commit, not impersonate the original
release commit. Archive the entire
result and publish it with the binary only after the release is authorized and
the source/relink scope has been reviewed.

Checks run for this change: all 1,010 archive digests were checked after copying,
all 1,947 hash-referenced retained files passed verification, and fourteen offline
collector tests passed. Coverage includes exact-ref input selection, changed or
missing copied instructions, tampered receipt hashes, independent project-tree
verification, unexpected files, symlink targets, traversal, corruption, no
download without opt-in, and source-archive-to-clean-Git reconstruction. The
expanded tree check also matched the complete source archive at `df8cc55`.
These checks do not run Jazzkeys or access a device or desktop.

```sh
python docs/redistribution/test_inventory_tools.py
python docs/redistribution/verify_inventory.py
```

## Rebuilding the native addon

Unpack the pinned GPUIX archive; unpack the pinned Zed archive into its `zed/`
directory, preserving the upstream layout. Use the exact Cargo.lock supplied in
`packages/native/`, Rust 1.97.1, and the platform prerequisites from the retained
upstream CI workflow. Its Linux dependencies include fontconfig, Wayland/X11,
xkbcommon, Vulkan, OpenSSL and zstd development support; macOS requires Xcode and
its Metal toolchain. Build from the root of that GPUIX source tree:

```sh
# Linux x86_64; same feature selection as upstream build:release
cargo +1.97.1 build --manifest-path packages/native/Cargo.toml --locked \
  --release --no-default-features --target x86_64-unknown-linux-gnu
# macOS ARM64; same native test-support feature selection as upstream build
cargo +1.97.1 build --manifest-path packages/native/Cargo.toml --locked \
  --release --features test-support --target aarch64-apple-darwin
```

Run only the command for that native host. The corresponding `libgpuix_native.so`
or `libgpuix_native.dylib` is the N-API addon payload; use the upstream napi-rs
packaging script or place those bytes under the matching installed platform
package's `gpuix-native.linux-x64-gnu.node` or
`gpuix-native.darwin-arm64.node` name. Preserve all source edits and build settings
in a modified distribution. This source-grounded reconstruction command has not
been run in this notice-only task. The source archives are retained; a fully
offline Cargo Git/registry cache and target-specific link map have not been
constructed. Do not confuse those unperformed build checks with missing notices
or demand byte-for-byte reproducibility as an added licensing requirement.
