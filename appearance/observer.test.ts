import { describe, expect, test } from 'bun:test'
import { observeAppearanceHelper } from './observer'
import { createSystemAppearanceSource } from '../app/client/system-appearance'

function fixture() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let stops = 0
  const stdout = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  return {
    helper: { stdout, exited: new Promise<number>(() => {}), stop() { stops++ } },
    write(value: unknown) { controller.enqueue(Buffer.from(JSON.stringify(value) + '\n')) },
    end() { controller.close() },
    stops: () => stops,
  }
}
const frame = (appearance: string | null, availability = 'live') => ({ v: 1, appearance, availability })
const tick = () => new Promise(resolve => setTimeout(resolve, 1))
describe('appearance host lifecycle', () => {
  test('awaits initial appearance; follows and deduplicates changes; disposal stops and unsubscribes', async () => {
    const fake = fixture()
    const pending = observeAppearanceHelper(fake.helper)
    fake.write(frame('dark'))
    const source = await pending
    expect(source.getSnapshot()).toEqual({ appearance: 'dark', availability: 'live' })
    let changes = 0
    const unsubscribe = source.subscribe(() => { changes++ })
    fake.write(frame('light')); fake.write(frame('light')); await tick()
    expect(source.getSnapshot().appearance).toBe('light'); expect(changes).toBe(1)
    unsubscribe(); fake.write(frame('dark')); await tick(); expect(changes).toBe(1)
    source.dispose(); source.dispose(); expect(fake.stops()).toBe(1)
  })
  test('retains last observed preference honestly after helper EOF', async () => {
    const fake = fixture()
    const pending = observeAppearanceHelper(fake.helper)
    fake.write(frame('dark')); const source = await pending
    fake.end(); await tick()
    expect(source.getSnapshot()).toEqual({ appearance: 'dark', availability: 'read-once' })
    expect(fake.stops()).toBe(1); source.dispose()
  })
  test('malformed startup output never becomes a preference', async () => {
    const fake = fixture()
    const pending = observeAppearanceHelper(fake.helper)
    fake.write({ command: 'launch' })
    const source = await pending
    expect(source.getSnapshot()).toEqual({ appearance: null, availability: 'unavailable' })
    expect(fake.stops()).toBe(1); source.dispose()
  })
  test('an unpackaged development launch never searches PATH or accepts theme environment overrides', async () => {
    const source = await createSystemAppearanceSource()
    expect(source.getSnapshot()).toEqual({ appearance: null, availability: 'unavailable' })
    source.dispose()
  })
})
