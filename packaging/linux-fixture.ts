import { createElement } from 'react'
import { render } from '@gpuix/react'
import { __napiBindingTarget } from '@gpuix/native'
import { JazzkeysApp, type JazzkeysAppProps, type NativeScenario } from '../app/ui/App'
import { windowKeyHandler } from '../app/ui/keyboard'

// A separate acceptance entrypoint. The production executable never reads these
// fixture arguments, and all states still use the production no-HID components.
if (process.platform !== 'linux' || process.arch !== 'x64' || Bun.version !== '1.3.10'
  || __napiBindingTarget !== 'native' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.JAZZKEYS_HEADLESS_X11 !== '1' || !process.env.DISPLAY
  || process.env.WAYLAND_DISPLAY) throw new Error('Linux fixtures require the isolated native Xvfb CI session')

const [scenario, appearance, dimensions] = process.argv.slice(2)
const scenarios: NativeScenario[] = ['disconnected', 'read-only', 'editing', 'review', 'applying', 'verified', 'uncertain']
if (!scenarios.includes(scenario as NativeScenario) || !['light', 'dark'].includes(appearance ?? '')
  || !['1180x780', '960x680'].includes(dimensions ?? '')
  || process.argv.length !== 5) throw new Error('Unknown bounded native fixture')
const [width, height] = dimensions!.split('x').map(Number) as [number, number]
render(createElement<JazzkeysAppProps>(JazzkeysApp, {
  initialScenario: scenario as NativeScenario,
  initialAppearance: appearance as 'light' | 'dark',
  viewportWidth: width,
  viewportHeight: height,
}), { title: 'Jazzkeys Linux fixture', appName: 'Jazzkeys', appId: 'io.jazzkeys.linux-fixture',
  width, height, minWidth: width, minHeight: height, onKeyDown: windowKeyHandler })
