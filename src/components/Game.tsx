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
  POWERED_TYPES,
  POWERED_KEY_MAP,
  VELOCITY_THRESHOLD,
  STILL_FRAMES_REQUIRED,
  STUCK_FRAMES_REQUIRED,
  STUCK_POSITION_DELTA_PX,
  RUN_MAX_FRAMES,
  CAMERA_LERP,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_SPEED_RANGE,
  CAMERA_LEAD_PX,
  CAMERA_LEAD_MAX,
  MAX_BALL_SPEED,
  MILESTONES,
  SPEED_TO_MS,
  COLORS,
  BlockType,
} from '@/game/constants';
import { PlacedBlock, GameMode, Camera } from '@/game/types';
import { TEMPLATES } from '@/game/templates';
import { sanitizeBlocks, encodeShareCode, decodeShareCode } from '@/game/shareCode';
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
  drawPoweredHUD,
  drawSimulationEffects,
  drawMilestonePopups,
  drawOffscreenIndicators,
  drawFarFog,
  MilestonePopup,
  resetStarsCache,
} from '@/game/renderer';
import {
  startSimulation,
  stopSimulation as stopSim,
  applyBlockEffects,
  stepSimulation,
  setSimulationSpeed,
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

  const milestonesRef = useRef<MilestonePopup[]>([]);
  const milestonesHitRef = useRef<Set<number>>(new Set());
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const stuckFramesRef = useRef(0);
  const runFramesRef = useRef(0);
  const undoStackRef = useRef<{ blocks: PlacedBlock[]; coins: number }[]>([]);
  const redoStackRef = useRef<{ blocks: PlacedBlock[]; coins: number }[]>([]);

  const blocksRef = useRef<PlacedBlock[]>([]);
  const modeRef = useRef<GameMode>('edit');
  const hoverCellRef = useRef<{ col: number; row: number } | null>(null);
  const selectedBlockRef = useRef<BlockType | null>(null);
  const coinsRef = useRef(STARTING_COINS);
  const bestDistanceRef = useRef(0);
  const ballPlacedRef = useRef(false);
  const speedRef = useRef(1);
  const preRotationRef = useRef(0);
  const activeTypesRef = useRef<Set<BlockType>>(new Set());
  const heldKeysRef = useRef<Set<string>>(new Set());
  const paintingRef = useRef(false);
  const lastPaintCellRef = useRef<string | null>(null);
  const eraserRef = useRef(false);
  // Right-mouse drag-to-erase tracking. We only treat a right-mouse stroke as
  // an erase gesture once the cursor leaves the cell it started on, so a
  // single right-click still triggers the rotate flow.
  const rightDraggingRef = useRef(false);
  const rightDragMovedRef = useRef(false);
  const rightStartCellRef = useRef<{ col: number; row: number } | null>(null);
  const lastRightCellRef = useRef<string | null>(null);

  const [blocks, setBlocks] = useState<PlacedBlock[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const s = localStorage.getItem('fling-blocks');
      return s ? sanitizeBlocks(JSON.parse(s)) : [];
    } catch { return []; }
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
  const [eraserMode, setEraserMode] = useState(false);
  const [lastRunStats, setLastRunStats] = useState<{ peakMs: number; seconds: number; bounces: number; blocks: number }>({
    peakMs: 0, seconds: 0, bounces: 0, blocks: 0,
  });
  const [poweredHint, setPoweredHint] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
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
  useEffect(() => { eraserRef.current = eraserMode; }, [eraserMode]);

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

      if (hover && eraserRef.current) {
        const hx = ox + hover.col * CELL_SIZE;
        const hy = oy + hover.row * CELL_SIZE;
        const hasBlock = currentBlocks.some((b) => b.col === hover.col && b.row === hover.row);
        ctx.fillStyle = hasBlock ? 'rgba(255, 60, 60, 0.25)' : 'rgba(255, 60, 60, 0.1)';
        ctx.fillRect(hx, hy, CELL_SIZE, CELL_SIZE);
        ctx.strokeStyle = 'rgba(255, 60, 60, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx + 8, hy + 8);
        ctx.lineTo(hx + CELL_SIZE - 8, hy + CELL_SIZE - 8);
        ctx.moveTo(hx + CELL_SIZE - 8, hy + 8);
        ctx.lineTo(hx + 8, hy + CELL_SIZE - 8);
        ctx.stroke();
      } else if (hover && selBlock) {
        const hx = ox + hover.col * CELL_SIZE;
        const hy = oy + hover.row * CELL_SIZE;
        const occupied = currentBlocks.some((b) => b.col === hover.col && b.row === hover.row);
        const placementCost = selBlock === 'ball' ? 0 : getBlockCost(selBlock, currentBlocks);
        const canAfford = selBlock === 'ball' ? !isBallPlaced : curCoins >= placementCost;
        const valid = !occupied && canAfford && (selBlock !== 'ball' || !isBallPlaced);

        if (valid) {
          drawBlockShape(ctx, selBlock, hx, hy, preRotationRef.current, 0.4);
          // Floating cost badge
          if (selBlock !== 'ball') {
            const label = placementCost === 0 ? 'free' : `${placementCost}🪙`;
            const padX = 6;
            ctx.font = 'bold 11px sans-serif';
            const tw = ctx.measureText(label).width + padX * 2;
            const bx = hx + CELL_SIZE - tw + 6;
            const by = hy - 6;
            ctx.fillStyle = placementCost === 0 ? 'rgba(46, 204, 113, 0.95)' : 'rgba(15, 25, 50, 0.92)';
            ctx.beginPath();
            ctx.roundRect(bx, by, tw, 18, 5);
            ctx.fill();
            ctx.strokeStyle = placementCost === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255, 215, 0, 0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, by, tw, 18, 5);
            ctx.stroke();
            ctx.fillStyle = placementCost === 0 ? '#fff' : '#ffd700';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, bx + tw / 2, by + 9);
          }
        } else {
          ctx.fillStyle = COLORS.hoverInvalid;
          ctx.fillRect(hx, hy, CELL_SIZE, CELL_SIZE);
          if (!canAfford && selBlock !== 'ball') {
            ctx.fillStyle = 'rgba(15, 25, 50, 0.92)';
            const label = `need ${placementCost}🪙`;
            ctx.font = 'bold 10px sans-serif';
            const tw = ctx.measureText(label).width + 12;
            const bx = hx + CELL_SIZE - tw + 6;
            const by = hy - 6;
            ctx.beginPath();
            ctx.roundRect(bx, by, tw, 18, 5);
            ctx.fill();
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, by, tw, 18, 5);
            ctx.stroke();
            ctx.fillStyle = '#ff8a80';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, bx + tw / 2, by + 9);
          }
        }
      }

      ctx.restore();
    };

    const renderRun = (w: number, h: number) => {
      const { x: ox, y: oy } = runGridOffsetRef.current;
      const baseCam = cameraRef.current;
      const sim0 = simRef.current;
      const shakeX = sim0?.shake.x ?? 0;
      const shakeY = sim0?.shake.y ?? 0;
      const cam: Camera = { x: baseCam.x + shakeX, y: baseCam.y + shakeY };
      const currentBlocks = blocksRef.current;
      const activeTypes = activeTypesRef.current;
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
          return true;
        })
        .forEach((block) => drawPlacedBlock(ctx, block, ox, oy, cam.x, cam.y, frameCount, activeTypes));

      drawSimulationEffects(ctx, currentBlocks, ox, oy, cam, activeTypes, frameCount, sim);

      const trail = trailRef.current;
      const v0 = sim?.ballBody.velocity;
      const rawSpeed = v0 ? Math.sqrt(v0.x * v0.x + v0.y * v0.y) : 0;
      const speedNorm = Math.min(1, rawSpeed / MAX_BALL_SPEED);
      if (sim) {
        drawBall(
          ctx,
          sim.ballBody.position.x,
          sim.ballBody.position.y,
          sim.ballBody.angle,
          trail,
          cam,
          speedNorm,
        );
      }

      ctx.restore();

      // Atmospheric fog at distance
      drawFarFog(ctx, w, h, cam, oy, zoom);

      const curSpeedMs = rawSpeed * SPEED_TO_MS;
      const peakMs = (sim?.stats.peakSpeed ?? 0) * SPEED_TO_MS;
      drawDistanceHUD(ctx, w, maxDistanceRef.current, curSpeedMs, peakMs);

      const poweredTypesInUse = [...new Set(
        currentBlocks
          .filter((b) => POWERED_TYPES.includes(b.type))
          .map((b) => b.type),
      )] as BlockType[];
      drawPoweredHUD(ctx, poweredTypesInUse, activeTypes);

      // Off-screen powered-block chevrons (screen space)
      drawOffscreenIndicators(
        ctx, currentBlocks, ox, oy, cam, zoom, w, h,
        activeTypes, sim?.removedBombs,
      );

      drawMilestonePopups(ctx, milestonesRef.current, w, h);
    };

    const loop = () => {
      if (!running) return;
      try {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        frameCount++;

        const curMode = modeRef.current;

        if (curMode === 'edit') {
          const targetZoom = editZoomRef.current;
          currentZoomRef.current += (targetZoom - currentZoomRef.current) * 0.08;
          if (Math.abs(currentZoomRef.current - targetZoom) < 0.001) {
            currentZoomRef.current = targetZoom;
          }
        } else if (curMode === 'results') {
          // settle to 1 when results
          currentZoomRef.current += (1 - currentZoomRef.current) * 0.06;
        }
        // running-mode zoom is driven by ball speed below.

        if (curMode === 'edit') {
          renderEdit(w, h);
        } else if (curMode === 'running' || curMode === 'results') {
          const sim = simRef.current;
          if (sim && curMode === 'running') {
            const ballBody = sim.ballBody;

            // --- Speed-adaptive zoom ---
            const v = ballBody.velocity;
            const speedNow = Math.sqrt(v.x * v.x + v.y * v.y);
            const [zsMin, zsMax] = CAMERA_ZOOM_SPEED_RANGE;
            const t = Math.max(0, Math.min(1, (speedNow - zsMin) / (zsMax - zsMin)));
            const targetCamZoom = CAMERA_ZOOM_MAX + (CAMERA_ZOOM_MIN - CAMERA_ZOOM_MAX) * t;
            currentZoomRef.current += (targetCamZoom - currentZoomRef.current) * 0.04;

            // --- Camera follow with lead + shake offset ---
            const zoom = currentZoomRef.current;
            // bias camera ahead of the ball in the direction of motion
            const leadX = Math.max(-CAMERA_LEAD_MAX, Math.min(CAMERA_LEAD_MAX, v.x * CAMERA_LEAD_PX));
            const leadY = Math.max(-CAMERA_LEAD_MAX / 2, Math.min(CAMERA_LEAD_MAX / 2, v.y * CAMERA_LEAD_PX * 0.5));
            const targetX = ballBody.position.x + leadX - (w / zoom) / 2;
            const targetY = ballBody.position.y + leadY - (h / zoom) / 2;
            cameraRef.current.x += (targetX - cameraRef.current.x) * CAMERA_LERP;
            cameraRef.current.y += (targetY - cameraRef.current.y) * CAMERA_LERP;
            cameraRef.current.y = Math.max(cameraRef.current.y, -200);

            trailRef.current.push({ x: ballBody.position.x, y: ballBody.position.y });
            // Trail length grows with speed: 30 at rest, up to 140 at max.
            const trailCap = 30 + Math.floor((speedNow / MAX_BALL_SPEED) * 110);
            while (trailRef.current.length > trailCap) trailRef.current.shift();

            const { x: ox, y: oy } = runGridOffsetRef.current;

            // Manual physics step with substeps + speed clamp (anti-tunneling)
            stepSimulation(sim);

            const captured = applyBlockEffects(
              sim, activeTypesRef.current, blocksRef.current, ox, oy,
            );

            const distPx = ballBody.position.x - (ox + BUILD_WIDTH);
            const dist = Math.max(0, Math.round((distPx / CELL_SIZE) * 10) / 10);
            const prevMax = maxDistanceRef.current;
            maxDistanceRef.current = Math.max(prevMax, dist);

            // Milestone callouts when we cross a threshold
            MILESTONES.forEach((m) => {
              if (prevMax < m && maxDistanceRef.current >= m && !milestonesHitRef.current.has(m)) {
                milestonesHitRef.current.add(m);
                milestonesRef.current.push({ value: m, frame: 0 });
              }
            });
            milestonesRef.current.forEach((p) => { p.frame++; });
            milestonesRef.current = milestonesRef.current.filter((p) => p.frame < 90);

            // Stuck detection (position barely changes)
            const lp = lastPosRef.current;
            if (lp) {
              const dx2 = ballBody.position.x - lp.x;
              const dy2 = ballBody.position.y - lp.y;
              if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < STUCK_POSITION_DELTA_PX) {
                stuckFramesRef.current++;
              } else {
                stuckFramesRef.current = 0;
                lastPosRef.current = { x: ballBody.position.x, y: ballBody.position.y };
              }
            } else {
              lastPosRef.current = { x: ballBody.position.x, y: ballBody.position.y };
            }

            if (speedNow < VELOCITY_THRESHOLD) {
              stillFramesRef.current++;
            } else {
              stillFramesRef.current = 0;
            }

            runFramesRef.current++;

            // Floor is 400px thick + extends to ~5M px right; ball can only ever be
            // "below floor" via a physics escape — treat 600px past build base as fatal.
            const belowFloor = ballBody.position.y > oy + BUILD_HEIGHT + 600;
            const stillDone = stillFramesRef.current >= STILL_FRAMES_REQUIRED;
            const stuckDone = stuckFramesRef.current >= STUCK_FRAMES_REQUIRED && speedNow < 2;
            const timedOut = runFramesRef.current >= RUN_MAX_FRAMES;

            if (stillDone || stuckDone || timedOut || belowFloor || captured) {
              const finalDist = captured ? 0 : maxDistanceRef.current;
              setLastRunStats({
                peakMs: sim.stats.peakSpeed * SPEED_TO_MS,
                seconds: runFramesRef.current / 60,
                bounces: sim.stats.bounces,
                blocks: blocksRef.current.filter((b) => b.type !== 'ball').length,
              });
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

  const [shareModal, setShareModal] = useState<null | 'export' | 'import'>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const snapshot = useCallback(() => {
    undoStackRef.current.push({ blocks: blocksRef.current, coins: coinsRef.current });
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, []);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push({ blocks: blocksRef.current, coins: coinsRef.current });
    setBlocks(prev.blocks);
    setCoins(prev.coins);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, []);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push({ blocks: blocksRef.current, coins: coinsRef.current });
    setBlocks(next.blocks);
    setCoins(next.coins);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, []);

  const handleLoadTemplate = useCallback((id: string) => {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    snapshot();
    setBlocks(tpl.blocks.map((b) => ({ ...b })));
    setCoins(STARTING_COINS);
    setShowTemplates(false);
    setShowIntro(false);
  }, [snapshot]);

  const handleRun = useCallback(() => {
    if (!ballPlacedRef.current) return;
    const { x: ox, y: oy } = runGridOffsetRef.current;
    const sim = startSimulation(blocksRef.current, ox, oy);
    if (!sim) return;
    simRef.current = sim;
    stillFramesRef.current = 0;
    stuckFramesRef.current = 0;
    runFramesRef.current = 0;
    lastPosRef.current = null;
    maxDistanceRef.current = 0;
    milestonesRef.current = [];
    milestonesHitRef.current = new Set();
    cameraRef.current = { x: 0, y: 0 };
    trailRef.current = [];
    activeTypesRef.current = new Set();
    heldKeysRef.current = new Set();
    setMode('running');
    setCurrentDistance(0);
    setSpeed(1);

    // First-run powered-block discovery hint.
    const hasPowered = blocksRef.current.some((b) => POWERED_TYPES.includes(b.type));
    const dismissed = typeof window !== 'undefined' && localStorage.getItem('fling-powered-hint-seen');
    if (hasPowered && !dismissed) {
      setPoweredHint(true);
      setTimeout(() => {
        setPoweredHint(false);
        try { localStorage.setItem('fling-powered-hint-seen', '1'); } catch {}
      }, 5500);
    }
  }, []);

  const handleBackToEdit = useCallback(() => {
    if (simRef.current) {
      stopSim(simRef.current);
      simRef.current = null;
    }
    cameraRef.current = { x: 0, y: 0 };
    activeTypesRef.current = new Set();
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
    activeTypesRef.current = new Set();
    heldKeysRef.current = new Set();
    snapshot();
    setBlocks([]);
    setCoins(STARTING_COINS);
    setSelectedBlock(null);
    setMode('edit');
    setCurrentDistance(0);
    setSpeed(1);
    setPreRotation(0);
  }, [snapshot]);

  const handleTryAgain = useCallback(() => {
    // Re-run with the same build, skipping the edit screen.
    if (simRef.current) {
      stopSim(simRef.current);
      simRef.current = null;
    }
    setMode('edit');
    // microtask so handleRun reads fresh refs and mode transitions cleanly
    requestAnimationFrame(() => {
      handleRun();
    });
  }, [handleRun]);

  const [copyToast, setCopyToast] = useState<string | null>(null);
  const handleCopyResult = useCallback(async () => {
    try {
      const code = encodeShareCode(blocksRef.current, coinsRef.current);
      const msg = `🚀 I flung it ${currentDistance.toFixed(1)}m in Fling Thing! Try my build:\n${code}`;
      await navigator.clipboard.writeText(msg);
      setCopyToast('Copied result + build to clipboard');
      setTimeout(() => setCopyToast(null), 2200);
    } catch {
      setCopyToast('Copy failed');
      setTimeout(() => setCopyToast(null), 2200);
    }
  }, [currentDistance]);

  const handleSpeedToggle = useCallback(() => {
    setSpeed((s) => {
      const next = s === 1 ? 2 : s === 2 ? 4 : 1;
      if (simRef.current) {
        setSimulationSpeed(simRef.current, next);
      }
      return next;
    });
  }, []);

  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const exportedCode = (() => {
    if (shareModal !== 'export') return '';
    return encodeShareCode(blocks, coins);
  })();

  const handleExport = useCallback(() => {
    setShareModal('export');
  }, []);

  const handleImport = useCallback(() => {
    setImportText('');
    setImportError('');
    setShareModal('import');
  }, []);

  const applyImport = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) { setImportError('Paste a code first.'); return; }
    const decoded = decodeShareCode(code);
    if (!decoded || decoded.blocks.length === 0) {
      setImportError('Invalid share code.');
      return;
    }
    snapshot();
    setBlocks(decoded.blocks);
    setCoins(decoded.coins);
    setShareModal(null);
  }, [snapshot]);

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
        const selBlock = selectedBlockRef.current;

        if (existingIndex >= 0) {
          const existing = prev[existingIndex];

          if (pickUp) {
            // Click on an occupied cell -> refund + pick up + select the type.
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

          // Drag over an occupied cell with a different block selected ->
          // swap it in (refund the old, charge the new). Same type = no-op.
          if (!selBlock || selBlock === existing.type) return prev;
          if (selBlock === 'ball' && prev.some((b) => b.type === 'ball' && b !== existing)) return prev;

          const remaining = prev.filter((_, i) => i !== existingIndex);
          let refund = 0;
          if (existing.type !== 'ball') {
            const othersOfType = remaining.filter((b) => b.type === existing.type);
            if (othersOfType.length >= 1) refund = BLOCK_CONFIGS[existing.type].cost;
          }
          const newCost = getBlockCost(selBlock, remaining);
          if (newCost > coinsRef.current + refund) return prev; // can't afford swap

          setCoins((c) => c + refund - newCost);
          return [
            ...remaining,
            { type: selBlock, col: cell.col, row: cell.row, rotation: preRotationRef.current },
          ];
        }

        // Empty cell.
        if (!selBlock) return prev;
        const isBallPlaced = prev.some((b) => b.type === 'ball');
        if (selBlock === 'ball' && isBallPlaced) return prev;

        const cost = getBlockCost(selBlock, prev);
        if (cost > coinsRef.current) return prev;

        setCoins((c) => c - cost);
        return [...prev, {
          type: selBlock,
          col: cell.col,
          row: cell.row,
          rotation: preRotationRef.current,
        }];
      });
    },
    [],
  );

  const eraseBlockAt = useCallback(
    (cell: { col: number; row: number }) => {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.col === cell.col && b.row === cell.row);
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
    },
    [],
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (modeRef.current !== 'edit') return;
      const cell = getGridCell(e.clientX, e.clientY);

      if (e.button === 0) {
        paintingRef.current = true;
        if (!cell) return;
        lastPaintCellRef.current = `${cell.col},${cell.row}`;
        snapshot();
        if (eraserRef.current) {
          eraseBlockAt(cell);
        } else {
          placeBlockAt(cell, true);
        }
        return;
      }

      if (e.button === 2) {
        // Start tracking a potential right-drag erase. We don't erase yet —
        // a single right-click should still rotate, only a real drag erases.
        rightDraggingRef.current = true;
        rightDragMovedRef.current = false;
        rightStartCellRef.current = cell;
        lastRightCellRef.current = cell ? `${cell.col},${cell.row}` : null;
      }
    },
    [getGridCell, placeBlockAt, eraseBlockAt, snapshot],
  );

  const handleCanvasMouseUp = useCallback((e?: React.MouseEvent<HTMLCanvasElement>) => {
    if (!e || e.button === 0) {
      paintingRef.current = false;
      lastPaintCellRef.current = null;
    }
    if (!e || e.button === 2) {
      // contextmenu fires after mouseup, so we DON'T clear rightDragMovedRef
      // here — it's read in onContextMenu and cleared there.
      rightDraggingRef.current = false;
      lastRightCellRef.current = null;
      rightStartCellRef.current = null;
    }
  }, []);

  const handleCanvasRightClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (modeRef.current !== 'edit') return;

      // If the right-mouse actually moved across cells, the user was dragging
      // to erase — don't treat the contextmenu fallout as a rotate.
      if (rightDragMovedRef.current) {
        rightDragMovedRef.current = false;
        return;
      }

      const cell = getGridCell(e.clientX, e.clientY);
      if (!cell) return;

      const existingBlock = blocksRef.current.find(
        (b) => b.col === cell.col && b.row === cell.row,
      );

      if (existingBlock) {
        snapshot();
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
    [getGridCell, snapshot],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (modeRef.current !== 'edit') return;
      const cell = getGridCell(e.clientX, e.clientY);
      setHoverCell(cell);

      if (paintingRef.current && cell) {
        const key = `${cell.col},${cell.row}`;
        if (key !== lastPaintCellRef.current) {
          lastPaintCellRef.current = key;
          if (eraserRef.current) {
            eraseBlockAt(cell);
          } else if (selectedBlockRef.current) {
            placeBlockAt(cell, false);
          }
        }
      }

      // Right-mouse drag-erase: once the cursor enters a different cell, treat
      // the gesture as a drag and erase everything we cross, including the
      // start cell.
      if (rightDraggingRef.current && cell) {
        const key = `${cell.col},${cell.row}`;
        if (key !== lastRightCellRef.current) {
          if (!rightDragMovedRef.current) {
            rightDragMovedRef.current = true;
            snapshot();
            if (rightStartCellRef.current) eraseBlockAt(rightStartCellRef.current);
          }
          eraseBlockAt(cell);
          lastRightCellRef.current = key;
        }
      }
    },
    [getGridCell, placeBlockAt, eraseBlockAt, snapshot],
  );


  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (modeRef.current === 'edit') {
        if (e.key === 'e' || e.key === 'E') {
          setEraserMode((prev) => {
            if (!prev) setSelectedBlock(null);
            return !prev;
          });
          return;
        }

        const blockIndex = BLOCK_TYPES.findIndex((t) => BLOCK_CONFIGS[t].hotkey === e.key);
        if (blockIndex >= 0) {
          const type = BLOCK_TYPES[blockIndex];
          setEraserMode(false);
          setSelectedBlock((prev) => {
            if (prev !== type) {
              setPreRotation(0);
            }
            return prev === type ? null : type;
          });
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && ((e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
          e.preventDefault();
          handleRedo();
          return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault(); // keep browser-back from firing on Backspace
          const hover = hoverCellRef.current;
          if (!hover) return;
          snapshot();
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
          setEraserMode(false);
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

        const poweredType = POWERED_KEY_MAP[e.key];
        if (poweredType && !heldKeysRef.current.has(e.key)) {
          heldKeysRef.current.add(e.key);
          activeTypesRef.current = new Set([...activeTypesRef.current, poweredType]);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (modeRef.current !== 'running') return;
      const poweredType = POWERED_KEY_MAP[e.key];
      if (poweredType) {
        heldKeysRef.current.delete(e.key);
        const next = new Set(activeTypesRef.current);
        next.delete(poweredType);
        activeTypesRef.current = next;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleSpeedToggle, handleBackToEdit, handleUndo, handleRedo, snapshot]);

  // --- SIDEBAR ---

  const [hoveredTip, setHoveredTip] = useState<BlockType | null>(null);

  const renderBlockItem = (type: BlockType) => {
    const config = BLOCK_CONFIGS[type];
    const isSelected = selectedBlock === type;
    const count = blocks.filter((b) => b.type === type).length;
    const cost = getBlockCost(type, blocks);
    const canAfford = type === 'ball' ? !ballPlaced : coins >= cost;
    const disabled = mode !== 'edit' || (type === 'ball' && ballPlaced) || (!canAfford && count > 0);
    const isPowered = POWERED_TYPES.includes(type);

    return (
      <button
        key={type}
        onClick={() => { if (disabled) return; setEraserMode(false); setSelectedBlock((prev) => {
          if (prev !== type) setPreRotation(0);
          return prev === type ? null : type;
        }); }}
        onMouseEnter={() => setHoveredTip(type)}
        onMouseLeave={() => setHoveredTip((cur) => (cur === type ? null : cur))}
        title={config.tip}
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
            <span className="text-[15px] font-bold text-white leading-tight">{config.name}</span>
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

        {/* Hover tip panel (reserved height so the sidebar doesn't jump) */}
        <div className="mt-2 mb-1 min-h-[60px] rounded-lg bg-white/[0.04] border border-white/5 p-2.5 transition-all">
          {hoveredTip ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-[#e94560]/70 font-bold mb-1 flex items-center gap-1.5">
                {BLOCK_CONFIGS[hoveredTip].name}
                <span className="text-[9px] text-gray-500 font-mono normal-case tracking-normal">[{BLOCK_CONFIGS[hoveredTip].hotkey.toUpperCase()}]</span>
              </div>
              <div className="text-[11px] text-gray-300 leading-snug">{BLOCK_CONFIGS[hoveredTip].tip}</div>
            </>
          ) : (
            <div className="text-[10px] text-gray-600 italic leading-snug">Hover a block to see what it does.</div>
          )}
        </div>

        <div className="mt-auto pt-3 border-t border-white/5">
          <button
            onClick={() => setShowTemplates(true)}
            className="w-full px-3 py-2.5 mb-2 rounded-lg text-[11px] font-bold tracking-wide bg-gradient-to-r from-[#e94560]/30 to-[#7c4dff]/30 text-white hover:from-[#e94560]/50 hover:to-[#7c4dff]/50 cursor-pointer border border-white/10 transition-all"
          >
            ✨ Load Example
          </button>
          <div className="flex gap-2 mb-3">
            <button
              onClick={handleExport}
              disabled={blocks.length === 0}
              className="flex-1 px-3 py-2 rounded-lg text-[10px] font-semibold bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 cursor-pointer border border-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Share code
            </button>
            <button
              onClick={handleImport}
              className="flex-1 px-3 py-2 rounded-lg text-[10px] font-semibold bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 cursor-pointer border border-white/5 transition-all"
            >
              Load code
            </button>
          </div>
          <div className="text-[10px] text-gray-600 leading-relaxed space-y-0.5">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Controls</div>
            <div>Click: place · pick up</div>
            <div>Left-drag: paint · replace</div>
            <div>Right-click: rotate</div>
            <div className="text-red-300/70">Right-drag: erase</div>
            <div>E: eraser mode · Del: erase hovered</div>
            <div>Ctrl+Z / Ctrl+Y: Undo / Redo</div>
            <div className="text-gray-700 mt-1">Sim: Hold 1-5 for powered · Space speed · R stop</div>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-[72px] bg-gradient-to-r from-[#16213e] to-[#141d33] border-b border-[#1a3a6e]/40 flex items-center px-6 gap-3">
          {mode === 'edit' && (
            <>
              <button
                onClick={handleRun}
                disabled={!ballPlaced}
                className={`px-10 py-3.5 rounded-xl font-bold text-base tracking-wide transition-all ${
                  ballPlaced
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                }`}
              >
                ▶ Run
              </button>

              {/* Undo / Redo cluster */}
              <div className="flex items-center bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                <button
                  onClick={handleUndo}
                  disabled={undoCount === 0}
                  title="Undo (Ctrl+Z)"
                  className="px-3 py-2.5 text-base text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
                >↶</button>
                <div className="w-px h-6 bg-white/10" />
                <button
                  onClick={handleRedo}
                  disabled={redoCount === 0}
                  title="Redo (Ctrl+Y)"
                  className="px-3 py-2.5 text-base text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
                >↷</button>
              </div>

              <button
                onClick={handleReset}
                title="Clear everything (undoable with Ctrl+Z)"
                className="px-4 py-2.5 rounded-xl font-semibold text-sm bg-white/5 text-gray-300 hover:bg-white/10 hover:text-red-300 border border-white/5 hover:border-red-400/40 transition-all cursor-pointer"
              >
                ✕ Clear
              </button>

              {/* Build summary chip */}
              {blocks.length > 0 && (
                <div className="flex items-center gap-4 bg-white/[0.04] border border-white/5 rounded-xl px-4 py-2 text-[11px]">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-gray-500">Blocks</div>
                    <div className="text-white font-bold text-sm leading-tight">{blocks.filter(b => b.type !== 'ball').length}</div>
                  </div>
                  <div className="w-px h-8 bg-white/10" />
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-gray-500">Spent</div>
                    <div className="text-yellow-400/90 font-bold text-sm leading-tight">{STARTING_COINS - coins}🪙</div>
                  </div>
                </div>
              )}

              {eraserMode && (
                <span className="text-sm text-red-400 bg-red-400/10 px-4 py-2 rounded-lg border border-red-400/30 font-semibold">
                  Eraser (E)
                </span>
              )}
              {selectedBlock && preRotation > 0 && (
                <span className="text-xs text-gray-400 bg-white/5 px-3 py-1.5 rounded-lg">
                  {preRotation * 90}°
                </span>
              )}
              {!ballPlaced && !eraserMode && (
                <span className="text-xs text-yellow-400/80 ml-1 animate-pulse">⚠ Place the ball to run</span>
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
                className="px-7 py-3 rounded-xl text-sm font-bold bg-white/5 text-yellow-400 hover:bg-white/10 cursor-pointer border border-yellow-400/20 transition-all"
              >
                {speed}x
              </button>
              <button
                onClick={handleBackToEdit}
                className="px-8 py-3 rounded-xl text-sm font-semibold bg-white/5 text-gray-400 hover:bg-white/10 cursor-pointer border border-white/10 transition-all"
              >
                Stop
              </button>
              <span className="text-[10px] text-gray-600 ml-1">Hold 1-5 for powered blocks</span>
            </>
          )}
          {mode === 'results' && (
            <button
              onClick={handleBackToEdit}
              className="px-10 py-3.5 rounded-xl font-bold text-base bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer transition-all"
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
            onMouseLeave={() => {
              setHoverCell(null);
              paintingRef.current = false;
              lastPaintCellRef.current = null;
              rightDraggingRef.current = false;
              rightDragMovedRef.current = false;
              lastRightCellRef.current = null;
              rightStartCellRef.current = null;
            }}
            className="block w-full h-full"
          />

          {/* Results overlay */}
          {mode === 'results' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-gradient-to-b from-[#16213e] to-[#111d35] border border-[#1a3a6e]/50 rounded-2xl p-9 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)] min-w-[380px]">
                <div className="text-5xl mb-3">{currentDistance >= bestDistance && currentDistance > 0 ? '🏆' : currentDistance > 0 ? '✨' : '💥'}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-[0.2em] mb-1">Distance</div>
                <h2 className="text-5xl font-extrabold text-white mb-1 tracking-tight">
                  {currentDistance.toFixed(1)}<span className="text-lg text-gray-400 ml-1">m</span>
                </h2>
                {currentDistance >= bestDistance && currentDistance > 0 ? (
                  <p className="text-yellow-400 text-sm mb-6 font-semibold tracking-wide">★ New personal best ★</p>
                ) : (
                  <p className="text-gray-500 text-sm mb-6">
                    Best: <span className="text-yellow-400/80">{bestDistance.toFixed(1)}m</span>
                  </p>
                )}

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-3 mb-7">
                  <div className="bg-white/5 rounded-lg py-2.5">
                    <div className="text-[9px] text-gray-500 uppercase tracking-wider">Peak Speed</div>
                    <div className="text-base font-bold text-cyan-300 mt-0.5">{lastRunStats.peakMs.toFixed(0)}<span className="text-[10px] text-gray-500 ml-0.5">m/s</span></div>
                  </div>
                  <div className="bg-white/5 rounded-lg py-2.5">
                    <div className="text-[9px] text-gray-500 uppercase tracking-wider">Run Time</div>
                    <div className="text-base font-bold text-emerald-300 mt-0.5">{lastRunStats.seconds.toFixed(1)}<span className="text-[10px] text-gray-500 ml-0.5">s</span></div>
                  </div>
                  <div className="bg-white/5 rounded-lg py-2.5">
                    <div className="text-[9px] text-gray-500 uppercase tracking-wider">Blocks</div>
                    <div className="text-base font-bold text-fuchsia-300 mt-0.5">{lastRunStats.blocks}</div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 items-stretch">
                  <button
                    onClick={handleTryAgain}
                    className="px-12 py-3.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)] cursor-pointer text-base transition-all"
                  >
                    ↻ Try again
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={handleBackToEdit}
                      className="flex-1 px-4 py-2.5 rounded-xl font-semibold bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10 cursor-pointer text-sm transition-all"
                    >
                      ← Edit
                    </button>
                    <button
                      onClick={handleCopyResult}
                      className="flex-1 px-4 py-2.5 rounded-xl font-semibold bg-white/5 text-gray-200 hover:bg-white/10 border border-white/10 cursor-pointer text-sm transition-all"
                    >
                      Share result
                    </button>
                  </div>
                </div>
                <div className="text-[10px] text-gray-600 mt-3">Press R or Esc to go back</div>
              </div>
            </div>
          )}

          {/* Powered keys discovery toast */}
          {poweredHint && mode === 'running' && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md border border-yellow-400/30 rounded-xl px-5 py-3 shadow-lg z-10 animate-pulse">
              <div className="text-yellow-300 text-sm font-bold tracking-wide">⚡ Hold 1-5 to fire powered blocks</div>
              <div className="text-[10px] text-gray-400 mt-0.5">1 Piston · 2 Black Hole · 3 White Hole · 4 Portal · 5 Bomb</div>
            </div>
          )}

          {/* Copy toast */}
          {copyToast && (
            <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 bg-black/80 border border-emerald-400/30 rounded-xl px-4 py-2 shadow-lg z-30">
              <div className="text-emerald-300 text-sm font-semibold">{copyToast}</div>
            </div>
          )}

          {/* Templates modal */}
          {showTemplates && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md z-20"
              onClick={() => setShowTemplates(false)}
            >
              <div
                className="bg-gradient-to-b from-[#16213e] to-[#111d35] border border-[#1a3a6e]/50 rounded-2xl p-7 shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-[640px] max-w-[92vw]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white tracking-wide">Example builds</h3>
                  <button
                    onClick={() => setShowTemplates(false)}
                    className="text-gray-400 hover:text-white text-xl leading-none w-6 h-6 flex items-center justify-center"
                  >×</button>
                </div>
                <p className="text-xs text-gray-500 mb-4">Loading one will replace your current build (undo with Ctrl+Z).</p>
                <div className="grid grid-cols-2 gap-3">
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => handleLoadTemplate(tpl.id)}
                      className="text-left p-4 rounded-xl bg-gradient-to-br from-[#0f3460] to-[#0d2b52] hover:from-[#1a4682] hover:to-[#143368] border border-white/5 hover:border-[#e94560]/50 cursor-pointer transition-all"
                    >
                      <div className="text-base font-bold text-white mb-1">{tpl.name}</div>
                      <div className="text-[11px] text-gray-400 leading-snug">{tpl.blurb}</div>
                      <div className="text-[10px] text-gray-600 mt-2">{tpl.blocks.length} blocks</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Share modal */}
          {shareModal && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md z-20"
              onClick={() => setShareModal(null)}
            >
              <div
                className="bg-gradient-to-b from-[#16213e] to-[#111d35] border border-[#1a3a6e]/50 rounded-2xl p-7 shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-[480px] max-w-[90vw]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-white tracking-wide">
                    {shareModal === 'export' ? 'Share your build' : 'Load a build'}
                  </h3>
                  <button
                    onClick={() => setShareModal(null)}
                    className="text-gray-400 hover:text-white text-xl leading-none w-6 h-6 flex items-center justify-center"
                  >×</button>
                </div>

                {shareModal === 'export' ? (
                  <>
                    <p className="text-xs text-gray-400 mb-2">Copy this code and send it to anyone.</p>
                    <textarea
                      readOnly
                      value={exportedCode}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full h-32 bg-black/30 border border-white/10 rounded-lg p-3 text-[11px] font-mono text-emerald-300 resize-none break-all"
                    />
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(exportedCode); } catch {}
                        }}
                        className="flex-1 px-4 py-2.5 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer text-sm"
                      >Copy to clipboard</button>
                      <button
                        onClick={() => setShareModal(null)}
                        className="px-4 py-2.5 rounded-lg font-semibold bg-white/5 text-gray-300 hover:bg-white/10 cursor-pointer text-sm"
                      >Done</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 mb-2">Paste a share code below. This will replace your current build.</p>
                    <textarea
                      value={importText}
                      onChange={(e) => { setImportText(e.target.value); setImportError(''); }}
                      placeholder="FT2|..."
                      className="w-full h-32 bg-black/30 border border-white/10 rounded-lg p-3 text-[11px] font-mono text-cyan-300 resize-none break-all"
                    />
                    {importError && <p className="text-red-400 text-xs mt-2">{importError}</p>}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => applyImport(importText)}
                        className="flex-1 px-4 py-2.5 rounded-lg font-semibold bg-cyan-600 text-white hover:bg-cyan-500 cursor-pointer text-sm"
                      >Load build</button>
                      <button
                        onClick={() => setShareModal(null)}
                        className="px-4 py-2.5 rounded-lg font-semibold bg-white/5 text-gray-300 hover:bg-white/10 cursor-pointer text-sm"
                      >Cancel</button>
                    </div>
                  </>
                )}
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

                <div className="flex flex-col gap-2 items-center">
                  <button
                    onClick={() => setShowIntro(false)}
                    className="px-16 py-4 rounded-2xl font-bold bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] cursor-pointer text-xl tracking-wide transition-all"
                  >
                    Build from scratch
                  </button>
                  <button
                    onClick={() => { setShowIntro(false); setShowTemplates(true); }}
                    className="px-12 py-2.5 rounded-xl font-semibold text-sm bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 cursor-pointer transition-all"
                  >
                    ✨ Start from an example
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
