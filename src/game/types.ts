import { BlockType } from './constants';

export interface PlacedBlock {
  type: BlockType;
  col: number;
  row: number;
  rotation: number; // 0, 1, 2, 3 = 0°, 90°, 180°, 270°
  group: number; // 1-9, only meaningful for powered blocks
}

export type GameMode = 'edit' | 'running' | 'results';

export interface Camera {
  x: number;
  y: number;
}
