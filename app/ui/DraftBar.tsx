import { canEdit, changesFor, type EditorState, type EditorIntent } from '../model/editor';
import type { Palette } from '../theme/tokens';
import { Button } from './controls';
export function DraftBar({ state, palette: p, compact, disabled, send, onReview }: { state: EditorState; palette: Palette; compact: boolean; disabled: boolean; send: (intent: EditorIntent) => void; onReview: () => void }) {
  const count = changesFor(state).length;
  const editable = canEdit(state) && !disabled;
  return <div testId="draft-action-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, height: 64, flexShrink: 0, paddingLeft: compact ? 24 : 32, paddingRight: compact ? 24 : 32, borderTopWidth: 1, borderColor: p.border, backgroundColor: p.canvas }}>
    <div role="status" aria-label={`${count} staged changes. ${state.notice ?? 'Local draft. Demo only.'}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <text style={{ color: p.text, fontSize: 15, lineHeight: 20, fontWeight: 600 }}>{count ? `${count} staged ${count === 1 ? 'change' : 'changes'}` : 'No staged changes'}</text>
      <text style={{ color: p.secondary, fontSize: 12, lineHeight: 16 }}>{count ? 'Local draft · demo only' : 'Select a key to begin'}</text>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12 }}>
      <Button palette={p} variant="quiet" label="Undo draft edit" testId="undo-draft" disabled={!editable || !state.past.length} onPress={() => send({ type: 'undo' })}>Undo</Button>
      <Button palette={p} variant="quiet" label="Redo draft edit" testId="redo-draft" disabled={!editable || !state.future.length} onPress={() => send({ type: 'redo' })}>Redo</Button>
      <Button palette={p} variant="quiet" label="Discard all staged draft changes" testId="discard-draft" disabled={!editable || !count} onPress={() => send({ type: 'discard' })}>Discard</Button>
      <Button palette={p} primary label={`Review ${count} staged changes`} testId="review-changes" disabled={disabled || !count || state.mode !== 'demo'} onPress={onReview} style={{ width: 192, marginLeft: compact ? 8 : 16 }}>{count ? `Review ${count} ${count === 1 ? 'change' : 'changes'}` : 'Review changes'}</Button>
    </div>
  </div>;
}
