import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  BUILD_WIDTH,
  BUILD_HEIGHT,
  BALL_RADIUS,
  BLOCK_CONFIGS,
  COLORS,
  POWERED_TYPES,
  POWERED_TYPE_KEY,
  FAN_RANGE,
  WHITEHOLE_RANGE,
  BlockType,
} from './constants';
import { PlacedBlock, Camera } from './types';
import type { SimulationState } from './physics';

let starsCache: { x: number; y: number; size: number; brightness: number }[] | null = null;
let mountainsCache: { peaks: number[]; color: string; parallax: number }[] | null = null;
let treesCache: { x: number; h: number; w: number; parallax: number; shade: number }[] | null = null;

function getStars(w: number, h: number) {
  if (starsCache && starsCache.length > 0) return starsCache;
  starsCache = [];
  for (let i = 0; i < 100; i++) {
    starsCache.push({
      x: Math.random() * w * 2,
      y: Math.random() * h * 0.5,
      size: Math.random() * 1.5 + 0.5,
      brightness: Math.random() * 0.4 + 0.2,
    });
  }
  return starsCache;
}

function getMountains(w: number) {
  if (mountainsCache) return mountainsCache;
  mountainsCache = [];
  const layers = [
    { color: 'rgba(15, 20, 45, 0.9)', parallax: 0.05, count: 8, minH: 0.15, maxH: 0.3 },
    { color: 'rgba(20, 30, 60, 0.8)', parallax: 0.1, count: 10, minH: 0.1, maxH: 0.22 },
    { color: 'rgba(25, 40, 75, 0.6)', parallax: 0.15, count: 12, minH: 0.06, maxH: 0.15 },
  ];
  for (const layer of layers) {
    const peaks: number[] = [];
    const step = (w * 2) / layer.count;
    for (let i = 0; i <= layer.count + 2; i++) {
      peaks.push(layer.minH + Math.random() * (layer.maxH - layer.minH));
    }
    mountainsCache.push({ peaks, color: layer.color, parallax: layer.parallax });
  }
  return mountainsCache;
}

function getTrees(w: number) {
  if (treesCache) return treesCache;
  treesCache = [];
  for (let i = 0; i < 40; i++) {
    treesCache.push({
      x: Math.random() * w * 3,
      h: 20 + Math.random() * 35,
      w: 8 + Math.random() * 12,
      parallax: 0.2 + Math.random() * 0.1,
      shade: Math.random(),
    });
  }
  treesCache.sort((a, b) => a.parallax - b.parallax);
  return treesCache;
}

export function resetStarsCache() {
  starsCache = null;
  mountainsCache = null;
  treesCache = null;
}

export function getRampVertices(rotation: number, h: number): { x: number; y: number }[] {
  switch (rotation % 4) {
    case 0:
      return [{ x: -h, y: h }, { x: h, y: h }, { x: h, y: -h }];
    case 1:
      return [{ x: -h, y: -h }, { x: -h, y: h }, { x: h, y: h }];
    case 2:
      return [{ x: -h, y: -h }, { x: h, y: -h }, { x: -h, y: h }];
    case 3:
      return [{ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }];
    default:
      return [];
  }
}

export function getCurveVertices(rotation: number, h: number): { x: number; y: number }[] {
  const segments = 12;
  const r = 2 * h;
  const verts: { x: number; y: number }[] = [];

  let corners: { x: number; y: number }[];
  let arcCenter: { x: number; y: number };

  switch (rotation % 4) {
    case 0:
      corners = [{ x: -h, y: h }, { x: h, y: h }, { x: h, y: -h }];
      arcCenter = { x: -h, y: -h };
      break;
    case 1:
      corners = [{ x: -h, y: -h }, { x: -h, y: h }, { x: h, y: h }];
      arcCenter = { x: h, y: -h };
      break;
    case 2:
      corners = [{ x: h, y: -h }, { x: -h, y: -h }, { x: -h, y: h }];
      arcCenter = { x: h, y: h };
      break;
    case 3:
      corners = [{ x: h, y: h }, { x: h, y: -h }, { x: -h, y: -h }];
      arcCenter = { x: -h, y: h };
      break;
    default:
      corners = [{ x: -h, y: h }, { x: h, y: h }, { x: h, y: -h }];
      arcCenter = { x: -h, y: -h };
  }

  for (const c of corners) {
    verts.push(c);
  }

  const last = corners[corners.length - 1];
  const first = corners[0];
  const startAngle = Math.atan2(last.y - arcCenter.y, last.x - arcCenter.x);
  const endAngle = Math.atan2(first.y - arcCenter.y, first.x - arcCenter.x);

  let diff = endAngle - startAngle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  for (let i = 1; i < segments; i++) {
    const angle = startAngle + diff * (i / segments);
    verts.push({
      x: arcCenter.x + r * Math.cos(angle),
      y: arcCenter.y + r * Math.sin(angle),
    });
  }

  return verts;
}

export function drawBlockShape(
  ctx: CanvasRenderingContext2D,
  type: BlockType,
  x: number,
  y: number,
  rotation: number,
  alpha: number = 1,
) {
  const config = BLOCK_CONFIGS[type];
  ctx.save();
  ctx.globalAlpha = alpha;
  const cx = x + CELL_SIZE / 2;
  const cy = y + CELL_SIZE / 2;
  const h = CELL_SIZE / 2;

  switch (type) {
    case 'ball': {
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.arc(cx, cy, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = config.secondaryColor || config.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case 'solid':
      ctx.fillStyle = config.color;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      break;
    case 'ramp': {
      const verts = getRampVertices(rotation, h);
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.moveTo(cx + verts[0].x, cy + verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(cx + verts[i].x, cy + verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'curve': {
      const verts = getCurveVertices(rotation, h);
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.moveTo(cx + verts[0].x, cy + verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(cx + verts[i].x, cy + verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'ice':
      ctx.fillStyle = config.color;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = config.secondaryColor || config.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 4);
      ctx.lineTo(x + 14, y + 12);
      ctx.moveTo(x + 10, y + 4);
      ctx.lineTo(x + 18, y + 12);
      ctx.moveTo(x + CELL_SIZE - 12, y + CELL_SIZE - 6);
      ctx.lineTo(x + CELL_SIZE - 6, y + CELL_SIZE - 14);
      ctx.stroke();
      break;
    case 'bouncy':
      ctx.fillStyle = config.color;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = config.secondaryColor || '#f39c12';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 4, y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
      ctx.setLineDash([]);
      break;
    case 'fan': {
      ctx.fillStyle = 'rgba(38, 198, 218, 0.3)';
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = config.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      // Fan blades (propeller icon)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = config.secondaryColor || config.color;
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(0, -6, 3, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Direction arrow
      const fanDirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [fdx, fdy] = fanDirs[rotation % 4];
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + fdx * 14, cy + fdy * 14);
      ctx.stroke();
      // Arrowhead
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(cx + fdx * 16, cy + fdy * 16);
      ctx.lineTo(cx + fdx * 10 + fdy * 4, cy + fdy * 10 + fdx * 4);
      ctx.lineTo(cx + fdx * 10 - fdy * 4, cy + fdy * 10 - fdx * 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'gravitypad': {
      // Glowing directional pad
      const grad = ctx.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
      grad.addColorStop(0, 'rgba(255, 64, 129, 0.6)');
      grad.addColorStop(1, 'rgba(245, 0, 87, 0.3)');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = config.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      // Big direction arrow
      const gpDirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [gdx, gdy] = gpDirs[rotation % 4];
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(cx + gdx * 14, cy + gdy * 14);
      ctx.lineTo(cx + gdy * 8, cy + gdx * 8);
      ctx.lineTo(cx + gdy * 3, cy + gdx * 3);
      ctx.lineTo(cx - gdx * 10 + gdy * 3, cy - gdy * 10 + gdx * 3);
      ctx.lineTo(cx - gdx * 10 - gdy * 3, cy - gdy * 10 - gdx * 3);
      ctx.lineTo(cx - gdy * 3, cy - gdx * 3);
      ctx.lineTo(cx - gdy * 8, cy - gdx * 8);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'booster': {
      const grad = ctx.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
      grad.addColorStop(0, 'rgba(255, 235, 59, 0.85)');
      grad.addColorStop(1, 'rgba(255, 152, 0, 0.7)');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeStyle = '#fff59d';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      const bDirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [bdx, bdy] = bDirs[rotation % 4];
      ctx.strokeStyle = 'rgba(40, 20, 0, 0.85)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const off = i * 7;
        const sx = cx - bdx * 6 + bdy * off;
        const sy = cy - bdy * 6 + bdx * off;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + bdx * 7 - bdy * 5, sy + bdy * 7 - bdx * 5);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + bdx * 7 + bdy * 5, sy + bdy * 7 + bdx * 5);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      break;
    }
    case 'piston': {
      ctx.fillStyle = config.color;
      ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.fillStyle = config.secondaryColor || config.color;
      ctx.beginPath();
      const arrowDirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const [adx, ady] = arrowDirs[rotation % 4];
      ctx.moveTo(cx + adx * 12, cy + ady * 12);
      ctx.lineTo(cx + ady * 6, cy + adx * 6);
      ctx.lineTo(cx - ady * 6, cy - adx * 6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'blackhole': {
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, h - 2);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(0.6, config.color);
      grad.addColorStop(1, config.secondaryColor || '#8e44ad');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, h - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(142, 68, 173, 0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, h * 0.6, a, a + 1.5);
        ctx.stroke();
      }
      break;
    }
    case 'whitehole': {
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, h - 2);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, config.color);
      grad.addColorStop(1, config.secondaryColor || '#f1c40f');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, h - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(241, 196, 15, 0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
        ctx.lineTo(cx + Math.cos(a) * (h - 4), cy + Math.sin(a) * (h - 4));
        ctx.stroke();
      }
      break;
    }
    case 'portal': {
      // Swirling ring
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, h - 2);
      grad.addColorStop(0, 'rgba(0, 229, 255, 0.1)');
      grad.addColorStop(0.5, 'rgba(124, 77, 255, 0.4)');
      grad.addColorStop(1, 'rgba(0, 229, 255, 0.6)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, h - 2, 0, Math.PI * 2);
      ctx.fill();
      // Inner ring
      ctx.strokeStyle = config.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      // Outer ring
      ctx.strokeStyle = config.secondaryColor || '#7c4dff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, h - 3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'bomb': {
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.arc(cx, cy + 2, h * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = config.secondaryColor || config.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h * 0.5);
      ctx.quadraticCurveTo(cx + 6, cy - h * 0.8, cx + 4, cy - h * 0.9);
      ctx.stroke();
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(cx + 4, cy - h * 0.9, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

export function drawPlacedBlock(
  ctx: CanvasRenderingContext2D,
  block: PlacedBlock,
  ox: number,
  oy: number,
  camX: number,
  camY: number,
  frameCount: number,
  activeTypes?: Set<BlockType>,
) {
  const x = ox + block.col * CELL_SIZE - camX;
  const y = oy + block.row * CELL_SIZE - camY;
  drawBlockShape(ctx, block.type, x, y, block.rotation);

  const isPowered = POWERED_TYPES.includes(block.type);
  if (isPowered) {
    const keyLabel = POWERED_TYPE_KEY[block.type];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(x + CELL_SIZE - 8, y + 8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(keyLabel, x + CELL_SIZE - 8, y + 8);
    ctx.restore();

    if (activeTypes && activeTypes.has(block.type) && block.type !== 'portal') {
      const pulse = Math.sin(frameCount * 0.1) * 0.15 + 0.25;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 1, y - 1, CELL_SIZE + 2, CELL_SIZE + 2);
      ctx.restore();
    }
  }
}

export function drawSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frameCount: number,
  camX = 0,
  camY = 0,
) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0a0a1a');
  sky.addColorStop(0.4, '#0f1535');
  sky.addColorStop(0.7, '#162040');
  sky.addColorStop(1, '#1a2a50');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Moon
  const moonX = w * 0.82 - camX * 0.02;
  const moonY = h * 0.12 - camY * 0.02;
  const moonR = 28;
  const moonGlow = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 4);
  moonGlow.addColorStop(0, 'rgba(200, 220, 255, 0.15)');
  moonGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
  ctx.fillStyle = moonGlow;
  ctx.fillRect(moonX - moonR * 4, moonY - moonR * 4, moonR * 8, moonR * 8);
  ctx.fillStyle = 'rgba(220, 230, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(200, 210, 240, 0.6)';
  ctx.beginPath();
  ctx.arc(moonX - 5, moonY - 4, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(moonX + 8, moonY + 6, 4, 0, Math.PI * 2);
  ctx.fill();

  // Stars
  const stars = getStars(w, h);
  stars.forEach((star) => {
    const twinkle = Math.sin(frameCount * 0.02 + star.x * 0.1) * 0.15 + star.brightness;
    const sx = ((star.x - camX * 0.08) % (w * 2) + w * 2) % (w * 2) - w * 0.5;
    ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(sx, star.y - camY * 0.03, star.size, 0, Math.PI * 2);
    ctx.fill();
  });

  // Mountains
  const horizon = h * 0.65;
  const mountains = getMountains(w);
  for (const layer of mountains) {
    const offsetX = camX * layer.parallax;
    const step = (w * 2) / (layer.peaks.length - 2);
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < layer.peaks.length; i++) {
      const px = i * step - (offsetX % (w * 2)) - step;
      const py = horizon - layer.peaks[i] * h - camY * layer.parallax;
      if (i === 0) ctx.lineTo(px, py);
      else {
        const prevX = (i - 1) * step - (offsetX % (w * 2)) - step;
        const cpx = (prevX + px) / 2;
        ctx.quadraticCurveTo(cpx, py - 10, px, py);
      }
    }
    ctx.lineTo(w + 100, h);
    ctx.closePath();
    ctx.fill();
  }

  // Trees
  const trees = getTrees(w);
  for (const tree of trees) {
    const tx = ((tree.x - camX * tree.parallax) % (w * 3) + w * 3) % (w * 3) - w * 0.5;
    if (tx < -30 || tx > w + 30) continue;
    const ty = horizon + 5 - camY * tree.parallax;
    const g = Math.floor(20 + tree.shade * 15);
    ctx.fillStyle = `rgb(${g - 5}, ${g + 10}, ${g - 5})`;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - tree.w * 0.5, ty);
    ctx.lineTo(tx, ty - tree.h);
    ctx.lineTo(tx + tree.w * 0.5, ty);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tx, ty + 2);
    ctx.lineTo(tx - tree.w * 0.35, ty + 2);
    ctx.lineTo(tx, ty - tree.h * 0.65);
    ctx.lineTo(tx + tree.w * 0.35, ty + 2);
    ctx.closePath();
    ctx.fillStyle = `rgb(${g}, ${g + 18}, ${g})`;
    ctx.fill();
  }
}

export function drawFloor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  oy: number,
  frameCount: number,
  speed: number,
  camY = 0,
) {
  const floorY = oy + BUILD_HEIGHT - camY;
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, floorY, w, h - floorY + 200);
  ctx.fillStyle = COLORS.floorTop;
  ctx.fillRect(0, floorY, w, 3);
  ctx.fillStyle = COLORS.floorStripe;
  for (let i = 0; i < 30; i++) {
    const sx = (i * 80 - (frameCount * speed * 0.5) % 80 + 10000) % (w + 200) - 100;
    if (sx > -80 && sx < w + 80) {
      ctx.fillRect(sx, floorY + 8, 40, 2);
    }
  }
}

export function drawDistanceMarkers(
  ctx: CanvasRenderingContext2D,
  w: number,
  ox: number,
  oy: number,
  camX = 0,
  camY = 0,
) {
  const startX = ox + BUILD_WIDTH - camX;
  const topY = oy - camY;
  const botY = oy + BUILD_HEIGHT - camY;

  // Start line — bold gold "0m" marker
  if (startX > -50 && startX < w + 50) {
    ctx.beginPath();
    ctx.moveTo(startX, topY - 10);
    ctx.lineTo(startX, botY + 10);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0m', startX, topY - 16);
  }

  for (let i = 1; i < 200; i++) {
    const mx = startX + i * CELL_SIZE * 5;
    if (mx < -50) continue;
    if (mx > w + 50) break;

    const isMajor = i % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(mx, topY);
    ctx.lineTo(mx, botY + 10);
    ctx.strokeStyle = isMajor ? 'rgba(255, 215, 0, 0.25)' : COLORS.distanceMarker;
    ctx.lineWidth = isMajor ? 1.5 : 1;
    ctx.stroke();

    const label = `${i * 5}m`;
    ctx.fillStyle = isMajor ? 'rgba(255, 215, 0, 0.5)' : COLORS.distanceText;
    ctx.font = isMajor ? 'bold 12px sans-serif' : '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, mx, topY - 6);
    ctx.fillText(label, mx, botY + 24);
  }
}

export function drawGrid(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;
  for (let c = 0; c <= GRID_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(ox + c * CELL_SIZE, oy);
    ctx.lineTo(ox + c * CELL_SIZE, oy + BUILD_HEIGHT);
    ctx.stroke();
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + r * CELL_SIZE);
    ctx.lineTo(ox + BUILD_WIDTH, oy + r * CELL_SIZE);
    ctx.stroke();
  }
}

export function drawBuildAreaBorder(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  ctx.strokeStyle = COLORS.buildBorder;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(ox, oy, BUILD_WIDTH, BUILD_HEIGHT);
  ctx.setLineDash([]);

  ctx.fillStyle = COLORS.buildLabel;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BUILD AREA', ox + BUILD_WIDTH / 2, oy - 8);
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  trail: { x: number; y: number }[],
  cam: Camera,
) {
  for (let i = 0; i < trail.length; i++) {
    const alpha = (i / trail.length) * 0.3;
    const size = BALL_RADIUS * (0.3 + (i / trail.length) * 0.7);
    ctx.fillStyle = `rgba(233, 69, 96, ${alpha})`;
    ctx.beginPath();
    ctx.arc(trail[i].x - cam.x, trail[i].y - cam.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const sx = bx - cam.x;
  const sy = by - cam.y;

  const glow = ctx.createRadialGradient(sx, sy, BALL_RADIUS, sx, sy, BALL_RADIUS * 2.5);
  glow.addColorStop(0, 'rgba(233, 69, 96, 0.2)');
  glow.addColorStop(1, 'rgba(233, 69, 96, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, BALL_RADIUS * 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = BLOCK_CONFIGS.ball.color;
  ctx.beginPath();
  ctx.arc(sx, sy, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff6b81';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.arc(sx - 3, sy - 3, BALL_RADIUS * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

export function drawDistanceHUD(ctx: CanvasRenderingContext2D, w: number, distance: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(15, 52, 96, 0.9)';
  const hudW = 240;
  const hudH = 50;
  const hudX = w - hudW - 16;
  const hudY = 16;
  ctx.beginPath();
  ctx.roundRect(hudX, hudY, hudW, hudH, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(hudX, hudY, hudW, hudH, 10);
  ctx.stroke();
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${distance.toFixed(1)} blocks`, hudX + hudW / 2, hudY + 32);
  ctx.restore();
}

export function drawPoweredHUD(
  ctx: CanvasRenderingContext2D,
  poweredTypes: BlockType[],
  activeTypes: Set<BlockType>,
) {
  if (poweredTypes.length === 0) return;

  ctx.save();
  const hudX = 16;
  const hudY = 16;
  const chipW = 44;
  const chipH = 28;
  const gap = 4;
  const totalW = poweredTypes.length * (chipW + gap) - gap + 16;

  ctx.fillStyle = 'rgba(15, 52, 96, 0.85)';
  ctx.beginPath();
  ctx.roundRect(hudX, hudY, totalW, chipH + 16, 8);
  ctx.fill();

  ctx.font = 'bold 8px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'left';
  ctx.fillText('HOLD KEY', hudX + 6, hudY + 10);

  poweredTypes.forEach((type, i) => {
    const gx = hudX + 8 + i * (chipW + gap);
    const gy = hudY + 16;
    const active = activeTypes.has(type);
    const keyLabel = POWERED_TYPE_KEY[type];
    const config = BLOCK_CONFIGS[type];

    ctx.fillStyle = active ? 'rgba(255, 215, 0, 0.8)' : 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.roundRect(gx, gy, chipW, chipH - 6, 4);
    ctx.fill();

    ctx.fillStyle = active ? '#000' : 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${keyLabel}`, gx + 10, gy + (chipH - 6) / 2);

    ctx.fillStyle = active ? '#000' : 'rgba(255,255,255,0.4)';
    ctx.font = '8px sans-serif';
    ctx.fillText(config.name.slice(0, 5), gx + 32, gy + (chipH - 6) / 2);
  });

  ctx.restore();
}

export function drawSimulationEffects(
  ctx: CanvasRenderingContext2D,
  blocks: PlacedBlock[],
  ox: number,
  oy: number,
  cam: Camera,
  activeTypes: Set<BlockType>,
  frameCount: number,
  sim: SimulationState | null,
) {
  blocks.forEach((block) => {
    const bx = ox + block.col * CELL_SIZE + CELL_SIZE / 2 - cam.x;
    const by = oy + block.row * CELL_SIZE + CELL_SIZE / 2 - cam.y;

    switch (block.type) {
      case 'fan': {
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [fdx, fdy] = dirs[block.rotation % 4];
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = '#80deea';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const offset = ((frameCount * 2 + i * 30) % (FAN_RANGE)) ;
          const spread = (i - 2) * 8;
          const sx = bx + fdy * spread;
          const sy = by + fdx * spread;
          ctx.beginPath();
          ctx.moveTo(sx + fdx * 10, sy + fdy * 10);
          ctx.lineTo(sx + fdx * (10 + offset), sy + fdy * (10 + offset));
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'gravitypad': {
        if (sim?.gravityEffect) {
          const pulse = Math.sin(frameCount * 0.15) * 0.3 + 0.3;
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.fillStyle = '#ff4081';
          ctx.beginPath();
          ctx.arc(bx, by, CELL_SIZE * 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'portal': {
        ctx.save();
        for (let i = 0; i < 6; i++) {
          const angle = frameCount * 0.08 + (i / 6) * Math.PI * 2;
          const r = CELL_SIZE * 0.35;
          const px = bx + Math.cos(angle) * r;
          const py = by + Math.sin(angle) * r;
          ctx.fillStyle = `rgba(0, 229, 255, ${0.2 + Math.sin(frameCount * 0.05 + i) * 0.15})`;
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'piston': {
        if (!activeTypes.has('piston')) break;
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [dx, dy] = dirs[block.rotation % 4];
        ctx.fillStyle = 'rgba(46, 204, 113, 0.7)';
        const armX = bx + dx * CELL_SIZE - CELL_SIZE * 0.4;
        const armY = by + dy * CELL_SIZE - CELL_SIZE * 0.4;
        ctx.fillRect(armX, armY, CELL_SIZE * 0.8, CELL_SIZE * 0.8);
        break;
      }
      case 'blackhole': {
        if (!activeTypes.has('blackhole')) break;
        ctx.save();
        for (let i = 0; i < 10; i++) {
          const angle = frameCount * 0.06 + (i / 10) * Math.PI * 2;
          const dist = 15 + Math.sin(frameCount * 0.04 + i * 0.7) * 12;
          const px = bx + Math.cos(angle) * dist;
          const py = by + Math.sin(angle) * dist;
          ctx.fillStyle = `rgba(142, 68, 173, ${0.35 + Math.sin(frameCount * 0.06 + i) * 0.2})`;
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'whitehole': {
        if (!activeTypes.has('whitehole')) break;
        const wDirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [wdx, wdy] = wDirs[block.rotation % 4];
        ctx.save();
        // jet streaks
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 8; i++) {
          const t = ((frameCount * 6 + i * 30) % WHITEHOLE_RANGE);
          const spread = ((i % 5) - 2) * 5;
          const sx = bx + wdy * spread + wdx * (10 + t);
          const sy = by + wdx * spread + wdy * (10 + t);
          ctx.fillStyle = `rgba(255, 240, 120, ${0.9 - t / WHITEHOLE_RANGE})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'booster': {
        const flash = sim?.boostFlashes?.find(
          (f) => Math.abs(f.x - (ox + block.col * CELL_SIZE + CELL_SIZE / 2)) < 1
              && Math.abs(f.y - (oy + block.row * CELL_SIZE + CELL_SIZE / 2)) < 1,
        );
        if (flash) {
          const bDirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
          const [bdx, bdy] = bDirs[block.rotation % 4];
          const p = flash.frame / 18;
          ctx.save();
          ctx.globalAlpha = 0.7 * (1 - p);
          const len = CELL_SIZE * 3 * p;
          const grad = ctx.createLinearGradient(
            bx, by, bx + bdx * len, by + bdy * len,
          );
          grad.addColorStop(0, 'rgba(255, 235, 59, 0.8)');
          grad.addColorStop(1, 'rgba(255, 152, 0, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(bx + bdy * 8, by + bdx * 8);
          ctx.lineTo(bx - bdy * 8, by - bdx * 8);
          ctx.lineTo(bx + bdx * len - bdy * 2, by + bdy * len - bdx * 2);
          ctx.lineTo(bx + bdx * len + bdy * 2, by + bdy * len + bdx * 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        break;
      }
    }
  });

  // Bomb shockwaves
  if (sim) {
    sim.shockwaves.forEach((sw) => {
      const sx = sw.x - cam.x;
      const sy = sw.y - cam.y;
      const progress = sw.frame / 30;
      const radius = progress * CELL_SIZE * 4;
      ctx.save();
      ctx.globalAlpha = 0.4 * (1 - progress);
      ctx.strokeStyle = '#e67e22';
      ctx.lineWidth = 3 * (1 - progress);
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
      // Inner flash
      if (sw.frame < 8) {
        ctx.globalAlpha = 0.3 * (1 - sw.frame / 8);
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(sx, sy, radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}
