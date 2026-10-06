import { forwardRef } from 'react';
import type { PublicInstance, EventPayload } from '@gpuix/react';
import type { PhysicalKey } from '../model/layout';
import { actionShort } from '../model/actions';
import type { Palette } from '../theme/tokens';
import { Button } from './controls';
interface KeycapProps {
  physicalKey: PhysicalKey; palette: Palette; unit: number; selected: boolean; staged?: string;
  protectedKey: boolean; inactive: boolean; label: string; onPress: () => void; onFocus: () => void;
  onKeyDown: (event: EventPayload) => void;
}
/** The hit rectangle is fixed; edge, selection and focus are independent native shapes. */
export const Keycap = forwardRef<PublicInstance, KeycapProps>(function Keycap({ physicalKey: key, palette: p, unit, selected, staged, protectedKey, inactive, label, onPress, onFocus, onKeyDown }, ref) {
  const width = key.width * unit - 6, height = unit - 6;
  const alternate = key.y === 0 || key.width > 1 || protectedKey;
  const radius = key.id === 'knob' ? height / 2 : 6;
  return <Button ref={ref} palette={p} variant="key" label={label} description={key.protection}
    selected={selected} testId={`key-${key.id}`} tabIndex={selected ? 0 : -1} disabled={inactive}
    onPress={onPress} onFocus={onFocus} onKeyDown={onKeyDown}
    style={{ position: 'absolute', left: key.x * unit, top: key.y * unit, width, height, minHeight: 0, padding: 0, borderWidth: 0, borderRadius: radius, backgroundColor: 'transparent', overflow: 'visible' }}>
    {({ focused, hovered }) => <>
      {focused ? <div style={{ pointerEvents: 'none', position: 'absolute', left: -3, right: -3, top: -3, bottom: -3, borderRadius: radius + 3, borderWidth: 2, borderColor: p.boardFocus, backgroundColor: p.keyWell }} /> : null}
      <div style={{ pointerEvents: 'none', position: 'absolute', left: 0, top: 0, width, height, borderRadius: radius, backgroundColor: selected ? p.selected : p.keyEdge }} />
      <div style={{ pointerEvents: 'none', position: 'absolute', left: 0, top: 0, width, height: height - 2, borderRadius: radius, borderWidth: 2, borderColor: selected ? p.selected : 'transparent',
        backgroundColor: selected ? p.selected : hovered ? alternate ? p.keyAlternateHover : p.keyHover : alternate ? p.keyAlternate : p.key,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: staged ? 2 : 0 }}>
        <text style={{ color: selected ? p.onSelected : p.text, fontSize: key.legend.length > 4 ? 12 : 15, lineHeight: staged ? 18 : 20, fontWeight: selected ? 600 : 500, width: width - 6, whiteSpace: 'nowrap', textAlign: 'center' }}>{key.legend}</text>
        {staged ? <text style={{ color: selected ? p.onSelected : p.caution, fontSize: 11, lineHeight: 14, fontWeight: 500, width: width - 6, whiteSpace: 'nowrap', textAlign: 'center' }}>{actionShort(staged)}</text> : null}
        {staged ? <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: 1, backgroundColor: selected ? p.onSelected : p.caution }} /> : null}
        {protectedKey ? <text style={{ position: 'absolute', bottom: 1, color: selected ? p.onSelected : p.text, fontSize: 11, lineHeight: 12, textAlign: 'center' }}>−</text> : null}
      </div>
    </>}
  </Button>;
});
