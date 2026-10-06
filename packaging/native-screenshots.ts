import { createElement } from 'react'
import { mkdir, writeFile } from 'node:fs/promises'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { JazzkeysApp, type JazzkeysAppProps } from '../app/ui/App'
import { windowKeyHandler } from '../app/ui/keyboard'
import { Button } from '../app/ui/controls'
import { palettes } from '../app/theme/tokens'
import { DEMO_LAYOUT } from '../app/model/layout'

if (process.platform !== 'darwin' || process.arch !== 'arm64' || !hasNativeTestRenderer) {
  throw new Error('Native screenshot acceptance requires the stock macOS ARM64 test renderer; it must not silently skip')
}
await mkdir('artifacts/native', {recursive:true})
const scenarios = ['disconnected','read-only','editing','review','applying','verified','uncertain'] as const
const evidence: unknown[] = []
for (const [width,height] of [[1180,780], [960,680]] as const) for (const appearance of ['light','dark'] as const) for (const scenario of scenarios) {
  const test = createTestRoot({width,height,onKeyDown:windowKeyHandler})
  try {
    test.render(createElement<JazzkeysAppProps>(JazzkeysApp,{initialScenario:scenario,initialAppearance:appearance,viewportWidth:width,viewportHeight:height}))
    test.renderer.flush()
    const name = `${scenario}-${appearance}-${width}x${height}`
    const text = test.renderer.getAllText()
    if (text.length < 3) throw new Error(`Empty native scene: ${name}`)
    test.renderer.captureScreenshot(`artifacts/native/${name}.png`)
    const a11y = test.renderer.getA11yTree()
    const semantics = Object.values(a11y.nodes ?? {}).map(node => node.aria ?? {})
    const physical = semantics.filter(node => node.label?.includes(', physical key.'))
    if (physical.length !== DEMO_LAYOUT.length || physical.some(node => node.role !== 'Button')) throw new Error(`Missing named native physical-key roles: ${name}`)
    if (scenario === 'editing') {
      if (!physical.some(node => node.selected && node.label?.includes('Caps Lock') && node.label.includes('Staged mapping: Escape'))) throw new Error(`Selected/staged native semantics missing: ${name}`)
      if (!physical.some(node => node.label?.startsWith('Fn,') && node.description?.includes('never editable'))) throw new Error(`Protected native description missing: ${name}`)
      if (!semantics.some(node => node.role === 'ComboBox' && node.label?.startsWith('Draft mapping.'))) throw new Error(`Named native mapping input missing: ${name}`)
      for (const id of ['keyboard-case', 'mapping-rail', 'review-changes']) {
        const element = test.renderer.findByTestId(id)
        const bounds = element && test.renderer.getElementBounds(element.id)
        if (!bounds || bounds.x < 0 || bounds.y < 56 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) throw new Error(`Editing control outside viewport: ${name}/${id}`)
      }
    }
    evidence.push({name,width,height,scenario,appearance,text,a11y})
    // Warning banners can overflow the compact workbench. Prove the native
    // scroll container exposes the entire rail while the action footer stays put.
    if (scenario === 'read-only') {
      const rail = test.renderer.findByTestId('mapping-rail')!
      test.renderer.scrollIntoView(rail.id)
      test.renderer.flush()
      const railBounds = test.renderer.getElementBounds(rail.id)!
      const footer = test.renderer.findByTestId('draft-action-bar')!
      const footerBounds = test.renderer.getElementBounds(footer.id)!
      if (railBounds.y < 56 || railBounds.y + railBounds.height > footerBounds.y + 1 || footerBounds.y !== height - 64) throw new Error(`Warning-state rail cannot be reached above fixed footer: ${name}`)
      test.renderer.captureScreenshot(`artifacts/native/${name}-scrolled.png`)
    }
  } finally { test.unmount() }
}
await writeFile('artifacts/native/evidence.json',JSON.stringify({schemaVersion:1,renderer:'stock GPUIX 0.10.0 macOS ARM64',hardware:'none',evidence},null,2))
// Actual native hit testing, state transition, and top-level cancellation.
const flow = createTestRoot({width:1180,height:780,onKeyDown:windowKeyHandler})
try {
  flow.render(createElement<JazzkeysAppProps>(JazzkeysApp,{initialScenario:'disconnected',initialAppearance:'light',viewportWidth:1180}))
  const click = (testId: string) => {
    flow.renderer.flush()
    const element = flow.renderer.findByTestId(testId)
    if (!element) throw new Error(`Missing native control ${testId}`)
    const bounds = flow.renderer.getElementBounds(element.id)
    if (!bounds) throw new Error(`Unlaid-out native control ${testId}`)
    if (bounds.y < 0 || bounds.y + bounds.height > 780 || bounds.x < 0 || bounds.x + bounds.width > 1180) {
      flow.renderer.captureScreenshot('artifacts/native/interaction-offscreen-control.png')
      throw new Error(`Native control is outside viewport: ${testId}`)
    }
    flow.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  }
  click('open-demo')
  click('key-caps-lock')
  if (!flow.renderer.getAllText().some(text=>text.includes('Caps'))) throw new Error('Key selection did not render')
  flow.renderer.captureScreenshot('artifacts/native/interaction-select.png')
  click('target-input')
  const input = flow.renderer.findByTestId('target-input')!
  flow.renderer.nativeSimulateKeystrokes(input.id,'e s c a p e')
  click('target-key.escape')
  click('stage-change')
  if (!flow.renderer.getAllText().includes('1 staged change')) throw new Error('Staging did not produce one draft change')
  click('review-changes')
  flow.renderer.captureScreenshot('artifacts/native/interaction-review.png')
  const cancel = flow.renderer.findByTestId('cancel-review')!
  if (!cancel) throw new Error('Review button did not open the sheet')
  if (flow.renderer.getFocusedElementId() !== cancel.id) throw new Error('Review must initially focus safe cancellation')
  const sheet = flow.renderer.findByTestId('review-sheet')!
  for (const key of ['tab','tab','tab','tab','shift-tab','shift-tab','shift-tab','shift-tab']) {
    flow.renderer.simulateKeystrokes(key)
    let focused = flow.renderer.getFocusedElementId()
    while (focused !== null && focused !== sheet.id) focused = flow.renderer.getElement(focused)?.parentId ?? null
    if (focused !== sheet.id) throw new Error('Keyboard focus escaped the review sheet')
  }
  flow.renderer.simulateKeystrokes('escape')
  flow.renderer.flush()
  if (flow.renderer.findByTestId('cancel-review')) throw new Error('Escape failed to dismiss the local review')
  if (flow.renderer.getFocusedElementId() !== flow.renderer.findByTestId('review-changes')?.id) throw new Error('Review did not restore focus')
  click('review-changes')
  click('simulate-apply')
  const deadline = Date.now()+5_000
  while (!flow.renderer.getAllText().includes('Simulated changes verified') && Date.now()<deadline) {
    await Bun.sleep(30)
    flow.renderer.flush()
  }
  if (!flow.renderer.getAllText().includes('Simulated changes verified')) throw new Error('Simulation failed to finish from native controls')
  flow.renderer.captureScreenshot('artifacts/native/interaction-verified.png')
} finally { flow.unmount() }
// Qualify the supported-native-host control's actual gesture semantics.
const controls = createTestRoot({width:400,height:200})
let presses = 0
try {
  const props = {palette:palettes.light,label:'Native activation test',testId:'activation-test',onPress:()=>{presses++},children:'Test action',style:{width:200}}
  controls.render(createElement(Button,props))
  const button = controls.renderer.findByTestId('activation-test')!
  controls.renderer.nativeSimulateKeyDown(button.id,'space')
  if (presses !== 0) throw new Error('Space activated before release')
  controls.renderer.nativeSimulateKeyUp(button.id,'space')
  if (Number(presses) !== 1) throw new Error('Space did not activate exactly once')
  controls.renderer.nativeSimulateKeyDown(button.id,'enter')
  controls.renderer.nativeSimulateKeyDown(button.id,'enter',true)
  if (Number(presses) !== 2) throw new Error('Held Enter repeated activation')
  const bounds = controls.renderer.getElementBounds(button.id)!
  controls.renderer.nativeSimulateMouseDown(bounds.x+20,bounds.y+20)
  controls.renderer.nativeSimulateMouseMove(390,190,0)
  controls.renderer.nativeSimulateMouseUp(390,190)
  if (Number(presses) !== 2) throw new Error('Pointer release outside committed activation')
  controls.render(createElement(Button,{...props,disabled:true}))
  controls.renderer.nativeSimulateKeystrokes(button.id,'enter space')
  if (Number(presses) !== 2) throw new Error('Disabled action was activated')
} finally {controls.unmount()}
await writeFile('artifacts/native/evidence.json',JSON.stringify({schemaVersion:1,renderer:'stock GPUIX 0.10.0 macOS ARM64',hardware:'none',evidence},null,2))
console.log('Native offscreen evidence captured; screenshots still require human/agent visual inspection.')
