/** Parse the documented Weston 13 one-shot scene-graph diagnostic, fail closed. */
export function verifyWestonScene(text: string, expected: {
  pid: number; title: string; appId: string; width: number; height: number
}) {
  if (!text.startsWith('Weston scene graph at ') || text.length > 1_000_000) throw new Error('Missing or oversized Weston scene graph')
  const rectangle = (block: string) => {
    const match = block.match(/^\s+position: \((-?\d+), (-?\d+)\) -> \((-?\d+), (-?\d+)\)$/m)
    if (!match) throw new Error('Missing compositor geometry')
    return match.slice(1).map(Number)
  }
  const expectedRectangle = [0, 0, expected.width, expected.height]
  const sameRectangle = (actual: number[]) => JSON.stringify(actual) === JSON.stringify(expectedRectangle)
  const outputs = [...text.matchAll(/^Output (\d+) \(([^\n)]+)\):$/gm)]
  if (outputs.length !== 1) throw new Error(`Expected one dedicated compositor output, observed ${outputs.length}`)
  const output = outputs[0]!
  const outputBlock = text.slice(output.index).split(/^Layer /m)[0]!
  if (!sameRectangle(rectangle(outputBlock)) || !/^\tscale: 1$/m.test(outputBlock)
    || !outputBlock.includes(`\tmode: ${expected.width}x${expected.height}@`)) throw new Error('Dedicated compositor output has unexpected geometry or scale')
  const headers = [...text.matchAll(/^\tView \d+ \(role ([^,\n]+), PID (\d+), surface ID (\d+), (.+), (?:0x[0-9a-f]+|\(nil\))\):$/gm)]
  if (headers.length !== [...text.matchAll(/^\tView /gm)].length) throw new Error('Unrecognized compositor surface record')
  const views = headers.map((header, index) => ({
    role: header[1]!, pid: Number(header[2]), surfaceId: Number(header[3]), label: header[4]!,
    block: text.slice(header.index, headers[index + 1]?.index).split(/^Layer /m)[0]!,
  }))
  const clientViews = views.filter(view => view.pid !== 0)
  if (clientViews.length !== 1) throw new Error(`Expected one application surface, observed ${clientViews.length}`)
  const app = clientViews[0]!
  if (app.pid !== expected.pid || app.role !== 'xdg_toplevel' || app.surfaceId <= 0
    || app.label !== `top-level window '${expected.title}' of ${expected.appId}`) throw new Error('Compositor surface does not belong to the expected JazzKeys process')
  if (/\[(?:view|surface) is not mapped!\]|\[no outputs\]|\balpha:/m.test(app.block)
    || !sameRectangle(rectangle(app.block))
    || !app.block.includes(`\t\toutputs: ${output[1]} (${output[2]}) (primary)`)) throw new Error('JazzKeys does not fill the dedicated mapped output')
  for (const view of views.filter(view => view.pid === 0)) {
    if (view.surfaceId !== 0 || view.role !== 'kiosk-shell-background' || view.label !== 'kiosk shell background surface'
      || !sameRectangle(rectangle(view.block))) throw new Error('Unexpected compositor-owned surface')
  }
  return { passed: true, output: output[2], outputId: Number(output[1]), rectangle: expectedRectangle, scale: 1,
    application: { pid: app.pid, surfaceId: app.surfaceId, role: app.role, title: expected.title, appId: expected.appId },
    clientSurfaceCount: clientViews.length, internalBackgrounds: views.length - clientViews.length,
    identitySource: 'Weston wl_client_get_credentials and desktop-surface metadata',
    scope: 'One synthetic JazzKeys surface in a fresh dedicated kiosk compositor; no user desktop' }
}
