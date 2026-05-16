export const GRID_COLS = 20;
export const GRID_ROWS = 15;
export const CELL_SIZE = 40;

export const BUILD_WIDTH = GRID_COLS * CELL_SIZE;
export const BUILD_HEIGHT = GRID_ROWS * CELL_SIZE;

export const STARTING_COINS = 500;

export const BLOCK_TYPES = [
  'ball', 'solid', 'ramp', 'curve', 'ice', 'bouncy',
  'fan', 'gravitypad',
  'piston', 'blackhole', 'whitehole', 'portal', 'bomb',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type BlockCategory = 'passive' | 'powered' | 'special';

export interface BlockConfig {
  name: string;
  cost: number;
  color: string;
  secondaryColor?: string;
  description: string;
  hotkey: string;
  category: BlockCategory;
}

export const BLOCK_CONFIGS: Record<BlockType, BlockConfig> = {
  ball: {
    name: 'Ball',
    cost: 0,
    color: '#e94560',
    secondaryColor: '#ff6b81',
    description: 'Place to start',
    hotkey: '0',
    category: 'special',
  },
  solid: {
    name: 'Solid',
    cost: 1,
    color: '#7f8c8d',
    description: '1st free · then 1🪙',
    hotkey: '1',
    category: 'passive',
  },
  ramp: {
    name: 'Ramp',
    cost: 2,
    color: '#3498db',
    description: '1st free · then 2🪙',
    hotkey: '2',
    category: 'passive',
  },
  curve: {
    name: 'Curve',
    cost: 2,
    color: '#9b59b6',
    description: 'Smooth ramp · 2🪙',
    hotkey: '3',
    category: 'passive',
  },
  ice: {
    name: 'Ice',
    cost: 3,
    color: '#85e0ff',
    secondaryColor: '#aaeeff',
    description: '1st free · then 3🪙',
    hotkey: '4',
    category: 'passive',
  },
  bouncy: {
    name: 'Bouncy',
    cost: 5,
    color: '#e74c3c',
    secondaryColor: '#f39c12',
    description: 'Super bounce · 5🪙',
    hotkey: '5',
    category: 'passive',
  },
  fan: {
    name: 'Fan',
    cost: 3,
    color: '#26c6da',
    secondaryColor: '#80deea',
    description: 'Strong wind · 3🪙',
    hotkey: '6',
    category: 'passive',
  },
  gravitypad: {
    name: 'Grav Pad',
    cost: 6,
    color: '#ff4081',
    secondaryColor: '#f50057',
    description: 'Redirect gravity · 6🪙',
    hotkey: '7',
    category: 'passive',
  },
  piston: {
    name: 'Piston',
    cost: 10,
    color: '#27ae60',
    secondaryColor: '#2ecc71',
    description: 'Push on key · 10🪙',
    hotkey: 'q',
    category: 'powered',
  },
  blackhole: {
    name: 'Black Hole',
    cost: 12,
    color: '#2c003e',
    secondaryColor: '#8e44ad',
    description: 'Gravity pull · 12🪙',
    hotkey: 'w',
    category: 'powered',
  },
  whitehole: {
    name: 'White Hole',
    cost: 12,
    color: '#fffde0',
    secondaryColor: '#f1c40f',
    description: 'Gravity push · 12🪙',
    hotkey: 'e',
    category: 'powered',
  },
  portal: {
    name: 'Portal',
    cost: 15,
    color: '#00e5ff',
    secondaryColor: '#7c4dff',
    description: 'Teleport pair · 15🪙',
    hotkey: 'r',
    category: 'powered',
  },
  bomb: {
    name: 'Bomb',
    cost: 15,
    color: '#e67e22',
    secondaryColor: '#d35400',
    description: 'Boom! · 15🪙',
    hotkey: 't',
    category: 'powered',
  },
};

export const POWERED_TYPES: BlockType[] = ['piston', 'blackhole', 'whitehole', 'portal', 'bomb'];

export const POWERED_KEY_MAP: Record<string, BlockType> = {
  '1': 'piston',
  '2': 'blackhole',
  '3': 'whitehole',
  '4': 'portal',
  '5': 'bomb',
};

export const POWERED_TYPE_KEY: Record<string, string> = {
  piston: '1',
  blackhole: '2',
  whitehole: '3',
  portal: '4',
  bomb: '5',
};

export const BALL_RADIUS = CELL_SIZE * 0.35;
export const BALL_RESTITUTION = 0.7;
export const BALL_FRICTION = 0.05;
export const BALL_DENSITY = 0.004;

export const BOUNCY_RESTITUTION = 2.0;
export const ICE_FRICTION = 0.001;
export const CURVE_FRICTION = 0.02;
export const CURVE_RESTITUTION = 0.05;

export const GRAVITY_WELL_RADIUS = CELL_SIZE * 6;
export const GRAVITY_WELL_STRENGTH = 0.001;
export const BLACKHOLE_CAPTURE_RADIUS = CELL_SIZE * 0.5;

export const PISTON_FORCE = 0.035;
export const BOMB_FORCE = 0.08;

export const FAN_FORCE = 0.0008;
export const FAN_RANGE = CELL_SIZE * 6;

export const GRAVITY_PAD_STRENGTH = 0.003;
export const GRAVITY_PAD_DURATION = 180; // 3 seconds at 60fps

export const PORTAL_RADIUS = CELL_SIZE * 0.45;
export const PORTAL_COOLDOWN = 30; // frames before re-teleport

export const FLOOR_THICKNESS = 40;
export const FLOOR_EXTEND_RIGHT = 50000;

export const VELOCITY_THRESHOLD = 0.1;
export const STILL_FRAMES_REQUIRED = 150;

export const CAMERA_LERP = 0.05;

export const COLORS = {
  sky1: '#0f0c29',
  sky2: '#1a1a3e',
  sky3: '#16213e',
  floor: '#2c3e50',
  floorTop: '#34495e',
  floorStripe: '#253646',
  gridLine: 'rgba(255,255,255,0.06)',
  buildBorder: 'rgba(233, 69, 96, 0.3)',
  buildLabel: 'rgba(233, 69, 96, 0.3)',
  distanceMarker: 'rgba(255, 215, 0, 0.2)',
  distanceText: 'rgba(255, 215, 0, 0.3)',
  hoverValid: 'rgba(255, 255, 255, 0.15)',
  hoverInvalid: 'rgba(255, 0, 0, 0.15)',
};
