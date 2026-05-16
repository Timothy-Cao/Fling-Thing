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

  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
  const [coins, setCoins] = useState(STARTING_COINS);
  const [selectedBlock, setSelectedBlock] = useState<BlockType | null>(null);
  const [mode, setMode] = useState<GameMode>('edit');
  const [bestDistance, setBestDistance] = useState(0);
  const [currentDistance, setCurrentDistance] = useState(0);
  const [hoverCell, setHoverCell] = useState<{ col: number; row: number } | null>(null);
  const [speed, setSpeed] = useState(1);
  const [preRotation, setPreRotation] = useState(0);

  const ballPlaced = blocks.some((b) => b.type === 'ball');

  useEffect(() => { blocksRef.current = blocks; ballPlacedRef.current = blocks.some(b => b.type === 'ball'); }, [blocks]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { hoverCellRef.current = hoverCell; }, [hoverCell]);
  useEffect(() => { selectedBlockRef.current = selectedBlock; }, [selectedBlock]);
  useEffect(() => { coinsRef.current = coins; }, [coins]);
  useEffect(() => { bestDistanceRef.current = bestDistance; }, [bestDistance]);
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

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (modeRef.current !== 'edit') return;
      const cell = getGridCell(e.clientX, e.clientY);
      if (!cell) return;

      setBlocks((prev) => {
        const existingIndex = prev.findIndex((b) => b.col === cell.col && b.row === cell.row);

        if (existingIndex >= 0) {
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
    [getGridCell],
  );

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
    },
    [getGridCell],
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
        className={`w-full flex items-center gap-2.5 p-2 rounded-lg border-2 transition-all text-left ${
          isSelected
            ? 'border-[#e94560] bg-[#1a3a6e]'
            : disabled
              ? 'border-transparent bg-[#0f3460] opacity-50 cursor-not-allowed'
              : 'border-transparent bg-[#0f3460] hover:border-[#e94560] cursor-pointer'
        }`}
      >
        <div className="w-10 h-10 rounded flex-shrink-0 relative">
          <canvas
            ref={(el) => {
              if (!el) return;
              const c = el.getContext('2d');
              if (!c) return;
              el.width = 40;
              el.height = 40;
              c.clearRect(0, 0, 40, 40);
              const scale = 40 / CELL_SIZE;
              c.save();
              c.scale(scale, scale);
              drawBlockShape(c, type, 0, 0, 0);
              c.restore();
            }}
            width={40}
            height={40}
          />
          {isPowered && (
            <span className="absolute -top-1 -right-1 text-[8px] leading-none">⚡</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white leading-tight">
            {config.name}
            <span className="ml-1 text-[9px] text-gray-500 font-normal">[{config.hotkey}]</span>
          </div>
          <div className="text-[10px] text-gray-400 leading-tight">{config.description}</div>
          <div className="text-[10px] text-yellow-400 leading-tight">
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
      <div className="w-[260px] flex-shrink-0 bg-[#16213e] border-r-2 border-[#0f3460] flex flex-col p-4 gap-2 overflow-y-auto">
        <div className="text-center mb-1">
          <h2 className="text-lg font-extrabold text-[#e94560] uppercase tracking-[0.2em] leading-none">Fling Thing</h2>
          <div className="text-[9px] text-gray-500 tracking-[0.3em] uppercase mt-0.5">a Tim Cao game</div>
        </div>
        <div className="bg-[#0f3460] rounded-lg py-2 px-4 text-center mb-1">
          <span className="text-lg font-bold text-yellow-400">🪙 {coins} Gold</span>
        </div>

        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">Blocks</div>
        {passiveBlocks.map(renderBlockItem)}

        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-1">Powered ⚡</div>
        {poweredBlocks.map(renderBlockItem)}

        <div className="mt-auto pt-2 text-[10px] text-gray-600 leading-relaxed space-y-0.5 border-t border-gray-700/50">
          <div>Left-click: Place block</div>
          <div>Right-click: Rotate preview / block</div>
          <div>Scroll on powered: Change group</div>
          <div>Del: Remove (refund)</div>
          <div>0-9/Q/W/E/R/T: Select block</div>
          <div>Esc: Deselect</div>
          <div className="text-gray-700 mt-1">Run: Hold 1-9 to activate groups</div>
          <div className="text-gray-700">Space/F: Speed toggle</div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-12 bg-[#16213e] border-b-2 border-[#0f3460] flex items-center px-4 gap-3">
          {mode === 'edit' && (
            <>
              <button
                onClick={handleRun}
                disabled={!ballPlaced}
                className={`px-5 py-1.5 rounded-md font-semibold text-sm ${
                  ballPlaced
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer'
                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                }`}
              >
                ▶ Run
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-1.5 rounded-md font-semibold text-sm bg-[#e94560] text-white hover:bg-[#d63851] cursor-pointer"
              >
                ↺ Reset
              </button>
              {selectedBlock && preRotation > 0 && (
                <span className="text-xs text-gray-400">
                  Rotation: {preRotation * 90}°
                </span>
              )}
              {!ballPlaced && (
                <span className="text-xs text-gray-500 ml-2">Place the ball to enable Run</span>
              )}
            </>
          )}
          {mode === 'running' && (
            <>
              <span className="text-sm text-yellow-400 animate-pulse">Simulating...</span>
              <button
                onClick={handleSpeedToggle}
                className="px-3 py-1 rounded-md text-xs font-semibold bg-[#0f3460] text-yellow-400 hover:bg-[#1a3a6e] cursor-pointer border border-yellow-400/30"
              >
                {speed}x Speed
              </button>
              <span className="text-[10px] text-gray-500 ml-2">Hold 1-9 to activate block groups</span>
            </>
          )}
          {mode === 'results' && (
            <button
              onClick={handleBackToEdit}
              className="px-5 py-1.5 rounded-md font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer"
            >
              ← Back to Edit
            </button>
          )}
          <span className="ml-auto text-xs text-gray-500">
            🏆 Best: <span className="text-yellow-400 font-semibold">{bestDistance.toFixed(1)}</span> blocks
          </span>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-h-0 overflow-hidden">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onContextMenu={handleCanvasRightClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoverCell(null)}
            onWheel={handleCanvasWheel}
            className="block w-full h-full"
          />

          {/* Results overlay */}
          {mode === 'results' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-[#16213e] border-2 border-[#0f3460] rounded-2xl p-10 text-center shadow-2xl min-w-[300px]">
                <div className="text-5xl mb-3">🏆</div>
                <h2 className="text-3xl font-bold text-white mb-1">
                  {currentDistance.toFixed(1)} blocks
                </h2>
                {currentDistance >= bestDistance && currentDistance > 0 ? (
                  <p className="text-yellow-400 text-sm mb-6 font-semibold">🎉 New personal best!</p>
                ) : (
                  <p className="text-gray-400 text-sm mb-6">
                    Best: {bestDistance.toFixed(1)} blocks
                  </p>
                )}
                <button
                  onClick={handleBackToEdit}
                  className="px-8 py-2.5 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer text-base"
                >
                  ← Back to Edit
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
