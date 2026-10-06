import { expect, test } from 'bun:test';
import { palettes } from './tokens';
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
function contrast(a: string, b: string): number { const aa = luminance(a), bb = luminance(b); return (Math.max(aa, bb) + .05) / (Math.min(aa, bb) + .05); }
for (const [appearance, p] of Object.entries(palettes)) {
  test(`${appearance} actual text roles meet 4.5:1 on their solid surfaces`, () => {
    for (const surface of [p.canvas, p.surface, p.subtle]) {
      expect(contrast(p.text, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.secondary, surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const face of [p.key, p.keyAlternate, p.keyHover, p.keyAlternateHover]) {
      expect(contrast(p.text, face)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.caution, face)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onSelected, p.selected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.caution, p.cautionSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.error, p.surface)).toBeGreaterThanOrEqual(4.5);
  });
  test(`${appearance} essential control boundaries and separate focus reach 3:1`, () => {
    expect(contrast(p.controlStroke, p.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.focus, p.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.focus, p.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.boardFocus, p.keyWell)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.boardFocus, p.frame)).toBeGreaterThanOrEqual(3);
  });
}
