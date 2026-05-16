import { BlockType } from './constants';

export interface PlacedBlock {
  type: BlockType;
  col: number;
  row: number;
  rotation: number; // 0, 1, 2, 3 = 0°, 90°, 180°, 270°
}

export type GameMode = 'edit' | 'running' | 'results';

export interface Camera {
  x: number;
  y: number;
}
