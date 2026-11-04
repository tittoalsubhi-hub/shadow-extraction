// Parses authored layouts into floor maps: tiles, rooms, props, doors, hide spots, markers.
// Pure data — no DOM. Used by the simulation, renderer and tests.
import { APARTMENTS, FLOORS, CORRIDOR_DECOR, TUTORIAL } from './world-layouts.js';

export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, WINDOW: 4, RAIL: 5, ARCH: 6 };

export const ROOM_MARK = { l: 'living', k: 'kitchen', b: 'bathroom', r: 'bedroom', o: 'office', s: 'storage', y: 'balcony', u: 'laundry', h: 'hall' };
export const ROOM_LABEL = { living: 'Living room', kitchen: 'Kitchen', bathroom: 'Bathroom', bedroom: 'Bedroom', office: 'Office', storage: 'Storage', balcony: 'Balcony', laundry: 'Laundry', hall: 'Hallway', corridor: 'Corridor', stairs: 'Stairwell' };
const PROP_CHAR = { B: 'bed', W: 'wardrobe', T: 'table', K: 'counter', F: 'fridge', O: 'sofa', A: 'armchair', V: 'tvstand', E: 'desk', H: 'bookshelf', U: 'bathtub', L: 'toilet', N: 'sink', M: 'washer', X: 'crate', G: 'plant', I: 'cabinet', S: 'stairs' };

// h: height (m). tall: blocks vision. cover: low cover (blocks sight to crouched targets behind it).
// hide: hide-spot kind. group: contiguous same-letter cells form one prop.
export const PROP_DEF = {
  bed: { h: 0.55, cover: true, group: true },
  wardrobe: { h: 2.0, tall: true, hide: 'wardrobe', group: true },
  table: { h: 0.76, cover: true, group: true },
  counter: { h: 0.92, cover: true },
  fridge: { h: 1.8, tall: true },
  sofa: { h: 0.82, cover: true, group: true },
  armchair: { h: 0.82, cover: true },
  tvstand: { h: 0.5, cover: true, group: true },
  desk: { h: 0.76, cover: true, group: true, hide: 'desk' },
  bookshelf: { h: 1.95, tall: true, group: true },
  bathtub: { h: 0.6, cover: true, group: true, hide: 'shower' },
  toilet: { h: 0.45 },
  sink: { h: 0.88 },
  washer: { h: 0.9, cover: true },
  crate: { h: 0.8, cover: true },
  plant: { h: 1.15 },
  cabinet: { h: 1.05, cover: true },
  stairs: { h: 1.2, group: true },
};

export const APT_BLOCK_W = 16, APT_BLOCK_H = 13;
export const FLOOR_W = 51, FLOOR_H = 17, APT_X0 = 5, APT_STEP = 15, APT_Y0 = 4;

export function apartmentById(id) { return APARTMENTS.find(a => a.id === id); }
export function aptLabel(floorIdx, slot) { return `${floorIdx + 1}${'ABC'[slot]}`; }
// Ordered list of all apartments in the campaign: [{id, floor, slot, label}]
export function campaignApartments() {
  const out = [];
  FLOORS.forEach((f, fi) => f.apts.forEach((id, si) => out.push({ id, floor: fi, slot: si, label: aptLabel(fi, si) })));
  return out;
}

export function composeFloorChars(floorIdx) {
  const f = FLOORS[floorIdx];
  const g = [];
  for (let y = 0; y < FLOOR_H; y++) g.push(new Array(FLOOR_W).fill('#'));
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x < FLOOR_W - 1; x++) g[y][x] = x <= 2 ? 'S' : ',';
  }
  const decor = CORRIDOR_DECOR[floorIdx] || {};
  for (const ry in decor) for (const rx in decor[ry]) g[+ry][+rx] = decor[ry][rx];
  f.apts.forEach((id, slot) => {
    const a = apartmentById(id);
    const x0 = APT_X0 + slot * APT_STEP;
    for (let y = 0; y < APT_BLOCK_H; y++) {
      const row = a.rows[y];
      for (let x = 0; x < APT_BLOCK_W; x++) {
        const ch = row[x];
        const gx = x0 + x, gy = APT_Y0 + y;
        // shared columns: keep wall from either side
        if ((x === 0 || x === APT_BLOCK_W - 1) && ch === '#') { g[gy][gx] = '#'; continue; }
        g[gy][gx] = ch;
      }
    }
  });
  return g.map(r => r.join(''));
}

function aptSlotAt(x, y) {
  if (y < APT_Y0 + 1 || y >= FLOOR_H - 1) return -1;
  for (let s = 0; s < 3; s++) {
    const x0 = APT_X0 + s * APT_STEP;
    if (x > x0 && x < x0 + APT_BLOCK_W - 1) return s;
  }
  return -1;
}

// Build a full floor map from char rows.
export function parseMap(rows, opts = {}) {
  const h = rows.length, w = rows[0].length;
  const N = w * h;
  const map = {
    w, h, key: opts.key || 'map',
    tile: new Uint8Array(N), room: new Int16Array(N).fill(-1), apt: new Int8Array(N).fill(-1),
    prop: new Int16Array(N).fill(-1), surface: new Uint8Array(N), rug: new Uint8Array(N),
    props: [], rooms: [], doors: [], hideSpots: [], switches: [],
    markers: [], // {type, x, y, apt}
    aptInfo: opts.aptInfo || [], // [{id, label, name, slot, plaster}]
    corridorPlaster: opts.corridorPlaster || '#6f6a5c',
  };
  const idx = (x, y) => y * w + x;
  map.idx = idx;
  const roomMarkAt = [];
  const propCells = {};
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`Row ${y} length ${rows[y].length} != ${w} in ${map.key}`);
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      const i = idx(x, y);
      map.apt[i] = opts.aptOf ? opts.aptOf(x, y) : -1;
      let t = T.FLOOR;
      if (c === '#') t = T.WALL;
      else if (c === 'D') t = T.DOOR;
      else if (c === '_') t = T.ARCH;
      else if (c === 'w') t = T.WINDOW;
      else if (c === ':') t = T.RAIL;
      map.tile[i] = t;
      if (t !== T.FLOOR) continue;
      if (ROOM_MARK[c]) roomMarkAt.push({ x, y, type: ROOM_MARK[c] });
      else if (c === '~') map.rug[i] = 1;
      else if (c === '*') map.surface[i] = 1;
      else if (c === '=') map.surface[i] = 2;
      else if (c === ',') map.surface[i] = 3; // corridor linoleum
      else if (c >= '1' && c <= '7') map.markers.push({ type: +c, x, y, apt: map.apt[i] });
      else if (PROP_CHAR[c]) (propCells[c] ||= []).push([x, y]);
    }
  }
  // Props: group contiguous cells
  for (const ch in propCells) {
    const type = PROP_CHAR[ch];
    const def = PROP_DEF[type];
    const cells = propCells[ch];
    const seen = new Set();
    for (const [sx, sy] of cells) {
      const k0 = sx + ',' + sy;
      if (seen.has(k0)) continue;
      // flood
      const comp = [];
      const stack = [[sx, sy]];
      seen.add(k0);
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        if (!def.group) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (rows[ny][nx] !== ch) continue;
          const kk = nx + ',' + ny;
          if (seen.has(kk)) continue;
          seen.add(kk); stack.push([nx, ny]);
        }
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const [cx, cy] of comp) { x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
      const bw = x1 - x0 + 1, bd = y1 - y0 + 1;
      const pieces = (bw * bd === comp.length && bw <= 3 && bd <= 3) ? [[x0, y0, bw, bd]] : comp.map(([cx, cy]) => [cx, cy, 1, 1]);
      for (const [px, py, pw, pd] of pieces) {
        const p = { id: map.props.length, type, x: px, y: py, w: pw, d: pd, h: def.h, tall: !!def.tall, cover: !!def.cover, hide: def.hide || null, apt: map.apt[idx(px, py)], room: -1, seed: (px * 73 + py * 151) % 997 };
        map.props.push(p);
        for (let yy = py; yy < py + pd; yy++) for (let xx = px; xx < px + pw; xx++) map.prop[idx(xx, yy)] = p.id;
      }
    }
  }
  // Rooms: flood fill floor cells (bounded by walls, doors, arches, windows, rails)
  const roomOf = map.room;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i0 = idx(x, y);
    if (map.tile[i0] !== T.FLOOR || roomOf[i0] !== -1) continue;
    const rid = map.rooms.length;
    const room = { id: rid, type: null, cells: [], x0: x, y0: y, x1: x, y1: y, apt: map.apt[i0], lit: true, doors: [] };
    const stack = [[x, y]];
    roomOf[i0] = rid;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      room.cells.push([cx, cy]);
      room.x0 = Math.min(room.x0, cx); room.y0 = Math.min(room.y0, cy); room.x1 = Math.max(room.x1, cx); room.y1 = Math.max(room.y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = idx(nx, ny);
        if (map.tile[ni] !== T.FLOOR || roomOf[ni] !== -1) continue;
        roomOf[ni] = rid; stack.push([nx, ny]);
      }
    }
    map.rooms.push(room);
  }
  for (const m of roomMarkAt) {
    const r = map.rooms[roomOf[idx(m.x, m.y)]];
    if (r && !r.type) r.type = m.type;
  }
  for (const r of map.rooms) {
    if (!r.type) r.type = r.apt < 0 ? (opts.corridorType || 'corridor') : 'hall';
    r.cx = (r.x0 + r.x1 + 1) / 2; r.cy = (r.y0 + r.y1 + 1) / 2;
  }
  for (const p of map.props) p.room = roomOf[idx(p.x, p.y)];
  // Arches/doors get room of a neighbor for apt bookkeeping
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = map.tile[idx(x, y)];
    if (t !== T.DOOR && t !== T.ARCH) continue;
    const wallL = isWallish(map, x - 1, y), wallR = isWallish(map, x + 1, y);
    const axis = wallL && wallR ? 'x' : 'y'; // 'x': door leaf lies along x, passage along y
    const sides = axis === 'x' ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]];
    const rooms = sides.map(([sx, sy]) => (sx >= 0 && sy >= 0 && sx < w && sy < h) ? roomOf[idx(sx, sy)] : -1);
    if (t === T.DOOR) {
      const d = { id: map.doors.length, x, y, axis, rooms, apt: map.apt[idx(x, y)] };
      // front doors of apartments belong to the apartment
      if (d.apt < 0) { for (const r of rooms) if (r >= 0 && map.rooms[r].apt >= 0) d.apt = map.rooms[r].apt; }
      map.doors.push(d);
      for (const r of rooms) if (r >= 0) map.rooms[r].doors.push(d.id);
    } else {
      // arch: flag rooms connected
      for (const r of rooms) if (r >= 0) (map.rooms[r].arches ||= []).push({ x, y });
    }
  }
  map.doorAt = new Int16Array(N).fill(-1);
  for (const d of map.doors) map.doorAt[idx(d.x, d.y)] = d.id;

  // Hide spots
  for (const p of map.props) {
    if (!p.hide) continue;
    const access = adjacentFreeCells(map, p);
    if (!access.length) continue;
    map.hideSpots.push({ id: map.hideSpots.length, kind: p.hide, prop: p.id, x: p.x + p.w / 2, y: p.y + p.d / 2, access, room: p.room, apt: p.apt });
  }
  // Behind-door hiding spots in bathrooms (usable while door is open)
  for (const d of map.doors) {
    for (let s = 0; s < 2; s++) {
      const r = d.rooms[s];
      if (r < 0 || map.rooms[r].type !== 'bathroom') continue;
      const [cx, cy] = d.axis === 'x' ? [d.x, s === 0 ? d.y - 1 : d.y + 1] : [s === 0 ? d.x - 1 : d.x + 1, d.y];
      // corner cell beside the door's swing
      const cands = d.axis === 'x' ? [[cx - 1, cy], [cx + 1, cy]] : [[cx, cy - 1], [cx, cy + 1]];
      for (const [hx, hy] of cands) {
        if (!cellFree(map, hx, hy)) continue;
        if (map.room[idx(hx, hy)] !== r) continue;
        map.hideSpots.push({ id: map.hideSpots.length, kind: 'door', door: d.id, x: hx + 0.5, y: hy + 0.5, access: [[cx, cy]], room: r, apt: map.rooms[r].apt, cell: [hx, hy] });
        break;
      }
    }
  }
  // Light switches: interior cell next to the first door of each room, plate on a back wall
  for (const r of map.rooms) {
    if (r.type === 'balcony') continue;
    let placed = null;
    for (const did of r.doors) {
      const d = map.doors[did];
      const s = d.rooms[0] === r.id ? 0 : 1;
      const [cx, cy] = d.axis === 'x' ? [d.x, s === 0 ? d.y - 1 : d.y + 1] : [s === 0 ? d.x - 1 : d.x + 1, d.y];
      const cands = d.axis === 'x' ? [[cx + 1, cy], [cx - 1, cy], [cx, cy]] : [[cx, cy + 1], [cx, cy - 1], [cx, cy]];
      for (const [sx, sy] of cands) {
        if (!cellFree(map, sx, sy) || map.room[idx(sx, sy)] !== r.id) continue;
        let wall = null;
        if (isWallish(map, sx - 1, sy) && map.tile[idx(sx - 1, sy)] === T.WALL) wall = 'w';
        else if (isWallish(map, sx, sy - 1) && map.tile[idx(sx, sy - 1)] === T.WALL) wall = 'n';
        placed = { room: r.id, x: sx, y: sy, wall };
        if (wall) break;
      }
      if (placed && placed.wall) break;
    }
    if (placed) { r.switchIdx = map.switches.length; map.switches.push(placed); }
  }
  return map;
}

export function isWallish(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true;
  const t = map.tile[y * map.w + x];
  return t === T.WALL || t === T.WINDOW || t === T.DOOR || t === T.VOID || t === T.RAIL;
}
export function cellFree(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const i = y * map.w + x;
  return map.tile[i] === T.FLOOR && map.prop[i] < 0;
}
export function adjacentFreeCells(map, p) {
  const out = [];
  for (let x = p.x; x < p.x + p.w; x++) { if (cellFree(map, x, p.y - 1)) out.push([x, p.y - 1]); if (cellFree(map, x, p.y + p.d)) out.push([x, p.y + p.d]); }
  for (let y = p.y; y < p.y + p.d; y++) { if (cellFree(map, p.x - 1, y)) out.push([p.x - 1, y]); if (cellFree(map, p.x + p.w, y)) out.push([p.x + p.w, y]); }
  return out;
}

const cache = new Map();
export function buildFloor(floorIdx) {
  const key = 'F' + floorIdx;
  if (cache.has(key)) return cache.get(key);
  const rows = composeFloorChars(floorIdx);
  const f = FLOORS[floorIdx];
  const aptInfo = f.apts.map((id, slot) => { const a = apartmentById(id); return { id, slot, label: aptLabel(floorIdx, slot), name: a.name, plaster: a.plaster }; });
  const map = parseMap(rows, { key, aptOf: aptSlotAt, aptInfo, corridorPlaster: f.tint });
  map.floor = floorIdx;
  // stairs room type
  for (const r of map.rooms) if (r.apt < 0) r.type = 'corridor';
  map.stairs = map.props.find(p => p.type === 'stairs');
  cache.set(key, map);
  return map;
}
export function buildTutorial() {
  if (cache.has('TUT')) return cache.get('TUT');
  const map = parseMap(TUTORIAL.rows, { key: 'TUT', aptOf: () => 0, aptInfo: [{ id: 'TUT', slot: 0, label: 'T', name: TUTORIAL.name, plaster: TUTORIAL.plaster }] });
  map.floor = -1;
  map.stairs = null;
  cache.set('TUT', map);
  return map;
}
export function markersOf(map, apt, type) { return map.markers.filter(m => m.apt === apt && m.type === type); }
