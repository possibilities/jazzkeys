import { AppearanceFrames, UNAVAILABLE, type SystemAppearanceSnapshot } from './protocol'

export interface ManagedSystemAppearanceSource {
  getSnapshot(): SystemAppearanceSnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}
export interface AppearanceHelper {
  stdout: ReadableStream<Uint8Array>
  exited: Promise<number>
  stop(): void
}
export const unavailableSource = (): ManagedSystemAppearanceSource => ({
  getSnapshot: () => UNAVAILABLE, subscribe: () => () => {}, dispose() {},
})

/** Internal pipe consumer. No command, filesystem, or environment input is accepted. */
export async function observeAppearanceHelper(helper: AppearanceHelper): Promise<ManagedSystemAppearanceSource> {
  let snapshot = UNAVAILABLE
  let disposed = false
  let stopped = false
  let first = true
  const listeners = new Set<() => void>()
  let ready!: () => void
  const initial = new Promise<void>(resolve => { ready = resolve })
  const settle = () => { if (first) { first = false; clearTimeout(startup); ready() } }
  const update = (next: SystemAppearanceSnapshot) => {
    if (disposed) return
    if (next.appearance !== snapshot.appearance || next.availability !== snapshot.availability) {
      snapshot = next
      for (const listener of listeners) listener()
    }
    settle()
  }
  const stop = () => { if (!stopped) { stopped = true; helper.stop() } }
  const lost = () => {
    update(snapshot.appearance ? { appearance: snapshot.appearance, availability: 'read-once' } : UNAVAILABLE)
    stop()
  }
  // A startup deadline is a failure boundary, not a cosmetic polling loop.
  const startup = setTimeout(lost, 2_000)
  const reader = helper.stdout.getReader()
  void (async () => {
    const frames = new AppearanceFrames()
    try {
      while (!disposed && !stopped) {
        const next = await reader.read()
        if (disposed || stopped) break
        if (next.done) { frames.finish(); break }
        for (const frame of frames.push(next.value)) update(frame)
      }
      if (!disposed) lost()
    } catch { if (!disposed) lost() }
    finally { reader.releaseLock() }
  })()
  // Pipe EOF, not process-exit ordering, owns final frame consumption.
  void helper.exited.catch(() => lost())
  await initial
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(startup)
      listeners.clear()
      stop()
      void reader.cancel().catch(() => {})
    },
  }
}
