/** The helper can report only a color preference and observation availability. */
export interface SystemAppearanceSnapshot {
  readonly appearance: 'light' | 'dark' | null
  readonly availability: 'live' | 'read-once' | 'unavailable'
}
export const UNAVAILABLE: SystemAppearanceSnapshot = Object.freeze({ appearance: null, availability: 'unavailable' })
export const MAX_FRAME_BYTES = 160

export function parseAppearanceFrame(line: string): SystemAppearanceSnapshot {
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error('Appearance frame exceeds limit')
  const value: unknown = JSON.parse(line)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid appearance frame')
  const frame = value as Record<string, unknown>
  if (Object.keys(frame).sort().join(',') !== 'appearance,availability,v' || frame.v !== 1 ||
      !['light', 'dark', null].includes(frame.appearance as never) ||
      !['live', 'read-once', 'unavailable'].includes(frame.availability as string) ||
      (frame.availability === 'unavailable' ? frame.appearance !== null : frame.appearance === null)) {
    throw new Error('Invalid appearance protocol')
  }
  return Object.freeze({ appearance: frame.appearance, availability: frame.availability }) as SystemAppearanceSnapshot
}

/** UTF-8 has no multibyte characters in this fixed protocol. Bound before decoding. */
export class AppearanceFrames {
  private pending = Buffer.alloc(0)
  push(bytes: Uint8Array): SystemAppearanceSnapshot[] {
    const frames: SystemAppearanceSnapshot[] = []
    // Iterate chunks rather than retaining an arbitrarily large incoming buffer.
    let start = 0
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 10) continue
      const size = this.pending.length + index - start
      if (size > MAX_FRAME_BYTES) throw new Error('Appearance frame exceeds limit')
      const line = Buffer.concat([this.pending, bytes.subarray(start, index)]).toString('utf8')
      frames.push(parseAppearanceFrame(line))
      this.pending = Buffer.alloc(0)
      start = index + 1
    }
    if (this.pending.length + bytes.length - start > MAX_FRAME_BYTES) throw new Error('Appearance frame exceeds limit')
    this.pending = Buffer.concat([this.pending, bytes.subarray(start)])
    return frames
  }
  finish(): void { if (this.pending.length) throw new Error('Truncated appearance frame') }
}
