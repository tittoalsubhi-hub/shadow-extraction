// Core simulation. Deterministic fixed-step update; no DOM access.
import { clamp, dist, angDiff, turnToward, rayCircle, RNG } from './core-util.js';
import { buildFloor, buildTutorial, markersOf, cellFree, T, ROOM_LABEL } from './world-building.js';
import { moveCircle, castRay, lineOfSight, findPath, DOOR_CLOSED, DOOR_OPEN, DOOR_AJAR } from './world-grid.js';
import { WEAPONS, KNIFE, GADGETS, ABILITIES, ENEMY_TYPES, DIFFICULTY, REPORT_TIME, XP } from './game-data.js';
import { playerStats, addXp, upgradeOffers, applyUpgrade, aptRating, makeWeapon, reserveCap, magSize, newAptStats } from './game-run.js';
import { populateFloor, bumpIds, nextId } from './game-populate.js';
import { updateGuard, confirmPlayer, startSearch, enterCombat, hearNoise, startReport } from './ai-guard.js';
import { updateHostage } from './ai-hostage.js';
import { lightAt, cameraSees } from './ai-perception.js';

export const DT = 1 / 60;
const rnd = new RNG(98765);

export class Game {
  constructor(run, opts = {}) {
    this.run = run;
    this.opts = opts;
    this.diff = DIFFICULTY[run.difficulty];
    this.events = [];
    this.fx = { tracers: [], sparks: [], noises: [], decals: [], flashes: [], throws: [], popups: [] };
    this.time = 0;
    this.paused = false;
    this.over = null;
    this.context = null;
    this.takedownTarget = null;
    this.refreshStats();
    this.graceT = 0;
    this.lastApt = -1;
    this.discT = 0; this.complT = 0;
    this.smokes = [];
    this.lightsVersion = 1;
    this.tutorial = null;
  }
  refreshStats() { this.stats = playerStats(this.run); }
  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- floors ----------
  loadFloor(floorIdx, how = 'saved', opts = {}) {
    const run = this.run;
    this.map = floorIdx === -1 ? buildTutorial() : buildFloor(floorIdx);
    run.floor = floorIdx;
    let fs = run.floors[floorIdx];
    const entrySlot = how === 'start' ? this.map.aptInfo.findIndex(a => a.id === run.startApt) : -1;
    if (!fs) {
      fs = opts.populate ? opts.populate(this) : populateFloor(run, this.map, { entrySlot, startHere: how === 'start' });
      run.floors[floorIdx] = fs;
    }
    this.fs = fs;
    let maxId = 0;
    for (const list of [fs.guards, fs.hostages, fs.cameras, fs.items]) for (const e of list) maxId = Math.max(maxId, e.id);
    bumpIds(maxId);
    this.smokes = [];
    this.world = { map: this.map, doors: fs.doors, smokes: this.smokes };
    const N = this.map.w * this.map.h;
    this.disc = new Uint8Array(N);
    if (typeof fs.discovered === 'string') for (let i = 0; i < fs.discovered.length && i < N; i++) this.disc[i] = fs.discovered.charCodeAt(i) === 49 ? 1 : 0;
    fs.roomsSeen ||= [];
    const p = run.player;
    if (how === 'start') {
      const slot = Math.max(0, entrySlot);
      const e = markersOf(this.map, slot, 5)[0];
      p.x = e.x + 0.5; p.y = e.y + 0.5; p.facing = Math.PI / 2;
      this.graceT = 1.5;
    } else if (how === 'stairs') {
      p.x = 3.5; p.y = 2.5; p.facing = 0;
      this.graceT = 1.0;
    }
    this.resetTransient();
    // apply preparations that were recorded but not yet applied (e.g. restored from ledger)
    this.map.aptInfo.forEach((a, slot) => { const ap = run.apts[a.id]; if (ap && ap.prepared && !ap.preparedApplied) this.applyPrepared(slot); });
    this.lastApt = this.aptAtPlayer();
    if (this.lastApt >= 0) this.onEnterApt(this.lastApt);
    this.lightsVersion++;
    this.emit({ t: 'floor', floor: floorIdx });
  }
  resetTransient() {
    const p = this.player = this.run.player;
    Object.assign(p, { crouch: false, hidden: null, hideFrom: null, dragging: null, lock: null, reloadT: 0, fireCD: 0, bloom: 0, burstLeft: 0, burstT: 0, speedNow: 0, stepAcc: 0, ghostT: 0, focusT: 0, dead: false, hurtT: 0, takedownMode: p.takedownMode || 'lethal', aimAng: p.facing || 0, walkPhase: 0, fireFlash: 0, abilityActiveT: 0 });
    p.abilityCd ||= {};
    for (const g of this.fs.guards) { if (g.carried) { g.carried = false; } g.held = false; }
  }
  serializeFloor() {
    const fs = this.fs;
    let s = '';
    for (let i = 0; i < this.disc.length; i++) s += this.disc[i] ? '1' : '0';
    fs.discovered = s;
    if (this.player.dragging != null) { const g = this.guardById(this.player.dragging); if (g) { g.carried = false; } this.player.dragging = null; }
  }
  snapshot() {
    this.serializeFloor();
    return JSON.parse(JSON.stringify(this.run));
  }

  aptAtPlayer() {
    const m = this.map, p = this.player;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return -1;
    const r = m.room[cy * m.w + cx];
    if (r >= 0) return m.rooms[r].apt;
    return this.lastApt; // doorway: keep previous
  }
  aptIdOf(slot) { return slot >= 0 && this.map.aptInfo[slot] ? this.map.aptInfo[slot].id : null; }
  aptRec(slot) { const id = this.aptIdOf(slot); return id ? this.run.apts[id] : null; }
  extractionFor(slot) { const m = markersOf(this.map, slot, 6)[0]; return m ? { x: m.x + 0.5, y: m.y + 0.5 } : null; }
  guardById(id) { return this.fs.guards.find(g => g.id === id); }

  isSafe() { return !this.fs.guards.some(g => !g.down && (g.state === 'combat' || g.state === 'reporting')) && !this.fs.cameras.some(c => c.reportT >= 0); }
  alertLevel() {
    let lvl = 0, reporting = 0;
    for (const g of this.fs.guards) {
      if (g.down) continue;
      if (g.reportT >= 0) reporting++;
      const s = g.state === 'combat' || g.state === 'reporting' ? 3 : g.state === 'searching' ? 2 : (g.state === 'suspicious' || g.state === 'investigating') ? 1 : 0;
      lvl = Math.max(lvl, s);
    }
    for (const c of this.fs.cameras) if (c.reportT >= 0) reporting++;
    return { level: ['calm', 'suspicious', 'searching', 'combat'][lvl], reporting };
  }

  // ---------- main step ----------
  step(dt, cmd) {
    if (this.paused || this.over) return;
    this.time += dt;
    this.run.time += dt;
    if (this.graceT > 0) this.graceT -= dt;
    const slot = this.aptAtPlayer();
    if (slot !== this.lastApt) { if (slot >= 0) this.onEnterApt(slot); this.lastApt = slot; }
    const rec = this.aptRec(slot);
    if (rec && rec.status === 'active') rec.stats.time += dt;
    this.updatePlayer(dt, cmd || EMPTY_CMD);
    for (const g of this.fs.guards) if (!g.held) updateGuard(this, g, dt);
    for (const h of this.fs.hostages) updateHostage(this, h, dt);
    this.updateCameras(dt);
    this.updateThrows(dt);
    for (const s of this.smokes) s.t -= dt;
    for (let i = this.smokes.length - 1; i >= 0; i--) if (this.smokes[i].t <= 0) this.smokes.splice(i, 1);
    this.discT -= dt;
    if (this.discT <= 0) { this.discT = 0.25; this.updateDiscovery(); }
    this.complT -= dt;
    if (this.complT <= 0) { this.complT = 0.2; this.checkCompletion(); }
    this.updateFx(dt);
    if (this.tutorial) this.tutorial.update(this, dt);
  }

  // ---------- player ----------
  updatePlayer(dt, cmd) {
    const p = this.player, st = this.stats;
    if (p.dead) return;
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.fireFlash = Math.max(0, p.fireFlash - dt);
    p.ghostT = Math.max(0, p.ghostT - dt);
    p.focusT = Math.max(0, p.focusT - dt);
    for (const k in p.abilityCd) p.abilityCd[k] = Math.max(0, p.abilityCd[k] - dt);
    p.bloom = Math.max(0, p.bloom - dt * 0.35);
    p.fireCD = Math.max(0, p.fireCD - dt);
    const pr = cmd.pressed;
    // ability & gadgets usable in most states
    if (pr.has('abilityNext')) this.cycleAbility();
    if (pr.has('toggleTakedownMode')) { p.takedownMode = p.takedownMode === 'lethal' ? 'subdue' : 'lethal'; this.emit({ t: 'msg', text: p.takedownMode === 'lethal' ? 'Takedowns: LETHAL' : 'Takedowns: NON-LETHAL' }); }
    for (const o of ['follow', 'wait', 'evacuate']) if (pr.has(o)) this.commandHostages(o);
    // locked actions
    if (p.lock) {
      p.lock.t += dt; p.speedNow = 0;
      const L = p.lock;
      if (L.type === 'takedown') {
        const g = this.guardById(L.target);
        if (g) { g.facing = Math.atan2(g.y - p.y, g.x - p.x); }
        if (L.t >= L.dur) {
          p.lock = null;
          if (g) { g.held = false; if (L.mode === 'lethal') this.killGuard(g, 'knife'); else this.knockOut(g, 'choke'); this.emitNoise(p.x, p.y, L.mode === 'lethal' ? 1.6 : 1.1, 'takedown'); }
          this.emit({ t: 'takedown', mode: L.mode });
        }
      } else if (L.type === 'free') {
        const h = this.fs.hostages.find(h => h.id === L.target);
        if (L.t >= L.dur) { p.lock = null; if (h) this.freeHostage(h); }
      } else if (L.t >= L.dur) p.lock = null;
      return;
    }
    if (p.hidden != null) {
      p.speedNow = 0;
      if (pr.has('interact')) this.exitHide();
      if (pr.has('gadget0') || pr.has('gadget1')) this.emit({ t: 'msg', text: 'Leave the hiding place first.' });
      return;
    }
    if (pr.has('crouch')) p.crouch = !p.crouch;
    // movement
    let mx = cmd.mx || 0, my = cmd.my || 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    let speed = 0;
    if (mag > 0.05) {
      const running = mag > 0.88 && !p.crouch && p.dragging == null;
      speed = p.dragging != null ? 1.3 : p.crouch ? 1.65 * Math.min(1, mag / 0.8) : running ? 4.1 : 2.6 * Math.min(1, mag / 0.85);
      speed = Math.max(speed, 0.6);
      const nx = mx / mag, ny = my / mag;
      const ox = p.x, oy = p.y;
      moveCircle(this.world, p, nx * speed * dt, ny * speed * dt, 0.27);
      const moved = Math.hypot(p.x - ox, p.y - oy);
      p.speedNow = moved / dt;
      p.walkPhase += moved * 3.2;
      p.stepAcc += moved;
      if (!cmd.aiming && !cmd.aimPoint) p.facing = turnToward(p.facing, Math.atan2(ny, nx), 10 * dt);
      if (p.stepAcc > 0.85) { p.stepAcc = 0; this.footstep(); }
    } else p.speedNow = 0;
    // aim
    if (cmd.aiming && (cmd.ax || cmd.ay)) { p.aimAng = Math.atan2(cmd.ay, cmd.ax); p.facing = turnToward(p.facing, p.aimAng, 18 * dt); p.aiming = true; }
    else if (cmd.aimPoint) { p.aimAng = Math.atan2(cmd.aimPoint.y - p.y, cmd.aimPoint.x - p.x); p.facing = turnToward(p.facing, p.aimAng, 18 * dt); p.aiming = true; }
    else { p.aimAng = p.facing; p.aiming = false; }
    // drag body follows
    if (p.dragging != null) {
      const g = this.guardById(p.dragging);
      if (g) { g.x = p.x - Math.cos(p.facing) * 0.75; g.y = p.y - Math.sin(p.facing) * 0.75; if (!cellFree(this.map, Math.floor(g.x), Math.floor(g.y))) { g.x = p.x; g.y = p.y; } }
    }
    // reload
    const wslot = p.active === 'knife' ? null : p[p.active];
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0 && wslot) {
        const cap = magSize(this.run, wslot.id);
        const need = cap - wslot.mag;
        const take = Math.min(need, wslot.reserve);
        wslot.mag += take; wslot.reserve -= take;
        this.emit({ t: 'reload_done' });
      }
    }
    if (pr.has('reload')) this.startReload();
    if (pr.has('swap')) this.swapWeapon();
    // takedown target & context
    this.takedownTarget = this.findTakedownTarget();
    this.context = this.computeContext();
    if (pr.has('interact') && this.context) this.doInteract(this.context);
    if (pr.has('takedown')) {
      if (this.takedownTarget) this.beginTakedown(this.takedownTarget, p.takedownMode);
      else this.emit({ t: 'msg', text: 'Get behind an unaware guard to take them down.' });
    }
    if (pr.has('gadget0')) this.useGadget(0, cmd);
    if (pr.has('gadget1')) this.useGadget(1, cmd);
    if (pr.has('ability')) this.useAbility();
    // fire
    if (p.dragging == null && !p.lock) {
      if (p.active === 'knife') { if (pr.has('fire')) this.knifeAttack(); }
      else if (wslot) this.handleGun(dt, cmd, wslot);
    }
  }

  footstep() {
    const p = this.player, st = this.stats;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const surf = this.map.surface[cy * this.map.w + cx];
    const sp = p.speedNow;
    let r = p.crouch ? 0.9 : sp > 3.2 ? 4.6 : 2.2;
    r *= st.noiseMul * (p.ghostT > 0 ? 0.15 : 1);
    let kind = 'footstep';
    if (surf === 1) { r = Math.max(r, 3.6 * (p.crouch ? 0.6 : 1) * (p.ghostT > 0 ? 0.4 : 1)); kind = 'glass'; }
    else if (surf === 2) { r = Math.max(r, 3.0 * (p.crouch ? 0.6 : 1) * (p.ghostT > 0 ? 0.4 : 1)); kind = 'squeak'; }
    this.emit({ t: 'step', surface: surf, crouch: p.crouch, run: sp > 3.2, x: p.x, y: p.y });
    this.emitNoise(p.x, p.y, r, kind, 'player');
  }

  handleGun(dt, cmd, wslot) {
    const p = this.player, w = WEAPONS[wslot.id];
    if (p.burstLeft > 0) {
      p.burstT -= dt;
      if (p.burstT <= 0) { if (wslot.mag > 0) { this.shootOnce(wslot, w); p.burstLeft--; p.burstT = w.burstGap; } else p.burstLeft = 0; }
      return;
    }
    const want = w.mode === 'auto' ? cmd.fire : cmd.pressed.has('fire');
    if (!want || p.fireCD > 0 || p.reloadT > 0) { if (cmd.pressed.has('fire') && p.reloadT > 0) this.emit({ t: 'dryfire' }); return; }
    if (wslot.mag <= 0) {
      if (cmd.pressed.has('fire')) { this.emit({ t: 'dryfire' }); this.startReload(); }
      return;
    }
    if (w.mode === 'burst') { p.burstLeft = w.burst; p.burstT = 0; p.fireCD = w.rate + w.burst * w.burstGap; return; }
    this.shootOnce(wslot, w);
    p.fireCD = w.rate;
  }
  aimAssistAngle(range) {
    const p = this.player;
    const strength = this.opts.settings?.aimAssist === false ? 0 : this.diff.aimAssist;
    if (!strength || p.aiming && !this.opts.assistWithStick) return p.aimAng;
    const maxOff = 0.22 + 0.4 * strength;
    let best = null, bs = 1e9;
    for (const g of this.fs.guards) {
      if (g.down) continue;
      const d = dist(p.x, p.y, g.x, g.y);
      if (d > range * 1.6) continue;
      const a = Math.atan2(g.y - p.y, g.x - p.x);
      const off = Math.abs(angDiff(p.aimAng, a));
      if (off > maxOff) continue;
      if (!lineOfSight(this.world, p.x, p.y, g.x, g.y)) continue;
      const sc = off * 4 + d * 0.15;
      if (sc < bs) { bs = sc; best = a; }
    }
    for (const c of this.fs.cameras) {
      if (c.destroyed) continue;
      const d = dist(p.x, p.y, c.x, c.y); if (d > range * 1.6) continue;
      const a = Math.atan2(c.y - p.y, c.x - p.x); const off = Math.abs(angDiff(p.aimAng, a));
      if (off > maxOff * 0.6 || !lineOfSight(this.world, p.x, p.y, c.x, c.y)) continue;
      const sc = off * 4 + d * 0.15 + 0.5; if (sc < bs) { bs = sc; best = a; }
    }
    return best ?? p.aimAng;
  }
  shootOnce(wslot, w) {
    const p = this.player, st = this.stats;
    wslot.mag--;
    const base = this.aimAssistAngle(w.range);
    p.facing = base; p.aimAng = base;
    const moving = p.speedNow > 0.3;
    const spread = (w.spread + p.bloom) * st.spreadMul * (p.crouch ? 0.75 : 1) * (moving ? 1.3 : 1) * (p.focusT > 0 ? 0.35 : 1);
    const pellets = w.pellets || 1;
    let anyHit = false;
    for (let i = 0; i < pellets; i++) {
      const ang = base + (rnd.next() + rnd.next() - 1) * spread;
      const hit = this.fireRay(p, ang, { dmg: w.dmg * st.dmgMul, range: w.range, maxRange: w.maxRange || w.range * 2.2, effect: w.effect, pen: w.pen, fromPlayer: true, bolt: wslot.id === 'xbow', tranq: w.effect === 'tranq' });
      if (hit) anyHit = true;
    }
    p.bloom = Math.min(0.25, p.bloom + w.bloom);
    p.fireFlash = 0.07;
    this.run.shotsFired++;
    const rec = this.aptRec(this.lastApt); if (rec) { rec.stats.shots++; if (anyHit) rec.stats.hits++; }
    if (anyHit) this.run.shotsHit++;
    this.emit({ t: 'shot', weapon: wslot.id, suppressed: !!w.suppressed, x: p.x, y: p.y, player: true });
    this.emitNoise(p.x, p.y, w.noise, w.suppressed ? 'suppressed' : 'gunshot', 'player');
    if (wslot.mag === 0 && wslot.reserve > 0) this.emit({ t: 'msg', text: 'Magazine empty — reload', soft: true });
  }
  startReload() {
    const p = this.player;
    if (p.active === 'knife' || p.reloadT > 0) return;
    const ws = p[p.active]; if (!ws) return;
    if (ws.mag >= magSize(this.run, ws.id) || ws.reserve <= 0) { if (ws.reserve <= 0) this.emit({ t: 'msg', text: 'No reserve ammunition', soft: true }); return; }
    p.reloadT = WEAPONS[ws.id].reload * this.stats.reloadMul * (p.focusT > 0 ? 0.6 : 1);
    p.reloadTotal = p.reloadT;
    p.burstLeft = 0;
    this.emit({ t: 'reload' });
  }
  swapWeapon() {
    const p = this.player;
    const order = ['primary', 'sidearm', 'knife'].filter(s => s === 'knife' || p[s]);
    const i = order.indexOf(p.active);
    p.active = order[(i + 1) % order.length];
    p.reloadT = 0; p.burstLeft = 0; p.fireCD = 0.25 * (p.focusT > 0 ? 0.5 : 1);
    this.emit({ t: 'swap', active: p.active });
  }
  knifeAttack() {
    const p = this.player;
    if (p.fireCD > 0) return;
    p.fireCD = KNIFE.rate;
    if (this.takedownTarget) { this.beginTakedown(this.takedownTarget, 'lethal'); return; }
    this.emit({ t: 'slash' });
    p.lock = { type: 'slash', t: 0, dur: 0.25 };
    for (const g of this.fs.guards) {
      if (g.down) continue;
      const d = dist(p.x, p.y, g.x, g.y);
      if (d > KNIFE.range + 0.3) continue;
      if (Math.abs(angDiff(p.facing, Math.atan2(g.y - p.y, g.x - p.x))) > 0.9) continue;
      this.damageGuard(g, KNIFE.dmg * this.stats.dmgMul, { pen: 0.5, from: p });
      this.emitNoise(p.x, p.y, KNIFE.noise, 'takedown');
      break;
    }
  }

  findTakedownTarget() {
    const p = this.player;
    if (p.dragging != null || p.hidden != null) return null;
    let best = null, bd = 1e9;
    for (const g of this.fs.guards) {
      if (g.down || g.held) continue;
      const d = dist(p.x, p.y, g.x, g.y);
      if (d > this.stats.takedownRange) continue;
      const stunned = g.stunT > 0;
      const aware = g.state === 'combat' || g.state === 'reporting' || g.seePlayer;
      const behind = Math.abs(angDiff(g.facing, Math.atan2(p.y - g.y, p.x - g.x))) > 1.95;
      if (!stunned && (aware || !behind)) continue;
      if (!lineOfSight(this.world, p.x, p.y, g.x, g.y)) continue;
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
  beginTakedown(g, mode) {
    const p = this.player;
    p.lock = { type: 'takedown', t: 0, dur: mode === 'lethal' ? 0.55 : 1.3, target: g.id, mode };
    g.held = true; g.speed = 0; g.path = null;
    p.facing = Math.atan2(g.y - p.y, g.x - p.x);
    // move player snugly behind
    this.emit({ t: 'takedown_start', mode });
  }

  // ---------- context interactions ----------
  computeContext() {
    const p = this.player, m = this.map;
    if (p.hidden != null) return { kind: 'exit', label: 'Leave hiding place' };
    if (p.dragging != null) {
      const spot = this.nearHideSpot(true);
      if (spot) return { kind: 'stash', spot: spot.id, label: `Stash body ${SPOT_PREP[spot.kind]}` };
      return { kind: 'drop', label: 'Drop body' };
    }
    for (const h of this.fs.hostages) {
      if ((h.state === 'restrained' || h.state === 'frightened') && dist(p.x, p.y, h.x, h.y) < 1.35) return { kind: 'free', id: h.id, label: h.state === 'frightened' ? 'Calm & free hostage' : 'Cut hostage free' };
    }
    for (const it of this.fs.items) {
      if (it.apt !== -2 && dist(p.x, p.y, it.x, it.y) < 1.25) {
        if (it.kind === 'intel' && !it.taken) return { kind: 'intel', id: it.id, label: 'Collect intel' };
        if (it.kind === 'crate' && !it.opened) return { kind: 'crate', id: it.id, label: 'Open supply crate' };
        if (it.kind === 'crate' && it.opened && it.contents && it.contents.type === 'weapon') {
          const w = WEAPONS[it.contents.id];
          const cur = p[w.slot];
          return { kind: 'weapon', id: it.id, weapon: it.contents.id, replaces: cur?.id || null, label: cur ? `Swap ${WEAPONS[cur.id].short} for ${w.short}` : `Take ${w.name}` };
        }
        if (it.kind === 'crate' && it.opened && it.contents && it.contents.type === 'gadget') {
          return { kind: 'gadget', id: it.id, label: `Take ${GADGETS[it.contents.id].name} (replaces slot 2)` };
        }
      }
    }
    for (const g of this.fs.guards) {
      if (g.down && !g.carried && g.bodyHidden < 0 && dist(p.x, p.y, g.x, g.y) < 1.2) return { kind: 'drag', id: g.id, label: 'Drag body' };
    }
    const spot = this.nearHideSpot(false);
    if (spot) return { kind: 'hide', spot: spot.id, label: `Hide ${SPOT_PREP[spot.kind]}` };
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    // stairs
    if (m.stairs && p.x < m.stairs.x + m.stairs.w + 1.3 && p.y >= m.stairs.y - 0.3 && p.y <= m.stairs.y + m.stairs.d + 0.3) return { kind: 'stairs', label: 'Use stairwell' };
    // door in front / adjacent
    let bestDoor = null, bd = 1e9;
    for (const d of m.doors) {
      const dd = dist(p.x, p.y, d.x + 0.5, d.y + 0.5);
      if (dd > 1.3) continue;
      const facingBonus = Math.abs(angDiff(p.facing, Math.atan2(d.y + 0.5 - p.y, d.x + 0.5 - p.x))) * 0.3;
      if (dd + facingBonus < bd) { bd = dd + facingBonus; bestDoor = d; }
    }
    // light switch
    const sw = m.switches.find(s => Math.abs(s.x + 0.5 - p.x) < 0.75 && Math.abs(s.y + 0.5 - p.y) < 0.75);
    if (sw && (!bestDoor || bd > 0.9)) return { kind: 'switch', room: sw.room, label: this.fs.lights[sw.room] ? 'Switch lights off' : 'Switch lights on' };
    if (bestDoor) {
      const st = this.world.doors[bestDoor.id];
      const label = st === DOOR_OPEN ? 'Close door' : st === DOOR_AJAR ? 'Open door fully' : p.crouch ? 'Ease door ajar (peek)' : 'Open door';
      return { kind: 'door', id: bestDoor.id, label };
    }
    if (sw) return { kind: 'switch', room: sw.room, label: this.fs.lights[sw.room] ? 'Switch lights off' : 'Switch lights on' };
    return null;
  }
  nearHideSpot(forBody) {
    const p = this.player;
    let best = null, bd = 1e9;
    for (const s of this.map.hideSpots) {
      if (forBody && s.kind === 'door') continue;
      if (s.kind === 'door' && this.world.doors[s.door] !== DOOR_OPEN) continue;
      if (!forBody && this.fs.guards.some(g => g.bodyHidden === s.id)) continue;
      if (forBody && this.fs.guards.some(g => g.bodyHidden === s.id)) continue;
      for (const [ax, ay] of s.access) {
        const d = dist(p.x, p.y, ax + 0.5, ay + 0.5);
        if (d < 0.85 && d < bd) { bd = d; best = s; }
      }
      if (s.kind === 'door' && dist(p.x, p.y, s.x, s.y) < 0.8) { best = s; bd = 0; }
    }
    return best;
  }
  doInteract(c) {
    const p = this.player, fs = this.fs;
    switch (c.kind) {
      case 'exit': this.exitHide(); break;
      case 'stash': case 'drop': {
        const g = this.guardById(p.dragging);
        p.dragging = null;
        if (g) {
          g.carried = false;
          if (c.kind === 'stash') { g.bodyHidden = c.spot; const s = this.map.hideSpots[c.spot]; g.x = s.x; g.y = s.y; this.emit({ t: 'msg', text: 'Body concealed.' }); }
          else this.emitNoise(g.x, g.y, 1.6, 'body');
        }
        break;
      }
      case 'free': {
        const h = fs.hostages.find(h => h.id === c.id);
        p.lock = { type: 'free', t: 0, dur: h.state === 'frightened' ? 1.4 : 1.0, target: h.id };
        this.emit({ t: 'freeing' });
        break;
      }
      case 'intel': {
        const it = fs.items.find(i => i.id === c.id); it.taken = true;
        this.run.intel++; const rec = this.aptRec(it.apt); if (rec) rec.stats.intel = true;
        this.giveXp(XP.intel, 'Intel recovered');
        this.emit({ t: 'pickup', kind: 'intel' });
        break;
      }
      case 'crate': this.openCrate(fs.items.find(i => i.id === c.id)); break;
      case 'weapon': this.takeWeapon(fs.items.find(i => i.id === c.id)); break;
      case 'gadget': {
        const it = fs.items.find(i => i.id === c.id);
        const old = p.gadgets[1];
        p.gadgets[1] = { id: it.contents.id, count: Math.min(this.stats.gadgetCap, it.contents.count) };
        if (old && old.id && old.count > 0) it.contents = { type: 'gadget', id: old.id, count: old.count };
        else it.contents = null;
        this.emit({ t: 'pickup', kind: 'gadget' });
        break;
      }
      case 'drag': {
        const g = this.guardById(c.id);
        p.dragging = g.id; g.carried = true; g.found = g.found || false;
        this.emit({ t: 'msg', text: 'Dragging body — find a wardrobe, tub or desk to stash it.', soft: true });
        break;
      }
      case 'hide': this.enterHide(this.map.hideSpots[c.spot]); break;
      case 'switch': {
        fs.lights[c.room] = fs.lights[c.room] ? 0 : 1;
        this.lightsVersion++;
        const sw = this.map.switches[this.map.rooms[c.room].switchIdx];
        this.emit({ t: 'switch', on: !!fs.lights[c.room] });
        this.emitNoise(sw.x + 0.5, sw.y + 0.5, 2.5, 'light');
        for (const g of fs.guards) if (!g.down && this.map.room[Math.floor(g.y) * this.map.w + Math.floor(g.x)] === c.room && g.state !== 'combat') { g.susp = Math.max(g.susp, 0.45); g.target = { x: sw.x + 0.5, y: sw.y + 0.5 }; if (g.state === 'idle' || g.state === 'patrol') { g.state = 'suspicious'; g.idleT = 0; g.path = null; } }
        break;
      }
      case 'door': {
        const st = this.world.doors[c.id];
        const d = this.map.doors[c.id];
        if (st === DOOR_OPEN) {
          // don't close on someone
          const occ = [p, ...fs.guards.filter(g => !g.down), ...fs.hostages].some(e => Math.floor(e.x) === d.x && Math.floor(e.y) === d.y);
          if (occ || (Math.floor(p.x) === d.x && Math.floor(p.y) === d.y)) { this.emit({ t: 'msg', text: 'Doorway is blocked.', soft: true }); break; }
          this.world.doors[c.id] = DOOR_CLOSED;
          this.emit({ t: 'door', open: false });
          this.emitNoise(d.x + 0.5, d.y + 0.5, p.crouch ? 1.2 : 2.6, 'door');
        } else if (st === DOOR_CLOSED && p.crouch) {
          this.world.doors[c.id] = DOOR_AJAR;
          this.emit({ t: 'door', open: true, quiet: true });
          this.emitNoise(d.x + 0.5, d.y + 0.5, 0.8, 'door');
        } else {
          this.world.doors[c.id] = DOOR_OPEN;
          this.emit({ t: 'door', open: true, quiet: p.crouch });
          this.emitNoise(d.x + 0.5, d.y + 0.5, p.crouch ? 1.0 : 3.2, 'door');
        }
        break;
      }
      case 'stairs': this.emit({ t: 'stairs_menu' }); break;
    }
  }
  enterHide(s) {
    const p = this.player;
    p.hideFrom = [p.x, p.y];
    // any guard currently seeing the player remembers this spot
    for (const g of this.fs.guards) {
      if (g.down) continue;
      if (g.seePlayer || g.state === 'combat' || (g.state === 'reporting' && lineOfSight(this.world, g.x, g.y, p.x, p.y))) {
        if (g.seePlayer || dist(g.x, g.y, p.x, p.y) < 8) {
          g.knownSpot = s.id;
          if (g.state === 'combat' || g.state === 'reporting' || g.state === 'searching') g.lastKnown = { x: s.x, y: s.y };
        }
      }
    }
    p.hidden = s.id; p.crouch = false; p.reloadT = 0;
    p.lock = { type: 'hide', t: 0, dur: 0.3 };
    this.emit({ t: 'hide', kind: s.kind });
  }
  exitHide() {
    const p = this.player;
    const s = this.map.hideSpots[p.hidden];
    p.hidden = null;
    let best = p.hideFrom, bd = 1e9;
    if (s) for (const [ax, ay] of s.access) { const d = p.hideFrom ? dist(ax + 0.5, ay + 0.5, p.hideFrom[0], p.hideFrom[1]) : 0; if (d < bd) { bd = d; best = [ax + 0.5, ay + 0.5]; } }
    if (best) { p.x = best[0]; p.y = best[1]; }
    p.lock = { type: 'hide', t: 0, dur: 0.25 };
    this.emit({ t: 'unhide' });
  }
  inspectHideSpot(g, id) {
    const p = this.player;
    const s = this.map.hideSpots[id];
    this.emit({ t: 'spot_checked', x: s.x, y: s.y });
    if (p.hidden === id) {
      p.hidden = null;
      const a = s.access[0];
      p.x = a[0] + 0.5; p.y = a[1] + 0.5;
      this.emit({ t: 'msg', text: 'Discovered in your hiding place!' });
      g.facing = Math.atan2(p.y - g.y, p.x - g.x);
      confirmPlayer(this, g);
      return;
    }
    const body = this.fs.guards.find(o => o.bodyHidden === id && !o.found);
    if (body) {
      body.found = true; body.bodyHidden = -1;
      body.x = s.access[0][0] + 0.5; body.y = s.access[0][1] + 0.5;
      this.emit({ t: 'body_found', id: g.id, x: body.x, y: body.y });
      if (!g.reported && g.reportT < 0) startReport(this, g, 'body');
    }
  }
  openCrate(it) {
    const p = this.player;
    it.opened = true;
    const c = it.contents;
    this.giveXp(XP.supply);
    if (c.type === 'ammo') {
      for (const s of ['primary', 'sidearm']) if (p[s]) { const cap = reserveCap(this.run, p[s].id); p[s].reserve = Math.min(cap, p[s].reserve + Math.ceil(WEAPONS[p[s].id].reserve * c.amount)); }
      it.contents = null;
      this.emit({ t: 'pickup', kind: 'ammo', text: 'Ammunition resupplied' });
    } else if (c.type === 'gadget') {
      const cap = this.stats.gadgetCap;
      let slot = p.gadgets.findIndex(g => g.id === c.id && g.count < cap);
      if (slot < 0) slot = p.gadgets.findIndex(g => !g.id || g.count <= 0);
      if (slot >= 0) {
        const cur = p.gadgets[slot];
        const before = cur.id === c.id ? cur.count : 0;
        p.gadgets[slot] = { id: c.id, count: Math.min(cap, before + c.count) };
        it.contents = null;
        this.emit({ t: 'pickup', kind: 'gadget', text: `${GADGETS[c.id].name} ×${c.count}` });
      } else this.emit({ t: 'pickup', kind: 'gadget', text: `${GADGETS[c.id].name} found — both gadget slots full` });
    } else if (c.type === 'weapon') {
      if (!this.run.player.discoveredWeapons.includes(c.id)) this.run.player.discoveredWeapons.push(c.id);
      this.emit({ t: 'weapon_found', id: c.id });
    }
  }
  takeWeapon(it) {
    const p = this.player;
    const id = it.contents.id, w = WEAPONS[id];
    const old = p[w.slot];
    const fresh = it.contents.state || makeWeapon(id, this.diff.ammo, this.stats.reserveMul, this.stats.magMul);
    p[w.slot] = fresh;
    if (old) it.contents = { type: 'weapon', id: old.id, state: old }; else it.contents = null;
    p.active = w.slot; p.reloadT = 0;
    if (!this.run.player.discoveredWeapons.includes(id)) this.run.player.discoveredWeapons.push(id);
    this.emit({ t: 'pickup', kind: 'weapon', text: `${w.name} equipped` });
  }

  // ---------- gadgets & abilities ----------
  useGadget(i, cmd) {
    const p = this.player;
    const g = p.gadgets[i];
    if (!g || !g.id || g.count <= 0) { this.emit({ t: 'msg', text: 'Gadget slot empty', soft: true }); return; }
    const def = GADGETS[g.id];
    if (g.id === 'medkit') {
      if (p.hp >= this.stats.maxHp) { this.emit({ t: 'msg', text: 'Health is full', soft: true }); return; }
      p.hp = Math.min(this.stats.maxHp, p.hp + def.heal);
    } else if (g.id === 'armorkit') {
      if (p.armor >= this.stats.maxArmor) { this.emit({ t: 'msg', text: 'Armor is full', soft: true }); return; }
      p.armor = Math.min(this.stats.maxArmor, p.armor + def.armor);
    } else if (g.id === 'jammer') {
      let n = 0;
      for (const c of this.fs.cameras) if (!c.destroyed && dist(c.x, c.y, p.x, p.y) < def.radius) { c.disabledT = def.duration; if (c.reportT >= 0) { c.reportT = -1; this.emit({ t: 'report_interrupted', camera: true }); } c.susp = 0; n++; }
      this.emit({ t: 'msg', text: n ? `Jammed ${n} camera${n > 1 ? 's' : ''} for ${def.duration} s` : 'Jammer pulse: no cameras in range' });
    } else if (def.throw) {
      const range = 7;
      let tx, ty;
      if (cmd.aimPoint && dist(p.x, p.y, cmd.aimPoint.x, cmd.aimPoint.y) <= range) { tx = cmd.aimPoint.x; ty = cmd.aimPoint.y; }
      else { const a = p.aimAng; const hit = castRay(this.world, p.x, p.y, a, range); const d = Math.max(0.5, hit.d - 0.4); tx = p.x + Math.cos(a) * d; ty = p.y + Math.sin(a) * d; }
      // clamp to visible line
      const a = Math.atan2(ty - p.y, tx - p.x); const dd = dist(p.x, p.y, tx, ty); const hit = castRay(this.world, p.x, p.y, a, dd);
      if (hit.d < dd) { tx = p.x + Math.cos(a) * Math.max(0.3, hit.d - 0.35); ty = p.y + Math.sin(a) * Math.max(0.3, hit.d - 0.35); }
      this.fx.throws.push({ kind: g.id, x0: p.x, y0: p.y, x: tx, y: ty, t: 0, dur: 0.35 + dd * 0.05, fuse: g.id === 'flash' ? 0.9 : 0 });
      this.emit({ t: 'throw', kind: g.id });
    }
    g.count--;
    this.emit({ t: 'gadget', id: g.id });
  }
  updateThrows(dt) {
    for (let i = this.fx.throws.length - 1; i >= 0; i--) {
      const th = this.fx.throws[i];
      th.t += dt;
      if (th.t < th.dur + th.fuse) continue;
      this.fx.throws.splice(i, 1);
      const def = GADGETS[th.kind];
      if (th.kind === 'smoke') { this.smokes.push({ x: th.x, y: th.y, r: def.radius, t: def.duration, max: def.duration }); this.emit({ t: 'smoke', x: th.x, y: th.y }); }
      else if (th.kind === 'decoy') { this.emitNoise(th.x, th.y, def.noise, 'decoy'); this.emit({ t: 'glass', x: th.x, y: th.y }); this.fx.decals.push({ kind: 'glass', x: th.x, y: th.y, t: 0 }); }
      else if (th.kind === 'flash') {
        this.fx.flashes.push({ x: th.x, y: th.y, t: 0 });
        this.emit({ t: 'flashbang', x: th.x, y: th.y });
        for (const g of this.fs.guards) {
          if (g.down) continue;
          if (dist(g.x, g.y, th.x, th.y) < def.radius && lineOfSight(this.world, th.x, th.y, g.x, g.y)) { g.stunT = def.stun; g.susp = Math.max(g.susp, 0.85); g.target = { x: th.x, y: th.y }; g.speed = 0; }
        }
        const p = this.player;
        if (p.hidden == null && dist(p.x, p.y, th.x, th.y) < 3.5 && lineOfSight(this.world, th.x, th.y, p.x, p.y)) this.emit({ t: 'blinded' });
        this.emitNoise(th.x, th.y, def.noise, 'bang');
      }
    }
  }
  cycleAbility() {
    const list = this.stats.abilities;
    if (!list.length) return;
    const p = this.player;
    const i = list.indexOf(p.ability);
    p.ability = list[(i + 1) % list.length];
    this.emit({ t: 'msg', text: `Ability: ${ABILITIES[p.ability].name}`, soft: true });
  }
  useAbility() {
    const p = this.player;
    if (!p.ability || !this.stats.abilities.includes(p.ability)) { this.emit({ t: 'msg', text: 'No ability unlocked yet — choose one as an upgrade.', soft: true }); return; }
    const a = ABILITIES[p.ability];
    if ((p.abilityCd[p.ability] || 0) > 0) { this.emit({ t: 'msg', text: `${a.name} recharging (${Math.ceil(p.abilityCd[p.ability])} s)`, soft: true }); return; }
    p.abilityCd[p.ability] = a.cooldown * this.stats.cdMul;
    if (p.ability === 'ghost') p.ghostT = a.duration;
    else if (p.ability === 'focus') p.focusT = a.duration;
    else if (p.ability === 'surge') p.armor = Math.min(this.stats.maxArmor, p.armor + 50);
    this.emit({ t: 'ability', id: p.ability });
  }

  // ---------- hostages ----------
  freeHostage(h) {
    h.state = 'free'; h.order = 'follow'; h.known = true;
    this.giveXp(XP.hostageFreed, 'Hostage freed');
    this.emit({ t: 'hostage_freed', id: h.id });
  }
  hostageGroup() {
    const p = this.player;
    return this.fs.hostages.filter(h => h.state === 'free' && (dist(h.x, h.y, p.x, p.y) < 10 || h.apt === this.lastApt));
  }
  commandHostages(order) {
    const list = this.hostageGroup();
    if (!list.length) { this.emit({ t: 'msg', text: 'No freed hostages nearby', soft: true }); return; }
    for (const h of list) { h.order = order; h.path = null; h.pathGoal = null; h.cover = null; h.repathT = 0; }
    this.emit({ t: 'hostage_cmd', order, n: list.length });
  }
  hostageEvacuated(h) {
    h.state = 'evacuated'; h.path = null;
    const rec = this.aptRec(h.apt);
    if (rec) rec.stats.hostagesSaved++;
    this.run.hostagesSaved++;
    this.giveXp(XP.hostageSaved, 'Hostage evacuated');
    this.emit({ t: 'hostage_saved', id: h.id });
  }
  damageHostage(h, dmg) {
    if (h.state === 'dead' || h.state === 'evacuated') return;
    h.hp -= dmg; h.hurtT = 0.3;
    if (h.hp <= 0) {
      h.state = 'dead';
      const rec = this.aptRec(h.apt); if (rec) rec.stats.hostagesLost++;
      this.run.hostagesLost++;
      this.emit({ t: 'hostage_dead', id: h.id });
      this.fx.decals.push({ kind: 'blood', x: h.x, y: h.y, t: 0, s: rnd.next() });
    }
  }

  // ---------- combat ----------
  fireRay(shooter, ang, o) {
    const fromPlayer = !!o.fromPlayer;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const ox = shooter.x + dx * 0.3, oy = shooter.y + dy * 0.3;
    const wall = castRay(this.world, ox, oy, ang, o.maxRange, { bullet: true });
    let best = wall.d, hit = null, hitKind = null;
    const test = (e, r, kind) => { const t = rayCircle(ox, oy, dx, dy, e.x, e.y, r); if (t >= 0 && t < best) { best = t; hit = e; hitKind = kind; } };
    if (fromPlayer) {
      for (const g of this.fs.guards) if (!g.down) test(g, 0.34, 'guard');
      for (const c of this.fs.cameras) if (!c.destroyed) test(c, 0.24, 'camera');
    } else {
      const p = this.player;
      if (p.hidden == null && !p.dead) {
        if (!(p.crouch && !lineOfSight(this.world, ox, oy, p.x, p.y, { lowBlocksNearTarget: true }))) test(p, 0.3, 'player');
      }
    }
    for (const h of this.fs.hostages) if (h.state !== 'dead' && h.state !== 'evacuated') test(h, h.crouch || h.state !== 'free' ? 0.24 : 0.3, 'hostage');
    if (!fromPlayer && hitKind === 'hostage' && rnd.next() < 0.75) { hit = null; hitKind = null; best = wall.d; } // guards avoid hostages
    const ex = ox + dx * best, ey = oy + dy * best;
    this.fx.tracers.push({ x0: ox, y0: oy, x1: ex, y1: ey, t: 0, bolt: o.bolt, tranq: o.tranq, enemy: !fromPlayer });
    if (!hit) {
      if (best < o.maxRange) { this.fx.sparks.push({ x: ex, y: ey, t: 0 }); this.fx.decals.push({ kind: 'hole', x: ex, y: ey, t: 0, cx: wall.cx, cy: wall.cy }); if (fromPlayer) this.emitNoise(ex, ey, 2.4, 'impact'); }
      return false;
    }
    const falloff = best > o.range ? Math.max(0.35, 1 - (best - o.range) / o.range) : 1;
    const dmg = o.dmg * falloff;
    if (hitKind === 'guard') this.damageGuard(hit, dmg, { pen: o.pen, effect: o.effect, from: shooter });
    else if (hitKind === 'camera') { hit.destroyed = true; hit.reportT = -1; this.emit({ t: 'camera_destroyed' }); this.emitNoise(hit.x, hit.y, 4, 'glass'); this.fx.sparks.push({ x: hit.x, y: hit.y, t: 0 }); }
    else if (hitKind === 'player') this.damagePlayer(dmg, shooter);
    else if (hitKind === 'hostage') this.damageHostage(hit, o.effect ? 0 : dmg);
    return hitKind === 'guard' || hitKind === 'camera';
  }
  enemyFire(g, w) {
    const p = this.player;
    const base = Math.atan2(p.y - g.y, p.x - g.x);
    const d = dist(g.x, g.y, p.x, p.y);
    const mov = p.speedNow > 2.5 ? 1.35 : p.speedNow > 0.3 ? 1.15 : 1;
    const spread = w.spread * mov * (p.crouch ? 1.1 : 1) * (d < 3 ? 0.8 : 1);
    for (let i = 0; i < (w.pellets || 1); i++) {
      const a = base + (rnd.next() + rnd.next() - 1) * spread;
      this.fireRay(g, a, { dmg: w.dmg * this.diff.damage, range: w.range, maxRange: w.range * 2, pen: 0 });
    }
    g.fireFlash = 0.07;
    this.emit({ t: 'shot', enemy: true, x: g.x, y: g.y });
    this.emitNoise(g.x, g.y, w.noise, 'gunshot', 'enemy');
  }
  damagePlayer(dmg, from) {
    const p = this.player;
    if (p.dead) return;
    const absorb = Math.min(p.armor, dmg * 0.65);
    p.armor -= absorb;
    p.hp -= dmg - absorb;
    p.hurtT = 0.25;
    this.emit({ t: 'hurt', amount: dmg, fx: from?.x, fy: from?.y });
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      if (p.dragging != null) { const g = this.guardById(p.dragging); if (g) g.carried = false; p.dragging = null; }
      this.over = 'dead';
      this.emit({ t: 'player_dead' });
    }
  }
  damageGuard(g, dmg, o = {}) {
    if (g.down) return;
    const from = o.from;
    if (o.effect === 'tranq') {
      const delay = g.type === 'armored' ? 2.2 : 1.5;
      g.tranqT = g.tranqT >= 0 ? Math.min(g.tranqT, delay) : delay;
      this.emit({ t: 'hit', kind: 'tranq', x: g.x, y: g.y });
    } else if (o.effect === 'stun') {
      this.emit({ t: 'hit', kind: 'stun', x: g.x, y: g.y });
      this.knockOut(g, 'stun');
      return;
    } else {
      const armorDmg = Math.min(g.armor, dmg * (1 - (o.pen || 0)) * 0.6);
      g.armor -= armorDmg;
      g.hp -= dmg - armorDmg;
      g.hurtT = 0.25;
      this.emit({ t: 'hit', kind: 'flesh', x: g.x, y: g.y, armor: armorDmg > 0 });
      if (g.hp <= 0) { this.killGuard(g, 'shot'); return; }
    }
    // a hit guard is alarmed
    if (from && g.state !== 'combat' && g.state !== 'reporting') {
      g.facing = Math.atan2(from.y - g.y, from.x - g.x);
      g.susp = 1;
      if (lineOfSight(this.world, g.x, g.y, from.x, from.y)) confirmPlayer(this, g);
      else { g.state = 'investigating'; g.target = { x: from.x, y: from.y }; g.urgent = true; g.path = null; g.lookT = 0; }
    }
  }
  neutralize(g) {
    if (g.reportT >= 0) { g.reportT = -1; this.emit({ t: 'report_interrupted', id: g.id }); }
    g.held = false; g.path = null; g.speed = 0; g.stunT = 0; g.tranqT = -1;
    if (this.player.lock && this.player.lock.target === g.id && this.player.lock.type === 'takedown') { /* finishing */ }
  }
  killGuard(g, how) {
    if (g.down) return;
    this.neutralize(g);
    g.down = 'dead'; g.hp = 0;
    this.run.kills++;
    const rec = this.aptRec(g.apt >= 0 ? g.apt : this.lastApt); if (rec) rec.stats.kills++;
    this.giveXp(XP.kill);
    if (how !== 'knife') this.emitNoise(g.x, g.y, 2.0, 'body');
    this.fx.decals.push({ kind: 'blood', x: g.x, y: g.y, t: 0, s: rnd.next() });
    this.emit({ t: 'guard_down', id: g.id, how, lethal: true });
  }
  knockOut(g, how) {
    if (g.down) return;
    this.neutralize(g);
    g.down = 'unconscious';
    this.run.subdues++;
    const rec = this.aptRec(g.apt >= 0 ? g.apt : this.lastApt); if (rec) rec.stats.subdues++;
    this.giveXp(XP.subdue);
    this.emitNoise(g.x, g.y, 1.2, 'body');
    this.emit({ t: 'guard_down', id: g.id, how, lethal: false });
  }

  // ---------- noise ----------
  emitNoise(x, y, r, kind, src) {
    if (r <= 0) return;
    this.fx.noises.push({ x, y, r, t: 0, kind });
    for (const g of this.fs.guards) {
      if (g.down || g.held) continue;
      const d = dist(g.x, g.y, x, y);
      if (d > r * 1.3 * (ENEMY_TYPES[g.type].hear)) continue;
      const clear = lineOfSight(this.world, x, y, g.x, g.y);
      const eff = r * (clear ? 1 : 0.55) * ENEMY_TYPES[g.type].hear * (g.prepared ? 1.15 : 1);
      if (d > eff) continue;
      if (src === 'enemy' && kind === 'gunshot') { // allies hearing gunfire move in
        if (g.state !== 'combat' && g.state !== 'reporting') { g.susp = Math.max(g.susp, 0.9); g.target = { x, y }; g.urgent = true; if (g.state !== 'searching') { g.state = 'investigating'; g.path = null; g.lookT = 0; } }
        continue;
      }
      hearNoise(this, g, { x, y, r, kind });
    }
  }
  openDoor(di, ent) {
    if (this.world.doors[di] === DOOR_OPEN) return;
    this.world.doors[di] = DOOR_OPEN;
    this.emit({ t: 'door', open: true, ai: true, x: this.map.doors[di].x, y: this.map.doors[di].y });
  }

  // ---------- reports & alerts ----------
  onDetected(g) {
    const rec = this.aptRec(g.apt >= 0 ? g.apt : this.lastApt);
    if (rec) rec.stats.detections++;
    this.emit({ t: 'detected', id: g.id });
  }
  onGuardSeesPlayer(g) { }
  reportComplete(src) {
    const run = this.run;
    run.reportsTransmitted++;
    const slot = src.apt >= 0 ? src.apt : this.lastApt;
    const rec = this.aptRec(slot);
    if (rec) rec.stats.reports++;
    if (!run.tutorial) { run.pendingPrepared = true; run.pendingFrom = this.aptIdOf(slot); }
    const lk = src.lastKnown || { x: this.player.x, y: this.player.y };
    for (const g of this.fs.guards) {
      if (g.down || g === src || g.state === 'combat' || g.state === 'reporting') continue;
      if (dist(g.x, g.y, src.x, src.y) > 18) continue;
      g.alertBoost = Math.max(g.alertBoost, 1.25);
      startSearch(this, g, lk.x, lk.y, true);
    }
    this.emit({ t: 'report_done', id: src.id, camera: src.kind === 'camera', x: src.x, y: src.y });
    this.emit({ t: 'ledger' });
  }
  onEnterApt(slot) {
    const rec = this.aptRec(slot);
    if (!rec) return;
    if (rec.status === 'untouched') rec.status = 'active';
    if (!rec.stats.entered) { rec.stats.entered = true; this.emit({ t: 'enter_apt', slot, first: true }); }
    else this.emit({ t: 'enter_apt', slot, first: false });
    const run = this.run;
    if (run.pendingPrepared && rec.status !== 'complete' && !rec.prepared && run.pendingFrom !== rec.id) {
      rec.prepared = true;
      run.pendingPrepared = false;
      this.applyPrepared(slot);
      this.emit({ t: 'prepared', slot, label: rec.label });
      this.emit({ t: 'ledger' });
    }
  }
  applyPrepared(slot) {
    const rec = this.aptRec(slot);
    const m = this.map;
    const door = m.doors.find(d => d.apt === slot && d.rooms.some(r => r >= 0 && m.rooms[r].type === 'corridor'));
    let watcherSet = false;
    for (const g of this.fs.guards) {
      if (g.apt !== slot || g.down) continue;
      g.prepared = true;
      g.alertBoost = Math.max(g.alertBoost, 1.2);
      if (door && g.post) {
        g.post.facing = Math.atan2(door.y + 0.5 - g.post.y, door.x + 0.5 - g.post.x);
      } else if (door && !watcherSet && g.route) {
        // convert one patrol into an entrance watcher posted a few tiles inside, facing the door
        const inside = door.rooms.find(r => r >= 0 && m.rooms[r].apt === slot);
        const room = m.rooms[inside];
        let best = null, bs = -1;
        for (const [cx, cy] of room.cells) {
          if (!cellFree(m, cx, cy)) continue;
          const d = dist(cx + 0.5, cy + 0.5, door.x + 0.5, door.y + 0.5);
          if (d < 2.5 || d > 5) continue;
          const sc = 5 - Math.abs(d - 3.5);
          if (sc > bs) { bs = sc; best = [cx + 0.5, cy + 0.5]; }
        }
        if (best) {
          g.post = { x: best[0], y: best[1], facing: Math.atan2(door.y + 0.5 - best[1], door.x + 0.5 - best[0]) };
          g.route = null;
          if (g.state === 'patrol' || g.state === 'idle') { g.state = 'returning'; g.path = null; g.pathGoal = null; }
          watcherSet = true;
        }
      }
    }
    if (rec) rec.preparedApplied = true;
  }

  updateCameras(dt) {
    const p = this.player;
    for (const c of this.fs.cameras) {
      if (c.destroyed) continue;
      if (c.disabledT > 0) { c.disabledT -= dt; c.susp = 0; continue; }
      const see = p.hidden == null && !p.dead && cameraSees(this, c, p.x, p.y, p.crouch);
      if (see) {
        c.track = true;
        c.angle = turnToward(c.angle, Math.atan2(p.y - c.y, p.x - c.x), 2.5 * dt);
        c.susp = Math.min(1, c.susp + dt * 1.5 * Math.max(0.55, lightAt(this, p.x, p.y)) * this.diff.perception);
        c.lastKnown = { x: p.x, y: p.y };
        if (c.susp >= 1 && c.reportT < 0 && !c.reported) { c.reportT = REPORT_TIME; this.emit({ t: 'report_start', camera: true, id: c.id, x: c.x, y: c.y }); this.onDetected(c); }
      } else {
        c.track = false;
        c.susp = Math.max(0, c.susp - dt * 0.35);
        const target = c.base + Math.sin(((this.time + c.phase) / c.period) * Math.PI * 2) * c.sweep;
        c.angle = turnToward(c.angle, target, 0.8 * dt);
      }
      if (c.reportT >= 0) {
        c.reportT -= dt;
        if (c.reportT <= 0) { c.reportT = -1; c.reported = true; this.reportComplete(c); }
      }
    }
  }

  // ---------- discovery, completion ----------
  updateDiscovery() {
    const p = this.player, m = this.map;
    const R = 10;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const hit = castRay(this.world, p.x, p.y, a, R);
      for (let d = 0; d <= hit.d; d += 0.5) { const cx = Math.floor(p.x + Math.cos(a) * d), cy = Math.floor(p.y + Math.sin(a) * d); if (cx >= 0 && cy >= 0 && cx < m.w && cy < m.h) this.disc[cy * m.w + cx] = 1; }
      if (hit.cx >= 0) this.disc[hit.cy * m.w + hit.cx] = 1;
    }
    for (const h of this.fs.hostages) if (!h.known && dist(h.x, h.y, p.x, p.y) < R && lineOfSight(this.world, p.x, p.y, h.x, h.y)) { h.known = true; this.emit({ t: 'hostage_seen', id: h.id }); }
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const r = m.room[cy * m.w + cx];
    if (r >= 0 && !this.fs.roomsSeen.includes(r)) { this.fs.roomsSeen.push(r); if (m.rooms[r].apt >= 0) this.giveXp(XP.explore); }
  }
  checkCompletion() {
    if (this.run.pendingReward) return;
    const p = this.player;
    for (let slot = 0; slot < this.map.aptInfo.length; slot++) {
      const rec = this.aptRec(slot);
      if (!rec || rec.status !== 'active') continue;
      const hs = this.fs.hostages.filter(h => h.apt === slot);
      if (!hs.length || !hs.every(h => h.state === 'evacuated' || h.state === 'dead')) continue;
      const ex = this.extractionFor(slot);
      const atExit = ex && dist(p.x, p.y, ex.x, ex.y) < 2.6;
      const inCorr = this.aptAtPlayer() < 0;
      if (!(atExit || inCorr) || p.hidden != null) { rec.readyToFinish = true; continue; }
      if (!this.isSafe()) { rec.readyToFinish = true; continue; }
      this.completeApartment(slot);
      return;
    }
  }
  completeApartment(slot) {
    const rec = this.aptRec(slot);
    if (rec.status === 'complete') return;
    rec.status = 'complete';
    this.run.completed++;
    const st = rec.stats;
    const bonus = [];
    const add = (amt, label) => { if (amt) { bonus.push({ label, amt }); } };
    add(XP.aptComplete, 'Apartment secured');
    if (st.reports === 0) add(XP.noReport, 'No reports transmitted');
    if (st.detections === 0) add(XP.ghost, 'Never detected');
    if (st.kills === 0) add(XP.noKill, 'No lethal force');
    const total = bonus.reduce((a, b) => a + b.amt, 0);
    const lvlBefore = this.run.level;
    this.giveXp(total);
    const rating = aptRating(st);
    rec.rating = rating;
    const final = this.run.completed >= Object.keys(this.run.apts).length;
    const offers = upgradeOffers(this.run, rec.id, this.run.completed);
    this.run.pendingReward = { aptId: rec.id, offers, debrief: { label: rec.label, name: this.map.aptInfo[slot].name, stats: { ...st }, rating, bonus, levelUp: this.run.level > lvlBefore ? this.run.level : 0 } };
    if (final) this.run.finished = true;
    this.paused = true;
    this.emit({ t: 'apt_complete', slot, aptId: rec.id });
    this.emit({ t: 'save' });
  }
  chooseUpgrade(id) {
    const pr = this.run.pendingReward;
    if (!pr) return false;
    const rec = this.run.apts[pr.aptId];
    if (rec.rewardClaimed) { this.run.pendingReward = null; return false; }
    if (id && pr.offers.includes(id)) applyUpgrade(this.run, id);
    rec.rewardClaimed = true;
    this.run.pendingReward = null;
    this.refreshStats();
    this.paused = false;
    this.emit({ t: 'upgrade', id });
    this.emit({ t: 'save' });
    return true;
  }
  giveXp(amt, label) {
    const lv = addXp(this.run, amt);
    if (label) this.fx.popups.push({ text: `+${Math.round(amt)} XP · ${label}`, t: 0 });
    if (lv) { this.refreshStats(); this.emit({ t: 'levelup', level: lv }); }
  }
  takeStairs(floor) {
    if (floor === this.run.floor) return false;
    if (!this.isSafe()) { this.emit({ t: 'msg', text: 'Lose your pursuers before using the stairs.' }); return false; }
    this.serializeFloor();
    this.loadFloor(floor, 'stairs');
    this.emit({ t: 'save' });
    return true;
  }

  updateFx(dt) {
    const f = this.fx;
    for (const k of ['tracers', 'sparks', 'noises', 'flashes', 'popups']) {
      const arr = f[k]; const life = { tracers: 0.12, sparks: 0.3, noises: 0.7, flashes: 0.6, popups: 2.2 }[k];
      for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t > life) arr.splice(i, 1); }
    }
    if (f.decals.length > 160) f.decals.splice(0, f.decals.length - 160);
  }
}

const SPOT_PREP = { wardrobe: 'in wardrobe', desk: 'under desk', shower: 'behind shower curtain', door: 'behind door' };
export const EMPTY_CMD = { mx: 0, my: 0, ax: 0, ay: 0, aiming: false, aimPoint: null, fire: false, pressed: new Set() };
