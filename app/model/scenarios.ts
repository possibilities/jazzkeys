import { editorReducer, initialEditorState, type EditorState } from './editor';
export type NativeScenario = 'disconnected' | 'read-only' | 'editing' | 'review' | 'applying' | 'verified' | 'uncertain';
/** Deterministic native-render acceptance fixtures. All non-disconnected data is
 * explicitly simulated and invokes exactly the same production components. */
export function scenarioState(scenario: NativeScenario): EditorState {
  if (scenario === 'disconnected') return initialEditorState();
  if (scenario === 'read-only') return editorReducer(initialEditorState(), { type: 'show-read-only' });
  let state = editorReducer(initialEditorState(), { type: 'open-demo' });
  state = editorReducer(state, { type: 'stage' });
  state = editorReducer(state, { type: 'select-key', id: 'right-alt' });
  state = editorReducer(state, { type: 'choose-target', id: 'modifier.right-control' });
  state = editorReducer(state, { type: 'stage' });
  state = editorReducer(state, { type: 'select-key', id: 'caps-lock' });
  if (scenario === 'editing') return state;
  state = editorReducer(state, { type: 'review' });
  if (scenario === 'review' || state.phase.kind !== 'review') return state;
  const plan = state.phase.plan;
  state = editorReducer(state, { type: 'start-apply', planId: plan.id });
  if (scenario === 'applying') return editorReducer(state, { type: 'progress', planId: plan.id, step: 'settling', sent: 2 });
  return editorReducer(state, { type: 'outcome', outcome: { mode: 'demo', planId: plan.id, changes: plan.changes, kind: scenario, verifiedKeys: scenario === 'verified' ? ['caps-lock', 'right-alt'] : [], uncertainKeys: scenario === 'uncertain' ? ['caps-lock'] : [], message: scenario === 'verified' ? '2 simulated changes read back correctly. No real keyboard was accessed.' : 'The simulated keyboard stopped responding after a write. Some changes may have applied. Sending stopped.' } });
}
