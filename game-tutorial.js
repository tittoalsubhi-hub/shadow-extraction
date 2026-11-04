// Playable tutorial: scripted steps on the Training Flat that advance on real gameplay events.
import { createRun, newAptStats } from './game-run.js';
import { makeGuard, makeHostage } from './game-populate.js';
import { RNG, dist } from './core-util.js';
import { DOOR_CLOSED, DOOR_OPEN } from './world-grid.js';
import { markersOf } from './world-building.js';

export function createTutorialRun() {
  const run = createRun({ seed: 4242, difficulty: 'normal', tutorial: true, startApt: 'A1' });
  run.apts = { TUT: { id: 'TUT', label: 'T', floor: -1, slot: 0, status: 'untouched', prepared: false, preparedApplied: false, progress: 0, stats: newAptStats(), rewardClaimed: false } };
  run.startApt = 'TUT';
  run.floor = -1;
  run.player.gadgets = [{ id: 'decoy', count: 2 }, { id: 'smoke', count: 1 }];
  return run;
}

export function populateTutorial(game) {
  const map = game.map;
  const rng = new RNG(7);
  const fs = { floor: -1, guards: [], hostages: [], cameras: [], items: [], doors: map.doors.map(() => DOOR_CLOSED), lights: map.rooms.map(() => 1), discovered: '', roomsSeen: [], populated: true };
  // Hall patrol
  const pg = makeGuard('patrol', 20.5, 2.5, Math.PI, 0, { state: 'patrol' });
  pg.route = [[20.5, 2.5], [13.5, 4.5]]; pg.routeIdx = 1; pg.pauseT = 4;
  fs.guards.push(pg);
  // Office watcher facing the door from the hall
  const post = markersOf(map, 0, 1)[0];
  const wg = makeGuard('patrol', post.x + 0.5, post.y + 0.5, -Math.PI / 2, 0, { state: 'idle' });
  wg.post = { x: wg.x, y: wg.y, facing: -Math.PI / 2 + 0.25 };
  fs.guards.push(wg);
  const hm = markersOf(map, 0, 2)[0];
  const h = makeHostage(hm.x + 0.5, hm.y + 0.5, 0, rng); h.state = 'restrained';
  fs.hostages.push(h);
  fs.items.push({ id: 900001, kind: 'crate', x: 4.5, y: 4.5, apt: 0, opened: false, contents: { type: 'gadget', id: 'flash', count: 1 } });
  return fs;
}

const STEPS = [
  { id: 'move', title: 'Movement', text: 'Use the left stick (or WASD) to move. Push the stick only part-way to walk quietly; push fully to run — running is loud. Pinch or double-tap the view to zoom.', done: (g, s) => s.moved > 4 },
  { id: 'crouch', title: 'Crouch', text: 'Tap CROUCH. Crouching makes you quieter and harder to spot and lets low furniture hide you — but you are never invisible.', done: (g) => g.player.crouch },
  { id: 'crate', title: 'Supplies', text: 'Open the supply crate (USE). Gadgets go on the ITEM button; ⇄ switches between your two gadgets. Crates hold ammo, gadgets or weapons. Weapon crates show a comparison before you swap.', done: (g, s) => s.ev.pickup || s.ev.weapon_found },
  { id: 'door', title: 'Doors & flashlights', text: 'Ease the door open while crouched (USE). Guards carry flashlights: being caught in a beam with a clear line of sight is an instant detection. Walls and closed doors block sight.', done: (g) => g.world.doors[g.map.doorAt[3 * g.map.w + 7]] !== DOOR_CLOSED },
  { id: 'hide', title: 'Hiding', text: 'A patrol walks the hall. Step into the wardrobe beside the door (USE) and wait. Guards only check hiding places if they saw you enter or are actively searching.', done: (g, s) => s.ev.hide },
  { id: 'takedown', title: 'Takedowns', text: 'Leave the wardrobe and sneak up behind the patrol: the ATTACK button turns into a TAKEDOWN. The LETHAL chip under your weapon switches to non-lethal. Then drag the body (USE) into the wardrobe.', done: (g, s) => s.ev.takedown },
  { id: 'report', title: 'The 4-second report', text: 'A guard watches the next door. When a guard confirms you, a 4.0 s RADIO REPORT timer appears above them. Take them down or shoot them before it reaches zero. Hiding does NOT cancel a report. A finished report alerts nearby guards and puts the next apartment on heightened alert.', done: (g, s) => s.ev.report_interrupted || s.ev.report_done || g.fs.guards[1].down },
  { id: 'hostage', title: 'Hostages', text: 'Cut the hostage free (USE). Freed hostages take FOLLOW, WAIT and EVACUATE commands from the chips above your controls. Send them to the green extraction marker.', done: (g, s) => g.fs.hostages[0].state === 'evacuated' },
  { id: 'extract', title: 'Secure the apartment', text: 'Stand near the extraction marker once everyone is out and no one is in combat. Each secured apartment lets you choose one of three upgrades.', done: (g, s) => s.ev.apt_complete },
];

export class Tutorial {
  constructor() { this.i = 0; this.s = { moved: 0, ev: {} }; this.last = null; this.changed = true; this.reportNote = null; }
  get step() { return STEPS[this.i]; }
  get total() { return STEPS.length; }
  onEvents(game, events) {
    for (const e of events) {
      this.s.ev[e.t] = (this.s.ev[e.t] || 0) + 1;
      if (e.t === 'report_done') this.reportNote = 'Report transmitted! In a real operation nearby guards would converge and the next apartment you enter would be prepared. Keep going.';
      if (e.t === 'report_interrupted') this.reportNote = 'Report interrupted — no alert went out.';
    }
  }
  update(game, dt) {
    const p = game.player;
    if (this.last) this.s.moved += dist(this.last[0], this.last[1], p.x, p.y);
    this.last = [p.x, p.y];
    let guard = 0;
    while (this.i < STEPS.length && STEPS[this.i].done(game, this.s) && guard++ < STEPS.length) { this.i++; this.changed = true; }
  }
}
