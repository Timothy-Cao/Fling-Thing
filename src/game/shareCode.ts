import { BLOCK_TYPES, GRID_COLS, GRID_ROWS, BlockType } from './constants';
import { PlacedBlock } from './types';

// ----- Sanitization -----

const VALID_TYPE_SET = new Set<string>(BLOCK_TYPES);

export function sanitizeBlocks(input: unknown): PlacedBlock[] {
  if (!Array.isArray(input)) return [];
  const out: PlacedBlock[] = [];
  const occupied = new Set<string>();
  let ballSeen = false;
  for (const b of input) {
    if (!b || typeof b !== 'object') continue;
    const obj = b as { type?: unknown; col?: unknown; row?: unknown; rotation?: unknown };
    const type = typeof obj.type === 'string' && VALID_TYPE_SET.has(obj.type) ? (obj.type as BlockType) : null;
    const col = typeof obj.col === 'number' ? Math.floor(obj.col) : NaN;
    const row = typeof obj.row === 'number' ? Math.floor(obj.row) : NaN;
    if (!type) continue;
    if (!Number.isFinite(col) || col < 0 || col >= GRID_COLS) continue;
    if (!Number.isFinite(row) || row < 0 || row >= GRID_ROWS) continue;
    const key = `${col},${row}`;
    if (occupied.has(key)) continue;
    if (type === 'ball') {
      if (ballSeen) continue;
      ballSeen = true;
    }
    const rotation = (((typeof obj.rotation === 'number' ? Math.floor(obj.rotation) : 0) % 4) + 4) % 4;
    occupied.add(key);
    out.push({ type, col, row, rotation });
  }
  return out;
}

// ----- Compact FT3 codec -----
//
// Format: `FT3|<coins36>:<blocks>`
//   coins36 = coin balance in base36 (1–4 chars typically)
//   blocks  = N * 4 chars, no separator
//     [type a..n] [col a..t] [row a..o] [rot 0..3]
//
// Stays human-readable. 12-block build ≈ 53 chars vs 782 for FT2.

const TYPE_CHARS = BLOCK_TYPES.map((_, i) => String.fromCharCode(97 + i)); // a..
const COL_CHARS  = Array.from({ length: GRID_COLS }, (_, i) => String.fromCharCode(97 + i)); // a..t
const ROW_CHARS  = Array.from({ length: GRID_ROWS }, (_, i) => String.fromCharCode(97 + i)); // a..o

export function encodeShareCode(blocks: PlacedBlock[], coins: number): string {
  const c = Math.max(0, Math.floor(coins)).toString(36);
  let body = '';
  for (const b of blocks) {
    const ti = BLOCK_TYPES.indexOf(b.type);
    if (ti < 0) continue;
    if (b.col < 0 || b.col >= GRID_COLS) continue;
    if (b.row < 0 || b.row >= GRID_ROWS) continue;
    body += TYPE_CHARS[ti];
    body += COL_CHARS[b.col];
    body += ROW_CHARS[b.row];
    body += String(((b.rotation % 4) + 4) % 4);
  }
  return `FT3|${c}:${body}`;
}

function decodeFT3(raw: string): { blocks: PlacedBlock[]; coins: number } | null {
  const after = raw.slice(4);
  const colonIdx = after.indexOf(':');
  if (colonIdx < 0) return null;
  const coins = parseInt(after.slice(0, colonIdx), 36);
  const body = after.slice(colonIdx + 1).trim();
  if (body.length % 4 !== 0) return null;
  const blocks: PlacedBlock[] = [];
  for (let i = 0; i < body.length; i += 4) {
    const t = body.charCodeAt(i) - 97;
    const c = body.charCodeAt(i + 1) - 97;
    const r = body.charCodeAt(i + 2) - 97;
    const rot = parseInt(body[i + 3], 10);
    if (t < 0 || t >= BLOCK_TYPES.length) continue;
    if (c < 0 || c >= GRID_COLS) continue;
    if (r < 0 || r >= GRID_ROWS) continue;
    if (Number.isNaN(rot)) continue;
    blocks.push({ type: BLOCK_TYPES[t], col: c, row: r, rotation: ((rot % 4) + 4) % 4 });
  }
  return { blocks: sanitizeBlocks(blocks), coins: Number.isFinite(coins) ? coins : 500 };
}

function decodeFT2(raw: string): { blocks: PlacedBlock[]; coins: number } | null {
  try {
    const b64 = raw.slice(4) + '='.repeat((4 - (raw.length - 4) % 4) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json);
    return {
      blocks: sanitizeBlocks(data.b ?? data.blocks),
      coins: typeof (data.c ?? data.coins) === 'number' ? data.c ?? data.coins : 500,
    };
  } catch { return null; }
}

export function decodeShareCode(raw: string): { blocks: PlacedBlock[]; coins: number } | null {
  const code = raw.trim();
  if (!code) return null;
  if (code.startsWith('FT3|')) return decodeFT3(code);
  if (code.startsWith('FT2|')) return decodeFT2(code);
  // Raw JSON fallback for legacy / hand-rolled
  try {
    const data = JSON.parse(code);
    return {
      blocks: sanitizeBlocks(data.b ?? data.blocks),
      coins: typeof (data.c ?? data.coins) === 'number' ? data.c ?? data.coins : 500,
    };
  } catch { return null; }
}
