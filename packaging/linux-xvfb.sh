#!/usr/bin/env bash
set -euo pipefail

# Never attach to an inherited/user display. This entrypoint is deliberately CI
# only; a fresh authenticated Xvfb display and private D-Bus session are created.
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -s)" == Linux ]] || {
  echo 'This native smoke test is restricted to isolated Linux GitHub Actions.' >&2; exit 1;
}
[[ $# -eq 1 && -x "$1/jazzkeys" ]] || { echo 'Pass the compiled package directory.' >&2; exit 1; }
package_directory="$(realpath "$1")"
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
mkdir -p artifacts/linux-native artifacts/runtime
unset DISPLAY WAYLAND_DISPLAY WAYLAND_SOCKET
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
mkdir -m 700 "$XDG_RUNTIME_DIR/home"
trap 'rm -rf "$XDG_RUNTIME_DIR"' EXIT
export JAZZKEYS_HEADLESS_WAYLAND=1
export LIBGL_ALWAYS_SOFTWARE=1
export WGPU_BACKEND=vulkan
# Force Mesa's CPU Vulkan ICD rather than relying on runner GPU selection.
mapfile -t icds < <(find /usr/share/vulkan/icd.d -maxdepth 1 -name 'lvp_icd*.json' -print)
[[ ${#icds[@]} -eq 1 ]] || { echo 'Expected exactly one Mesa lavapipe ICD.' >&2; exit 1; }
export VK_ICD_FILENAMES="${icds[0]}"
export VK_DRIVER_FILES="$VK_ICD_FILENAMES"
{
  date -u +%FT%TZ
  git rev-parse HEAD
  cat /etc/os-release
  uname -a
  printf 'Runner image: %s %s\n' "${ImageOS:-unknown}" "${ImageVersion:-unknown}"
  bun --version
  ldd --version
  dpkg-query -W -f='${Package}\t${Version}\n' xvfb xauth xdotool imagemagick dbus-x11 \
    libvulkan1 mesa-vulkan-drivers vulkan-tools libxkbcommon0 libxkbcommon-x11-0 \
    libfontconfig1 fonts-dejavu-core strace python3-pil python3-gi gcc pkg-config libglib2.0-dev weston
  weston --version
  cat "$VK_ICD_FILENAMES"
  sha256sum node_modules/@gpuix/native-linux-x64-gnu/*.node
  readelf --version-info node_modules/@gpuix/native-linux-x64-gnu/*.node
} > artifacts/linux-native/environment.txt 2>&1
export JAZZKEYS_LINUX_PACKAGE="$package_directory"
export JAZZKEYS_BASE_NETWORK_NS="$(readlink /proc/self/ns/net)"
export JAZZKEYS_BUN="$(command -v bun)"
xvfb-run --auto-servernum --server-args='-screen 0 1280x900x24 -nolisten tcp' \
  --error-file=artifacts/linux-native/xvfb.log dbus-run-session -- bash -c '
    set -euo pipefail
    xdpyinfo > artifacts/linux-native/x11.txt
    vulkaninfo --summary > artifacts/linux-native/vulkan.txt 2>&1
    grep -Eiq "llvmpipe|lavapipe" artifacts/linux-native/vulkan.txt
    # Root only creates a disposable network namespace; runuser drops privilege
    # before Bun, native code, fixtures, tracing, or application code executes.
    # Explicit environment preserves the local display, not CI credentials.
    sudo --non-interactive unshare --net -- runuser --user "$(id -un)" -- env -i \
      PATH="$PATH" HOME="$XDG_RUNTIME_DIR/home" USER="$(id -un)" LOGNAME="$(id -un)" \
      DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
      DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" XDG_SESSION_TYPE=x11 \
      GITHUB_ACTIONS=true JAZZKEYS_HEADLESS_WAYLAND=1 JAZZKEYS_NETWORK_NAMESPACE=1 \
      JAZZKEYS_BASE_NETWORK_NS="$JAZZKEYS_BASE_NETWORK_NS" LIBGL_ALWAYS_SOFTWARE=1 \
      RUST_LOG=info WGPU_BACKEND=vulkan \
      VK_ICD_FILENAMES="$VK_ICD_FILENAMES" VK_DRIVER_FILES="$VK_DRIVER_FILES" \
      timeout --signal=TERM --kill-after=10s 360s "$JAZZKEYS_BUN" packaging/linux-native.ts "$JAZZKEYS_LINUX_PACKAGE"
  '
