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
  SUBSTEPS_PER_FRAME,
  MAX_BALL_SPEED,
  BlockType,
} from './constants';
import { PlacedBlock } from './types';
import { getRampVertices, getCurveVertices } from './renderer';

const { Engine, World, Bodies, Body, Events } = Matter;

const DIRS: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

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

export interface SimulationState {
  engine: Matter.Engine;
  ballBody: Matter.Body;
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
}

function blockKey(block: PlacedBlock): string {
  return `${block.col},${block.row}`;
}

function clampBallSpeed(ball: Matter.Body) {
  const v = ball.velocity;
  const s = Math.sqrt(v.x * v.x + v.y * v.y);
  if (s > MAX_BALL_SPEED) {
    const r = MAX_BALL_SPEED / s;
    Body.setVelocity(ball, { x: v.x * r, y: v.y * r });
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
    ballBody,
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
  };

  // Curve redirect handler (smoother + speed-preserving)
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

      let newVx = otherBody.velocity.x;
      let newVy = otherBody.velocity.y;
      const KEEP = 0.96;

      switch (rotation % 4) {
        case 0:
          if (Math.abs(otherBody.velocity.y) > Math.abs(otherBody.velocity.x)) {
            newVx = speed * KEEP;
            newVy = -speed * 0.18;
          }
          break;
        case 1:
          if (Math.abs(otherBody.velocity.y) > Math.abs(otherBody.velocity.x)) {
            newVx = -speed * KEEP;
            newVy = -speed * 0.18;
          }
          break;
        case 2:
          if (Math.abs(otherBody.velocity.x) > Math.abs(otherBody.velocity.y)) {
            newVx = -speed * 0.18;
            newVy = speed * KEEP;
          }
          break;
        case 3:
          if (Math.abs(otherBody.velocity.y) > Math.abs(otherBody.velocity.x) * 0.5) {
            newVx = speed * KEEP;
            newVy = speed * 0.18;
          }
          break;
      }

      Body.setVelocity(otherBody, { x: newVx, y: newVy });
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
      Body.setVelocity(otherBody, {
        x: perpX + dx * newAlong,
        y: perpY + dy * newAlong,
      });
      sim.boosterCooldowns.set(key, BOOSTER_COOLDOWN);
      sim.boostFlashes.push({
        x: boosterBody.position.x,
        y: boosterBody.position.y,
        frame: 0,
      });
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

      // gentler decay; preserve horizontal more than vertical
      const newVx = vx * 0.95;
      const newVy = vy * 0.55;
      Body.setVelocity(ball, { x: newVx, y: newVy });
    });
  });

  return sim;
}

export function stopSimulation(sim: SimulationState) {
  World.clear(sim.engine.world, false);
  Engine.clear(sim.engine);
}

// Step physics manually with substeps & speed clamp to prevent tunneling.
export function stepSimulation(sim: SimulationState) {
  const substeps = SUBSTEPS_PER_FRAME;
  // engine.timing.timeScale lets us speed up sim without losing precision
  // because we run more substeps when speed > 1.
  const scale = sim.speedScale;
  const totalSubsteps = Math.max(1, Math.round(substeps * scale));
  for (let i = 0; i < totalSubsteps; i++) {
    clampBallSpeed(sim.ballBody);
    Engine.update(sim.engine, PHYSICS_DT);
  }
  clampBallSpeed(sim.ballBody);
}

export function setSimulationSpeed(sim: SimulationState, speed: number) {
  sim.speedScale = speed;
}

export function applyBlockEffects(
  sim: SimulationState,
  activeTypes: Set<BlockType>,
  blocks: PlacedBlock[],
  ox: number,
  oy: number,
): boolean {
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

  blocks.forEach((block) => {
    const key = blockKey(block);
    const bcx = ox + block.col * CELL_SIZE + CELL_SIZE / 2;
    const bcy = oy + block.row * CELL_SIZE + CELL_SIZE / 2;

    switch (block.type) {
      case 'fan': {
        const [fdx, fdy] = DIRS[block.rotation % 4];
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
          const [gdx, gdy] = DIRS[block.rotation % 4];
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
          const [pdx, pdy] = DIRS[block.rotation % 4];
          const armCx = bcx + pdx * CELL_SIZE;
          const armCy = bcy + pdy * CELL_SIZE;
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
        const [wdx, wdy] = DIRS[block.rotation % 4];
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
          const allPortals = blocks.filter((b) => b.type === 'portal');
          const myIndex = allPortals.findIndex((p) => p.col === block.col && p.row === block.row);
          const pairedIndex = myIndex % 2 === 0 ? myIndex + 1 : myIndex - 1;
          const paired = allPortals[pairedIndex];
          if (paired) {
            const targetX = ox + paired.col * CELL_SIZE + CELL_SIZE / 2;
            const targetY = oy + paired.row * CELL_SIZE + CELL_SIZE / 2;
            Body.setPosition(ballBody, { x: targetX, y: targetY });
            // tiny boost so portal chains keep ball moving
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
        break;
      }
    }
  });

  // capture removed - black holes are pure slingshot now
  return false;
}
