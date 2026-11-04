// Guard / camera perception. Vision is occluded by walls, closed doors, tall furniture,
// smoke, and (for crouched targets) low cover. Flashlight contact with LOS = confirmed detection.
import { angDiff, dist } from './core-util.js';
import { lineOfSight } from './world-grid.js';
import { ENEMY_TYPES } from './game-data.js';

export function lightAt(game, x, y) {
  const m = game.map;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return 0.3;
  const r = m.room[cy * m.w + cx];
  if (r < 0) return 0.55;
  const room = m.rooms[r];
  if (room.type === 'corridor') return game.fs.lights[r] ? 0.85 : 0.35;
  if (room.type === 'balcony') return 0.5;
  return game.fs.lights[r] ? 1 : 0.3;
}

// Is the point inside guard g's flashlight beam with LOS?
export function inBeam(game, g, x, y) {
  const def = ENEMY_TYPES[g.type];
  const d = dist(g.x, g.y, x, y);
  if (d > def.beam) return false;
  const off = Math.abs(angDiff(g.facing, Math.atan2(y - g.y, x - g.x)));
  // beam narrows with distance but has a minimum near-field width
  const half = def.beamHalf + 0.25 / Math.max(0.6, d);
  return off <= half;
}

// Returns { seen, confirm, gain, d }
export function sensePlayer(game, g) {
  const p = game.player;
  const out = { seen: false, confirm: false, gain: 0, d: 0 };
  if (p.hidden != null || game.player.dead) return out;
  const def = ENEMY_TYPES[g.type];
  const d = dist(g.x, g.y, p.x, p.y);
  out.d = d;
  const off = Math.abs(angDiff(g.facing, Math.atan2(p.y - g.y, p.x - g.x)));
  const combat = g.state === 'combat' || g.state === 'searching' || g.state === 'reporting';
  const fov = def.fov * (combat ? 1.6 : 1);
  const light = lightAt(game, p.x, p.y);
  const perc = game.diff.perception * (g.prepared ? 1.2 : 1) * g.alertBoost;
  const maxRange = def.vision * (0.45 + 0.55 * light) * (g.prepared ? 1.1 : 1) * (combat ? 1.3 : 1);
  const beam = g.stunT <= 0 && inBeam(game, g, p.x, p.y);
  const near = d < 1.1; // body contact / immediately adjacent
  if (!beam && !near && (d > maxRange || off > fov)) return out;
  if (!lineOfSight(game.world, g.x, g.y, p.x, p.y, { lowBlocksNearTarget: p.crouch })) return out;
  out.seen = true;
  if (beam || (near && off < 2.2) || (combat && d < maxRange)) { out.confirm = true; return out; }
  const stats = game.stats;
  let vis = light * (p.crouch ? 0.55 * stats.visMul : 1) * (p.ghostT > 0 ? 0.7 : 1);
  const distF = Math.max(0, 1 - d / maxRange);
  const sp = p.speedNow || 0;
  const motion = sp < 0.15 ? 0.45 : sp < 2.0 ? 0.85 : 1.45;
  const periph = off < 0.4 ? 1 : 0.45;
  out.gain = 2.4 * vis * (0.25 + distF) * motion * periph * perc;
  if (d < 2.2 && off < 0.6) out.gain *= 2.2; // close and in front
  return out;
}

// Generic: can guard see a point (for bodies / hostages)
export function guardSeesPoint(game, g, x, y, rangeMul = 1) {
  const def = ENEMY_TYPES[g.type];
  const d = dist(g.x, g.y, x, y);
  const light = lightAt(game, x, y);
  const range = def.vision * (0.4 + 0.6 * light) * rangeMul;
  const beam = inBeam(game, g, x, y);
  if (!beam && d > range) return false;
  const off = Math.abs(angDiff(g.facing, Math.atan2(y - g.y, x - g.x)));
  if (!beam && off > def.fov) return false;
  return lineOfSight(game.world, g.x, g.y, x, y);
}

export function cameraSees(game, c, x, y, crouch) {
  const d = dist(c.x, c.y, x, y);
  if (d > 7.5) return false;
  const off = Math.abs(angDiff(c.angle, Math.atan2(y - c.y, x - c.x)));
  if (off > 0.42) return false;
  return lineOfSight(game.world, c.x, c.y + 0.4, x, y, { lowBlocksNearTarget: crouch });
}
