// DOM UI: HUD, toasts and all menu screens (title, difficulty, pause, map, debrief, upgrades, settings, layout editor).
import { WEAPONS, GADGETS, ABILITIES, DIFFICULTY, DIFF_IDS, UPGRADE_BY_ID } from './game-data.js';
import { describeUpgrade, xpProgress, magSize, playerStats } from './game-run.js';
import { ROOM_LABEL, T, markersOf, buildFloor, campaignApartments } from './world-building.js';
import { FLOORS } from './world-layouts.js';
import { ACTION_LABELS, DEFAULT_KEYS, DEFAULT_PAD } from './input-input.js';
import { CONTROL_DEFS, CONTROL_IDS, defaultLayouts, mirrorLayout } from './input-layout.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(app) {
    this.app = app;
    this.hud = $('#hud'); this.screen = $('#screen'); this.toasts = $('#toasts');
    this.buildHud();
    this.cache = {};
    this.screen.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const a = b.dataset.act;
      this.app.audio.play(b.classList.contains('primary') ? 'uiConfirm' : ['back', 'resume', 'quit'].includes(a) ? 'uiBack' : 'ui');
      this.app.onUiAction(b.dataset.act, b.dataset);
    });
    this.screen.addEventListener('input', (e) => { const t = e.target; if (t.dataset.set) this.app.onSetting(t.dataset.set, t.type === 'checkbox' ? t.checked : t.type === 'range' ? parseFloat(t.value) : t.value); });
    this.screen.addEventListener('change', (e) => { const t = e.target; if (t.dataset.set && t.tagName === 'SELECT') this.app.onSetting(t.dataset.set, t.value); });
  }
  buildHud() {
    this.hud.innerHTML = `
      <div class="hud-top">
        <div class="vitals">
          <div class="bar hp"><i></i><b></b></div>
          <div class="bar ar"><i></i><b></b></div>
          <div class="xp"><span class="lvl"></span><div class="xpbar"><i></i></div></div>
          <div class="weapon" data-hud="swap" title="Tap to switch weapon"><span class="wname"></span><span class="ammo"></span><div class="rbar"><i></i></div></div>
          <div class="wrow"><button class="mini" data-hud="swap">⇆ SWAP</button><button class="mini" data-hud="reload">↻ RELOAD</button><button class="mini td" data-hud="toggleTakedownMode">LETHAL</button></div>
        </div>
        <div class="loc"><div class="where"></div><div class="alert"></div><div class="reports"></div></div>
        <div class="tools"><div class="zoom"><button class="zb" data-zoom="-1" aria-label="Zoom out">−</button><input type="range" class="zr" min="0.6" max="1.8" step="0.02" aria-label="Zoom"><button class="zb" data-zoom="1" aria-label="Zoom in">+</button></div><button class="hbtn" data-hud="map" aria-label="Floor map">MAP</button><button class="hbtn" data-hud="pause" aria-label="Pause">❚❚</button></div>
        <div class="objectives"></div>
      </div>
      <div class="tutorial hidden"></div>
      <div class="pickup hidden"></div>
      <div class="popups"></div>`;
    for (const b of this.hud.querySelectorAll('[data-hud]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.app.onAction(b.dataset.hud); });
    const zr = $('.zr', this.hud);
    this.zoomInput = zr;
    zr.addEventListener('pointerdown', (e) => e.stopPropagation());
    zr.addEventListener('input', () => this.app.setZoom(parseFloat(zr.value), false));
    zr.addEventListener('change', () => this.app.setZoom(parseFloat(zr.value), true));
    for (const b of this.hud.querySelectorAll('[data-zoom]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.app.setZoom((this.app.settings.zoom || 1) * (b.dataset.zoom > 0 ? 1.15 : 1 / 1.15), true); });
    this.objEl = $('.objectives', this.hud);
    this.objEl.classList.add('collapsed');
    this.objEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.objEl.classList.toggle('collapsed'); });
  }
  set(el, key, html) { if (this.cache[key] !== html) { this.cache[key] = html; el.innerHTML = html; } }
  setStyle(el, key, prop, v) { const k = key + prop; if (this.cache[k] !== v) { this.cache[k] = v; el.style[prop] = v; } }

  updateHud(game, extra) {
    const p = game.player, st = game.stats, run = game.run;
    const h = this.hud;
    this.setStyle($('.hp i', h), 'hp', 'width', `${Math.max(0, p.hp / st.maxHp * 100)}%`);
    this.set($('.hp b', h), 'hpt', `${Math.ceil(p.hp)} HP`);
    this.setStyle($('.ar i', h), 'ar', 'width', `${Math.max(0, p.armor / st.maxArmor * 100)}%`);
    this.set($('.ar b', h), 'art', `${Math.ceil(p.armor)} ARMOR`);
    const xp = xpProgress(run);
    this.set($('.lvl', h), 'lvl', `LV ${xp.level}`);
    this.setStyle($('.xpbar i', h), 'xp', 'width', `${Math.round(xp.frac * 100)}%`);
    // weapon
    const ws = p.active === 'knife' ? null : p[p.active];
    const wn = p.active === 'knife' ? 'Combat Knife' : ws ? WEAPONS[ws.id].name : '—';
    this.set($('.wname', h), 'wn', esc(wn));
    this.set($('.ammo', h), 'am', ws ? `<b>${ws.mag}</b>/${magSize(run, ws.id)} · ${ws.reserve}` : '∞');
    this.setStyle($('.rbar', h), 'rb', 'opacity', p.reloadT > 0 ? '1' : '0');
    if (p.reloadT > 0) $('.rbar i', h).style.width = `${(1 - p.reloadT / (p.reloadTotal || 1)) * 100}%`;
    // location
    const m = game.map;
    const slot = game.lastApt;
    let where;
    if (m.floor === -1) where = 'Training Flat';
    else {
      const fl = FLOORS[m.floor].name;
      if (slot >= 0) { const a = m.aptInfo[slot]; const rec = run.apts[a.id]; where = `${fl} · Apt ${a.label} <small>${esc(a.name)}</small>${rec.status === 'complete' ? ' <span class="ok">✓</span>' : ''}`; }
      else where = `${fl} · Corridor`;
    }
    const room = (() => { const cx = Math.floor(p.x), cy = Math.floor(p.y); const r = m.room[cy * m.w + cx]; return r >= 0 ? ROOM_LABEL[m.rooms[r].type] : ''; })();
    this.set($('.where', h), 'where', `${where}${room ? ` <em>${room}</em>` : ''}`);
    const al = game.alertLevel();
    const rec = game.aptRec(slot);
    const prep = rec && rec.prepared && rec.status !== 'complete';
    const icon = { calm: '●', suspicious: '?', searching: '◎', combat: '!' }[al.level];
    this.set($('.alert', h), 'alert', `<span class="chip a-${al.level}">${icon} ${al.level.toUpperCase()}</span>${prep ? '<span class="chip a-prep">⚠ PREPARED</span>' : ''}${run.pendingPrepared ? '<span class="chip a-pend" title="A transmitted report will put the next apartment you enter on heightened alert">⚠ NEXT APT ALERTED</span>' : ''}`);
    this.set($('.reports', h), 'rep', al.reporting ? `<span class="chip a-combat blink">📻 ${al.reporting} REPORT${al.reporting > 1 ? 'S' : ''} IN PROGRESS</span>` : '');
    // objectives
    this.set(this.objEl, 'obj', extra.objectives.map(o => `<div class="obj ${o.done ? 'done' : ''} ${o.optional ? 'opt' : ''}"><span>${o.done ? '✓' : o.optional ? '◇' : '▸'}</span>${esc(o.text)}</div>`).join(''));
    // tutorial
    const tut = $('.tutorial', h);
    if (game.tutorial) {
      const t = game.tutorial;
      tut.classList.remove('hidden');
      const step = t.step;
      this.set(tut, 'tut', step ? `<div class="tstep">Training ${t.i + 1}/${t.total} · <b>${esc(step.title)}</b></div><div>${esc(step.text)}</div>${t.reportNote ? `<div class="tnote">${esc(t.reportNote)}</div>` : ''}` : `<div class="tstep"><b>Training complete</b></div>`);
    } else tut.classList.add('hidden');
    // pickup comparison
    const pk = $('.pickup', h);
    const c = game.context;
    if (c && c.kind === 'weapon') {
      pk.classList.remove('hidden');
      this.set(pk, 'pk', weaponCompare(c.weapon, c.replaces, run));
    } else pk.classList.add('hidden');
    // popups
    const pop = $('.popups', h);
    const txt = game.fx.popups.slice(-3).map(q => `<div style="opacity:${Math.max(0, 1 - q.t / 2.2)}">${esc(q.text)}</div>`).join('');
    this.set(pop, 'pop', txt);
  }
  updateControlsHud(game, els, settings) {
    const p = game.player;
    for (let i = 0; i < 2; i++) {
      const g = p.gadgets[i];
      const el = els['gadget' + i];
      this.set($('.lbl', el), 'g' + i, g && g.id && g.count > 0 ? GADGETS[g.id].short : '—');
      this.set($('.sub', el), 'gs' + i, g && g.id && g.count > 0 ? `×${g.count}` : '');
      el.classList.toggle('empty', !(g && g.id && g.count > 0));
    }
    {
      const i = game.selectedGadget ? game.selectedGadget() : 0;
      const g = p.gadgets[i];
      const el = els.gadget;
      this.set($('.lbl', el), 'gsel', g && g.id && g.count > 0 ? GADGETS[g.id].short : 'ITEM');
      this.set($('.sub', el), 'gselc', g && g.id && g.count > 0 ? `×${g.count}` : 'empty');
      el.classList.toggle('empty', !(g && g.id && g.count > 0));
      const other = p.gadgets[1 - i];
      this.set($('.sub', els.gnext), 'gnx', other && other.id && other.count > 0 ? GADGETS[other.id].short : '');
    }
    const tdBtn = $('.mini.td', this.hud);
    if (tdBtn) { this.set(tdBtn, 'tdmini', p.takedownMode === 'lethal' ? '🗡 LETHAL' : '✋ NON-LETHAL'); tdBtn.classList.toggle('nl', p.takedownMode !== 'lethal'); }
    if (this.zoomInput && document.activeElement !== this.zoomInput) { const z = String(settings.zoom || 1); if (this.cache.zr !== z) { this.cache.zr = z; this.zoomInput.value = z; } }
    const ab = p.ability;
    const abEl = els.ability;
    this.set($('.lbl', abEl), 'ab', ab ? ABILITIES[ab].name.split(' ').map(w => w[0]).join('') + '' : 'ABIL');
    const cd = ab ? (p.abilityCd[ab] || 0) : 0;
    const total = ab ? ABILITIES[ab].cooldown * game.stats.cdMul : 1;
    const active = ab === 'ghost' ? p.ghostT : ab === 'focus' ? p.focusT : 0;
    this.set($('.sub', abEl), 'abs', !ab ? 'locked' : active > 0 ? `${active.toFixed(1)}s` : cd > 0 ? `${Math.ceil(cd)}s` : 'ready');
    this.setStyle($('.cd', abEl), 'abcd', 'background', cd > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${cd / total * 360}deg, transparent 0)` : 'none');
    abEl.classList.toggle('empty', !ab);
    abEl.classList.toggle('active', active > 0);
    abEl.classList.toggle('hidden', !ab && (settings.controlScheme || 'simple') === 'simple');
    this.set($('.lbl', els.tdmode), 'tdm', p.takedownMode === 'lethal' ? 'LTH' : 'NLT');
    els.tdmode.classList.toggle('nonlethal', p.takedownMode !== 'lethal');
    const tdOk = !!game.takedownTarget;
    els.takedown.classList.toggle('ready', tdOk);
    els.attack.classList.toggle('ready', tdOk);
    this.set($('.lbl', els.attack), 'atk', tdOk ? 'TAKE<br>DOWN' : 'ATTACK');
    const c = game.context;
    const verb = c ? ({ exit: 'LEAVE', stash: 'STASH', drop: 'DROP', free: 'FREE', intel: 'TAKE', crate: 'OPEN', weapon: 'SWAP', gadget: 'TAKE', drag: 'DRAG', hide: 'HIDE', switch: 'LIGHT', door: 'DOOR', stairs: 'STAIRS' }[c.kind] || 'USE') : 'USE';
    this.set($('.lbl', els.interact), 'iv', verb);
    els.interact.classList.toggle('ready', !!c);
    this.set($('.lbl', els.crouch), 'cr', p.crouch ? 'STAND' : 'CROUCH');
    els.crouch.classList.toggle('active', p.crouch);
    const ws = p.active === 'knife' ? null : p[p.active];
    this.set($('.sub', els.fire), 'fs', ws ? `${ws.mag}` : 'knife');
    this.set($('.sub', els.reload), 'rs', ws ? `${ws.reserve}` : '');
    const hasHostages = game.hostageGroup().length > 0;
    els.cmds.classList.toggle('hidden', !hasHostages);
    if (hasHostages) { const ord = game.hostageGroup()[0].order; for (const b of els.cmds.querySelectorAll('.chip')) b.classList.toggle('sel', b.dataset.a === ord); }
  }
  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), kind === 'big' ? 3200 : 2300);
    setTimeout(() => el.remove(), kind === 'big' ? 3800 : 2900);
  }
  show(html, cls = '') { this.screen.className = `screen ${cls}`; this.screen.innerHTML = html; this.screen.scrollTop = 0; }
  hide() { this.screen.className = 'screen hidden'; this.screen.innerHTML = ''; }
  get open() { return !this.screen.classList.contains('hidden'); }

  // ---------- screens ----------
  title({ hasSave, saveInfo, records, update }) {
    this.show(`
      <div class="title-wrap">
        <div class="logo"><div class="l1">SHADOW</div><div class="l2">EXTRACTION</div><div class="tag">Tactical hostage rescue · 3 floors · 9 apartments</div></div>
        <div class="menu">
          ${hasSave ? `<button data-act="continue" class="primary">Continue<small>${esc(saveInfo)}</small></button>` : ''}
          <button data-act="newrun" class="${hasSave ? '' : 'primary'}">New Run</button>
          ${hasSave ? `<button data-act="restart">Restart Run<small>Same building, same start, fresh operation</small></button>` : ''}
          <button data-act="tutorial">Tutorial</button>
          <button data-act="settings">Settings</button>
          <button data-act="layout">Edit Control Layout</button>
          <button data-act="records">Records</button>
        </div>
        ${update ? `<button class="update" data-act="update">Update available — tap to reload</button>` : ''}
        <div class="foot">Move: left stick / WASD · Interact: USE / E · Installable — works offline</div>
      </div>`, 'title');
  }
  records(meta) {
    const r = meta.records;
    this.show(`<div class="panel"><h2>Records</h2>
      <div class="grid2">
        <div>Operations started</div><div>${r.runs}</div>
        <div>Operations completed</div><div>${r.completed}</div>
        <div>Best rating</div><div>${r.bestGrade ? `${r.bestGrade} (${r.bestScore})` : '—'}</div>
        <div>Fastest completion</div><div>${r.fastest ? fmtTime(r.fastest) : '—'}</div>
        <div>Hostages rescued (all runs)</div><div>${r.hostagesSaved}</div>
        <div>Weapons discovered</div><div>${meta.discoveredWeapons.length} / ${Object.keys(WEAPONS).length}</div>
      </div>
      <p class="muted">Discovered sidearms can be chosen as your starting weapon. Run-specific levels and upgrades reset for each new operation.</p>
      <button data-act="back" class="primary">Back</button></div>`);
  }
  newRun(meta, sel) {
    const sidearms = ['p9', 'p9s', 'tranq'].filter(id => meta.discoveredWeapons.includes(id));
    this.show(`<div class="panel wide"><h2>New Operation</h2>
      <p class="muted">Choose a difficulty. The <b>4.0-second radio report</b> window is identical on every difficulty. A new run starts in a different apartment than last time.</p>
      <div class="diffs">${DIFF_IDS.map(id => { const d = DIFFICULTY[id]; return `<button class="diff ${sel.difficulty === id ? 'sel' : ''}" data-act="pickdiff" data-id="${id}"><b>${d.name}</b><ul>${d.desc.map(x => `<li>${esc(x)}</li>`).join('')}</ul></button>`; }).join('')}</div>
      <h3>Starting sidearm</h3>
      <div class="row wrap">${sidearms.map(id => `<button class="opt ${sel.sidearm === id ? 'sel' : ''}" data-act="picksidearm" data-id="${id}">${esc(WEAPONS[id].name)}</button>`).join('')}</div>
      ${sidearms.length < 3 ? `<p class="muted small">Find more sidearms during operations to unlock them here.</p>` : ''}
      <div class="row"><button data-act="back">Back</button><button class="primary" data-act="startrun">Start Operation</button></div></div>`);
  }
  pause(game) {
    const tut = !!game.tutorial;
    this.show(`<div class="panel"><h2>Paused</h2>
      <div class="menu">
        <button class="primary" data-act="resume">Resume</button>
        <button data-act="map">Floor Map</button>
        <button data-act="settings">Settings</button>
        <button data-act="layout">Edit Control Layout</button>
        ${tut ? '' : '<button data-act="restart">Restart Run</button>'}
        <button data-act="quit">${tut ? 'Leave Tutorial' : 'Quit to Title'}</button>
      </div>
      <p class="muted small">${tut ? '' : 'Progress is saved automatically at safe points: after each secured apartment and when using the stairwell. Transmitted reports are recorded immediately.'}</p></div>`);
  }
  stairs(game) {
    const cur = game.run.floor;
    this.show(`<div class="panel"><h2>Stairwell</h2><p class="muted">Choose a floor. The stairs are a safe transition — your progress will be saved.</p>
      <div class="menu">${FLOORS.map((f, i) => { const done = f.apts.every(id => game.run.apts[id].status === 'complete'); return `<button data-act="gofloor" data-id="${i}" ${i === cur ? 'disabled' : ''}>${f.name}${i === cur ? ' (here)' : ''}<small>${f.apts.map((id, s) => `${i + 1}${'ABC'[s]}${game.run.apts[id].status === 'complete' ? '✓' : game.run.apts[id].prepared ? '⚠' : ''}`).join(' · ')}${done ? ' — secured' : ''}</small></button>`; }).join('')}</div>
      <button data-act="resume">Cancel</button></div>`);
  }
  map(game, viewFloor) {
    const run = game.run;
    const floors = game.map.floor === -1 ? [-1] : FLOORS.map((f, i) => i);
    this.show(`<div class="panel wide mapp"><h2>Floor Map</h2>
      ${floors.length > 1 ? `<div class="row tabs">${floors.map(i => `<button class="opt ${i === viewFloor ? 'sel' : ''}" data-act="mapfloor" data-id="${i}" ${run.floors[i] || i === run.floor ? '' : 'disabled'}>${FLOORS[i].name}</button>`).join('')}</div>` : ''}
      <canvas class="mapcv"></canvas>
      <div class="legend"><span><i class="lg you"></i>You</span><span><i class="lg host"></i>Known hostage</span><span><i class="lg ex"></i>Extraction</span><span><i class="lg st"></i>Stairs</span><span>✓ secured</span><span>⚠ heightened alert</span></div>
      <p class="muted small">Only areas you have seen are shown. Enemy positions are not tracked.</p>
      <button class="primary" data-act="resume">Close</button></div>`);
    const cv = $('.mapcv', this.screen);
    drawMap(cv, game, viewFloor);
  }
  debrief(pr, run) {
    const d = pr.debrief, s = d.stats;
    const lost = s.hostagesLost, saved = s.hostagesSaved;
    this.show(`<div class="panel"><h2>Apartment ${esc(d.label)} secured</h2><div class="muted">${esc(d.name)}</div>
      <div class="grade g-${d.rating.grade}">${d.rating.grade}<small>${d.rating.score}</small></div>
      <div class="grid2">
        <div>Hostages rescued</div><div>${saved} / ${s.hostages}${lost ? ` <span class="bad">(${lost} lost)</span>` : ''}</div>
        <div>Reports transmitted</div><div class="${s.reports ? 'bad' : 'ok'}">${s.reports}</div>
        <div>Times detected</div><div>${s.detections}</div>
        <div>Kills / non-lethal</div><div>${s.kills} / ${s.subdues}</div>
        <div>Accuracy</div><div>${s.shots ? Math.round(s.hits / s.shots * 100) + '%' : '—'}</div>
        <div>Time</div><div>${fmtTime(s.time)}</div>
        <div>Intel</div><div>${s.intel ? 'Recovered' : 'Not found'}</div>
      </div>
      <div class="bonus">${d.bonus.map(b => `<div>+${b.amt} XP · ${esc(b.label)}</div>`).join('')}</div>
      ${d.levelUp ? `<div class="lvlup">LEVEL ${d.levelUp} — new equipment tiers and skills unlocked</div>` : ''}
      <button class="primary" data-act="toupgrade">Choose Upgrade</button></div>`);
  }
  upgrades(pr, run) {
    const cards = pr.offers.map(id => describeUpgrade(run, id));
    this.show(`<div class="panel wide"><h2>Choose one upgrade</h2><p class="muted">Applied immediately and kept for the rest of this operation.</p>
      <div class="cards">${cards.map(c => `<button class="card" data-act="pickupgrade" data-id="${c.id}">
        <span class="cat">${esc(c.cat)}</span><b>${esc(c.name)}</b><span class="rank">Rank ${c.rank} → ${c.rank + 1} of ${c.max}</span>
        <span class="cur">Now: ${esc(c.current)}</span><span class="nxt">After: ${esc(c.next)}</span></button>`).join('')}</div>
      ${cards.length === 0 ? '<p>No upgrades available.</p><button data-act="pickupgrade" data-id="">Continue</button>' : ''}</div>`);
  }
  gameOver(canLoad) {
    this.show(`<div class="panel"><h2 class="bad">Mission Failed</h2><p class="muted">The soldier was killed in action.</p>
      <div class="menu">${canLoad ? '<button class="primary" data-act="continue">Load Last Save</button>' : ''}<button data-act="restart">Restart Run</button><button data-act="newrun">New Run</button><button data-act="quit">Title</button></div></div>`);
  }
  operationComplete(run, rating, rec) {
    this.show(`<div class="panel"><h2>Operation Complete</h2><p class="muted">All nine apartments secured.</p>
      <div class="grade g-${rating.grade}">${rating.grade}<small>${rating.score}</small></div>
      <div class="grid2">
        <div>Hostages rescued</div><div>${run.hostagesSaved} / ${run.hostagesTotal}</div>
        <div>Hostages lost</div><div>${run.hostagesLost}</div>
        <div>Reports transmitted</div><div>${run.reportsTransmitted}</div>
        <div>Kills / non-lethal</div><div>${run.kills} / ${run.subdues}</div>
        <div>Accuracy</div><div>${run.shotsFired ? Math.round(run.shotsHit / run.shotsFired * 100) + '%' : '—'}</div>
        <div>Total time</div><div>${fmtTime(run.time)}</div>
        <div>Intel recovered</div><div>${run.intel} / 9</div>
        <div>Final level</div><div>${run.level}</div>
      </div>
      ${rec ? '<div class="lvlup">New record!</div>' : ''}
      <div class="menu"><button class="primary" data-act="newrun">New Run</button><button data-act="quit">Title</button></div></div>`);
  }
  tutorialDone() {
    this.show(`<div class="panel"><h2>Training complete</h2><p>You know the essentials: stay out of flashlight beams, interrupt reports within 4 seconds, hide in real cover, and get every hostage to the extraction point.</p><div class="menu"><button class="primary" data-act="newrun">Start an Operation</button><button data-act="quit">Title</button></div></div>`);
  }
  settings(s, from) {
    const keys = { ...DEFAULT_KEYS, ...(s.keybinds || {}) };
    const pad = { ...DEFAULT_PAD, ...(s.padbinds || {}) };
    const cb = (k, label) => `<label class="tg"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span>${label}</span></label>`;
    const rg = (k, label, min, max, step) => `<label class="rg"><span>${label} <output>${typeof s[k] === 'number' ? (step < 1 ? s[k].toFixed(2) : s[k]) : ''}</output></span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[k]}" data-set="${k}"></label>`;
    this.show(`<div class="panel wide settings"><h2>Settings</h2>
      <h3>Audio</h3>${rg('music', 'Music volume', 0, 1, 0.05)}${rg('sfx', 'Effects volume', 0, 1, 0.05)}
      <h3>Feedback & display</h3>${cb('vibration', 'Vibration')}${cb('reducedShake', 'Reduced screen shake')}${rg('uiScale', 'Interface scale', 0.8, 1.4, 0.05)}${rg('zoom', 'Camera zoom (also pinch / double-tap)', 0.6, 1.8, 0.05)}
      <label class="sel"><span>Vision cones</span><select data-set="cones"><option value="auto" ${s.cones == null ? 'selected' : ''}>Difficulty default</option><option value="on" ${s.cones === true ? 'selected' : ''}>Always show</option><option value="off" ${s.cones === false ? 'selected' : ''}>Hide</option></select></label>
      ${cb('noiseRings', 'Show noise rings')}
      <label class="sel"><span>Graphics quality</span><select data-set="quality"><option value="auto" ${s.quality === 'auto' ? 'selected' : ''}>Auto</option><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High</option><option value="low" ${s.quality === 'low' ? 'selected' : ''}>Low (battery saver)</option></select></label>
      <h3>Touch controls</h3>
      <label class="sel"><span>Movement stick</span><select data-set="joystickMode"><option value="fixed" ${s.joystickMode === 'fixed' ? 'selected' : ''}>Fixed</option><option value="floating" ${s.joystickMode === 'floating' ? 'selected' : ''}>Floating (appears where you touch)</option></select></label>
      ${rg('deadzone', 'Stick dead zone', 0.02, 0.4, 0.01)}
      <label class="sel"><span>Control scheme</span><select data-set="controlScheme"><option value="simple" ${(s.controlScheme || 'simple') === 'simple' ? 'selected' : ''}>Simple — fewer buttons</option><option value="full" ${s.controlScheme === 'full' ? 'selected' : ''}>Full — every action has a button</option></select></label>
      ${cb('contextualAttack', 'Full scheme: single ATTACK button instead of FIRE + TAKEDOWN')}
      ${cb('allowPortrait', 'Allow portrait (landscape is recommended)')}
      ${cb('aimStick', 'Right-side aim stick')}
      ${cb('aimAssist', 'Assisted aiming (fire button still required)')}
      ${cb('leftHanded', 'Left-handed layout (mirror)')}
      <button data-act="layout">Edit Control Layout…</button>
      <h3>Keyboard</h3><p class="muted small">Click a key to rebind it. Mouse aims, left click fires, right click takes down.</p>
      <div class="binds">${Object.keys(ACTION_LABELS).map(a => `<div>${ACTION_LABELS[a]}</div><button class="bind" data-act="rebind" data-id="${a}">${esc((keys[a] || []).map(prettyKey).join(' / ') || '—')}</button>`).join('')}</div>
      <h3>Gamepad</h3><p class="muted small">Left stick moves, right stick aims. Click an action, then press a gamepad button.</p>
      <div class="binds">${Object.keys(DEFAULT_PAD).map(a => `<div>${ACTION_LABELS[a]}</div><button class="bind" data-act="rebindpad" data-id="${a}">Button ${pad[a]}</button>`).join('')}</div>
      <div class="row"><button data-act="resetsettings">Reset all settings</button><button class="primary" data-act="back">Done</button></div></div>`);
  }
  rebindPrompt(label) { const d = document.createElement('div'); d.className = 'rebind-overlay'; d.innerHTML = `<div>Press a ${label} for this action…<br><small>Esc to cancel</small></div>`; this.screen.appendChild(d); return d; }
}

function prettyKey(k) { return k.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '↑ ').replace('↑ Up', '↑').replace('↑ Down', '↓').replace('↑ Left', '←').replace('↑ Right', '→').replace('Left', ' L').replace('Right', ' R'); }
export function fmtTime(s) { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function weaponCompare(newId, oldId, run) {
  const n = WEAPONS[newId], o = oldId ? WEAPONS[oldId] : null;
  const st = playerStats(run);
  const rows = [
    ['Damage', w => Math.round(w.dmg * (w.pellets || 1)) || (w.effect ? w.effect : 0), true],
    ['Fire rate', w => (1 / w.rate).toFixed(1) + '/s', true, w => 1 / w.rate],
    ['Range', w => w.range + ' m', true, w => w.range],
    ['Accuracy', w => Math.round((1 - w.spread * 4) * 100) + '%', true, w => -w.spread],
    ['Magazine', w => Math.round(w.mag * st.magMul), true, w => w.mag],
    ['Reload', w => (w.reload * st.reloadMul).toFixed(1) + ' s', false, w => w.reload],
    ['Noise', w => w.noise <= 5 ? 'Quiet' : w.noise < 16 ? 'Loud' : 'Very loud', false, w => w.noise],
  ];
  const cmp = (fn, hb, raw) => { if (!o) return ''; const a = (raw || fn)(n), b = (raw || fn)(o); if (typeof a !== 'number' || a === b) return ''; return (a > b) === hb ? 'up' : 'down'; };
  return `<div class="pk-h"><b>${esc(n.name)}</b> <span>${esc(n.family)}${n.suppressed ? ' · suppressed' : ''}${n.effect ? ' · non-lethal' : ''}</span>${o ? `<div class="muted small">replaces ${esc(o.name)}</div>` : ''}</div>
    <table>${rows.map(([lbl, fn, hb, raw]) => `<tr><td>${lbl}</td><td class="${cmp(fn, hb, raw)}">${esc(String(fn(n)))}</td>${o ? `<td class="muted">${esc(String(fn(o)))}</td>` : ''}</tr>`).join('')}</table><div class="muted small">Press USE to ${o ? 'swap' : 'take'}</div>`;
}

export function drawMap(cv, game, floorIdx) {
  const run = game.run;
  const map = floorIdx === game.map.floor ? game.map : buildFloor(floorIdx);
  const fs = floorIdx === game.map.floor ? game.fs : run.floors[floorIdx];
  const disc = floorIdx === game.map.floor ? game.disc : (() => { const s = fs?.discovered || ''; const a = new Uint8Array(map.w * map.h); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) === 49 ? 1 : 0; return a; })();
  const box = cv.parentElement.getBoundingClientRect();
  const W = Math.min(box.width - 8, 900);
  const cell = Math.max(5, Math.floor(W / map.w));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = map.w * cell * dpr; cv.height = map.h * cell * dpr; cv.style.width = map.w * cell + 'px'; cv.style.height = map.h * cell + 'px';
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  x.fillStyle = '#0c0d0f'; x.fillRect(0, 0, map.w * cell, map.h * cell);
  const col = { living: '#4a4234', kitchen: '#4a4a3c', bathroom: '#3c4648', bedroom: '#4a3e38', office: '#40423a', storage: '#3a3a36', balcony: '#33383a', laundry: '#3a4246', hall: '#44403a', corridor: '#3a4038' };
  for (let y = 0; y < map.h; y++) for (let xx = 0; xx < map.w; xx++) {
    const i = y * map.w + xx;
    if (!disc[i]) continue;
    const t = map.tile[i];
    if (t === T.FLOOR || t === T.ARCH) { const r = map.room[i]; x.fillStyle = r >= 0 ? col[map.rooms[r].type] || '#444' : '#555'; if (map.prop[i] >= 0) x.fillStyle = '#5d5548'; }
    else if (t === T.DOOR) x.fillStyle = '#8a6a40';
    else if (t === T.RAIL) x.fillStyle = '#6a6a6a';
    else x.fillStyle = '#9a9488';
    x.fillRect(xx * cell, y * cell, cell, cell);
  }
  // labels
  x.font = `bold ${Math.max(9, cell * 1.4)}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle';
  map.aptInfo.forEach((a, slot) => {
    const rooms = map.rooms.filter(r => r.apt === slot);
    if (!rooms.length) return;
    const x0 = Math.min(...rooms.map(r => r.x0)), x1 = Math.max(...rooms.map(r => r.x1)), y0 = Math.min(...rooms.map(r => r.y0)), y1 = Math.max(...rooms.map(r => r.y1));
    const rec = run.apts[a.id];
    const st = rec ? (rec.status === 'complete' ? ' ✓' : rec.prepared ? ' ⚠' : '') : '';
    x.fillStyle = rec && rec.status === 'complete' ? 'rgba(120,220,140,0.9)' : rec && rec.prepared ? 'rgba(255,170,80,0.95)' : 'rgba(230,220,200,0.85)';
    x.fillText(a.label + st, (x0 + x1 + 1) / 2 * cell, (y0 + y1 + 1) / 2 * cell);
    // extraction
    const ex = markersOf(map, slot, 6)[0];
    if (ex && disc[ex.y * map.w + ex.x]) { x.strokeStyle = '#6ad880'; x.lineWidth = 2; x.strokeRect(ex.x * cell + 1, ex.y * cell + 1, cell - 2, cell - 2); }
  });
  if (map.stairs) { x.fillStyle = '#c8b87a'; x.fillRect(map.stairs.x * cell, map.stairs.y * cell, map.stairs.w * cell, map.stairs.d * cell); }
  if (fs) for (const h of fs.hostages) if (h.known && h.state !== 'evacuated') { x.fillStyle = h.state === 'dead' ? '#844' : '#7ad890'; x.beginPath(); x.arc(h.x * cell, h.y * cell, cell * 0.45, 0, Math.PI * 2); x.fill(); }
  if (floorIdx === game.map.floor) {
    const p = game.player;
    x.fillStyle = '#ffffff'; x.save(); x.translate(p.x * cell, p.y * cell); x.rotate(p.facing); x.beginPath(); x.moveTo(cell * 0.9, 0); x.lineTo(-cell * 0.5, -cell * 0.5); x.lineTo(-cell * 0.5, cell * 0.5); x.closePath(); x.fill(); x.restore();
    const al = game.alertLevel();
    x.fillStyle = { calm: '#8a8', suspicious: '#dc6', searching: '#e93', combat: '#e44' }[al.level];
    x.textAlign = 'left'; x.font = `bold ${Math.max(10, cell * 1.2)}px system-ui`;
    x.fillText(`Alert: ${al.level.toUpperCase()}${run.pendingPrepared ? ' · next apartment will be prepared' : ''}`, 6, map.h * cell - cell * 0.8);
  }
}
