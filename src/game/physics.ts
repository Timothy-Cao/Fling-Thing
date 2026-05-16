import Matter from 'matter-js';
import {
  CELL_SIZE,
  BUILD_WIDTH,
  BUILD_HEIGHT,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_FRICTION,
  BALL_DENSITY,
  BOUNCY_RESTITUTION,
  ICE_FRICTION,
  CURVE_FRICTION,
  STICKY_FRICTION,
  STICKY_RESTITUTION,
  GRAVITY_WELL_RADIUS,
  GRAVITY_WELL_STRENGTH,
  BLACKHOLE_CAPTURE_RADIUS,
  PISTON_FORCE,
  BOMB_FORCE,
  FAN_FORCE,
  FAN_RANGE,
  GRAVITY_PAD_STRENGTH,
  GRAVITY_PAD_DURATION,
  PORTAL_RADIUS,
  PORTAL_COOLDOWN,
  POWERED_TYPES,
  FLOOR_THICKNESS,
  FLOOR_EXTEND_RIGHT,
} from './constants';
import { PlacedBlock } from './types';
import { getRampVertices, getCurveVertices } from './renderer';

const { Engine, World, Bodies, Runner, Body, Events } = Matter;

export function createPhysicsBody(block: PlacedBlock, offsetX: number, offsetY: number): Matter.Body | null {
  const cx = offsetX + block.col * CELL_SIZE + CELL_SIZE / 2;
  const cy = offsetY + block.row * CELL_SIZE + CELL_SIZE / 2;
  const h = CELL_SIZE / 2;

  switch (block.type) {
    case 'solid':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: 0.5,
      });
    case 'ramp': {
      const verts = getRampVertices(block.rotation, h);
      const centroidX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const centroidY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
      return Bodies.fromVertices(cx + centroidX, cy + centroidY, [verts], {
        isStatic: true,
        friction: 0.3,
      });
    }
    case 'curve': {
      const verts = getCurveVertices(block.rotation, h);
      const centroidX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const centroidY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
      return Bodies.fromVertices(cx + centroidX, cy + centroidY, [verts], {
        isStatic: true,
        friction: CURVE_FRICTION,
      });
    }
    case 'ice':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: ICE_FRICTION,
      });
    case 'bouncy':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        restitution: BOUNCY_RESTITUTION,
        friction: 0.01,
      });
    case 'sticky':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: STICKY_FRICTION,
        restitution: STICKY_RESTITUTION,
      });
    case 'glass':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, {
        isStatic: true,
        friction: 0.3,
        label: `glass_${block.col}_${block.row}`,
      });
    case 'piston':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE * 0.5, {
        isStatic: true,
        friction: 0.5,
      });
    // fan, gravitypad, blackhole, whitehole, portal, bomb have no resting physics body
    default:
      return null;
  }
}

export interface SimulationState {
  engine: Matter.Engine;
  runner: Matter.Runner;
  ballBody: Matter.Body;
  pistonArms: Map<string, Matter.Body>;
  removedBombs: Set<string>;
  glassBodies: Map<string, Matter.Body>;
  brokenGlass: Set<string>;
  portalCooldown: number;
  gravityEffect: { dx: number; dy: number; framesLeft: number } | null;
  shockwaves: { x: number; y: number; frame: number }[];
}

function blockKey(block: PlacedBlock): string {
  return `${block.col},${block.row}`;
}

export function startSimulation(
  blocks: PlacedBlock[],
  ox: number,
  oy: number,
): SimulationState | null {
  const ballBlock = blocks.find((b) => b.type === 'ball');
  if (!ballBlock) return null;

  const engine = Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } });

  const floor = Bodies.rectangle(
    ox + FLOOR_EXTEND_RIGHT / 2,
    oy + BUILD_HEIGHT + FLOOR_THICKNESS / 2,
    FLOOR_EXTEND_RIGHT,
    FLOOR_THICKNESS,
    { isStatic: true, friction: 0.5 },
  );

  const leftWall = Bodies.rectangle(ox - 20, oy + BUILD_HEIGHT / 2, 40, BUILD_HEIGHT + 200, {
    isStatic: true,
  });

  const bodiesToAdd: Matter.Body[] = [floor, leftWall];

  const bx = ox + ballBlock.col * CELL_SIZE + CELL_SIZE / 2;
  const by = oy + ballBlock.row * CELL_SIZE + CELL_SIZE / 2;
  const ballBody = Bodies.circle(bx, by, BALL_RADIUS, {
    restitution: BALL_RESTITUTION,
    friction: BALL_FRICTION,
    density: BALL_DENSITY,
    frictionAir: 0.001,
    label: 'ball',
  });
  bodiesToAdd.push(ballBody);

  const glassBodies = new Map<string, Matter.Body>();

  blocks.forEach((block) => {
    if (block.type === 'ball') return;
    const body = createPhysicsBody(block, ox, oy);
    if (body) {
      bodiesToAdd.push(body);
      if (block.type === 'glass') {
        glassBodies.set(blockKey(block), body);
      }
    }
  });

  World.add(engine.world, bodiesToAdd);

  const sim: SimulationState = {
    engine,
    runner: Runner.create({ delta: 1000 / 60 }),
    ballBody,
    pistonArms: new Map(),
    removedBombs: new Set(),
    glassBodies,
    brokenGlass: new Set(),
    portalCooldown: 0,
    gravityEffect: null,
    shockwaves: [],
  };

  // Glass collision handler
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      const glassBody = bodyA.label?.startsWith('glass_') ? bodyA
        : bodyB.label?.startsWith('glass_') ? bodyB : null;
      if (!glassBody) return;
      const otherBody = glassBody === bodyA ? bodyB : bodyA;
      if (otherBody.label !== 'ball') return;

      const key = glassBody.label!.replace('glass_', '').replace('_', ',');
      if (!sim.brokenGlass.has(key)) {
        sim.brokenGlass.add(key);
        World.remove(engine.world, glassBody);
        sim.glassBodies.delete(key);
      }
    });
  });

  Runner.run(sim.runner, engine);
  return sim;
}

export function stopSimulation(sim: SimulationState) {
  Runner.stop(sim.runner);
  World.clear(sim.engine.world, false);
  Engine.clear(sim.engine);
}

export function applyBlockEffects(
  sim: SimulationState,
  activeGroups: Set<number>,
  blocks: PlacedBlock[],
  ox: number,
  oy: number,
): boolean {
  let captured = false;
  const { engine, ballBody, pistonArms, removedBombs } = sim;

  // Decrement portal cooldown
  if (sim.portalCooldown > 0) sim.portalCooldown--;

  // Tick gravity pad effect
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

  // Decay shockwaves
  sim.shockwaves = sim.shockwaves.filter((s) => s.frame < 30);
  sim.shockwaves.forEach((s) => s.frame++);

  blocks.forEach((block) => {
    const key = blockKey(block);
    const bcx = ox + block.col * CELL_SIZE + CELL_SIZE / 2;
    const bcy = oy + block.row * CELL_SIZE + CELL_SIZE / 2;

    switch (block.type) {
      // --- PASSIVE BLOCKS ---
      case 'fan': {
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [fdx, fdy] = dirs[block.rotation % 4];
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < FAN_RANGE && dist > 1) {
          // Check if ball is in the fan's forward cone (180° wide)
          const dot = dx * fdx + dy * fdy;
          if (dot > 0) {
            const falloff = 1 - dist / FAN_RANGE;
            Body.applyForce(ballBody, ballBody.position, {
              x: fdx * FAN_FORCE * falloff,
              y: fdy * FAN_FORCE * falloff,
            });
          }
        }
        break;
      }
      case 'gravitypad': {
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CELL_SIZE * 0.8 && !sim.gravityEffect) {
          const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
          const [gdx, gdy] = dirs[block.rotation % 4];
          sim.gravityEffect = {
            dx: gdx * GRAVITY_PAD_STRENGTH,
            dy: gdy * GRAVITY_PAD_STRENGTH,
            framesLeft: GRAVITY_PAD_DURATION,
          };
        }
        break;
      }

      // --- POWERED BLOCKS (need active group) ---
      case 'piston': {
        const active = activeGroups.has(block.group);
        const hasArm = pistonArms.has(key);
        if (active && !hasArm) {
          const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
          const [pdx, pdy] = dirs[block.rotation % 4];
          const armCx = bcx + pdx * CELL_SIZE;
          const armCy = bcy + pdy * CELL_SIZE;
          const arm = Bodies.rectangle(armCx, armCy, CELL_SIZE * 0.8, CELL_SIZE * 0.8, {
            isStatic: true,
            friction: 0.5,
          });
          World.add(engine.world, arm);
          pistonArms.set(key, arm);

          const dist = Math.sqrt(
            (ballBody.position.x - armCx) ** 2 + (ballBody.position.y - armCy) ** 2,
          );
          if (dist < CELL_SIZE * 1.5) {
            Body.applyForce(ballBody, ballBody.position, {
              x: pdx * PISTON_FORCE,
              y: pdy * PISTON_FORCE,
            });
          }
        } else if (!active && hasArm) {
          const arm = pistonArms.get(key)!;
          World.remove(engine.world, arm);
          pistonArms.delete(key);
        }
        break;
      }
      case 'blackhole': {
        if (!activeGroups.has(block.group)) break;
        const dx = bcx - ballBody.position.x;
        const dy = bcy - ballBody.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < BLACKHOLE_CAPTURE_RADIUS) {
          captured = true;
        } else if (dist < GRAVITY_WELL_RADIUS && dist > 1) {
          const force = GRAVITY_WELL_STRENGTH / (dist * dist) * CELL_SIZE * CELL_SIZE;
          Body.applyForce(ballBody, ballBody.position, {
            x: (dx / dist) * force,
            y: (dy / dist) * force,
          });
        }
        break;
      }
      case 'whitehole': {
        if (!activeGroups.has(block.group)) break;
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
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
      case 'portal': {
        // Portals are always active (don't need key). Group is used for pairing.
        if (sim.portalCooldown > 0) break;
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PORTAL_RADIUS) {
          // Find paired portal with same group
          const paired = blocks.find(
            (b) => b.type === 'portal' && b.group === block.group && (b.col !== block.col || b.row !== block.row),
          );
          if (paired) {
            const targetX = ox + paired.col * CELL_SIZE + CELL_SIZE / 2;
            const targetY = oy + paired.row * CELL_SIZE + CELL_SIZE / 2;
            Body.setPosition(ballBody, { x: targetX, y: targetY });
            sim.portalCooldown = PORTAL_COOLDOWN;
          }
        }
        break;
      }
      case 'bomb': {
        if (!activeGroups.has(block.group) || removedBombs.has(key)) break;
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
        break;
      }
    }
  });

  return captured;
}
