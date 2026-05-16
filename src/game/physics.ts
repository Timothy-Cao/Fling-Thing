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
  CURVE_RESTITUTION,
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
  FLOOR_THICKNESS,
  FLOOR_EXTEND_RIGHT,
  BlockType,
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
        restitution: CURVE_RESTITUTION,
        label: `curve_${block.col}_${block.row}_${block.rotation}`,
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
    case 'piston':
      return Bodies.rectangle(cx, cy, CELL_SIZE, CELL_SIZE * 0.5, {
        isStatic: true,
        friction: 0.5,
      });
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
    { isStatic: true, friction: 0.3, restitution: 0.6 },
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

  blocks.forEach((block) => {
    if (block.type === 'ball') return;
    const body = createPhysicsBody(block, ox, oy);
    if (body) {
      bodiesToAdd.push(body);
    }
  });

  World.add(engine.world, bodiesToAdd);

  const sim: SimulationState = {
    engine,
    runner: Runner.create({ delta: 1000 / 60 }),
    ballBody,
    pistonArms: new Map(),
    removedBombs: new Set(),
    portalCooldown: 0,
    gravityEffect: null,
    shockwaves: [],
  };

  // Curve collision handler: redirect velocity along curve surface
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      const curveBody = bodyA.label?.startsWith('curve_') ? bodyA
        : bodyB.label?.startsWith('curve_') ? bodyB : null;
      if (!curveBody) return;
      const otherBody = curveBody === bodyA ? bodyB : bodyA;
      if (otherBody.label !== 'ball') return;

      const speed = Math.sqrt(otherBody.velocity.x ** 2 + otherBody.velocity.y ** 2);
      if (speed < 0.5) return;

      const parts = curveBody.label!.split('_');
      const rotation = parseInt(parts[3]);

      // Redirect velocity based on curve rotation
      // Curves convert vertical motion to horizontal (or vice versa)
      let newVx = otherBody.velocity.x;
      let newVy = otherBody.velocity.y;

      switch (rotation % 4) {
        case 0: // bottom-left to top-right: converts downward to rightward
          if (Math.abs(otherBody.velocity.y) > Math.abs(otherBody.velocity.x)) {
            newVx = speed * 0.85;
            newVy = -speed * 0.3;
          }
          break;
        case 1: // bottom-right to top-left: converts downward to leftward
          if (Math.abs(otherBody.velocity.y) > Math.abs(otherBody.velocity.x)) {
            newVx = -speed * 0.85;
            newVy = -speed * 0.3;
          }
          break;
        case 2: // top-right to bottom-left: converts rightward to downward
          if (Math.abs(otherBody.velocity.x) > Math.abs(otherBody.velocity.y)) {
            newVx = -speed * 0.3;
            newVy = speed * 0.85;
          }
          break;
        case 3: // top-left to bottom-right: converts leftward/downward to rightward
          if (Math.abs(otherBody.velocity.y) > Math.abs(otherBody.velocity.x) * 0.5) {
            newVx = speed * 0.85;
            newVy = speed * 0.2;
          }
          break;
      }

      Body.setVelocity(otherBody, { x: newVx, y: newVy });
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
  activeTypes: Set<BlockType>,
  blocks: PlacedBlock[],
  ox: number,
  oy: number,
): boolean {
  let captured = false;
  const { engine, ballBody, pistonArms, removedBombs } = sim;

  if (sim.portalCooldown > 0) sim.portalCooldown--;

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

  blocks.forEach((block) => {
    const key = blockKey(block);
    const bcx = ox + block.col * CELL_SIZE + CELL_SIZE / 2;
    const bcy = oy + block.row * CELL_SIZE + CELL_SIZE / 2;

    switch (block.type) {
      case 'fan': {
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [fdx, fdy] = dirs[block.rotation % 4];
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < FAN_RANGE && dist > 1) {
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

      case 'piston': {
        const active = activeTypes.has('piston');
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
        if (!activeTypes.has('blackhole')) break;
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
        if (!activeTypes.has('whitehole')) break;
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
        if (sim.portalCooldown > 0) break;
        const dx = ballBody.position.x - bcx;
        const dy = ballBody.position.y - bcy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PORTAL_RADIUS) {
          const allPortals = blocks.filter((b) => b.type === 'portal');
          const myIndex = allPortals.findIndex((p) => p.col === block.col && p.row === block.row);
          const pairedIndex = myIndex % 2 === 0 ? myIndex + 1 : myIndex - 1;
          const paired = allPortals[pairedIndex];
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
        break;
      }
    }
  });

  return captured;
}
