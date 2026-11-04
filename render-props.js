// Isometric furniture drawing built from shaded boxes and details.
import { shade } from './render-iso.js';
import { isWallish } from './world-building.js';

const F_TOP = 1.0, F_S = 0.78, F_E = 0.6;

export function P(cam, x, y, z) { return [cam.sx_(x, y), cam.sy_(x, y, z)]; }
function poly(ctx, pts, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}
// Shaded axis-aligned box. col may be one color or [top, south, east]
export function box(ctx, cam, x0, y0, x1, y1, z0, z1, col, L = 1, edge = true) {
  const [ct, cs, ce] = Array.isArray(col) ? col : [col, col, col];
  const s = edge ? 'rgba(0,0,0,0.35)' : null;
  ctx.lineWidth = 0.7;
  poly(ctx, [P(cam, x0, y1, z0), P(cam, x1, y1, z0), P(cam, x1, y1, z1), P(cam, x0, y1, z1)], shade(cs, F_S * L), s);
  poly(ctx, [P(cam, x1, y0, z0), P(cam, x1, y1, z0), P(cam, x1, y1, z1), P(cam, x1, y0, z1)], shade(ce, F_E * L), s);
  poly(ctx, [P(cam, x0, y0, z1), P(cam, x1, y0, z1), P(cam, x1, y1, z1), P(cam, x0, y1, z1)], shade(ct, F_TOP * L), s);
}
function topQuad(ctx, cam, x0, y0, x1, y1, z, col, L) { poly(ctx, [P(cam, x0, y0, z), P(cam, x1, y0, z), P(cam, x1, y1, z), P(cam, x0, y1, z)], shade(col, L)); }
function lineW(ctx, cam, a, b, col, w) { const p1 = P(cam, ...a), p2 = P(cam, ...b); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke(); }
function ellipseTop(ctx, cam, cx, cy, z, rx, ry, col, L) {
  const pts = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; pts.push(P(cam, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z)); }
  poly(ctx, pts, shade(col, L));
}
// face detail on the south face (y=y1) between u0..u1 along x and v0..v1 heights
function southRect(ctx, cam, y, x0, x1, z0, z1, col, L) { poly(ctx, [P(cam, x0, y, z0), P(cam, x1, y, z0), P(cam, x1, y, z1), P(cam, x0, y, z1)], shade(col, F_S * L)); }
function eastRect(ctx, cam, x, y0, y1, z0, z1, col, L) { poly(ctx, [P(cam, x, y0, z0), P(cam, x, y1, z0), P(cam, x, y1, z1), P(cam, x, y0, z1)], shade(col, F_E * L)); }

// Which side of the prop touches a wall: 'n','s','w','e'
function wallSide(map, p) {
  const sc = { n: 0, s: 0, w: 0, e: 0 };
  for (let x = p.x; x < p.x + p.w; x++) { if (isWallish(map, x, p.y - 1)) sc.n++; if (isWallish(map, x, p.y + p.d)) sc.s++; }
  for (let y = p.y; y < p.y + p.d; y++) { if (isWallish(map, p.x - 1, y)) sc.w++; if (isWallish(map, p.x + p.w, y)) sc.e++; }
  let best = 'n', bv = -1; for (const k of ['n', 'w', 's', 'e']) if (sc[k] > bv) { bv = sc[k]; best = k; }
  return bv > 0 ? best : (p.w >= p.d ? 'n' : 'w');
}

const WOODS = ['#5a4030', '#4a3424', '#6b5038', '#3e2e22'];
const FABRICS = ['#6a5a48', '#5a4a3e', '#4e5a4a', '#6b4a3c', '#545866'];

export function drawProp(ctx, cam, p, L, map, time) {
  const x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.d, s = p.seed;
  const wood = WOODS[s % WOODS.length], fab = FABRICS[s % FABRICS.length];
  switch (p.type) {
    case 'bed': {
      const side = wallSide(map, p);
      const i = 0.08;
      box(ctx, cam, x0 + i, y0 + i, x1 - i, y1 - i, 0, 0.32, wood, L);
      box(ctx, cam, x0 + i + 0.04, y0 + i + 0.04, x1 - i - 0.04, y1 - i - 0.04, 0.32, 0.48, '#b9b2a2', L);
      // blanket covering the foot two thirds
      const bl = ['#6c3a30', '#3e4c62', '#5c5a3a', '#4e3a50'][s % 4];
      const head = { n: [x0, y0, x1, y0 + 0.75], s: [x0, y1 - 0.75, x1, y1], w: [x0, y0, x0 + 0.75, y1], e: [x1 - 0.75, y0, x1, y1] }[side];
      const foot = { n: [x0 + i, y0 + 0.8, x1 - i, y1 - i], s: [x0 + i, y0 + i, x1 - i, y1 - 0.8], w: [x0 + 0.8, y0 + i, x1 - i, y1 - i], e: [x0 + i, y0 + i, x1 - 0.8, y1 - i] }[side];
      box(ctx, cam, foot[0], foot[1], foot[2], foot[3], 0.46, 0.53, bl, L);
      // folds
      ctx.globalAlpha = 0.3; lineW(ctx, cam, [foot[0] + 0.2, foot[1] + 0.3, 0.535], [foot[2] - 0.3, foot[3] - 0.2, 0.535], '#000', 1); ctx.globalAlpha = 1;
      // pillows
      const hx = (head[0] + head[2]) / 2, hy = (head[1] + head[3]) / 2;
      const along = side === 'n' || side === 's';
      for (const o of p.w * p.d > 2 ? [-0.45, 0.45] : [0]) {
        const cx = along ? hx + o : hx, cy = along ? hy : hy + o;
        box(ctx, cam, cx - 0.28, cy - 0.16, cx + 0.28, cy + 0.16, 0.48, 0.6, '#d8d2c0', L);
      }
      // headboard
      const hb = { n: [x0 + 0.02, y0 + 0.02, x1 - 0.02, y0 + 0.14], s: [x0 + 0.02, y1 - 0.14, x1 - 0.02, y1 - 0.02], w: [x0 + 0.02, y0 + 0.02, x0 + 0.14, y1 - 0.02], e: [x1 - 0.14, y0 + 0.02, x1 - 0.02, y1 - 0.02] }[side];
      box(ctx, cam, hb[0], hb[1], hb[2], hb[3], 0, 0.95, wood, L);
      break;
    }
    case 'wardrobe': {
      const col = s % 2 ? '#4f3a28' : '#6a6250';
      box(ctx, cam, x0 + 0.05, y0 + 0.08, x1 - 0.05, y1 - 0.08, 0, 2.0, col, L);
      // door seams & handles on visible faces
      ctx.globalAlpha = 0.6;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      lineW(ctx, cam, [mx, y1 - 0.08, 0.05], [mx, y1 - 0.08, 1.95], '#1a120a', 1);
      lineW(ctx, cam, [x1 - 0.05, my, 0.05], [x1 - 0.05, my, 1.95], '#1a120a', 1);
      ctx.globalAlpha = 1;
      southRect(ctx, cam, y1 - 0.08, mx - 0.09, mx - 0.04, 1.0, 1.12, '#c8b070', L);
      southRect(ctx, cam, y1 - 0.08, mx + 0.04, mx + 0.09, 1.0, 1.12, '#c8b070', L);
      eastRect(ctx, cam, x1 - 0.05, my - 0.09, my - 0.04, 1.0, 1.12, '#c8b070', L);
      // crown
      box(ctx, cam, x0 + 0.02, y0 + 0.05, x1 - 0.02, y1 - 0.05, 2.0, 2.06, col, L * 0.9);
      // something stacked on top
      if (s % 3 === 0) box(ctx, cam, x0 + 0.2, y0 + 0.2, x0 + 0.7, y0 + 0.6, 2.06, 2.3, '#7a6a4a', L);
      break;
    }
    case 'table': {
      const i = 0.1;
      for (const [lx, ly] of [[x0 + i + 0.05, y0 + i + 0.05], [x1 - i - 0.1, y0 + i + 0.05], [x0 + i + 0.05, y1 - i - 0.1], [x1 - i - 0.1, y1 - i - 0.1]]) box(ctx, cam, lx, ly, lx + 0.06, ly + 0.06, 0, 0.7, wood, L, false);
      // chairs tucked in
      const chairs = [];
      if (p.w >= p.d) { for (let k = 0; k < p.w; k++) { chairs.push([x0 + k + 0.3, y0 - 0.05, 'n']); chairs.push([x0 + k + 0.3, y1 - 0.35, 's']); } }
      else { for (let k = 0; k < p.d; k++) { chairs.push([x0 - 0.05, y0 + k + 0.3, 'w']); chairs.push([x1 - 0.35, y0 + k + 0.3, 'e']); } }
      for (const [cx, cy, d] of chairs) {
        if (d === 's' || d === 'e') continue; // drawn after top
        drawChair(ctx, cam, cx, cy, d, wood, L);
      }
      box(ctx, cam, x0 + i, y0 + i, x1 - i, y1 - i, 0.7, 0.76, wood, L);
      // tablecloth stain / items
      ellipseTop(ctx, cam, x0 + p.w * 0.35, y0 + p.d * 0.4, 0.765, 0.13, 0.13, '#c8c0b0', L);
      ellipseTop(ctx, cam, x0 + p.w * 0.35, y0 + p.d * 0.4, 0.77, 0.08, 0.08, '#8a8070', L);
      box(ctx, cam, x0 + p.w * 0.62, y0 + p.d * 0.55, x0 + p.w * 0.62 + 0.07, y0 + p.d * 0.55 + 0.07, 0.76, 1.0, '#3e5a3a', L);
      box(ctx, cam, x0 + p.w * 0.5, y0 + p.d * 0.28, x0 + p.w * 0.5 + 0.06, y0 + p.d * 0.28 + 0.06, 0.76, 0.86, '#d0c8b8', L);
      for (const [cx, cy, d] of chairs) if (d === 's' || d === 'e') drawChair(ctx, cam, cx, cy, d, wood, L);
      break;
    }
    case 'counter': {
      box(ctx, cam, x0 + 0.02, y0 + 0.02, x1 - 0.02, y1 - 0.02, 0.08, 0.86, '#6e6650', L);
      box(ctx, cam, x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06, 0, 0.08, '#2a241c', L, false);
      // cabinet door lines
      ctx.globalAlpha = 0.5; lineW(ctx, cam, [x0 + 0.5, y1 - 0.02, 0.12], [x0 + 0.5, y1 - 0.02, 0.8], '#1a1410', 1); lineW(ctx, cam, [x1 - 0.02, y0 + 0.5, 0.12], [x1 - 0.02, y0 + 0.5, 0.8], '#1a1410', 1); ctx.globalAlpha = 1;
      box(ctx, cam, x0, y0, x1, y1, 0.86, 0.92, '#a59e88', L);
      const v = s % 4;
      if (v === 0) { // sink
        topQuad(ctx, cam, x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, 0.921, '#3a3e40', L);
        topQuad(ctx, cam, x0 + 0.25, y0 + 0.25, x1 - 0.25, y1 - 0.25, 0.922, '#55606a', L);
        box(ctx, cam, x0 + 0.45, y0 + 0.08, x0 + 0.52, y0 + 0.15, 0.92, 1.12, '#9aa0a4', L);
      } else if (v === 1) { // stove
        box(ctx, cam, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0.92, 0.95, '#2a2a2a', L);
        for (const [bx, by] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) ellipseTop(ctx, cam, x0 + bx, y0 + by, 0.955, 0.1, 0.1, '#111', L);
        box(ctx, cam, x0 + 0.55, y0 + 0.55, x0 + 0.85, y0 + 0.85, 0.95, 1.08, '#5a4a3a', L); // pot
      } else if (v === 2) {
        box(ctx, cam, x0 + 0.2, y0 + 0.2, x0 + 0.34, y0 + 0.34, 0.92, 1.18, '#3a5a40', L);
        box(ctx, cam, x0 + 0.45, y0 + 0.5, x0 + 0.8, y0 + 0.75, 0.92, 0.98, '#c8c0b0', L);
      } else {
        box(ctx, cam, x0 + 0.3, y0 + 0.25, x0 + 0.55, y0 + 0.5, 0.92, 1.1, '#8a3a2a', L);
      }
      break;
    }
    case 'fridge': {
      box(ctx, cam, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0, 1.8, '#b4b0a2', L);
      ctx.globalAlpha = 0.6; lineW(ctx, cam, [x0 + 0.08, y1 - 0.08, 1.15], [x1 - 0.08, y1 - 0.08, 1.15], '#3a3a34', 1); lineW(ctx, cam, [x1 - 0.08, y0 + 0.08, 1.15], [x1 - 0.08, y1 - 0.08, 1.15], '#3a3a34', 1); ctx.globalAlpha = 1;
      southRect(ctx, cam, y1 - 0.08, x1 - 0.25, x1 - 0.2, 0.75, 1.05, '#6a6a64', L);
      southRect(ctx, cam, y1 - 0.08, x1 - 0.25, x1 - 0.2, 1.25, 1.5, '#6a6a64', L);
      // rust
      ctx.globalAlpha = 0.35; southRect(ctx, cam, y1 - 0.08, x0 + 0.2, x0 + 0.35, 0.05, 0.25, '#6a3a1a', L); ctx.globalAlpha = 1;
      break;
    }
    case 'sofa': case 'armchair': {
      const side = wallSide(map, p);
      const i = 0.06;
      box(ctx, cam, x0 + i, y0 + i, x1 - i, y1 - i, 0, 0.4, fab, L);
      // back
      const bk = { n: [x0 + i, y0 + i, x1 - i, y0 + 0.32], s: [x0 + i, y1 - 0.32, x1 - i, y1 - i], w: [x0 + i, y0 + i, x0 + 0.32, y1 - i], e: [x1 - 0.32, y0 + i, x1 - i, y1 - i] }[side];
      const seat = { n: [x0 + i, y0 + 0.32, x1 - i, y1 - i], s: [x0 + i, y0 + i, x1 - i, y1 - 0.32], w: [x0 + 0.32, y0 + i, x1 - i, y1 - i], e: [x0 + i, y0 + i, x1 - 0.32, y1 - i] }[side];
      const backFirst = side === 'n' || side === 'w';
      const drawBack = () => box(ctx, cam, bk[0], bk[1], bk[2], bk[3], 0.4, 0.82, fab, L * 0.95);
      if (backFirst) drawBack();
      // cushions
      const along = side === 'n' || side === 's';
      const n = Math.max(1, along ? p.w : p.d);
      for (let k = 0; k < n; k++) {
        const a = k / n, b = (k + 1) / n;
        const c = along ? [seat[0] + (seat[2] - seat[0]) * a + 0.02, seat[1], seat[0] + (seat[2] - seat[0]) * b - 0.02, seat[3]] : [seat[0], seat[1] + (seat[3] - seat[1]) * a + 0.02, seat[2], seat[1] + (seat[3] - seat[1]) * b - 0.02];
        box(ctx, cam, c[0], c[1], c[2], c[3], 0.4, 0.5, fab, L * 1.05);
      }
      // torn patch
      if (s % 2 === 0) { const cx = (seat[0] + seat[2]) / 2, cy = (seat[1] + seat[3]) / 2; ellipseTop(ctx, cam, cx, cy, 0.505, 0.12, 0.08, '#c8b898', L); }
      // arms
      const arms = along ? [[x0 + i, seat[1], x0 + 0.2, seat[3]], [x1 - 0.2, seat[1], x1 - i, seat[3]]] : [[seat[0], y0 + i, seat[2], y0 + 0.2], [seat[0], y1 - 0.2, seat[2], y1 - i]];
      for (const a of arms) box(ctx, cam, a[0], a[1], a[2], a[3], 0.4, 0.62, fab, L * 0.9);
      if (!backFirst) drawBack();
      break;
    }
    case 'tvstand': {
      box(ctx, cam, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, 0, 0.48, wood, L);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      box(ctx, cam, cx - 0.28, cy - 0.25, cx + 0.28, cy + 0.25, 0.48, 0.95, '#26262a', L);
      const flick = 0.5 + 0.15 * Math.sin(time * 9 + s);
      ctx.globalAlpha = 0.85; southRect(ctx, cam, cy + 0.25, cx - 0.22, cx + 0.2, 0.55, 0.88, '#4a5a6a', L * flick + 0.2); eastRect(ctx, cam, cx + 0.28, cy - 0.2, cy + 0.2, 0.55, 0.88, '#4a5a6a', L * flick + 0.2); ctx.globalAlpha = 1;
      break;
    }
    case 'desk': {
      const i = 0.08;
      box(ctx, cam, x0 + i, y0 + i, x0 + i + 0.35, y1 - i, 0, 0.7, wood, L); // drawer unit
      box(ctx, cam, x1 - i - 0.06, y0 + i, x1 - i, y0 + i + 0.06, 0, 0.7, wood, L, false);
      box(ctx, cam, x1 - i - 0.06, y1 - i - 0.06, x1 - i, y1 - i, 0, 0.7, wood, L, false);
      box(ctx, cam, x0 + i, y0 + i, x1 - i, y1 - i, 0.7, 0.76, wood, L);
      // papers & lamp
      topQuad(ctx, cam, x0 + 0.5, y0 + 0.3, x0 + 0.85, y0 + 0.62, 0.762, '#d8d0bc', L);
      topQuad(ctx, cam, x0 + 0.55, y0 + 0.35, x0 + 0.9, y0 + 0.7, 0.764, '#c8c0aa', L);
      box(ctx, cam, x1 - 0.35, y0 + 0.2, x1 - 0.28, y0 + 0.27, 0.76, 1.1, '#3a3630', L);
      box(ctx, cam, x1 - 0.42, y0 + 0.14, x1 - 0.2, y0 + 0.34, 1.1, 1.2, '#8a7a4a', L);
      break;
    }
    case 'bookshelf': {
      box(ctx, cam, x0 + 0.05, y0 + 0.1, x1 - 0.05, y1 - 0.1, 0, 1.95, wood, L);
      const cols = ['#6a2a22', '#2a4a5a', '#5a5a2a', '#3a2a4a', '#7a6a4a', '#2a3a2a'];
      for (let sh = 0; sh < 5; sh++) {
        const z = 0.12 + sh * 0.37;
        const along = p.w >= p.d;
        const L0 = along ? x0 + 0.1 : y0 + 0.15, L1 = along ? x1 - 0.1 : y1 - 0.15;
        let u = L0, k = sh * 7 + s;
        while (u < L1 - 0.05) {
          const bw = 0.04 + ((k * 13) % 5) * 0.012, bh = 0.22 + ((k * 7) % 4) * 0.03;
          if ((k * 11) % 9 !== 0) {
            if (along) southRect(ctx, cam, y1 - 0.1, u, Math.min(L1, u + bw), z, z + bh, cols[k % cols.length], L);
            else eastRect(ctx, cam, x1 - 0.05, u, Math.min(L1, u + bw), z, z + bh, cols[k % cols.length], L);
          }
          u += bw + 0.008; k++;
        }
        if (along) southRect(ctx, cam, y1 - 0.1, x0 + 0.05, x1 - 0.05, z - 0.03, z, '#2a1e14', L);
        else eastRect(ctx, cam, x1 - 0.05, y0 + 0.1, y1 - 0.1, z - 0.03, z, '#2a1e14', L);
      }
      break;
    }
    case 'bathtub': {
      box(ctx, cam, x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.04, 0, 0.56, '#c2bfb4', L);
      topQuad(ctx, cam, x0 + 0.14, y0 + 0.14, x1 - 0.14, y1 - 0.14, 0.561, '#6a6e68', L);
      topQuad(ctx, cam, x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, 0.562, '#7f8a86', L);
      // rust stain
      ctx.globalAlpha = 0.4; topQuad(ctx, cam, x0 + 0.3, y0 + 0.3, x0 + 0.5, y0 + 0.5, 0.563, '#6a4a2a', L); ctx.globalAlpha = 1;
      // shower curtain along the long open side
      const along = p.w >= p.d;
      ctx.globalAlpha = 0.72;
      if (along) { southRect(ctx, cam, y1 - 0.08, x0 + 0.05, x1 - 0.05, 0.5, 1.9, '#8fa3a0', L); }
      else { eastRect(ctx, cam, x1 - 0.08, y0 + 0.05, y1 - 0.05, 0.5, 1.9, '#8fa3a0', L); }
      ctx.globalAlpha = 0.35;
      for (let k = 1; k < 8; k++) { const u = k / 8; if (along) lineW(ctx, cam, [x0 + u * p.w, y1 - 0.08, 0.5], [x0 + u * p.w, y1 - 0.08, 1.9], '#2a3a38', 1); else lineW(ctx, cam, [x1 - 0.08, y0 + u * p.d, 0.5], [x1 - 0.08, y0 + u * p.d, 1.9], '#2a3a38', 1); }
      ctx.globalAlpha = 1;
      if (along) lineW(ctx, cam, [x0, y1 - 0.08, 1.92], [x1, y1 - 0.08, 1.92], '#9a9a9a', 2); else lineW(ctx, cam, [x1 - 0.08, y0, 1.92], [x1 - 0.08, y1, 1.92], '#9a9a9a', 2);
      break;
    }
    case 'toilet': {
      const side = wallSide(map, p);
      const cx = x0 + 0.5, cy = y0 + 0.5;
      const tk = { n: [cx - 0.22, y0 + 0.05, cx + 0.22, y0 + 0.25], s: [cx - 0.22, y1 - 0.25, cx + 0.22, y1 - 0.05], w: [x0 + 0.05, cy - 0.22, x0 + 0.25, cy + 0.22], e: [x1 - 0.25, cy - 0.22, x1 - 0.05, cy + 0.22] }[side];
      if (side === 'n' || side === 'w') box(ctx, cam, tk[0], tk[1], tk[2], tk[3], 0.3, 0.8, '#cfcbbf', L);
      box(ctx, cam, cx - 0.16, cy - 0.16, cx + 0.16, cy + 0.16, 0, 0.38, '#cfcbbf', L);
      ellipseTop(ctx, cam, cx, cy, 0.39, 0.12, 0.12, '#5a6460', L);
      if (side === 's' || side === 'e') box(ctx, cam, tk[0], tk[1], tk[2], tk[3], 0.3, 0.8, '#cfcbbf', L);
      break;
    }
    case 'sink': {
      const cx = x0 + 0.5, cy = y0 + 0.5;
      box(ctx, cam, cx - 0.08, cy - 0.08, cx + 0.08, cy + 0.08, 0, 0.72, '#c8c4b8', L);
      box(ctx, cam, cx - 0.28, cy - 0.22, cx + 0.28, cy + 0.22, 0.72, 0.86, '#d0ccc0', L);
      ellipseTop(ctx, cam, cx, cy, 0.861, 0.18, 0.13, '#6a7470', L);
      box(ctx, cam, cx - 0.03, cy - 0.2, cx + 0.03, cy - 0.14, 0.86, 1.0, '#9a9a9a', L);
      break;
    }
    case 'washer': {
      box(ctx, cam, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0, 0.88, '#b8b6ae', L);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // round door on south face
      const pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push(P(cam, cx + Math.cos(a) * 0.22, y1 - 0.08, 0.42 + Math.sin(a) * 0.22)); }
      poly(ctx, pts, shade('#3a4448', F_S * L), 'rgba(0,0,0,0.5)');
      box(ctx, cam, x0 + 0.1, y0 + 0.1, x1 - 0.1, y0 + 0.25, 0.88, 0.95, '#8a8a84', L);
      break;
    }
    case 'crate': {
      const c = s % 2 ? '#6a5a3a' : '#5a4a32';
      box(ctx, cam, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, 0, 0.75, c, L);
      ctx.globalAlpha = 0.5;
      for (const z of [0.25, 0.5]) { lineW(ctx, cam, [x0 + 0.1, y1 - 0.1, z], [x1 - 0.1, y1 - 0.1, z], '#2a2014', 1); lineW(ctx, cam, [x1 - 0.1, y0 + 0.1, z], [x1 - 0.1, y1 - 0.1, z], '#2a2014', 1); }
      ctx.globalAlpha = 1;
      if (s % 3 === 0) box(ctx, cam, x0 + 0.2, y0 + 0.2, x0 + 0.65, y0 + 0.6, 0.75, 1.1, '#7a6a48', L);
      break;
    }
    case 'plant': {
      const cx = x0 + 0.5, cy = y0 + 0.5;
      box(ctx, cam, cx - 0.17, cy - 0.17, cx + 0.17, cy + 0.17, 0, 0.36, '#7a4a30', L);
      const leaves = [[0, 0, 0.75, 0.24], [-0.15, 0.1, 0.62, 0.18], [0.14, -0.08, 0.68, 0.18], [0.05, 0.12, 0.95, 0.16], [-0.06, -0.1, 1.05, 0.15]];
      for (const [dx, dy, z, r] of leaves) {
        const [sx, sy] = P(cam, cx + dx, cy + dy, z);
        ctx.fillStyle = shade((dx + dy) > 0 ? '#3e5a32' : '#56704a', L * (0.85 + z * 0.15));
        ctx.beginPath(); ctx.ellipse(sx, sy, r * 30 * cam.zoom, r * 22 * cam.zoom, 0, 0, Math.PI * 2); ctx.fill();
      }
      const [sx, sy] = P(cam, cx + 0.1, cy, 0.85); ctx.fillStyle = shade('#7a6a3a', L); ctx.beginPath(); ctx.ellipse(sx, sy, 5 * cam.zoom, 3 * cam.zoom, 0.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cabinet': {
      box(ctx, cam, x0 + 0.1, y0 + 0.12, x1 - 0.1, y1 - 0.12, 0, 1.0, wood, L);
      // broken door hanging
      poly(ctx, [P(cam, x0 + 0.15, y1 - 0.12, 0.1), P(cam, x0 + 0.45, y1 + 0.1, 0.05), P(cam, x0 + 0.45, y1 + 0.1, 0.85), P(cam, x0 + 0.15, y1 - 0.12, 0.92)], shade(wood, F_S * L * 1.1), 'rgba(0,0,0,0.4)');
      box(ctx, cam, x0 + 0.25, y0 + 0.3, x0 + 0.5, y0 + 0.55, 1.0, 1.25, '#5a6a6a', L);
      break;
    }
    case 'stairs': {
      // flight rising toward the west wall
      const n = 8;
      for (let k = 0; k < n; k++) {
        const sx0 = x1 - (k + 1) * (p.w / n), sx1 = x1 - k * (p.w / n);
        box(ctx, cam, sx0, y0 + 0.05, sx1, y1 - 1.05, 0, 0.18 * (k + 1), k % 2 ? '#5a554c' : '#625c52', L);
      }
      // down flight (dark)
      topQuad(ctx, cam, x0 + 0.05, y1 - 1.0, x1, y1 - 0.05, 0.005, '#101012', 1);
      for (let k = 0; k < 4; k++) topQuad(ctx, cam, x0 + 0.05 + k * 0.45, y1 - 0.95, x0 + 0.45 + k * 0.45, y1 - 0.1, 0.006, k % 2 ? '#2a2826' : '#22201e', L * (1 - k * 0.2));
      lineW(ctx, cam, [x1, y1 - 1.05, 0.9], [x0 + 0.1, y1 - 1.05, 1.9], '#8a8070', 2);
      lineW(ctx, cam, [x1, y1 - 1.05, 0], [x1, y1 - 1.05, 0.9], '#8a8070', 2);
      break;
    }
  }
}
function drawChair(ctx, cam, cx, cy, d, wood, L) {
  box(ctx, cam, cx, cy, cx + 0.38, cy + 0.38, 0.42, 0.47, wood, L);
  for (const [lx, ly] of [[cx + 0.02, cy + 0.02], [cx + 0.32, cy + 0.02], [cx + 0.02, cy + 0.32], [cx + 0.32, cy + 0.32]]) box(ctx, cam, lx, ly, lx + 0.04, ly + 0.04, 0, 0.42, wood, L, false);
  const back = { n: [cx, cy, cx + 0.38, cy + 0.05], s: [cx, cy + 0.33, cx + 0.38, cy + 0.38], w: [cx, cy, cx + 0.05, cy + 0.38], e: [cx + 0.33, cy, cx + 0.38, cy + 0.38] }[d];
  box(ctx, cam, back[0], back[1], back[2], back[3], 0.47, 0.95, wood, L);
}
