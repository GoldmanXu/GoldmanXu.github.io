// Uniform warm ivory particles.
export type ThemeName = 'light' | 'dark';
export type PaletteName = 'coast';
export interface Look {
  points: [string, number][];
  particleGain: number;
  additive: boolean;
  pointSize: number;
}
const coast: Look = {
  points: [
    ['#fffaf0', 1],
  ],
  particleGain: 1,
  additive: false,
  pointSize: 0.042,
};
export const PALETTES: Record<PaletteName, Record<ThemeName, Look>> = {
  coast: { light: coast, dark: coast },
};
export const DEFAULT_PALETTE: PaletteName = 'coast';
export const isPalette = (value: unknown): value is PaletteName => value === 'coast';
