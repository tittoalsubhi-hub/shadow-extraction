// Touch control layout definitions & defaults. Positions are fractions of the safe-area rect (centers).
export const CONTROL_DEFS = {
  stick:     { label: 'Move', kind: 'stick', base: 132 },
  aim:       { label: 'Aim', kind: 'stick', base: 116, optional: 'aimStick' },
  fire:      { label: 'FIRE', kind: 'button', base: 76, action: 'fire', hideIf: 'contextualAttack' },
  attack:    { label: 'ATTACK', kind: 'button', base: 80, action: 'attack', showIf: 'contextualAttack' },
  takedown:  { label: 'TAKE\nDOWN', kind: 'button', base: 62, action: 'takedown', hideIf: 'contextualAttack' },
  tdmode:    { label: 'LTH', kind: 'button', base: 38, action: 'toggleTakedownMode' },
  interact:  { label: 'USE', kind: 'button', base: 64, action: 'interact' },
  crouch:    { label: 'CROUCH', kind: 'button', base: 56, action: 'crouch' },
  reload:    { label: 'RELOAD', kind: 'button', base: 48, action: 'reload' },
  swap:      { label: 'SWAP', kind: 'button', base: 48, action: 'swap' },
  gadget0:   { label: 'G1', kind: 'button', base: 50, action: 'gadget0' },
  gadget1:   { label: 'G2', kind: 'button', base: 50, action: 'gadget1' },
  ability:   { label: 'ABIL', kind: 'button', base: 50, action: 'ability' },
  cmds:      { label: 'Hostage commands', kind: 'group', base: 44 },
};
export const CONTROL_IDS = Object.keys(CONTROL_DEFS);

const P = {
  stick: [0.2, 0.84, 1, 0.7], aim: [0.72, 0.5, 1, 0.6],
  fire: [0.86, 0.86, 1.1, 0.85], attack: [0.86, 0.86, 1.1, 0.85], takedown: [0.66, 0.9, 1, 0.8], tdmode: [0.53, 0.9, 1, 0.75],
  interact: [0.86, 0.73, 1, 0.85], crouch: [0.67, 0.78, 1, 0.8], reload: [0.93, 0.63, 1, 0.75], swap: [0.77, 0.63, 1, 0.75],
  gadget0: [0.44, 0.96, 1, 0.75], gadget1: [0.53, 0.8, 1, 0.75], ability: [0.62, 0.68, 1, 0.75], cmds: [0.5, 0.58, 1, 0.9],
};
const Lnd = {
  stick: [0.13, 0.73, 1, 0.7], aim: [0.62, 0.62, 1, 0.6],
  fire: [0.92, 0.74, 1.1, 0.85], attack: [0.92, 0.74, 1.1, 0.85], takedown: [0.81, 0.86, 1, 0.8], tdmode: [0.885, 0.97, 1, 0.75],
  interact: [0.92, 0.47, 1, 0.85], crouch: [0.81, 0.6, 1, 0.8], reload: [0.71, 0.75, 1, 0.75], swap: [0.71, 0.55, 1, 0.75],
  gadget0: [0.3, 0.9, 1, 0.75], gadget1: [0.38, 0.9, 1, 0.75], ability: [0.46, 0.9, 1, 0.75], cmds: [0.5, 0.72, 1, 0.9],
};
function toObj(src) { const o = {}; for (const id in src) { const [x, y, s, a] = src[id]; o[id] = { x, y, s, o: a }; } return o; }
export function defaultLayouts() { return { portrait: toObj(P), landscape: toObj(Lnd) }; }
export function mirrorLayout(l) { const o = {}; for (const id in l) o[id] = { ...l[id], x: 1 - l[id].x }; return o; }
