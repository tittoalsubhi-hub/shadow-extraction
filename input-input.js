// Touch (multi-pointer), keyboard/mouse and gamepad input → screen-space command snapshot.
import { CONTROL_DEFS, CONTROL_IDS, controlVisible } from './input-layout.js';

export const ACTIONS = ['gadget', 'gadgetNext', 'fire', 'takedown', 'toggleTakedownMode', 'interact', 'crouch', 'reload', 'swap', 'gadget0', 'gadget1', 'ability', 'abilityNext', 'follow', 'wait', 'evacuate', 'map', 'pause', 'run'];
export const ACTION_LABELS = { up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', fire: 'Fire', takedown: 'Takedown', toggleTakedownMode: 'Lethal / non-lethal', interact: 'Interact / hide', crouch: 'Crouch', reload: 'Reload', swap: 'Switch weapon', gadget0: 'Gadget 1', gadget1: 'Gadget 2', gadget: 'Use selected gadget', gadgetNext: 'Next gadget', ability: 'Use ability', abilityNext: 'Cycle ability', follow: 'Hostages: follow', wait: 'Hostages: wait', evacuate: 'Hostages: evacuate', map: 'Floor map', pause: 'Pause', run: 'Run (hold)' };
export const DEFAULT_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], fire: ['Space'], takedown: ['KeyF'], toggleTakedownMode: ['KeyV'], interact: ['KeyE'], crouch: ['KeyC', 'ControlLeft'], reload: ['KeyR'], swap: ['KeyQ'], gadget0: ['Digit1'], gadget1: ['Digit2'], gadget: ['KeyH'], gadgetNext: ['KeyJ'], ability: ['KeyX'], abilityNext: ['KeyZ'], follow: ['KeyT'], wait: ['KeyG'], evacuate: ['KeyB'], map: ['KeyM', 'Tab'], pause: ['Escape', 'KeyP'], run: ['ShiftLeft', 'ShiftRight'] };
// standard gamepad mapping indices
export const DEFAULT_PAD = { fire: 7, gadget1: 6, interact: 0, crouch: 1, reload: 2, swap: 3, takedown: 5, gadget0: 4, follow: 12, wait: 14, evacuate: 15, ability: 13, pause: 9, map: 8, toggleTakedownMode: 11, abilityNext: 10 };

export class Input {
  constructor(root, opts) {
    this.root = root;
    this.opts = opts; // { getSettings, onAction (for menu-level actions), haptic }
    this.held = new Set();
    this.pressed = new Set();
    this.keysDown = new Set();
    this.pointers = new Map(); // pointerId -> {ctl, ...}
    this.stick = { x: 0, y: 0, active: false };
    this.aimStick = { x: 0, y: 0, active: false };
    this.mouse = { x: 0, y: 0, active: false, t: -1e9, down: false };
    this.padPrev = [];
    this.enabled = true;
    this.els = {};
    this.lastSource = 'touch';
    this.build();
    this.bindKeyboard();
  }
  settings() { return this.opts.getSettings(); }

  build() {
    const root = this.root;
    root.innerHTML = '';
    this.zone = document.createElement('div');
    this.zone.className = 'stick-zone';
    root.appendChild(this.zone);
    this.bindStickZone(this.zone);
    for (const id of CONTROL_IDS) {
      const def = CONTROL_DEFS[id];
      const el = document.createElement('div');
      el.className = `ctl ctl-${def.kind} ctl-${id}`;
      el.dataset.id = id;
      if (def.kind === 'stick') {
        el.innerHTML = `<div class="stick-base"></div><div class="stick-knob"></div><span class="stick-label">${def.label}</span>`;
        this.bindStick(el, id);
      } else if (def.kind === 'group') {
        el.innerHTML = `<button class="chip" data-a="follow">FOLLOW</button><button class="chip" data-a="wait">WAIT</button><button class="chip" data-a="evacuate">EVACUATE</button>`;
        for (const b of el.querySelectorAll('.chip')) this.bindButton(b, b.dataset.a);
      } else {
        el.innerHTML = `<span class="lbl">${def.label.replace('\n', '<br>')}</span><span class="sub"></span><div class="cd"></div>`;
        this.bindButton(el, def.action);
      }
      root.appendChild(el);
      this.els[id] = el;
    }
  }
  bindButton(el, action) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { }
      this.pointers.set(e.pointerId, { action, el });
      this.pressed.add(action); this.held.add(action);
      el.classList.add('down');
      this.lastSource = 'touch';
      this.mouse.active = false;
      this.opts.haptic && this.opts.haptic(8);
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (![...this.pointers.values()].some(q => q.action === p.action)) this.held.delete(p.action);
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  stickUpdate(st, el, cx, cy, px, py, radius) {
    let dx = px - cx, dy = py - cy;
    const d = Math.hypot(dx, dy);
    const dz = this.settings().deadzone;
    const r = radius;
    if (d > r) { dx = dx / d * r; dy = dy / d * r; }
    let mag = Math.min(1, d / r);
    if (mag < dz) { st.x = 0; st.y = 0; }
    else { const m2 = (mag - dz) / (1 - dz); st.x = (dx / (d || 1)) * m2; st.y = (dy / (d || 1)) * m2; }
    const knob = el.querySelector('.stick-knob');
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
  bindStick(el, id) {
    const st = id === 'stick' ? this.stick : this.aimStick;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      this.pointers.set(e.pointerId, { stick: st, el, cx, cy, radius: r.width * 0.42 });
      st.active = true; el.classList.add('down');
      this.lastSource = 'touch'; this.mouse.active = false;
      this.stickUpdate(st, el, cx, cy, e.clientX, e.clientY, r.width * 0.42);
    });
    el.addEventListener('pointermove', (e) => { const p = this.pointers.get(e.pointerId); if (p && p.stick) { e.preventDefault(); this.stickUpdate(st, el, p.cx, p.cy, e.clientX, e.clientY, p.radius); } });
    const up = (e) => { const p = this.pointers.get(e.pointerId); if (!p) return; this.pointers.delete(e.pointerId); this.resetStick(st, el); if (p.floating) el.classList.remove('floating-on'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  resetStick(st, el) {
    st.x = 0; st.y = 0; st.active = false;
    if (el) { el.classList.remove('down'); const k = el.querySelector('.stick-knob'); if (k) k.style.transform = 'translate(-50%, -50%)'; }
    if (el && el._floatHome) { el.style.left = el._floatHome[0]; el.style.top = el._floatHome[1]; }
  }
  bindStickZone(zone) {
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.settings().joystickMode !== 'floating') return;
      e.preventDefault();
      const el = this.els.stick;
      const rootR = this.root.getBoundingClientRect();
      el._floatHome = el._floatHome || [el.style.left, el.style.top];
      el.style.left = (e.clientX - rootR.left) + 'px'; el.style.top = (e.clientY - rootR.top) + 'px';
      el.classList.add('floating-on');
      try { zone.setPointerCapture(e.pointerId); } catch { }
      const r = el.getBoundingClientRect();
      this.pointers.set(e.pointerId, { stick: this.stick, el, cx: e.clientX, cy: e.clientY, radius: r.width * 0.42, floating: true });
      this.stick.active = true; el.classList.add('down');
      this.lastSource = 'touch'; this.mouse.active = false;
    });
    zone.addEventListener('pointermove', (e) => { const p = this.pointers.get(e.pointerId); if (p && p.stick) { e.preventDefault(); this.stickUpdate(p.stick, p.el, p.cx, p.cy, e.clientX, e.clientY, p.radius); } });
    const up = (e) => { const p = this.pointers.get(e.pointerId); if (!p) return; this.pointers.delete(e.pointerId); this.resetStick(p.stick, p.el); p.el.classList.remove('floating-on'); };
    zone.addEventListener('pointerup', up); zone.addEventListener('pointercancel', up); zone.addEventListener('lostpointercapture', up);
  }

  keyMap() {
    const s = this.settings();
    const binds = { ...DEFAULT_KEYS, ...(s.keybinds || {}) };
    const m = new Map();
    for (const a in binds) for (const k of binds[a]) if (k) m.set(k, a);
    return m;
  }
  bindKeyboard() {
    this.km = this.keyMap();
    window.addEventListener('keydown', (e) => {
      if (this.captureKey) { e.preventDefault(); this.captureKey(e.code); return; }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const a = this.km.get(e.code);
      if (!a) return;
      e.preventDefault();
      this.lastSource = 'keyboard';
      if (a === 'pause' || a === 'map') { if (!e.repeat) this.opts.onAction(a); return; }
      if (!this.enabled) return;
      if (['up', 'down', 'left', 'right', 'run'].includes(a)) { this.keysDown.add(a); return; }
      if (!e.repeat) { this.pressed.add(a); this.held.add(a); }
    });
    window.addEventListener('keyup', (e) => {
      const a = this.km.get(e.code);
      if (!a) return;
      this.keysDown.delete(a); this.held.delete(a);
    });
    const cv = this.opts.canvas;
    cv.addEventListener('mousemove', (e) => { if (performance.now() - (this.lastTouchT || 0) < 900) return; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.active = true; this.mouse.t = performance.now(); this.lastSource = 'keyboard'; });
    cv.addEventListener('mousedown', (e) => { if (performance.now() - (this.lastTouchT || 0) < 900) return; if (!this.enabled) return; this.mouse.active = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; if (e.button === 0) { this.pressed.add('fire'); this.held.add('fire'); this.mouse.down = true; } else if (e.button === 2) { this.pressed.add('takedown'); } });
    window.addEventListener('mouseup', (e) => { if (e.button === 0 && this.mouse.down) { this.mouse.down = false; this.held.delete('fire'); } });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mouseleave', () => { this.mouse.active = false; });
    cv.addEventListener('touchstart', () => { this.mouse.active = false; this.lastTouchT = performance.now(); }, { passive: true });
    window.addEventListener('touchstart', () => { this.lastTouchT = performance.now(); }, { passive: true, capture: true });
  }
  refreshBindings() { this.km = this.keyMap(); }

  pollGamepad(out) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find(p => p && p.connected);
    if (!gp) return;
    const s = this.settings();
    const map = { ...DEFAULT_PAD, ...(s.padbinds || {}) };
    const dz = 0.18;
    const ax = (i) => { const v = gp.axes[i] || 0; return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz); };
    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    if (lx || ly) { out.mx = lx; out.my = ly; this.lastSource = 'gamepad'; }
    if (Math.hypot(rx, ry) > 0.25) { out.ax = rx; out.ay = ry; out.aiming = true; }
    const btn = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    for (const a in map) {
      const i = map[a];
      const now = btn(i), prev = this.padPrev[i];
      if (now && !prev) {
        this.lastSource = 'gamepad';
        if (a === 'pause' || a === 'map') this.opts.onAction(a);
        else if (this.enabled) out.pressed.add(a);
      }
      if (now && a === 'fire') out.fire = true;
    }
    this.padPrev = gp.buttons.map((b, i) => btn(i));
  }

  poll() {
    const out = { mx: 0, my: 0, ax: 0, ay: 0, aiming: false, aimScreen: null, fire: false, attack: false, pressed: new Set(), source: this.lastSource };
    if (!this.enabled) { this.pressed.clear(); return out; }
    // touch stick
    if (this.stick.active) { out.mx = this.stick.x; out.my = this.stick.y; }
    // keyboard
    let kx = 0, ky = 0;
    if (this.keysDown.has('left')) kx -= 1; if (this.keysDown.has('right')) kx += 1;
    if (this.keysDown.has('up')) ky -= 1; if (this.keysDown.has('down')) ky += 1;
    if (kx || ky) { const l = Math.hypot(kx, ky); const sp = this.keysDown.has('run') ? 1 : 0.78; out.mx = kx / l * sp; out.my = ky / l * sp; }
    // aim
    if (this.aimStick.active && Math.hypot(this.aimStick.x, this.aimStick.y) > 0.2) { out.ax = this.aimStick.x; out.ay = this.aimStick.y; out.aiming = true; }
    else if (this.mouse.active && performance.now() - this.mouse.t < 6000) out.aimScreen = { x: this.mouse.x, y: this.mouse.y };
    out.fire = this.held.has('fire');
    out.attack = this.held.has('attack');
    for (const a of this.pressed) out.pressed.add(a);
    this.pressed.clear();
    this.pollGamepad(out);
    return out;
  }
  // Release every held input (menus, app switch, blur, orientation change)
  releaseAll() {
    this.held.clear(); this.pressed.clear(); this.keysDown.clear();
    for (const [id, p] of this.pointers) { try { p.el.releasePointerCapture(id); } catch { } if (p.el) p.el.classList.remove('down', 'floating-on'); }
    this.pointers.clear();
    this.resetStick(this.stick, this.els.stick);
    this.resetStick(this.aimStick, this.els.aim);
    this.mouse.down = false;
  }
  setEnabled(v) { if (!v) this.releaseAll(); this.enabled = v; this.root.classList.toggle('disabled', !v); }

  applyLayout(layout, safe, settings) {
    // safe: {l,t,r,b,w,h} in CSS px of the root
    const W = safe.w - safe.l - safe.r, H = safe.h - safe.t - safe.b;
    const unit = Math.min(1.25, Math.max(0.8, Math.min(safe.w, safe.h) / 400)) * (settings.uiScale || 1);
    for (const id of CONTROL_IDS) {
      const def = CONTROL_DEFS[id], el = this.els[id], c = layout[id];
      if (!c) continue;
      const show = controlVisible(id, settings);
      el.style.display = show ? '' : 'none';
      const size = def.base * c.s * unit;
      el.style.left = (safe.l + c.x * W) + 'px';
      el.style.top = (safe.t + c.y * H) + 'px';
      el.style.opacity = c.o;
      if (def.kind === 'group') { el.style.setProperty('--chip', `${size}px`); el.style.width = 'auto'; el.style.height = 'auto'; }
      else { el.style.width = size + 'px'; el.style.height = size + 'px'; el.style.fontSize = Math.max(9, size * (def.kind === 'stick' ? 0.1 : 0.2)) + 'px'; }
      el._floatHome = null;
    }
    this.zone.style.left = safe.l + 'px'; this.zone.style.top = (safe.t + H * 0.25) + 'px';
    this.zone.style.width = (W * 0.5) + 'px'; this.zone.style.height = (H * 0.75) + 'px';
    this.zone.style.display = settings.joystickMode === 'floating' ? '' : 'none';
    this.els.stick.classList.toggle('floating', settings.joystickMode === 'floating');
  }
}
