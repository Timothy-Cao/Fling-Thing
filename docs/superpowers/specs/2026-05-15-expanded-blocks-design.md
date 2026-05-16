# Expanded Blocks Design — Ball Launch

**Date:** 2026-05-15

## Overview

Expand the Ball Launch game from 4 block types to 10, add a manual key-group activation system for powered blocks during simulation, and implement pre-rotation for block placement. Refactor the monolithic Game.tsx into focused modules.

## Pre-Rotation

- A `preRotation` state tracks the current rotation for the selected block type.
- Right-clicking on an empty grid cell (or anywhere on the grid with no block under cursor) cycles the ghost preview rotation (0 → 90 → 180 → 270).
- Right-clicking on an existing placed block still rotates that block in-place.
- The ghost preview shown at the hover position uses the current `preRotation` value.
- When a block is placed, it uses the current `preRotation` as its initial rotation.

## Block Roster

### Passive Blocks (always active)

| Block | Cost (1st free) | Color | Description |
|-------|----------------|-------|-------------|
| Ball | Free, 1 only | #e94560 | Starting point. Dynamic physics body. |
| Solid | 1 | #7f8c8d | Static square. Walls, floors, structures. |
| Ramp | 2 | #3498db | Right-triangle. Redirects ball at an angle. 4 rotations. |
| Curve | 2 | #9b59b6 | Quarter-circle arc (8 line segments). Smooth redirection. 4 rotations. |
| Ice | 3 | #85e0ff | Flat surface with near-zero friction (0.001). Ball slides without slowing. |
| Bouncy | 5 | #e74c3c / #f39c12 | High restitution (1.5). Bounces ball with extra energy. |

### Powered Blocks (key-toggled during simulation)

| Block | Cost (1st free) | Color | Description |
|-------|----------------|-------|-------------|
| Piston | 10 | #27ae60 | Extends 1 cell in facing direction when key held. Applies force impulse to ball. Retracts on key release. 4 rotations for direction. |
| Black Hole | 12 | #2c003e / #8e44ad | 5-cell radius gravity pull toward center. Force = inverse distance. Ball captured at center = bad. Toggle on/off. |
| White Hole | 12 | #ffffcc / #f1c40f | 5-cell radius repulsion from center. Force = inverse distance. Toggle on/off. |
| Bomb | 15 | #e67e22 / #d35400 | One-shot. Key press → explosive radial force → bomb disappears from grid. |

## Key-Group Activation System

### Assignment (Edit Mode)
- Every powered block has a `group` property (1-9), defaulting to 1.
- Scroll wheel while hovering a placed powered block changes its group number.
- The group number is rendered on the block in the canvas (small white digit).
- Multiple blocks can share the same group — they all activate together.

### Activation (Run Mode)
- Number keys 1-9 toggle all blocks in that group.
- For piston: key down = extend, key up = retract.
- For black hole / white hole: key down = toggle on, key up = toggle off (hold to activate).
- For bomb: key down = detonate (one-shot, block is removed from simulation).
- A small HUD in the top-left during simulation shows which groups exist and their active state (lit up vs dim).

### Visual Feedback
- Active powered blocks glow/pulse during simulation.
- Piston shows an extending arm in its facing direction.
- Black hole shows swirling particle effect when active.
- White hole shows radiating lines when active.
- Bomb shows a brief explosion animation before disappearing.

## Physics Implementation

### Curve Block
- Approximated with 8 line segments forming a quarter-circle arc inside the cell.
- Created using `Bodies.fromVertices` with vertices tracing the arc plus straight edges to close the shape.
- The ball rolls along the concave inner surface.
- 4 rotations determine which corner the arc occupies.

### Ice Block
- Standard rectangle body like solid, but with friction set to 0.001.

### Piston
- At rest: a half-cell-sized rectangle in the piston's cell.
- When activated: extends a rectangle body into the adjacent cell in the facing direction. Applies a velocity impulse to the ball if it overlaps.
- Implemented by adding/removing a dynamic "arm" body to the physics world on toggle.

### Black Hole / White Hole
- No physics body. Implemented as a force applied each physics tick.
- On each tick, if active, calculate distance from hole center to ball center.
- If within 5-cell radius (200px): apply force = direction × strength / distance².
- Black hole: force toward center. White hole: force away from center.
- Black hole capture: if ball center is within 0.5 cells of hole center, simulation ends with 0 distance.

### Bomb
- No physics body at rest.
- On detonation: calculate direction from bomb center to ball center. Apply large impulse force to ball. Remove bomb from blocks array.

## Pricing & Budget

- **Starting coins: 100**
- First purchase of each block type is free.
- Subsequent purchases use costs listed above.

## Hotkeys

| Key | Edit Mode | Run Mode |
|-----|-----------|----------|
| 1-9 | Select block type (expanded) | Toggle block group |
| 0 | Select ball | — |
| Right-click grid | Rotate preview / rotate placed block | — |
| Scroll wheel on powered block | Change group number | — |
| Space / F | — | Speed toggle (1x/2x/4x) |
| Escape | Deselect block | — |
| Delete | Remove hovered block | — |

Block selection hotkeys: 0=Ball, 1=Solid, 2=Ramp, 3=Curve, 4=Ice, 5=Bouncy, 6=Piston, 7=Black Hole, 8=White Hole, 9=Bomb.

During run mode, 1-9 activate block groups (not block selection).

## Architecture Refactor

Split Game.tsx (~800 lines) into:

### `src/game/constants.ts`
- Grid dimensions, colors, block configs (expanded to 10 types).
- Physics tuning constants.

### `src/game/types.ts`
- `PlacedBlock` — add `group: number` field (1-9, default 1). Only meaningful for powered blocks.
- `BlockCategory: 'passive' | 'powered'` added to BlockConfig.
- `GameMode`, `Camera` types.

### `src/game/renderer.ts`
- All canvas drawing functions extracted: `drawBlockShape`, `drawPlacedBlock`, `drawSky`, `drawFloor`, `drawDistanceMarkers`, `renderEdit`, `renderRun`.
- Pure functions that take ctx + state refs as parameters.
- Stars cache lives here.

### `src/game/physics.ts`
- `createPhysicsBody` for all block types.
- `startSimulation` / `stopSimulation`.
- `applyPoweredBlockEffects(engine, activeGroups, blocks, ballBody)` — called each tick to apply black hole/white hole/piston forces.
- Curve vertex generation.

### `src/components/Game.tsx`
- React state management, refs, event handlers.
- Render loop setup (delegates to renderer functions).
- Sidebar and toolbar JSX.
- Slimmed to ~300-400 lines.

## Sidebar UI Changes

- Sidebar needs to accommodate 10 blocks. Use a scrollable list or compact layout.
- Powered blocks have a distinct visual indicator (lightning bolt icon or colored badge).
- Group number shown on powered block items in sidebar when placed.
