// Gameplay data tables: weapons, gadgets, upgrades, enemies, difficulty.
export const REPORT_TIME = 4.0; // seconds of gameplay time — identical on every difficulty

// noise: hearing radius in tiles. spread in radians. range in tiles (full damage), falloff beyond.
export const WEAPONS = {
  p9:   { name: 'P9 Pistol', short: 'P9', slot: 'sidearm', family: 'Pistol', tier: 1, dmg: 24, rate: 0.28, mode: 'semi', spread: 0.045, bloom: 0.03, range: 9, mag: 12, reserve: 36, reload: 1.3, noise: 15, pen: 0.2 },
  p9s:  { name: 'P9-S Suppressed', short: 'P9-S', slot: 'sidearm', family: 'Pistol', tier: 1, dmg: 21, rate: 0.32, mode: 'semi', spread: 0.045, bloom: 0.03, range: 8, mag: 12, reserve: 24, reload: 1.4, noise: 4.5, suppressed: true, pen: 0.15 },
  rev:  { name: '.44 Revolver', short: '.44', slot: 'sidearm', family: 'Heavy pistol', tier: 2, dmg: 55, rate: 0.7, mode: 'semi', spread: 0.03, bloom: 0.09, range: 11, mag: 6, reserve: 18, reload: 2.4, noise: 20, pen: 0.6 },
  tranq:{ name: 'Tranquilizer Pistol', short: 'TRQ', slot: 'sidearm', family: 'Tranquilizer', tier: 1, dmg: 0, effect: 'tranq', rate: 0.9, mode: 'semi', spread: 0.03, bloom: 0.02, range: 8, mag: 4, reserve: 8, reload: 2.0, noise: 2.5, suppressed: true, pen: 0 },
  stun: { name: 'Arc Stun Gun', short: 'ARC', slot: 'sidearm', family: 'Electrical stun', tier: 2, dmg: 0, effect: 'stun', rate: 0.6, mode: 'semi', spread: 0.02, bloom: 0, range: 4.5, maxRange: 4.8, mag: 1, reserve: 6, reload: 2.6, noise: 3, suppressed: true, pen: 0 },
  k5:   { name: 'K5 Compact SMG', short: 'K5', slot: 'primary', family: 'SMG', tier: 1, dmg: 15, rate: 0.085, mode: 'auto', spread: 0.085, bloom: 0.015, range: 7, mag: 30, reserve: 90, reload: 1.9, noise: 15, pen: 0.15 },
  k5sd: { name: 'K5-SD Suppressed SMG', short: 'K5-SD', slot: 'primary', family: 'SMG', tier: 2, dmg: 14, rate: 0.095, mode: 'auto', spread: 0.08, bloom: 0.015, range: 6.5, mag: 30, reserve: 60, reload: 2.1, noise: 5, suppressed: true, pen: 0.1 },
  ar16: { name: 'AR-16 Assault Rifle', short: 'AR-16', slot: 'primary', family: 'Assault rifle', tier: 2, dmg: 23, rate: 0.11, mode: 'auto', spread: 0.05, bloom: 0.02, range: 12, mag: 30, reserve: 90, reload: 2.3, noise: 20, pen: 0.5 },
  br3:  { name: 'BR-3 Burst Rifle', short: 'BR-3', slot: 'primary', family: 'Burst rifle', tier: 2, dmg: 25, rate: 0.38, mode: 'burst', burst: 3, burstGap: 0.065, spread: 0.035, bloom: 0.012, range: 12, mag: 24, reserve: 72, reload: 2.2, noise: 19, pen: 0.5 },
  m870: { name: 'M870 Pump Shotgun', short: 'M870', slot: 'primary', family: 'Pump shotgun', tier: 1, dmg: 11, pellets: 8, rate: 0.85, mode: 'pump', spread: 0.19, bloom: 0, range: 5, mag: 6, reserve: 18, reload: 2.6, noise: 21, pen: 0.1 },
  ts12: { name: 'TS-12 Tactical Shotgun', short: 'TS-12', slot: 'primary', family: 'Tactical shotgun', tier: 3, dmg: 10, pellets: 7, rate: 0.3, mode: 'semi', spread: 0.16, bloom: 0.02, range: 5.5, mag: 8, reserve: 24, reload: 2.6, noise: 20, pen: 0.15 },
  dmr:  { name: 'DM-7 Marksman Rifle', short: 'DM-7', slot: 'primary', family: 'Marksman rifle', tier: 3, dmg: 70, rate: 0.6, mode: 'semi', spread: 0.01, bloom: 0.1, range: 16, mag: 10, reserve: 30, reload: 2.6, noise: 22, pen: 0.8 },
  xbow: { name: 'Compact Crossbow', short: 'XBOW', slot: 'primary', family: 'Crossbow', tier: 2, dmg: 90, rate: 1.0, mode: 'semi', spread: 0.015, bloom: 0, range: 12, mag: 1, reserve: 10, reload: 1.4, noise: 2, suppressed: true, pen: 0.4 },
};
export const WEAPON_IDS = Object.keys(WEAPONS);
export const KNIFE = { name: 'Combat Knife', short: 'KNIFE', dmg: 38, rate: 0.5, range: 1.15, noise: 1.5 };

export const GADGETS = {
  smoke:   { name: 'Smoke Grenade', short: 'SMK', icon: 'smoke', throw: true, radius: 2.4, duration: 9, desc: 'Blocks vision in an area for 9 s.' },
  flash:   { name: 'Flashbang', short: 'FLS', icon: 'flash', throw: true, radius: 5, stun: 4, noise: 11, desc: 'Stuns guards with line of sight for 4 s. Loud.' },
  decoy:   { name: 'Noise Decoy', short: 'DCY', icon: 'decoy', throw: true, noise: 7, desc: 'Thrown bottle. Guards investigate the sound.' },
  medkit:  { name: 'Medical Kit', short: 'MED', icon: 'med', heal: 45, desc: 'Restores 45 health.' },
  armorkit:{ name: 'Armor Repair Kit', short: 'ARM', icon: 'armor', armor: 40, desc: 'Restores 40 armor.' },
  jammer:  { name: 'Camera Jammer', short: 'JAM', icon: 'jam', radius: 9, duration: 15, desc: 'Disables cameras within 9 m for 15 s and cuts their transmissions.' },
};
export const GADGET_IDS = Object.keys(GADGETS);

export const ABILITIES = {
  ghost: { name: 'Ghost Step', duration: 8, cooldown: 45, desc: 'Near-silent movement and lower visibility for 8 s.' },
  surge: { name: 'Emergency Plates', duration: 0.5, cooldown: 80, desc: 'Instantly restores 50 armor.' },
  focus: { name: 'Tactical Focus', duration: 6, cooldown: 50, desc: '6 s of steady aim and 40% faster reloads.' },
};

// Upgrade tree. value(r) returns the stat value at rank r. minLevel[r-1] = level needed for rank r.
export const UPGRADES = [
  { id: 'vital', name: 'Conditioning', cat: 'Health', max: 3, minLevel: [1, 2, 4], stat: 'maxHp', value: r => 100 + 20 * r, fmt: v => `${v} HP` },
  { id: 'plates', name: 'Ceramic Plates', cat: 'Armor', max: 3, minLevel: [1, 2, 4], stat: 'maxArmor', value: r => 50 + 20 * r, fmt: v => `${v} armor` },
  { id: 'soles', name: 'Soft Soles', cat: 'Stealth', max: 3, minLevel: [1, 2, 3], stat: 'noiseMul', value: r => Math.pow(0.8, r), fmt: v => `${Math.round(v * 100)}% footstep noise` },
  { id: 'shadow', name: 'Shadow Discipline', cat: 'Stealth', max: 2, minLevel: [2, 4], req: { soles: 1 }, stat: 'visMul', value: r => 1 - 0.12 * r, fmt: v => `${Math.round(v * 100)}% visibility` },
  { id: 'hands', name: 'Quick Hands', cat: 'Weapons', max: 3, minLevel: [1, 2, 3], stat: 'reloadMul', value: r => Math.pow(0.85, r), fmt: v => `${Math.round(v * 100)}% reload time` },
  { id: 'mags', name: 'Extended Magazines', cat: 'Weapons', max: 2, minLevel: [2, 3], stat: 'magMul', value: r => 1 + 0.25 * r, fmt: v => `${Math.round(v * 100)}% magazine size` },
  { id: 'pouch', name: 'Ammo Pouches', cat: 'Weapons', max: 2, minLevel: [1, 3], stat: 'reserveMul', value: r => 1 + 0.4 * r, fmt: v => `${Math.round(v * 100)}% ammo capacity` },
  { id: 'steady', name: 'Steady Aim', cat: 'Weapons', max: 3, minLevel: [1, 2, 4], stat: 'spreadMul', value: r => Math.pow(0.8, r), fmt: v => `${Math.round(v * 100)}% weapon spread` },
  { id: 'rounds', name: 'Hollow Points', cat: 'Weapons', max: 3, minLevel: [1, 3, 5], stat: 'dmgMul', value: r => 1 + 0.12 * r, fmt: v => `${Math.round(v * 100)}% firearm damage` },
  { id: 'belt', name: 'Gadget Belt', cat: 'Gadgets', max: 2, minLevel: [1, 3], stat: 'gadgetCap', value: r => 2 + r, fmt: v => `${v} per gadget slot` },
  { id: 'grip', name: 'Close Quarters', cat: 'Tactics', max: 2, minLevel: [1, 3], stat: 'takedownRange', value: r => 1.25 + 0.3 * r, fmt: v => `${v.toFixed(2)} m takedown reach` },
  { id: 'ghost', name: 'Ghost Step', cat: 'Ability', max: 1, minLevel: [2], stat: 'ab_ghost', ability: 'ghost', value: r => r, fmt: v => v ? 'Unlocked: 8 s quiet movement (45 s cooldown)' : 'Locked' },
  { id: 'surge', name: 'Emergency Plates', cat: 'Ability', max: 1, minLevel: [2], req: { plates: 1 }, stat: 'ab_surge', ability: 'surge', value: r => r, fmt: v => v ? 'Unlocked: +50 armor instantly (80 s cooldown)' : 'Locked' },
  { id: 'focus', name: 'Tactical Focus', cat: 'Ability', max: 1, minLevel: [3], req: { steady: 1 }, stat: 'ab_focus', ability: 'focus', value: r => r, fmt: v => v ? 'Unlocked: 6 s steady aim & fast reloads (50 s cooldown)' : 'Locked' },
  { id: 'cdr', name: 'Field Discipline', cat: 'Ability', max: 2, minLevel: [3, 5], reqAny: ['ghost', 'surge', 'focus'], stat: 'cdMul', value: r => Math.pow(0.8, r), fmt: v => `${Math.round(v * 100)}% ability cooldowns` },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

export const XP_LEVELS = [0, 300, 750, 1350, 2100, 3000, 4100, 5400, 7000];
export const XP = { hostageFreed: 60, hostageSaved: 120, intel: 90, supply: 15, explore: 10, aptComplete: 150, noReport: 120, ghost: 100, noKill: 80, kill: 8, subdue: 20 };
export function levelForXp(xp) { let l = 1; for (let i = 1; i < XP_LEVELS.length; i++) if (xp >= XP_LEVELS[i]) l = i + 1; return l; }
export function tierForLevel(level) { return level >= 4 ? 3 : level >= 2 ? 2 : 1; }

export const ENEMY_TYPES = {
  patrol:  { name: 'Patrol Guard', hp: 70, armor: 0, walk: 1.5, run: 3.0, vision: 9, fov: 0.95, beam: 7, beamHalf: 0.3, weapon: 'smg', hear: 1.0, look: '#6b5a42', vest: '#4b4436', head: 'cap' },
  scout:   { name: 'Scout', hp: 55, armor: 0, walk: 1.8, run: 3.6, vision: 11, fov: 1.1, beam: 8.5, beamHalf: 0.26, weapon: 'pistol', hear: 1.3, look: '#5b6450', vest: '#3e4637', head: 'hood' },
  armored: { name: 'Armored Guard', hp: 95, armor: 60, walk: 1.3, run: 2.5, vision: 8, fov: 0.85, beam: 6.5, beamHalf: 0.36, weapon: 'shotgun', hear: 0.9, look: '#4c4c50', vest: '#2f3034', head: 'helmet' },
  leader:  { name: 'Squad Leader', hp: 85, armor: 30, walk: 1.5, run: 3.0, vision: 10, fov: 1.0, beam: 7.5, beamHalf: 0.3, weapon: 'rifle', hear: 1.1, look: '#5d4a3c', vest: '#3a2d25', head: 'beret', leader: true },
};
export const ENEMY_WEAPONS = {
  smg:     { dmg: 7, rate: 0.13, burst: 5, pause: 0.9, spread: 0.12, range: 8, noise: 15 },
  pistol:  { dmg: 10, rate: 0.42, burst: 3, pause: 0.8, spread: 0.09, range: 9, noise: 14 },
  shotgun: { dmg: 5, pellets: 6, rate: 1.0, burst: 1, pause: 0.6, spread: 0.2, range: 5.5, noise: 20 },
  rifle:   { dmg: 9, rate: 0.16, burst: 4, pause: 0.85, spread: 0.08, range: 11, noise: 19 },
};

export const DIFFICULTY = {
  easy:    { name: 'Easy', enemyDelta: -1, perception: 0.75, damage: 0.55, ammo: 1.5, armor: 0.6, aimAssist: 0.9, cones: true, extraMed: true, reaction: 0.7,
    desc: ['Fewer guards in each apartment', 'Guards notice you 25% slower', 'Enemy damage −45%', 'Ammunition +50%, extra medical kits', 'Lighter enemy armor', 'Strong aim assist, vision cones shown'] },
  normal:  { name: 'Normal', enemyDelta: 0, perception: 1, damage: 1, ammo: 1, armor: 1, aimAssist: 0.6, cones: true, extraMed: false, reaction: 0.5,
    desc: ['Standard guard numbers', 'Standard perception', 'Standard enemy damage', 'Standard ammunition', 'Standard armor', 'Moderate aim assist, vision cones shown'] },
  hard:    { name: 'Hard', enemyDelta: 1, perception: 1.15, damage: 1.3, ammo: 0.8, armor: 1.2, aimAssist: 0.35, cones: true, extraMed: false, reaction: 0.4,
    desc: ['One extra guard in later apartments', 'Guards notice you 15% faster', 'Enemy damage +30%', 'Ammunition −20%', 'Heavier enemy armor', 'Light aim assist'] },
  extreme: { name: 'Extreme', enemyDelta: 1, perception: 1.3, damage: 1.6, ammo: 0.6, armor: 1.4, aimAssist: 0.15, cones: false, extraMed: false, reaction: 0.32,
    desc: ['Extra guards from the first apartment', 'Guards notice you 30% faster', 'Enemy damage +60%', 'Ammunition −40%', 'Much heavier enemy armor', 'Minimal aim assist, vision cones off by default'] },
};
export const DIFF_IDS = Object.keys(DIFFICULTY);
