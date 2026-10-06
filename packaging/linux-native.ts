import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { App, connectStdio } from '@gpuix/native/automation'
import { __napiBindingTarget } from '@gpuix/native'
import { startRuntimeTrace } from './runtime-trace'
import { palettes } from '../app/theme/tokens'
import { verifyWestonScene } from './linux-scene'

if (process.platform !== 'linux' || process.arch !== 'x64' || Bun.version !== '1.3.10'
  || __napiBindingTarget !== 'native' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.JAZZKEYS_HEADLESS_WAYLAND !== '1' || !process.env.DISPLAY
  || process.env.JAZZKEYS_NETWORK_NAMESPACE !== '1' || process.env.WAYLAND_DISPLAY
  || process.getuid?.() === 0) throw new Error('Use linux-xvfb.sh in isolated ordinary-user Linux CI')

const root = resolve(import.meta.dir, '..')
const out = join(root, 'artifacts/linux-native')
const packageDirectory = resolve(process.argv[2] ?? 'dist/jazzkeys-linux-x64-gnu')
await mkdir(out, { recursive: true })
const evidence: unknown[] = []
const within = async <T>(promise: Promise<T>, label: string, milliseconds = 15_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
const run = async (args: string[], env = process.env, allowMissing = false): Promise<string> => {
  const child = Bun.spawn(args, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  try {
    const [stdout, stderr, code] = await within(Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]), args[0]!)
    if (allowMissing && code === 1 && !stdout.trim()) return ''
    if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr}`)
    return stdout.trim()
  } finally { if (child.exitCode === null) child.kill() }
}
let compositorSequence = 0
async function startCompositor(name: string, width: number, height: number) {
  if (!process.env.XDG_RUNTIME_DIR || process.env.WAYLAND_DISPLAY || process.env.WAYLAND_SOCKET) throw new Error('The compositor harness must not inherit a Wayland session')
  const search = ['xdotool', 'search', '--all', '--onlyvisible', '--class', '^Weston Compositor$']
  if (await run(search, process.env, true)) throw new Error('A compositor already exists on the private test display')
  const socket = `jazzkeys-${++compositorSequence}`
  const socketPath = join(process.env.XDG_RUNTIME_DIR, socket)
  const args = ['weston', '--backend=x11', '--renderer=pixman', '--shell=kiosk-shell.so',
    '--output-count=1', `--width=${width}`, `--height=${height}`, '--scale=1', `--socket=${socket}`,
    '--no-config', '--no-input', '--idle-time=0', '--debug', `--log=${join(out, `${name}.weston.log`)}`]
  // Debug is solely for one-shot scene ownership attestation in this fresh,
  // private 0700 runtime directory. Never enable it on a user's compositor.
  const child = Bun.spawn(args, { cwd: root, env: process.env, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
  const onExit = () => { if (child.exitCode === null) child.kill() }
  process.once('exit', onExit)
  const errors = new Response(child.stderr).text().then(text => writeFile(join(out, `${name}.weston.stderr.txt`), text))
  const close = async () => {
    onExit()
    try { await within(Promise.all([child.exited, errors]), 'private compositor shutdown', 5_000) }
    finally { if (child.exitCode === null) child.kill('SIGKILL'); process.removeListener('exit', onExit) }
  }
  try {
    let windowId = ''
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`Private Weston exited (${child.exitCode}); inspect its retained log`)
      try { if (!(await lstat(socketPath)).isSocket()) throw new Error('Wayland endpoint is not a local socket') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
      const windows = (await run(search, process.env, true)).split('\n').filter(Boolean)
      if (windows.length > 1) throw new Error('More than one private compositor output window')
      windowId = windows[0] ?? ''
      return /^\d+$/.test(windowId)
    }, 'dedicated Weston kiosk output')
    // Weston 13 still advertises its seat with --no-input, but creates no
    // pointer/keyboard devices or cursor surface. The stock GPUI automation
    // sends native input through its UI thread without compositor input.
    const { DISPLAY: _display, WAYLAND_SOCKET: _socket, ...clientEnv } = process.env
    const env = { ...clientEnv, WAYLAND_DISPLAY: socket, XDG_SESSION_TYPE: 'wayland' }
    const metadata = { compositorPid: child.pid, windowId, socket, width, height, backend: 'Weston 13 X11 nested in private Xvfb',
      shell: 'kiosk', compositorRenderer: 'pixman', appRenderer: 'Mesa lavapipe Vulkan', args,
      input: 'Stock GPUI dispatch; Weston seat has no physical/synthetic compositor devices',
      capture: 'Exact dedicated compositor output window, never the X11 root or a user desktop' }
    await writeFile(join(out, `${name}.compositor.json`), JSON.stringify(metadata, null, 2) + '\n')
    return { ...metadata, env, close,
      async scene(pid: number, title: string, appId: string, evidenceName: string) {
        if (child.exitCode !== null || await run(search, process.env, true) !== windowId) throw new Error('Dedicated compositor output identity changed')
        const scene = await run(['weston-debug', 'scene-graph'], env)
        await writeFile(join(out, `${evidenceName}.scene.txt`), scene + '\n')
        return verifyWestonScene(scene, { pid, title, appId, width, height })
      },
    }
  } catch (error) { await close(); throw error }
}
type Compositor = Awaited<ReturnType<typeof startCompositor>>
const waitFor = async (condition: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 12_000
  do {
    if (await within(condition(), label)) return
    await Bun.sleep(60)
  } while (Date.now() < deadline)
  throw new Error(`Native state did not arrive: ${label}`)
}
type PipeChild = Bun.Subprocess<'pipe', 'pipe', 'pipe'>
async function connect(child: PipeChild, stop: () => void): Promise<App> {
  try {
    return await within(Promise.race([connectStdio({
      write: chunk => { child.stdin.write(chunk) },
      feed: listener => {
        void (async () => {
          const decoder = new TextDecoder()
          for await (const chunk of child.stdout) listener(decoder.decode(chunk, { stream: true }))
          listener(decoder.decode())
        })().catch(error => { console.error('Native pipe failed', error); stop() })
      },
      close: async () => { stop() },
    }), child.exited.then(code => { throw new Error(`Native process exited during automation startup (${code})`) })]),
    'live native automation startup', 30_000)
  } catch (error) { stop(); throw error }
}
async function ready(app: App) {
  // Unlike getPaintedText's thread-local registry, getTree/getBounds route to
  // Linux's actual UI thread. Require a text node with real painted dimensions.
  await waitFor(async () => (await app.getByText('Jazzkeys').all()).some(node =>
    node.text === 'Jazzkeys' && !!node.bounds && node.bounds.width > 0 && node.bounds.height > 0), 'painted Jazzkeys window')
  const all = (await app.call('getAllText', {})).text
  if (all.some(text => text.includes('Uncaught runtime errors:'))) throw new Error('Native runtime error overlay appeared')
}
async function capture(app: App, compositor: Compositor, name: string, width: number, height: number, expectedCanvas?: string) {
  const { pid } = await within(app.call('initialize', { protocolVersion: 1, client: 'jazzkeys-linux-acceptance' }), 'native identity')
  const fixture = name.startsWith('installed-') ? false : true
  const title = fixture ? 'Jazzkeys Linux fixture' : 'Jazzkeys'
  const appId = fixture ? 'io.jazzkeys.linux-fixture' : 'io.jazzkeys.desktop'
  let sceneBefore: ReturnType<typeof verifyWestonScene> | undefined
  await waitFor(async () => {
    try { sceneBefore = await compositor.scene(pid, title, appId, `${name}-before`); return true }
    catch (error) {
      // An initial configure/commit can precede the first mapped app surface.
      // All identity/geometry requirements still have to pass before capture.
      if (error instanceof Error && /Expected one application surface, observed 0|Jazzkeys does not fill the dedicated mapped output/.test(error.message)) return false
      throw error
    }
  }, `mapped Wayland surface for ${name}`)
  if (!sceneBefore) throw new Error('Missing native surface ownership receipt')
  await ready(app)
  await Bun.sleep(180) // Allow the asynchronous live UI thread to present its completed frame.
  const windowId = compositor.windowId
  const file = join(out, `${name}.png`)
  const geometry = await run(['xwininfo', '-id', windowId])
  if (!new RegExp(`Width: ${width}\\s`).test(geometry) || !new RegExp(`Height: ${height}\\s`).test(geometry)
    || !/Border width: 0\s/.test(geometry)) throw new Error('Dedicated compositor X11 output has unexpected geometry or borders')
  const identity = await run(['xprop', '-id', windowId, 'WM_CLASS', '_NET_WM_NAME'])
  if (!identity.includes('WM_CLASS(STRING) = "weston-1", "Weston Compositor"')
    || !identity.includes(`_NET_WM_NAME(UTF8_STRING) = "Weston Compositor - ${sceneBefore.output}"`)) throw new Error('Dedicated compositor output identity is not Weston')
  await writeFile(join(out, `${name}.x11.txt`), geometry + '\n' + identity + '\n')
  let pixels: unknown
  await waitFor(async () => {
    await run(['import', '-silent', '-window', windowId, file])
    try {
      pixels = JSON.parse(await run(['/usr/bin/python3', 'packaging/linux-check-pixels.py', file,
        String(width), String(height), ...(expectedCanvas ? [expectedCanvas] : [])]))
      return true
    } catch (error) {
      if (!expectedCanvas || !(error instanceof Error) || !error.message.includes('Canvas color mismatch:')) throw error
      return false
    }
  }, expectedCanvas ? `native canvas changes to ${expectedCanvas}` : 'valid native pixels')
  const sceneAfter = await compositor.scene(pid, title, appId, `${name}-after`)
  const [tree, retained, painted] = await Promise.all([
    app.call('getTree', {}), app.call('getAllText', {}), app.call('getPaintedText', {}),
  ])
  const record = { name, width, height, pid, windowId, capture: compositor.capture, sceneBefore, sceneAfter,
    pixels, tree: tree.tree, retainedText: retained.text, paintedText: painted.text,
    paintedTextLimit: 'Not an acceptance gate: stock Linux live painted-text registry is thread-local' }
  evidence.push(record)
  await writeFile(join(out, `${name}.json`), JSON.stringify(record, null, 2) + '\n')
  await saveEvidence()
}
async function saveEvidence() {
  await writeFile(join(out, 'evidence.json'), JSON.stringify({ schemaVersion: 2,
    sourceCommit: (await run(['git', 'rev-parse', 'HEAD'])), renderer: 'stock GPUIX 0.10.0 Linux x86-64 live Wayland + Mesa software Vulkan; dedicated Weston kiosk output in private Xvfb',
    testRenderer: false, browser: false, hardware: 'none', visualInspection: 'required', evidence }, null, 2) + '\n')
}
async function click(app: App, testId: string) {
  await app.getByTestId(testId).waitFor({ timeoutMs: 10_000 })
  const bounds = await app.getByTestId(testId).bounds()
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1180 || bounds.y + bounds.height > 780
    || bounds.width <= 0 || bounds.height <= 0) throw new Error(`Native control outside viewport: ${testId}`)
  await app.getByTestId(testId).click()
  await Bun.sleep(80)
}
async function hasText(app: App, text: string) {
  await waitFor(async () => (await app.call('getAllText', {})).text.includes(text), text)
}
async function verifyWarningScroll(app: App, compositor: Compositor, name: string, width: number, height: number) {
  const workspace = await app.getByTestId('bench-workspace').element()
  const measure = async () => ({
    rail: await app.getByTestId('mapping-rail').bounds(),
    footer: await app.getByTestId('draft-action-bar').bounds(),
    workspace: await app.getByTestId('bench-workspace').bounds(),
    offset: (await app.call('getScrollOffset', { elementId: workspace.id })).offset,
  })
  const before = await measure()
  // Stock GPUI deltas are pixels: negative Y scrolls the content down. Dispatch
  // into the workspace's blank left margin, away from nested input/list widgets.
  const input = { x: before.workspace.x + 12, y: before.workspace.y + 40, deltaX: 0, deltaY: -600 }
  let failure: unknown
  try {
    await app.call('scrollWheel', input)
    await waitFor(async () => {
      const { rail, footer } = await measure()
      const fixedFooter = (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(footer[key] - before.footer[key]) <= 1)
      return rail.x >= 0 && rail.x + rail.width <= width && rail.y >= 56
        && rail.y + rail.height <= footer.y + 1 && fixedFooter
        && Math.abs(footer.y + footer.height - height) <= 1
    }, `full warning-state mapping rail above fixed footer: ${name}`)
  } catch (error) { failure = error }
  const after = await measure()
  const report = { name: `${name}-scroll`, result: failure ? 'failed' : 'passed', input: 'stock native GPUI scroll-wheel dispatch',
    event: input, before, after, fullRailVisibleAboveFixedFooter: !failure }
  await writeFile(join(out, `${name}-scroll.json`), JSON.stringify(report, null, 2) + '\n')
  evidence.push(report)
  // Keep actual failure pixels as well as geometry; a retained tree alone must
  // never turn an occluded read-only rail into a successful acceptance receipt.
  await capture(app, compositor, `${name}-${failure ? 'scroll-failed' : 'scrolled'}`, width, height)
  if (failure) throw failure
}
async function startFakePortal() {
  // The surrounding script created this test's private session bus. This server
  // never connects to a user's bus or changes an actual desktop preference.
  const child = Bun.spawn(['/usr/bin/python3', 'appearance/tests/fake-portal.py'], {
    cwd: root, env: process.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  })
  const onExit = () => { if (child.exitCode === null) child.kill() }
  process.once('exit', onExit)
  const errors = new Response(child.stderr).text().then(text => writeFile(join(out, 'fake-portal.stderr.txt'), text))
  const reader = child.stdout.getReader()
  let pending = ''
  await within((async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Test-only Settings portal exited before acquiring its name')
      pending += new TextDecoder().decode(value)
      if (pending.includes('\n')) {
        if (JSON.parse(pending.split('\n')[0]!).ready !== true) throw new Error('Unexpected test portal readiness frame')
        return
      }
    }
  })(), 'private test Settings portal')
  return {
    set(appearance: 'light' | 'dark') { child.stdin.write(`${appearance}\n`) },
    async close() {
      child.stdin.write('quit\n'); child.stdin.end()
      try { await within(child.exited, 'private Settings portal shutdown', 2_000) }
      finally { onExit(); process.removeListener('exit', onExit); reader.releaseLock(); await errors }
    },
  }
}

// Prove the syscall sensor detects forbidden classes using only synthetic
// loopback traffic and an ordinary temporary file, before trusting clean traces.
await run([process.execPath, 'packaging/runtime-sensor.ts', join(root, 'artifacts/runtime/sensor')])

// First establish the compiled worker boundary separately: the GUI demo never
// needs to start a worker. The trace wrapper verifies hashes and exact child exec.
const bootstrap = await startRuntimeTrace({ packageDirectory, evidenceDirectory: join(root, 'artifacts/runtime/bootstrap'),
  env: process.env, args: ['--package-self-test'], phase: 'bootstrap' })
const bootstrapOutput = await within(new Response(bootstrap.child.stdout).text(), 'compiled worker handshake')
const bootstrapReport = await within(bootstrap.finish(), 'bootstrap runtime evidence')
if (!bootstrapOutput.includes('"hardwareAccess":false')) throw new Error('Compiled handshake did not deny hardware access')
await writeFile(join(out, 'bootstrap.json'), JSON.stringify({ output: bootstrapOutput, report: bootstrapReport }, null, 2) + '\n')

const portal = await startFakePortal()
const compositor = await startCompositor('installed', 1180, 780)
const traced = await startRuntimeTrace({ packageDirectory, evidenceDirectory: join(root, 'artifacts/runtime/demo'), env: compositor.env, phase: 'demo' })
let app: App | undefined
let flowError: unknown
try {
  app = await connect(traced.child, traced.stop)
  await capture(app, compositor, 'installed-system-dark-initial', 1180, 780, palettes.dark.canvas)
  portal.set('light')
  await capture(app, compositor, 'installed-system-light-live', 1180, 780, palettes.light.canvas)
  portal.set('dark')
  await capture(app, compositor, 'installed-system-dark-live', 1180, 780, palettes.dark.canvas)
  portal.set('light')
  await capture(app, compositor, 'installed-disconnected', 1180, 780, palettes.light.canvas)
  evidence.push({ name: 'installed-system-follow', result: 'passed',
    source: 'test-only Settings portal on private D-Bus session',
    flow: ['initial dark read', 'live light', 'live dark', 'live light'],
    proof: 'actual native Wayland canvas pixels in a dedicated compositor output', actualDesktopSettingChanged: false, userThemeOverride: false })
  await click(app, 'open-demo')
  await click(app, 'key-caps-lock')
  await click(app, 'target-input')
  const input = await app.getByTestId('target-input').element()
  await app.call('keystrokes', { elementId: input.id, keys: 'e s c a p e' })
  await click(app, 'target-key.escape')
  await click(app, 'stage-change')
  await hasText(app, '1 staged change')
  await capture(app, compositor, 'installed-staged', 1180, 780)
  await click(app, 'review-changes')
  await app.getByTestId('cancel-review').waitFor({ timeoutMs: 10_000 })
  await capture(app, compositor, 'installed-review', 1180, 780)
  await app.call('keystrokes', { keys: 'escape' })
  await waitFor(async () => (await app!.getByTestId('cancel-review').count()) === 0, 'Escape dismisses review')
  // Enter without refocusing must reopen review, demonstrating focus return.
  await app.call('keystrokes', { keys: 'enter' })
  await app.getByTestId('cancel-review').waitFor({ timeoutMs: 10_000 })
  await click(app, 'simulate-apply')
  await hasText(app, 'Simulated changes verified')
  await capture(app, compositor, 'installed-verified', 1180, 780)
  evidence.push({ name: 'installed-interaction', result: 'passed', input: 'stock live GPUI dispatch and hit testing',
    flow: ['open demo', 'select Caps', 'search Escape', 'choose target', 'stage', 'review', 'Escape closes',
      'Enter reopens through restored focus', 'simulate', 'verified'], physicalKeyboard: false })
} catch (error) {
  flowError = error
  throw error
} finally {
  if (app) await app.close()
  else traced.stop()
  await saveEvidence()
  try {
    const report = await within(traced.finish(), 'compiled GUI runtime evidence')
    const expectedSocket = join(process.env.XDG_RUNTIME_DIR!, compositor.socket)
    if (!report.policy.unixConnections.includes(expectedSocket)) throw new Error('Compiled app trace lacks its exact dedicated Wayland socket connection')
    evidence.push({ name: 'installed-runtime-wayland', result: 'passed', compositorPid: compositor.compositorPid,
      socket: compositor.socket, source: 'compiled-app descendant strace and dedicated scene ownership',
      internetAttempts: report.policy.internetAttempts, deviceAttempts: report.policy.deviceAttempts })
    await saveEvidence()
  }
  catch (error) {
    if (!flowError) throw error
    // Preserve the original UI/startup failure; the trace report remains a
    // separate receipt and must not replace the reason the native flow stopped.
    console.error('Runtime evidence also failed; inspect its summary report.')
  }
  finally { await compositor.close(); await portal.close() }
}

const scenarios = ['disconnected', 'read-only', 'editing', 'review', 'applying', 'verified', 'uncertain'] as const
const fixtures = (['1180x780', '960x680'] as const).flatMap(dimensions => (['light', 'dark'] as const).flatMap(appearance =>
  scenarios.map(scenario => ({ dimensions, appearance, scenario }))))
for (const fixture of fixtures) {
  const name = `${fixture.scenario}-${fixture.appearance}-${fixture.dimensions}`
  const [width, height] = fixture.dimensions.split('x').map(Number) as [number, number]
  const fixtureCompositor = await startCompositor(name, width, height)
  const child = Bun.spawn([process.execPath, 'packaging/linux-fixture.ts', fixture.scenario, fixture.appearance,
    fixture.dimensions], { cwd: root, env: fixtureCompositor.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const stderr = new Response(child.stderr).text().then(text => writeFile(join(out, `${name}.stderr.txt`), text))
  let fixtureApp: App | undefined
  try {
    fixtureApp = await connect(child, () => child.kill())
    await capture(fixtureApp, fixtureCompositor, name, width, height)
    if (fixture.scenario === 'read-only') await verifyWarningScroll(fixtureApp, fixtureCompositor, name, width, height)
  } finally {
    if (fixtureApp) await fixtureApp.close()
    child.kill()
    try { await within(Promise.all([child.exited, stderr]), 'native fixture shutdown') }
    finally { await fixtureCompositor.close() }
  }
}
await saveEvidence()
console.log('Compiled native Wayland flow, live system-follow pixels, 28 Linux fixture captures, and four native warning-state scroll checks completed. Visual review is still required; no HID was opened.')
