# Install the Mac demo

Download the `Jazzkeys-demo-macos-arm64-….zip` asset from a
[Mac demo release](https://github.com/possibilities/jazzkeys/releases). Choose the
app ZIP, not GitHub's automatically generated source archive. The release also
provides checksums, provenance, and the complete corresponding-source companion.

Requires **Apple silicon and macOS 14.8.9 or later**. Unzip it and move
`Jazzkeys.app` to Applications, or keep it in a folder you own. No Rust, Xcode,
Bun, Node, Terminal command, account, installer, or background service is needed.
Open the app in Finder when you are ready.

This is an **experimental demo**, without Developer ID signing or notarization.
macOS may block it. Follow [Apple's security guidance](https://support.apple.com/en-us/102445)
and decide whether you trust this exact download; do not globally disable
Gatekeeper or remove quarantine with shell commands. This project does not
claim Apple's notarization or approval. No permission prompt should be accepted
merely to explore the demo. If one appears, stop and report its type without
sharing private identifiers.

The app can demonstrate selecting keys, staging mappings, and reviewing a draft.
It cannot read or change the connected keyboard. Its two palettes follow system
appearance; there is no manual theme setting.

To uninstall, quit the app and remove `Jazzkeys.app`. There is no daemon,
startup item, driver, or system HID permission rule to remove. No persistent
hardware snapshot is created by this demo.

## What installation testing establishes

CI builds the app on macOS ARM64, archives it, extracts it into a new path with
spaces, verifies every bundled file and executable mode, and runs its private
worker and native-binding self-tests with an empty runtime PATH. These self-tests
do not open a window. Native offscreen rendering/interaction checks are separate.

The packaged app's ordinary macOS GUI startup, runtime network behavior, and OS
permission prompts have not yet been observed. Neither full installation nor
screen-reader acceptance is claimed. Hosted CI permission preapprovals would
also limit what absence of visible prompts could prove. See [release scope](RELEASE.md).
