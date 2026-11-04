// App shell: boot, game loop, screen flow, saving, input routing, audio events, PWA updates.
import { Game, DT } from './game-game.js';
import { createRun, operationRating } from './game-run.js';
import { DIFFICULTY, WEAPONS, REPORT_TIME } from './game-data.js';
import { Renderer } from './render-renderer.js';
import { screenDirToWorld } from './render-iso.js';
import { Input } from './input-input.js';
import { defaultLayouts, mirrorLayout, LAYOUT_VERSION } from './input-layout.js';
import { UI, fmtTime } from './ui-ui.js';
import { LayoutEditor } from './ui-editor.js';
import { Audio } from './audio-audio.js';
import * as Save from './game-save.js';
import { createTutorialRun, populateTutorial, Tutorial } from './game-tutorial.js';
import { markersOf } from './world-building.js';
import { dist } from './core-util.js';

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.settings = Save.loadSettings();
    this.meta = Save.loadMeta();
    const savedLayouts = Save.loadControls();
    this.layouts = savedLayouts && savedLayouts.v === LAYOUT_VERSION ? savedLayouts : { ...defaultLayouts(), v: LAYOUT_VERSION };
    const def = defaultLayouts();
    for (const o of ['portrait', 'landscape']) { this.layouts[o] = { ...def[o], ...(this.layouts[o] || {}) }; }
    this.renderer = new Renderer(this.canvas);
    this.audio = new Audio();
    this.audio.setVolumes(this.settings.music, this.settings.sfx);
    this.input = new Input(document.getElementById('controls'), { getSettings: () => this.settings, onAction: (a) => this.onAction(a), haptic: (ms) => this.haptic(ms), canvas: this.canvas });
    this.ui = new UI(this);
    this.editor = new LayoutEditor(this);
    this.game = null; this.state = 'title';
    this.acc = 0; this.last = performance.now(); this.pendingPressed = new Set();
    this.blindT = 0; this.shake = 0; this.frameTimes = []; this.lowQ = this.settings.quality === 'low';
    this.newRunSel = { difficulty: 'normal', sidearm: 'p9' };
    this.updateReady = false;
    this.lastTick = {};
    this.bindGlobal();
    this.bindZoom();
    document.getElementById('rotate').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rot]'); if (!b) return;
      if (b.dataset.rot === 'portrait') { this.settings.allowPortrait = true; Save.saveSettings(this.settings); this.resize(); }
      else this.lockLandscape().then(() => this.resize());
    });
    this.resize();
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
    this.registerSW();
  }

  // ---------- layout & viewport ----------
  orientation() { return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape'; }
  safeRect() {
    const pr = getComputedStyle(document.getElementById('safe-probe'));
    const n = (v) => parseFloat(v) || 0;
    const w = window.innerWidth, h = window.innerHeight;
    // keep a margin for system gesture regions at the bottom
    return { l: n(pr.paddingLeft) + 6, t: n(pr.paddingTop) + 4, r: n(pr.paddingRight) + 6, b: Math.max(n(pr.paddingBottom), 10) + 6, w, h };
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const q = this.settings.quality;
    const maxDpr = q === 'high' ? 2.5 : (q === 'low' || this.lowQ) ? 1 : 2;
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    this.renderer.resize(w, h, dpr);
    this.renderer.quality = (q === 'low' || this.lowQ) ? 0.5 : 1;
    document.documentElement.style.setProperty('--ui', this.settings.uiScale);
    this.relayout();
    this.snapCam = true;
  }
  relayout() {
    this.input.releaseAll();
    const o = this.orientation();
    let l = this.layouts[o];
    if (this.settings.leftHanded) l = mirrorLayout(l);
    document.body.classList.toggle('portrait', o === 'portrait');
    document.body.classList.toggle('landscape', o === 'landscape');
    document.body.classList.toggle('lefty', !!this.settings.leftHanded);
    this.input.applyLayout(l, this.safeRect(), this.settings);
    if (this.editor.active) this.editor.onResize();
    document.body.classList.toggle('scheme-full', this.settings.controlScheme === 'full');
    this.updateRotateHint();
  }
  saveLayouts() { this.layouts.v = LAYOUT_VERSION; Save.saveControls(this.layouts); }
  zoom() {
    const w = window.innerWidth, h = window.innerHeight;
    const base = Math.min(w, h) / 430;
    return Math.max(0.55, Math.min(1.4, base * (this.orientation() === 'portrait' ? 0.82 : 0.96))) * (this.settings.zoom || 1);
  }
  setZoom(z, persist) {
    this.settings.zoom = Math.max(0.6, Math.min(1.8, Math.round(z * 100) / 100));
    if (persist) Save.saveSettings(this.settings);
  }
  bindZoom() {
    const cv = this.canvas;
    const pts = new Map();
    let pinch = null, lastTap = 0, lastTapPos = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.settings.zoom || 1 };
      } else if (pts.size === 1) {
        const now = performance.now();
        if (now - lastTap < 320 && lastTapPos && Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < 40 && this.state === 'playing') {
          // double tap cycles close / normal / wide
          const z = this.settings.zoom || 1;
          this.setZoom(z < 0.9 ? 1 : z < 1.25 ? 1.4 : 0.75, true);
          lastTap = 0;
        } else { lastTap = now; lastTapPos = { x: e.clientX, y: e.clientY }; }
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch.d > 10) this.setZoom(pinch.z * d / pinch.d, false); }
    });
    const up = (e) => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2 && pinch) { pinch = null; Save.saveSettings(this.settings); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); if (this.state !== 'playing') return; this.setZoom((this.settings.zoom || 1) * (e.deltaY > 0 ? 1 / 1.08 : 1.08), true); }, { passive: false });
  }
  // landscape by default: lock where the platform allows it, otherwise ask the player to rotate
  async lockLandscape() {
    if (this.settings.allowPortrait) return;
    try {
      const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
      if (!standalone && !document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => { });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => { });
    } catch { }
  }
  updateRotateHint() {
    const el = document.getElementById('rotate');
    const show = this.orientation() === 'portrait' && !this.settings.allowPortrait && !this.editor.active;
    el.classList.toggle('hidden', !show);
  }
  haptic(ms) { if (this.settings.vibration && navigator.vibrate) try { navigator.vibrate(ms); } catch { } }

  bindGlobal() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    const hidden = () => { this.input.releaseAll(); if (this.state === 'playing') this.openPause(); this.audio.suspend(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) hidden(); else this.audio.resume(); });
    window.addEventListener('blur', () => this.input.releaseAll());
    window.addEventListener('pagehide', hidden);
    // block browser gestures during play
    document.addEventListener('touchmove', (e) => { if (!e.target.closest('.screen, .editor-panel')) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    const unlock = () => { this.audio.init(); if (!this._locked) { this._locked = true; this.lockLandscape().then(() => this.resize()); } };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  // ---------- screens & flow ----------
  saveInfo() {
    const r = Save.loadRun();
    if (!r || !r.run) return '';
    const run = r.run;
    return `${DIFFICULTY[run.difficulty].name} · ${run.completed}/9 apartments · LV ${run.level} · ${fmtTime(run.time)}`;
  }
  showTitle() {
    this.state = 'title';
    this.game = null;
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('controls').classList.add('hidden');
    const r = Save.loadRun();
    if (r && r.error) { this.ui.toast(r.error, 'warn'); Save.clearRun(); }
    const hasSave = !!(r && r.run && !r.run.finished);
    this.ui.title({ hasSave, saveInfo: hasSave ? this.saveInfo() : '', update: this.updateReady });
  }
  enterPlay() {
    this.state = 'playing';
    this.ui.hide();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');
    this.input.releaseAll();
    this.input.setEnabled(true);
    this.relayout();
    this.snapCam = true;
    this.acc = 0;
  }
  startGame(run, how, opts = {}) {
    this.game = new Game(run, { settings: this.settings });
    if (opts.tutorial) { this.game.tutorial = new Tutorial(); this.game.loadFloor(-1, 'start', { populate: populateTutorial }); }
    else this.game.loadFloor(run.floor, how);
    this.renderer.mapKey = null;
    document.body.classList.toggle('tutorial-on', !!opts.tutorial);
    this.enterPlay();
    if (!opts.tutorial && how === 'start') this.persist();
    const a = this.game.map.aptInfo[Math.max(0, this.game.lastApt)];
    if (opts.tutorial) { /* instructions panel replaces the intro toast */ }
    else if (how === 'start') this.ui.toast(`Insertion point: Apartment ${a.label} — ${a.name}`, 'big');
    if (run.pendingReward) { this.game.paused = true; this.openDebrief(); }
  }
  newRun() {
    const sel = this.newRunSel;
    Save.clearRun();
    const run = createRun({ difficulty: sel.difficulty, prevStart: this.meta.lastStart, sidearm: sel.sidearm });
    this.meta.lastStart = run.startApt;
    this.meta.records.runs++;
    Save.saveMeta(this.meta);
    this.startGame(run, 'start');
  }
  restartRun() {
    const r = Save.loadRun();
    const old = r && r.run ? r.run : this.game && !this.game.run.tutorial ? this.game.run : null;
    if (!old) { this.ui.newRun(this.meta, this.newRunSel); this.state = 'menu'; return; }
    Save.clearRun();
    const run = createRun({ seed: old.seed, difficulty: old.difficulty, startApt: old.startApt, sidearm: old.player.discoveredWeapons?.[0] || 'p9' });
    this.startGame(run, 'start');
  }
  continueRun() {
    const r = Save.loadRun();
    if (!r || !r.run) { this.ui.toast('No saved operation found.'); this.showTitle(); return; }
    this.startGame(r.run, 'saved');
  }
  persist() {
    const g = this.game;
    if (!g || g.run.tutorial) return;
    const snap = g.snapshot();
    Save.saveRun(snap);
    Save.writeLedger(g.run);
    // persistent unlocks
    for (const w of g.run.player.discoveredWeapons || []) if (!this.meta.discoveredWeapons.includes(w)) this.meta.discoveredWeapons.push(w);
    Save.saveMeta(this.meta);
  }
  openPause() { if (!this.game) return; this.state = 'menu'; this.input.setEnabled(false); this.ui.pause(this.game); }
  openMap() { if (!this.game) return; this.state = 'menu'; this.input.setEnabled(false); this.mapFloor = this.game.map.floor; this.ui.map(this.game, this.mapFloor); }
  openDebrief() { this.state = 'menu'; this.input.setEnabled(false); this.ui.debrief(this.game.run.pendingReward, this.game.run); }

  onAction(a) {
    if (a === 'swap' || a === 'reload' || a === 'toggleTakedownMode') { if (this.state === 'playing') this.input.pressed.add(a); return; }
    if (a === 'pause') { if (this.state === 'playing') this.openPause(); else if (this.state === 'menu' && this.game && !this.game.run.pendingReward && !this.game.over) this.resume(); }
    else if (a === 'map') { if (this.state === 'playing') this.openMap(); else if (this.state === 'menu' && this.game && !this.game.run.pendingReward) this.resume(); }
  }
  resume() {
    if (!this.game || this.game.over) return;
    if (this.game.run.pendingReward) { this.openDebrief(); return; }
    this.enterPlay();
  }
  onUiAction(act, d) {
    const back = () => { if (this.game && !this.game.over) this.openPause(); else this.showTitle(); };
    switch (act) {
      case 'continue': this.continueRun(); break;
      case 'newrun': this.state = 'menu'; this.ui.newRun(this.meta, this.newRunSel); break;
      case 'pickdiff': this.newRunSel.difficulty = d.id; this.ui.newRun(this.meta, this.newRunSel); break;
      case 'picksidearm': this.newRunSel.sidearm = d.id; this.ui.newRun(this.meta, this.newRunSel); break;
      case 'startrun': this.lockLandscape(); this.newRun(); break;
      case 'restart': if (confirm('Restart this operation from the beginning? Current progress will be lost.')) this.restartRun(); break;
      case 'tutorial': this.startGame(createTutorialRun(), 'start', { tutorial: true }); break;
      case 'settings': this.settingsFrom = this.game ? 'pause' : 'title'; this.ui.settings(this.settings); break;
      case 'layout': this.ui.hide(); this.prevHud = document.getElementById('hud').classList.contains('hidden'); document.getElementById('controls').classList.remove('hidden'); this.editor.open(); this.editorReturn = this.game ? 'pause' : 'title'; this.watchEditor(); break;
      case 'records': this.ui.records(this.meta); break;
      case 'back': if (this.settingsFrom === 'pause' && this.game) this.openPause(); else if (this.game && !this.game.over && this.state === 'menu') this.openPause(); else this.showTitle(); this.settingsFrom = null; break;
      case 'resume': this.resume(); break;
      case 'map': this.openMap(); break;
      case 'mapfloor': this.mapFloor = +d.id; this.ui.map(this.game, this.mapFloor); break;
      case 'quit': if (this.game && !this.game.run.tutorial && !this.game.over && this.game.isSafe()) { /* progress is saved at safe points */ } this.showTitle(); break;
      case 'gofloor': { const ok = this.game.takeStairs(+d.id); if (ok) { this.renderer.mapKey = null; this.ui.toast(`${['Floor 1', 'Floor 2', 'Floor 3'][+d.id]}`, 'big'); } this.flushEvents(); this.resume(); break; }
      case 'toupgrade': this.ui.upgrades(this.game.run.pendingReward, this.game.run); break;
      case 'pickupgrade': {
        const g = this.game;
        const finished = g.run.finished;
        g.chooseUpgrade(d.id || null);
        this.flushEvents();
        if (d.id) this.ui.toast(`Upgrade applied: ${d.id && g.run.upgrades[d.id] ? (this.upgradeName(d.id)) : ''}`);
        if (g.run.tutorial) { this.meta.tutorialDone = true; Save.saveMeta(this.meta); this.ui.tutorialDone(); this.state = 'menu'; break; }
        if (finished) this.finishOperation(); else this.resume();
        break;
      }
      case 'resetsettings': if (confirm('Reset all settings and key bindings?')) { this.settings = { ...Save.DEFAULT_SETTINGS }; Save.saveSettings(this.settings); this.input.refreshBindings(); this.audio.setVolumes(this.settings.music, this.settings.sfx); this.resize(); this.ui.settings(this.settings); } break;
      case 'rebind': this.rebindKey(d.id); break;
      case 'rebindpad': this.rebindPad(d.id); break;
      case 'update': location.reload(); break;
    }
  }
  upgradeName(id) { return { vital: 'Conditioning', plates: 'Ceramic Plates', soles: 'Soft Soles', shadow: 'Shadow Discipline', hands: 'Quick Hands', mags: 'Extended Magazines', pouch: 'Ammo Pouches', steady: 'Steady Aim', rounds: 'Hollow Points', belt: 'Gadget Belt', grip: 'Close Quarters', ghost: 'Ghost Step', surge: 'Emergency Plates', focus: 'Tactical Focus', cdr: 'Field Discipline' }[id] || id; }
  watchEditor() {
    const iv = setInterval(() => {
      if (this.editor.active) return;
      clearInterval(iv);
      if (this.editorReturn === 'pause' && this.game) { this.openPause(); }
      else { document.getElementById('controls').classList.add('hidden'); this.showTitle(); }
    }, 150);
  }
  rebindKey(action) {
    const ov = this.ui.rebindPrompt('key');
    this.input.captureKey = (code) => {
      this.input.captureKey = null; ov.remove();
      if (code === 'Escape') return;
      const kb = { ...(this.settings.keybinds || {}) };
      kb[action] = [code];
      this.settings.keybinds = kb; Save.saveSettings(this.settings); this.input.refreshBindings(); this.ui.settings(this.settings);
    };
  }
  rebindPad(action) {
    const ov = this.ui.rebindPrompt('gamepad button');
    const start = performance.now();
    const prev = (navigator.getGamepads ? [...navigator.getGamepads()].find(p => p) : null)?.buttons.map(b => b.pressed) || [];
    const poll = () => {
      const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p) : null;
      if (gp) { const i = gp.buttons.findIndex((b, k) => b.pressed && !prev[k]); if (i >= 0) { ov.remove(); const pb = { ...(this.settings.padbinds || {}) }; pb[action] = i; this.settings.padbinds = pb; Save.saveSettings(this.settings); this.ui.settings(this.settings); return; } }
      if (performance.now() - start > 6000) { ov.remove(); this.ui.toast('No gamepad button pressed'); return; }
      requestAnimationFrame(poll);
    };
    this.input.captureKey = (code) => { if (code === 'Escape') { this.input.captureKey = null; ov.remove(); } };
    poll();
  }
  onSetting(k, v) {
    if (k === 'cones') v = v === 'auto' ? null : v === 'on';
    this.settings[k] = v;
    Save.saveSettings(this.settings);
    if (k === 'music' || k === 'sfx') this.audio.setVolumes(this.settings.music, this.settings.sfx);
    if (['uiScale', 'quality', 'joystickMode', 'contextualAttack', 'aimStick', 'leftHanded', 'zoom', 'controlScheme', 'allowPortrait'].includes(k)) { if (k === 'quality') this.lowQ = v === 'low'; this.resize(); }
    const out = document.querySelector(`[data-set="${k}"]`)?.closest('label')?.querySelector('output');
    if (out && typeof v === 'number') out.textContent = v < 1 && v > 0 || k === 'uiScale' || k === 'zoom' ? v.toFixed(2) : v;
  }
  finishOperation() {
    const run = this.game.run;
    run.hostagesTotal = Object.values(run.apts).reduce((a, r) => a + (r.stats.hostages || 0), 0);
    const rating = operationRating(run);
    const r = this.meta.records;
    r.completed++; r.hostagesSaved += run.hostagesSaved;
    let rec = false;
    if (r.bestScore == null || rating.score > r.bestScore) { r.bestScore = rating.score; r.bestGrade = rating.grade; rec = true; }
    if (r.fastest == null || run.time < r.fastest) { r.fastest = run.time; rec = true; }
    Save.saveMeta(this.meta);
    Save.clearRun();
    this.state = 'menu'; this.input.setEnabled(false);
    this.ui.operationComplete(run, rating, rec);
  }

  // ---------- events from the simulation ----------
  flushEvents() {
    const g = this.game;
    if (!g) return;
    const evs = g.drainEvents();
    if (g.tutorial) g.tutorial.onEvents(g, evs);
    const p = g.player;
    const near = (e, r = 14) => e.x == null || dist(e.x, e.y, p.x, p.y) < r;
    const vol = (e) => e.x == null ? 1 : Math.max(0.15, 1 - dist(e.x, e.y, p.x, p.y) / 22);
    for (const e of evs) {
      switch (e.t) {
        case 'shot': if (e.player) { this.audio.play('gun', { suppressed: e.suppressed }); if (!e.suppressed) this.shake = Math.max(this.shake, 0.25); this.haptic(e.suppressed ? 6 : 14); } else this.audio.play('enemygun', { vol: vol(e) }); break;
        case 'dryfire': this.audio.play('dry'); break;
        case 'reload': this.audio.play('reload'); break;
        case 'reload_done': this.audio.play('reloaded'); break;
        case 'step': this.audio.play('step', e); break;
        case 'door': if (near(e)) this.audio.play('door', e); break;
        case 'switch': this.audio.play('click'); break;
        case 'report_start': this.audio.play('radio'); this.haptic(40); this.ui.toast(e.camera ? 'Camera uplink started — 4.0 s to stop it!' : e.reason === 'body' ? 'A guard found a body and is radioing it in — 4.0 s!' : 'You were spotted! Guard radioing in — 4.0 s to stop the report', 'warn'); break;
        case 'report_done': this.audio.play('reportdone'); this.haptic(120); this.ui.toast('REPORT TRANSMITTED — nearby guards alerted; the next apartment you enter will be prepared', 'bad'); break;
        case 'report_interrupted': this.audio.play('interrupt'); this.ui.toast('Report interrupted', 'good'); break;
        case 'ledger': if (!g.run.tutorial) Save.writeLedger(g.run); break;
        case 'detected': this.audio.play('alert'); break;
        case 'hurt': this.audio.play('hurt'); this.haptic(30); this.shake = Math.max(this.shake, 0.4); break;
        case 'hit': this.audio.play('hit', e); break;
        case 'takedown_start': this.audio.play('slash'); break;
        case 'takedown': this.audio.play('takedown'); this.haptic(25); break;
        case 'slash': this.audio.play('slash'); break;
        case 'guard_down': break;
        case 'pickup': this.audio.play('pickup'); if (e.text) this.ui.toast(e.text, 'good'); else if (e.kind === 'intel') this.ui.toast('Intel recovered', 'good'); break;
        case 'weapon_found': this.audio.play('pickup'); this.ui.toast(`${WEAPONS[e.id].name} found — compare and press USE to take it`, 'good'); break;
        case 'hostage_freed': this.audio.play('freed'); this.ui.toast('Hostage freed — FOLLOW / WAIT / EVACUATE', 'good'); break;
        case 'hostage_saved': this.audio.play('saved'); this.ui.toast('Hostage evacuated', 'good'); break;
        case 'hostage_dead': this.audio.play('hurt'); this.ui.toast('A hostage was killed', 'bad'); break;
        case 'hostage_cmd': this.ui.toast(`${e.n} hostage${e.n > 1 ? 's' : ''}: ${e.order.toUpperCase()}`); break;
        case 'hostage_spotted': this.audio.play('suspicious'); break;
        case 'body_found': this.audio.play('suspicious'); break;
        case 'levelup': this.audio.play('levelup'); this.ui.toast(`LEVEL ${e.level} — new upgrades and equipment tiers unlocked`, 'big'); break;
        case 'apt_complete': this.audio.play('saved'); this.persist(); this.openDebrief(); break;
        case 'save': this.persist(); break;
        case 'prepared': this.audio.play('alert'); this.ui.toast(`Apartment ${e.label} is on HEIGHTENED ALERT — guards are watching the entrances`, 'bad'); break;
        case 'enter_apt': if (e.first && !g.run.tutorial && g.map.aptInfo[e.slot]) this.ui.toast(`Apartment ${g.map.aptInfo[e.slot].label} — ${g.map.aptInfo[e.slot].name}`); break;
        case 'stairs_menu': this.state = 'menu'; this.input.setEnabled(false); this.ui.stairs(g); break;
        case 'player_dead': this.input.setEnabled(false); setTimeout(() => { if (this.game === g) { this.state = 'menu'; this.ui.gameOver(!g.run.tutorial && !!Save.loadRun()?.run); } }, 1400); break;
        case 'msg': this.ui.toast(e.text, e.soft ? 'soft' : ''); break;
        case 'blinded': this.blindT = 1.2; break;
        case 'flashbang': this.audio.play('bang', { vol: vol(e) }); this.shake = Math.max(this.shake, 0.6); break;
        case 'smoke': this.audio.play('smoke'); break;
        case 'glass': this.audio.play('glass'); break;
        case 'throw': this.audio.play('throw'); break;
        case 'ability': this.audio.play('ability'); break;
        case 'hide': case 'unhide': this.audio.play('door', { quiet: true }); break;
        case 'camera_destroyed': this.audio.play('glass'); break;
        case 'floor': break;
      }
    }
  }

  // ---------- objectives ----------
  objectives() {
    const g = this.game, m = g.map, run = g.run, p = g.player;
    const out = [];
    let arrow = null;
    const slot = g.lastApt;
    const rec = g.aptRec(slot);
    if (rec && rec.status !== 'complete') {
      const hs = g.fs.hostages.filter(h => h.apt === slot);
      const remaining = hs.filter(h => h.state === 'restrained' || h.state === 'frightened');
      const free = hs.filter(h => h.state === 'free');
      const saved = hs.filter(h => h.state === 'evacuated').length;
      out.push({ text: `Rescue hostages: ${saved}/${hs.length} evacuated`, done: saved === hs.length });
      if (remaining.length) {
        out.push({ text: `Find & free ${remaining.length} hostage${remaining.length > 1 ? 's' : ''}${remaining.some(h => !h.known) ? ' (search the rooms)' : ''}` });
        const k = remaining.filter(h => h.known).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0];
        if (k && !free.length) arrow = { x: k.x, y: k.y, color: 'rgba(240,240,220,0.9)' };
      }
      if (free.length) { out.push({ text: `Evacuate ${free.length} freed hostage${free.length > 1 ? 's' : ''} to the fire escape` }); const ex = g.extractionFor(slot); arrow = { ...ex }; }
      if (!remaining.length && !free.length) { const ex = g.extractionFor(slot); out.push({ text: g.isSafe() ? 'Reach safety: extraction point or corridor' : 'Lose your pursuers, then reach safety' }); arrow = { ...ex }; }
      const intel = g.fs.items.find(i => i.kind === 'intel' && i.apt === slot);
      if (intel) out.push({ text: 'Recover intel (optional)', done: intel.taken, optional: true });
      const crates = g.fs.items.filter(i => i.kind === 'crate' && i.apt === slot);
      if (crates.length) out.push({ text: `Supply crates opened: ${crates.filter(c => c.opened).length}/${crates.length} (optional)`, optional: true, done: crates.every(c => c.opened) });
    } else if (m.floor >= 0) {
      const left = m.aptInfo.filter(a => run.apts[a.id].status !== 'complete');
      const total = Object.values(run.apts).filter(a => a.status === 'complete').length;
      out.push({ text: `Building secured: ${total}/9 apartments`, done: total === 9 });
      if (left.length) {
        out.push({ text: `Enter apartment ${left.map(a => a.label).join(', ')} on this floor` });
        // nearest front door
        let best = null, bd = 1e9;
        for (const a of left) { const d = m.doors.find(d => d.apt === a.slot && d.rooms.some(r => r >= 0 && m.rooms[r].type === 'corridor')); if (d) { const dd = dist(d.x, d.y, p.x, p.y); if (dd < bd) { bd = dd; best = { x: d.x + 0.5, y: d.y + 0.5, color: 'rgba(240,220,160,0.9)' }; } } }
        arrow = best;
      } else if (total < 9) { out.push({ text: 'Floor secured — take the stairwell to another floor' }); arrow = { x: 3, y: 2.5, color: 'rgba(240,220,160,0.9)' }; }
    }
    if (run.pendingPrepared && !run.tutorial) out.push({ text: 'A report got through: the next apartment you enter will be on heightened alert', optional: true });
    return { list: out, arrow };
  }

  // ---------- loop ----------
  buildCmd(raw) {
    const g = this.game;
    const cmd = { mx: 0, my: 0, ax: 0, ay: 0, aiming: false, aimPoint: null, fire: raw.fire, pressed: new Set(raw.pressed) };
    const mag = Math.min(1, Math.hypot(raw.mx, raw.my));
    if (mag > 0.01) { const w = screenDirToWorld(raw.mx, raw.my); cmd.mx = w.x * mag; cmd.my = w.y * mag; }
    if (raw.aiming && (raw.ax || raw.ay)) { const w = screenDirToWorld(raw.ax, raw.ay); cmd.ax = w.x; cmd.ay = w.y; cmd.aiming = true; }
    else if (raw.aimScreen) { const r = this.canvas.getBoundingClientRect(); cmd.aimPoint = this.renderer.cam.toWorld(raw.aimScreen.x - r.left, raw.aimScreen.y - r.top); }
    if (this.settings.contextualAttack) {
      if (raw.pressed.has('attack')) { if (g.takedownTarget) cmd.pressed.add('takedown'); else cmd.pressed.add('fire'); }
      if (raw.attack && !g.takedownTarget) cmd.fire = true;
    }
    return cmd;
  }
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) return;
    const g = this.game;
    this.blindT = Math.max(0, this.blindT - dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    if (g && this.state === 'playing' && !g.paused && !g.over) {
      const raw = this.input.poll();
      for (const a of raw.pressed) this.pendingPressed.add(a);
      raw.pressed = this.pendingPressed;
      const cmd = this.buildCmd(raw);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 8) {
        g.step(DT, cmd);
        cmd.pressed = new Set();
        this.pendingPressed = new Set();
        this.acc -= DT; steps++;
      }
      if (steps === 8) this.acc = 0;
      this.reportTicks(g);
    } else if (g && g.over && this.state === 'playing') {
      g.updateFx(dt);
    } else this.input.poll();
    if (g) this.flushEvents();
    if (g) {
      const obj = this.objectives();
      const o = this.orientation();
      const s = this.settings;
      const cones = s.cones == null ? g.diff.cones : s.cones;
      const hudTop = (document.querySelector('.hud-top')?.getBoundingClientRect().bottom) || 60;
      const hudH = Math.round(this.orientation() === 'portrait' ? hudTop : (document.querySelector('.vitals')?.getBoundingClientRect().bottom || 60));
      if (hudH !== this._hudH) { this._hudH = hudH; document.documentElement.style.setProperty('--hudH', hudH + 'px'); }
      const safe = this.safeRect();
      const cam = this.renderer.cam;
      this.renderer.render(g, dt, { zoom: this.zoom(), camOffY: o === 'portrait' ? -window.innerHeight * 0.1 : -window.innerHeight * 0.03, shake: (s.reducedShake ? 0.25 : 1) * this.shake, snap: this.snapCam, cones, noiseRings: s.noiseRings, objective: obj.arrow, safe, hudTop, hudBottom: o === 'portrait' ? window.innerHeight * 0.32 : window.innerHeight * 0.12, uiScale: s.uiScale, blindT: this.blindT });
      this.drawContextPrompt(g);
      this.snapCam = false;
      if (this.state === 'playing' || this.state === 'menu') {
        this.ui.updateHud(g, { objectives: obj.list });
        if (!this.editor.active) this.ui.updateControlsHud(g, this.input.els, s);
      }
      this.audio.setMode(this.state === 'playing' || (this.state === 'menu' && !g.over) ? 'game' : 'menu');
      const al = g.alertLevel();
      const nearG = g.fs.guards.filter(q => !q.down && dist(q.x, q.y, g.player.x, g.player.y) < 9).length;
      this.audio.update(dt, { calm: 0, suspicious: 1, searching: 2, combat: 3 }[al.level], nearG);
    } else {
      // title backdrop
      const ctx = this.renderer.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#08080a'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.audio.setMode('menu');
      this.audio.update(dt, 0, 0);
    }
    this.perfMonitor(dt);
  }
  drawContextPrompt(g) {
    const c = g.context;
    if (!c || this.state !== 'playing') return;
    const ctx = this.renderer.ctx, cam = this.renderer.cam, p = g.player;
    const sx = cam.sx_(p.x, p.y), sy = cam.sy_(p.x, p.y, 2.35);
    const ui = this.settings.uiScale;
    ctx.font = `600 ${Math.round(12 * ui)}px system-ui, sans-serif`;
    const text = c.label;
    const w = ctx.measureText(text).width + 22 * ui;
    ctx.fillStyle = 'rgba(12,12,10,0.78)'; ctx.strokeStyle = 'rgba(210,190,140,0.7)'; ctx.lineWidth = 1;
    const h = 22 * ui;
    roundRect(ctx, sx - w / 2, sy - h - 6, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#efe4c8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, sx, sy - h / 2 - 6);
  }
  reportTicks(g) {
    // audible tick each second of every active report
    for (const e of [...g.fs.guards, ...g.fs.cameras]) {
      if (e.reportT >= 0) { const s = Math.ceil(e.reportT); if (this.lastTick[e.id] !== s) { this.lastTick[e.id] = s; this.audio.play('tick', { last: s <= 1 }); } }
      else delete this.lastTick[e.id];
    }
  }
  perfMonitor(dt) {
    if (this.settings.quality !== 'auto' || this.lowQ) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes = [];
      if (avg > 0.024 && this.state === 'playing') { this.lowQ = true; this.resize(); }
    }
  }
  registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const onUpdate = (w) => {
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            this.updateReady = true;
            w.postMessage('skipWaiting');
            if (this.state === 'title') this.showTitle(); else this.ui.toast('An update is ready — it will load next time you return to the title screen.');
          }
        });
      };
      if (reg.installing) onUpdate(reg.installing);
      reg.addEventListener('updatefound', () => onUpdate(reg.installing));
      setInterval(() => reg.update().catch(() => { }), 30 * 60 * 1000);
    }).catch(() => { });
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller; // first install must not reload the page
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadController) return; if (this.state === 'title') { reloaded = true; location.reload(); } });
  }
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
try { window.__app = new App(); }
catch (e) { console.error(e); document.body.innerHTML = `<div style="color:#ddd;font:16px system-ui;padding:24px">Shadow Extraction could not start on this browser.<br><small>${String(e && e.message || e)}</small></div>`; }
