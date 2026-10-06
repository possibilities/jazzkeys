# Bun 1.3.10: source-form redistribution and relinking

Scope: Jazzkeys GPL-3.0-or-later executables compiled with Bun 1.3.10, Bun commit `30e609e08073cf7114bfb278506962a5b19d0677`, on macOS ARM64 and Linux x86_64 glibc. This is a source-grounded engineering recipe. Source integrity and static build-input checks were performed; no fetched code, runtime build, or relinked executable was executed in this research task.

## The practical route

A proprietary object-file bundle is not necessary for this all-source application. Section 6(a) of both the LGPL v2 text retained in WebKit and LGPL v2.1 retained in TinyCC expressly allows the complete work using the library in source form, object form, or both, provided the recipient can modify the library and relink the executable. Deliver the complete Jazzkeys source, Bun source, the matching library sources and patches, required data/build utilities, notices, and a working native rebuild recipe. The GPL application sources must remain available under their GPL terms.

The standard source route does not inherently require replacing the official Bun runtime before releasing an application. A source-corresponding official runtime plus the working replacement route can suffice. Building the release runtime ourselves is operationally useful because it demonstrates that the supplied source closure works and captures exact toolchain versions, settings and link metadata; it is not a separate requirement that overrides the source-form option.

For network distribution, make the complete corresponding materials available with equivalent access at the same designated download place. Do not substitute an upstream repository URL or a stale command list for the actual source package being offered. Keep each component's own license and copyright notices. No condition prohibiting modification or reverse engineering should be added.

Primary text:
- [WebKit's pinned LGPL v2, section 6](https://github.com/oven-sh/WebKit/blob/4a6a32c32c11ffb9f5a94c310b10f50130bfe6de/Source/JavaScriptCore/COPYING.LIB)
- [TinyCC's pinned LGPL v2.1, section 6](https://github.com/oven-sh/tinycc/blob/12882eee073cfe5c7621bcfadf679e1372d4537b/COPYING)

Retained copies are under `docs/licenses/bun/webkit/Source/JavaScriptCore/COPYING.LIB` and `docs/licenses/bun/tinycc/COPYING`.

## Exact source inputs

The machine-readable `docs/redistribution/bun-*-inventory.json` files record source URLs, revisions, archive filenames, sizes, SHA256 values, and extracted notice paths. The companion source package stores the original archive files under `bun/`, preserving the sources/ subtree and its `packages/` directory.

Bun's CMake pins:

| Name | Repository | Revision |
|---|---|---|
| JavaScriptCore/WebKit | oven-sh/WebKit | 4a6a32c32c11ffb9f5a94c310b10f50130bfe6de |
| BoringSSL | oven-sh/boringssl | 4f4f5ef8ebc6e23cbf393428f0ab1b526773f7ac |
| Brotli | google/brotli | v1.1.0, resolved to ed738e842d2fbdf2d6459e39267a633c4a9b2f5d |
| c-ares | c-ares/c-ares | 3ac47ee46edd8ea40370222f91613fc16c434853 |
| HdrHistogram | HdrHistogram/HdrHistogram_c | be60a9987ee48d0abf0d7b6a175bad8d6c1585d1 |
| Highway | google/highway | ac0d5d297b13ab1b89f48484fc7911082d76a93f |
| libarchive | libarchive/libarchive | 9525f90ca4bd14c7b335e2f8c84a4607b0af6bdf |
| libdeflate | ebiggers/libdeflate | c8c56a20f8f621e6a966b716b31f1dedab6a41e3 |
| lol-html | cloudflare/lol-html | e9e16dca48dd4a8ffbc77642bc4be60407585f11 |
| ls-hpack | litespeedtech/ls-hpack | 8905c024b6d052f083a3d11d0a169b3c2735c8a1 |
| mimalloc | oven-sh/mimalloc | 1beadf9651a7bfdec6b5367c380ecc3fe1c40d1a |
| picohttpparser | h2o/picohttpparser | 066d2b1e9ab820703db0837a7255d92d30f0c9f5 |
| TinyCC | oven-sh/tinycc | 12882eee073cfe5c7621bcfadf679e1372d4537b |
| zlib | cloudflare/zlib | 886098f3f339617b4243b286f5ed364b9989e245 |
| zstd | facebook/zstd | f8745da6ff1ad1e7bab384bd1f9d742439278e99 |

The exact Bun archive also contains uSockets/uWebSockets forks, SQLite amalgamation, uucode, zig-clap, copied Node/WebCore code, and `patches/`. Preserve all of it. Apply patches from the Bun revision, not today's upstream patches. `cmake/scripts/GitClone.cmake` applies each `patches/<name>/*.patch` with `git apply --ignore-whitespace --ignore-space-change --no-index`, copies non-patch files, and writes `.ref`. In particular, TinyCC requires Bun's supplied CMakeLists.txt and tcc.h patch.

Linux's official WebKit build uses ICU 75.1, whose complete official source archive is retained. macOS links system icucore. libuv is only added on Windows and is outside these two shipped targets. simdutf 7.5.0 is embedded in this WebKit's WTF tree; the exact MIT license and its additional BSD source-header notice are retained.

Polyfill dependencies are pinned by Bun's `src/node-fallbacks/bun.lock`: 119 distinct non-esbuild npm package/version archives were retained, and their lockfile integrity hashes verified. Bun's error page adds Preact 10.27.2. The polyfills are browser-build fallbacks, not Bun runtime implementations, but their generated content is embedded in the Bun binary. lol-html's committed `c-api/Cargo.lock` pins 43 registry crates; all archive SHA256 values were verified against that lockfile. Its MPL-2.0 dependencies include cssparser 0.36.0, cssparser-macros 0.6.1, dtoa-short 0.3.5 and selectors 0.33.0; retain their complete source crates and notices as provided.

The original Bun LICENSE.md is useful attribution but is not a sufficient inventory or build guide. It omits active Highway/HdrHistogram/ls-hpack and transitive components, describes ICU 72, describes simdutf differently from this pinned tree, and gives obsolete `make jsc` / `zig build` commands.

## WebKit source subset and static input closure

The full pinned WebKit tree was fetched through Git after GitHub's codeload archive endpoint returned HTTP 422. Its entire recursive tree has zero gitlinks, so there are no Git submodules to fetch. Some embedded upstream projects contain historical `.gitmodules` text files, but there are no submodule entries in this WebKit commit.

The source companion contains an independently created, byte-verified JSCOnly source archive. Every retained regular file or symlink was checked against its Git blob SHA1 at the pinned revision; all matched. The archive SHA256 and exact retained-file inventory are recorded separately.

Retained: all `Source/JavaScriptCore`, `Source/WTF`, `Source/bmalloc`, `Source/cmake`, `Source/ThirdParty/unifdef`, `Source/ThirdParty/gtest`, `Source/ThirdParty/capstone`, `Tools`, `Configurations`, `resources`, `metadata`, `.github`, and root/ancestor files.

Excluded: the unrelated WebCore/WebKit browser implementations and other unselected Source subtrees; LayoutTests, JSTests, WebDriverTests, ManualTests, Websites, the optional PerformanceTests corpus, and unselected platform-library directories. The latter are not needed by the stated native JSCOnly recipe. This is explicitly not a complete source archive for a browser build or for arbitrary changed build options.

Static checks:
- `OptionsJSCOnly.cmake` disables WebCore, WebKit, legacy WebKit, WebInspectorUI, WebGL and WebGPU
- `Source/CMakeLists.txt` unconditionally needs bundled unifdef unless a system unifdef is selected; it is retained
- JSCOnly enables API tests on non-Windows hosts, so `ThirdParty/gtest` and all `Tools/TestWebKitAPI` are retained even though the Bun recipe builds the `jsc` target
- Capstone is selected for ARM/MIPS configurations; its complete source is conservatively retained, although these ARM64/x86_64 targets use other disassemblers
- The active JSCOnly/WTF/bmalloc CMake paths contain no build reference requiring omitted Source/WebCore or PAL source
- Top-level `PerformanceTests` is entered only when `DEVELOPER_MODE` is enabled; the pinned Bun WEBKIT_LOCAL invocation never enables it. Keep DEVELOPER_MODE off with this subset
- Script/code-generation utilities in all Tools and all JavaScriptCore scripts are retained

These are static source-closure checks, not a claim that configuration or compilation has already passed.

## Native rebuild and application re-embedding

Use a native macOS ARM64 host for the macOS output and a native Linux x86_64 glibc host for the Linux output. Do not cross-compile the final application with an unmodified --target override if the intention is to embed the replacement runtime.

Prerequisites are the pinned Bun CONTRIBUTING.md: bootstrap Bun (pinning 1.3.10 is sensible), Git, CMake/Ninja, Ruby/Python/Perl, Go, Rust/Cargo, and platform build tools. LLVM's default is 21.1.8; the CMake check accepts the 21.1 series. The Zig fork is pinned to `c031cbebf5b063210473ff5204a24ebfb2492c72` and the build downloads its platform bootstrap. Linux needs ICU >=70.1 development files for WEBKIT_LOCAL; the supplied ICU 75.1 source can be used to keep that dependency aligned with the official build. macOS uses Homebrew ICU headers and system ICU libraries.

A source-based native run, after prerequisites are installed:

```sh
BUN_REV=30e609e08073cf7114bfb278506962a5b19d0677
WEBKIT_REV=4a6a32c32c11ffb9f5a94c310b10f50130bfe6de
# SOURCE_CACHE is the bun/sources directory from the companion package.
mkdir -p bun-source
tar -xzf "$SOURCE_CACHE/bun-$BUN_REV.tar.gz" -C bun-source --strip-components=1
mkdir -p bun-source/vendor/WebKit
tar -xzf "$SOURCE_CACHE/WebKit-$WEBKIT_REV-jsconly-source.tar.gz" \
  -C bun-source/vendor/WebKit --strip-components=1
cd bun-source
# Keep Bun's locked dependency files intact. Normal build scripts install locked
# npm inputs and fetch the exact CMake pins; the retained source archives provide
# the same code for redistribution and for preparing a network-independent cache.
bun install --frozen-lockfile
bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release \
  -DWEBKIT_LOCAL=ON -DREVISION="$BUN_REV" -DENABLE_LTO=OFF \
  -B build/release-local
./build/release-local/bun --revision
```

This follows the current `build:release:local` package script, with an explicit source revision and non-LTO setting. `SetupWebKit.cmake` configures and builds JavaScriptCore from `vendor/WebKit`, then relinks Bun against the resulting `libJavaScriptCore.a`, `libWTF.a` and `libbmalloc.a`. `BuildTinyCC.cmake` likewise builds the supplied source and Bun patches. To modify either LGPL library, modify that local source, retain the patch, and rerun the build.

The final application must be generated using the resulting absolute runtime path:

```sh
MODIFIED_BUN="$(pwd)/build/release-local/bun"
cd /path/to/jazzkeys-source
"$MODIFIED_BUN" install --frozen-lockfile --ignore-scripts
# If rebuilding the native addon, place it in the matching installed platform
# package now, after installation and before packaging (see the archive flow).
"$MODIFIED_BUN" run packaging/build.ts
# Requires a clean Git commit; the archive flow below reconstructs one honestly.
# The script embeds the worker hash AND native addon, then runs the private-pipe
# and --native-self-test checks without opening a window.
# Do not add a cross-platform, different-baseline, different-libc, or
# different-version --target override to its compile command.
```

Jazzkeys `packaging/build.ts` invokes the running `process.execPath` with `build --compile` and no `--target`. It generates a Bun file-loader entry that embeds the installed target addon, sets the stock `NAPI_RS_NATIVE_LIBRARY_PATH` before importing GPUIX, and retains the worker-hash defines. Run this packaging script with the replacement Bun; a bare compile of `app/main.tsx` would omit that native-addon embedding step. The package manifest records the embedded addon SHA-256.

The underlying behavior is verified in the pinned `src/compile_target.zig`: when compile target OS, architecture, baseline, semantic version and libc match the running Bun, `exePath()` obtains the running executable through `bun.selfExePath()` and disables download. A non-default target instead selects a cached or downloaded Bun. Omitting --target when executing the native replacement runtime is the direct way to preserve it.

Recommended stronger engineering validation: build on each supported host; modify a compiled JSC or TinyCC source with a harmless observable test marker; rebuild Bun; compile Jazzkeys with that Bun; confirm the marker and application smoke tests in the final executable; remove the marker before a production artifact; record tool versions, commands and hashes. This demonstration is not a separate LGPL requirement and is not mandatory on every platform as a condition invented by this review. An unmodified build is weaker evidence of the replacement path, but source-form compliance depends on the complete supplied materials and usable relink route, not a required demonstration format.

Source-grounded recipes and the supplied source package establish a concrete source route. No known covered-library source file remains missing after the static JSCOnly review. The remaining source-delivery work is adding the exact Jazzkeys release commit and making the companion available beside its binaries; the native build/replacement experiment above is additional confidence. A proprietary object bundle and bit-for-bit reproduction are not automatic extra requirements.

## Toolchain provenance limits

Upstream's Bun Dockerfile uses Ubuntu 20.04, GCC 13 packages and Rust nightly without a fixed package revision/date. This is a documented provenance limitation, not a missing attestation requirement. Capture the actually used versions when validating the replacement build. Linux also statically links libstdc++, libgcc and usually libatomic; corresponding GPL/runtime-exception license texts are retained. The exact Zig license is retained. Compiler/toolchain installation is distinct from runtime-source closure, and a fully offline build cache was not constructed here.

## Primary build references

- [Pinned Bun build dependencies](https://github.com/oven-sh/bun/blob/30e609e08073cf7114bfb278506962a5b19d0677/cmake/targets/BuildBun.cmake)
- [Current local-WebKit implementation](https://github.com/oven-sh/bun/blob/30e609e08073cf7114bfb278506962a5b19d0677/cmake/tools/SetupWebKit.cmake)
- [Current package build scripts](https://github.com/oven-sh/bun/blob/30e609e08073cf7114bfb278506962a5b19d0677/package.json)
- [Compile target/runtime selection](https://github.com/oven-sh/bun/blob/30e609e08073cf7114bfb278506962a5b19d0677/src/compile_target.zig)
- [Pinned WebKit Linux/ICU build](https://github.com/oven-sh/WebKit/blob/4a6a32c32c11ffb9f5a94c310b10f50130bfe6de/Dockerfile)
- [Pinned JSCOnly build options](https://github.com/oven-sh/WebKit/blob/4a6a32c32c11ffb9f5a94c310b10f50130bfe6de/Source/cmake/OptionsJSCOnly.cmake)

## Reconstruct a clean local checkout from the source companion

`git archive` intentionally omits `.git`. Before using the supported packaging
script, verify the archive against the companion receipt, reconstruct an ordinary
local commit, and compare its source tree with the recorded release source tree.
Do not label that new local commit as the original release commit. The synthetic
local identity below identifies the reconstruction, not the upstream authors.
The receipt's original release commit and archive digest remain the origin record.

```sh
set -eu
# Use a fresh directory. COMPANION is the verified source companion directory.
export COMPANION=/absolute/path/to/jazzkeys-source-companion
RELEASE_REF=$(python3 -c 'import json,os; print(json.load(open(os.environ["COMPANION"]+"/SOURCE-RECEIPT.json"))["project_source"]["commit"])')
SOURCE_TREE=$(python3 -c 'import json,os; print(json.load(open(os.environ["COMPANION"]+"/SOURCE-RECEIPT.json"))["project_source"]["source_tree"])')
python3 - <<'PYVERIFY'
import hashlib, json, os, pathlib
root = pathlib.Path(os.environ["COMPANION"])
source = json.loads((root / "SOURCE-RECEIPT.json").read_text())["project_source"]
archive = root / source["path"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == source["sha256"]
PYVERIFY
mkdir jazzkeys-local-rebuild
tar -xzf "$COMPANION/jazzkeys-$RELEASE_REF.tar.gz" \
  -C jazzkeys-local-rebuild --strip-components=1
cd jazzkeys-local-rebuild
git init --initial-branch=rebuild
git config core.autocrlf false
git add --force --all
test "$(git write-tree)" = "$SOURCE_TREE" || exit 1
git -c user.name='Local source rebuild' -c user.email='rebuild@localhost' \
  -c commit.gpgsign=false commit -m "Reconstruct release source $RELEASE_REF"
test -z "$(git status --porcelain)" || exit 1
```

The source-tree comparison happens before any recipient modifications. A mismatch
must be explained rather than silently claimed as the same source. If using an
older companion receipt without `source_tree`, obtain the exact original tree
from the release's manifest or recreate the source companion with the updated
collector. Commit any subsequent Jazzkeys source edits normally. Packaging records
the resulting local `HEAD` and tree, making modified/local-build provenance clear.
Keep the origin receipt with the rebuild report; the local commit cannot retain
the upstream commit's author/history or signature merely by matching its files.

Now install the locked inputs, optionally replace the built native addon, and use
the normal packaging script. Do not reinstall dependencies after replacing the
addon, because that can restore upstream bytes.

```sh
set -eu
# MODIFIED_BUN is the absolute freshly rebuilt native Bun executable above.
"$MODIFIED_BUN" install --frozen-lockfile --ignore-scripts
# Optional: REBUILT_ADDON names a native addon built from the supplied GPUIX
# sources (and any recipient modifications) for this same host target.
if [ -n "${REBUILT_ADDON:-}" ]; then
  case "$(uname -sm)" in
    'Darwin arm64') NATIVE_TARGET=darwin-arm64 ;;
    'Linux x86_64') NATIVE_TARGET=linux-x64-gnu ;;
    *) echo 'Unsupported rebuild host' >&2; exit 1 ;;
  esac
  cp "$REBUILT_ADDON" \
    "node_modules/@gpuix/native-$NATIVE_TARGET/gpuix-native.$NATIVE_TARGET.node"
fi
test -z "$(git status --porcelain)" || exit 1
"$MODIFIED_BUN" run packaging/build.ts
```

The output directory is `dist/jazzkeys-macos-arm64` or
`dist/jazzkeys-linux-x64-gnu`. Its manifest records the local project commit/tree
and the actual embedded addon digest. Record the modified Bun/GPUIX source commits
or patches and runtime digest alongside it: edits in ignored `node_modules` are
not represented by the Jazzkeys Git tree. Preserve these changes in any modified
source companion.

The packaging script runs both `--package-self-test` and `--native-self-test`.
The first exercises the bounded no-hardware worker boundary. The second loads
the actual embedded native binding and checks its renderer export without
creating a window or accessing hardware. Neither is an assertion that the native
window rendered or that a modified LGPL component's behavior was demonstrated.

This archive-to-clean-Git reconstruction was structurally tested: the recreated
tree matches the origin tree and the clean-HEAD preconditions used by packaging
hold. The full 2,046-file source archive at commit
`16e5e4fcb1cdf187313051116e0df6f4fedb03db` reconstructed tree
`200e7ad8cc00669eed139f1976f3633662c66e14` exactly, with a different honest local
commit. The collector also has an isolated regression test for the same flow.
No Bun/native compilation or windowed application was run for those checks.

## Bounded closure checks and resource expectations

The retained JSC archive was checked against all 11,261 selected upstream Git
blobs. Top-level CMake, the selected Source trees, all Tools, Bun patches and
code-generation inputs were inspected; zero Git submodules exist. No specific
missing covered-library source is currently identified. A fully offline cache
of generally available compilers/SDKs/build tools has not been prepared and is
not asserted to be part of this source companion.

A practical next check on an existing supported build host is to configure
WebKit directly with the JSC_CMAKE_ARGS from pinned SetupWebKit.cmake, stopping
after CMake generation rather than invoking its `jsc` target. Start with a
10-minute timeout and at most a few GiB of scratch budget; those are proposed
budgets, not measurements. This catches missing source paths and required
code-generation/setup files without compiling the JavaScript engine. A separate
TinyCC configure/static-library build using Bun's retained patch files is also a
small bounded check. Keep exact errors: missing host Clang/LLVM/ICU/CMake is a
build-host prerequisite, whereas a missing retained project source is a source
companion defect that must be repaired.

This research container has no CMake/Ninja/Clang available on PATH, so neither
configure check was run here. A full Bun/JSC native build may require substantial
RAM, multiple GiB of scratch and tens of minutes or longer; establish a suitable
host and budget before starting it. None of these unperformed experiments is
relabelled as a missing license grant or a mandatory modified-library trial.
