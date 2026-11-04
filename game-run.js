// Run state: creation, derived player stats, upgrades, XP. All JSON-serializable.
import { UPGRADES, UPGRADE_BY_ID, WEAPONS, GADGETS, levelForXp, tierForLevel, XP_LEVELS, DIFFICULTY } from './game-data.js';
import { campaignApartments } from './world-building.js';
import { RNG } from './core-util.js';

export const SAVE_VERSION = 3;

export function pickStartApartment(prevStart, rng) {
  const all = campaignApartments().map(a => a.id);
  const options = all.filter(id => id !== prevStart);
  return rng.pick(options.length ? options : all);
}

export function createRun({ seed, difficulty = 'normal', prevStart = null, startApt = null, sidearm = 'p9', tutorial = false }) {
  seed = (seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
  const rng = new RNG(seed);
  const start = startApt || pickStartApartment(prevStart, rng);
  const apts = {};
  for (const a of campaignApartments()) apts[a.id] = { id: a.id, label: a.label, floor: a.floor, slot: a.slot, status: 'untouched', prepared: false, preparedApplied: false, progress: null, stats: newAptStats(), rewardClaimed: false };
  const startInfo = campaignApartments().find(a => a.id === start);
  const run = {
    version: SAVE_VERSION, runId: `${seed.toString(36)}-${Date.now().toString(36)}`, seed, difficulty, tutorial,
    startApt: start, floor: startInfo.floor, apts, floors: {},
    pendingPrepared: false, pendingFrom: null, reportsTransmitted: 0, completed: 0,
    time: 0, shotsFired: 0, shotsHit: 0, kills: 0, subdues: 0, hostagesSaved: 0, hostagesLost: 0, hostagesTotal: 0, intel: 0,
    xp: 0, level: 1, upgrades: {}, pendingReward: null, finished: false,
    player: null,
  };
  const diff = DIFFICULTY[difficulty];
  run.player = {
    x: 0, y: 0, facing: 0, hp: 100, armor: 25,
    primary: null,
    sidearm: makeWeapon(sidearm, diff.ammo, 1),
    active: 'sidearm',
    gadgets: [{ id: 'decoy', count: 2 }, { id: diff.extraMed ? 'medkit' : 'smoke', count: diff.extraMed ? 2 : 1 }],
    ability: null, abilityCd: {}, discoveredWeapons: [sidearm],
  };
  return run;
}
export function newAptStats() { return { time: 0, kills: 0, subdues: 0, reports: 0, detections: 0, shots: 0, hits: 0, hostages: 0, hostagesSaved: 0, hostagesLost: 0, intel: false, entered: false }; }

export function makeWeapon(id, ammoMul = 1, reserveMul = 1, magMul = 1) {
  const w = WEAPONS[id];
  return { id, mag: Math.round(w.mag * magMul), reserve: Math.round(w.reserve * ammoMul * reserveMul) };
}

// Derived stats from upgrades.
export function playerStats(run) {
  const s = { maxHp: 100, maxArmor: 50, noiseMul: 1, visMul: 1, reloadMul: 1, magMul: 1, reserveMul: 1, spreadMul: 1, dmgMul: 1, gadgetCap: 2, takedownRange: 1.25, cdMul: 1, abilities: [] };
  for (const u of UPGRADES) {
    const r = run.upgrades[u.id] || 0;
    if (!r) continue;
    if (u.ability) s.abilities.push(u.ability);
    else s[u.stat] = u.value(r);
  }
  return s;
}
export function magSize(run, id) { return Math.max(1, Math.round(WEAPONS[id].mag * playerStats(run).magMul)); }
export function reserveCap(run, id) { return Math.round(WEAPONS[id].reserve * 1.5 * playerStats(run).reserveMul); }

export function upgradeAvailable(run, u) {
  const r = run.upgrades[u.id] || 0;
  if (r >= u.max) return false;
  if (run.level < u.minLevel[r]) return false;
  if (u.req) for (const k in u.req) if ((run.upgrades[k] || 0) < u.req[k]) return false;
  if (u.reqAny && !u.reqAny.some(k => run.upgrades[k])) return false;
  return true;
}
// Three valid choices, seeded per apartment for determinism.
export function upgradeOffers(run, aptId, seedSalt = 0) {
  const rng = new RNG((run.seed ^ (aptId.charCodeAt(1) * 7919) ^ (seedSalt * 104729)) >>> 0);
  const avail = UPGRADES.filter(u => upgradeAvailable(run, u));
  // weight abilities a little higher once unlocked by level so they show up
  const pool = rng.shuffle(avail);
  const picks = [];
  const cats = new Set();
  for (const u of pool) { if (picks.length >= 3) break; if (!cats.has(u.cat)) { picks.push(u.id); cats.add(u.cat); } }
  for (const u of pool) { if (picks.length >= 3) break; if (!picks.includes(u.id)) picks.push(u.id); }
  return picks;
}
export function describeUpgrade(run, id) {
  const u = UPGRADE_BY_ID[id];
  const r = run.upgrades[id] || 0;
  return { id, name: u.name, cat: u.cat, rank: r, max: u.max, current: u.fmt(u.value(r)), next: u.fmt(u.value(r + 1)) };
}
export function applyUpgrade(run, id) {
  const u = UPGRADE_BY_ID[id];
  if (!upgradeAvailable(run, u)) return false;
  const before = playerStats(run);
  run.upgrades[id] = (run.upgrades[id] || 0) + 1;
  const after = playerStats(run);
  const p = run.player;
  // apply immediately to current values
  if (after.maxHp > before.maxHp) p.hp += after.maxHp - before.maxHp;
  if (after.maxArmor > before.maxArmor) p.armor += after.maxArmor - before.maxArmor;
  if (after.magMul !== before.magMul) for (const slot of ['primary', 'sidearm']) if (p[slot]) p[slot].mag = Math.round(WEAPONS[p[slot].id].mag * after.magMul);
  if (after.gadgetCap > before.gadgetCap) for (const g of p.gadgets) if (g.id) g.count += 1;
  if (u.ability && !p.ability) p.ability = u.ability;
  return true;
}

export function addXp(run, amount) {
  const before = run.level;
  run.xp += Math.max(0, Math.round(amount));
  run.level = levelForXp(run.xp);
  return run.level > before ? run.level : 0;
}
export function xpProgress(run) {
  const l = run.level;
  const cur = XP_LEVELS[l - 1] || 0, next = XP_LEVELS[l] ?? null;
  if (next == null) return { level: l, frac: 1, cur: run.xp, next: null };
  return { level: l, frac: (run.xp - cur) / (next - cur), cur: run.xp - cur, need: next - cur, next };
}
export function weaponTierAllowed(run) { return tierForLevel(run.level); }

export function aptRating(st) {
  // 0..100
  let score = 100;
  if (st.hostages) score -= 40 * (st.hostagesLost / st.hostages);
  score -= 15 * Math.min(2, st.reports);
  score -= 4 * Math.min(5, st.detections);
  score -= 2 * Math.min(10, st.kills);
  if (st.shots > 4) score -= 10 * (1 - st.hits / st.shots);
  if (st.time > 360) score -= Math.min(10, (st.time - 360) / 30);
  if (st.intel) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: score >= 92 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D' };
}
export function operationRating(run) {
  const list = Object.values(run.apts);
  const scores = list.map(a => aptRating(a.stats).score);
  const avg = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  let score = avg - 3 * Math.max(0, run.reportsTransmitted - 2);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: score >= 92 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D' };
}
export { GADGETS };
