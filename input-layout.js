// Touch control layout definitions & defaults. Positions are fractions of the safe-area rect (centers).
// schemes: which control schemes show the control. 'simple' is the default (fewer buttons).
const S = ['simple'], F = ['full'], B = ['simple', 'full'];
export const CONTROL_DEFS = {
  stick:     { label: 'Move', kind: 'stick', base: 132, schemes: B },
  aim:       { label: 'Aim', kind: 'stick', base: 116, optional: 'aimStick', schemes: B },
  attack:    { label: 'ATTACK', kind: 'button', base: 84, action: 'attack', schemes: B, showIfFull: 'contextualAttack' },
  fire:      { label: 'FIRE', kind: 'button', base: 76, action: 'fire', schemes: F, hideIf: 'contextualAttack' },
  takedown:  { label: 'TAKE\nDOWN', kind: 'button', base: 62, action: 'takedown', schemes: F, hideIf: 'contextualAttack' },
  tdmode:    { label: 'LTH', kind: 'button', base: 38, action: 'toggleTakedownMode', schemes: F },
  interact:  { label: 'USE', kind: 'button', base: 66, action: 'interact', schemes: B },
  crouch:    { label: 'CROUCH', kind: 'button', base: 58, action: 'crouch', schemes: B },
  reload:    { label: 'RELOAD', kind: 'button', base: 48, action: 'reload', schemes: F },
  swap:      { label: 'SWAP', kind: 'button', base: 48, action: 'swap', schemes: F },
  gadget:    { label: 'ITEM', kind: 'button', base: 56, action: 'gadget', schemes: S },
  gnext:     { label: '⇄', kind: 'button', base: 32, action: 'gadgetNext', schemes: S },
  gadget0:   { label: 'G1', kind: 'button', base: 50, action: 'gadget0', schemes: F },
  gadget1:   { label: 'G2', kind: 'button', base: 50, action: 'gadget1', schemes: F },
  ability:   { label: 'ABIL', kind: 'button', base: 50, action: 'ability', schemes: B, needsAbility: true },
  cmds:      { label: 'Hostage commands', kind: 'group', base: 44, schemes: B },
};
export const CONTROL_IDS = Object.keys(CONTROL_DEFS);
export function controlVisible(id, settings) {
  const def = CONTROL_DEFS[id];
  const scheme = settings.controlScheme || 'simple';
  if (!def.schemes.includes(scheme)) return false;
  if (def.optional && !settings[def.optional]) return false;
  if (scheme === 'full' && def.showIfFull && !settings[def.showIfFull]) return false;
  if (scheme === 'full' && def.hideIf && settings[def.hideIf]) return false;
  return true;
}

const P = {
  stick: [0.2, 0.84, 1, 0.7], aim: [0.72, 0.5, 1, 0.6],
  attack: [0.84, 0.87, 1.1, 0.85], fire: [0.84, 0.87, 1.1, 0.85], takedown: [0.62, 0.77, 1, 0.8], tdmode: [0.52, 0.84, 1, 0.75],
  interact: [0.86, 0.72, 1, 0.85], crouch: [0.64, 0.91, 1, 0.8], reload: [0.93, 0.61, 1, 0.75], swap: [0.77, 0.61, 1, 0.75],
  gadget: [0.64, 0.76, 1, 0.8], gnext: [0.53, 0.71, 1, 0.75], gadget0: [0.43, 0.96, 1, 0.75], gadget1: [0.41, 0.85, 1, 0.75],
  ability: [0.47, 0.9, 1, 0.75], cmds: [0.5, 0.6, 1, 0.9],
};
const Lnd = {
  stick: [0.13, 0.72, 1, 0.7], aim: [0.6, 0.62, 1, 0.6],
  attack: [0.91, 0.73, 1.15, 0.85], fire: [0.91, 0.73, 1.15, 0.85], takedown: [0.79, 0.58, 1, 0.8], tdmode: [0.885, 0.97, 1, 0.75],
  interact: [0.91, 0.43, 1, 0.85], crouch: [0.79, 0.87, 1, 0.8], reload: [0.7, 0.74, 1, 0.75], swap: [0.7, 0.5, 1, 0.75],
  gadget: [0.79, 0.58, 1, 0.8], gnext: [0.715, 0.5, 1, 0.75], gadget0: [0.3, 0.9, 1, 0.75], gadget1: [0.38, 0.9, 1, 0.75],
  ability: [0.68, 0.86, 1, 0.75], cmds: [0.5, 0.82, 1, 0.9],
};
function toObj(src) { const o = {}; for (const id in src) { const [x, y, s, a] = src[id]; o[id] = { x, y, s, o: a }; } return o; }
export function defaultLayouts() { return { portrait: toObj(P), landscape: toObj(Lnd) }; }
export function mirrorLayout(l) { const o = {}; for (const id in l) o[id] = { ...l[id], x: 1 - l[id].x }; return o; }
export const LAYOUT_VERSION = 2;
