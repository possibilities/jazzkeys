import { describe, expect, test } from 'bun:test';
import { editorReducer as reduce, initialEditorState, changesFor, type EditorState } from './editor';
import { scenarioState } from './scenarios';
import { DEMO_LAYOUT, adjacentKey, physicalKey, validateLayout } from './layout';
import { KEY_ACTIONS } from './actions';
const demo = () => reduce(initialEditorState(), { type: 'open-demo' });
const stage = (state: EditorState, id: string, target: string) => reduce(reduce(reduce(state, { type: 'select-key', id }), { type: 'choose-target', id: target }), { type: 'stage' });
describe('isolated editor state', () => {
  test('starts disconnected with no staged work or implicit session', () => {
    const state = initialEditorState(); expect(state.mode).toBe('disconnected'); expect(changesFor(state)).toEqual([]);
    expect(reduce(state, { type: 'stage' })).toBe(state); expect(reduce(state, { type: 'review' })).toBe(state);
  });
  test('choosing a target does not stage a change', () => {
    const state = reduce(demo(), { type: 'choose-target', id: 'key.escape' });
    expect(changesFor(state)).toEqual([]); expect(state.baseline['caps-lock']).toBe('key.caps-lock');
  });
  test('staging keeps physical identity, produces minimal diff and supports removing a no-op', () => {
    let state = stage(demo(), 'caps-lock', 'key.escape');
    expect(changesFor(state)).toEqual([{ physicalKey: 'caps-lock', layer: 'base', before: 'key.caps-lock', after: 'key.escape' }]);
    state = stage(state, 'caps-lock', 'key.caps-lock'); expect(changesFor(state)).toEqual([]);
    expect(physicalKey('caps-lock')?.legend).toBe('Caps Lock');
  });
  test.each(['fn', 'knob', 'home'])('protected %s cannot stage or replace its entry', id => {
    const state = stage(demo(), id, 'key.escape'); expect(changesFor(state)).toEqual([]);
    expect(state.baseline[id]).toBe(physicalKey(id)!.original);
  });
  test('unknown actions and physical IDs are refused', () => {
    const state = demo(); expect(reduce(state, { type: 'choose-target', id: 'macro.anything' })).toBe(state);
    expect(reduce(state, { type: 'select-key', id: 'slot-127' })).toBe(state);
  });
  test('Fn and read-only sessions are not editable', () => {
    const fn = reduce(demo(), { type: 'set-layer', layer: 'fn' }); expect(reduce(fn, { type: 'stage' })).toBe(fn);
    const ro = scenarioState('read-only'); expect(reduce(ro, { type: 'stage' })).toBe(ro); expect(reduce(ro, { type: 'review' })).toBe(ro);
  });
  test('undo and redo affect the local draft only; a new edit drops redo history', () => {
    const first = stage(demo(), 'caps-lock', 'key.escape'); const second = stage(first, 'a', 'key.b');
    const undone = reduce(second, { type: 'undo' }); expect(undone.draft).toEqual(first.draft); expect(undone.baseline).toEqual(second.baseline);
    expect(reduce(undone, { type: 'redo' }).draft).toEqual(second.draft);
    const alternate = stage(undone, 'a', 'key.c'); expect(alternate.future).toEqual([]);
  });
  test('discard individual and all changes can be undone locally', () => {
    const original = stage(stage(demo(), 'a', 'key.b'), 'caps-lock', 'key.escape');
    const single = reduce(original, { type: 'remove-change', id: 'a' }); expect(changesFor(single)).toHaveLength(1);
    expect(reduce(single, { type: 'undo' }).draft).toEqual(original.draft);
    const empty = reduce(original, { type: 'discard' }); expect(changesFor(empty)).toHaveLength(0);
    expect(reduce(empty, { type: 'undo' }).draft).toEqual(original.draft);
  });
  test('review freezes a complete diff and cancelling preserves the draft', () => {
    const state = stage(demo(), 'caps-lock', 'key.escape'), review = reduce(state, { type: 'review' });
    expect(review.phase.kind).toBe('review'); expect(reduce(review, { type: 'stage' })).toBe(review);
    const cancelled = reduce(review, { type: 'close-review' }); expect(cancelled.draft).toEqual(state.draft); expect(cancelled.phase.kind).toBe('editing');
  });
  test('duplicate apply, wrong plan, and unbound progress cannot move state', () => {
    const review = scenarioState('review'); if (review.phase.kind !== 'review') throw Error('fixture');
    expect(reduce(review, { type: 'start-apply', planId: 'other' })).toBe(review);
    const applying = reduce(review, { type: 'start-apply', planId: review.phase.plan.id });
    expect(reduce(applying, { type: 'start-apply', planId: review.phase.plan.id })).toBe(applying);
    expect(reduce(applying, { type: 'progress', planId: 'other', step: 'sending', sent: 2 })).toBe(applying);
  });
  test('disconnect invalidates review but keeps offline draft and does not auto-rebase', () => {
    const state = scenarioState('review'), offline = reduce(state, { type: 'disconnect-demo' });
    expect(offline.draft).toEqual(state.draft); expect(offline.generation).toBe(state.generation + 1); expect(offline.phase.kind).toBe('editing');
    expect(reduce(offline, { type: 'review' })).toBe(offline);
    const edited = stage(offline, 'a', 'key.b'); expect(changesFor(edited)).toHaveLength(3);
    const resumed = reduce(edited, { type: 'resume-demo' }); expect(resumed.mode).toBe('offline'); expect(resumed.draft).toEqual(edited.draft);
  });
  test('verified result rebases only verified keys; uncertain result preserves offline draft', () => {
    const success = scenarioState('verified'); expect(changesFor(success)).toEqual([]); expect(success.baseline['caps-lock']).toBe('key.escape');
    expect(success.past).toEqual([]); expect(reduce(success, { type: 'undo' })).toBe(success);
    const uncertain = scenarioState('uncertain'); expect(uncertain.mode).toBe('offline'); expect(changesFor(uncertain)).toHaveLength(2);
    expect(uncertain.baseline['caps-lock']).toBe('key.caps-lock');
  });
});
describe('provisional spatial geometry', () => {
  test('geometry is unique, bounded and non-overlapping; no storage slots are invented', () => {
    expect(() => validateLayout(DEMO_LAYOUT)).not.toThrow(); expect(DEMO_LAYOUT.length).toBeGreaterThan(70);
    expect(new Set(DEMO_LAYOUT.map(key => key.id)).size).toBe(DEMO_LAYOUT.length);
    expect(() => validateLayout([...DEMO_LAYOUT, DEMO_LAYOUT[0]!])).toThrow('Duplicate');
    expect(() => validateLayout([{ ...DEMO_LAYOUT[0]!, x: -1 }])).toThrow('geometry');
  });
  test('arrow navigation follows physical position and is stable at edges', () => {
    expect(adjacentKey('a', 'right')).toBe('s'); expect(adjacentKey('a', 'left')).toBe('caps-lock');
    expect(adjacentKey('caps-lock', 'down')).toBe('left-shift'); expect(adjacentKey('escape', 'left')).toBe('escape');
    for (const key of DEMO_LAYOUT) for (const direction of ['left', 'right', 'up', 'down'] as const) expect(physicalKey(adjacentKey(key.id, direction))).toBeDefined();
  });
  test('only ordinary key usages and standalone modifiers are offered', () => {
    expect(new Set(KEY_ACTIONS.map(action => action.id)).size).toBe(KEY_ACTIONS.length);
    expect(KEY_ACTIONS.every(action => action.id.startsWith('key.') || action.id.startsWith('modifier.'))).toBe(true);
  });
});
