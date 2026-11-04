// Procedural texture generation: floors (top-down, later iso-projected), wall faces, doors.
import { hash2, RNG } from './core-util.js';
import { T } from './world-building.js';
import { hexToRgb, mix } from './render-iso.js';

export const FP = 40; // floor canvas px per tile

function mk(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export const makeCanvas = mk;

let noiseTex = null;
function noise() {
  if (noiseTex) return noiseTex;
  const c = mk(128, 128); const x = c.getContext('2d');
  const id = x.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = (Math.random() * 255) | 0; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  noiseTex = c; return c;
}
function speckle(ctx, x0, y0, w, h, rng, n, col, a0, a1, s0, s1) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = a0 + (a1 - a0) * rng.next();
    ctx.fillStyle = col;
    const s = s0 + (s1 - s0) * rng.next();
    ctx.fillRect(x0 + rng.next() * w, y0 + rng.next() * h, s, s * (0.6 + rng.next()));
  }
  ctx.globalAlpha = 1;
}
function blotch(ctx, x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const [R, G, B] = hexToRgb(col);
  g.addColorStop(0, `rgba(${R},${G},${B},${a})`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const WOOD = { living: ['#6e5135', '#5e4429', '#7a5a3a'], bedroom: ['#76593c', '#634a30', '#806244'], hall: ['#5e4630', '#52402c', '#6a5038'], office: ['#5a4530', '#4c3a28', '#664e36'] };

function drawWood(ctx, x0, y0, w, h, rng, pal) {
  const ph = FP * 0.2;
  for (let y = y0; y < y0 + h; y += ph) {
    let x = x0 - rng.next() * FP * 1.5;
    while (x < x0 + w) {
      const len = FP * (0.9 + rng.next() * 1.6);
      const base = pal[(rng.next() * pal.length) | 0];
      ctx.fillStyle = mix(base, '#000000', rng.next() * 0.18);
      ctx.fillRect(x, y, len, ph);
      // grain
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#2a1d12'; ctx.lineWidth = 0.6;
      for (let k = 0; k < 3; k++) { const gy = y + ph * (0.2 + rng.next() * 0.6); ctx.beginPath(); ctx.moveTo(x, gy); ctx.bezierCurveTo(x + len * 0.3, gy + rng.range(-1.5, 1.5), x + len * 0.7, gy + rng.range(-1.5, 1.5), x + len, gy); ctx.stroke(); }
      // wear highlight
      if (rng.chance(0.25)) { ctx.globalAlpha = 0.12; ctx.fillStyle = '#d8c0a0'; ctx.fillRect(x + len * 0.2, y + 1, len * 0.4, ph - 2); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(20,12,6,0.85)';
      ctx.fillRect(x + len - 1, y, 1.2, ph);
      // nails
      ctx.fillStyle = 'rgba(30,25,20,0.5)'; ctx.fillRect(x + 2, y + 2, 1, 1); ctx.fillRect(x + 2, y + ph - 3, 1, 1);
      x += len;
    }
    ctx.fillStyle = 'rgba(18,10,4,0.7)';
    ctx.fillRect(x0, y + ph - 1, w, 1);
  }
}
function drawTiles(ctx, x0, y0, w, h, rng, size, c1, c2, grout, checker = true) {
  const s = FP * size;
  for (let y = y0, j = 0; y < y0 + h; y += s, j++) for (let x = x0, i = 0; x < x0 + w; x += s, i++) {
    const base = checker ? ((i + j) % 2 ? c1 : c2) : (rng.chance(0.5) ? c1 : c2);
    ctx.fillStyle = mix(base, '#3a3020', rng.next() * 0.22);
    ctx.fillRect(x, y, s, s);
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 1, s - 2, 1.2); ctx.globalAlpha = 1;
    if (rng.chance(0.07)) { ctx.strokeStyle = 'rgba(30,25,20,0.6)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x + rng.next() * s, y); ctx.lineTo(x + rng.next() * s, y + s * 0.5); ctx.lineTo(x + rng.next() * s, y + s); ctx.stroke(); }
    if (rng.chance(0.04)) { ctx.fillStyle = 'rgba(25,22,18,0.55)'; ctx.fillRect(x + 1, y + 1, s - 2, s - 2); } // missing tile
  }
  ctx.fillStyle = grout;
  for (let y = y0; y < y0 + h; y += s) ctx.fillRect(x0, y, w, 1);
  for (let x = x0; x < x0 + w; x += s) ctx.fillRect(x, y0, 1, h);
}
function drawConcrete(ctx, x0, y0, w, h, rng, col, pavers) {
  ctx.fillStyle = col; ctx.fillRect(x0, y0, w, h);
  speckle(ctx, x0, y0, w, h, rng, (w * h) / 40, '#000', 0.05, 0.18, 1, 3);
  speckle(ctx, x0, y0, w, h, rng, (w * h) / 80, '#fff', 0.03, 0.1, 1, 2);
  if (pavers) { ctx.fillStyle = 'rgba(20,20,18,0.5)'; const s = FP * 0.5; for (let y = y0; y < y0 + h; y += s) ctx.fillRect(x0, y, w, 1); for (let x = x0; x < x0 + w; x += s) ctx.fillRect(x, y0, 1, h); for (let i = 0; i < 6; i++) blotch(ctx, x0 + rng.next() * w, y0 + rng.next() * h, FP * 0.4, '#3b4a2a', 0.35); }
  ctx.strokeStyle = 'rgba(20,18,15,0.5)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < (w * h) / (FP * FP * 3); i++) { let x = x0 + rng.next() * w, y = y0 + rng.next() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rng.range(-8, 8); y += rng.range(-8, 8); ctx.lineTo(x, y); } ctx.stroke(); }
}
function drawLino(ctx, x0, y0, w, h, rng) {
  ctx.fillStyle = '#566050'; ctx.fillRect(x0, y0, w, h);
  const s = FP * 0.5;
  for (let y = y0, j = 0; y < y0 + h; y += s, j++) for (let x = x0, i = 0; x < x0 + w; x += s, i++) { ctx.fillStyle = (i + j) % 2 ? 'rgba(255,250,230,0.05)' : 'rgba(0,0,0,0.05)'; ctx.fillRect(x, y, s, s); }
  // worn walking path
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  g.addColorStop(0, 'rgba(0,0,0,0.12)'); g.addColorStop(0.5, 'rgba(200,190,160,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
  speckle(ctx, x0, y0, w, h, rng, (w * h) / 60, '#1a1a14', 0.08, 0.25, 1, 4);
  for (let i = 0; i < w / 50; i++) { ctx.strokeStyle = 'rgba(15,15,10,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); const x = x0 + rng.next() * w, y = y0 + rng.next() * h; ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-20, 20), y + rng.range(-3, 3)); ctx.stroke(); }
}
function drawRug(ctx, x0, y0, w, h, rng) {
  const pal = rng.pick([['#6e3328', '#a07a4a', '#3a2a22'], ['#38465a', '#8a7a5a', '#232a36'], ['#6d5a2e', '#9a4a32', '#2e2618'], ['#4a5a3a', '#a08a5a', '#26301e']]);
  const inset = 3;
  ctx.fillStyle = pal[2]; ctx.fillRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2);
  ctx.fillStyle = pal[0]; ctx.fillRect(x0 + inset + 5, y0 + inset + 5, w - inset * 2 - 10, h - inset * 2 - 10);
  ctx.strokeStyle = pal[1]; ctx.lineWidth = 2; ctx.strokeRect(x0 + inset + 8, y0 + inset + 8, w - inset * 2 - 16, h - inset * 2 - 16);
  // diamond medallions
  ctx.fillStyle = pal[1]; ctx.globalAlpha = 0.6;
  const cx = x0 + w / 2, cy = y0 + h / 2;
  for (let k = 0; k < 3; k++) { const s = (Math.min(w, h) / 2 - 14) * (1 - k * 0.32); ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 1.3, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s * 1.3, cy); ctx.closePath(); ctx.globalAlpha = 0.25 + k * 0.15; ctx.fill(); }
  ctx.globalAlpha = 1;
  // fringe
  ctx.strokeStyle = '#b8a888'; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.6;
  for (let x = x0 + inset; x < x0 + w - inset; x += 2.5) { ctx.beginPath(); ctx.moveTo(x, y0 + inset); ctx.lineTo(x, y0); ctx.moveTo(x, y0 + h - inset); ctx.lineTo(x, y0 + h); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // wear & stains
  for (let i = 0; i < 5; i++) blotch(ctx, x0 + rng.next() * w, y0 + rng.next() * h, rng.range(6, 18), '#1a1410', 0.3);
  speckle(ctx, x0, y0, w, h, rng, (w * h) / 30, '#000', 0.05, 0.2, 1, 2);
}

// Build iso floor texture for a map (top-down, FP px per tile)
export function buildFloorCanvas(map) {
  const W = map.w * FP, H = map.h * FP;
  const c = mk(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, W, H);
  const rng = new RNG(map.w * 31 + map.h * 7 + (map.floor + 3) * 977);
  for (const r of map.rooms) {
    ctx.save();
    ctx.beginPath();
    for (const [x, y] of r.cells) ctx.rect(x * FP, y * FP, FP, FP);
    // include adjacent door/arch cells as thresholds of the first room
    ctx.clip();
    const x0 = r.x0 * FP, y0 = r.y0 * FP, w = (r.x1 - r.x0 + 1) * FP, h = (r.y1 - r.y0 + 1) * FP;
    switch (r.type) {
      case 'kitchen': drawTiles(ctx, x0, y0, w, h, rng, 0.5, '#b0a78c', '#5f5b4c', 'rgba(30,28,20,0.7)'); break;
      case 'bathroom': drawTiles(ctx, x0, y0, w, h, rng, 0.25, '#a3aaa4', '#8b948f', 'rgba(40,45,42,0.7)', false); break;
      case 'laundry': drawTiles(ctx, x0, y0, w, h, rng, 0.33, '#7c8584', '#6d7574', 'rgba(30,34,34,0.7)', false); break;
      case 'storage': drawConcrete(ctx, x0, y0, w, h, rng, '#64615a', false); break;
      case 'balcony': drawConcrete(ctx, x0, y0, w, h, rng, '#4e4d48', true); break;
      case 'corridor': drawLino(ctx, x0, y0, w, h, rng); break;
      default: drawWood(ctx, x0, y0, w, h, rng, WOOD[r.type] || WOOD.hall);
    }
    // grime
    for (let i = 0; i < r.cells.length / 3; i++) { const [cx, cy] = rng.pick(r.cells); blotch(ctx, (cx + rng.next()) * FP, (cy + rng.next()) * FP, rng.range(10, 34), '#140e08', rng.range(0.08, 0.22)); }
    ctx.restore();
  }
  // door & arch thresholds
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.tile[y * map.w + x];
    if (t !== T.DOOR && t !== T.ARCH) continue;
    ctx.fillStyle = '#4a3a2a'; ctx.fillRect(x * FP, y * FP, FP, FP);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x * FP + 2, y * FP + 2, FP - 4, FP - 4);
  }
  // rugs: connected rectangles
  const seen = new Uint8Array(map.w * map.h);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const i = y * map.w + x;
    if (!map.rug[i] || seen[i]) continue;
    let x1 = x; while (x1 + 1 < map.w && map.rug[y * map.w + x1 + 1]) x1++;
    let y1 = y; while (y1 + 1 < map.h && map.rug[(y1 + 1) * map.w + x]) y1++;
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) seen[yy * map.w + xx] = 1;
    drawRug(ctx, x * FP, y * FP, (x1 - x + 1) * FP, (y1 - y + 1) * FP, rng);
  }
  // surfaces
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const s = map.surface[y * map.w + x];
    if (s === 1) { // broken glass
      for (let k = 0; k < 16; k++) {
        const px = (x + 0.15 + rng.next() * 0.7) * FP, py = (y + 0.15 + rng.next() * 0.7) * FP;
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(210,230,235,0.85)' : 'rgba(120,150,160,0.8)';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + rng.range(-4, 4), py + rng.range(1, 5)); ctx.lineTo(px + rng.range(1, 5), py + rng.range(-3, 3)); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(230,240,240,0.5)'; ctx.lineWidth = 0.6; ctx.strokeRect(x * FP + 4, y * FP + 4, FP - 8, FP - 8);
    } else if (s === 2) { // squeaky boards: lifted, lighter planks with nail heads
      ctx.fillStyle = 'rgba(190,150,100,0.28)'; ctx.fillRect(x * FP + 2, y * FP + FP * 0.3, FP - 4, FP * 0.4);
      ctx.strokeStyle = 'rgba(20,10,0,0.7)'; ctx.lineWidth = 1.2; ctx.strokeRect(x * FP + 2, y * FP + FP * 0.3, FP - 4, FP * 0.4);
      ctx.fillStyle = '#c8b89a'; for (const nx of [0.2, 0.8]) ctx.fillRect(x * FP + FP * nx, y * FP + FP * 0.48, 2, 2);
    }
  }
  // ambient occlusion along walls
  const wallish = (x, y) => { if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true; const t = map.tile[y * map.w + x]; return t === T.WALL || t === T.WINDOW; };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.tile[y * map.w + x];
    if (t !== T.FLOOR && t !== T.ARCH && t !== T.DOOR) continue;
    const px = x * FP, py = y * FP, ao = FP * 0.38;
    const sides = [[0, -1, px, py, px, py + ao], [-1, 0, px, py, px + ao, py], [0, 1, px, py + FP, px, py + FP - ao], [1, 0, px + FP, py, px + FP - ao, py]];
    for (const [dx, dy, gx0, gy0, gx1, gy1] of sides) {
      if (!wallish(x + dx, y + dy)) continue;
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(px, py, FP, FP);
    }
  }
  // prop contact shadows (soft)
  for (const p of map.props) {
    if (p.type === 'stairs') continue;
    const g = ctx.createRadialGradient((p.x + p.w / 2) * FP, (p.y + p.d / 2) * FP, 0, (p.x + p.w / 2) * FP, (p.y + p.d / 2) * FP, Math.max(p.w, p.d) * FP * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect((p.x - 0.4) * FP, (p.y - 0.4) * FP, (p.w + 0.8) * FP, (p.d + 0.8) * FP);
  }
  // global noise grain
  ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
  const pat = ctx.createPattern(noise(), 'repeat'); ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return c;
}

// Wall face textures: 64 x 86 px (1 tile wide, 2.4 m tall)
export const WALL_TW = 64, WALL_TH = 86;
const wallCache = new Map();
export function wallTexture(kind, tint, variant) {
  const key = kind + tint + variant;
  let c = wallCache.get(key);
  if (c) return c;
  c = mk(WALL_TW, WALL_TH); const x = c.getContext('2d');
  const rng = new RNG(variant * 7919 + tint.length * 31 + kind.length);
  if (kind === 'ext') {
    x.fillStyle = '#353a45'; x.fillRect(0, 0, WALL_TW, WALL_TH);
    const bh = 9;
    for (let y = 0, j = 0; y < WALL_TH; y += bh, j++) {
      let xx = -(j % 2) * 10 - rng.next() * 6;
      while (xx < WALL_TW) {
        const bw = 14 + rng.next() * 12;
        x.fillStyle = mix('#414856', rng.chance(0.5) ? '#2a2e38' : '#4d5462', rng.next() * 0.6);
        x.fillRect(xx + 1, y + 1, bw - 2, bh - 2);
        x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(xx + 1, y + 1, bw - 2, 1.2);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(xx + 1, y + bh - 2, bw - 2, 1);
        xx += bw;
      }
    }
    for (let i = 0; i < 4; i++) blotch(x, rng.next() * WALL_TW, rng.next() * WALL_TH, rng.range(8, 20), '#10141a', 0.35);
  } else {
    const isCorr = kind === 'corr';
    const base = isCorr ? '#8b8670' : tint;
    x.fillStyle = base; x.fillRect(0, 0, WALL_TW, WALL_TH);
    speckle(x, 0, 0, WALL_TW, WALL_TH, rng, 260, '#000', 0.03, 0.12, 1, 2.5);
    speckle(x, 0, 0, WALL_TW, WALL_TH, rng, 120, '#fff', 0.03, 0.08, 1, 2);
    if (isCorr) {
      x.fillStyle = '#46523f'; x.fillRect(0, WALL_TH * 0.55, WALL_TW, WALL_TH * 0.45);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, WALL_TH * 0.55, WALL_TW, 2);
    } else if (variant % 3 === 1) {
      // faded wallpaper stripes
      x.globalAlpha = 0.12; x.fillStyle = '#2a2418';
      for (let s = 0; s < WALL_TW; s += 8) x.fillRect(s, 0, 3, WALL_TH * 0.85);
      x.globalAlpha = 1;
    }
    // water stains from top
    for (let i = 0; i < 2; i++) { const sx = rng.next() * WALL_TW; const g = x.createLinearGradient(0, 0, 0, WALL_TH * 0.6); g.addColorStop(0, 'rgba(60,45,20,0.35)'); g.addColorStop(1, 'rgba(60,45,20,0)'); x.fillStyle = g; x.fillRect(sx - 6, 0, rng.range(8, 18), WALL_TH * 0.6); }
    // damaged plaster revealing bricks
    if (variant === 2 && rng.chance(0.7)) {
      const px = rng.range(4, WALL_TW - 24), py = rng.range(14, WALL_TH - 34), pw = rng.range(9, 20), ph = rng.range(7, 16);
      x.save(); x.beginPath(); x.moveTo(px, py + ph * 0.3); x.lineTo(px + pw * 0.4, py); x.lineTo(px + pw, py + ph * 0.2); x.lineTo(px + pw * 0.9, py + ph); x.lineTo(px + pw * 0.2, py + ph * 0.9); x.closePath(); x.clip();
      x.fillStyle = mix('#5e4032', tint, 0.35); x.fillRect(px, py, pw, ph);
      x.fillStyle = 'rgba(30,20,15,0.8)'; for (let by = py; by < py + ph; by += 4) { x.fillRect(px, by, pw, 0.8); for (let bx = px + ((by / 4) % 2) * 4; bx < px + pw; bx += 8) x.fillRect(bx, by, 0.8, 4); }
      x.restore();
      x.strokeStyle = 'rgba(40,30,20,0.6)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py + ph * 0.3); x.lineTo(px + pw * 0.4, py); x.lineTo(px + pw, py + ph * 0.2); x.lineTo(px + pw * 0.9, py + ph); x.lineTo(px + pw * 0.2, py + ph * 0.9); x.closePath(); x.stroke();
    }
    // cracks
    x.strokeStyle = 'rgba(30,25,18,0.55)'; x.lineWidth = 0.7;
    for (let i = 0; i < 2; i++) { let cx = rng.next() * WALL_TW, cy = rng.next() * WALL_TH * 0.5; x.beginPath(); x.moveTo(cx, cy); for (let k = 0; k < 5; k++) { cx += rng.range(-6, 6); cy += rng.range(2, 8); x.lineTo(cx, cy); } x.stroke(); }
    // dirt band near floor + baseboard
    const g = x.createLinearGradient(0, WALL_TH * 0.7, 0, WALL_TH);
    g.addColorStop(0, 'rgba(30,20,10,0)'); g.addColorStop(1, 'rgba(30,20,10,0.4)');
    x.fillStyle = g; x.fillRect(0, WALL_TH * 0.7, WALL_TW, WALL_TH * 0.3);
    x.fillStyle = '#3a2c1e'; x.fillRect(0, WALL_TH - 5, WALL_TW, 5);
    x.fillStyle = 'rgba(255,230,190,0.15)'; x.fillRect(0, WALL_TH - 5, WALL_TW, 1);
    // top shadow (ceiling)
    const g2 = x.createLinearGradient(0, 0, 0, 14); g2.addColorStop(0, 'rgba(0,0,0,0.45)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g2; x.fillRect(0, 0, WALL_TW, 14);
  }
  wallCache.set(key, c);
  return c;
}
