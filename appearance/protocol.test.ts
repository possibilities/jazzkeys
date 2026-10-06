import { describe, expect, test } from 'bun:test'
import { AppearanceFrames, parseAppearanceFrame } from './protocol'
const line = (appearance: unknown, availability: unknown = 'live') => JSON.stringify({ v: 1, appearance, availability })
describe('bounded appearance protocol', () => {
  test('allows only the typed protocol, including honest degradation', () => {
    expect(parseAppearanceFrame(line('dark'))).toEqual({ appearance: 'dark', availability: 'live' })
    expect(parseAppearanceFrame(line('light', 'read-once'))).toEqual({ appearance: 'light', availability: 'read-once' })
    expect(parseAppearanceFrame(line(null, 'unavailable'))).toEqual({ appearance: null, availability: 'unavailable' })
    for (const bad of ['{}', '[]', 'null', line('system'), line(null), line('dark', 'unavailable'), line('dark', 'polling'),
      '{"v":2,"appearance":"dark","availability":"live"}', '{"v":1,"appearance":"dark","availability":"live","command":"anything"}', ' '.repeat(161)]) {
      expect(() => parseAppearanceFrame(bad)).toThrow()
    }
  })
  test('handles fragmented and joined frames without waiting for another chunk', () => {
    const stream = new AppearanceFrames()
    const frames = Buffer.from(line('dark') + '\n' + line('light') + '\n')
    expect(stream.push(frames.subarray(0, 11))).toEqual([])
    expect(stream.push(frames.subarray(11))).toEqual([{ appearance: 'dark', availability: 'live' }, { appearance: 'light', availability: 'live' }])
    stream.finish()
  })
  test('bounds incomplete frames and refuses truncated output', () => {
    expect(() => new AppearanceFrames().push(Buffer.alloc(161, 32))).toThrow()
    const stream = new AppearanceFrames()
    stream.push(Buffer.from('{'))
    expect(() => stream.finish()).toThrow()
  })
})
