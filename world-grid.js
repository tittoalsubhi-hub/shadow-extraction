// Collision, line of sight and pathfinding on a floor map + dynamic door state.
import { T } from './world-building.js';
import { segCircle } from './core-util.js';

export const DOOR_CLOSED = 0, DOOR_OPEN = 1, DOOR_AJAR = 2;

// world: { map, doors: Uint8Array state per door, smokes: [{x,y,r,t}] }
export function blocksMove(world, x, y) {
  const m = world.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
  const i = y * m.w + x;
  const t = m.tile[i];
  if (t === T.FLOOR) return m.prop[i] >= 0;
  if (t === T.ARCH) return false;
  if (t === T.DOOR) return world.doors[m.doorAt[i]] !== DOOR_OPEN;
  return true;
}
// For AI path planning: closed doors are traversable (they open them)
export function blocksPath(world, x, y) {
  const m = world.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
  const i = y * m.w + x;
  const t = m.tile[i];
  if (t === T.FLOOR) return m.prop[i] >= 0;
  if (t === T.ARCH || t === T.DOOR) return false;
  return true;
}
// sight: 0 clear, 1 low cover, 2 opaque
export function sightCell(world, x, y) {
  const m = world.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 2;
  const i = y * m.w + x;
  const t = m.tile[i];
  if (t === T.FLOOR) {
    const p = m.prop[i];
    if (p < 0) return 0;
    const pr = m.props[p];
    return pr.tall ? 2 : pr.cover ? 1 : 0;
  }
  if (t === T.ARCH || t === T.RAIL) return 0;
  if (t === T.DOOR) return world.doors[m.doorAt[i]] === DOOR_CLOSED ? 2 : 0;
  return 2;
}

// Grid traversal line of sight. targetCrouched: low cover near the target blocks sight.
// Returns true if clear.
export function lineOfSight(world, ax, ay, bx, by, opts = {}) {
  const lowBlocks = opts.lowBlocksNearTarget || false;
  if (world.smokes && world.smokes.length) {
    for (const s of world.smokes) if (s.t > 0 && segCircle(ax, ay, bx, by, s.x, s.y, s.r * 0.9) >= 0) return false;
  }
  let cx = Math.floor(ax), cy = Math.floor(ay);
  const ex = Math.floor(bx), ey = Math.floor(by);
  const dx = bx - ax, dy = by - ay;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? (cx + 1 - ax) : (ax - cx)) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? (cy + 1 - ay) : (ay - cy)) * tDeltaY : Infinity;
  let guard = 0;
  while ((cx !== ex || cy !== ey) && guard++ < 400) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      // passing exactly through a corner: blocked if both side cells are opaque
      const a = sightCell(world, cx + stepX, cy), b = sightCell(world, cx, cy + stepY);
      if (a === 2 && b === 2) return false;
      cx += stepX; cy += stepY; tMaxX += tDeltaX; tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
    else { cy += stepY; tMaxY += tDeltaY; }
    if (cx === ex && cy === ey) break;
    const s = sightCell(world, cx, cy);
    if (s === 2) return false;
    if (s === 1 && lowBlocks) {
      const ddx = cx + 0.5 - bx, ddy = cy + 0.5 - by;
      if (ddx * ddx + ddy * ddy < 1.7 * 1.7) return false;
    }
  }
  return true;
}

// Cast a ray, return distance to first opaque cell (for flashlight polygons / bullets)
export function castRay(world, ox, oy, ang, maxD, opts = {}) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let cx = Math.floor(ox), cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? (cx + 1 - ox) : (ox - cx)) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? (cy + 1 - oy) : (oy - cy)) * tDeltaY : Infinity;
  let t = 0;
  for (let n = 0; n < 200; n++) {
    if (tMaxX < tMaxY) { t = tMaxX; cx += stepX; tMaxX += tDeltaX; }
    else { t = tMaxY; cy += stepY; tMaxY += tDeltaY; }
    if (t >= maxD) return { d: maxD, cx: -1, cy: -1 };
    const s = opts.bullet ? bulletCell(world, cx, cy) : sightCell(world, cx, cy);
    if (s === 2) return { d: t, cx, cy };
  }
  return { d: maxD, cx: -1, cy: -1 };
}
function bulletCell(world, x, y) {
  const s = sightCell(world, x, y);
  if (s === 2) {
    // bullets pass over railings & arches; tall props stop them
    return 2;
  }
  return 0;
}

// Circle-vs-grid movement with axis separation.
export function moveCircle(world, ent, dx, dy, r = 0.28) {
  const tryAxis = (nx, ny) => {
    const minX = Math.floor(nx - r), maxX = Math.floor(nx + r);
    const minY = Math.floor(ny - r), maxY = Math.floor(ny + r);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (!blocksMove(world, x, y)) continue;
      // circle-rect overlap
      const px = Math.max(x, Math.min(nx, x + 1)), py = Math.max(y, Math.min(ny, y + 1));
      if ((px - nx) * (px - nx) + (py - ny) * (py - ny) < r * r - 1e-6) return false;
    }
    return true;
  };
  let moved = false;
  // substeps to avoid tunneling
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  const sx = dx / steps, sy = dy / steps;
  for (let s = 0; s < steps; s++) {
    if (sx && tryAxis(ent.x + sx, ent.y)) { ent.x += sx; moved = true; }
    if (sy && tryAxis(ent.x, ent.y + sy)) { ent.y += sy; moved = true; }
  }
  return moved;
}

// A* on 8-connected grid. Returns list of [x,y] cell coords (excluding start) or null.
export function findPath(world, sx, sy, tx, ty, opts = {}) {
  const m = world.map;
  const W = m.w, H = m.h;
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (sx === tx && sy === ty) return [];
  const blocked = opts.strict ? (x, y) => blocksMove(world, x, y) : (x, y) => blocksPath(world, x, y);
  if (blocked(tx, ty)) {
    // nearest free neighbor of target
    let best = null, bd = 1e9;
    for (let r = 1; r <= 2 && !best; r++) for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (blocked(x, y)) continue;
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) return null;
    [tx, ty] = best;
    if (sx === tx && sy === ty) return [];
  }
  const N = W * H;
  const g = new Float32Array(N).fill(1e9);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [];
  const push = (i, f) => { open.push([f, i]); let k = open.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (open[p][0] <= open[k][0]) break; [open[p], open[k]] = [open[k], open[p]]; k = p; } };
  const pop = () => { const top = open[0]; const last = open.pop(); if (open.length) { open[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let s = k; if (l < open.length && open[l][0] < open[s][0]) s = l; if (r < open.length && open[r][0] < open[s][0]) s = r; if (s === k) break; [open[s], open[k]] = [open[k], open[s]]; k = s; } } return top; };
  const hfn = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return dx + dy - 0.59 * Math.min(dx, dy); };
  const si = sy * W + sx, ti = ty * W + tx;
  g[si] = 0; push(si, hfn(sx, sy));
  const maxIter = opts.maxIter || 6000;
  let it = 0;
  while (open.length && it++ < maxIter) {
    const [, i] = pop();
    if (i === ti) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (blocked(nx, ny)) continue;
      if (dx && dy && (blocked(x + dx, y) || blocked(x, y + dy))) continue;
      // no diagonal moves through door cells
      if (dx && dy && (m.tile[ny * W + nx] === T.DOOR || m.tile[y * W + x] === T.DOOR)) continue;
      const ni = ny * W + nx;
      let cost = dx && dy ? 1.414 : 1;
      if (m.tile[ni] === T.DOOR && world.doors[m.doorAt[ni]] !== DOOR_OPEN) cost += 1.5;
      if (opts.avoid) cost += opts.avoid(nx, ny);
      const ng = g[i] + cost;
      if (ng < g[ni]) { g[ni] = ng; came[ni] = i; push(ni, ng + hfn(nx, ny)); }
    }
  }
  if (came[ti] < 0) return null;
  const path = [];
  let c = ti;
  while (c !== si && c >= 0) { path.push([c % W, (c / W) | 0]); c = came[c]; }
  path.reverse();
  return path;
}

// Reachable set (flood) from a cell, used by validation
export function reachable(world, sx, sy, strictDoors = false) {
  const m = world.map;
  const seen = new Uint8Array(m.w * m.h);
  const q = [[Math.floor(sx), Math.floor(sy)]];
  seen[Math.floor(sy) * m.w + Math.floor(sx)] = 1;
  const blocked = strictDoors ? (x, y) => blocksMove(world, x, y) : (x, y) => blocksPath(world, x, y);
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const i = ny * m.w + nx;
      if (seen[i] || blocked(nx, ny)) continue;
      seen[i] = 1; q.push([nx, ny]);
    }
  }
  return seen;
}
