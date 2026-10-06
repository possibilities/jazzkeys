import type { Appearance } from './tokens';
export interface SystemAppearanceSnapshot {
  readonly appearance: Appearance | null;
  readonly availability: 'live' | 'read-once' | 'unavailable';
}
/** Host-owned OS preference observation. No command is invoked during render. */
export interface SystemAppearanceSource {
  getSnapshot(): SystemAppearanceSnapshot;
  subscribe(listener: () => void): () => void;
}
export interface AppearanceSnapshot {
  readonly effectiveAppearance: Appearance;
  readonly availabilityLabel: string;
}
export interface AppearanceController {
  getSnapshot(): AppearanceSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
const unavailable: SystemAppearanceSnapshot = { appearance: null, availability: 'unavailable' };
/** System appearance only. A deterministic light fallback is explicitly labelled. */
export function createAppearanceController({ source }: { source?: SystemAppearanceSource } = {}): AppearanceController {
  let disposed = false;
  const listeners = new Set<() => void>();
  const resolve = (): AppearanceSnapshot => {
    const system = source?.getSnapshot() ?? unavailable;
    const observed = system.availability === 'unavailable' ? null : system.appearance;
    return {
      effectiveAppearance: observed ?? 'light',
      availabilityLabel: !observed ? 'System appearance unavailable · using light'
        : system.availability === 'live' ? 'Following system appearance'
        : 'Last observed system appearance · live updates unavailable',
    };
  };
  let snapshot = resolve();
  const update = () => {
    if (disposed) return;
    const next = resolve();
    if (next.effectiveAppearance === snapshot.effectiveAppearance && next.availabilityLabel === snapshot.availabilityLabel) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const unsubscribe = source?.subscribe(update);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; unsubscribe?.(); listeners.clear(); },
  };
}
