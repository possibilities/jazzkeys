import { useState } from 'react';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@gpuix/react';
import { KEY_ACTIONS, actionLabel, actionById } from '../model/actions';
import { physicalKey } from '../model/layout';
import { canEdit, type EditorState, type EditorIntent } from '../model/editor';
import type { Palette } from '../theme/tokens';
import { Button, Label, Paragraph } from './controls';
const groups = ['Letters & numbers', 'Navigation & function', 'Modifiers'];
const items = groups.flatMap(group => KEY_ACTIONS.filter(action => action.group === group).map(action => action.id));
export function Inspector({ state, palette: p, send }: { state: EditorState; palette: Palette; send: (intent: EditorIntent) => void }) {
  const key = physicalKey(state.selected)!;
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [focused, setFocused] = useState(false);
  const protectedReason = state.layer === 'fn' ? 'The Fn layer has no verified read or write path. It stays unavailable.' : key.protection;
  const editable = canEdit(state) && !protectedReason;
  const pending = state.draft[key.id];
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 19, minWidth: 250, flexGrow: 1 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <Label palette={p}>PHYSICAL KEY</Label>
      <text role="heading" aria-level={2} style={{ color: p.text, fontSize: 28, fontWeight: 600 }}>{key.legend}</text>
      <text style={{ color: p.secondary, fontSize: 13 }}>{pending ? '• Pending change' : protectedReason ? '— Protected' : 'Base layer · demo'}</text>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 17, borderTopWidth: 1, borderColor: p.border }}>
      <Label palette={p}>CURRENT MAPPING</Label>
      <text style={{ color: p.text, fontSize: 17, fontWeight: 500 }}>{state.layer === 'fn' ? 'Not read' : actionLabel(state.baseline[key.id]!)}</text>
    </div>
    {protectedReason ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 15, backgroundColor: p.subtle, borderRadius: 8 }}>
      <text style={{ color: p.text, fontSize: 14, fontWeight: 600 }}>This key stays unchanged</text><Paragraph palette={p} small>{protectedReason}</Paragraph>
    </div> : <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label palette={p}>MAP TO</Label>
        <Combobox key={key.id} items={items} value={state.target} disabled={!editable} open={open && editable} onOpenChange={setOpen} inputValue={query} onInputValueChange={setQuery} autoHighlight
          itemToStringValue={actionLabel} onValueChange={value => { if (typeof value === 'string') send({ type: 'choose-target', id: value }); }} style={{ width: '100%' }}>
          <ComboboxInput testId="target-input" role="combobox" aria-label="Map physical key to supported keyboard action" placeholder={actionLabel(state.target)} tabIndex={editable ? 0 : -1}
            onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setOpen(false); }}
            style={{ height: 44, padding: 11, borderRadius: 7, borderWidth: 2, borderColor: focused ? p.accent : p.border, backgroundColor: p.surface, color: p.text, fontSize: 14 }}
            theme={{ appearance: p.canvas === '#111A16' ? 'dark' : 'light', text: p.text, bg: p.surface, textMuted: p.secondary, accent: p.accent }} />
          <ComboboxContent style={{ width: 310, maxHeight: 250, padding: 6, borderRadius: 9, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }} side="bottom" align="start" sideOffset={5}>
            <ComboboxList style={{ maxHeight: 236, overflowY: 'scroll', display: 'flex', flexDirection: 'column' }}>
              {(id: string) => <ComboboxItem key={id} value={id} testId={`target-${id}`} role="option" aria-label={actionLabel(id)} style={({ highlighted, selected }) => ({ padding: 9, borderRadius: 5, backgroundColor: highlighted || selected ? p.selected : p.surface })}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><text style={{ color: p.text, fontSize: 14 }}>{actionLabel(id)}</text><text style={{ color: p.secondary, fontSize: 11 }}>{actionById(id)?.group}</text></div>
              </ComboboxItem>}
            </ComboboxList>
            <ComboboxEmpty><text style={{ color: p.secondary, fontSize: 14, padding: 10 }}>No supported actions match</text></ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
        <Paragraph palette={p} small>{`Selected target: ${actionLabel(state.target)}`}</Paragraph>
      </div>
      <Button palette={p} primary label="Stage change locally" testId="stage-change" disabled={!editable || state.target === (pending ?? state.baseline[key.id])} onPress={() => send({ type: 'stage' })}>Stage change</Button>
      {pending ? <Button palette={p} label="Remove pending change for selected key" disabled={!editable} onPress={() => send({ type: 'remove-change', id: key.id })}>Remove pending change</Button> : null}
      <Paragraph palette={p} small>Changes stay here until you review and simulate applying them</Paragraph>
    </>}
  </div>;
}
