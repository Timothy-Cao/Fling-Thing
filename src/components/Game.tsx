'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  BUILD_WIDTH,
  BUILD_HEIGHT,
  STARTING_COINS,
  BLOCK_TYPES,
  BLOCK_CONFIGS,
  GROUPED_TYPES,
  VELOCITY_THRESHOLD,
  STILL_FRAMES_REQUIRED,
  CAMERA_LERP,
  COLORS,
  BlockType,
} from '@/game/constants';
import { PlacedBlock, GameMode, Camera } from '@/game/types';
import {
  drawBlockShape,
  drawPlacedBlock,
  drawSky,
  drawFloor,
  drawDistanceMarkers,
  drawGrid,
  drawBuildAreaBorder,
  drawBall,
  drawDistanceHUD,
  drawGroupHUD,
  drawSimulationEffects,
  resetStarsCache,
} from '@/game/renderer';
import {
  startSimulation,
  stopSimulation as stopSim,
  applyBlockEffects,
  SimulationState,
} from '@/game/physics';

function getBlockCost(type: BlockType, existingBlocks: PlacedBlock[]): number {
  if (type === 'ball') return 0;
  const countOfType = existingBlocks.filter((b) => b.type === type).length;
  if (countOfType === 0) return 0;
  return BLOCK_CONFIGS[type].cost;
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimulationState | null>(null);
  const animFrameRef = useRef<number>(0);
  const cameraRef = useRef<Camera>({ x: 0, y: 0 });
  const stillFramesRef = useRef(0);
  const maxDistanceRef = useRef(0);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const runGridOffsetRef = useRef({ x: 0, y: 0 });
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const editZoomRef = useRef(1);
  const currentZoomRef = useRef(1);

  const blocksRef = useRef<PlacedBlock[]>([]);
  const modeRef = useRef<GameMode>('edit');
  const hoverCellRef = useRef<{ col: number; row: number } | null>(null);
  const selectedBlockRef = useRef<BlockType | null>(null);
  const coinsRef = useRef(STARTING_COINS);
  const bestDistanceRef = useRef(0);
  const ballPlacedRef = useRef(false);
  const speedRef = useRef(1);
  const preRotationRef = useRef(0);
  const activeGroupsRef = useRef<Set<number>>(new Set());
  const heldKeysRef = useRef<Set<string>>(new Set());
  const paintingRef = useRef(false);
  const lastPaintCellRef = useRef<string | null>(null);

  const [blocks, setBlocks] = useState<PlacedBlock[]>(() => {
    if (typeof window === 'undefined') return [];
    try { const s = localStorage.getItem('fling-blocks'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [coins, setCoins] = useState(() => {
    if (typeof window === 'undefined') return STARTING_COINS;
    try { const s = localStorage.getItem('fling-coins'); return s ? Number(s) : STARTING_COINS; } catch { return STARTING_COINS; }
  });
  const [selectedBlock, setSelectedBlock] = useState<BlockType | null>(null);
  const [mode, setMode] = useState<GameMode>('edit');
  const [bestDistance, setBestDistance] = useState(() => {
    if (typeof window === 'undefined') return 0;
    try { const s = localStorage.getItem('fling-best'); return s ? Number(s) : 0; } catch { return 0; }
  });
  const [currentDistance, setCurrentDistance] = useState(0);
  const [hoverCell, setHoverCell] = useState<{ col: number; row: number } | null>(null);
  const [speed, setSpeed] = useState(1);
  const [preRotation, setPreRotation] = useState(0);
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !localStorage.getItem('fling-blocks');
  });

  const ballPlaced = blocks.some((b) => b.type === 'ball');

  useEffect(() => { blocksRef.current = blocks; ballPlacedRef.current = blocks.some(b => b.type === 'ball'); localStorage.setItem('fling-blocks', JSON.stringify(blocks)); }, [blocks]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { hoverCellRef.current = hoverCell; }, [hoverCell]);
  useEffect(() => { selectedBlockRef.current = selectedBlock; }, [selectedBlock]);
  useEffect(() => { coinsRef.current = coins; localStorage.setItem('fling-coins', String(coins)); }, [coins]);
  useEffect(() => { bestDistanceRef.current = bestDistance; localStorage.setItem('fling-best', String(bestDistance)); }, [bestDistance]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { preRotationRef.current = preRotation; }, [preRotation]);

  // --- RENDER LOOP ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const calcGridOffset = (w: number, h: number) => {
      const padding = 60;
      const zoomX = (w - padding) / BUILD_WIDTH;
      const zoomY = (h - padding) / BUILD_HEIGHT;
      const zoom = Math.min(zoomX, zoomY, 2.0);
      editZoomRef.current = zoom;

      const ox = (w / zoom - BUILD_WIDTH) / 2;
      const oy = (h / zoom - BUILD_HEIGHT) / 2;
      gridOffsetRef.current = { x: Math.max(20, ox), y: Math.max(20, oy) };

      const runOx = (w - BUILD_WIDTH) / 2;
      const runOy = (h - BUILD_HEIGHT) / 2;
      runGridOffsetRef.current = { x: Math.max(20, runOx), y: Math.max(20, runOy) };
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      calcGridOffset(canvas.width, canvas.height);
      resetStarsCache();
    };

    resize();
    window.addEventListener('resize', resize);
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    let running = true;
    let frameCount = 0;

    const renderEdit = (w: number, h: number) => {
      const { x: ox, y: oy } = gridOffsetRef.current;
      const currentBlocks = blocksRef.current;
      const hover = hoverCellRef.current;
      const selBlock = selectedBlockRef.current;
      const isBallPlaced = ballPlacedRef.current;
      const curCoins = coinsRef.current;
      const zoom = currentZoomRef.current;

      // Sky and floor drawn at screen scale
      drawSky(ctx, w, h, frameCount);

      // Zoomed content
      ctx.save();
      ctx.scale(zoom, zoom);

      drawFloor(ctx, w / zoom, h / zoom, oy, frameCount, 1);
      drawGrid(ctx, ox, oy);
      drawBuildAreaBorder(ctx, ox, oy);
      drawDistanceMarkers(ctx, w / zoom, ox, oy);

      ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('← distance measured here →', ox + BUILD_WIDTH + 20, oy - 8);

      currentBlocks.forEach((block) => drawPlacedBlock(ctx, block, ox, oy, 0, 0, frameCount));

      if (hover && selBlock) {
        const hx = ox + hover.col * CELL_SIZE;
        const hy = oy + hover.row * CELL_SIZE;
        const occupied = currentBlocks.some((b) => b.col === hover.col && b.row === hover.row);
        const canAfford = selBlock === 'ball' ? !isBallPlaced : curCoins >= getBlockCost(selBlock, currentBlocks);
        const valid = !occupied && canAfford && (selBlock !== 'ball' || !isBallPlaced);

        if (valid) {
          drawBlockShape(ctx, selBlock, hx, hy, preRotationRef.current, 0.4);
        } else {
          ctx.fillStyle = COLORS.hoverInvalid;
          ctx.fillRect(hx, hy, CELL_SIZE, CELL_SIZE);
        }
      }

      ctx.restore();
    };

    const renderRun = (w: number, h: number) => {
      const { x: ox, y: oy } = runGridOffsetRef.current;
      const cam = cameraRef.current;
      const currentBlocks = blocksRef.current;
      const activeGroups = activeGroupsRef.current;
      const zoom = currentZoomRef.current;

      drawSky(ctx, w, h, frameCount, cam.x, cam.y);

      ctx.save();
      ctx.scale(zoom, zoom);

      drawFloor(ctx, w / zoom, h / zoom, oy, frameCount, speedRef.current, cam.y);

      ctx.strokeStyle = 'rgba(233, 69, 96, 0.12)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(ox - cam.x, oy - cam.y, BUILD_WIDTH, BUILD_HEIGHT);
      ctx.setLineDash([]);

      drawDistanceMarkers(ctx, w / zoom, ox, oy, cam.x, cam.y);

      const sim = simRef.current;
      currentBlocks
        .filter((b) => {
          if (b.type === 'ball') return false;
          if (b.type === 'bomb' && sim?.removedBombs.has(`${b.col},${b.row}`)) return false;
          if (b.type === 'glass' && sim?.brokenGlass.has(`${b.col},${b.row}`)) return false;
          return true;
        })
        .forEach((block) => drawPlacedBlock(ctx, block, ox, oy, cam.x, cam.y, frameCount, activeGroups));

      drawSimulationEffects(ctx, currentBlocks, ox, oy, cam, activeGroups, frameCount, sim);

      const trail = trailRef.current;
      if (sim) {
        drawBall(ctx, sim.ballBody.position.x, sim.ballBody.position.y, trail, cam);
      }

      ctx.restore();

      drawDistanceHUD(ctx, w, maxDistanceRef.current);

      const existingGroups = [...new Set(
        currentBlocks
          .filter((b) => GROUPED_TYPES.includes(b.type))
          .map((b) => b.group),
      )].sort();
      drawGroupHUD(ctx, existingGroups, activeGroups);
    };

    const loop = () => {
      if (!running) return;
      try {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        frameCount++;

        const curMode = modeRef.current;

        const targetZoom = curMode === 'edit' ? editZoomRef.current : 1;
        currentZoomRef.current += (targetZoom - currentZoomRef.current) * 0.08;
        if (Math.abs(currentZoomRef.current - targetZoom) < 0.001) {
          currentZoomRef.current = targetZoom;
        }

        if (curMode === 'edit') {
          renderEdit(w, h);
        } else if (curMode === 'running' || curMode === 'results') {
          const sim = simRef.current;
          if (sim && curMode === 'running') {
            const ballBody = sim.ballBody;
            const targetX = ballBody.position.x - w / 2;
            const targetY = ballBody.position.y - h / 2;
            cameraRef.current.x += (targetX - cameraRef.current.x) * CAMERA_LERP;
            cameraRef.current.y += (targetY - cameraRef.current.y) * CAMERA_LERP;
            cameraRef.current.y = Math.max(cameraRef.current.y, -100);

            trailRef.current.push({ x: ballBody.position.x, y: ballBody.position.y });
            if (trailRef.current.length > 40) trailRef.current.shift();

            const { x: ox, y: oy } = runGridOffsetRef.current;

            const captured = applyBlockEffects(
              sim, activeGroupsRef.current, blocksRef.current, ox, oy,
            );

            const distPx = ballBody.position.x - (ox + BUILD_WIDTH);
            const dist = Math.max(0, Math.round((distPx / CELL_SIZE) * 10) / 10);
            maxDistanceRef.current = Math.max(maxDistanceRef.current, dist);

            const spd = Math.sqrt(ballBody.velocity.x ** 2 + ballBody.velocity.y ** 2);
            if (spd < VELOCITY_THRESHOLD) {
              stillFramesRef.current++;
            } else {
              stillFramesRef.current = 0;
            }

            const belowFloor = ballBody.position.y > oy + BUILD_HEIGHT + 200;

            if (stillFramesRef.current >= STILL_FRAMES_REQUIRED || belowFloor || captured) {
              const finalDist = captured ? 0 : maxDistanceRef.current;
              stopSim(sim);
              simRef.current = null;

              if (finalDist > bestDistanceRef.current) {
                setBestDistance(finalDist);
              }
              setCurrentDistance(finalDist);
              setMode('results');
            }
          }

          renderRun(w, h);
        }
      } catch (err) {
        console.error('LOOP ERROR:', err);
      }
    };

    const tick = () => {
      if (!running) return;
      loop();
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
      ro.disconnect();
    };
  }, []);

  // --- ACTIONS ---

  const handleRun = useCallback(() => {
    if (!ballPlacedRef.current) return;
    const { x: ox, y: oy } = runGridOffsetRef.current;
    const sim = startSimulation(blocksRef.current, ox, oy);
    if (!sim) return;
    simRef.current = sim;
    stillFramesRef.current = 0;
    maxDistanceRef.current = 0;
    cameraRef.current = { x: 0, y: 0 };
    trailRef.current = [];
    activeGroupsRef.current = new Set();
    heldKeysRef.current = new Set();
    setMode('running');
    setCurrentDistance(0);
    setSpeed(1);
  }, []);

  const handleBackToEdit = useCallback(() => {
    if (simRef.current) {
      stopSim(simRef.current);
      simRef.current = null;
    }
    cameraRef.current = { x: 0, y: 0 };
    activeGroupsRef.current = new Set();
    heldKeysRef.current = new Set();
    setMode('edit');
    setSpeed(1);
  }, []);

  const handleReset = useCallback(() => {
    if (simRef.current) {
      stopSim(simRef.current);
      simRef.current = null;
    }
    cameraRef.current = { x: 0, y: 0 };
    activeGroupsRef.current = new Set();
    heldKeysRef.current = new Set();
    setBlocks([]);
    setCoins(STARTING_COINS);
    setSelectedBlock(null);
    setMode('edit');
    setCurrentDistance(0);
    setSpeed(1);
    setPreRotation(0);
  }, []);

  const handleSpeedToggle = useCallback(() => {
    setSpeed((s) => {
      const next = s === 1 ? 2 : s === 2 ? 4 : 1;
      if (simRef.current) {
        simRef.current.engine.timing.timeScale = next;
      }
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    const data = JSON.stringify({ blocks: blocksRef.current, coins: coinsRef.current }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fling-thing-build.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (data.blocks) setBlocks(data.blocks);
          if (data.coins != null) setCoins(data.coins);
        } catch { /* ignore bad files */ }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  // --- CANVAS EVENTS ---

  const getGridCell = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const zoom = currentZoomRef.current;
      const x = (clientX - rect.left) / zoom;
      const y = (clientY - rect.top) / zoom;
      const { x: ox, y: oy } = gridOffsetRef.current;
      const col = Math.floor((x - ox) / CELL_SIZE);
      const row = Math.floor((y - oy) / CELL_SIZE);
      if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
        return { col, row };
      }
      return null;
    },
    [],
  );

  const placeBlockAt = useCallback(
    (cell: { col: number; row: number }, pickUp: boolean) => {
      setBlocks((prev) => {
        const existingIndex = prev.findIndex((b) => b.col === cell.col && b.row === cell.row);

        if (existingIndex >= 0) {
          if (!pickUp) return prev;
          const existing = prev[existingIndex];
          const remaining = prev.filter((_, i) => i !== existingIndex);
          if (existing.type !== 'ball') {
            const othersOfType = remaining.filter((b) => b.type === existing.type);
            if (othersOfType.length >= 1) {
              setCoins((c) => c + BLOCK_CONFIGS[existing.type].cost);
            }
          }
          setSelectedBlock(existing.type);
          return remaining;
        }

        const selBlock = selectedBlockRef.current;
        if (!selBlock) return prev;

        const isBallPlaced = prev.some((b) => b.type === 'ball');
        if (selBlock === 'ball' && isBallPlaced) return prev;

        const cost = getBlockCost(selBlock, prev);
        if (cost > coinsRef.current) return prev;

        setCoins((c) => c - cost);
        const isPowered = GROUPED_TYPES.includes(selBlock);
        return [...prev, {
          type: selBlock,
          col: cell.col,
          row: cell.row,
          rotation: preRotationRef.current,
          group: isPowered ? 1 : 0,
        }];
      });
    },
    [],
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 || modeRef.current !== 'edit') return;
      paintingRef.current = true;
      const cell = getGridCell(e.clientX, e.clientY);
      if (!cell) return;
      lastPaintCellRef.current = `${cell.col},${cell.row}`;
      placeBlockAt(cell, true);
    },
    [getGridCell, placeBlockAt],
  );

  const handleCanvasMouseUp = useCallback(() => {
    paintingRef.current = false;
    lastPaintCellRef.current = null;
  }, []);

  const handleCanvasRightClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (modeRef.current !== 'edit') return;
      const cell = getGridCell(e.clientX, e.clientY);
      if (!cell) return;

      const existingBlock = blocksRef.current.find(
        (b) => b.col === cell.col && b.row === cell.row,
      );

      if (existingBlock) {
        setBlocks((prev) =>
          prev.map((b) =>
            b.col === cell.col && b.row === cell.row
              ? { ...b, rotation: (b.rotation + 1) % 4 }
              : b,
          ),
        );
      } else {
        setPreRotation((r) => (r + 1) % 4);
      }
    },
    [getGridCell],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (modeRef.current !== 'edit') return;
      const cell = getGridCell(e.clientX, e.clientY);
      setHoverCell(cell);

      if (paintingRef.current && cell && selectedBlockRef.current) {
        const key = `${cell.col},${cell.row}`;
        if (key !== lastPaintCellRef.current) {
          lastPaintCellRef.current = key;
          placeBlockAt(cell, false);
        }
      }
    },
    [getGridCell, placeBlockAt],
  );

  const handleCanvasWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (modeRef.current !== 'edit') return;
      const cell = getGridCell(e.clientX, e.clientY);
      if (!cell) return;

      setBlocks((prev) =>
        prev.map((b) => {
          if (b.col !== cell.col || b.row !== cell.row) return b;
          if (!GROUPED_TYPES.includes(b.type)) return b;
          const delta = e.deltaY > 0 ? 1 : -1;
          let newGroup = b.group + delta;
          if (newGroup < 1) newGroup = 9;
          if (newGroup > 9) newGroup = 1;
          return { ...b, group: newGroup };
        }),
      );
    },
    [getGridCell],
  );

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (modeRef.current === 'edit') {
        const blockIndex = BLOCK_TYPES.findIndex((t) => BLOCK_CONFIGS[t].hotkey === e.key);
        if (blockIndex >= 0) {
          const type = BLOCK_TYPES[blockIndex];
          setSelectedBlock((prev) => {
            if (prev !== type) {
              setPreRotation(0);
            }
            return prev === type ? null : type;
          });
          return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
          const hover = hoverCellRef.current;
          if (!hover) return;
          setBlocks((prev) => {
            const idx = prev.findIndex((b) => b.col === hover.col && b.row === hover.row);
            if (idx < 0) return prev;
            const existing = prev[idx];
            const remaining = prev.filter((_, i) => i !== idx);
            if (existing.type !== 'ball') {
              const othersOfType = remaining.filter((b) => b.type === existing.type);
              if (othersOfType.length >= 1) {
                setCoins((c) => c + BLOCK_CONFIGS[existing.type].cost);
              }
            }
            return remaining;
          });
          return;
        }

        if (e.key === 'Escape') {
          setSelectedBlock(null);
          setPreRotation(0);
          return;
        }
      }

      if (modeRef.current === 'running' || modeRef.current === 'results') {
        if (e.key === 'r' || e.key === 'Escape') {
          e.preventDefault();
          handleBackToEdit();
          return;
        }
      }

      if (modeRef.current === 'running') {
        if (e.key === ' ' || e.key === 'f') {
          e.preventDefault();
          handleSpeedToggle();
          return;
        }

        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && !heldKeysRef.current.has(e.key)) {
          heldKeysRef.current.add(e.key);
          activeGroupsRef.current = new Set([...activeGroupsRef.current, num]);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (modeRef.current !== 'running') return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        heldKeysRef.current.delete(e.key);
        const next = new Set(activeGroupsRef.current);
        next.delete(num);
        activeGroupsRef.current = next;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleSpeedToggle, handleBackToEdit]);

  // --- SIDEBAR ---

  const renderBlockItem = (type: BlockType) => {
    const config = BLOCK_CONFIGS[type];
    const isSelected = selectedBlock === type;
    const count = blocks.filter((b) => b.type === type).length;
    const cost = getBlockCost(type, blocks);
    const canAfford = type === 'ball' ? !ballPlaced : coins >= cost;
    const disabled = mode !== 'edit' || (type === 'ball' && ballPlaced) || (!canAfford && count > 0);
    const isPowered = GROUPED_TYPES.includes(type);

    return (
      <button
        key={type}
        onClick={() => !disabled && setSelectedBlock((prev) => {
          if (prev !== type) setPreRotation(0);
          return prev === type ? null : type;
        })}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 transition-all text-left ${
          isSelected
            ? 'border-[#e94560] bg-[#1a3a6e] shadow-[0_0_12px_rgba(233,69,96,0.25)]'
            : disabled
              ? 'border-transparent bg-[#0d2b52] opacity-40 cursor-not-allowed'
              : 'border-transparent bg-[#0f3460] hover:border-[#e94560]/60 hover:bg-[#132f5e] cursor-pointer'
        }`}
      >
        <div className="w-11 h-11 rounded-lg flex-shrink-0 relative bg-black/20 flex items-center justify-center">
          <canvas
            ref={(el) => {
              if (!el) return;
              const c = el.getContext('2d');
              if (!c) return;
              el.width = 44;
              el.height = 44;
              c.clearRect(0, 0, 44, 44);
              const scale = 44 / CELL_SIZE;
              c.save();
              c.translate(2, 2);
              c.scale(scale, scale);
              drawBlockShape(c, type, 0, 0, 0);
              c.restore();
            }}
            width={44}
            height={44}
            className="rounded"
          />
          {isPowered && (
            <span className="absolute -top-1.5 -right-1.5 text-[9px] leading-none bg-[#16213e] rounded-full px-0.5">⚡</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-bold text-white leading-tight">{config.name}</span>
            <span className="text-[9px] text-gray-600 font-mono">{config.hotkey.toUpperCase()}</span>
          </div>
          <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{config.description}</div>
          <div className="text-[10px] text-yellow-400/80 leading-tight mt-0.5">
            {type === 'ball' ? (ballPlaced ? '1 / 1' : '0 / 1') : `${count} placed`}
          </div>
        </div>
      </button>
    );
  };

  const passiveBlocks = BLOCK_TYPES.filter((t) => BLOCK_CONFIGS[t].category === 'passive' || BLOCK_CONFIGS[t].category === 'special');
  const poweredBlocks = BLOCK_TYPES.filter((t) => BLOCK_CONFIGS[t].category === 'powered');

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <div className="w-[280px] flex-shrink-0 bg-gradient-to-b from-[#16213e] to-[#111d35] border-r border-[#1a3a6e]/50 flex flex-col p-4 gap-1.5 overflow-y-auto scrollbar-thin">
        <div className="text-center py-2 mb-1">
          <h2 className="text-xl font-extrabold text-[#e94560] uppercase tracking-[0.2em] leading-none drop-shadow-[0_0_8px_rgba(233,69,96,0.3)]">Fling Thing</h2>
          <div className="text-[9px] text-gray-500 tracking-[0.3em] uppercase mt-1">a Tim Cao game</div>
        </div>

        <div className="bg-gradient-to-r from-[#0f3460] to-[#0d2b52] rounded-xl py-2.5 px-4 text-center mb-2 border border-yellow-400/10">
          <span className="text-lg font-bold text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.2)]">🪙 {coins}</span>
          <span className="text-sm text-yellow-400/60 ml-1.5">Gold</span>
        </div>

        <div className="text-[10px] text-[#e94560]/60 uppercase tracking-[0.15em] font-bold mt-1 mb-0.5 px-1">Blocks</div>
        <div className="flex flex-col gap-1.5">
          {passiveBlocks.map(renderBlockItem)}
        </div>

        <div className="text-[10px] text-[#e94560]/60 uppercase tracking-[0.15em] font-bold mt-2 mb-0.5 px-1">Powered ⚡</div>
        <div className="flex flex-col gap-1.5">
          {poweredBlocks.map(renderBlockItem)}
        </div>

        <div className="mt-auto pt-3 border-t border-white/5">
          <div className="flex gap-2 mb-3">
            <button
              onClick={handleExport}
              disabled={blocks.length === 0}
              className="flex-1 px-3 py-2 rounded-lg text-[10px] font-semibold bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 cursor-pointer border border-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Export
            </button>
            <button
              onClick={handleImport}
              className="flex-1 px-3 py-2 rounded-lg text-[10px] font-semibold bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 cursor-pointer border border-white/5 transition-all"
            >
              Import
            </button>
          </div>
          <div className="text-[10px] text-gray-600 leading-relaxed space-y-0.5">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Controls</div>
            <div>Click / drag: Place blocks</div>
            <div>Right-click: Rotate</div>
            <div>Scroll: Change group</div>
            <div>Del: Remove</div>
            <div className="text-gray-700 mt-1">Sim: 1-9 groups · Space speed · R stop</div>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-14 bg-gradient-to-r from-[#16213e] to-[#141d33] border-b border-[#1a3a6e]/40 flex items-center px-5 gap-4">
          {mode === 'edit' && (
            <>
              <button
                onClick={handleRun}
                disabled={!ballPlaced}
                className={`px-7 py-2.5 rounded-xl font-bold text-sm tracking-wide transition-all ${
                  ballPlaced
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                }`}
              >
                ▶ Run
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-2.5 rounded-xl font-semibold text-sm bg-[#e94560]/80 text-white hover:bg-[#e94560] transition-all cursor-pointer"
              >
                ↺ Clear
              </button>
              {selectedBlock && preRotation > 0 && (
                <span className="text-xs text-gray-400 bg-white/5 px-3 py-1.5 rounded-lg">
                  {preRotation * 90}°
                </span>
              )}
              {!ballPlaced && (
                <span className="text-xs text-gray-500/80 ml-2">Place the ball to run</span>
              )}
            </>
          )}
          {mode === 'running' && (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-emerald-400 font-semibold">Simulating</span>
              </div>
              <button
                onClick={handleSpeedToggle}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-white/5 text-yellow-400 hover:bg-white/10 cursor-pointer border border-yellow-400/20 transition-all"
              >
                {speed}x
              </button>
              <button
                onClick={handleBackToEdit}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-white/5 text-gray-400 hover:bg-white/10 cursor-pointer border border-white/10 transition-all"
              >
                Stop
              </button>
              <span className="text-[10px] text-gray-600 ml-1">Hold 1-9 for groups</span>
            </>
          )}
          {mode === 'results' && (
            <button
              onClick={handleBackToEdit}
              className="px-7 py-2.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer transition-all"
            >
              ← Edit
            </button>
          )}
          <div className="ml-auto flex items-center gap-2.5 bg-white/5 rounded-xl px-4 py-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Best</span>
            <span className="text-sm text-yellow-400 font-bold">{bestDistance.toFixed(1)}</span>
            <span className="text-[10px] text-gray-500">m</span>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-h-0 overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseUp={handleCanvasMouseUp}
            onContextMenu={handleCanvasRightClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => { setHoverCell(null); paintingRef.current = false; lastPaintCellRef.current = null; }}
            onWheel={handleCanvasWheel}
            className="block w-full h-full"
          />

          {/* Results overlay */}
          {mode === 'results' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-gradient-to-b from-[#16213e] to-[#111d35] border border-[#1a3a6e]/50 rounded-2xl p-10 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)] min-w-[320px]">
                <div className="text-5xl mb-4">🏆</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-[0.2em] mb-1">Distance</div>
                <h2 className="text-4xl font-extrabold text-white mb-1">
                  {currentDistance.toFixed(1)}<span className="text-lg text-gray-400 ml-1">m</span>
                </h2>
                {currentDistance >= bestDistance && currentDistance > 0 ? (
                  <p className="text-yellow-400 text-sm mb-8 font-semibold">New personal best!</p>
                ) : (
                  <p className="text-gray-500 text-sm mb-8">
                    Best: {bestDistance.toFixed(1)}m
                  </p>
                )}
                <button
                  onClick={handleBackToEdit}
                  className="px-10 py-3 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)] cursor-pointer text-base transition-all"
                >
                  ← Edit
                </button>
                <div className="text-[10px] text-gray-600 mt-4">Press R or Esc</div>
              </div>
            </div>
          )}

          {/* Intro popup */}
          {showIntro && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md z-10">
              <div className="bg-gradient-to-b from-[#16213e] to-[#111d35] border border-[#1a3a6e]/50 rounded-2xl p-10 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)] max-w-[440px]">
                <h1 className="text-4xl font-extrabold text-[#e94560] uppercase tracking-[0.15em] mb-1 drop-shadow-[0_0_12px_rgba(233,69,96,0.3)]">Fling Thing</h1>
                <p className="text-[10px] text-gray-500 tracking-[0.3em] uppercase mb-8">a Tim Cao game</p>

                <div className="bg-white/5 rounded-xl p-5 mb-6 text-left space-y-3">
                  <p className="text-gray-200 text-sm leading-relaxed">
                    Build a contraption to launch the ball as far <span className="text-yellow-400 font-semibold">right</span> as possible.
                  </p>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    Place blocks on the grid, position your ball, and hit Run.
                    Distance is measured from the end of the build zone.
                  </p>
                </div>

                <div className="flex items-center justify-center gap-4 mb-8">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="inline-block w-4 h-4 rounded bg-[#e94560] shadow-[0_0_6px_rgba(233,69,96,0.4)]" />
                    <span className="text-gray-300">Ball</span>
                  </div>
                  <span className="text-gray-600 text-lg">+</span>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="inline-block w-4 h-4 rounded bg-[#7f8c8d]" />
                    <span className="text-gray-300">Blocks</span>
                  </div>
                  <span className="text-gray-600 text-lg">=</span>
                  <span className="text-sm text-yellow-400 font-bold">Distance!</span>
                </div>

                <button
                  onClick={() => setShowIntro(false)}
                  className="px-12 py-3.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] cursor-pointer text-lg tracking-wide transition-all"
                >
                  Play
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
