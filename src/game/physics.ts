import Matter from 'matter-js';
import {
  CELL_SIZE,
  BUILD_HEIGHT,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_FRICTION,
  BALL_DENSITY,
  BOUNCY_RESTITUTION,
  ICE_FRICTION,
  CURVE_FRICTION,
  CURVE_RESTITUTION,
  SOLID_FRICTION,
  RAMP_FRICTION,
  GRAVITY_WELL_RADIUS,
  GRAVITY_WELL_STRENGTH,
  PISTON_FORCE,
  BOMB_FORCE,
  FAN_FORCE,
  FAN_RANGE,
  GRAVITY_PAD_STRENGTH,
  GRAVITY_PAD_DURATION,
  PORTAL_RADIUS,
  PORTAL_COOLDOWN,
  PORTAL_BOOST,
  WHITEHOLE_RANGE,
  WHITEHOLE_FORCE,
  WHITEHOLE_CONE,
  BOOSTER_KICK,
  BOOSTER_MULT,
  BOOSTER_COOLDOWN,
  FLOOR_THICKNESS,
  FLOOR_EXTEND_RIGHT,
  FLOOR_EXTEND_LEFT,
  CEILING_HEIGHT,
  PHYSICS_DT,
  REAL_FRAME_MS,
  SUBSTEPS_PER_FRAME,
  MAX_SUBSTEPS_PER_FRAME,
  SAFE_PX_PER_SUBSTEP,
  MAX_BALL_SPEED,
  SHAKE_DECAY,
  GRID_ROWS,
  BlockType,
} from './constants';
import { PlacedBlock } from './types';
import { getRampVertices, getCurveVertices } from './renderer';

const { Engine, World, Bodies, Body, Events } = Matter;

const DIRS: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Slope velocity redirect (shared by ramps and curves).
 *
 * Conventions (matches user visual intuition of the block art):
 *   rotation 0 (slope `/`)  : convert downward motion → rightward
 *   rotation 1 (slope `\`)  : convert downward motion → leftward
 *   rotation 2 (inverted `/`): convert rightward motion → downward
 *   rotation 3 (inverted `\`): convert downward motion → rightward (ski-jump)
 */
function slopeRedirect(rotation: number, vx: number, vy: number) {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 0.5) return null;
  const KEEP = 0.92;
  let nvx = vx;
  let nvy = vy;
  let fired = false;
  switch (rotation % 4) {
    case 0:
      if (Math.abs(vy) > Math.abs(vx)) {
        nvx = speed * KEEP;
        nvy = -speed * 0.2;
        fired = true;
      }
      break;
    case 1:
      if (Math.abs(vy) > Math.abs(vx)) {
        nvx = -speed * KEEP;
        nvy = -speed * 0.2;
        fired = true;
      }
      break;
    case 2:
      if (Math.abs(vx) > Math.abs(vy)) {
        nvx = -speed * 0.2;
        nvy = speed * KEEP;
        fired = true;
      }
      break;
    case 3:
      if (Math.abs(vy) > Math.abs(vx) * 0.5) {
        nvx = speed * KEEP;
        nvy = speed * 0.2;
        fired = true;
      }
      break;
  }
  return fired ? { vx: nvx, vy: nvy, speed } : null;
}

export function createPhysicsBody(block: PlacedBlock, offsetX: number, offsetY: number): Matter.Body | null {
  const cx = offsetX + block.col * CELL_SIZE + CELL_SIZE / 2;
  const cy = offsetY + block.row * CELL_SIZE + CELL_SIZE / 2;
  const h = CELL_SIZE / 2;

  switch (block.type) {
    case 'solid':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: SOLID_FRICTION,
        chamfer: { radius: 1 },
      });
    case 'ramp': {
      const verts = getRampVertices(block.rotation, h);
      const centroidX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const centroidY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
      return Bodies.fromVertices(cx + centroidX, cy + centroidY, [verts], {
        isStatic: true,
        friction: RAMP_FRICTION,
        label: `ramp_${block.col}_${block.row}_${block.rotation}`,
      });
    }
    case 'curve': {
      const verts = getCurveVertices(block.rotation, h);
      const centroidX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const centroidY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
      return Bodies.fromVertices(cx + centroidX, cy + centroidY, [verts], {
        isStatic: true,
        friction: CURVE_FRICTION,
        restitution: CURVE_RESTITUTION,
        label: `curve_${block.col}_${block.row}_${block.rotation}`,
      });
    }
    case 'ice':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: ICE_FRICTION,
        frictionStatic: 0,
        restitution: 0.1,
      });
    case 'bouncy':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        restitution: BOUNCY_RESTITUTION,
        friction: 0.005,
        label: `bouncy_${block.col}_${block.row}`,
      });
    case 'booster':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: 0,
        restitution: 0.2,
        label: `booster_${block.col}_${block.row}_${block.rotation}`,
      });
    case 'piston':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE * 0.5, {
        isStatic: true,
        friction: 0.3,
      });
    default:
      return null;
  }
}

export interface SimulationStats {
  peakSpeed: number;     // px/substep (display via SPEED_TO_MS)
  bounces: number;       // ball-vs-anything collision count
  frames: number;        // total render frames since start
}

/**
 * Per-block dynamic state during a simulation.
 *
 * `origKey` is the placement key from the build (immutable; used to index
 * cooldown / removed maps). `col`/`row`/`rotation` reflect the block's
 * *current* position, which can change at runtime (pistons push them).
 * `body` is the static physics body that gets `Body.setPosition`-ed when
 * the block is shoved.
 */
export interface DynBlock {
  origKey: string;
  type: BlockType;
  col: number;
  row: number;
  rotation: number;
  body: Matter.Body | null;
}

export interface SimulationState {
  engine: Matter.Engine;
  ballBody: Matter.Body;
  dynBlocks: DynBlock[];
  pistonArms: Map<string, Matter.Body>;
  removedBombs: Set<string>;
  portalCooldown: number;
  boosterCooldowns: Map<string, number>;
  gravityEffect: { dx: number; dy: number; framesLeft: number } | null;
  shockwaves: { x: number; y: number; frame: number }[];
  boostFlashes: { x: number; y: number; frame: number }[];
  speedScale: number;
  ox: number;
  oy: number;
  stats: SimulationStats;
  shake: { x: number; y: number; intensity: number };
  // Adaptive substepping: remember where the ball was a frame ago so we
  // can estimate how many substeps we need *this* frame to keep per-step
  // motion below SAFE_PX_PER_SUBSTEP.
  prevBallPos: { x: number; y: number } | null;
  lastSubstepDt: number;
}

// Anti-tunneling is now enforced by adaptive substepping in stepSimulation()
// (per-substep motion is held below SAFE_PX_PER_SUBSTEP, which is well under
// CELL_SIZE). MAX_BALL_SPEED is therefore just a numerical sanity bound — it
// can safely exceed CELL_SIZE. BOUNCY_RESTITUTION should still leave at least
// one cell of headroom (post-impulse speed × dt ratio < CELL_SIZE).
const MAX_ANGULAR_VELOCITY = 8; // rad/step — visual sanity; ~76 rev/s at 60Hz

function clampBallSpeed(ball: Matter.Body) {
  const v = ball.velocity;
  const s = Math.sqrt(v.x * v.x + v.y * v.y);
  if (s > MAX_BALL_SPEED) {
    const r = MAX_BALL_SPEED / s;
    Body.setVelocity(ball, { x: v.x * r, y: v.y * r });
  }
  if (Math.abs(ball.angularVelocity) > MAX_ANGULAR_VELOCITY) {
    Body.setAngularVelocity(ball, Math.sign(ball.angularVelocity) * MAX_ANGULAR_VELOCITY);
  }
}

export function startSimulation(
  blocks: PlacedBlock[],
  ox: number,
  oy: number,
): SimulationState | null {
  const ballBlock = blocks.find((b) => b.type === 'ball');
  if (!ballBlock) return null;

  const engine = Engine.create({
    gravity: { x: 0, y: 1, scale: 0.001 },
    positionIterations: 20,
    velocityIterations: 14,
    constraintIterations: 6,
  });

  const floor = Bodies.rectangle(
    ox + (FLOOR_EXTEND_RIGHT - FLOOR_EXTEND_LEFT) / 2 - FLOOR_EXTEND_LEFT / 2,
    oy + BUILD_HEIGHT + FLOOR_THICKNESS / 2,
    FLOOR_EXTEND_RIGHT + FLOOR_EXTEND_LEFT,
    FLOOR_THICKNESS,
    { isStatic: true, friction: 0.25, restitution: 0.55, label: 'floor' },
  );

  const leftWall = Bodies.rectangle(ox - 20, oy + BUILD_HEIGHT / 2, 40, BUILD_HEIGHT + 400, {
    isStatic: true,
  });

  // High ceiling: prevents the ball from ever escaping the world upwards.
  const ceiling = Bodies.rectangle(
    ox + FLOOR_EXTEND_RIGHT / 2,
    oy - CEILING_HEIGHT,
    FLOOR_EXTEND_RIGHT + FLOOR_EXTEND_LEFT,
    100,
    { isStatic: true, friction: 0, restitution: 0.4, label: 'ceiling' },
  );

  const bodiesToAdd: Matter.Body[] = [floor, leftWall, ceiling];

  const bx = ox + ballBlock.col * CELL_SIZE + CELL_SIZE / 2;
  const by = oy + ballBlock.row * CELL_SIZE + CELL_SIZE / 2;
  const ballBody = Bodies.circle(bx, by, BALL_RADIUS, {
    restitution: BALL_RESTITUTION,
    friction: BALL_FRICTION,
    density: BALL_DENSITY,
    frictionAir: 0.0005,
    label: 'ball',
    slop: 0.005,
  });
  bodiesToAdd.push(ballBody);

  const dynBlocks: DynBlock[] = [];
  blocks.forEach((block) => {
    if (block.type === 'ball') return;
    const body = createPhysicsBody(block, ox, oy);
    if (body) bodiesToAdd.push(body);
    dynBlocks.push({
      origKey: `${block.col},${block.row}`,
      type: block.type,
      col: block.col,
      row: block.row,
      rotation: block.rotation,
      body,
    });
  });

  World.add(engine.world, bodiesToAdd);

  const sim: SimulationState = {
    engine,
    ballBody,
    dynBlocks,
    pistonArms: new Map(),
    removedBombs: new Set(),
    portalCooldown: 0,
    boosterCooldowns: new Map(),
    gravityEffect: null,
    shockwaves: [],
    boostFlashes: [],
    speedScale: 1,
    ox,
    oy,
    stats: { peakSpeed: 0, bounces: 0, frames: 0 },
    shake: { x: 0, y: 0, intensity: 0 },
    prevBallPos: null,
    lastSubstepDt: PHYSICS_DT,
  };

  // Unified slope redirect handler — ramps and curves share conventions so
  // rotation N has the same effect on either block type. Also sets angular
  // velocity to match the new direction so visible spin tracks the redirect.
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      const slopeBody =
        bodyA.label?.startsWith('curve_') || bodyA.label?.startsWith('ramp_') ? bodyA
        : bodyB.label?.startsWith('curve_') || bodyB.label?.startsWith('ramp_') ? bodyB
        : null;
      if (!slopeBody) return;
      const otherBody = slopeBody === bodyA ? bodyB : bodyA;
      if (otherBody.label !== 'ball') return;

      const parts = slopeBody.label!.split('_');
      const rotation = parseInt(parts[3]);
      const redirected = slopeRedirect(rotation, otherBody.velocity.x, otherBody.velocity.y);
      if (!redirected) return;

      Body.setVelocity(otherBody, { x: redirected.vx, y: redirected.vy });
      // Forward spin: rolling-without-slipping. Sign from horizontal direction.
      const spin = redirected.vx / BALL_RADIUS;
      Body.setAngularVelocity(otherBody, spin);
    });
  });

  // Booster: kick ball in arrow direction on contact
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      const boosterBody = bodyA.label?.startsWith('booster_') ? bodyA
        : bodyB.label?.startsWith('booster_') ? bodyB : null;
      if (!boosterBody) return;
      const otherBody = boosterBody === bodyA ? bodyB : bodyA;
      if (otherBody.label !== 'ball') return;

      const parts = boosterBody.label!.split('_');
      const col = parseInt(parts[1]);
      const row = parseInt(parts[2]);
      const rotation = parseInt(parts[3]);
      const key = `${col},${row}`;

      const cd = sim.boosterCooldowns.get(key) ?? 0;
      if (cd > 0) return;

      const [dx, dy] = DIRS[rotation % 4];
      const v = otherBody.velocity;
      const along = v.x * dx + v.y * dy;
      // amplify aligned speed, ensure minimum
      const newAlong = Math.max(BOOSTER_KICK, along * BOOSTER_MULT);
      // keep perpendicular component to avoid jarring redirects
      const perpX = v.x - along * dx;
      const perpY = v.y - along * dy;
      const finalVx = perpX + dx * newAlong;
      const finalVy = perpY + dy * newAlong;
      Body.setVelocity(otherBody, { x: finalVx, y: finalVy });
      // Match spin to new horizontal direction so the ball doesn't look
      // weirdly still right after a boost.
      Body.setAngularVelocity(otherBody, finalVx / BALL_RADIUS);
      sim.boosterCooldowns.set(key, BOOSTER_COOLDOWN);
      sim.boostFlashes.push({
        x: boosterBody.position.x,
        y: boosterBody.position.y,
        frame: 0,
      });
      sim.shake.intensity = Math.max(sim.shake.intensity, 6);
    });
  });

  // Ball bounce counter (any contact)
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const isBall = pair.bodyA.label === 'ball' || pair.bodyB.label === 'ball';
      if (isBall) sim.stats.bounces++;
    });
  });

  // Floor bounce decay
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      const isFloor = bodyA.label === 'floor' || bodyB.label === 'floor';
      if (!isFloor) return;
      const ball = bodyA.label === 'ball' ? bodyA : bodyB.label === 'ball' ? bodyB : null;
      if (!ball) return;

      const vx = ball.velocity.x;
      const vy = ball.velocity.y;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < 0.5) return;

      // Preserve horizontal momentum, lightly damp vertical so balls visibly
      // bounce 4–5 times before settling instead of going flat in 2.
      const newVx = vx * 0.98;
      const newVy = vy * 0.78;
      Body.setVelocity(ball, { x: newVx, y: newVy });
    });
  });

  return sim;
}

export function stopSimulation(sim: SimulationState) {
  World.clear(sim.engine.world, false);
  Engine.clear(sim.engine);
}

/**
 * Run one render frame of simulation.
 *
 * The number of physics substeps is chosen *dynamically* per frame so each
 * substep moves the ball no more than SAFE_PX_PER_SUBSTEP pixels (well under
 * CELL_SIZE), which keeps tunneling impossible at any reachable ball speed
 * even though MAX_BALL_SPEED is much higher than CELL_SIZE.
 *
 * Total simulated time per frame stays equal to REAL_FRAME_MS × speedScale,
 * so wall-clock pacing and the 90 s timeout don't change as substep counts
 * scale up.
 */
export function stepSimulation(sim: SimulationState) {
  const totalSimMs = REAL_FRAME_MS * sim.speedScale;

  // Estimate this-frame motion from last-frame motion. On the very first
  // frame we have nothing to estimate from, so use the conservative base.
  let pxLastFrame = 0;
  if (sim.prevBallPos) {
    const dx = sim.ballBody.position.x - sim.prevBallPos.x;
    const dy = sim.ballBody.position.y - sim.prevBallPos.y;
    pxLastFrame = Math.sqrt(dx * dx + dy * dy);
  }

  // 30 % headroom so a mid-frame acceleration (booster, bomb) doesn't
  // immediately push per-substep motion over the limit.
  const desired = Math.ceil((pxLastFrame * 1.3) / SAFE_PX_PER_SUBSTEP);
  const substeps = Math.max(
    SUBSTEPS_PER_FRAME,
    Math.min(MAX_SUBSTEPS_PER_FRAME, desired),
  );
  const dt = totalSimMs / substeps;
  sim.lastSubstepDt = dt;

  for (let i = 0; i < substeps; i++) {
    clampBallSpeed(sim.ballBody);
    Engine.update(sim.engine, dt);
    const v = sim.ballBody.velocity;
    const s = Math.sqrt(v.x * v.x + v.y * v.y);
    if (s > sim.stats.peakSpeed) sim.stats.peakSpeed = s;
  }
  clampBallSpeed(sim.ballBody);

  sim.prevBallPos = { x: sim.ballBody.position.x, y: sim.ballBody.position.y };
  sim.stats.frames++;

  // Shake decay + jitter sample
  if (sim.shake.intensity > 0.1) {
    sim.shake.x = (Math.random() - 0.5) * sim.shake.intensity * 2;
    sim.shake.y = (Math.random() - 0.5) * sim.shake.intensity * 2;
    sim.shake.intensity *= SHAKE_DECAY;
  } else {
    sim.shake.intensity = 0;
    sim.shake.x = 0;
    sim.shake.y = 0;
  }
}

export function setSimulationSpeed(sim: SimulationState, speed: number) {
  sim.speedScale = speed;
}

const PISTON_PUSH_MAX_CHAIN = 12;

/**
 * Shove the row of blocks sitting in front of `piston` one cell along
 * (`dx`, `dy`). Used when a piston transitions from inactive -> active.
 *
 * Rules:
 *   - Stops walking when it hits an empty cell (that's where the chain
 *     will end up).
 *   - Refuses to push another piston (avoids tangled chain interactions
 *     when both have arms extended).
 *   - Refuses to push blocks off the top of the grid or down into the
 *     floor (those would clip into the world bodies).
 *   - Off the right or left edge of the *build grid* is allowed — the
 *     world extends well beyond it in both directions.
 *   - Capped at PISTON_PUSH_MAX_CHAIN for sanity.
 */
function pistonPushChain(
  sim: SimulationState,
  piston: DynBlock,
  dx: number,
  dy: number,
) {
  const chain: DynBlock[] = [];
  let cx = piston.col + dx;
  let cy = piston.row + dy;
  while (true) {
    const at = sim.dynBlocks.find(
      (d) => d !== piston && d.col === cx && d.row === cy
        && !(d.type === 'bomb' && sim.removedBombs.has(d.origKey)),
    );
    if (!at) break;
    if (at.type === 'piston') return;
    chain.push(at);
    cx += dx;
    cy += dy;
    if (chain.length > PISTON_PUSH_MAX_CHAIN) return;
  }
  if (chain.length === 0) return;

  // Reject the push if anything would clip into the floor or ceiling.
  for (const b of chain) {
    const newRow = b.row + dy;
    if (newRow < 0 || newRow >= GRID_ROWS) return;
  }

  // Shift in reverse so the leading block clears its cell before the next
  // one slides in (no overlapping intermediate positions).
  for (let i = chain.length - 1; i >= 0; i--) {
    const b = chain[i];
    b.col += dx;
    b.row += dy;
    if (b.body) {
      Body.setPosition(b.body, {
        x: sim.ox + b.col * CELL_SIZE + CELL_SIZE / 2,
        y: sim.oy + b.row * CELL_SIZE + CELL_SIZE / 2,
      });
    }
  }
}

export function applyBlockEffects(
  sim: SimulationState,
  activeTypes: Set<BlockType>,
  _blocks: PlacedBlock[],   // legacy param; we iterate sim.dynBlocks now
  ox: number,
  oy: number,
): boolean {
  void _blocks;
  const { engine, ballBody, pistonArms, removedBombs } = sim;

  if (sim.portalCooldown > 0) sim.portalCooldown--;

  // booster cooldowns
  sim.boosterCooldowns.forEach((v, k) => {
    if (v <= 1) sim.boosterCooldowns.delete(k);
    else sim.boosterCooldowns.set(k, v - 1);
  });

  if (sim.gravityEffect) {
    Body.applyForce(ballBody, ballBody.position, {
      x: sim.gravityEffect.dx,
      y: sim.gravityEffect.dy,
    });
    sim.gravityEffect.framesLeft--;
    if (sim.gravityEffect.framesLeft <= 0) {
      sim.gravityEffect = null;
    }
  }

  sim.shockwaves = sim.shockwaves.filter((s) => s.frame < 30);
  sim.shockwaves.forEach((s) => s.frame++);
  sim.boostFlashes = sim.boostFlashes.filter((s) => s.frame < 18);
  sim.boostFlashes.forEach((s) => s.frame++);

  sim.dynBlocks.forEach((dyn) => {
    const key = dyn.origKey;
    const bcx = ox + dyn.col * CELL_SIZE + CELL_SIZE / 2;
    const bcy = oy + dyn.row * CELL_SIZE + CELL_SIZE / 2;

    switch (dyn.type) {
      case 'fan': {
        const [fdx, fdy] = DIRS[dyn.rotation % 4];
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < FAN_RANGE && dist > 1) {
          const dot = dx * fdx + dy * fdy;
          if (dot > 0) {
            // narrow cone: stronger when aligned with axis
            const lateral = Math.abs(dx * fdy - dy * fdx);
            const lateralFactor = Math.max(0, 1 - lateral / (CELL_SIZE * 2.2));
            const falloff = 1 - dist / FAN_RANGE;
            const f = FAN_FORCE * falloff * lateralFactor;
            Body.applyForce(ballBody, ballBody.position, {
              x: fdx * f,
              y: fdy * f,
            });
          }
        }
        break;
      }
      case 'gravitypad': {
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CELL_SIZE * 0.85 && !sim.gravityEffect) {
          const [gdx, gdy] = DIRS[dyn.rotation % 4];
          sim.gravityEffect = {
            dx: gdx * GRAVITY_PAD_STRENGTH,
            dy: gdy * GRAVITY_PAD_STRENGTH,
            framesLeft: GRAVITY_PAD_DURATION,
          };
        }
        break;
      }
      case 'piston': {
        const active = activeTypes.has('piston');
        const hasArm = pistonArms.has(key);
        if (active && !hasArm) {
          const [pdx, pdy] = DIRS[dyn.rotation % 4];

          // Shove any blocks in front by one cell on this activation.
          pistonPushChain(sim, dyn, pdx, pdy);

          const armCx = ox + dyn.col * CELL_SIZE + CELL_SIZE / 2 + pdx * CELL_SIZE;
          const armCy = oy + dyn.row * CELL_SIZE + CELL_SIZE / 2 + pdy * CELL_SIZE;
          const arm = Bodies.rectangle(armCx, armCy, CELL_SIZE * 0.8, CELL_SIZE * 0.8, {
            isStatic: true,
            friction: 0.3,
            restitution: 0.4,
          });
          World.add(engine.world, arm);
          pistonArms.set(key, arm);

          const dist = Math.sqrt(
            (ballBody.position.x - armCx) ** 2 + (ballBody.position.y - armCy) ** 2,
          );
          if (dist < CELL_SIZE * 1.8) {
            Body.applyForce(ballBody, ballBody.position, {
              x: pdx * PISTON_FORCE,
              y: pdy * PISTON_FORCE,
            });
          }
          sim.shake.intensity = Math.max(sim.shake.intensity, 4);
        } else if (!active && hasArm) {
          const arm = pistonArms.get(key)!;
          World.remove(engine.world, arm);
          pistonArms.delete(key);
        }
        break;
      }
      case 'blackhole': {
        if (!activeTypes.has('blackhole')) break;
        const dx = bcx - ballBody.position.x;
        const dy = bcy - ballBody.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < GRAVITY_WELL_RADIUS && dist > 1) {
          const force = GRAVITY_WELL_STRENGTH / (dist * dist) * CELL_SIZE * CELL_SIZE;
          Body.applyForce(ballBody, ballBody.position, {
            x: (dx / dist) * force,
            y: (dy / dist) * force,
          });
        }
        break;
      }
      case 'whitehole': {
        if (!activeTypes.has('whitehole')) break;
        // Directional jet along rotation arrow
        const [wdx, wdy] = DIRS[dyn.rotation % 4];
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < WHITEHOLE_RANGE && dist > 1) {
          const along = (dx * wdx + dy * wdy) / dist; // -1..1
          if (along > 0) {
            // mostly axial force, tapered by distance and cone
            const cone = Math.max(0, (along - (1 - WHITEHOLE_CONE)) / WHITEHOLE_CONE);
            const falloff = 1 - dist / WHITEHOLE_RANGE;
            const f = WHITEHOLE_FORCE * falloff * cone;
            Body.applyForce(ballBody, ballBody.position, {
              x: wdx * f,
              y: wdy * f,
            });
          } else {
            // gentle suck-in from behind so ball can drop into the jet
            const force = (WHITEHOLE_FORCE * 0.15) * (1 - dist / WHITEHOLE_RANGE);
            Body.applyForce(ballBody, ballBody.position, {
              x: -(dx / dist) * force,
              y: -(dy / dist) * force,
            });
          }
        }
        break;
      }
      case 'portal': {
        if (sim.portalCooldown > 0) break;
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PORTAL_RADIUS) {
          const allPortals = sim.dynBlocks.filter((d) => d.type === 'portal');
          const myIndex = allPortals.findIndex((p) => p.origKey === dyn.origKey);
          const pairedIndex = myIndex % 2 === 0 ? myIndex + 1 : myIndex - 1;
          const paired = allPortals[pairedIndex];
          if (paired) {
            const targetX = ox + paired.col * CELL_SIZE + CELL_SIZE / 2;
            const targetY = oy + paired.row * CELL_SIZE + CELL_SIZE / 2;
            Body.setPosition(ballBody, { x: targetX, y: targetY });
            Body.setVelocity(ballBody, {
              x: ballBody.velocity.x * PORTAL_BOOST,
              y: ballBody.velocity.y * PORTAL_BOOST,
            });
            sim.portalCooldown = PORTAL_COOLDOWN;
          }
        }
        break;
      }
      case 'bomb': {
        if (!activeTypes.has('bomb') || removedBombs.has(key)) break;
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          Body.applyForce(ballBody, ballBody.position, {
            x: (dx / dist) * BOMB_FORCE,
            y: (dy / dist) * BOMB_FORCE,
          });
        }
        removedBombs.add(key);
        sim.shockwaves.push({ x: bcx, y: bcy, frame: 0 });
        sim.shake.intensity = Math.max(sim.shake.intensity, 18);
        break;
      }
    }
  });

  // capture removed - black holes are pure slingshot now
  return false;
}
