import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { requireNativeDisplay } from './runtime-support'

describe('pinned Linux native startup prerequisites', () => {
  test('rejects absent/empty Wayland even with DISPLAY or WAYLAND_SOCKET', () => {
    for (const env of [{}, { DISPLAY: ':99' }, { WAYLAND_SOCKET: '4' },
      { WAYLAND_DISPLAY: '', DISPLAY: ':99', WAYLAND_SOCKET: '4' }]) {
      expect(() => requireNativeDisplay('linux', env)).toThrow('requires a Wayland session')
    }
  })
  test('any ZED_HEADLESS value takes precedence, including empty, zero and false', () => {
    for (const value of ['', '0', 'false', '1']) {
      expect(() => requireNativeDisplay('linux', { ZED_HEADLESS: value, WAYLAND_DISPLAY: 'wayland-0' })).toThrow('ZED_HEADLESS is set')
    }
  })
  test('mirrors raw nonempty Wayland selection without requiring optional environment', () => {
    for (const value of ['wayland-0', '0', ' ', '/tmp/private-wayland']) {
      expect(() => requireNativeDisplay('linux', { WAYLAND_DISPLAY: value })).not.toThrow()
    }
    expect(() => requireNativeDisplay('linux', { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':99', WAYLAND_SOCKET: '4' })).not.toThrow()
  })
  test('does not apply Linux backend restrictions to other platforms or mutate input', () => {
    const env = Object.freeze({ ZED_HEADLESS: '', WAYLAND_DISPLAY: '', DISPLAY: ':99' })
    for (const platform of ['darwin', 'win32', 'freebsd'] as const) expect(() => requireNativeDisplay(platform, env)).not.toThrow()
    expect(env).toEqual({ ZED_HEADLESS: '', WAYLAND_DISPLAY: '', DISPLAY: ':99' })
  })
})

// Exercise the actual entrypoint, with the stock loader's documented invalid
// flavor rejection as a sentinel BEFORE it can load any native binding. These
// are CLI routing/ordering checks, not rendering or compiled-package acceptance.
const entrypoint = resolve(import.meta.dir, '../main.tsx')
const loaderSentinel = 'jazzkeys-no-native-code-test'
async function cli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, entrypoint, ...args], {
    cwd: resolve(import.meta.dir, '../..'), env: { PATH: '', NAPI_RS_WASI_FLAVOR: loaderSentinel, ...env },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(child.signalCode).toBeNull()
    return { stdout, stderr, code }
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL') }
}

describe('no-window CLI startup ordering', () => {
  test.skipIf(process.platform !== 'linux')('normal X11-only startup fails before native loading', async () => {
    const result = await cli([], { DISPLAY: ':jazzkeys-test-unavailable' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('requires a Wayland session')
    expect(result.stderr).not.toContain(`Unsupported WASI flavor "${loaderSentinel}"`)
    expect(result.stdout).toBe('')
  })
  test.skipIf(process.platform !== 'linux')('normal ZED_HEADLESS startup fails before native loading', async () => {
    const result = await cli([], { ZED_HEADLESS: '', WAYLAND_DISPLAY: 'wayland-test-unavailable' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('ZED_HEADLESS is set')
    expect(result.stderr).not.toContain(`Unsupported WASI flavor "${loaderSentinel}"`)
  })
  test.skipIf(process.platform !== 'linux')('nonempty Wayland reaches the existing loader without creating a window', async () => {
    const result = await cli([], { WAYLAND_DISPLAY: 'wayland-test-unavailable' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(`Unsupported WASI flavor "${loaderSentinel}"`)
    expect(result.stderr).not.toContain('requires a Wayland session')
  })
  test('package self-test retains its uncompiled integrity boundary regardless of display', async () => {
    const result = await cli(['--package-self-test'], { ZED_HEADLESS: '1' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Worker integrity is available only in a compiled Jazzkeys package')
    expect(result.stderr).not.toContain('ZED_HEADLESS is set')
    expect(result.stderr).not.toContain(`Unsupported WASI flavor "${loaderSentinel}"`)
  })
  test('native self-test still reaches its loader regardless of display', async () => {
    const result = await cli(['--native-self-test'], { ZED_HEADLESS: '1' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(`Unsupported WASI flavor "${loaderSentinel}"`)
    expect(result.stderr).not.toContain('ZED_HEADLESS is set')
  })
})
