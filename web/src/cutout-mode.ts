export type CutoutMode = 'none' | 'boroughs' | 'land';

export function cutoutMode(value: string | null): CutoutMode {
  return value === 'boroughs' || value === 'land' ? value : 'none';
}
