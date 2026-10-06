# Rust worker upstream license and source inventory

The machine-readable inventory is
[`../../redistribution/worker-inventory.json`](../../redistribution/worker-inventory.json).
It covers **all 21 registry crates in `device/Cargo.lock`**, deliberately including
host build dependencies, procedural macros, and target-conditional crates.
It is not a claim that every listed crate is linked into every worker binary.

## Provenance and preservation

Each crate archive was hashed with SHA-256 and matched to the checksum in the
pinned lockfile before any file was copied. All 144 preserved upstream files are
byte-for-byte originals from those verified archives. Per-file paths, archive
paths, sizes, and SHA-256 hashes are recorded in the inventory, together with
exact source archive URLs, upstream repository/VCS metadata and manifest fields.

The copied files include:

- All 44 upstream license, copyright and notice files found in the archives
- Both published Cargo manifests when provided, VCS metadata, and README context
- 16 complete source files carrying additional copyright notices: the Ulf Adams
  notices in `ryu`, and the Alexander Huszagh attribution for `serde_json`'s
  vendored lexical code

Upstream file names, contents, encodings, and line endings are unchanged. The
package directories are licensing/provenance subsets, **not complete vendored
crate sources**. The pinned archive URLs and checksums identify exact sources;
these references alone do not assert that an application's complete source
redistribution requirements have been met.

## License choices

The inventory elects MIT wherever it is an available license branch, and BSL-1.0
for `ryu`. Alternative upstream license texts remain included. The legacy
`version_check` manifest spelling `MIT/Apache-2.0` is normalized to
`MIT OR Apache-2.0`; its included README explicitly offers either license.

**`unicode-ident` is `(MIT OR Apache-2.0) AND Unicode-3.0`.** Its election is
`MIT AND Unicode-3.0`. The full original `LICENSE-UNICODE` notice is included;
choosing MIT does not remove that additional requirement.

## Build and target boundaries

The inventory labels `serde_derive`, `proc-macro2`, `quote`, `syn`, and
`unicode-ident` as host procedural-macro packages, and `version_check` as a host
build dependency. It retains their notices conservatively. `libc` is a
platform-conditional dependency through `cpufeatures`; its presence in the
lockfile does not establish its inclusion in an x86_64 Linux worker. Upstream
manifest dependency declarations retain their kind, target predicate, optional
flag and feature requests; not every declaration is active in a worker build.

No worker was built or run for this inventory, and no actual linked target set
is claimed. Rust standard-library/toolchain notices, operating-system runtimes,
GPUIX and JavaScript packages require their own inventories. This package set is
not a complete binary SBOM.

Verified on 2026-10-06 UTC.
