// Isometric projection, camera, color helpers.
export const TW = 64, TH = 32, ZH = 36; // tile width/height in px at zoom 1, px per metre vertical

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; this.w = 1; this.h = 1; this.ox = 0; this.oy = 0; this.shake = 0; this.sx = 0; this.sy = 0; this.offY = 0; }
  update(tx, ty, dt, snap) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.x += (tx - this.x) * k; this.y += (ty - this.y) * k;
    this.shake = Math.max(0, this.shake - dt * 3);
    const s = this.shake * 6;
    this.sx = s ? (Math.random() - 0.5) * s : 0; this.sy = s ? (Math.random() - 0.5) * s : 0;
    const z = this.zoom;
    this.ox = this.w / 2 - ((this.x - this.y) * TW / 2) * z + this.sx;
    this.oy = this.h / 2 + this.offY - ((this.x + this.y) * TH / 2 - 0.9 * ZH) * z + this.sy;
  }
  sx_(x, y) { return ((x - y) * TW / 2) * this.zoom + this.ox; }
  sy_(x, y, z = 0) { return ((x + y) * TH / 2 - z * ZH) * this.zoom + this.oy; }
  // screen -> world on ground plane
  toWorld(px, py) {
    const z = this.zoom;
    const a = (px - this.ox) / (z * TW / 2), b = (py - this.oy) / (z * TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
}
// Convert a screen-space direction (dx,dy) to a world-space direction for iso movement
export function screenDirToWorld(dx, dy) {
  // inverse of [TW/2, -TW/2; TH/2, TH/2]
  const a = dx / (TW / 2), b = dy / (TH / 2);
  const wx = (a + b) / 2, wy = (b - a) / 2;
  const l = Math.hypot(wx, wy);
  return l > 1e-6 ? { x: wx / l, y: wy / l } : { x: 0, y: 0 };
}
export function worldDirToScreen(wx, wy) {
  const sx = (wx - wy) * TW / 2, sy = (wx + wy) * TH / 2;
  const l = Math.hypot(sx, sy);
  return l > 1e-6 ? { x: sx / l, y: sy / l } : { x: 0, y: 0 };
}

const cache = new Map();
export function hexToRgb(h) {
  let c = cache.get(h);
  if (c) return c;
  const n = parseInt(h.slice(1), 16);
  c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  cache.set(h, c);
  return c;
}
const scache = new Map();
// multiply color by f (0..1.4) with optional warm/cool tint toward dark blue in shadow
export function shade(h, f) {
  const k = h + '|' + (Math.round(f * 50) / 50);
  let s = scache.get(k);
  if (s) return s;
  const [r, g, b] = hexToRgb(h);
  const ff = Math.round(f * 50) / 50;
  // dark parts drift slightly blue
  const cool = Math.max(0, 0.6 - ff) * 18;
  s = `rgb(${Math.max(0, Math.min(255, r * ff - cool * 0.3)) | 0},${Math.max(0, Math.min(255, g * ff - cool * 0.1)) | 0},${Math.max(0, Math.min(255, b * ff + cool * 0.4)) | 0})`;
  if (scache.size > 6000) scache.clear();
  scache.set(k, s);
  return s;
}
export function mix(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const r = Math.round(a[0] + (b[0] - a[0]) * t), g = Math.round(a[1] + (b[1] - a[1]) * t), bb = Math.round(a[2] + (b[2] - a[2]) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bb).toString(16).slice(1);
}
