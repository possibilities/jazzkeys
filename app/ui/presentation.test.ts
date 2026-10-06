import { describe, expect, test } from 'bun:test';
import { editorReducer as reduce, initialEditorState, changesFor } from '../model/editor';
import { scenarioState } from '../model/scenarios';
import { physicalKey, DEMO_LAYOUT } from '../model/layout';
import { benchLayout, railColumns } from './bench-layout';
import { inspectorPresentation, keySpokenLabel } from './presentation';
describe('Instrument Bench presentation and fit', () => {
  test.each([[1180, 780, 56, 928, 144], [960, 680, 48, 800, 124]])('fits normal editing at %i × %i without shrinking labels', (width, height, unit, boardWidth, boardY) => {
    const b = benchLayout(width!, height!);
    expect(b.unit).toBe(unit!); expect(b.boardWidth).toBe(boardWidth!);
    expect(b.headerHeight + b.topGap + b.contextHeight + b.boardGap).toBe(boardY!);
    const content = b.headerHeight + b.topGap + b.contextHeight + b.boardGap + b.boardHeight + b.captionGap + b.captionHeight + b.railGap + b.railHeight + b.bottomGap + b.footerHeight;
    expect(content).toBeLessThanOrEqual(height!);
    expect(b.boardWidth).toBeLessThan(width!);
    const columns = railColumns(b.contentWidth, b.compact);
    expect(columns.identity + columns.current + columns.target + columns.actions + columns.gap * 3 + columns.padding * 2 + 2).toBe(b.contentWidth);
    expect(columns.actions).toBeGreaterThanOrEqual(230);
    for (const key of DEMO_LAYOUT) {
      expect(key.width * b.unit - 6).toBeGreaterThanOrEqual(42);
      expect(key.x * b.unit + key.width * b.unit - 6).toBeLessThanOrEqual(b.boardWidth - 32);
      expect(key.y * b.unit + b.unit - 6).toBeLessThanOrEqual(b.boardHeight - 32);
    }
  });
  test('intermediate widths keep four usable columns without an accidental breakpoint wrap', () => {
    for (let width = 960; width <= 1280; width += 4) {
      const b = benchLayout(width, 780);
      const c = railColumns(b.contentWidth, b.compact);
      expect(c.actions).toBeGreaterThanOrEqual(229);
      expect(c.target).toBeGreaterThanOrEqual(280);
      expect(c.identity + c.current + c.target + c.actions + c.gap * 3 + c.padding * 2 + 2).toBe(b.contentWidth);
    }
  });
  test('large windows cap the board and distribute surplus space instead of scaling glyphs', () => {
    const b = benchLayout(1600, 1000);
    expect(b.unit).toBe(56); expect(b.contentWidth).toBe(1120);
    expect(b.boardGap).toBeGreaterThan(20); expect(b.railGap).toBeGreaterThan(20);
  });
  test('staged, update, baseline removal and no-op each have an honest local action', () => {
    let state = scenarioState('editing');
    expect(inspectorPresentation(state)).toMatchObject({ same: true, pending: 'key.escape', status: 'Staged change' });
    state = reduce(state, { type: 'choose-target', id: 'key.tab' });
    expect(inspectorPresentation(state)).toMatchObject({ same: false, action: 'Update change' });
    state = reduce(state, { type: 'choose-target', id: 'key.caps-lock' });
    expect(inspectorPresentation(state)).toMatchObject({ same: false, action: 'Remove staged change' });
    state = reduce(state, { type: 'stage' });
    expect(inspectorPresentation(state)).toMatchObject({ same: true, pending: undefined, status: 'Base layer' });
  });
  test('changing physical key or layer cancels only the un-staged target; removal restores the baseline field', () => {
    let state = reduce(scenarioState('editing'), { type: 'choose-target', id: 'key.tab' });
    const draft = state.draft;
    state = reduce(state, { type: 'select-key', id: 'a' });
    expect(state.target).toBe('key.a'); expect(state.draft).toBe(draft);
    state = reduce(state, { type: 'choose-target', id: 'key.b' });
    state = reduce(state, { type: 'set-layer', layer: 'fn' });
    expect(state.target).toBe('key.a'); expect(state.draft).toBe(draft);
    state = reduce(state, { type: 'set-layer', layer: 'base' });
    state = reduce(state, { type: 'select-key', id: 'caps-lock' });
    state = reduce(state, { type: 'remove-change', id: 'caps-lock' });
    expect(state.target).toBe('key.caps-lock'); expect(changesFor(state)).toHaveLength(1);
  });
  test('offline source, unavailable layer and protected unknown entries remain explicit', () => {
    const offline = reduce(scenarioState('editing'), { type: 'disconnect-demo' });
    expect(inspectorPresentation(offline)).toMatchObject({ currentLabel: 'Last read · demo', editable: true });
    expect(keySpokenLabel(offline, physicalKey('caps-lock')!)).toContain('Last read in demo');
    const fn = reduce(offline, { type: 'set-layer', layer: 'fn' });
    expect(inspectorPresentation(fn)).toMatchObject({ current: 'Not read', editable: false });
    expect(keySpokenLabel(fn, physicalKey('caps-lock')!)).not.toContain('Staged mapping');
    const unknown = reduce(reduce(initialEditorState(), { type: 'open-demo' }), { type: 'select-key', id: 'home' });
    expect(inspectorPresentation(unknown)).toMatchObject({ current: 'Unknown action · preserved', editable: false, status: 'Protected' });
    expect(inspectorPresentation(scenarioState('read-only')).editable).toBe(false);
  });
  test('read-only inspection preserves selected physical identity and existing local work', () => {
    const before = reduce(scenarioState('editing'), { type: 'select-key', id: 'right-alt' });
    const readOnly = reduce(before, { type: 'show-read-only' });
    expect(readOnly.selected).toBe('right-alt'); expect(readOnly.draft).toBe(before.draft);
    expect(readOnly.baseline).toBe(before.baseline); expect(inspectorPresentation(readOnly).editable).toBe(false);
    expect(reduce(readOnly, { type: 'review' })).toBe(readOnly);
    const applying = scenarioState('applying'); expect(reduce(applying, { type: 'show-read-only' })).toBe(applying);
  });
  test('full spoken labels retain physical modifier side, staged target and protection', () => {
    const state = scenarioState('editing');
    expect(keySpokenLabel(state, physicalKey('right-alt')!)).toBe('Right Alt, physical key. On demo board: Right Alt / Option. Staged mapping: Right Control');
    expect(keySpokenLabel(state, physicalKey('fn')!)).toContain('Protected');
  });
});
