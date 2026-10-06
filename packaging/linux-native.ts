import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { App, connectStdio } from '@gpuix/native/automation'
import { __napiBindingTarget } from '@gpuix/native'
import { startRuntimeTrace } from './runtime-trace'
import { palettes } from '../app/theme/tokens'

if (process.platform !== 'linux' || process.arch !== 'x64' || Bun.version !== '1.3.10'
  || __napiBindingTarget !== 'native' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.JAZZKEYS_HEADLESS_X11 !== '1' || !process.env.DISPLAY
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
const run = async (args: string[]): Promise<string> => {
  const child = Bun.spawn(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await within(Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]), args[0]!)
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr}`)
  return stdout.trim()
}
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
async function capture(app: App, name: string, width: number, height: number, expectedCanvas?: string) {
  await ready(app)
  await Bun.sleep(180) // Allow the asynchronous live UI thread to present its completed frame.
  const { pid } = await within(app.call('initialize', { protocolVersion: 1, client: 'jazzkeys-linux-acceptance' }), 'native identity')
  const windows = (await run(['xdotool', 'search', '--onlyvisible', '--pid', String(pid), '--name', '^Jazzkeys( Linux fixture)?$'])).split('\n')
  if (windows.length !== 1 || !/^\d+$/.test(windows[0]!)) throw new Error(`Expected exactly one Jazzkeys X11 window for PID ${pid}`)
  const windowId = windows[0]!
  const file = join(out, `${name}.png`)
  await writeFile(join(out, `${name}.x11.txt`), await run(['xwininfo', '-id', windowId]))
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
  const [tree, retained, painted] = await Promise.all([
    app.call('getTree', {}), app.call('getAllText', {}), app.call('getPaintedText', {}),
  ])
  const record = { name, width, height, pid, windowId, capture: 'X11 pixels from the live native window',
    pixels, tree: tree.tree, retainedText: retained.text, paintedText: painted.text,
    paintedTextLimit: 'Not an acceptance gate: stock Linux live painted-text registry is thread-local' }
  evidence.push(record)
  await writeFile(join(out, `${name}.json`), JSON.stringify(record, null, 2) + '\n')
  await saveEvidence()
}
async function saveEvidence() {
  await writeFile(join(out, 'evidence.json'), JSON.stringify({ schemaVersion: 1,
    sourceCommit: (await run(['git', 'rev-parse', 'HEAD'])), renderer: 'stock GPUIX 0.10.0 Linux x86-64 live X11 + Mesa software Vulkan',
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
const traced = await startRuntimeTrace({ packageDirectory, evidenceDirectory: join(root, 'artifacts/runtime/demo'), env: process.env, phase: 'demo' })
let app: App | undefined
let flowError: unknown
try {
  app = await connect(traced.child, traced.stop)
  await app.getByTestId('jazzkeys-root').waitFor({ timeoutMs: 10_000 })
  await capture(app, 'installed-system-dark-initial', 1180, 780, palettes.dark.canvas)
  portal.set('light')
  await capture(app, 'installed-system-light-live', 1180, 780, palettes.light.canvas)
  portal.set('dark')
  await capture(app, 'installed-system-dark-live', 1180, 780, palettes.dark.canvas)
  portal.set('light')
  await capture(app, 'installed-disconnected', 1180, 780, palettes.light.canvas)
  evidence.push({ name: 'installed-system-follow', result: 'passed',
    source: 'test-only Settings portal on private D-Bus session',
    flow: ['initial dark read', 'live light', 'live dark', 'live light'],
    proof: 'actual native X11 canvas pixels', actualDesktopSettingChanged: false, userThemeOverride: false })
  await click(app, 'open-demo')
  await click(app, 'key-caps-lock')
  await click(app, 'target-input')
  const input = await app.getByTestId('target-input').element()
  await app.call('keystrokes', { elementId: input.id, keys: 'e s c a p e' })
  await click(app, 'target-key.escape')
  await click(app, 'stage-change')
  await hasText(app, '1 staged change')
  await capture(app, 'installed-staged', 1180, 780)
  await click(app, 'review-changes')
  await app.getByTestId('cancel-review').waitFor({ timeoutMs: 10_000 })
  await capture(app, 'installed-review', 1180, 780)
  await app.call('keystrokes', { keys: 'escape' })
  await waitFor(async () => (await app!.getByTestId('cancel-review').count()) === 0, 'Escape dismisses review')
  // Enter without refocusing must reopen review, demonstrating focus return.
  await app.call('keystrokes', { keys: 'enter' })
  await app.getByTestId('cancel-review').waitFor({ timeoutMs: 10_000 })
  await click(app, 'simulate-apply')
  await hasText(app, 'Simulated changes verified')
  await capture(app, 'installed-verified', 1180, 780)
  evidence.push({ name: 'installed-interaction', result: 'passed', input: 'stock live GPUI dispatch and hit testing',
    flow: ['open demo', 'select Caps', 'search Escape', 'choose target', 'stage', 'review', 'Escape closes',
      'Enter reopens through restored focus', 'simulate', 'verified'], physicalKeyboard: false })
} catch (error) {
  flowError = error
  throw error
} finally {
  if (app) await app.close()
  else traced.stop()
  await portal.close()
  await saveEvidence()
  try { await within(traced.finish(), 'compiled GUI runtime evidence') }
  catch (error) {
    if (!flowError) throw error
    // Preserve the original UI/startup failure; the trace report remains a
    // separate receipt and must not replace the reason the native flow stopped.
    console.error('Runtime evidence also failed; inspect its summary report.')
  }
}

const scenarios = ['disconnected', 'read-only', 'editing', 'review', 'applying', 'verified', 'uncertain'] as const
const fixtures = (['1180x780', '960x680'] as const).flatMap(dimensions => (['light', 'dark'] as const).flatMap(appearance =>
  scenarios.map(scenario => ({ dimensions, appearance, scenario }))))
for (const fixture of fixtures) {
  const name = `${fixture.scenario}-${fixture.appearance}-${fixture.dimensions}`
  const [width, height] = fixture.dimensions.split('x').map(Number) as [number, number]
  const child = Bun.spawn([process.execPath, 'packaging/linux-fixture.ts', fixture.scenario, fixture.appearance,
    fixture.dimensions], { cwd: root, env: process.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const stderr = new Response(child.stderr).text().then(text => writeFile(join(out, `${name}.stderr.txt`), text))
  let fixtureApp: App | undefined
  try {
    fixtureApp = await connect(child, () => child.kill())
    await capture(fixtureApp, name, width, height)
  } finally {
    if (fixtureApp) await fixtureApp.close()
    child.kill()
    await within(Promise.all([child.exited, stderr]), 'native fixture shutdown')
  }
}
await saveEvidence()
console.log('Compiled native flow, live system-follow pixels, and 28 Linux fixture captures completed. Visual review is still required; no HID was opened.')
