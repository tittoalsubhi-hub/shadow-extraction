// Seeded population of a floor: guards, hostages, cameras, supplies, doors and lights.
import { RNG, hashStr, dist, clamp } from './core-util.js';
import { markersOf, cellFree, T } from './world-building.js';
import { lineOfSight, findPath, DOOR_CLOSED, DOOR_OPEN } from './world-grid.js';
import { ENEMY_TYPES, DIFFICULTY, WEAPONS, GADGET_IDS, tierForLevel } from './game-data.js';

const LIGHT_CHANCE = { living: 0.75, kitchen: 0.6, bedroom: 0.4, bathroom: 0.55, hall: 0.65, office: 0.6, storage: 0.25, laundry: 0.45, balcony: 0, corridor: 1 };
let uid = 1;
export function nextId() { return uid++; }
export function bumpIds(n) { uid = Math.max(uid, n + 1); }

export function makeGuard(type, x, y, facing, apt, extra = {}) {
  const def = ENEMY_TYPES[type];
  return {
    id: nextId(), kind: 'guard', type, apt, x, y, facing, state: 'patrol', down: null,
    hp: def.hp, armor: def.armor, maxHp: def.hp, susp: 0, lastKnown: null, target: null,
    reportT: -1, reported: false, reportReason: null, post: null, route: null, routeIdx: 0, pauseT: 0,
    path: null, pathGoal: null, searchT: 0, searchPts: null, inspect: -1, inspectT: 0, knownSpot: -1, checked: [],
    stunT: 0, tranqT: -1, fireCD: 0, burst: 0, reactT: 0, lostT: 0, lookT: 0, lookBase: facing, idleT: 0,
    prepared: false, alertBoost: 1, bodyHidden: -1, found: false, carried: false, walkPhase: 0, speed: 0, aimT: 0, hurtT: 0, sawHostage: [],
    ...extra,
  };
}

function freeNear(map, x, y, rng, room) {
  const cands = [];
  for (let r = 0; r <= 2; r++) for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
    if (!cellFree(map, xx, yy)) continue;
    if (room != null && map.room[yy * map.w + xx] !== room) continue;
    cands.push([xx, yy]);
  }
  return cands.length ? rng.pick(cands) : null;
}

function guardTypeFor(p, rng, i, n, diffId) {
  if (p >= 5 && i === 0) return 'leader';
  const r = rng.next();
  if (p >= 3 && r < 0.28) return 'armored';
  if (p >= 1 && r < 0.58) return 'scout';
  if (diffId === 'extreme' && p >= 2 && r < 0.7) return 'armored';
  return 'patrol';
}

export function guardCount(p, diffId) {
  const d = DIFFICULTY[diffId].enemyDelta;
  let n = 2 + (p >= 2 ? 1 : 0) + (p >= 5 ? 1 : 0) + (p >= 7 ? 1 : 0);
  if (diffId === 'easy') n += d;
  else if (diffId === 'hard') n += p >= 2 ? 1 : 0;
  else if (diffId === 'extreme') n += 1;
  return clamp(n, 1, 6);
}

// world: { map, doors, smokes }. Returns floor state.
export function populateFloor(run, map, opts = {}) {
  const diffId = run.difficulty;
  const diff = DIFFICULTY[diffId];
  const fs = { floor: map.floor, guards: [], hostages: [], cameras: [], items: [], doors: Array(map.doors.length).fill(DOOR_CLOSED), lights: [], discovered: [], roomsSeen: [], populated: true };
  const frng = new RNG((run.seed ^ hashStr('floor' + map.floor)) >>> 0);
  const world = { map, doors: Uint8Array.from(fs.doors), smokes: [] };
  // lights
  fs.lights = map.rooms.map(r => r.type === 'corridor' ? 1 : (frng.chance(LIGHT_CHANCE[r.type] ?? 0.5) ? 1 : 0));
  // doors: front doors closed, interior mostly open
  map.doors.forEach((d, i) => {
    const isFront = d.rooms.some(r => r >= 0 && map.rooms[r].type === 'corridor');
    const bath = d.rooms.some(r => r >= 0 && map.rooms[r].type === 'bathroom');
    fs.doors[i] = isFront ? DOOR_CLOSED : bath ? (frng.chance(0.5) ? DOOR_CLOSED : DOOR_OPEN) : (frng.chance(0.65) ? DOOR_OPEN : DOOR_CLOSED);
  });
  world.doors = Uint8Array.from(fs.doors);
  const entrySlot = opts.entrySlot ?? -1;
  // Progress offsets: apartments nearer to where the player starts get lower progress
  const slots = [0, 1, 2];
  const order = slots.slice().sort((a, b) => Math.abs(a - Math.max(0, entrySlot)) - Math.abs(b - Math.max(0, entrySlot)));
  const tier = tierForLevel(run.level);
  for (const slot of slots) {
    const info = map.aptInfo[slot];
    const apt = run.apts[info.id];
    if (!apt) continue;
    const offs = order.indexOf(slot);
    const p = apt.progress ?? Math.min(8, run.completed + offs);
    apt.progress = p;
    const rng = new RNG((run.seed ^ hashStr(info.id)) >>> 0);
    const entry = markersOf(map, slot, 5)[0];
    const isStart = slot === entrySlot && opts.startHere;
    const aptRooms = map.rooms.filter(r => r.apt === slot);
    const entryRoom = map.room[entry.y * map.w + entry.x];
    const safeFromEntry = (x, y) => !isStart || (dist(x, y, entry.x + 0.5, entry.y + 0.5) > 7.5 && !lineOfSight(world, x, y, entry.x + 0.5, entry.y + 0.5));
    if (apt.status === 'complete') continue;
    // Guards
    const n = guardCount(p, diffId);
    const posts = rng.shuffle(markersOf(map, slot, 1)).filter(m => safeFromEntry(m.x + 0.5, m.y + 0.5));
    const nStationary = Math.min(posts.length, Math.max(1, Math.round(n * 0.4)));
    for (let i = 0; i < n; i++) {
      const type = guardTypeFor(p, rng, i, n, diffId);
      const def = ENEMY_TYPES[type];
      const armor = Math.round(def.armor * diff.armor);
      if (i < nStationary) {
        const m = posts[i];
        // face toward the room's largest open direction: toward room center
        const room = map.rooms[map.room[m.y * map.w + m.x]];
        let facing = Math.atan2(room.cy - (m.y + 0.5), room.cx - (m.x + 0.5));
        if (!isFinite(facing) || (Math.abs(room.cx - m.x - 0.5) < 0.6 && Math.abs(room.cy - m.y - 0.5) < 0.6)) facing = rng.range(-Math.PI, Math.PI);
        const g = makeGuard(type, m.x + 0.5, m.y + 0.5, facing, slot, { state: 'idle', armor, hp: def.hp });
        g.post = { x: m.x + 0.5, y: m.y + 0.5, facing };
        g.lookBase = facing;
        fs.guards.push(g);
      } else {
        // patrol route through 3-4 rooms of the apartment
        let rooms = rng.shuffle(aptRooms.filter(r => r.type !== 'balcony' || rng.chance(0.5)));
        if (isStart) rooms = rooms.filter(r => r.id !== entryRoom);
        const route = [];
        for (const r of rooms.slice(0, rng.int(3, 4))) {
          const c = freeNear(map, Math.floor(r.cx), Math.floor(r.cy), rng, r.id) || freeNear(map, r.cells[0][0], r.cells[0][1], rng, r.id);
          if (c) route.push([c[0] + 0.5, c[1] + 0.5]);
        }
        if (route.length < 2) continue;
        // start at the waypoint safest from the entry
        let si = 0;
        if (isStart) {
          let best = -1;
          route.forEach((w, k) => { const d = dist(w[0], w[1], entry.x + 0.5, entry.y + 0.5); const ok = safeFromEntry(w[0], w[1]); const sc = d + (ok ? 100 : 0); if (sc > best) { best = sc; si = k; } });
        }
        const g = makeGuard(type, route[si][0], route[si][1], rng.range(-Math.PI, Math.PI), slot, { state: 'patrol', armor, hp: def.hp });
        g.route = route; g.routeIdx = (si + 1) % route.length; g.pauseT = rng.range(1, 3) + (isStart ? 3 : 0);
        fs.guards.push(g);
      }
    }
    // Hostages
    const hc = rng.shuffle(markersOf(map, slot, 2));
    let hn = 1 + (rng.chance(0.55) ? 1 : 0) + (p >= 4 && rng.chance(0.4) ? 1 : 0);
    hn = Math.min(hn, hc.length);
    for (let i = 0; i < hn; i++) {
      const m = hc[i];
      fs.hostages.push(makeHostage(m.x + 0.5, m.y + 0.5, slot, rng));
    }
    apt.stats.hostages = hn;
    // Supplies & intel
    for (const m of markersOf(map, slot, 3)) fs.items.push(makeCrate(m.x + 0.5, m.y + 0.5, slot, rng, tier, run, diff));
    if (diff.extraMed) {
      const c = freeNear(map, entry.x, entry.y, rng, entryRoom);
      if (c) fs.items.push({ id: nextId(), kind: 'crate', x: c[0] + 0.5, y: c[1] + 0.5, apt: slot, opened: false, contents: { type: 'gadget', id: 'medkit', count: 1 } });
    }
    for (const m of markersOf(map, slot, 4)) fs.items.push({ id: nextId(), kind: 'intel', x: m.x + 0.5, y: m.y + 0.5, apt: slot, taken: false, variant: rng.int(0, 2) });
  }
  // Corridor guards & cameras
  const crng = new RNG((run.seed ^ hashStr('corr' + map.floor)) >>> 0);
  const avgP = run.completed;
  for (const m of map.markers.filter(m => m.apt < 0)) {
    if (m.type === 1) {
      const type = avgP >= 3 && crng.chance(0.4) ? 'armored' : 'patrol';
      const def = ENEMY_TYPES[type];
      const route = [[m.x + 0.5, m.y + 0.5], [clamp(m.x + crng.int(-14, 14), 4, map.w - 3) + 0.5, 2.5]];
      const g = makeGuard(type, m.x + 0.5, m.y + 0.5, 0, -1, { state: 'patrol', armor: Math.round(def.armor * diff.armor) });
      g.route = route; g.routeIdx = 1; g.pauseT = crng.range(2, 4);
      fs.guards.push(g);
    } else if (m.type === 7) {
      fs.cameras.push({ id: nextId(), kind: 'camera', x: m.x + 0.5, y: m.y + 0.15, base: Math.PI / 2, sweep: 1.05, period: 7, phase: crng.range(0, 7), angle: Math.PI / 2, susp: 0, reportT: -1, reported: false, disabledT: 0, destroyed: false, apt: -1 });
    }
  }
  return fs;
}

export function makeHostage(x, y, apt, rng) {
  const looks = [['#7a4b3a', '#c9b38f', '#3a2a20'], ['#4a5a7a', '#d8c4a0', '#1e1a16'], ['#7a6a3a', '#b88c64', '#5a3a1c'], ['#5a3a5a', '#e0c8a8', '#8a6a40'], ['#3a5a4a', '#a07850', '#141010']];
  const l = rng.pick(looks);
  return { id: nextId(), kind: 'hostage', apt, x, y, facing: rng.range(-3, 3), state: rng.chance(0.65) ? 'restrained' : 'frightened', order: 'wait', hp: 60, path: null, pathGoal: null, freeT: 0, known: false, shirt: l[0], skin: l[1], hair: l[2], walkPhase: 0, speed: 0, cover: null, female: rng.chance(0.5), repathT: 0 };
}

function makeCrate(x, y, apt, rng, tier, run, diff) {
  const r = rng.next();
  let contents;
  if (r < 0.42) {
    const have = [run.player.primary?.id, run.player.sidearm?.id];
    const pool = Object.keys(WEAPONS).filter(id => WEAPONS[id].tier <= tier && !have.includes(id));
    const id = rng.pick(pool.length ? pool : Object.keys(WEAPONS));
    contents = { type: 'weapon', id };
  } else if (r < 0.78) {
    const g = rng.pick(GADGET_IDS);
    contents = { type: 'gadget', id: g, count: g === 'jammer' || g === 'flash' ? 1 : 2 };
  } else {
    contents = { type: 'ammo', amount: Math.round(rng.range(0.5, 0.9) * diff.ammo * 100) / 100 };
  }
  return { id: nextId(), kind: 'crate', x, y, apt, opened: false, contents };
}
