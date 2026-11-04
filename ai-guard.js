// Guard state machine:
// idle (posted) · patrol · suspicious · investigating · reporting · combat · searching · returning · (stunned overlay)
import { angDiff, dist, turnToward, RNG } from './core-util.js';
import { findPath, lineOfSight, DOOR_OPEN } from './world-grid.js';
import { cellFree } from './world-building.js';
import { ENEMY_TYPES, ENEMY_WEAPONS, REPORT_TIME } from './game-data.js';
import { sensePlayer, guardSeesPoint } from './ai-perception.js';

const PERCEPTION_STEP = 0.05;
const rng = new RNG(1234);

export function setPath(game, e, x, y) {
  const path = findPath(game.world, e.x, e.y, x, y);
  e.pathGoal = [x, y];
  if (!path) { e.path = null; return false; }
  e.path = path.map(([cx, cy]) => [cx + 0.5, cy + 0.5]);
  if (e.path.length) e.path[e.path.length - 1] = [x, y];
  else e.path = [[x, y]];
  return true;
}

// Follow e.path. Opens doors along the way. Returns true when arrived.
export function followPath(game, e, speed, dt, faceMove = true) {
  e.speed = 0;
  if (!e.path || !e.path.length) return true;
  const m = game.map;
  let [tx, ty] = e.path[0];
  const cx = Math.floor(tx), cy = Math.floor(ty);
  const di = m.doorAt[cy * m.w + cx];
  if (di >= 0 && game.world.doors[di] !== DOOR_OPEN) {
    if (dist(e.x, e.y, tx, ty) < 1.35) game.openDoor(di, e);
  }
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (faceMove && d > 0.05) e.facing = turnToward(e.facing, Math.atan2(dy, dx), 7 * dt);
  if (d <= step) {
    e.x = tx; e.y = ty; e.path.shift();
    e.speed = speed;
    e.walkPhase = (e.walkPhase || 0) + step * 3.2;
    return e.path.length === 0;
  }
  e.x += (dx / d) * step; e.y += (dy / d) * step;
  e.speed = speed;
  e.walkPhase = (e.walkPhase || 0) + step * 3.2;
  return false;
}

function goTo(game, g, x, y) {
  if (g.pathGoal && Math.abs(g.pathGoal[0] - x) < 0.3 && Math.abs(g.pathGoal[1] - y) < 0.3 && g.path) return true;
  return setPath(game, g, x, y);
}

export function confirmPlayer(game, g) {
  const p = game.player;
  g.lastKnown = { x: p.x, y: p.y };
  g.susp = 1;
  g.lostT = 0;
  if (!g.confirmed) { g.confirmed = true; game.onDetected(g); }
  if (!g.reported && g.reportT < 0) startReport(game, g, 'player');
  else if (g.reportT < 0 && g.state !== 'combat') enterCombat(game, g);
}
export function startReport(game, g, reason) {
  g.state = 'reporting';
  g.reportT = REPORT_TIME;
  g.reportReason = reason;
  g.path = null;
  game.emit({ t: 'report_start', id: g.id, x: g.x, y: g.y, reason });
}
export function enterCombat(game, g) {
  if (g.state === 'combat') return;
  g.state = 'combat';
  g.reactT = 0; g.fireCD = 0.2; g.burst = 0; g.path = null;
}
export function startSearch(game, g, x, y, alerted = false) {
  g.state = 'searching';
  g.lastKnown = { x, y };
  g.searchT = (alerted ? 16 : 13) * (g.prepared ? 1.5 : 1);
  g.searchPts = buildSearchPoints(game, g, x, y);
  g.path = null; g.inspect = -1;
}
function buildSearchPoints(game, g, x, y) {
  const m = game.map;
  const pts = [{ x, y }];
  // known hiding spot first
  if (g.knownSpot >= 0) pts.unshift({ spot: g.knownSpot });
  const spots = m.hideSpots.filter(s => dist(s.x, s.y, x, y) < 5.5 && !g.checked.includes(s.id) && s.id !== g.knownSpot);
  spots.sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y));
  const pChk = g.prepared ? 0.95 : 0.55;
  for (const s of spots.slice(0, 3)) if (rng.chance(pChk)) pts.push({ spot: s.id });
  for (let i = 0; i < 4; i++) {
    for (let tries = 0; tries < 8; tries++) {
      const cx = Math.floor(x + rng.range(-4, 4)), cy = Math.floor(y + rng.range(-4, 4));
      if (!cellFree(m, cx, cy)) continue;
      if (m.apt[cy * m.w + cx] !== m.apt[Math.floor(y) * m.w + Math.floor(x)]) continue;
      pts.push({ x: cx + 0.5, y: cy + 0.5 });
      break;
    }
  }
  return pts;
}

// React to a noise event
export function hearNoise(game, g, n) {
  if (g.down || g.stunT > 0) return;
  const loud = n.kind === 'gunshot' || n.kind === 'bang';
  if (g.state === 'combat') { if (!g.seePlayer && loud) g.lastKnown = { x: n.x, y: n.y }; return; }
  if (g.state === 'reporting') return;
  const amt = { gunshot: 0.95, bang: 0.95, suppressed: 0.6, footstep: 0.22, glass: 0.45, squeak: 0.38, door: 0.32, decoy: 0.75, takedown: 0.55, body: 0.45, light: 0.35, impact: 0.5 }[n.kind] ?? 0.3;
  g.susp = Math.min(0.99, Math.max(g.susp, loud ? amt : g.susp + amt));
  g.target = { x: n.x, y: n.y };
  g.urgent = loud;
  if (g.state === 'searching') { g.lastKnown = { x: n.x, y: n.y }; g.searchPts = buildSearchPoints(game, g, n.x, n.y); g.path = null; g.searchT = Math.max(g.searchT, 8); return; }
  if (loud || n.kind === 'decoy' || g.susp >= 0.55) { setInvestigate(game, g, n.x, n.y, loud); }
  else if (g.susp >= 0.2 && (g.state === 'idle' || g.state === 'patrol' || g.state === 'returning')) { g.state = 'suspicious'; g.idleT = 0; g.path = null; }
}
function setInvestigate(game, g, x, y, urgent) {
  g.state = 'investigating';
  g.target = { x, y };
  g.urgent = urgent;
  g.lookT = 0; g.idleT = 0;
  g.path = null; g.pathGoal = null;
}

export function updateGuard(game, g, dt) {
  if (g.down) return;
  const def = ENEMY_TYPES[g.type];
  g.hurtT = Math.max(0, (g.hurtT || 0) - dt);
  if (g.tranqT >= 0) {
    g.tranqT -= dt;
    if (g.tranqT <= 0) { g.tranqT = -1; game.knockOut(g, 'tranq'); return; }
  }
  // Independent report countdown (gameplay time). Only killing/incapacitating stops it.
  if (g.reportT >= 0) {
    g.reportT -= dt;
    if (g.reportT <= 0) { g.reportT = -1; g.reported = true; game.reportComplete(g); if (g.state === 'reporting') enterCombat(game, g); }
  }
  if (g.stunT > 0) { g.stunT -= dt; g.speed = 0; if (g.stunT <= 0 && g.state !== 'combat' && g.state !== 'reporting') { g.state = 'investigating'; g.urgent = true; } return; }
  if (game.graceT > 0) { idleMove(game, g, dt, def); return; }
  // Perception at fixed sub-rate
  g.percAcc = (g.percAcc || 0) + dt;
  while (g.percAcc >= PERCEPTION_STEP) { g.percAcc -= PERCEPTION_STEP; perceive(game, g, PERCEPTION_STEP); }
  switch (g.state) {
    case 'idle': case 'patrol': idleMove(game, g, dt, def); break;
    case 'suspicious': {
      g.speed = 0;
      if (g.target) g.facing = turnToward(g.facing, Math.atan2(g.target.y - g.y, g.target.x - g.x), 3 * dt);
      g.idleT += dt;
      if (g.susp >= 0.55) setInvestigate(game, g, g.target.x, g.target.y, false);
      else if (g.idleT > 2.5 && g.susp < 0.2) returnToDuty(g);
      break;
    }
    case 'investigating': {
      const t = g.target;
      if (!t) { returnToDuty(g); break; }
      if (!g.path || !g.pathGoal || g.pathGoal[0] !== t.x || g.pathGoal[1] !== t.y) {
        if (!setPath(game, g, t.x, t.y)) { g.lookT = 3; }
      }
      const arrived = g.lookT > 0 || followPath(game, g, g.urgent ? def.run : def.walk * 1.1, dt) || dist(g.x, g.y, t.x, t.y) < 0.6;
      if (arrived) {
        g.speed = 0;
        g.lookT += dt;
        g.facing += Math.sin(g.lookT * 2.2) * 2.2 * dt;
        if (g.lookT > 3.2) {
          if (g.urgent || g.susp > 0.7) startSearch(game, g, t.x, t.y);
          else returnToDuty(g);
        }
      }
      break;
    }
    case 'reporting': {
      g.speed = 0;
      if (g.lastKnown) g.facing = turnToward(g.facing, Math.atan2(g.lastKnown.y - g.y, g.lastKnown.x - g.x), 4 * dt);
      break;
    }
    case 'combat': combat(game, g, dt, def); break;
    case 'searching': search(game, g, dt, def); break;
    case 'returning': {
      const goal = g.post ? [g.post.x, g.post.y] : g.route ? g.route[g.routeIdx % g.route.length] : null;
      if (!goal) { g.state = 'idle'; break; }
      if (!g.path || !g.pathGoal || g.pathGoal[0] !== goal[0] || g.pathGoal[1] !== goal[1]) { if (!setPath(game, g, goal[0], goal[1])) { g.state = g.post ? 'idle' : 'patrol'; break; } }
      if (followPath(game, g, def.walk, dt)) { g.state = g.post ? 'idle' : 'patrol'; g.susp = 0; g.alertBoost = Math.max(g.alertBoost, 1.15); g.pauseT = 1; }
      break;
    }
  }
}

function returnToDuty(g) {
  g.state = 'returning'; g.path = null; g.pathGoal = null; g.target = null; g.urgent = false; g.inspect = -1;
}

function idleMove(game, g, dt, def) {
  if (g.state === 'idle' || g.post) {
    if (g.post && dist(g.x, g.y, g.post.x, g.post.y) > 0.25) {
      if (!g.path) setPath(game, g, g.post.x, g.post.y);
      followPath(game, g, def.walk, dt);
      return;
    }
    g.speed = 0;
    g.lookT += dt;
    const sweep = g.prepared ? 0.3 : 0.5;
    const target = (g.post ? g.post.facing : g.lookBase) + Math.sin(g.lookT * 0.55) * sweep;
    g.facing = turnToward(g.facing, target, 1.5 * dt);
    return;
  }
  // patrol
  if (g.pauseT > 0) {
    g.pauseT -= dt; g.speed = 0; g.lookT += dt;
    g.facing = turnToward(g.facing, g.lookBase + Math.sin(g.lookT * 0.9) * (g.prepared ? 1.2 : 0.8), 2 * dt);
    return;
  }
  const wp = g.route[g.routeIdx % g.route.length];
  if (!g.path || !g.pathGoal || g.pathGoal[0] !== wp[0] || g.pathGoal[1] !== wp[1]) setPath(game, g, wp[0], wp[1]);
  if (followPath(game, g, def.walk * (g.prepared ? 0.85 : 1), dt)) {
    g.routeIdx = (g.routeIdx + 1) % g.route.length;
    g.pauseT = (1.2 + Math.random() * 1.8) * (g.prepared ? 1.6 : 1);
    g.lookBase = g.facing; g.lookT = 0; g.path = null;
  }
}

function perceive(game, g, step) {
  const s = sensePlayer(game, g);
  g.seePlayer = s.seen;
  if (s.seen) game.onGuardSeesPlayer(g);
  if (s.confirm) { confirmPlayer(game, g); }
  else if (s.seen) {
    g.susp = Math.min(1, g.susp + s.gain * step);
    g.target = { x: game.player.x, y: game.player.y };
    if (g.susp >= 1) confirmPlayer(game, g);
    else if (g.susp >= 0.25 && (g.state === 'idle' || g.state === 'patrol' || g.state === 'returning')) { g.state = 'suspicious'; g.idleT = 0; g.path = null; }
    else if (g.state === 'suspicious' && g.susp >= 0.55) setInvestigate(game, g, g.target.x, g.target.y, false);
    else if (g.state === 'investigating') g.target = { x: game.player.x, y: game.player.y };
  } else if (g.state !== 'combat' && g.state !== 'reporting' && g.state !== 'searching') {
    g.susp = Math.max(0, g.susp - 0.1 * step);
  }
  if (g.state === 'reporting' && s.seen) g.lastKnown = { x: game.player.x, y: game.player.y };
  // bodies of fellow guards
  if (g.state !== 'combat') {
    for (const o of game.fs.guards) {
      if (o === g || !o.down || o.found || o.carried || o.bodyHidden >= 0) continue;
      if (dist(g.x, g.y, o.x, o.y) > 12) continue;
      if (!guardSeesPoint(game, g, o.x, o.y)) continue;
      o.found = true;
      game.emit({ t: 'body_found', id: g.id, x: o.x, y: o.y });
      g.lastKnown = { x: o.x, y: o.y };
      if (!g.reported && g.reportT < 0) startReport(game, g, 'body');
      else startSearch(game, g, o.x, o.y, true);
      return;
    }
  }
  // freed hostages moving around raise suspicion
  if (g.state === 'idle' || g.state === 'patrol' || g.state === 'returning') {
    for (const h of game.fs.hostages) {
      if (h.state !== 'free' || g.sawHostage.includes(h.id)) continue;
      if (dist(g.x, g.y, h.x, h.y) > 10 || !guardSeesPoint(game, g, h.x, h.y)) continue;
      g.sawHostage.push(h.id);
      g.susp = Math.max(g.susp, 0.6);
      setInvestigate(game, g, h.x, h.y, false);
      game.emit({ t: 'hostage_spotted', id: g.id });
      break;
    }
  }
}

function combat(game, g, dt, def) {
  const p = game.player;
  const w = ENEMY_WEAPONS[def.weapon];
  if (g.seePlayer && !p.dead) {
    g.lostT = 0;
    g.lastKnown = { x: p.x, y: p.y };
    const ang = Math.atan2(p.y - g.y, p.x - g.x);
    g.facing = turnToward(g.facing, ang, 6 * dt);
    g.aimT = 0.3;
    g.reactT += dt;
    const d = dist(g.x, g.y, p.x, p.y);
    if (d > w.range * 0.9) { if (!g.path || (g.repathT || 0) <= 0) { setPath(game, g, p.x, p.y); g.repathT = 0.6; } g.repathT = (g.repathT || 0) - dt; followPath(game, g, def.run * 0.8, dt, false); }
    else g.speed = 0;
    if (g.reactT >= game.diff.reaction && Math.abs(angDiff(g.facing, ang)) < 0.25) {
      g.fireCD -= dt;
      if (g.fireCD <= 0) {
        if (g.burst <= 0) { g.burst = w.burst; }
        game.enemyFire(g, w);
        g.burst--;
        g.fireCD = g.burst > 0 ? w.rate : w.pause + Math.random() * 0.4;
      }
    }
    // leaders pull nearby squad into the fight
    if (def.leader) {
      g.coordT = (g.coordT || 0) - dt;
      if (g.coordT <= 0) {
        g.coordT = 2;
        for (const o of game.fs.guards) {
          if (o === g || o.down || o.state === 'combat' || o.state === 'reporting') continue;
          if (dist(o.x, o.y, g.x, g.y) > 12) continue;
          o.lastKnown = { ...g.lastKnown }; enterCombat(game, o); o.seePlayer = false;
        }
      }
    }
  } else {
    g.reactT = Math.max(0, g.reactT - dt * 2);
    g.lostT += dt;
    g.aimT = Math.max(0, (g.aimT || 0) - dt);
    const lk = g.lastKnown;
    if (!lk) { startSearch(game, g, g.x, g.y); return; }
    if (g.lostT > 0.6) {
      if (!g.path || !g.pathGoal || dist(g.pathGoal[0], g.pathGoal[1], lk.x, lk.y) > 0.5) setPath(game, g, lk.x, lk.y);
      const arrived = followPath(game, g, def.run * (g.prepared ? 0.8 : 1), dt);
      if (arrived || g.lostT > 9) startSearch(game, g, lk.x, lk.y, true);
    } else g.speed = 0;
  }
}

function search(game, g, dt, def) {
  g.searchT -= dt;
  if (g.searchT <= 0) { returnToDuty(g); return; }
  const m = game.map;
  if (g.inspect >= 0) {
    const s = m.hideSpots[g.inspect];
    if (!g.path) {
      const acc = s.access.slice().sort((a, b) => dist(a[0] + 0.5, a[1] + 0.5, g.x, g.y) - dist(b[0] + 0.5, b[1] + 0.5, g.x, g.y))[0];
      if (!acc || !setPath(game, g, acc[0] + 0.5, acc[1] + 0.5)) { g.inspect = -1; return; }
    }
    if (followPath(game, g, def.walk * 1.2, dt)) {
      g.speed = 0;
      g.facing = turnToward(g.facing, Math.atan2(s.y - g.y, s.x - g.x), 5 * dt);
      g.inspectT += dt;
      if (g.inspectT > 1.1) {
        g.checked.push(s.id);
        const id = g.inspect;
        g.inspect = -1; g.inspectT = 0; g.path = null;
        game.inspectHideSpot(g, id);
      }
    }
    return;
  }
  if (!g.path) {
    const next = g.searchPts && g.searchPts.shift();
    if (!next) { g.searchPts = buildSearchPoints(game, g, g.lastKnown.x, g.lastKnown.y); g.lookT = 0; return; }
    if (next.spot != null) { if (!g.checked.includes(next.spot)) { g.inspect = next.spot; g.inspectT = 0; } return; }
    setPath(game, g, next.x, next.y);
    g.lookT = 0;
  }
  if (followPath(game, g, def.walk * 1.25, dt)) {
    g.speed = 0;
    g.lookT += dt;
    g.facing += Math.sin(g.lookT * 2.6) * 2.5 * dt;
    if (g.lookT > 1.6) { g.path = null; }
  }
}
