import { PlacedBlock } from './types';

export interface Template {
  id: string;
  name: string;
  blurb: string;
  blocks: PlacedBlock[];
}

// Grid is 20 cols x 15 rows. Ball must be placed.
// Templates intentionally use a *subset* of blocks each so each one shows off
// a different mechanic, and they all fit comfortably under the starting coin
// budget (500g).

export const TEMPLATES: Template[] = [
  {
    id: 'cannonball',
    name: 'Cannonball',
    blurb: 'Ramp + booster lane. Easy 500m.',
    blocks: [
      { type: 'ball', col: 1, row: 11, rotation: 0 },
      { type: 'solid', col: 1, row: 13, rotation: 0 },
      { type: 'solid', col: 2, row: 13, rotation: 0 },
      { type: 'ramp', col: 3, row: 13, rotation: 0 },
      { type: 'ice', col: 4, row: 14, rotation: 0 },
      { type: 'ice', col: 5, row: 14, rotation: 0 },
      { type: 'booster', col: 7, row: 14, rotation: 1 },
      { type: 'ice', col: 9, row: 14, rotation: 0 },
      { type: 'ice', col: 10, row: 14, rotation: 0 },
      { type: 'booster', col: 12, row: 14, rotation: 1 },
      { type: 'ice', col: 14, row: 14, rotation: 0 },
      { type: 'booster', col: 17, row: 14, rotation: 1 },
    ],
  },
  {
    id: 'portal-slingshot',
    name: 'Portal Slingshot',
    blurb: 'Bottom portal flings you out the top. Hit F to chain.',
    blocks: [
      { type: 'ball', col: 1, row: 2, rotation: 0 },
      { type: 'ramp', col: 2, row: 4, rotation: 0 },
      { type: 'ice', col: 3, row: 5, rotation: 0 },
      { type: 'ice', col: 4, row: 6, rotation: 0 },
      { type: 'portal', col: 6, row: 7, rotation: 0 },
      { type: 'portal', col: 14, row: 1, rotation: 0 },
      { type: 'gravitypad', col: 14, row: 3, rotation: 1 },
      { type: 'booster', col: 18, row: 2, rotation: 1 },
      { type: 'solid', col: 14, row: 4, rotation: 0 },
      { type: 'solid', col: 15, row: 4, rotation: 0 },
      { type: 'solid', col: 16, row: 4, rotation: 0 },
    ],
  },
  {
    id: 'wind-tunnel',
    name: 'Wind Tunnel',
    blurb: 'Fan chorus pushes a slow drop into a freight train.',
    blocks: [
      { type: 'ball', col: 1, row: 3, rotation: 0 },
      { type: 'fan', col: 0, row: 4, rotation: 1 },
      { type: 'fan', col: 0, row: 5, rotation: 1 },
      { type: 'fan', col: 0, row: 6, rotation: 1 },
      { type: 'curve', col: 5, row: 6, rotation: 0 },
      { type: 'solid', col: 5, row: 7, rotation: 0 },
      { type: 'ice', col: 6, row: 7, rotation: 0 },
      { type: 'ice', col: 7, row: 7, rotation: 0 },
      { type: 'ice', col: 8, row: 7, rotation: 0 },
      { type: 'booster', col: 10, row: 7, rotation: 1 },
      { type: 'ice', col: 12, row: 7, rotation: 0 },
      { type: 'ramp', col: 14, row: 7, rotation: 3 },
      { type: 'fan', col: 16, row: 4, rotation: 2 },
    ],
  },
  {
    id: 'bouncy-highway',
    name: 'Bouncy Highway',
    blurb: 'Bounce off elastic blocks. Hit Q-key pistons to launch.',
    blocks: [
      { type: 'ball', col: 1, row: 6, rotation: 0 },
      { type: 'piston', col: 0, row: 7, rotation: 1 },
      { type: 'bouncy', col: 4, row: 10, rotation: 0 },
      { type: 'bouncy', col: 7, row: 12, rotation: 0 },
      { type: 'bouncy', col: 10, row: 9, rotation: 0 },
      { type: 'bouncy', col: 13, row: 13, rotation: 0 },
      { type: 'ramp', col: 16, row: 13, rotation: 3 },
      { type: 'booster', col: 18, row: 12, rotation: 1 },
    ],
  },
];
