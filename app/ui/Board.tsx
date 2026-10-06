import { useRef } from 'react';
import { useGpuix, type PublicInstance } from '@gpuix/react';
import { DEMO_LAYOUT, adjacentKey, LAYOUT_HEIGHT, LAYOUT_WIDTH, type Direction } from '../model/layout';
import type { EditorState } from '../model/editor';
import type { Palette } from '../theme/tokens';
import { Keycap } from './Keycap';
import { keySpokenLabel } from './presentation';
export function Board({ state, palette: p, unit = 56, onSelect, onFocusId, inactive = false }: { state: EditorState; palette: Palette; unit?: number; onSelect: (id: string) => void; onFocusId?: (nativeId: number) => void; inactive?: boolean }) {
  const { renderer } = useGpuix(); const refs = useRef(new Map<string, PublicInstance>());
  const fnLayer = state.layer === 'fn';
  return <div testId="keyboard-case" role="group" aria-label="Illustrative demo keyboard. Physical slots unverified. Arrow keys move between physical keys."
    style={{ position: 'relative', borderRadius: 18, backgroundColor: p.frame, borderWidth: 1, borderColor: p.caseEdge, width: LAYOUT_WIDTH * unit + 32, height: LAYOUT_HEIGHT * unit + 32, flexShrink: 0 }}>
    <div style={{ pointerEvents: 'none', position: 'absolute', left: 9, right: 9, top: 9, bottom: 9, borderRadius: 12, backgroundColor: p.keyWell }} />
    <div style={{ position: 'absolute', left: 15, top: 15, width: LAYOUT_WIDTH * unit, height: LAYOUT_HEIGHT * unit }}>
      {DEMO_LAYOUT.map(key => <Keycap key={key.id} physicalKey={key} palette={p} unit={unit} selected={state.selected === key.id && state.mode !== 'disconnected'}
        staged={fnLayer ? undefined : state.draft[key.id]} protectedKey={Boolean(key.protection) || fnLayer} inactive={inactive} label={keySpokenLabel(state, key)}
        ref={node => { if (node) refs.current.set(key.id, node); else refs.current.delete(key.id); }}
        onPress={() => onSelect(key.id)} onFocus={() => { if (!inactive) { const instance = refs.current.get(key.id); if (instance) onFocusId?.(instance.id); onSelect(key.id); } }}
        onKeyDown={event => {
          if (!['left', 'right', 'up', 'down'].includes(event.key ?? '')) return;
          const id = adjacentKey(key.id, event.key as Direction); onSelect(id);
          const instance = refs.current.get(id); if (instance) renderer?.focusElement?.(instance.id);
        }} />)}
    </div>
  </div>;
}
export function BoardCaption({ palette: p, width }: { palette: Palette; width: number }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width, minHeight: 20, flexShrink: 0 }}>
    <text style={{ color: p.secondary, fontSize: 12, lineHeight: 18 }}>Illustrative layout · physical slots unverified</text>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 5, height: 5, borderRadius: 1, backgroundColor: p.caution }} />
      <text style={{ color: p.secondary, fontSize: 12, lineHeight: 18 }}>Staged</text>
      <text style={{ color: p.secondary, fontSize: 12, lineHeight: 18, marginLeft: 16 }}>− Protected</text>
    </div>
  </div>;
}
