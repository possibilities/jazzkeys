/** Fail before helpers/native imports when the pinned Linux addon cannot draw.
 * GPUI's exact selector checks ZED_HEADLESS presence before nonempty
 * WAYLAND_DISPLAY. The published 0.10.0 Linux binary has no X11 selector.
 * This is a startup prerequisite, not a check that a compositor is reachable.
 */
export function requireNativeDisplay(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>): void {
  if (platform !== 'linux') return
  if (env.ZED_HEADLESS !== undefined) {
    throw new Error('JazzKeys cannot open a Linux window while ZED_HEADLESS is set. Unset ZED_HEADLESS and launch JazzKeys from a Wayland session.')
  }
  if (env.WAYLAND_DISPLAY === undefined || env.WAYLAND_DISPLAY.length === 0) {
    throw new Error('This JazzKeys Linux build requires a Wayland session. X11-only and headless sessions are unsupported by the pinned native renderer.')
  }
}
