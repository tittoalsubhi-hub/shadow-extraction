// Hostage behavior: restrained / frightened until freed, then Follow, Wait (seek cover), Evacuate.
import { dist } from './core-util.js';
import { cellFree } from './world-building.js';
import { lineOfSight } from './world-grid.js';
import { setPath, followPath } from './ai-guard.js';

export function updateHostage(game, h, dt) {
  if (h.state !== 'free') { h.speed = 0; return; }
  const p = game.player;
  h.repathT -= dt;
  if (h.order === 'follow') {
    h.cover = null;
    const d = dist(h.x, h.y, p.x, p.y);
    if (d > 1.7) {
      if (!h.path || h.repathT <= 0) {
        h.repathT = 0.5;
        if (!setPath(game, h, p.x, p.y)) h.path = null;
        // stop one step short of the player
        if (h.path && h.path.length) h.path.pop();
      }
      const sp = Math.min(3.6, Math.max(2.2, (p.speedNow || 0) + 0.4));
      followPath(game, h, sp, dt);
    } else { h.speed = 0; h.path = null; h.facing = Math.atan2(p.y - h.y, p.x - h.x); }
    h.crouch = p.crouch;
  } else if (h.order === 'wait') {
    if (!h.cover) h.cover = findCover(game, h) || [h.x, h.y];
    if (dist(h.x, h.y, h.cover[0], h.cover[1]) > 0.15) {
      if (!h.path || !h.pathGoal || h.pathGoal[0] !== h.cover[0]) { if (!setPath(game, h, h.cover[0], h.cover[1])) h.cover = [h.x, h.y]; }
      followPath(game, h, 2.0, dt);
    } else { h.speed = 0; h.path = null; }
    h.crouch = true;
  } else if (h.order === 'evacuate') {
    const ex = game.extractionFor(h.apt);
    if (!ex) { h.order = 'wait'; return; }
    if (!h.path || !h.pathGoal || h.pathGoal[0] !== ex.x || h.repathT < -6) {
      h.repathT = 0;
      if (!setPath(game, h, ex.x, ex.y)) { h.order = 'wait'; game.emit({ t: 'msg', text: 'Hostage cannot reach the exit from here.' }); return; }
    }
    h.crouch = false;
    if (followPath(game, h, 2.7, dt) || dist(h.x, h.y, ex.x, ex.y) < 0.45) game.hostageEvacuated(h);
  }
}

// Nearest free cell within 4 tiles adjacent to furniture, preferring cells no guard can see.
export function findCover(game, h) {
  const m = game.map;
  const hx = Math.floor(h.x), hy = Math.floor(h.y);
  const room = m.room[hy * m.w + hx];
  let best = null, bs = 1e9;
  for (let y = hy - 4; y <= hy + 4; y++) for (let x = hx - 4; x <= hx + 4; x++) {
    if (!cellFree(m, x, y)) continue;
    const r = m.room[y * m.w + x];
    if (r !== room) continue;
    let adj = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = (y + dy) * m.w + x + dx;
      if (m.prop[i] >= 0 && (m.props[m.prop[i]].cover || m.props[m.prop[i]].tall)) adj++;
    }
    if (!adj) continue;
    let exposed = 0;
    for (const g of game.fs.guards) if (!g.down && dist(g.x, g.y, x + 0.5, y + 0.5) < 9 && lineOfSight(game.world, g.x, g.y, x + 0.5, y + 0.5, { lowBlocksNearTarget: true })) exposed++;
    const sc = dist(hx, hy, x, y) + exposed * 6 - adj * 0.5;
    if (sc < bs) { bs = sc; best = [x + 0.5, y + 0.5]; }
  }
  return best;
}
