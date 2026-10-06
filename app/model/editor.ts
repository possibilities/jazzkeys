import { actionById } from './actions';
import { DEMO_LAYOUT, physicalKey } from './layout';
export type Mapping = Readonly<Record<string, string>>;
export interface Change { readonly physicalKey: string; readonly before: string; readonly after: string; readonly layer: 'base' }
export interface DemoPlan { readonly id: string; readonly revision: number; readonly generation: number; readonly changes: readonly Change[]; readonly mode: 'demo' }
export type OutcomeKind = 'verified' | 'partial' | 'uncertain' | 'rejected' | 'snapshot-failed' | 'cancelled';
export interface DemoOutcome { readonly kind: OutcomeKind; readonly planId: string; readonly changes: readonly Change[]; readonly verifiedKeys: readonly string[]; readonly uncertainKeys: readonly string[]; readonly message: string; readonly mode: 'demo' }
export type Phase = { kind: 'editing' } | { kind: 'review'; plan: DemoPlan } | { kind: 'applying'; plan: DemoPlan; step: 'snapshot' | 'sending' | 'settling' | 'verifying'; sent: number } | { kind: 'outcome'; outcome: DemoOutcome };
export interface EditorState {
  readonly mode: 'disconnected' | 'demo' | 'offline' | 'read-only'; readonly layer: 'base' | 'fn'; readonly baseline: Mapping; readonly draft: Mapping;
  readonly past: readonly Mapping[]; readonly future: readonly Mapping[]; readonly selected: string; readonly target: string;
  readonly revision: number; readonly generation: number; readonly phase: Phase; readonly notice: string | null;
}
export const demoBaseline = (): Mapping => Object.fromEntries(DEMO_LAYOUT.map(key => [key.id, key.original]));
export const initialEditorState = (): EditorState => ({ mode: 'disconnected', layer: 'base', baseline: demoBaseline(), draft: {}, past: [], future: [], selected: 'caps-lock', target: 'key.escape', revision: 0, generation: 0, phase: { kind: 'editing' }, notice: null });
export const changesFor = (state: Pick<EditorState, 'baseline' | 'draft'>): readonly Change[] => DEMO_LAYOUT.filter(key => state.draft[key.id] && state.draft[key.id] !== state.baseline[key.id]).map(key => ({ physicalKey: key.id, before: state.baseline[key.id]!, after: state.draft[key.id]!, layer: 'base' }));
export const canEdit = (state: EditorState): boolean => (state.mode === 'demo' || state.mode === 'offline') && state.phase.kind === 'editing' && state.layer === 'base';
export type EditorIntent =
  | { type: 'show-read-only' } | { type: 'open-demo' } | { type: 'select-key'; id: string } | { type: 'choose-target'; id: string } | { type: 'stage' }
  | { type: 'remove-change'; id: string } | { type: 'undo' } | { type: 'redo' } | { type: 'discard' }
  | { type: 'set-layer'; layer: 'base' | 'fn' } | { type: 'review' } | { type: 'close-review' }
  | { type: 'start-apply'; planId: string } | { type: 'progress'; planId: string; step: 'snapshot' | 'sending' | 'settling' | 'verifying'; sent: number }
  | { type: 'outcome'; outcome: DemoOutcome } | { type: 'dismiss-outcome' } | { type: 'disconnect-demo' } | { type: 'resume-demo' };
function withDraft(state: EditorState, draft: Mapping): EditorState {
  if (JSON.stringify(state.draft) === JSON.stringify(draft)) return state;
  return { ...state, draft, past: [...state.past.slice(-49), state.draft], future: [], revision: state.revision + 1, notice: null };
}
export function editorReducer(state: EditorState, intent: EditorIntent): EditorState {
  switch (intent.type) {
    case 'show-read-only': return state.phase.kind === 'applying' ? state : { ...state, mode: 'read-only', phase: { kind: 'editing' }, generation: state.generation + 1, notice: 'Simulated read-only session. Your local draft is preserved; staging and apply are unavailable.' };
    case 'open-demo': return { ...initialEditorState(), mode: 'demo', generation: state.generation + 1, notice: 'Demo opened. No keyboard access.' };
    case 'select-key': {
      if (state.phase.kind !== 'editing' || !physicalKey(intent.id)) return state;
      return { ...state, selected: intent.id, target: state.draft[intent.id] ?? state.baseline[intent.id]!, notice: null };
    }
    case 'choose-target': return canEdit(state) && actionById(intent.id) && !physicalKey(state.selected)?.protection ? { ...state, target: intent.id } : state;
    case 'stage': {
      if (!canEdit(state) || physicalKey(state.selected)?.protection || !actionById(state.target)) return state;
      const draft = { ...state.draft };
      if (state.target === state.baseline[state.selected]) delete draft[state.selected]; else draft[state.selected] = state.target;
      const next = withDraft(state, draft);
      return { ...next, notice: state.target === state.baseline[state.selected] ? 'Original mapping selected. No change is needed.' : 'Change staged locally. Review when you’re ready.' };
    }
    case 'remove-change': {
      if (!canEdit(state) || !state.draft[intent.id]) return state;
      const draft = { ...state.draft }; delete draft[intent.id];
      const next = withDraft(state, draft);
      return intent.id === state.selected ? { ...next, target: state.baseline[state.selected]! } : next;
    }
    case 'undo': {
      if (!canEdit(state) || !state.past.length) return state;
      return { ...state, draft: state.past[state.past.length - 1]!, past: state.past.slice(0, -1), future: [state.draft, ...state.future], revision: state.revision + 1, notice: 'Draft edit undone. No device mapping changed.' };
    }
    case 'redo': {
      if (!canEdit(state) || !state.future.length) return state;
      return { ...state, draft: state.future[0]!, past: [...state.past, state.draft], future: state.future.slice(1), revision: state.revision + 1, notice: 'Draft edit redone.' };
    }
    case 'discard': return canEdit(state) ? withDraft(state, {}) : state;
    case 'set-layer': return state.phase.kind === 'editing' ? { ...state, layer: intent.layer, target: state.draft[state.selected] ?? state.baseline[state.selected]!, notice: null } : state;
    case 'review': {
      const changes = changesFor(state);
      if (state.mode !== 'demo' || state.phase.kind !== 'editing' || !changes.length) return state;
      return { ...state, phase: { kind: 'review', plan: { id: `demo-${state.generation}-${state.revision}`, mode: 'demo', revision: state.revision, generation: state.generation, changes } } };
    }
    case 'close-review': return state.phase.kind === 'review' ? { ...state, phase: { kind: 'editing' } } : state;
    case 'start-apply': {
      if (state.mode !== 'demo' || state.phase.kind !== 'review' || state.phase.plan.id !== intent.planId || state.phase.plan.generation !== state.generation || state.phase.plan.revision !== state.revision) return state;
      return { ...state, phase: { kind: 'applying', plan: state.phase.plan, step: 'snapshot', sent: 0 } };
    }
    case 'progress': return state.phase.kind === 'applying' && state.phase.plan.id === intent.planId ? { ...state, phase: { ...state.phase, step: intent.step, sent: intent.sent } } : state;
    case 'outcome': {
      if (state.phase.kind !== 'applying' || state.phase.plan.id !== intent.outcome.planId || intent.outcome.mode !== 'demo') return state;
      const baseline = { ...state.baseline }, draft = { ...state.draft };
      for (const change of state.phase.plan.changes) if (intent.outcome.verifiedKeys.includes(change.physicalKey)) { baseline[change.physicalKey] = change.after; delete draft[change.physicalKey]; }
      return { ...state, baseline, draft, past: [], future: [], revision: state.revision + 1, phase: { kind: 'outcome', outcome: intent.outcome }, mode: intent.outcome.uncertainKeys.length ? 'offline' : state.mode };
    }
    case 'dismiss-outcome': return state.phase.kind === 'outcome' ? { ...state, phase: { kind: 'editing' } } : state;
    case 'disconnect-demo': return state.mode === 'demo' && state.phase.kind !== 'applying' ? { ...state, mode: 'offline', generation: state.generation + 1, phase: { kind: 'editing' }, notice: 'Demo disconnected. Your draft is still here; review is unavailable.' } : state;
    case 'resume-demo': return state.mode === 'offline' && state.phase.kind === 'editing' ? { ...state, notice: 'A fresh demo read is required. Open a new demo to reset simulated state, or keep editing this offline draft.' } : state;
  }
}
