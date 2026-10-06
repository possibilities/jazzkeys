import { createElement } from 'react'
import { mkdir, writeFile } from 'node:fs/promises'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { JazzkeysApp, type JazzkeysAppProps } from '../app/ui/App'
import { windowKeyHandler } from '../app/ui/keyboard'

if (process.platform !== 'darwin' || process.arch !== 'arm64' || !hasNativeTestRenderer) {
  throw new Error('Native screenshot acceptance requires the stock macOS ARM64 test renderer; it must not silently skip')
}
await mkdir('artifacts/native', {recursive:true})
const scenarios = ['disconnected','read-only','editing','review','applying','verified','uncertain'] as const
const evidence: unknown[] = []
for (const [width,height] of [[1180,780], [960,680]] as const) for (const appearance of ['light','dark'] as const) for (const scenario of scenarios) {
  const test = createTestRoot({width,height,onKeyDown:windowKeyHandler})
  try {
    test.render(createElement<JazzkeysAppProps>(JazzkeysApp,{initialScenario:scenario,initialAppearance:appearance,viewportWidth:width}))
    test.renderer.flush()
    const name = `${scenario}-${appearance}-${width}x${height}`
    const text = test.renderer.getAllText()
    if (text.length < 3) throw new Error(`Empty native scene: ${name}`)
    test.renderer.captureScreenshot(`artifacts/native/${name}.png`)
    evidence.push({name,width,height,scenario,appearance,text,a11y:test.renderer.getA11yTree()})
  } finally { test.unmount() }
}
// Actual native hit testing, state transition, and top-level cancellation.
const alternative = createTestRoot({width:1180,height:780,onKeyDown:windowKeyHandler})
try {
  alternative.render(createElement<JazzkeysAppProps>(JazzkeysApp,{initialScenario:'editing',initialAppearance:'light',viewportWidth:1180,designComposition:'stacked-workbench'}))
  alternative.renderer.flush()
  alternative.renderer.captureScreenshot('artifacts/native/composition-stacked-workbench.png')
} finally { alternative.unmount() }
const flow = createTestRoot({width:1180,height:780,onKeyDown:windowKeyHandler})
try {
  flow.render(createElement<JazzkeysAppProps>(JazzkeysApp,{initialScenario:'disconnected',initialAppearance:'light',viewportWidth:1180}))
  const click = (testId: string) => {
    flow.renderer.flush()
    const element = flow.renderer.findByTestId(testId)
    if (!element) throw new Error(`Missing native control ${testId}`)
    const bounds = flow.renderer.getElementBounds(element.id)
    if (!bounds) throw new Error(`Unlaid-out native control ${testId}`)
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
  if (!flow.renderer.getAllText().includes('1 pending change')) throw new Error('Staging did not produce one draft change')
  click('review-changes')
  const cancel = flow.renderer.findByTestId('cancel-review')!
  if (flow.renderer.getFocusedElementId() !== cancel.id) throw new Error('Review must initially focus safe cancellation')
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
await writeFile('artifacts/native/evidence.json',JSON.stringify({schemaVersion:1,renderer:'stock GPUIX 0.10.0 macOS ARM64',hardware:'none',evidence},null,2))
console.log('Native offscreen evidence captured; screenshots still require human/agent visual inspection.')
