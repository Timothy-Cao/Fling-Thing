export const GRID_COLS = 20;
export const GRID_ROWS = 15;
export const CELL_SIZE = 40;

export const BUILD_WIDTH = GRID_COLS * CELL_SIZE;
export const BUILD_HEIGHT = GRID_ROWS * CELL_SIZE;

export const STARTING_COINS = 500;

export const BLOCK_TYPES = [
  'ball', 'solid', 'ramp', 'curve', 'ice', 'bouncy',
  'fan', 'gravitypad', 'booster',
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
    description: 'Zero friction · 3🪙',
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
    description: 'Wind tunnel · 3🪙',
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
  booster: {
    name: 'Booster',
    cost: 8,
    color: '#ffeb3b',
    secondaryColor: '#ff9800',
    description: 'Speed kick pad · 8🪙',
    hotkey: '8',
    category: 'passive',
  },
  piston: {
    name: 'Piston',
    cost: 10,
    color: '#27ae60',
    secondaryColor: '#2ecc71',
    description: 'Punch on key · 10🪙',
    hotkey: 'q',
    category: 'powered',
  },
  blackhole: {
    name: 'Black Hole',
    cost: 12,
    color: '#2c003e',
    secondaryColor: '#8e44ad',
    description: 'Slingshot pull · 12🪙',
    hotkey: 'w',
    category: 'powered',
  },
  whitehole: {
    name: 'White Hole',
    cost: 12,
    color: '#fffde0',
    secondaryColor: '#f1c40f',
    description: 'Jet thruster · 12🪙',
    hotkey: 'd',
    category: 'powered',
  },
  portal: {
    name: 'Portal',
    cost: 15,
    color: '#00e5ff',
    secondaryColor: '#7c4dff',
    description: 'Teleport · keeps speed · 15🪙',
    hotkey: 'f',
    category: 'powered',
  },
  bomb: {
    name: 'Bomb',
    cost: 15,
    color: '#e67e22',
    secondaryColor: '#d35400',
    description: 'Boom! · 15🪙',
    hotkey: 'g',
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

// --- Ball ---
export const BALL_RADIUS = CELL_SIZE * 0.35;
export const BALL_RESTITUTION = 0.72;
export const BALL_FRICTION = 0.02;
export const BALL_DENSITY = 0.004;

// --- Surface tuning ---
export const BOUNCY_RESTITUTION = 1.6;       // amplifies bounces but bounded
export const ICE_FRICTION = 0.0;             // truly frictionless
export const CURVE_FRICTION = 0.005;
export const CURVE_RESTITUTION = 0.1;
export const SOLID_FRICTION = 0.2;
export const RAMP_FRICTION = 0.1;

// --- Gravity wells ---
export const GRAVITY_WELL_RADIUS = CELL_SIZE * 7;
export const GRAVITY_WELL_STRENGTH = 0.0018;
export const BLACKHOLE_CAPTURE_RADIUS = 0;   // capture removed for fun

// --- Forces ---
export const PISTON_FORCE = 0.06;
export const BOMB_FORCE = 0.11;

export const FAN_FORCE = 0.0022;
export const FAN_RANGE = CELL_SIZE * 8;

export const GRAVITY_PAD_STRENGTH = 0.0028;
export const GRAVITY_PAD_DURATION = 70;

export const PORTAL_RADIUS = CELL_SIZE * 0.45;
export const PORTAL_COOLDOWN = 18;
export const PORTAL_BOOST = 1.1;             // small speed bonus through portal

// White hole = directional jet
export const WHITEHOLE_RANGE = CELL_SIZE * 9;
export const WHITEHOLE_FORCE = 0.006;
export const WHITEHOLE_CONE = 0.85;          // dot threshold for "in front"

// Booster: instant directional kick on contact
export const BOOSTER_KICK = 22;              // target min-speed (px / matter unit)
export const BOOSTER_MULT = 1.4;             // multiply existing aligned speed
export const BOOSTER_COOLDOWN = 12;

// --- World / floor ---
export const FLOOR_THICKNESS = 400;
export const FLOOR_EXTEND_RIGHT = 5_000_000; // ~125,000m of safe floor
export const FLOOR_EXTEND_LEFT = 2000;
export const CEILING_HEIGHT = 8000;          // hard upper bound to keep ball in world

// --- Simulation tick ---
export const PHYSICS_HZ = 240;
export const PHYSICS_DT = 1000 / PHYSICS_HZ;
export const SUBSTEPS_PER_FRAME = 4;         // 60fps * 4 = 240Hz target
export const MAX_BALL_SPEED = 32;            // px per substep — well under cell size (40) to prevent tunneling

// --- End conditions ---
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
