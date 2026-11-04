// Local persistence: settings, controls, meta (unlocks/records), run saves, alert ledger.
import { SAVE_VERSION } from './game-run.js';

const K = { settings: 'se.settings.v1', controls: 'se.controls.v1', meta: 'se.meta.v1', run: 'se.run', ledger: 'se.ledger' };
const mem = {};
function get(k) { try { const v = localStorage.getItem(k); return v == null ? (mem[k] ?? null) : v; } catch { return mem[k] ?? null; } }
function set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); return true; } catch { return false; } }
function del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch { } }
function parse(s, fallback) { if (!s) return fallback; try { return JSON.parse(s); } catch { return fallback; } }

export const DEFAULT_SETTINGS = {
  music: 0.5, sfx: 0.8, vibration: true, reducedShake: false, uiScale: 1, cones: null, noiseRings: true,
  joystickMode: 'fixed', deadzone: 0.12, contextualAttack: false, aimStick: false, aimAssist: true,
  leftHanded: false, quality: 'auto', keybinds: {}, padbinds: {},
};
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...parse(get(K.settings), {}) }; }
export function saveSettings(s) { set(K.settings, JSON.stringify(s)); }
export function loadControls() { return parse(get(K.controls), null); }
export function saveControls(c) { set(K.controls, JSON.stringify(c)); }

export const DEFAULT_META = { lastStart: null, discoveredWeapons: ['p9'], records: { runs: 0, completed: 0, bestScore: null, bestGrade: null, hostagesSaved: 0, fastest: null }, tutorialDone: false };
export function loadMeta() { const m = parse(get(K.meta), {}); return { ...DEFAULT_META, ...m, records: { ...DEFAULT_META.records, ...(m.records || {}) } }; }
export function saveMeta(m) { set(K.meta, JSON.stringify(m)); }

export function saveRun(snapshot) { return set(K.run, JSON.stringify({ v: SAVE_VERSION, t: Date.now(), run: snapshot })); }
// Returns { run } or { error } or null
export function loadRun() {
  const raw = get(K.run);
  if (!raw) return null;
  const data = parse(raw, null);
  if (!data || data.v !== SAVE_VERSION || !data.run || !data.run.player || !data.run.apts) return { error: 'The saved operation was made by an older version of the game and could not be restored.' };
  const run = data.run;
  // merge alert ledger (reports transmitted after the save was written are never lost)
  const L = loadLedger();
  if (L && L.runId === run.runId) {
    // the ledger is written on every report, every preparation and every save, so it is the latest truth
    run.pendingPrepared = !!L.pending;
    if (L.pendingFrom !== undefined) run.pendingFrom = L.pendingFrom;
    for (const id of L.prepared || []) if (run.apts[id] && !run.apts[id].prepared) { run.apts[id].prepared = true; run.apts[id].preparedApplied = false; }
    run.reportsTransmitted = Math.max(run.reportsTransmitted, L.reports || 0);
  }
  return { run, time: data.t };
}
export function hasRun() { const r = loadRun(); return !!(r && r.run && !r.run.finished); }
export function clearRun() { del(K.run); del(K.ledger); }

export function loadLedger() { return parse(get(K.ledger), null); }
export function writeLedger(run) {
  const prepared = Object.values(run.apts).filter(a => a.prepared).map(a => a.id);
  set(K.ledger, JSON.stringify({ runId: run.runId, pending: !!run.pendingPrepared, pendingFrom: run.pendingFrom, prepared, reports: run.reportsTransmitted }));
}
