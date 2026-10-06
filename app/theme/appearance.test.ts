import { describe, expect, test } from 'bun:test';
import { createAppearanceController, type SystemAppearanceSnapshot, type SystemAppearanceSource } from './appearance';
function observed(initial: SystemAppearanceSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const source: SystemAppearanceSource = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { source, set(next: SystemAppearanceSnapshot) { snapshot = next; for (const listener of listeners) listener(); }, listenerCount: () => listeners.size };
}
describe('system-only appearance presentation', () => {
  test('resolves the observed system before first render without changing it', () => {
    const os = observed({ appearance: 'dark', availability: 'live' });
    const controller = createAppearanceController({ source: os.source });
    expect(controller.getSnapshot()).toEqual({ effectiveAppearance: 'dark', availabilityLabel: 'Following system appearance' });
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    controller.dispose();
  });
  test('publishes live changes, preserves stable snapshots for no-op observations and releases ownership', () => {
    const os = observed({ appearance: 'light', availability: 'live' });
    const controller = createAppearanceController({ source: os.source });
    let updates = 0;
    const unsubscribe = controller.subscribe(() => updates++);
    const before = controller.getSnapshot();
    os.set({ appearance: 'light', availability: 'live' });
    expect(controller.getSnapshot()).toBe(before); expect(updates).toBe(0);
    os.set({ appearance: 'dark', availability: 'live' });
    expect(controller.getSnapshot().effectiveAppearance).toBe('dark'); expect(updates).toBe(1);
    unsubscribe(); controller.dispose();
    expect(os.listenerCount()).toBe(0);
    os.set({ appearance: 'light', availability: 'live' });
    expect(controller.getSnapshot().effectiveAppearance).toBe('dark'); expect(updates).toBe(1);
  });
  test('unavailable and read-once sources never claim automatic following', () => {
    const fallback = createAppearanceController();
    expect(fallback.getSnapshot()).toEqual({ effectiveAppearance: 'light', availabilityLabel: 'System appearance unavailable · using light' });
    const os = observed({ appearance: 'dark', availability: 'read-once' });
    const controller = createAppearanceController({ source: os.source });
    expect(controller.getSnapshot().effectiveAppearance).toBe('dark');
    expect(controller.getSnapshot().availabilityLabel).toContain('live updates unavailable');
    os.set({ appearance: null, availability: 'unavailable' });
    expect(controller.getSnapshot()).toEqual(fallback.getSnapshot());
    controller.dispose(); fallback.dispose();
  });
});
