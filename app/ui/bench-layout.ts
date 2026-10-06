import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '../model/layout';
/** Logical geometry, never a bitmap/text scale or a protocol slot map. */
export function benchLayout(width: number, height: number) {
  const compact = width < 1080 || height < 740;
  const unit = Math.max(48, Math.min(56, Math.floor((width - 192) / LAYOUT_WIDTH)));
  const contentWidth = Math.min(1120, width - (compact ? 64 : 128));
  const extraSpace = Math.max(0, height - (compact ? 680 : 780));
  return {
    compact, unit, contentWidth, headerHeight: 56, footerHeight: 64,
    boardWidth: LAYOUT_WIDTH * unit + 32, boardHeight: LAYOUT_HEIGHT * unit + 32,
    headerInset: compact ? 24 : 32, topGap: compact ? 16 : 24, contextHeight: 44,
    boardGap: (compact ? 8 : 20) + extraSpace / 2,
    captionGap: 12, captionHeight: 20, railGap: (compact ? 16 : 20) + extraSpace / 2,
    railHeight: compact ? 96 : 112, railPadding: compact ? 16 : 24,
    bottomGap: compact ? 10 : 20,
  };
}
export function railColumns(width: number, compact: boolean) {
  const gap = compact ? 16 : 24;
  const padding = compact ? 16 : 24;
  const available = width - padding * 2 - gap * 3 - 2;
  // Between the two reference sizes, give up surplus column space before
  // wrapping controls. The local action always retains at least 230 pixels.
  const expansion = compact ? 0 : Math.max(0, Math.min(1, (available - 814) / 116));
  const identity = 160 + Math.round(40 * expansion);
  const current = 144 + Math.round(32 * expansion);
  const target = compact ? Math.min(320, 280 + Math.max(0, available - 814) / 2) : 280 + Math.round(40 * expansion);
  return { gap, padding, identity, current, target, actions: available - identity - current - target };
}
