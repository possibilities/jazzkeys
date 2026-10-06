export type Appearance = 'light' | 'dark';
export interface Palette {
  canvas: string; surface: string; text: string; secondary: string;
  accent: string; onAccent: string; selected: string; onSelected: string;
  border: string; controlStroke: string; subtle: string;
  caution: string; cautionSurface: string; error: string;
  key: string; keyAlternate: string; keyHover: string; keyAlternateHover: string; keyEdge: string;
  frame: string; caseEdge: string; keyWell: string; focus: string; boardFocus: string;
}
export const palettes: Record<Appearance, Palette> = {
  light: {
    canvas: '#F3F1EB', surface: '#FBF9F4', text: '#212923', secondary: '#5C655F',
    accent: '#24593D', onAccent: '#F8FBF5', selected: '#24593D', onSelected: '#F8FBF5',
    border: '#CFD3C8', controlStroke: '#7B847A', subtle: '#E8E7DE',
    caution: '#805615', cautionSurface: '#F3E8CB', error: '#A43D39',
    key: '#FEFDF8', keyAlternate: '#E4E8DD', keyHover: '#F0F3E9', keyAlternateHover: '#D5DDCD', keyEdge: '#C6CEC0',
    frame: '#43564A', caseEdge: '#304137', keyWell: '#34473B', focus: '#174D85', boardFocus: '#BADDFF',
  },
  dark: {
    canvas: '#171C19', surface: '#202722', text: '#EDF1E8', secondary: '#B6C1B6',
    accent: '#A9CAA3', onAccent: '#152D1D', selected: '#A9CAA3', onSelected: '#152D1D',
    border: '#3D4B40', controlStroke: '#819484', subtle: '#29322B',
    caution: '#E8C77B', cautionSurface: '#423821', error: '#FFACA4',
    key: '#334238', keyAlternate: '#435342', keyHover: '#3C4B40', keyAlternateHover: '#3B4B3C', keyEdge: '#4E6252',
    frame: '#101A14', caseEdge: '#283D2E', keyWell: '#0D1510', focus: '#9BCBFF', boardFocus: '#9BCBFF',
  },
};
export const FONT = process.platform === 'darwin' ? '.AppleSystemUIFont' : 'sans-serif';
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { key: 6, control: 7, popup: 10, rail: 12, frame: 18 } as const;
