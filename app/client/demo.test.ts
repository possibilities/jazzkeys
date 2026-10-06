import { describe, expect, test } from 'bun:test';
import { DemoClient, type DemoProgress } from './demo';
import { scenarioState } from '../model/scenarios';
import type { DemoPlan } from '../model/editor';
function plan(): DemoPlan { const state = scenarioState('review'); if (state.phase.kind !== 'review') throw Error('fixture'); return state.phase.plan; }
const instant = () => Promise.resolve();
describe('intent-only simulation lifecycle', () => {
  test('reports verification only after snapshot, sending, settling and read-back phases', async () => {
    const progress: DemoProgress[] = [], client = new DemoClient(instant);
    const result = await client.apply(plan(), 'verified', event => progress.push(event));
    expect(progress.map(event => event.step)).toEqual(['snapshot', 'sending', 'sending', 'settling', 'verifying']);
    expect(result.mode).toBe('demo'); expect(result.verifiedKeys).toEqual(['caps-lock', 'right-alt']); expect(result.uncertainKeys).toEqual([]);
  });
  test.each(['snapshot-failed', 'rejected'] as const)('%s stops before all simulated sends', async scenario => {
    const progress: DemoProgress[] = []; const result = await new DemoClient(instant).apply(plan(), scenario, event => progress.push(event));
    expect(result.kind).toBe(scenario); expect(progress.map(event => event.step)).toEqual(['snapshot']); expect(result.verifiedKeys).toEqual([]);
  });
  test('response loss stops at one send and preserves uncertainty', async () => {
    const progress: DemoProgress[] = []; const result = await new DemoClient(instant).apply(plan(), 'uncertain', event => progress.push(event));
    expect(progress.filter(event => event.step === 'sending')).toHaveLength(1); expect(result.kind).toBe('uncertain'); expect(result.verifiedKeys).toEqual([]); expect(result.uncertainKeys).toEqual(['caps-lock']);
  });
  test('partial outcome reports only its established key', async () => {
    const result = await new DemoClient(instant).apply(plan(), 'partial', () => {});
    expect(result.kind).toBe('partial'); expect(result.verifiedKeys).toEqual(['caps-lock']); expect(result.uncertainKeys).toEqual([]);
  });
  test('cancelling before first send changes no mapping', async () => {
    const client = new DemoClient(instant), progress: DemoProgress[] = [];
    const result = await client.apply(plan(), 'verified', event => { progress.push(event); if (event.step === 'snapshot') client.cancel(); });
    expect(result.kind).toBe('cancelled'); expect(progress).toHaveLength(1); expect(result.verifiedKeys).toEqual([]); expect(result.uncertainKeys).toEqual([]);
  });
  test('cancelling after a send never claims a rollback or verification', async () => {
    const client = new DemoClient(instant), progress: DemoProgress[] = [];
    const result = await client.apply(plan(), 'verified', event => { progress.push(event); if (event.step === 'sending') client.cancel(); });
    expect(result.kind).toBe('uncertain'); expect(progress).toHaveLength(2); expect(result.verifiedKeys).toEqual([]); expect(result.uncertainKeys).toEqual(['caps-lock']);
  });
  test('cancelling during the second send marks every attempted, unverified key uncertain', async () => {
    const client = new DemoClient(instant);
    const result = await client.apply(plan(), 'verified', event => { if (event.step === 'sending' && event.sent === 2) client.cancel(); });
    expect(result.kind).toBe('uncertain'); expect(result.verifiedKeys).toEqual([]);
    expect(result.uncertainKeys).toEqual(['caps-lock', 'right-alt']);
    expect(result.changes.length - result.verifiedKeys.length - result.uncertainKeys.length).toBe(0);
  });
  test('cancelling while settling leaves all sent changes uncertain', async () => {
    const client = new DemoClient(instant);
    const result = await client.apply(plan(), 'verified', event => { if (event.step === 'settling') client.cancel(); });
    expect(result.kind).toBe('uncertain'); expect(result.uncertainKeys).toEqual(['caps-lock', 'right-alt']); expect(result.verifiedKeys).toEqual([]);
  });
  test('a plan is single-use; duplicate or concurrent application cannot start', async () => {
    const client = new DemoClient(instant), first = client.apply(plan(), 'verified', () => {});
    await expect(client.apply(plan(), 'verified', () => {})).rejects.toThrow('unavailable'); await first;
    await expect(client.apply(plan(), 'verified', () => {})).rejects.toThrow('unavailable');
  });
});
