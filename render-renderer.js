// Frame renderer: iso floor, darkness/lighting, depth-sorted walls/props/characters, beams, FX, world UI.
import { TW, TH, ZH, Camera, shade } from './render-iso.js';
import { buildFloorCanvas, FP, wallTexture, WALL_TW, WALL_TH, makeCanvas } from './render-textures.js';
import { drawProp, box, P } from './render-props.js';
import { drawHuman, drawShadow, SOLDIER_LOOK, guardLook, hostageLook } from './render-characters.js';
import { T, markersOf } from './world-building.js';
import { castRay, DOOR_OPEN, DOOR_AJAR, DOOR_CLOSED } from './world-grid.js';
import { ENEMY_TYPES, WEAPONS, REPORT_TIME } from './game-data.js';
import { lightAt } from './ai-perception.js';
import { angDiff, clamp } from './core-util.js';

const WALL_H = 2.2, CUT_H = 0.34;
const LM = 8; // lightmap px per tile

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.dpr = 1;
    this.mapKey = null;
    this.quality = 1;
    this.time = 0;
    this.looks = new Map();
  }
  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.cam.w = w; this.cam.h = h;
  }
  setMap(game) {
    const map = game.map;
    this.map = map;
    this.mapKey = map.key;
    this.floorCanvas = buildFloorCanvas(map);
    this.cut = new Float32Array(map.w * map.h);
    this.buildStatics(game);
    this.lightsVersion = -1;
    this.dark = makeCanvas(map.w * LM, map.h * LM);
    this.darkSmall = makeCanvas(map.w, map.h);
    this.decalCanvas = null;
  }
  buildStatics(game) {
    const m = this.map;
    const st = [];
    const isMass = (x, y) => {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
      const t = m.tile[y * m.w + x];
      if (t !== T.WALL && t !== T.WINDOW) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const tt = m.tile[ny * m.w + nx];
        if (tt !== T.WALL && tt !== T.WINDOW) return false;
      }
      return true;
    };
    this.isMass = isMass;
    const roomTint = (x, y) => {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
      const r = m.room[y * m.w + x];
      if (r < 0) return null;
      const room = m.rooms[r];
      if (room.type === 'corridor') return 'corr';
      const info = m.aptInfo[room.apt];
      return info ? info.plaster : '#7a7a6a';
    };
    const extract = new Set(m.markers.filter(k => k.type === 6).map(k => k.x + ',' + k.y));
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = m.tile[y * m.w + x];
      if (t === T.WALL || t === T.WINDOW) {
        if (isMass(x, y)) continue;
        const faces = [];
        for (const [dx, dy, side] of [[1, 0, 'e'], [0, 1, 's']]) {
          const nx = x + dx, ny = y + dy;
          const nt = nx < m.w && ny < m.h ? m.tile[ny * m.w + nx] : T.WALL;
          if ((nt === T.WALL || nt === T.WINDOW) && !isMass(nx, ny)) continue;
          let kind;
          if (nt === T.FLOOR) { const tint = roomTint(nx, ny); kind = tint === 'corr' ? ['corr', '#8b8670'] : ['int', tint || '#7a7a6a']; }
          else if (nt === T.DOOR || nt === T.ARCH) kind = ['jamb', '#5a5448'];
          else if (nt === T.RAIL) kind = ['ext', ''];
          else kind = ['ext', ''];
          // fire escape marker: wall next to extraction cell on its back side
          const fe = extract.has(`${x - dx},${y - dy}`) || extract.has(`${x},${y - 1}`) && side === 's' || extract.has(`${x - 1},${y}`) && side === 'e';
          faces.push({ side, kind: kind[0], tint: kind[1], variant: (x * 7 + y * 13) % 4, window: t === T.WINDOW, fireEscape: fe && kind[0] === 'ext' });
        }
        st.push({ kind: 'wall', x, y, x0: x, y0: y, x1: x + 1, y1: y + 1, faces, key: x + y + 1 });
      } else if (t === T.DOOR || t === T.ARCH) {
        const d = t === T.DOOR ? m.doors[m.doorAt[y * m.w + x]] : null;
        const wallL = (x > 0 && (m.tile[y * m.w + x - 1] === T.WALL || m.tile[y * m.w + x - 1] === T.WINDOW));
        const axis = d ? d.axis : (wallL ? 'x' : 'y');
        const front = d && d.rooms.some(r => r >= 0 && m.rooms[r].type === 'corridor');
        st.push({ kind: t === T.DOOR ? 'door' : 'arch', x, y, x0: x, y0: y, x1: x + 1, y1: y + 1, axis, door: d ? d.id : -1, front, key: x + y + 1, label: front ? (m.aptInfo[d.apt]?.label || '') : '' });
      } else if (t === T.RAIL) {
        st.push({ kind: 'rail', x, y, x0: x, y0: y, x1: x + 1, y1: y + 1, key: x + y + 1 });
      }
    }
    for (const p of m.props) st.push({ kind: 'prop', p, x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.d, key: p.x + p.y + (p.w + p.d) / 2 });
    for (const s of m.switches) if (s.wall) st.push({ kind: 'switch', s, x0: s.x, y0: s.y, x1: s.x + 0.1, y1: s.y + 0.1, key: s.x + s.y + 0.05 });
    st.sort((a, b) => a.key - b.key);
    this.statics = st;
  }

  buildDarkBase(game) {
    const m = this.map, fs = game.fs;
    const c = this.darkSmall.getContext('2d');
    const id = c.createImageData(m.w, m.h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      let a;
      const t = m.tile[i];
      if (t === T.FLOOR) a = 1 - lightAt(game, x + 0.5, y + 0.5);
      else if (t === T.DOOR || t === T.ARCH) a = 0.4;
      else a = 0.55;
      a = 0.06 + a * 0.6;
      id.data[i * 4] = 6; id.data[i * 4 + 1] = 7; id.data[i * 4 + 2] = 14; id.data[i * 4 + 3] = Math.round(a * 255);
    }
    c.putImageData(id, 0, 0);
    this.lightsVersion = game.lightsVersion;
  }

  groundTransform() {
    const z = this.cam.zoom, d = this.dpr;
    this.ctx.setTransform(TW / 2 * z * d, TH / 2 * z * d, -TW / 2 * z * d, TH / 2 * z * d, this.cam.ox * d, this.cam.oy * d);
  }
  screenTransform() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  beamPoly(game, g) {
    const def = ENEMY_TYPES[g.type];
    const ox = g.x + Math.cos(g.facing) * 0.3, oy = g.y + Math.sin(g.facing) * 0.3;
    const half = def.beamHalf + 0.12;
    const n = this.quality > 0.6 ? 18 : 10;
    const pts = [[ox, oy]];
    for (let i = 0; i <= n; i++) {
      const a = g.facing - half + (2 * half * i) / n;
      const h = castRay(game.world, ox, oy, a, def.beam);
      pts.push([ox + Math.cos(a) * h.d, oy + Math.sin(a) * h.d]);
    }
    return { pts, ox, oy, r: def.beam };
  }
  fanPoly(game, x, y, ang, half, range, n = 16) {
    const pts = [[x, y]];
    for (let i = 0; i <= n; i++) { const a = ang - half + (2 * half * i) / n; const h = castRay(game.world, x, y, a, range); pts.push([x + Math.cos(a) * h.d, y + Math.sin(a) * h.d]); }
    return pts;
  }

  render(game, dt, opts) {
    this.time += dt;
    const ctx = this.ctx, cam = this.cam, m = game.map;
    if (this.mapKey !== m.key) this.setMap(game);
    if (this.lightsVersion !== game.lightsVersion) this.buildDarkBase(game);
    const p = game.player;
    cam.zoom = opts.zoom;
    cam.offY = opts.camOffY || 0;
    if (opts.shake) cam.shake = Math.max(cam.shake, opts.shake);
    cam.update(p.x, p.y, dt, opts.snap);
    // cutaway targets
    this.updateCut(game, dt);
    // background
    this.screenTransform();
    ctx.fillStyle = '#07070a'; ctx.fillRect(0, 0, cam.w, cam.h);
    // floor
    this.groundTransform();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.floorCanvas, 0, 0, m.w, m.h);
    // decals (blood, glass)
    for (const d of game.fx.decals) {
      if (d.kind === 'blood') {
        const r = 0.35 + d.s * 0.25 + Math.min(1, d.t * 0.5) * 0.2;
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r);
        g.addColorStop(0, 'rgba(70,8,6,0.85)'); g.addColorStop(0.7, 'rgba(60,6,4,0.6)'); g.addColorStop(1, 'rgba(50,5,3,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.fill();
      } else if (d.kind === 'glass') {
        ctx.fillStyle = 'rgba(190,220,220,0.7)';
        for (let i = 0; i < 7; i++) ctx.fillRect(d.x + Math.sin(i * 9.1) * 0.3, d.y + Math.cos(i * 7.3) * 0.3, 0.05, 0.04);
      }
    }
    // extraction & objective ground markers
    this.drawGroundMarkers(game);
    // darkness
    const beams = [];
    for (const g of game.fs.guards) if (!g.down && g.stunT <= 0 && !g.held) beams.push({ g, ...this.beamPoly(game, g) });
    const dc = this.dark.getContext('2d');
    dc.setTransform(1, 0, 0, 1, 0, 0);
    dc.globalCompositeOperation = 'copy';
    dc.imageSmoothingEnabled = true;
    dc.drawImage(this.darkSmall, 0, 0, m.w * LM, m.h * LM);
    dc.globalCompositeOperation = 'destination-out';
    dc.setTransform(LM, 0, 0, LM, 0, 0);
    for (const b of beams) {
      const gr = dc.createRadialGradient(b.ox, b.oy, 0, b.ox, b.oy, b.r);
      gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = gr; dc.beginPath(); dc.moveTo(b.pts[0][0], b.pts[0][1]); for (const q of b.pts) dc.lineTo(q[0], q[1]); dc.closePath(); dc.fill();
    }
    // the soldier's own small ambient presence (NVG-ish readability)
    const pg = dc.createRadialGradient(p.x, p.y, 0, p.x, p.y, 2.2);
    pg.addColorStop(0, 'rgba(0,0,0,0.35)'); pg.addColorStop(1, 'rgba(0,0,0,0)');
    dc.fillStyle = pg; dc.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    dc.globalCompositeOperation = 'source-over';
    this.groundTransform();
    ctx.drawImage(this.dark, 0, 0, m.w, m.h);
    // vision cones & camera cones (on ground)
    if (opts.cones) {
      for (const g of game.fs.guards) {
        if (g.down || g.held) continue;
        const def = ENEMY_TYPES[g.type];
        const range = def.vision * 0.75;
        const pts = this.fanPoly(game, g.x, g.y, g.facing, def.fov, range, 14);
        const col = g.state === 'combat' || g.state === 'reporting' ? '220,60,50' : g.state === 'searching' || g.state === 'investigating' ? '230,150,50' : g.state === 'suspicious' ? '230,210,80' : '200,210,220';
        const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, range);
        gr.addColorStop(0, `rgba(${col},0.16)`); gr.addColorStop(1, `rgba(${col},0.02)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
      }
    }
    for (const c of game.fs.cameras) {
      if (c.destroyed || c.disabledT > 0) continue;
      const pts = this.fanPoly(game, c.x, c.y, c.angle, 0.42, 7.5, 10);
      ctx.fillStyle = c.reportT >= 0 ? 'rgba(230,50,40,0.22)' : c.susp > 0.05 ? 'rgba(230,180,60,0.18)' : 'rgba(120,200,230,0.1)';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
    }
    // noise rings
    if (opts.noiseRings) {
      ctx.lineWidth = 0.04;
      for (const n of game.fx.noises) {
        if (n.r < 0.9) continue;
        const k = n.t / 0.7;
        const col = n.kind === 'gunshot' || n.kind === 'bang' ? '255,90,70' : n.kind === 'glass' || n.kind === 'squeak' ? '255,210,90' : '220,220,220';
        ctx.strokeStyle = `rgba(${col},${(1 - k) * 0.45})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.stroke();
      }
    }
    // shadows for characters
    this.screenTransform();
    // depth-sorted statics and entities
    this.drawWorld(game, opts);
    // beam glow (additive)
    this.groundTransform();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      const gr = ctx.createRadialGradient(b.ox, b.oy, 0, b.ox, b.oy, b.r);
      const a = b.g.state === 'combat' || b.g.reportT >= 0 ? 0.2 : 0.13;
      gr.addColorStop(0, `rgba(255,236,180,${a})`); gr.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(b.pts[0][0], b.pts[0][1]); for (const q of b.pts) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // smoke
    this.screenTransform();
    for (const s of game.smokes) {
      const life = Math.min(1, s.t / 2, (s.max - s.t) / 0.6 + 0.2);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4 + this.time * 0.15 * (i % 3 + 1), rr = s.r * (0.25 + ((i * 37) % 10) / 14);
        const x = s.x + Math.cos(a) * rr * 0.6, y = s.y + Math.sin(a) * rr * 0.6;
        const sx = cam.sx_(x, y), sy = cam.sy_(x, y, 0.4 + (i % 4) * 0.35);
        const r = (0.9 + (i % 3) * 0.3) * 36 * cam.zoom;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(170,170,165,${0.42 * life})`); g.addColorStop(1, 'rgba(150,150,145,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
    }
    // tracers & sparks & throws
    for (const t of game.fx.tracers) {
      const k = 1 - t.t / 0.12;
      ctx.strokeStyle = t.tranq ? `rgba(120,220,255,${k})` : t.bolt ? `rgba(220,220,200,${k})` : t.enemy ? `rgba(255,140,80,${k * 0.9})` : `rgba(255,235,170,${k})`;
      ctx.lineWidth = (t.bolt ? 2 : 1.3) * cam.zoom;
      ctx.beginPath(); ctx.moveTo(cam.sx_(t.x0, t.y0), cam.sy_(t.x0, t.y0, 1.2)); ctx.lineTo(cam.sx_(t.x1, t.y1), cam.sy_(t.x1, t.y1, 1.1)); ctx.stroke();
    }
    for (const s of game.fx.sparks) {
      const k = 1 - s.t / 0.3; const sx = cam.sx_(s.x, s.y), sy = cam.sy_(s.x, s.y, 1.1);
      ctx.fillStyle = `rgba(255,220,140,${k})`;
      for (let i = 0; i < 4; i++) ctx.fillRect(sx + Math.cos(i * 1.7 + s.x) * s.t * 40, sy + Math.sin(i * 2.3) * s.t * 30 - s.t * 20, 2, 2);
    }
    for (const th of game.fx.throws) {
      const k = Math.min(1, th.t / th.dur);
      const x = th.x0 + (th.x - th.x0) * k, y = th.y0 + (th.y - th.y0) * k, z = 1.3 + Math.sin(k * Math.PI) * 1.2 - k * 1.2;
      ctx.fillStyle = th.kind === 'flash' ? '#c8c8b0' : th.kind === 'smoke' ? '#6a7a5a' : '#4a6a5a';
      ctx.beginPath(); ctx.arc(cam.sx_(x, y), cam.sy_(x, y, Math.max(0.05, z)), 3 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      if (k >= 1 && th.kind === 'flash') { ctx.fillStyle = 'rgba(255,255,220,0.8)'; ctx.beginPath(); ctx.arc(cam.sx_(x, y), cam.sy_(x, y, 0.1), 2 * cam.zoom, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const f of game.fx.flashes) {
      const k = 1 - f.t / 0.6; const sx = cam.sx_(f.x, f.y), sy = cam.sy_(f.x, f.y, 0.5);
      const r = 5 * 36 * cam.zoom * (0.5 + f.t);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(255,255,240,${k})`); g.addColorStop(1, 'rgba(255,255,240,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    // warm colour grade (old pre-rendered look)
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#f6e4cc'; ctx.fillRect(0, 0, cam.w, cam.h); ctx.globalCompositeOperation = 'source-over';
    // world-space UI: icons, timers
    this.drawWorldUI(game, opts);
    // vignette
    const v = ctx.createRadialGradient(cam.w / 2, cam.h / 2, Math.min(cam.w, cam.h) * 0.35, cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, cam.w, cam.h);
    if (p.hurtT > 0 || p.hp < game.stats.maxHp * 0.3) {
      const a = p.hurtT > 0 ? p.hurtT * 1.6 : (0.15 + 0.1 * Math.sin(this.time * 4));
      const g = ctx.createRadialGradient(cam.w / 2, cam.h / 2, Math.min(cam.w, cam.h) * 0.3, cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.7);
      g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, `rgba(140,10,5,${Math.min(0.6, a)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cam.w, cam.h);
    }
    if (opts.blindT > 0) { ctx.fillStyle = `rgba(255,255,245,${Math.min(0.9, opts.blindT)})`; ctx.fillRect(0, 0, cam.w, cam.h); }
  }

  updateCut(game, dt) {
    const m = this.map, p = game.player;
    const k = Math.min(1, dt * 7);
    const ps = p.x + p.y, pd = p.x - p.y;
    // extra focus points (hostages being escorted, takedown target)
    const foci = [[p.x, p.y]];
    for (const h of game.fs.hostages) if (h.state === 'free' && Math.abs(h.x - p.x) + Math.abs(h.y - p.y) < 8) foci.push([h.x, h.y]);
    const vw = this.cam.w / (TW / 2 * this.cam.zoom), vh = this.cam.h / (TH / 2 * this.cam.zoom);
    for (const s of this.statics) {
      if (s.kind !== 'wall' && s.kind !== 'door' && s.kind !== 'arch') continue;
      const i = s.y * m.w + s.x;
      const ws = s.x + s.y + 1, wd = s.x - s.y;
      let target = 0;
      for (const [fx, fy] of foci) {
        const fs = fx + fy, fd = fx - fy;
        // a wall can only hide a character standing behind it on both axes
        if (s.x + 1 <= fx - 0.05 || s.y + 1 <= fy - 0.05) continue;
        const dS = ws - fs, dD = Math.abs(wd - fd);
        if (dS > -0.3 && dS < 1 + 2.25 * WALL_H + 0.6 && dD < 2.6) { target = 1; break; }
      }
      this.cut[i] += (target - this.cut[i]) * k;
    }
  }

  drawGroundMarkers(game) {
    const ctx = this.ctx, m = game.map;
    const t = this.time;
    for (let slot = 0; slot < m.aptInfo.length; slot++) {
      const rec = game.aptRec(slot);
      if (!rec || rec.status === 'complete') continue;
      const ex = game.extractionFor(slot);
      if (!ex) continue;
      const active = game.fs.hostages.some(h => h.apt === slot && h.state === 'free');
      const a = active ? 0.55 + 0.25 * Math.sin(t * 4) : 0.22;
      ctx.strokeStyle = `rgba(120,230,140,${a})`; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(ex.x, ex.y, 0.42, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex.x, ex.y, 0.62 + 0.08 * Math.sin(t * 3), 0, Math.PI * 2); ctx.stroke();
    }
    // context target highlight
    const c = game.context;
    const tgt = game.takedownTarget;
    if (tgt) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.06; ctx.setLineDash([0.15, 0.1]); ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 0.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    // player selection ring
    const p = game.player;
    if (p.hidden == null) { ctx.strokeStyle = 'rgba(110,210,120,0.65)'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.4, 0.4, 0, 0, Math.PI * 2); ctx.stroke(); }
    // items
    for (const it of game.fs.items) {
      if (it.kind === 'intel' && !it.taken) { ctx.fillStyle = `rgba(120,200,255,${0.25 + 0.15 * Math.sin(t * 3)})`; ctx.beginPath(); ctx.arc(it.x, it.y, 0.35, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  lightFactor(game, x, y, beams) {
    let L = lightAt(game, x, y);
    L = 0.28 + L * 0.72;
    return L;
  }

  drawWorld(game, opts) {
    const ctx = this.ctx, cam = this.cam, m = this.map;
    const fs = game.fs;
    const p = game.player;
    // collect dynamic entities
    const ents = [];
    if (p.hidden == null && !(p.dead && false)) ents.push({ kind: 'player', e: p, x: p.x, y: p.y });
    for (const g of fs.guards) if (!(g.down && g.bodyHidden >= 0)) ents.push({ kind: 'guard', e: g, x: g.x, y: g.y });
    for (const h of fs.hostages) if (h.state !== 'evacuated') ents.push({ kind: 'hostage', e: h, x: h.x, y: h.y });
    for (const it of fs.items) if ((it.kind === 'crate') || (it.kind === 'intel' && !it.taken)) ents.push({ kind: 'item', e: it, x: it.x, y: it.y });
    for (const c of fs.cameras) ents.push({ kind: 'camera', e: c, x: c.x, y: c.y - 0.1 });
    // culling bounds
    const pad = 140;
    const onScreen = (x0, y0, x1, y1, h) => {
      const sxs = [cam.sx_(x0, y0), cam.sx_(x1, y0), cam.sx_(x0, y1), cam.sx_(x1, y1)];
      const minx = Math.min(...sxs), maxx = Math.max(...sxs);
      const maxy = cam.sy_(x1, y1, 0), miny = cam.sy_(x0, y0, h);
      return maxx > -pad && minx < cam.w + pad && maxy > -pad && miny < cam.h + pad;
    };
    const vis = [];
    for (const s of this.statics) if (onScreen(s.x0, s.y0, s.x1, s.y1, 2.6)) vis.push(s);
    // insertion of entities
    const buckets = new Map();
    for (const en of ents) {
      if (!onScreen(en.x - 1, en.y - 1, en.x + 1, en.y + 1, 2.2)) continue;
      const ek = en.x + en.y;
      let idx = -1;
      for (let i = 0; i < vis.length; i++) {
        const s = vis[i];
        if (s.key > ek + 4) break;
        const r = en.kind === 'item' ? 0.2 : 0.28;
        const front = en.x - r * 0.6 >= s.x1 - 0.02 || en.y - r * 0.6 >= s.y1 - 0.02;
        if (front) { idx = i; continue; }
        // behind this static only if it overlaps in screen-x and is in front in depth
        const behind = en.x <= s.x0 + 0.02 || en.y <= s.y0 + 0.02;
        if (!behind && s.key <= ek) idx = i; // inside footprint (e.g. door cell) — use key order
      }
      en.key = ek;
      if (!buckets.has(idx)) buckets.set(idx, []);
      buckets.get(idx).push(en);
    }
    for (const arr of buckets.values()) arr.sort((a, b) => a.key - b.key);
    const drawEnts = (i) => { const arr = buckets.get(i); if (arr) for (const en of arr) this.drawEntity(game, en, opts); };
    drawEnts(-1);
    for (let i = 0; i < vis.length; i++) { this.drawStatic(game, vis[i]); drawEnts(i); }
  }

  drawStatic(game, s) {
    const ctx = this.ctx, cam = this.cam, m = this.map;
    if (s.kind === 'prop') { const L = this.lightFactor(game, s.p.x + s.p.w / 2, s.p.y + s.p.d / 2); drawProp(ctx, cam, s.p, L, m, this.time); return; }
    if (s.kind === 'switch') {
      const sw = s.s; const on = game.fs.lights[sw.room];
      const [x, y] = sw.wall === 'w' ? [sw.x + 0.02, sw.y + 0.6] : [sw.x + 0.6, sw.y + 0.02];
      const sx = cam.sx_(x, y), sy = cam.sy_(x, y, 1.25);
      ctx.fillStyle = '#c8c0a8'; ctx.fillRect(sx - 2.5 * cam.zoom, sy - 4 * cam.zoom, 5 * cam.zoom, 7 * cam.zoom);
      ctx.fillStyle = on ? '#e8c860' : '#4a4438'; ctx.fillRect(sx - 1 * cam.zoom, sy - 2.5 * cam.zoom, 2 * cam.zoom, 3 * cam.zoom);
      return;
    }
    const cut = this.cut[s.y * m.w + s.x] || 0;
    const H = WALL_H - (WALL_H - CUT_H) * cut;
    const L = s.kind === 'wall' ? 1 : this.lightFactor(game, s.x + 0.5, s.y + 0.5);
    if (s.kind === 'wall') this.drawWall(game, s, H, cut);
    else if (s.kind === 'door' || s.kind === 'arch') this.drawDoor(game, s, H, cut, L);
    else if (s.kind === 'rail') {
      const x = s.x, y = s.y;
      for (let k = 0; k <= 4; k++) box(ctx, cam, x + k * 0.24, y + 0.45, x + k * 0.24 + 0.04, y + 0.5, 0, 1.0, '#2e2e30', 0.8, false);
      box(ctx, cam, x, y + 0.43, x + 1, y + 0.52, 0.95, 1.02, '#3a3a3c', 0.9);
      box(ctx, cam, x, y + 0.43, x + 1, y + 0.52, 0.1, 0.14, '#3a3a3c', 0.8, false);
    }
  }

  drawWall(game, s, H, cut) {
    const ctx = this.ctx, cam = this.cam, m = this.map;
    const x = s.x, y = s.y;
    const d = this.dpr;
    for (const f of s.faces) {
      // interior faces get the room's light; exterior faces are dim moonlight
      let L;
      if (f.kind === 'ext') L = 0.55; else { const nx = f.side === 'e' ? x + 1.5 : x + 0.5, ny = f.side === 's' ? y + 1.5 : y + 0.5; L = this.lightFactor(game, nx, ny); }
      const tex = wallTexture(f.kind === 'jamb' ? 'int' : f.kind, f.tint || '#5a5448', f.variant);
      // affine: texture u along face, v down from top (z=H) to bottom (z=0)
      let ax, ay, bx, by, cx2, cy2; // origin (top-left), u end, bottom-left
      if (f.side === 's') { [ax, ay] = P(cam, x, y + 1, H); [bx, by] = P(cam, x + 1, y + 1, H); [cx2, cy2] = P(cam, x, y + 1, 0); }
      else { [ax, ay] = P(cam, x + 1, y, H); [bx, by] = P(cam, x + 1, y + 1, H); [cx2, cy2] = P(cam, x + 1, y, 0); }
      const srcH = WALL_TH * (H / WALL_H);
      ctx.setTransform((bx - ax) / WALL_TW * d, (by - ay) / WALL_TW * d, (cx2 - ax) / srcH * d, (cy2 - ay) / srcH * d, ax * d, ay * d);
      ctx.drawImage(tex, 0, WALL_TH - srcH, WALL_TW, srcH, 0, 0, WALL_TW, srcH);
      this.screenTransform();
      // shading overlay for face orientation + room light
      const shadeA = (f.side === 'e' ? 0.32 : 0.12) + (1 - L) * 0.62 + (f.kind === 'jamb' ? 0.35 : 0);
      const quad = f.side === 's' ? [P(cam, x, y + 1, 0), P(cam, x + 1, y + 1, 0), P(cam, x + 1, y + 1, H), P(cam, x, y + 1, H)] : [P(cam, x + 1, y, 0), P(cam, x + 1, y + 1, 0), P(cam, x + 1, y + 1, H), P(cam, x + 1, y, H)];
      ctx.fillStyle = `rgba(6,7,12,${Math.min(0.9, shadeA)})`;
      ctx.beginPath(); ctx.moveTo(quad[0][0], quad[0][1]); for (const q of quad) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
      // window pane
      if (f.window && H > 1.2) {
        const lit = f.kind === 'ext';
        const win = f.side === 's' ? [P(cam, x + 0.2, y + 1, 0.95), P(cam, x + 0.8, y + 1, 0.95), P(cam, x + 0.8, y + 1, Math.min(H - 0.15, 2.0)), P(cam, x + 0.2, y + 1, Math.min(H - 0.15, 2.0))] : [P(cam, x + 1, y + 0.2, 0.95), P(cam, x + 1, y + 0.8, 0.95), P(cam, x + 1, y + 0.8, Math.min(H - 0.15, 2.0)), P(cam, x + 1, y + 0.2, Math.min(H - 0.15, 2.0))];
        ctx.fillStyle = '#1a1e22'; ctx.beginPath(); ctx.moveTo(win[0][0], win[0][1]); for (const q of win) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
        // warm light from the room behind (north of a south wall)
        const roomLit = lightAt(game, x + 0.5, y - 0.5) > 0.8;
        ctx.fillStyle = roomLit ? 'rgba(200,150,80,0.45)' : 'rgba(80,100,120,0.25)';
        ctx.fill();
        ctx.strokeStyle = '#3a3226'; ctx.lineWidth = 1.5 * cam.zoom; ctx.stroke();
        const mid = [(win[0][0] + win[1][0]) / 2, (win[0][1] + win[1][1]) / 2], midT = [(win[2][0] + win[3][0]) / 2, (win[2][1] + win[3][1]) / 2];
        ctx.beginPath(); ctx.moveTo(mid[0], mid[1]); ctx.lineTo(midT[0], midT[1]); ctx.stroke();
      }
      if (f.fireEscape && H > 1.0) {
        // ladder + green exit glow
        ctx.strokeStyle = '#5a5a5c'; ctx.lineWidth = 1.6 * cam.zoom;
        const A = f.side === 's' ? (u, z) => P(cam, x + u, y + 1.02, z) : (u, z) => P(cam, x + 1.02, y + u, z);
        for (const u of [0.3, 0.7]) { const [a1, a2] = A(u, 0); const [b1, b2] = A(u, H - 0.1); ctx.beginPath(); ctx.moveTo(a1, a2); ctx.lineTo(b1, b2); ctx.stroke(); }
        for (let z = 0.2; z < H - 0.1; z += 0.3) { const [a1, a2] = A(0.3, z); const [b1, b2] = A(0.7, z); ctx.beginPath(); ctx.moveTo(a1, a2); ctx.lineTo(b1, b2); ctx.stroke(); }
        const [gx, gy] = A(0.5, Math.min(H - 0.2, 1.9));
        ctx.fillStyle = 'rgba(90,220,120,0.9)'; ctx.fillRect(gx - 7 * cam.zoom, gy - 3 * cam.zoom, 14 * cam.zoom, 6 * cam.zoom);
      }
    }
    // top cap (thickness)
    const top = [P(cam, x, y, H), P(cam, x + 1, y, H), P(cam, x + 1, y + 1, H), P(cam, x, y + 1, H)];
    ctx.fillStyle = cut > 0.5 ? '#38332d' : '#2a2826';
    ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (const q of top) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
    if (cut > 0.5) {
      // broken edge highlight
      ctx.strokeStyle = 'rgba(120,110,95,0.45)'; ctx.lineWidth = 0.8; ctx.stroke();
    } else { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke(); }
  }

  drawDoor(game, s, H, cut, L) {
    const ctx = this.ctx, cam = this.cam;
    const x = s.x, y = s.y;
    const open = s.door >= 0 ? game.world.doors[s.door] : DOOR_OPEN;
    const lintel = Math.min(H, 2.08);
    const frameCol = '#3e3024';
    // jamb posts
    if (s.axis === 'x') {
      box(ctx, cam, x, y + 0.3, x + 0.08, y + 0.7, 0, lintel, frameCol, L);
    } else {
      box(ctx, cam, x + 0.3, y, x + 0.7, y + 0.08, 0, lintel, frameCol, L);
    }
    // leaf
    if (s.kind === 'door') {
      const ang = open === DOOR_CLOSED ? 0 : open === DOOR_AJAR ? 0.42 : 1.45;
      const hx = s.axis === 'x' ? x + 0.08 : x + 0.5, hy = s.axis === 'x' ? y + 0.5 : y + 0.08;
      const dir = s.axis === 'x' ? [Math.cos(ang), Math.sin(ang)] : [Math.sin(ang), Math.cos(ang)];
      const len = 0.84, th = 0.05;
      const nx = -dir[1] * th, ny = dir[0] * th;
      const pts = [[hx - nx, hy - ny], [hx + dir[0] * len - nx, hy + dir[1] * len - ny], [hx + dir[0] * len + nx, hy + dir[1] * len + ny], [hx + nx, hy + ny]];
      const leafH = Math.min(2.02, Math.max(0.35, H - 0.05));
      const col = s.front ? '#4a4e52' : '#5e4632';
      this.prism(pts, 0, leafH, col, L);
      // handle
      const hxp = hx + dir[0] * len * 0.85, hyp = hy + dir[1] * len * 0.85;
      ctx.fillStyle = '#c8b070'; const [qx, qy] = P(cam, hxp, hyp, Math.min(leafH, 1.0)); ctx.fillRect(qx - 1.5 * cam.zoom, qy - 1.5 * cam.zoom, 3 * cam.zoom, 3 * cam.zoom);
    }
    if (s.axis === 'x') box(ctx, cam, x + 0.92, y + 0.3, x + 1, y + 0.7, 0, lintel, frameCol, L);
    else box(ctx, cam, x + 0.3, y + 0.92, x + 0.7, y + 1, 0, lintel, frameCol, L);
    // wall above lintel
    if (H > lintel + 0.02) {
      const tint = '#5a5448';
      if (s.axis === 'x') box(ctx, cam, x, y + 0.02, x + 1, y + 0.98, lintel, H, ['#2c2a28', tint, tint], 0.8);
      else box(ctx, cam, x + 0.02, y, x + 0.98, y + 1, lintel, H, ['#2c2a28', tint, tint], 0.8);
    }
    if (s.front && s.label && H > 1.6) {
      // apartment plate on the corridor side (north face is hidden, so draw on top of lintel area as a sign)
      const [sx, sy] = P(cam, x + 0.5, y + 0.5, Math.min(H, 2.3) + 0.05);
      ctx.fillStyle = 'rgba(20,18,14,0.8)'; ctx.fillRect(sx - 11 * cam.zoom, sy - 7 * cam.zoom, 22 * cam.zoom, 12 * cam.zoom);
      ctx.fillStyle = '#d8c89a'; ctx.font = `${Math.round(9 * cam.zoom)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, sx, sy - 1 * cam.zoom);
    }
  }
  // extruded convex polygon; draws only camera-facing sides
  prism(pts, z0, z1, col, L) {
    const ctx = this.ctx, cam = this.cam;
    const n = pts.length;
    const sides = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      // outward normal for clockwise-ish order; test both and pick facing camera (+x+y)
      const nx = ey, ny = -ex;
      const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
      const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
      const out = nx * mx + ny * my > 0 ? [nx, ny] : [-nx, -ny];
      if (out[0] + out[1] > 0) sides.push({ a, b, f: out[0] > out[1] ? 0.6 : 0.78, d: (a[0] + a[1] + b[0] + b[1]) / 2 });
    }
    sides.sort((s1, s2) => s1.d - s2.d);
    ctx.lineWidth = 0.7;
    for (const s of sides) {
      const q = [P(cam, s.a[0], s.a[1], z0), P(cam, s.b[0], s.b[1], z0), P(cam, s.b[0], s.b[1], z1), P(cam, s.a[0], s.a[1], z1)];
      ctx.fillStyle = shade(col, s.f * L); ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (const v of q) ctx.lineTo(v[0], v[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const t = pts.map(([px, py]) => P(cam, px, py, z1));
    ctx.fillStyle = shade(col, L); ctx.beginPath(); ctx.moveTo(t[0][0], t[0][1]); for (const v of t) ctx.lineTo(v[0], v[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  drawEntity(game, en, opts) {
    const ctx = this.ctx, cam = this.cam;
    const e = en.e;
    const L = this.lightFactor(game, en.x, en.y);
    if (en.kind === 'player') {
      const p = e;
      const w = p.active === 'knife' ? 'knife' : p[p.active] ? weaponVisual(p[p.active].id) : 'pistol';
      drawShadow(ctx, cam, p.x, p.y);
      const L2 = Math.max(L, 0.62); // keep the soldier readable
      const lock = p.lock;
      const pose = { phase: p.walkPhase, speed: p.speedNow, crouch: p.crouch ? 1 : 0, aim: (p.aiming || p.fireFlash > 0 || p.fireCD > 0.05) && p.active !== 'knife' ? 1 : 0.2, fire: p.fireFlash > 0, hurt: p.hurtT > 0.15, takedown: lock && lock.type === 'takedown' ? 'attacker' : null, slash: lock && lock.type === 'slash', t: this.time };
      if (p.dragging != null) { pose.aim = 0; pose.crouch = 0.6; }
      if (p.dead) pose.down = true;
      if (lock && lock.type === 'free') { pose.crouch = 1; pose.aim = 0; }
      drawHuman(ctx, cam, p, { ...SOLDIER_LOOK, weapon: p.dragging != null || (lock && lock.type === 'free') ? null : w }, pose, L2);
      if (p.ghostT > 0) { ctx.globalAlpha = 0.25; ctx.strokeStyle = '#9ad'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cam.sx_(p.x, p.y), cam.sy_(p.x, p.y, 0.9), 26 * cam.zoom, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    } else if (en.kind === 'guard') {
      const g = e;
      const def = ENEMY_TYPES[g.type];
      let look = this.looks.get(g.type);
      if (!look) { look = guardLook(def, g.type); this.looks.set(g.type, look); }
      const wv = { smg: 'smg', pistol: 'pistol', shotgun: 'shotgun', rifle: 'rifle' }[def.weapon];
      if (!g.down) drawShadow(ctx, cam, g.x, g.y);
      const lockT = game.player.lock && game.player.lock.type === 'takedown' && game.player.lock.target === g.id;
      const pose = { phase: g.walkPhase || 0, speed: g.speed || 0, crouch: 0, aim: g.state === 'combat' && (g.seePlayer || g.aimT > 0) ? 1 : g.state === 'searching' || g.state === 'investigating' ? 0.6 : 0, fire: g.fireFlash > 0, hurt: g.hurtT > 0.12, down: !!g.down, shake: g.stunT > 0 || lockT, takedown: lockT ? 'victim' : null, t: this.time };
      if (g.fireFlash > 0) g.fireFlash -= 1 / 60;
      drawHuman(ctx, cam, g, { ...look, weapon: wv, flashlight: !g.down }, pose, L);
    } else if (en.kind === 'hostage') {
      const h = e;
      if (h.state !== 'dead') drawShadow(ctx, cam, h.x, h.y, 0.28, 0.3);
      const pose = { phase: h.walkPhase || 0, speed: h.speed || 0, crouch: h.crouch || h.state === 'frightened' ? 0.8 : 0.25, kneel: h.state === 'restrained', tied: h.state === 'restrained', handsUp: h.state === 'frightened', down: h.state === 'dead', hurt: h.hurtT > 0, t: this.time };
      if (h.hurtT > 0) h.hurtT -= 1 / 60;
      drawHuman(ctx, cam, h, hostageLook(h), pose, Math.max(L, 0.5));
    } else if (en.kind === 'item') {
      const it = e;
      if (it.kind === 'crate') {
        const col = it.opened ? '#4a4a3a' : '#556040';
        box(ctx, cam, it.x - 0.26, it.y - 0.2, it.x + 0.26, it.y + 0.2, 0, 0.32, col, L);
        if (!it.opened) { box(ctx, cam, it.x - 0.27, it.y - 0.21, it.x + 0.27, it.y + 0.21, 0.32, 0.38, '#46502f', L); const [sx, sy] = P(cam, it.x, it.y, 0.39); ctx.fillStyle = '#d8c060'; ctx.fillRect(sx - 4 * cam.zoom, sy - 1.5 * cam.zoom, 8 * cam.zoom, 3 * cam.zoom); }
        else if (it.contents && it.contents.type === 'weapon') { const [a, b] = P(cam, it.x - 0.25, it.y, 0.36), [c, d] = P(cam, it.x + 0.25, it.y, 0.36); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3 * cam.zoom; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
        else if (it.contents && it.contents.type === 'gadget') { const [sx, sy] = P(cam, it.x, it.y, 0.38); ctx.fillStyle = '#6a8a5a'; ctx.beginPath(); ctx.arc(sx, sy, 3 * cam.zoom, 0, Math.PI * 2); ctx.fill(); }
      } else if (it.kind === 'intel') {
        // laptop / folder on the floor or furniture
        const z = 0.02;
        box(ctx, cam, it.x - 0.18, it.y - 0.13, it.x + 0.18, it.y + 0.13, z, z + 0.03, '#2a2a2e', L);
        this.prism([[it.x - 0.18, it.y - 0.13], [it.x + 0.18, it.y - 0.13], [it.x + 0.18, it.y - 0.1], [it.x - 0.18, it.y - 0.1]], z, z + 0.26, '#3a3a40', L);
        const [sx, sy] = P(cam, it.x, it.y - 0.11, z + 0.15); ctx.fillStyle = `rgba(120,200,255,${0.5 + 0.3 * Math.sin(this.time * 3)})`; ctx.fillRect(sx - 5 * cam.zoom, sy - 3 * cam.zoom, 10 * cam.zoom, 5 * cam.zoom);
      }
    } else if (en.kind === 'camera') {
      const c = e;
      const [sx, sy] = P(cam, c.x, c.y - 0.1, 2.15);
      const z = cam.zoom;
      ctx.fillStyle = '#2a2a2e'; ctx.fillRect(sx - 2 * z, sy - 8 * z, 4 * z, 8 * z);
      const dx = Math.cos(c.angle) - Math.sin(c.angle), dy = (Math.cos(c.angle) + Math.sin(c.angle)) * 0.5;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = c.destroyed ? '#333' : '#bcbcb4'; ctx.fillRect(-4 * z, -3.5 * z, 14 * z, 7 * z);
      ctx.fillStyle = '#111'; ctx.fillRect(9 * z, -2.5 * z, 3 * z, 5 * z);
      ctx.restore();
      const led = c.destroyed ? null : c.disabledT > 0 ? '#5a5a8a' : c.reportT >= 0 ? (Math.sin(this.time * 20) > 0 ? '#ff3020' : '#600') : c.susp > 0.05 ? '#f0b030' : '#40d060';
      if (led) { ctx.fillStyle = led; ctx.beginPath(); ctx.arc(sx, sy - 6 * z, 2 * z, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // Icons, report timers, hide indicators, objective arrow.
  drawWorldUI(game, opts) {
    const ctx = this.ctx, cam = this.cam;
    const z = Math.max(0.8, cam.zoom);
    const ui = opts.uiScale || 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const g of game.fs.guards) {
      if (g.down) {
        if (g.down === 'unconscious' && g.bodyHidden < 0) { const sx = cam.sx_(g.x, g.y), sy = cam.sy_(g.x, g.y, 0.6); ctx.fillStyle = 'rgba(200,220,255,0.75)'; ctx.font = `bold ${Math.round(10 * z * ui)}px system-ui`; ctx.fillText('z', sx + Math.sin(this.time * 2) * 3, sy - (this.time * 8 % 10)); }
        continue;
      }
      const sx = cam.sx_(g.x, g.y), sy = cam.sy_(g.x, g.y, 2.2);
      if (g.reportT >= 0) { this.drawReportTimer(sx, sy - 6 * z * ui, g.reportT, z * ui, g.reportReason === 'body'); continue; }
      if (g.stunT > 0) { this.badge(sx, sy, '✶', '#d8d8ff', '#334', z * ui, 1); continue; }
      if (g.state === 'combat') this.badge(sx, sy, '!', '#fff', '#c0302a', z * ui, 1);
      else if (g.state === 'searching') this.badge(sx, sy, '?', '#fff', '#c0702a', z * ui, Math.min(1, g.searchT / 10), 'search');
      else if (g.state === 'investigating' || g.state === 'suspicious' || g.susp > 0.08) this.badge(sx, sy, '?', '#222', '#e8c040', z * ui, g.susp, 'meter');
    }
    for (const c of game.fs.cameras) {
      if (c.reportT >= 0) this.drawReportTimer(cam.sx_(c.x, c.y), cam.sy_(c.x, c.y, 2.6), c.reportT, z * ui, false, true);
    }
    // hidden indicator
    const p = game.player;
    if (p.hidden != null) {
      const s = game.map.hideSpots[p.hidden];
      const sx = cam.sx_(s.x, s.y), sy = cam.sy_(s.x, s.y, 2.0);
      this.eyeIcon(sx, sy, z * ui);
    }
    // hostages
    for (const h of game.fs.hostages) {
      if (h.state === 'evacuated' || h.state === 'dead') continue;
      const sx = cam.sx_(h.x, h.y), sy = cam.sy_(h.x, h.y, 1.75);
      if (h.state === 'free') { const letter = { follow: 'F', wait: 'W', evacuate: 'E' }[h.order]; this.badge(sx, sy, letter, '#10301a', '#7ad890', z * ui * 0.8, 1, 'square'); }
      else if (h.known) this.badge(sx, sy, '+', '#fff', '#3a8a5a', z * ui * 0.85, 1, 'square');
    }
    // takedown hint
    const t = game.takedownTarget;
    if (t) { const sx = cam.sx_(t.x, t.y), sy = cam.sy_(t.x, t.y, 2.25); ctx.font = `bold ${Math.round(10 * z * ui)}px system-ui`; ctx.fillStyle = 'rgba(0,0,0,0.6)'; const w = ctx.measureText('TAKEDOWN').width + 10; ctx.fillRect(sx - w / 2, sy - 8 * z, w, 15 * z); ctx.fillStyle = '#fff'; ctx.fillText('TAKEDOWN', sx, sy); }
    // objective arrow (when target off-screen)
    const target = opts.objective;
    if (target) {
      const sx = cam.sx_(target.x, target.y), sy = cam.sy_(target.x, target.y, 0.5);
      const m = 34 * ui, safe = opts.safe || { l: 0, r: 0, t: 0, b: 0 };
      const minX = m + safe.l, maxX = cam.w - m - safe.r, minY = m + safe.t + (opts.hudTop || 0), maxY = cam.h - m - safe.b - (opts.hudBottom || 0);
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) {
        const cx = cam.w / 2, cy = cam.h / 2;
        const ang = Math.atan2(sy - cy, sx - cx);
        let ax = cx + Math.cos(ang) * 1e4, ay = cy + Math.sin(ang) * 1e4;
        const kx = Math.cos(ang) > 0 ? (maxX - cx) / (ax - cx) : (minX - cx) / (ax - cx);
        const ky = Math.sin(ang) > 0 ? (maxY - cy) / (ay - cy) : (minY - cy) / (ay - cy);
        const kk = Math.min(Math.abs(kx), Math.abs(ky));
        ax = cx + (ax - cx) * kk; ay = cy + (ay - cy) * kk;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.fillStyle = target.color || 'rgba(120,230,140,0.9)'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14 * ui, 0); ctx.lineTo(-8 * ui, -9 * ui); ctx.lineTo(-4 * ui, 0); ctx.lineTo(-8 * ui, 9 * ui); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
      } else {
        const bob = Math.sin(this.time * 3) * 3;
        ctx.fillStyle = target.color || 'rgba(120,230,140,0.9)';
        ctx.beginPath(); ctx.moveTo(sx, sy - 18 * z + bob); ctx.lineTo(sx - 6 * z, sy - 28 * z + bob); ctx.lineTo(sx + 6 * z, sy - 28 * z + bob); ctx.closePath(); ctx.fill();
      }
    }
  }
  badge(x, y, ch, fg, bg, z, fill = 1, style = 'circle') {
    const ctx = this.ctx;
    const r = 8 * z;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); if (style === 'square') ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.fill();
    if (style === 'meter') {
      // fill from bottom by suspicion (shape+fill, color-independent)
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = bg; ctx.fillRect(x - r, y + r - 2 * r * clamp(fill, 0, 1), 2 * r, 2 * r * clamp(fill, 0, 1)); ctx.restore();
      ctx.strokeStyle = bg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = fill > 0.55 ? fg : '#f0e0a0';
    } else {
      ctx.fillStyle = bg; ctx.beginPath(); if (style === 'square') ctx.rect(x - r + 1.5, y - r + 1.5, r * 2 - 3, r * 2 - 3); else ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = fg;
    }
    ctx.font = `bold ${Math.round(11 * z)}px system-ui, sans-serif`;
    ctx.fillText(ch, x, y + 0.5);
  }
  eyeIcon(x, y, z) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.ellipse(x, y, 13 * z, 8 * z, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9ed0a8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(x, y, 10 * z, 5.5 * z, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 10 * z, y + 5 * z); ctx.lineTo(x + 10 * z, y - 5 * z); ctx.stroke();
    ctx.fillStyle = '#9ed0a8'; ctx.font = `bold ${Math.round(8 * z)}px system-ui`; ctx.fillText('HIDDEN', x, y + 15 * z);
  }
  drawReportTimer(x, y, t, z, body, camera) {
    const ctx = this.ctx;
    const r = 15 * z;
    const frac = clamp(t / REPORT_TIME, 0, 1);
    ctx.fillStyle = 'rgba(10,0,0,0.75)'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3.5 * z; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = Math.sin(this.time * 14) > -0.3 ? '#ff4a3a' : '#ff9a6a'; ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(11 * z)}px system-ui, sans-serif`;
    ctx.fillText(t.toFixed(1), x, y + 1);
    // radio waves icon + label (shape, not only color)
    ctx.strokeStyle = '#ffb0a0'; ctx.lineWidth = 1.4;
    for (const k of [1, 2]) { ctx.beginPath(); ctx.arc(x + r + 3, y - r + 2, 3 * k * z, -0.9, 0.9); ctx.stroke(); }
    ctx.font = `bold ${Math.round(8 * z)}px system-ui`;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; const label = camera ? 'CAMERA UPLINK' : body ? 'BODY REPORT' : 'RADIO REPORT'; const w = ctx.measureText(label).width + 8; ctx.fillRect(x - w / 2, y + r + 4, w, 11 * z);
    ctx.fillStyle = '#ffd0c0'; ctx.fillText(label, x, y + r + 9.5 * z);
  }
}

export function weaponVisual(id) {
  const w = WEAPONS[id];
  if (!w) return 'pistol';
  if (w.slot === 'sidearm') return 'pistol';
  if (id === 'm870' || id === 'ts12') return 'shotgun';
  if (id === 'xbow') return 'crossbow';
  if (id === 'k5' || id === 'k5sd') return 'smg';
  return 'rifle';
}
