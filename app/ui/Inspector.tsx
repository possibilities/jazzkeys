import { useState } from 'react';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@gpuix/react';
import { KEY_ACTIONS, actionLabel, actionById } from '../model/actions';
import type { EditorState, EditorIntent } from '../model/editor';
import type { Appearance, Palette } from '../theme/tokens';
import { Button, Label, Paragraph } from './controls';
import { railColumns } from './bench-layout';
import { inspectorPresentation, physicalName } from './presentation';
const groups = ['Letters & numbers', 'Navigation & function', 'Modifiers'];
const items = groups.flatMap(group => KEY_ACTIONS.filter(action => action.group === group).map(action => action.id));
export function Inspector({ state, palette: p, appearance, width, compact, disabled = false, send }: { state: EditorState; palette: Palette; appearance: Appearance; width: number; compact: boolean; disabled?: boolean; send: (intent: EditorIntent) => void }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [focused, setFocused] = useState(false);
  const view = inspectorPresentation(state);
  const { key, pending, protection, same } = view;
  const editable = view.editable && !disabled;
  const cols = railColumns(width, compact);
  const column = { display: 'flex' as const, flexDirection: 'column' as const, gap: 8, flexShrink: 0, minWidth: 0 };
  return <div testId="mapping-rail" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: cols.gap, width, minHeight: compact ? 96 : 112, flexShrink: 0, padding: cols.padding, paddingTop: compact ? 12 : 12, paddingBottom: compact ? 12 : 12, borderWidth: 1, borderColor: p.border, borderRadius: 12, backgroundColor: p.surface }}>
    <div style={{ ...column, width: cols.identity, gap: 4 }}>
      <Label palette={p}>Physical key</Label>
      <text role="heading" aria-level={2} style={{ color: p.text, fontSize: 22, lineHeight: 28, fontWeight: 600 }}>{physicalName(key)}</text>
      <text style={{ color: p.secondary, fontSize: 12, lineHeight: 16 }}>{view.status}</text>
    </div>
    <div style={{ ...column, width: cols.current }}>
      <Label palette={p}>{view.currentLabel}</Label>
      <text style={{ color: p.text, fontSize: 14, lineHeight: 20, whiteSpace: 'normal' }}>{view.current}</text>
    </div>
    {protection ? <div style={{ ...column, flexGrow: 1, flexShrink: 1 }}>
      <text style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: 600 }}>This key stays unchanged</text>
      <Paragraph palette={p}>{protection}</Paragraph>
    </div> : <>
      <div style={{ ...column, width: cols.target }}>
        <Label palette={p}>Draft mapping</Label>
        <Combobox items={items} value={state.target} disabled={!editable} open={open && editable} onOpenChange={next => { setOpen(next); if (!next) setQuery(''); }} inputValue={query} onInputValueChange={setQuery} autoHighlight
          itemToStringValue={actionLabel} onValueChange={value => { if (typeof value === 'string') send({ type: 'choose-target', id: value }); }} style={{ width: cols.target, position: 'relative' }}>
          <ComboboxInput testId="target-input" role="combobox" aria-label="Draft mapping. Map physical key to supported keyboard action" aria-description={`Selected draft mapping: ${actionLabel(state.target)}`} placeholder={actionLabel(state.target)} tabIndex={editable ? 0 : -1}
            onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setOpen(false); setQuery(''); }}
            style={{ width: cols.target, height: 40, paddingLeft: 12, paddingRight: 30, borderRadius: 7, borderWidth: 1, borderColor: focused ? p.focus : p.controlStroke, backgroundColor: p.surface, color: p.text, fontSize: 14 }}
            theme={{ appearance, text: p.text, bg: p.surface, textMuted: editable ? p.text : p.secondary, accent: p.focus }} />
          <text style={{ pointerEvents: 'none', position: 'absolute', right: 12, top: 11, fontSize: 14, lineHeight: 18, color: p.secondary }}>⌄</text>
          <ComboboxContent style={{ width: cols.target, maxHeight: 256, padding: 6, borderRadius: 10, borderWidth: 1, borderColor: p.controlStroke, backgroundColor: p.surface }} side="top" align="start" sideOffset={6}>
            <ComboboxList style={{ maxHeight: 242, overflowY: 'scroll', display: 'flex', flexDirection: 'column' }}>
              {(id: string) => <ComboboxItem key={id} value={id} testId={`target-${id}`} role="option" aria-label={actionLabel(id)} style={({ highlighted }) => ({ minHeight: 44, padding: 8, borderRadius: 5, backgroundColor: highlighted ? p.subtle : p.surface })}>
                {({ selected }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><text style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: selected ? 600 : 400, whiteSpace: 'normal' }}>{actionLabel(id)}</text><text style={{ color: p.secondary, fontSize: 11, lineHeight: 14 }}>{actionById(id)?.group}</text></div>}
              </ComboboxItem>}
            </ComboboxList>
            <ComboboxEmpty><text style={{ color: p.secondary, fontSize: 14, lineHeight: 20, padding: 10 }}>No supported actions match</text></ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      </div>
      <div style={{ ...column, width: Math.max(160, cols.actions), alignItems: 'center', paddingTop: 24, gap: 0 }}>
        {!editable && state.mode === 'read-only' ? <Paragraph palette={p}>Read-only · staging unavailable</Paragraph>
          : same ? <text role="status" style={{ color: p.secondary, fontSize: 14, lineHeight: 20, minHeight: pending ? 20 : 40 }}>{pending ? '✓ Staged' : 'No change to stage'}</text>
          : <Button palette={p} label={`${view.action} locally`} testId="stage-change" disabled={!editable} onPress={() => send({ type: 'stage' })} style={{ minWidth: 144 }}>{view.action}</Button>}
        {pending && same ? <Button palette={p} variant="quiet" label="Remove staged change for selected key" testId="remove-change" disabled={!editable} onPress={() => send({ type: 'remove-change', id: key.id })} style={{ height: 24, minHeight: 24, paddingLeft: 4, paddingRight: 4 }}>Remove change</Button> : null}
      </div>
    </>}
  </div>;
}
