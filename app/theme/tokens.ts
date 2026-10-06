export type Appearance = 'light' | 'dark';
export interface Palette { canvas: string; surface: string; text: string; secondary: string; accent: string; onAccent: string; border: string; subtle: string; selected: string; caution: string; cautionSurface: string; error: string; key: string; keyAlternate: string; frame: string }
export const palettes: Record<Appearance, Palette> = {
  light: { canvas: '#F3F4EF', surface: '#FFFFFF', text: '#17271E', secondary: '#4F6155', accent: '#256341', onAccent: '#FFFFFF', border: '#CBD5C8', subtle: '#E8EDE4', selected: '#DCEBDB', caution: '#725015', cautionSurface: '#F6EBD1', error: '#A12F37', key: '#FDFEF9', keyAlternate: '#DCE5D4', frame: '#BAC9B3' },
  dark: { canvas: '#111A16', surface: '#1A2520', text: '#EDF3EA', secondary: '#BAC8BC', accent: '#A8D5AF', onAccent: '#14251A', border: '#435848', subtle: '#223229', selected: '#294B35', caution: '#E9CB83', cautionSurface: '#342C1A', error: '#F2A1A7', key: '#25362A', keyAlternate: '#354B38', frame: '#0A120D' },
};
export const FONT = process.platform === 'darwin' ? '.AppleSystemUIFont' : 'sans-serif';
