import { useRef } from 'react';
import { useGpuix, type PublicInstance } from '@gpuix/react';
import { DEMO_LAYOUT, adjacentKey, LAYOUT_HEIGHT, LAYOUT_WIDTH, type Direction } from '../model/layout';
import { actionLabel, actionShort } from '../model/actions';
import type { EditorState } from '../model/editor';
import type { Palette } from '../theme/tokens';
import { Button, Paragraph } from './controls';
const UNIT = 43;
export function Board({ state, palette: p, onSelect, onFocusId, inactive = false }: { state: EditorState; palette: Palette; onSelect: (id: string) => void; onFocusId?: (nativeId: number) => void; inactive?: boolean }) {
  const { renderer } = useGpuix(); const refs = useRef(new Map<string, PublicInstance>());
  const fnLayer = state.layer === 'fn';
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
    <div role="group" aria-label="Provisional demo keyboard. Arrow keys move between physical keys. Enter selects a key." style={{ padding: 17, borderRadius: 17, backgroundColor: p.frame, borderWidth: 1, borderColor: p.border, width: LAYOUT_WIDTH * UNIT + 34, height: LAYOUT_HEIGHT * UNIT + 34, flexShrink: 0 }}>
      <div style={{ position: 'relative', width: LAYOUT_WIDTH * UNIT, height: LAYOUT_HEIGHT * UNIT }}>
        {DEMO_LAYOUT.map(key => {
          const pending = state.draft[key.id], selected = state.selected === key.id;
          const protectedKey = Boolean(key.protection) || fnLayer;
          return <Button key={key.id} ref={node => { if (node) refs.current.set(key.id, node); else refs.current.delete(key.id); }} palette={p}
            label={`${key.legend}, physical key. ${fnLayer ? 'Fn layer unavailable' : `Current mapping ${actionLabel(state.baseline[key.id]!)}`}${pending ? `. Pending ${actionLabel(pending)}` : ''}${protectedKey ? '. Protected' : ''}`}
            description={key.protection} selected={selected} testId={`key-${key.id}`} tabIndex={selected ? 0 : -1} disabled={inactive}
            onPress={() => onSelect(key.id)} onFocus={() => { if (!inactive) { const instance = refs.current.get(key.id); if (instance) onFocusId?.(instance.id); onSelect(key.id); } }}
            onKeyDown={event => {
              if (!['left', 'right', 'up', 'down'].includes(event.key ?? '')) return;
              const id = adjacentKey(key.id, event.key as Direction); onSelect(id);
              const instance = refs.current.get(id); if (instance) renderer?.focusElement?.(instance.id);
            }}
            style={{ position: 'absolute', left: key.x * UNIT, top: key.y * UNIT, width: key.width * UNIT - 5, height: UNIT - 5, minHeight: 0, paddingLeft: 2, paddingRight: 2, paddingTop: 2, paddingBottom: 2,
              backgroundColor: selected ? p.selected : key.y === 0 || key.width > 1 || protectedKey ? p.keyAlternate : p.key,
              borderColor: selected ? p.accent : p.border, borderWidth: selected ? 2 : 1, borderRadius: key.id === 'knob' ? 19 : 6, flexDirection: 'column', gap: 1 }}>
            <text style={{ color: p.text, fontWeight: selected ? 700 : 500, fontSize: key.legend.length > 5 ? 12 : 13, width: key.width * UNIT - 13, whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 16 }}>{key.legend}</text>
            {pending ? <text style={{ color: p.accent, fontSize: 9, fontWeight: 700, width: key.width * UNIT - 13, whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 10 }}>{`• ${actionShort(pending)}`}</text> : protectedKey ? <text style={{ color: p.secondary, fontSize: 8, width: key.width * UNIT - 13, whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 10 }}>—</text> : null}
          </Button>;
        })}
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <Paragraph palette={p} small>Illustrative layout · physical slots unverified</Paragraph>
      <text style={{ color: p.secondary, fontSize: 12 }}>• Pending    — Protected</text>
    </div>
  </div>;
}
