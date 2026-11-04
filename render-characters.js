// Procedural 3D-puppet humans projected isometrically, animated for walk, crouch, aim,
// fire, takedown, kneeling/tied, frightened, injury and downed poses.
import { shade } from './render-iso.js';

const PX_PER_M = 36;

export function drawShadow(ctx, cam, x, y, r = 0.32, a = 0.38) {
  const sx = cam.sx_(x, y), sy = cam.sy_(x, y, 0);
  const k = cam.zoom * PX_PER_M;
  ctx.save();
  ctx.translate(sx, sy); ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * k * 1.4);
  g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * k * 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawHuman(ctx, cam, e, look, pose, L = 1) {
  const a = e.facing;
  const fx = Math.cos(a), fy = Math.sin(a), rx = -fy, ry = fx;
  let bx = e.x, by = e.y;
  if (pose.shake) { bx += (Math.random() - 0.5) * 0.05; by += (Math.random() - 0.5) * 0.05; }
  const W = (fw, rt, z) => [bx + fx * fw + rx * rt, by + fy * fw + ry * rt, z];
  const k = cam.zoom * PX_PER_M;
  const Pj = (p) => [cam.sx_(p[0], p[1]), cam.sy_(p[0], p[1], p[2])];
  const segs = [];
  const limb = (p0, p1, col, w, kind) => segs.push({ kind: 'line', p0, p1, col, w, d: (p0[0] + p0[1] + p1[0] + p1[1]) / 2 });
  const L2 = Math.max(0.25, L);
  const hurt = pose.hurt ? 1.35 : 1;
  const C = (c, f = 1) => pose.hurt ? `rgb(190,60,50)` : shade(c, L2 * f * (hurt > 1 ? 1 : 1));

  if (pose.down) {
    const z = 0.1;
    const head = W(-0.78, 0, z + 0.03);
    const shL = W(-0.5, 0.2, z), shR = W(-0.5, -0.2, z), hipL = W(0, 0.13, z), hipR = W(0, -0.13, z);
    limb(W(0, 0.12, z), W(0.42, 0.18, z), look.pants, 0.15);
    limb(W(0.42, 0.18, z), W(0.85, 0.16, 0.06), look.pants, 0.14);
    limb(W(0, -0.12, z), W(0.45, -0.12, z), look.pants, 0.15);
    limb(W(0.45, -0.12, z), W(0.86, -0.22, 0.06), look.pants, 0.14);
    limb(shL, W(-0.35, 0.45, 0.06), look.top, 0.11);
    limb(shR, W(-0.25, -0.48, 0.06), look.top, 0.11);
    segs.push({ kind: 'torso', pts: [shL, shR, hipR, hipL], col: look.vest || look.top, d: -999 });
    segs.push({ kind: 'head', p: head, d: 999 });
    drawSegs(ctx, segs, Pj, k, C, look, e, pose, true);
    return;
  }
  const c = pose.crouch || 0, kn = pose.kneel ? 1 : 0;
  const hipZ = 0.92 - 0.36 * c - 0.47 * kn;
  const shZ = 1.42 - 0.43 * c - 0.42 * kn;
  const aim = pose.aim || 0;
  const lean = 0.03 + 0.13 * c + 0.05 * aim + (pose.handsUp ? 0.08 : 0);
  const sp = pose.speed || 0;
  const stride = Math.min(1, sp / 2.2) * (sp > 3.2 ? 0.44 : 0.28);
  const ph = pose.phase || 0;
  // legs
  for (const s of [1, -1]) {
    const hp = W(0, s * 0.1, hipZ);
    let foot, knee;
    if (kn) { knee = W(0.28, s * 0.13, 0.06); foot = W(-0.22, s * 0.13, 0.05); }
    else {
      const q = ph + (s > 0 ? 0 : Math.PI);
      const ffw = Math.sin(q) * stride + (c > 0.3 ? s * 0.14 * c : 0);
      const lift = Math.max(0, Math.cos(q)) * 0.1 * Math.min(1, sp);
      foot = W(ffw, s * 0.11, lift);
      knee = W(ffw * 0.5 + 0.08 + 0.22 * c, s * 0.11, (hipZ + lift) / 2 + 0.04 - 0.05 * c);
    }
    limb(hp, knee, look.pants, 0.15, 'thigh');
    limb(knee, foot, look.pants, 0.13, 'shin');
    segs.push({ kind: 'boot', p: foot, f: [fx, fy], d: foot[0] + foot[1] });
  }
  const shL = W(lean, 0.2, shZ), shR = W(lean, -0.2, shZ), hipL = W(0, 0.14, hipZ), hipR = W(0, -0.14, hipZ);
  segs.push({ kind: 'torso', pts: [shL, shR, hipR, hipL], col: look.vest || look.top, top: look.top, d: bx + by + fx * (lean * 0.4) + fy * (lean * 0.4) });
  if (look.backpack) segs.push({ kind: 'pack', pts: [W(lean - 0.12, 0.16, shZ - 0.05), W(lean - 0.12, -0.16, shZ - 0.05), W(-0.12, -0.14, hipZ + 0.18), W(-0.12, 0.14, hipZ + 0.18)], d: bx + by - (fx + fy) * 0.15 });
  const head = W(lean + 0.02 + (pose.kneel ? 0.05 : 0), 0, shZ + 0.2 - (pose.handsUp ? 0.06 : 0));
  segs.push({ kind: 'head', p: head, d: head[0] + head[1] + 0.001 });
  // arms
  let hands; // [rear(right), front(left)]
  const wpn = look.weapon;
  const armedUp = wpn && wpn !== 'knife' && aim > 0.5;
  if (pose.tied) hands = [W(-0.2, -0.06, hipZ + 0.08), W(-0.2, 0.06, hipZ + 0.08)];
  else if (pose.handsUp) hands = [W(lean + 0.08, -0.13, shZ + 0.22), W(lean + 0.08, 0.13, shZ + 0.22)];
  else if (pose.takedown === 'attacker') hands = [W(lean + 0.48, -0.12, shZ - 0.02), W(lean + 0.5, 0.12, shZ + 0.02)];
  else if (pose.takedown === 'victim') hands = [W(lean + 0.1, -0.25, shZ + 0.05 + Math.sin(pose.t * 30) * 0.05), W(lean + 0.1, 0.25, shZ + 0.1)];
  else if (armedUp && (wpn === 'pistol')) hands = [W(lean + 0.44, -0.04, shZ - 0.05), W(lean + 0.42, 0.04, shZ - 0.07)];
  else if (armedUp) hands = [W(lean + 0.14, -0.12, shZ - 0.08), W(lean + 0.44, 0.02, shZ - 0.06)];
  else if (wpn === 'knife' || pose.slash) hands = [W(lean + 0.3 + (pose.slash ? 0.2 : 0), -0.2, shZ - 0.2), W(lean + 0.1, 0.24, hipZ + 0.05)];
  else if (wpn === 'pistol') hands = [W(0.12 + Math.sin(ph) * 0.08 * Math.min(1, sp), -0.22, hipZ - 0.02), W(-Math.sin(ph) * 0.15 * Math.min(1, sp), 0.24, hipZ - 0.02)];
  else if (wpn) hands = [W(0.1, -0.15, hipZ + 0.2), W(0.36, 0.0, hipZ + 0.34)];
  else { const sw = Math.sin(ph) * 0.18 * Math.min(1, sp); hands = [W(sw + 0.02, -0.25, hipZ - 0.04), W(-sw + 0.02, 0.25, hipZ - 0.04)]; }
  const elbow = (sh, h, side) => [(sh[0] + h[0]) / 2 + rx * side * 0.06, (sh[1] + h[1]) / 2 + ry * side * 0.06, (sh[2] + h[2]) / 2 - 0.08];
  const eR = elbow(shR, hands[0], -1), eL = elbow(shL, hands[1], 1);
  limb(shR, eR, look.top, 0.11); limb(eR, hands[0], look.top, 0.1);
  limb(shL, eL, look.top, 0.11); limb(eL, hands[1], look.top, 0.1);
  segs.push({ kind: 'hand', p: hands[0], d: hands[0][0] + hands[0][1] + 0.01 });
  segs.push({ kind: 'hand', p: hands[1], d: hands[1][0] + hands[1][1] + 0.01 });
  // weapon
  if (wpn && !pose.tied) {
    const len = { rifle: 0.78, smg: 0.5, shotgun: 0.76, pistol: 0.2, knife: 0.22, crossbow: 0.6 }[wpn] || 0.5;
    const from = wpn === 'pistol' ? hands[0] : hands[0];
    let dir;
    if (armedUp || wpn === 'pistol' && aim > 0.5) dir = [fx, fy, -0.02];
    else if (wpn === 'pistol') dir = [fx * 0.5, fy * 0.5, -0.8];
    else if (wpn === 'knife') dir = [fx * 0.8, fy * 0.8, 0.3];
    else dir = [fx * 0.85, fy * 0.85, 0.45];
    const back = wpn === 'pistol' || wpn === 'knife' ? 0 : 0.18;
    const p0 = [from[0] - dir[0] * back, from[1] - dir[1] * back, from[2] - dir[2] * back];
    const p1 = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len];
    segs.push({ kind: 'line', p0, p1, col: wpn === 'knife' ? '#b8bcc0' : '#1c1c1e', w: wpn === 'pistol' || wpn === 'knife' ? 0.06 : 0.075, d: (p0[0] + p0[1] + p1[0] + p1[1]) / 2 + 0.02, noOutline: wpn === 'knife' });
    e._muzzle = p1;
  } else e._muzzle = null;
  segs.sort((s1, s2) => s1.d - s2.d);
  drawSegs(ctx, segs, Pj, k, C, look, e, pose, false);
  // muzzle flash
  if (pose.fire && e._muzzle) {
    const [mx, my] = Pj(e._muzzle);
    const r = (0.18 + Math.random() * 0.1) * k;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
    g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.4, 'rgba(255,190,80,0.8)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
  }
  if (look.flashlight && e._muzzle && !pose.down) {
    const [mx, my] = Pj(e._muzzle);
    ctx.fillStyle = 'rgba(255,248,210,0.95)'; ctx.beginPath(); ctx.arc(mx, my, 1.8 * cam.zoom, 0, Math.PI * 2); ctx.fill();
  }
}

function drawSegs(ctx, segs, Pj, k, C, look, e, pose, down) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of segs) {
    if (s.kind === 'line') {
      const a = Pj(s.p0), b = Pj(s.p1);
      if (!s.noOutline) { ctx.strokeStyle = 'rgba(10,8,6,0.85)'; ctx.lineWidth = s.w * k + 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.strokeStyle = C(s.col); ctx.lineWidth = s.w * k; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      // subtle highlight
      ctx.strokeStyle = 'rgba(255,240,220,0.12)'; ctx.lineWidth = s.w * k * 0.35; ctx.beginPath(); ctx.moveTo(a[0] - 0.5, a[1] - 0.8); ctx.lineTo(b[0] - 0.5, b[1] - 0.8); ctx.stroke();
    } else if (s.kind === 'torso' || s.kind === 'pack') {
      const pts = s.pts.map(Pj);
      const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
      // inflate a bit for volume
      const inf = pts.map(([x, y]) => [cx + (x - cx) * 1.12, cy + (y - cy) * 1.06]);
      ctx.beginPath(); ctx.moveTo(inf[0][0], inf[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(inf[i][0], inf[i][1]); ctx.closePath();
      ctx.fillStyle = C(s.kind === 'pack' ? '#2c3226' : s.col); ctx.fill();
      ctx.strokeStyle = 'rgba(10,8,6,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
      if (s.kind === 'torso') {
        // shirt collar / belt
        ctx.strokeStyle = C(look.pants, 0.7); ctx.lineWidth = 0.07 * k;
        ctx.beginPath(); ctx.moveTo(inf[3][0], inf[3][1]); ctx.lineTo(inf[2][0], inf[2][1]); ctx.stroke();
        if (look.vest && look.vest !== look.top) {
          // pouches
          ctx.fillStyle = C(look.vest, 0.75);
          const mx = (inf[0][0] + inf[1][0] + inf[2][0] * 2 + inf[3][0] * 2) / 6, my = (inf[0][1] + inf[1][1] + inf[2][1] * 2 + inf[3][1] * 2) / 6;
          ctx.fillRect(mx - 0.12 * k, my - 0.06 * k, 0.24 * k, 0.1 * k);
        }
        if (look.armband) { ctx.strokeStyle = '#8a2a22'; ctx.lineWidth = 0.08 * k; ctx.beginPath(); ctx.moveTo(inf[0][0], inf[0][1]); ctx.lineTo((inf[0][0] + inf[3][0]) / 2, (inf[0][1] + inf[3][1]) / 2); ctx.stroke(); }
      }
    } else if (s.kind === 'head') {
      const [hx, hy] = Pj(s.p);
      const r = 0.125 * k;
      ctx.fillStyle = 'rgba(10,8,6,0.85)'; ctx.beginPath(); ctx.arc(hx, hy, r + 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C(look.skin); ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill();
      // facing: screen-space direction of facing
      const sfx = (Math.cos(e.facing) - Math.sin(e.facing)), sfy = (Math.cos(e.facing) + Math.sin(e.facing)) * 0.5;
      const towardCam = sfy > -0.05;
      const hd = look.head;
      if (hd === 'helmet' || hd === 'cap' || hd === 'beret' || hd === 'hood') {
        const col = look.headCol || look.vest || '#333';
        ctx.fillStyle = C(col);
        ctx.beginPath();
        if (hd === 'beret') { ctx.ellipse(hx - sfx * r * 0.15, hy - r * 0.55, r * 1.05, r * 0.55, -0.2, 0, Math.PI * 2); }
        else if (hd === 'hood') { ctx.arc(hx, hy, r * 1.15, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(hx + r * 1.1, hy + r * 0.6); ctx.lineTo(hx - r * 1.1, hy + r * 0.6); }
        else { ctx.arc(hx, hy - r * 0.15, r * (hd === 'helmet' ? 1.12 : 1.02), Math.PI, Math.PI * 2); ctx.closePath(); }
        ctx.fill();
        if (hd === 'cap') { ctx.fillStyle = C(col, 0.7); ctx.beginPath(); ctx.ellipse(hx + sfx * r * 0.7, hy - r * 0.1 + sfy * r * 0.5, r * 0.6, r * 0.25, Math.atan2(sfy, sfx), 0, Math.PI * 2); ctx.fill(); }
        if (hd === 'helmet' && look.nvg) { ctx.fillStyle = '#141414'; ctx.fillRect(hx + sfx * r * 0.4 - r * 0.25, hy - r * 0.6, r * 0.5, r * 0.35); }
      } else if (look.hair) {
        ctx.fillStyle = C(look.hair);
        ctx.beginPath(); ctx.arc(hx - sfx * r * 0.2, hy - r * 0.2 - sfy * r * 0.1, r * 1.02, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
        if (look.longHair) { ctx.fillRect(hx - sfx * r * 0.6 - r * 0.7, hy - r * 0.2, r * 1.4, r * 1.1); }
      }
      if (towardCam && !down) {
        ctx.fillStyle = 'rgba(20,14,10,0.85)';
        const ex = hx + sfx * r * 0.45, ey = hy + r * 0.05 + sfy * r * 0.15;
        ctx.fillRect(ex - r * 0.35, ey - r * 0.1, r * 0.18, r * 0.16); ctx.fillRect(ex + r * 0.15, ey - r * 0.1, r * 0.18, r * 0.16);
        if (look.gag) { ctx.fillStyle = '#d8d0c0'; ctx.fillRect(ex - r * 0.45, ey + r * 0.25, r * 0.9, r * 0.22); }
      }
    } else if (s.kind === 'hand') {
      const [x, y] = Pj(s.p);
      ctx.fillStyle = C(look.gloves || look.skin); ctx.beginPath(); ctx.arc(x, y, 0.055 * k, 0, Math.PI * 2); ctx.fill();
    } else if (s.kind === 'boot') {
      const [x, y] = Pj(s.p);
      ctx.fillStyle = C(look.boots || '#1e1a16', 0.8); ctx.beginPath(); ctx.ellipse(x + (s.f[0] - s.f[1]) * 0.06 * k, y + (s.f[0] + s.f[1]) * 0.03 * k, 0.09 * k, 0.05 * k, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (pose.tied) {
    // rope at wrists
    // drawn as small light segment between hands (already overlapped)
  }
}

export const SOLDIER_LOOK = { skin: '#b8906c', top: '#3e4a36', vest: '#262c22', pants: '#3a4232', boots: '#1a1a16', head: 'helmet', headCol: '#38402f', gloves: '#1c1c1a', backpack: true, nvg: true };
export function guardLook(def, type) {
  return { skin: type === 'armored' ? '#a07a5a' : '#b48a66', top: def.look, vest: def.vest, pants: '#3c3a34', boots: '#1e1a16', head: def.head, headCol: def.head === 'beret' ? '#5a1e1a' : def.head === 'helmet' ? '#2e3034' : def.head === 'hood' ? def.vest : '#4a4234', gloves: '#2a2622', flashlight: true, armband: !!def.leader };
}
export function hostageLook(h) {
  return { skin: h.skin, top: h.shirt, vest: h.shirt, pants: '#3a3842', boots: '#2a2420', hair: h.hair, longHair: h.female, gag: h.state === 'restrained' };
}
