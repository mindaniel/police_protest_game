/* police.js - police squads, vehicles, stances, tools, observation, arrests.
 * Exposes a global Police object. All coordinates are in tile units.
 * Hooks into crowd.js through G.officers, Crowd.arrest, Crowd.loudspeaker,
 * Crowd.neighbors, Crowd.rebuildFlow. Owns agent.suspicion.
 */
var Police = (function () {
  "use strict";

  /* CONFIG lives in game.js, which is loaded AFTER police.js, so it does not
   * exist yet while this IIFE is evaluated. Read it lazily, when called. */
  function escortSpeed() { return CONFIG.escortSpeed || 1.4; }
  function escortArrivalRadius() { return CONFIG.escortArrivalRadius || 1.6; }
  function escortLoadTime() { return CONFIG.escortLoadTime || 1.0; }
  function escortSafetyTime() { return CONFIG.escortSafetyTime || 40; }
  function escortNoCarHoldTime() { return CONFIG.escortNoCarHoldTime || 4; }

  /* Default loadouts, one string per squad (index 0 = squad 1). Only strings
   * here; init() copies them into G.squadLoadouts. */
  var DEFAULT_LOADOUTS = ["car", "watertruck", "barriertruck", "motorbike", "none", "none"];
  var planned = null;   /* force planned in force.js (one loadout per squad), or null */
  function setForce(list) { planned = (list && list.length) ? list.slice(0, CONFIG.maxSquads || 10) : null; }

  function loadoutOf(G, squadIndex) {
    if (G && G.squadLoadouts && typeof G.squadLoadouts[squadIndex] === "string") {
      return G.squadLoadouts[squadIndex];
    }
    return "none";
  }
  function loadoutCost(name) {
    var defs = CONFIG.loadouts || {};
    var def = defs[name];
    return def ? (def.cost || 0) : 0;
  }
  function vehicleTypeFor(loadout) {
    var v = UNITTYPES.vehicle(loadout);
    return v ? v.type : null;
  }
  function vehicleSpeedFor(type) {
    var v = UNITTYPES.vehicle(type);
    if (v && v.speed === "van") return CONFIG.carSpeed * 0.85;
    return v && v.speed === "car" ? CONFIG.carSpeed : CONFIG.truckSpeed;
  }
  function officersPerSquadFor(loadout) {
    return UNITTYPES.get(loadout).officers || CONFIG.officersPerSquad;
  }
  function officerSpeedFor(loadout) {
    var k = UNITTYPES.get(loadout).officerSpeed;
    if (k === "mounted") return CONFIG.mountedSpeed || 3.0;
    return k === "motorbike" ? CONFIG.motorbikeSpeed : CONFIG.officerSpeed;
  }
  var nextDetaineeId = 1;

  function tkey(x, y) { return x + "," + y; }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < MAP.width && y < MAP.height;
  }
  function isSolid(G, x, y) {
    if (!inBounds(x, y)) return true;
    var ch = MAP.rows[y].charAt(x);
    if (ch === "#" || ch === "S" || ch === "W") return true;
    if (G.blocked && G.blocked.has(tkey(x, y))) return true;
    return false;
  }

  /* Solid test for police units: buildings and shops only. Barriers do NOT block police. */
  function isSolidPolice(G, x, y) {
    if (!inBounds(x, y)) return true;
    var ch = MAP.rows[y].charAt(x);
    if (ch === "#" || ch === "S" || ch === "W") return true;
    /* finished protester barricades stop police and vehicles */
    return !!(G && G.barricadeTiles && G.barricadeTiles.size && G.barricadeTiles.has(tkey(x, y)));
  }

  /* Turn rate per vehicle type; CONFIG is read here because it loads later. */
  function vehTurnRate(type) {
    var C = (typeof CONFIG !== "undefined") ? CONFIG : {};
    if (typeof C.vehicleTurnRate === "number") return C.vehicleTurnRate;
    if (type === "truck" || type === "watertruck" || type === "barriertruck" || type === "fireengine") return 1.4;
    if (type === "van" || type === "ambulance") return 1.8;
    return 2.2;
  }

  var VEH_OFFSET_X = -1.9;   /* vehicle parks this far west of the squad centre */

  /* Default squad centres: six squads, four on the main boulevard (row 18) and
   * two on the lower boulevard (row 33). All are road tiles, none is within
   * two tiles of a crowd entrance, and no two centres coincide. */
  function defaultCenter(s) {
    if (CONFIG.squadCenters && CONFIG.squadCenters[s]) return CONFIG.squadCenters[s];
    if (CONFIG.squadCenters && CONFIG.squadCenters.length) {
      /* more squads than staging points: stand next to an earlier squad's point */
      var b = CONFIG.squadCenters[s % CONFIG.squadCenters.length], offs = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]];
      for (var oi = 0; oi < offs.length; oi++) {
        if (!isSolidPolice(null, Math.floor(b.x + offs[oi][0]), Math.floor(b.y + offs[oi][1]))) return { x: b.x + offs[oi][0], y: b.y + offs[oi][1] };
      }
      return b;
    }
    var centres = [
      { x: 10.5, y: 31.5 },   /* squad 1: car */
      { x: 14.5, y: 31.5 },   /* squad 2: water truck */
      { x: 18.5, y: 31.5 },   /* squad 3: barrier truck */
      { x: 26.5, y: 31.5 },   /* squad 4: motorbike */
      { x: 34.5, y: 31.5 },   /* squad 5: none */
      { x: 40.5, y: 31.5 }    /* squad 6: none */
    ];
    return centres[s] || centres[centres.length - 1];
  }

  /* Formation slot for officer k of n: a block two officers wide. */
  function slotOffset(k, n, gap) {
    var cols = 2, rows = Math.ceil(n / cols);
    gap = gap || 0.8;
    return {
      x: ((k % cols) - 0.5) * gap,
      y: (Math.floor(k / cols) - (rows - 1) / 2) * gap
    };
  }

  /* Where a unit really aims: its target plus its formation offset,
   * unless that spot is solid, then the plain target. */
  /* every vehicle type in src/units/*.js (van, riot truck, ambulance and fire engine
   * used to be missing here, so they moved like people on foot) */
  var VEH_TYPES = {};
  UNITTYPES.list().forEach(function (d) { if (d.vehicle) VEH_TYPES[d.vehicle.type] = true; });
  function isVehicle(e) {
    return !!(e && VEH_TYPES[e.type]);
  }
  function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

  /* One vehicle step toward (dx, dy) at distance d. The vehicle records the
   * heading it wants (turned by turnVehicle), turns in place when that is more
   * than 60 degrees off, otherwise drives along its CURRENT heading, slower
   * while turning. The last 0.6 tiles go straight to the spot (parking). */
  function vehStep(G, v, dx, dy, d, dt) {
    var want = Math.atan2(dy, dx);
    if (typeof v.ang !== "number") v.ang = want;
    v._wantAng = want;
    var diff = angDiff(want, v.ang);
    /* bicycle model: car, van 2.0, ambulance 2.0, trucks/fireengine 2.8 tiles */
    var radius = (v.type === "van" || v.type === "ambulance") ? 2.0 :
                 (v.type === "truck" || v.type === "watertruck" || v.type === "barriertruck" || v.type === "fireengine") ? 2.8 : 1.6;
    if (typeof v._revD !== "number") v._revD = 0;
    if (Math.abs(diff) < Math.PI / 6) v._revD = 0;   /* lined up again: next 3-point turn may reverse */
    if (d > 0.6 && Math.abs(diff) > 2.0) {
      /* target behind: reverse a short way with opposite steering (3-point turn), at most 2 tiles */
      if (typeof v._revT !== "number") v._revT = 0;
      if (v._revD < 2.0) {
        var rs = v.speed * 0.5 * dt;
        var rdx = -Math.cos(v.ang) * rs, rdy = -Math.sin(v.ang) * rs;
        var rnx = v.x + rdx, rny = v.y + rdy;
        if (!isSolidPolice(G, Math.floor(rnx), Math.floor(rny))) {
          v.x = rnx; v.y = rny;
          var rdist = Math.sqrt(rdx * rdx + rdy * rdy);
          var rmax = rdist / radius;
          var rdes = 2.2 * diff * dt;   /* nose swings toward the target */
          if (rdes > rmax) rdes = rmax;
          else if (rdes < -rmax) rdes = -rmax;
          v.ang += rdes;
          v._revT += dt;
          v._revD += rdist;
          return;
        }
      }
    }
    var step = v.speed * dt * Math.max(0.2, Math.cos(diff));
    if (step > d) step = d;
    var ux = d > 0.6 ? Math.cos(v.ang) : dx / d, uy = d > 0.6 ? Math.sin(v.ang) : dy / d;
    var nx = v.x + ux * step, ny = v.y + uy * step;
    var moved = false, distMoved = 0;
    if (!isSolidPolice(G, Math.floor(nx), Math.floor(ny))) {
      distMoved = Math.sqrt((nx - v.x) * (nx - v.x) + (ny - v.y) * (ny - v.y));
      v.x = nx; v.y = ny; moved = true;
    } else if (!isSolidPolice(G, Math.floor(nx), Math.floor(v.y))) {
      distMoved = Math.abs(nx - v.x);
      v.x = nx; moved = true;
    } else if (!isSolidPolice(G, Math.floor(v.x), Math.floor(ny))) {
      distMoved = Math.abs(ny - v.y);
      v.y = ny; moved = true;
    }
    if (moved && distMoved > 1e-6) {
      /* rotate only by distance moved / radius, never in place */
      var maxA = distMoved / radius;
      var desA = 2.2 * diff * dt;
      if (desA > maxA) desA = maxA;
      else if (desA < -maxA) desA = -maxA;
      var cap = vehTurnRate(v.type) * dt;
      if (desA > cap) desA = cap;
      else if (desA < -cap) desA = -cap;
      v.ang += desA;
    }
  }
  function turnVehicle(v, dt) {
    /* bicycle model: turning must be paid for by forward movement; no pivoting in place.
     * When called without movement info we only update the desired angle, and clamp
     * the actual heading change to the per-step turn budget so the fallback cannot spin. */
    if (typeof v.ang !== "number") v.ang = 0;
    if (typeof v._wantAng !== "number") return;
    var diff = angDiff(v._wantAng, v.ang), maxT = vehTurnRate(v.type) * dt;
    /* require the vehicle to have moved this step before we rotate */
    var moved = 0;
    if (typeof v._lastX === "number" && typeof v._lastY === "number") {
      var ddx = v.x - v._lastX, ddy = v.y - v._lastY;
      moved = Math.sqrt(ddx * ddx + ddy * ddy);
    } else {
      moved = Math.abs(v.speed * dt);
    }
    if (moved < 1e-6) { v._lastX = v.x; v._lastY = v.y; return; }
    var radius = (v.type === "van" || v.type === "ambulance") ? 2.0 :
                 (v.type === "truck" || v.type === "watertruck" || v.type === "barriertruck" || v.type === "fireengine") ? 2.8 : 1.6;
    var maxByArc = moved / radius;
    var lim = maxT < maxByArc ? maxT : maxByArc;
    if (Math.abs(diff) <= lim) v.ang += diff;
    else v.ang += (diff > 0 ? lim : -lim);
    v._lastX = v.x;
    v._lastY = v.y;
  }
  /* Face along the street at (x, y): east-west if that way is open, else north-south. */
  function streetAngle(G, x, y) {
    var tx = Math.floor(x), ty = Math.floor(y);
    return (!isSolidPolice(G, tx - 1, ty) || !isSolidPolice(G, tx + 1, ty)) ? 0 : Math.PI / 2;
  }

  function driveTileOk(G, x, y) {
    if (!inBounds(x, y)) return false;
    var ch = MAP.rows[y].charAt(x);
    if (ch !== "." && ch !== "P") return false;
    return !isSolidPolice(G, x, y);
  }

  function walkTileOk(G, x, y) {
    if (!inBounds(x, y)) return false;
    var ch = MAP.rows[y].charAt(x);
    if (ch !== "." && ch !== "a" && ch !== "P" && ch !== "G") return false;
    return !isSolidPolice(G, x, y);
  }

  function nearestAllowed(G, sx, sy, allow, maxR) {
    var w = MAP.rows[0].length, h = MAP.rows.length;
    var best = null, bestD = Infinity;
    for (var r = 0; r <= maxR; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var nx = sx + dx, ny = sy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!allow(nx, ny)) continue;
          var d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
        }
      }
      if (best) return best;   /* nearest ring found: stop searching */
    }
    return best;
  }

  function goalOf(G, e) {
    if (typeof e.kettleX === "number") return { x: e.kettleX, y: e.kettleY };
    var veh = isVehicle(e);
    var allow = veh
      ? function (x, y) { return driveTileOk(G, x, y); }
      : function (x, y) { return walkTileOk(G, x, y); };
    var gx = e.tx, gy = e.ty;
    if ((e.ox || e.oy) && !e.ctrl) {
      var cx = e.tx + e.ox, cy = e.ty + e.oy;
      if (allow(Math.floor(cx), Math.floor(cy))) { gx = cx; gy = cy; }
    }
    var gk = Math.floor(gx) + "," + Math.floor(gy);
    if (e._goalKey === gk && e._goalFix) return e._goalFix;   /* snapped goal is cached until the goal changes */
    if (!allow(Math.floor(gx), Math.floor(gy))) {
      var n = nearestAllowed(G, Math.floor(gx), Math.floor(gy), allow, 32);
      if (n) { gx = n.x + 0.5; gy = n.y + 0.5; }
      else if (allow(Math.floor(e.tx), Math.floor(e.ty))) { gx = e.tx; gy = e.ty; }
    }
    if (veh) {   /* park in the middle of the road, not against the kerb */
      var clr = driveClear(G), pw = MAP.rows[0].length, pen = kerbPenalty(G, clr, pw, MAP.rows.length);
      var gi = Math.floor(gy) * pw + Math.floor(gx);
      if (pen[gi] > 0) {
        var mid = nearestAllowed(G, Math.floor(gx), Math.floor(gy), function (x, y) { var j = y * pw + x; return clr[j] && pen[j] === 0; }, 3);
        if (mid) { gx = mid.x + 0.5; gy = mid.y + 0.5; }
      }
    }
    e._goalKey = gk; e._goalFix = { x: gx, y: gy };
    return { x: gx, y: gy };
  }

  /* Tile of a squad's home centre (first officer of that squad wins). */
  function homeTileFor(G, squadIndex) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) {
        return { x: Math.floor(G.officers[i].homeX), y: Math.floor(G.officers[i].homeY) };
      }
    }
    return null;
  }

  /* Per-squad BFS flow field from the squad's home tile over tiles the police
   * can walk on. Distances live in a flat Int16Array (W*H); -1 = unreachable.
   * Cached in G._policeFlow[squadIndex] and rebuilt only when the home tile
   * of that squad changes. */
  function policeFlowField(G, squadIndex) {
    var home = homeTileFor(G, squadIndex);
    if (!home) return null;
    var hx = Math.floor(home.x), hy = Math.floor(home.y);
    if (!walkTileOk(G, hx, hy)) {
      var n = nearestAllowed(G, hx, hy, function (x, y) { return walkTileOk(G, x, y); }, 32);
      if (!n) return null;
      hx = n.x; hy = n.y;
    }
    var key = hx + "," + hy + ":" + (G.blocked ? G.blocked.size : 0) + ":" + (G.barricadeTiles ? G.barricadeTiles.size : 0);
    if (!G._policeFlow) G._policeFlow = [];
    var cached = G._policeFlow[squadIndex];
    if (cached && cached.key === key) return cached.dist;
    var W = MAP.width || MAP.rows[0].length, H = MAP.height || MAP.rows.length;
    var dist = new Int16Array(W * H);
    var i;
    for (i = 0; i < dist.length; i++) dist[i] = -1;
    var q = [hx + hy * W];
    dist[hy * W + hx] = 0;
    var head = 0;
    while (head < q.length) {
      var idx = q[head++];
      var x = idx % W, y = (idx - x) / W, d = dist[idx];
      var nx, ny, ni;
      nx = x + 1;
      if (nx < W && walkTileOk(G, nx, y)) { ni = y * W + nx; if (dist[ni] < 0) { dist[ni] = d + 1; q.push(ni); } }
      nx = x - 1;
      if (nx >= 0 && walkTileOk(G, nx, y)) { ni = y * W + nx; if (dist[ni] < 0) { dist[ni] = d + 1; q.push(ni); } }
      ny = y + 1;
      if (ny < H && walkTileOk(G, x, ny)) { ni = ny * W + x; if (dist[ni] < 0) { dist[ni] = d + 1; q.push(ni); } }
      ny = y - 1;
      if (ny >= 0 && walkTileOk(G, x, ny)) { ni = ny * W + x; if (dist[ni] < 0) { dist[ni] = d + 1; q.push(ni); } }
    }
    G._policeFlow[squadIndex] = { key: key, dist: dist };
    return dist;
  }

  /* ---- vehicles drive only on streets at least 2 tiles wide and part crowds (DeepSeek) ---- */
  function driveClear(G) {
    var h = MAP.rows.length, w = MAP.rows[0].length;
    var key = h + ":" + (G.blocked ? G.blocked.size : 0) + ":" + (G.barricadeTiles ? G.barricadeTiles.size : 0);
    if (G._driveClear && G._driveClearKey === key) return G._driveClear;
    var solid = new Uint8Array(w * h);
    var x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) solid[y * w + x] = driveTileOk(G, x, y) ? 0 : 1;
    var clear = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (solid[y * w + x]) continue;
        if (x + 1 < w && y + 1 < h && !solid[y * w + x] && !solid[y * w + x + 1] && !solid[(y + 1) * w + x] && !solid[(y + 1) * w + x + 1]) { clear[y * w + x] = 1; continue; }
        if (x - 1 >= 0 && y + 1 < h && !solid[y * w + x - 1] && !solid[y * w + x] && !solid[(y + 1) * w + x - 1] && !solid[(y + 1) * w + x]) { clear[y * w + x] = 1; continue; }
        if (x + 1 < w && y - 1 >= 0 && !solid[(y - 1) * w + x] && !solid[(y - 1) * w + x + 1] && !solid[y * w + x] && !solid[y * w + x + 1]) { clear[y * w + x] = 1; continue; }
        if (x - 1 >= 0 && y - 1 >= 0 && !solid[(y - 1) * w + x - 1] && !solid[(y - 1) * w + x] && !solid[y * w + x - 1] && !solid[y * w + x]) { clear[y * w + x] = 1; continue; }
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (solid[y * w + x]) continue;
        if (x > 0 && x + 1 < w && clear[y * w + x - 1] && clear[y * w + x + 1]) clear[y * w + x] = 1;
        else if (y > 0 && y + 1 < h && clear[(y - 1) * w + x] && clear[(y + 1) * w + x]) clear[y * w + x] = 1;
      }
    }
    G._driveClear = clear;
    G._driveClearKey = key;
    return clear;
  }

  /* extra route cost per drivable tile: 2 beside a kerb or wall, 1 one tile further in */
  function kerbPenalty(G, clear, w, h) {
    if (G._kerbPen && G._kerbPenFor === clear) return G._kerbPen;
    var pen = new Uint8Array(w * h), i, x, y, k, near;
    var ring1 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var ring2 = [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    function blocked(xx, yy) { return xx < 0 || yy < 0 || xx >= w || yy >= h || !clear[yy * w + xx]; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      if (!clear[i]) continue;
      near = 0;
      for (k = 0; k < 4 && !near; k++) if (blocked(x + ring1[k][0], y + ring1[k][1])) near = 2;
      for (k = 0; k < 8 && !near; k++) if (blocked(x + ring2[k][0], y + ring2[k][1])) near = 1;
      pen[i] = near;
    }
    G._kerbPen = pen; G._kerbPenFor = clear;
    return pen;
  }

  function vehicleFlowField(G, sx, sy) {
    var clear = driveClear(G);
    var h = MAP.rows.length, w = MAP.rows[0].length;
    var cx = sx, cy = sy, r, dx, dy;
    if (!(sx >= 0 && sx < w && sy >= 0 && sy < h) || !clear[sy * w + sx]) {
      // nearest drivable tile within radius 6
      var found = false;
      for (r = 1; r <= 6 && !found; r++) {
        for (dy = -r; dy <= r && !found; dy++) {
          for (dx = -r; dx <= r && !found; dx++) {
            var nx = sx + dx, ny = sy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && clear[ny * w + nx]) { cx = nx; cy = ny; found = true; }
          }
        }
      }
      if (!found) cx = sx, cy = sy;
    }
    var key = cx + "," + cy;
    if (!G._vehFlow || G._vehFlowN > 48) { G._vehFlow = {}; G._vehFlowN = 0; }
    if (!G._vehFlow[key]) {
      var dist = new Int16Array(w * h);
      var i;
      for (i = 0; i < dist.length; i++) dist[i] = -1;
      if (cx >= 0 && cx < w && cy >= 0 && cy < h && clear[cy * w + cx]) {
        /* cheapest route, where tiles beside the kerb cost more: vehicles keep to the middle
         * of the road instead of scraping along walls (bucket queue, small integer costs) */
        var pen = kerbPenalty(G, clear, w, h);
        var buckets = [[cx + cy * w]], bi = 0, nb = [-1, 1, -w, w];
        dist[cy * w + cx] = 0;
        while (bi < buckets.length) {
          var bk = buckets[bi];
          if (!bk || !bk.length) { bi++; continue; }
          var idx = bk.pop();
          if (dist[idx] !== bi) continue;   /* stale entry */
          var x = idx % w;
          for (var k = 0; k < 4; k++) {
            var n = idx + nb[k];
            if ((k === 0 && x === 0) || (k === 1 && x + 1 >= w) || n < 0 || n >= w * h || !clear[n]) continue;
            var nd = bi + 1 + pen[n];
            if (dist[n] >= 0 && dist[n] <= nd) continue;
            dist[n] = nd;
            (buckets[nd] || (buckets[nd] = [])).push(n);
          }
        }
      }
      G._vehFlow[key] = dist;
      G._vehFlowN++;
    }
    return G._vehFlow[key];
  }

  function vehicleField(G, v, sx, sy) {
    var f = vehicleFlowField(G, sx, sy);
    var w = MAP.rows[0].length;
    var tx = Math.floor(v.x), ty = Math.floor(v.y);
    if (tx < 0 || ty < 0 || ty >= MAP.rows.length || tx >= w) return tileFlowField(G, sx, sy);
    if (f[ty * w + tx] === -1) return tileFlowField(G, sx, sy);
    return f;
  }

  function stepVehicleThroughCrowd(G, v, dt) {
    var cosA = Math.cos(v.ang), sinA = Math.sin(v.ang);
    var nb = Crowd.neighbors(G, v.x, v.y, 1.5);
    var n = 0, i, a;
    for (i = 0; i < nb.length; i++) {
      a = nb[i];
      if (!a.active) continue;
      var dx = a.x - v.x, dy = a.y - v.y;
      var fwd = dx * cosA + dy * sinA;
      var side = -dx * sinA + dy * cosA;
      if (fwd > -0.3 && fwd < 1.2 && side > -0.9 && side < 0.9) n++;
    }
    // part the crowd: push sideways away from centre line
    var push = 2.2 * dt;
    for (i = 0; i < nb.length; i++) {
      a = nb[i];
      if (!a.active) continue;
      var adx = a.x - v.x, ady = a.y - v.y;
      var afwd = adx * cosA + ady * sinA;
      var aside = -adx * sinA + ady * cosA;
      var inBox = afwd > -0.3 && afwd < 1.2 && aside > -0.9 && aside < 0.9;
      var near = Math.sqrt(adx * adx + ady * ady) < 1.3;
      if (!inBox && !near) continue;
      var sgn = aside >= 0 ? 1 : -1;
      var nx = a.x + sgn * (-sinA) * push;
      var ny = a.y + sgn * (cosA) * push;
      if (!Crowd.collides(G, nx, ny)) { a.x = nx; a.y = ny; }
    }
    var keep = v.speed;
    v.speed = keep * Math.max(0.35, 1 - 0.07 * n);
    v.crowded = n >= 3;
    stepToward(G, v, dt);
    v.speed = keep;
  }


  /* Field toward any tile (kettle slots); a small cache, emptied when it fills. */
  function tileFlowField(G, sx, sy) {
    var key = sx + "," + sy;
    if (!G._tileFlow || G._tileFlowN > 48) { G._tileFlow = {}; G._tileFlowN = 0; }
    if (!G._tileFlow[key]) { G._tileFlow[key] = bfsFrom(G, sx, sy); G._tileFlowN++; }
    return G._tileFlow[key];
  }

  function bfsFrom(G, sx, sy) {
    var W = MAP.width, H = MAP.height;
    var dist = new Int16Array(W * H);
    for (var i = 0; i < dist.length; i++) dist[i] = -1;
    if (sx >= 0 && sy >= 0 && sx < W && sy < H &&
        !isSolidPolice(G, sx, sy)) {
      var start = sy * W + sx;
      dist[start] = 0;
      var q = [start];
      var head = 0;
      var ddx = [1, -1, 0, 0];
      var ddy = [0, 0, 1, -1];
      while (head < q.length) {
        var idx = q[head++];
        var cx = idx % W;
        var cy = (idx - cx) / W;
        var cd = dist[idx];
        for (var d = 0; d < 4; d++) {
          var nx = cx + ddx[d], ny = cy + ddy[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (isSolidPolice(G, nx, ny)) continue;
          var ni = ny * W + nx;
          if (dist[ni] !== -1) continue;
          dist[ni] = cd + 1;
          q.push(ni);
        }
      }
    }
    return dist;
  }

  /* Take one step toward the neighbouring tile with the smallest field
   * distance. Returns true if the unit moved. */
  function stepByField(G, off, dt, dist) {
    if (!dist) return false;
    var W = MAP.width, H = MAP.height;
    var cx = Math.floor(off.x), cy = Math.floor(off.y);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    var curIdx = cy * W + cx;
    var curDist = dist[curIdx];
    var bx = -1, by = -1, bestDist = curDist;
    var ddx = [1, -1, 0, 0];
    var ddy = [0, 0, 1, -1];
    var i, nx, ny, ni, nd;
    if (curDist === -1) {
      var best = Infinity;
      for (var r = 1; r <= 24 && bx < 0; r++) {
        for (var oy = -r; oy <= r; oy++) {
          for (var ox = -r; ox <= r; ox++) {
            if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
            nx = cx + ox; ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            nd = dist[ny * W + nx];
            if (nd >= 0) {
              var d2 = ox * ox + oy * oy;
              if (d2 < best) { best = d2; bx = nx; by = ny; }
            }
          }
        }
        if (bx >= 0 && r * r > best) break;
      }
      if (bx < 0) return false;
    } else {
      for (i = 0; i < 4; i++) {
        nx = cx + ddx[i]; ny = cy + ddy[i];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        ni = ny * W + nx;
        nd = dist[ni];
        if (nd >= 0 && nd < bestDist) { bestDist = nd; bx = nx; by = ny; }
      }
      if (bx < 0) return false;
    }
    var tx = bx + 0.5, ty = by + 0.5;
    var dx = tx - off.x, dy = ty - off.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return false;
    if (isVehicle(off)) {
      var ox0 = off.x, oy0 = off.y;
      vehStep(G, off, dx, dy, d, dt);
      return (off.x - ox0) * (off.x - ox0) + (off.y - oy0) * (off.y - oy0) > 0.0001;
    }
    var step = off.speed * dt;
    if (step > d) step = d;
    var nx2 = off.x + (dx / d) * step;
    var ny2 = off.y + (dy / d) * step;
    if (!isSolidPolice(G, Math.floor(nx2), Math.floor(ny2))) {
      off.x = nx2; off.y = ny2;
      return true;
    }
    return false;
  }

  /* Move a unit one step toward its goal, avoiding solids. */
  function stepToward(G, off, dt) {
    var goal = goalOf(G, off);
    var dx = goal.x - off.x;
    var dy = goal.y - off.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (off._drNudge > 0) {
      off._drNudge -= dt;
      if (off._drNudge <= 0) DRIVE.reset(off);
    } else if (isVehicle(off) && typeof DRIVE !== "undefined" && CONFIG.realisticDriving !== false) {
      var ox0 = off.x, oy0 = off.y;
      DRIVE.step(G, off, goal.x, goal.y, dt, {
        field: vehicleField(G, off, Math.floor(goal.x), Math.floor(goal.y)),
        clear: driveClear(G),
        solid: function (x, y) { return isSolidPolice(G, x, y); }
      });
      off._wantAng = off.ang;
      if ((off.x - ox0) * (off.x - ox0) + (off.y - oy0) * (off.y - oy0) > 0.0001) return;
    }
    if (d < 0.05) { off.x = goal.x; off.y = goal.y; return; }
    if (d > 2 && typeof off.kettleX === "number" && !isVehicle(off)) {
      var kf = tileFlowField(G, Math.floor(goal.x), Math.floor(goal.y));
      if (stepByField(G, off, dt, kf)) return;
    }
    if (d > 2 && isVehicle(off)) {
      var vf = vehicleField(G, off, Math.floor(goal.x), Math.floor(goal.y));
      if (stepByField(G, off, dt, vf)) return;
    }
    if (d > 2) {
      var hx = (typeof off.homeX === "number") ? off.homeX : off.tx;
      var hy = (typeof off.homeY === "number") ? off.homeY : off.ty;
      if (isVehicle(off) || (Math.abs(off.tx - hx) < 0.6 && Math.abs(off.ty - hy) < 0.6)) {
        var field = policeFlowField(G, off.squad);
        if (field && stepByField(G, off, dt, field)) return;
      }
    }
    if (isVehicle(off)) {
      var want = Math.atan2(dy, dx);
      if (typeof off.ang !== "number") off.ang = want;
      if (Math.abs(angDiff(want, off.ang)) > Math.PI / 3) {
        off._wantAng = want;
        turnVehicle(off, dt);
        return;
      }
      vehStep(G, off, dx, dy, d, dt);
      return;
    }
    var ux = dx / d, uy = dy / d;
    var step = off.speed * dt;
    if (step > d) step = d;
    var nx = off.x + ux * step, ny = off.y + uy * step;
    if (!isSolidPolice(G, Math.floor(nx), Math.floor(ny))) { off.x = nx; off.y = ny; return; }
    var ang = Math.atan2(uy, ux);
    var tries = [0.6, -0.6, 1.1, -1.1, 1.57, -1.57];
    for (var i = 0; i < tries.length; i++) {
      var a2 = ang + tries[i];
      var sx = off.x + Math.cos(a2) * step;
      var sy = off.y + Math.sin(a2) * step;
      if (!isSolidPolice(G, Math.floor(sx), Math.floor(sy))) { off.x = sx; off.y = sy; return; }
      if (!isSolidPolice(G, Math.floor(sx), Math.floor(off.y))) { off.x = sx; return; }
      if (!isSolidPolice(G, Math.floor(off.x), Math.floor(sy))) { off.y = sy; return; }
    }
    sx = off.x + ux * step * 0.25; sy = off.y + uy * step * 0.25;
    if (!isSolidPolice(G, Math.floor(sx), Math.floor(sy))) { off.x = sx; off.y = sy; }
  }

  function init(G) {
    CONFIG.squadCount = planned ? planned.length : (CONFIG.baseSquadCount || 6);   /* reinforcements add more */
    G.squadCount = CONFIG.squadCount;
    G.officers = [];
    G.vehicles = [];
    G.barriers = [];
    G.detainees = [];
    if (!G.stats) G.stats = {};
    G.stats.escorted = 0;
    nextDetaineeId = 1;
    G.loudspeakerReadyAt = 0;
    G.over = false;
    G.endReason = "";
    G.waterFx = null;
    var id = 1, s, k;
    G.squadLoadouts = [];
    for (s = 0; s < CONFIG.squadCount; s++) {
      G.squadLoadouts[s] = (planned ? planned[s] : DEFAULT_LOADOUTS[s]) || "none";
    }
    for (s = 0; s < CONFIG.squadCount; s++) {
      var loadout = G.squadLoadouts[s];
      var c = defaultCenter(s);
      id = addSquadOfficers(G, s, loadout, c.x, c.y, id, "calm");
    }
    for (s = 0; s < CONFIG.squadCount; s++) addVehicleFor(G, s);
  }

  /* Create a squad's officers for its loadout around (cx, cy); returns the next free id. */
  function addSquadOfficers(G, s, loadout, cx, cy, id, stance) {
    var per = officersPerSquadFor(loadout);
    var spd = officerSpeedFor(loadout);
    for (var k = 0; k < per; k++) {
      var so = slotOffset(k, per, loadout === "mounted" ? 1.3 : 0.8);   /* horses need room */
      G.officers.push({
        id: id++,
        squad: s,
        x: cx + so.x,
        y: cy + so.y,
        ox: so.x,
        oy: so.y,
        stance: stance,
        tx: cx,
        ty: cy,
        homeX: cx,
        homeY: cy,
        speed: spd,
        baseSpeed: spd,
        stamina: 100,
        _exhausted: false,
        busy: false,
        arrestTarget: null,
        arrestHold: 0
      });
    }
    return id;
  }

  /* Add the single big vehicle (if any) that a squad's loadout provides. */
  function addVehicleFor(G, squadIndex) {
    var type = vehicleTypeFor(loadoutOf(G, squadIndex));
    if (!type) return null;
    var c = defaultCenter(squadIndex);
    /* park beside the squad on a free tile: west, east, north, south, else on the centre */
    var offs = [[VEH_OFFSET_X, 0], [-VEH_OFFSET_X, 0], [0, VEH_OFFSET_X], [0, -VEH_OFFSET_X], [0, 0]];
    var ox = 0, oy = 0;
    for (var oi = 0; oi < offs.length; oi++) {
      if (!isSolidPolice(G, Math.floor(c.x + offs[oi][0]), Math.floor(c.y + offs[oi][1]))) {
        ox = offs[oi][0]; oy = offs[oi][1];
        break;
      }
    }
    var vx = c.x + ox, vy = c.y + oy;
    /* face along the street: east-west if walkable, else north-south */
    var ang = 0;
    var tx0 = Math.floor(vx), ty0 = Math.floor(vy);
    if (!isSolidPolice(G, tx0 - 1, ty0) || !isSolidPolice(G, tx0 + 1, ty0)) ang = 0;
    else ang = Math.PI / 2;
    var vehicle = {
      id: "v" + (G.vehicles.length + 1),
      type: type,
      squad: squadIndex,
      x: vx,
      y: vy,
      ox: ox,
      oy: oy,
      tx: c.x,
      ty: c.y,
      ang: ang,
      _wantAng: ang,
      speed: vehicleSpeedFor(type),
      readyAt: 0
    };
    if (type === "barriertruck") vehicle.stock = CONFIG.barriersPerTruck;
    G.vehicles.push(vehicle);
    return vehicle;
  }

  function distanceBetween(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function leaderForSquad(G, squadIndex) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) return G.officers[i];
    }
    return null;
  }

  function isSquadLeader(G, officer) {
    return leaderForSquad(G, officer.squad) === officer;
  }

  function nearestFreeOfficer(G, x, y, squadIndex) {
    var best = null, bestDistance = Infinity;
    for (var i = 0; i < G.officers.length; i++) {
      var officer = G.officers[i];
      if (officer.squad !== squadIndex || officer.escorting || isSquadLeader(G, officer)) continue;
      var d = distanceBetween(officer, { x: x, y: y });
      if (d < bestDistance) {
        best = officer;
        bestDistance = d;
      }
    }
    return best;
  }

  function nearestVehicle(G, x, y) {
    var bestCar = null, bestCarDistance = Infinity;
    var bestAny = null, bestAnyDistance = Infinity;
    for (var i = 0; i < G.vehicles.length; i++) {
      var vehicle = G.vehicles[i];
      var d = distanceBetween(vehicle, { x: x, y: y });
      if (d < bestAnyDistance) {
        bestAny = vehicle;
        bestAnyDistance = d;
      }
      if (vehicle.type === "car" && d < bestCarDistance) {
        bestCar = vehicle;
        bestCarDistance = d;
      }
    }
    return bestCar || bestAny;
  }

  function startEscort(G, agent, squadIndex) {
    if (!G.detainees) G.detainees = [];
    if (!G.stats) G.stats = {};
    if (typeof G.stats.escorted !== "number") G.stats.escorted = 0;

    var officer = nearestFreeOfficer(G, agent.x, agent.y, squadIndex);
    if (!officer) {
      var best = null, bestDistance = Infinity;
      for (var i = 0; i < G.officers.length; i++) {
        var candidate = G.officers[i];
        if (candidate.escorting || isSquadLeader(G, candidate)) continue;
        var d = distanceBetween(candidate, agent);
        if (d < bestDistance) {
          best = candidate;
          bestDistance = d;
        }
      }
      officer = best;
    }
    if (!officer) officer = leaderForSquad(G, squadIndex);

    /* with transport.js: a vehicle with a free arrest seat, else walk to the station */
    var target = null;
    /* motorbike officers can hold a suspect but cannot carry one: a vehicle comes to them */
    var onBike = !!(officer && typeof TRANSPORT !== "undefined" && loadoutOf(G, officer.squad) === "motorbike");
    if (onBike) target = null;
    else if (typeof TRANSPORT !== "undefined") target = TRANSPORT.pickVehicle(G, agent.x, agent.y) || TRANSPORT.stationTarget(G);
    else target = nearestVehicle(G, agent.x, agent.y);
    var detainee = {
      id: nextDetaineeId++,
      agent: agent,
      x: agent.x,
      y: agent.y,
      wrong: agent.role !== "rioter",
      officer: officer,
      car: target,
      state: "walk",
      loadT: 0,
      holdT: 0,
      startedAt: typeof G.time === "number" ? G.time : 0
    };
    G.detainees.push(detainee);
    if (onBike) {
      detainee.pickup = true;
      detainee.pickV = TRANSPORT.requestPickup(G, detainee);
      detainee.nextAsk = (G.time || 0) + 2;
    }

    if (officer) {
      officer.escorting = detainee;
      officer.busy = true;
      officer._speedBackup = officer.speed;
      officer.speed = escortSpeed();
      if (!detainee.car) {
        officer.tx = officer.x;
        officer.ty = officer.y;
      }
    } else {
      /* A defensive fallback for malformed worlds without any officers. */
      detainee.state = "holding";
    }
    return detainee;
  }

  function finishEscort(G, detainee) {
    var index = G.detainees.indexOf(detainee);
    if (index >= 0) G.detainees.splice(index, 1);
    if (typeof TRANSPORT !== "undefined" && detainee.car) {
      if (detainee.car.station) TRANSPORT.onDelivered(G, 1);
      else TRANSPORT.onLoaded(G, detainee.car);
    }

    var officer = detainee.officer;
    if (officer) {
      if (officer.escorting === detainee) officer.escorting = null;
      var stillEscorting = false;
      for (var i = 0; i < G.detainees.length; i++) {
        if (G.detainees[i].officer === officer) {
          stillEscorting = true;
          break;
        }
      }
      if (!stillEscorting) {
        officer.busy = false;
        officer.speed = typeof officer._speedBackup === "number"
          ? officer._speedBackup
          : (typeof officer.baseSpeed === "number" ? officer.baseSpeed : CONFIG.officerSpeed);
        delete officer._speedBackup;
        officer.tx = officer.homeX;
        officer.ty = officer.homeY;
      }
    }

    if (!G.stats) G.stats = {};
    if (typeof G.stats.escorted !== "number") G.stats.escorted = 0;
    G.stats.escorted++;
    if (typeof G.log === "function") G.log("Detainee taken to car");
  }

  function updateEscorts(G, dt) {
    if (!G.detainees || !G.detainees.length) return;
    for (var i = G.detainees.length - 1; i >= 0; i--) {
      var detainee = G.detainees[i];
      var officer = detainee.officer;
      var age = (typeof G.time === "number" ? G.time : 0) - detainee.startedAt;

      /* walking all the way to the station, or waiting for a pickup, takes longer */
      if (age > escortSafetyTime() * ((detainee.car && detainee.car.station) || detainee.pickup ? 3 : 1)) {
        finishEscort(G, detainee);
        continue;
      }

      if (!officer) {
        detainee.state = "holding";
        detainee.holdT += dt;
        if (detainee.holdT >= escortNoCarHoldTime()) finishEscort(G, detainee);
        continue;
      }

      officer.busy = true;
      if (detainee.pickup) {
        /* the bike officer holds the suspect until a vehicle picks them up */
        officer.tx = officer.x;
        officer.ty = officer.y;
        detainee.state = "holding";
        detainee.x = officer.x + 0.5;
        detainee.y = officer.y;
        if (!detainee.pickV && G.time >= detainee.nextAsk) {
          detainee.pickV = TRANSPORT.requestPickup(G, detainee);
          detainee.nextAsk = G.time + 2;
        }
        continue;
      }
      if (!detainee.car) {
        officer.tx = officer.x;
        officer.ty = officer.y;
        detainee.state = "holding";
        detainee.holdT += dt;
        detainee.x = officer.x + 0.5;
        detainee.y = officer.y;
        if (detainee.holdT >= escortNoCarHoldTime()) finishEscort(G, detainee);
        continue;
      }

      officer.tx = detainee.car.x;
      officer.ty = detainee.car.y;

      var dx = detainee.car.x - officer.x;
      var dy = detainee.car.y - officer.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var sideX = 0, sideY = 0;
      if (distance > 0.001) {
        sideX = -dy / distance * 0.5;
        sideY = dx / distance * 0.5;
      } else {
        sideX = 0.5;
      }
      detainee.x = officer.x + sideX;
      detainee.y = officer.y + sideY;

      if (detainee.state === "loading") {
        detainee.loadT += dt;
        if (detainee.loadT >= escortLoadTime()) finishEscort(G, detainee);
      } else if (distance <= escortArrivalRadius()) {
        detainee.state = "loading";
        detainee.loadT = 0;
      }
    }
  }

  /* Foot officers can sprint while chasing a violent suspect or on a run-flagged
   * move order. Motorbike officers and vehicles never use stamina. */
  function isFootOfficer(o) {
    return !(typeof o.baseSpeed === "number" && o.baseSpeed >= CONFIG.motorbikeSpeed);
  }

  function officerWantsRun(G, o, squad) {
    if (!isFootOfficer(o)) return false;
    var leader = squad[0];
    if (!leader) return false;
    var chasing = !!(leader.arrestTarget && leader.arrestTarget.suspicion >= CONFIG.suspicionThreshold);
    var ordered = !!(G.squadRun && G.squadRun[o.squad]);
    return chasing || ordered;
  }

  /* Set the officer's speed for this tick from stamina and intent. */
  function applyOfficerRun(G, o, squad, squadMinStam, dt) {
    if (!isFootOfficer(o) || o.escorting) return;
    var goalX = o.tx, goalY = o.ty;
    var gdx = goalX - o.x, gdy = goalY - o.y;
    var far = Math.sqrt(gdx * gdx + gdy * gdy) > 3;
    var wants = far && officerWantsRun(G, o, squad);
    var canRun = squadMinStam >= CONFIG.officerStaminaMinToRun;
    var running = wants && canRun && !o._exhausted;
    if (running) {
      o.speed = CONFIG.officerRunSpeed;
      o.stamina -= CONFIG.officerStaminaDrain * dt;
      if (o.stamina <= 0) {
        o.stamina = 0;
        o._exhausted = true;
        o.speed = (typeof o.baseSpeed === "number") ? o.baseSpeed : CONFIG.officerSpeed;
      }
    } else {
      o.speed = (typeof o.baseSpeed === "number") ? o.baseSpeed : CONFIG.officerSpeed;
      o.stamina = Math.min(100, o.stamina + CONFIG.officerStaminaRegen * dt);
      if (o._exhausted && o.stamina >= CONFIG.officerStaminaMinToRun) o._exhausted = false;
    }
  }

  /* Random city mode: a packed street slows police down. Each protester within
   * radius r costs `per` of the speed, down to `floor`. Speed is restored after. */
  function stepThroughCrowd(G, e, dt, r, per, floor) {
    if (!CONFIG.crowdBlocksPolice) { stepToward(G, e, dt); return; }
    var nb = Crowd.neighbors(G, e.x, e.y, r), n = 0;
    for (var i = 0; i < nb.length; i++) if (nb[i].active) n++;
    var keep = e.speed;
    e.speed = keep * Math.max(floor, 1 - per * n);
    e.crowded = n >= 3;
    stepToward(G, e, dt);
    e.speed = keep;
  }

  function resetSquad(squad) {
    var leader = squad[0];
    leader.arrestTarget = null;
    leader.arrestHold = 0;
    leader.arrestManual = false;
    for (var j = 0; j < squad.length; j++) {
      squad[j].busy = false;
      squad[j].tx = squad[j].homeX;
      squad[j].ty = squad[j].homeY;
    }
  }

  /* Player-ordered arrest: the squad goes after this person whatever their
   * suspicion. Arresting a peaceful protester still counts as a wrong arrest. */
  function updateManualArrest(G, s, squad, dt) {
    var leader = squad[0], tgt = leader.arrestTarget, j;
    if (!tgt.active || G.time > leader.arrestGiveUpAt) { resetSquad(squad); return; }
    var dx = tgt.x - leader.x, dy = tgt.y - leader.y, dd = Math.sqrt(dx * dx + dy * dy);
    for (j = 0; j < squad.length; j++) squad[j].busy = true;
    if (dd < 1.0) {
      if (typeof RESIST !== "undefined" && RESIST) {
        leader.arrestHold += dt * RESIST.arrestRate(G, tgt, s, squad);
        if (RESIST.breakFree(G, tgt, s, squad, dt)) { resetSquad(squad); return; }
      } else {
        leader.arrestHold += dt;
      }
      if (leader.arrestHold >= CONFIG.arrestSeconds) {
        if (Crowd.arrest(G, tgt)) startEscort(G, tgt, s);
        resetSquad(squad);
      }
      return;
    }
    leader.arrestHold = 0;
    if (dd > 2.5) {
      /* far: move the whole squad there along streets, re-aimed once a second */
      if (G.time >= (leader._chaseAt || 0)) {
        leader._chaseAt = G.time + 1;
        for (j = 0; j < squad.length; j++) {
          squad[j].homeX = tgt.x; squad[j].homeY = tgt.y;
          squad[j].tx = tgt.x; squad[j].ty = tgt.y;
        }
      }
    } else {
      if (squad[0]) { squad[0].tx = tgt.x; squad[0].ty = tgt.y; }
      if (squad[1]) { squad[1].tx = tgt.x; squad[1].ty = tgt.y; }
    }
  }

  function orderArrest(G, squadIndex, agent) {
    if (!agent || !agent.active) return false;
    var leader = leaderForSquad(G, squadIndex);
    if (!leader) return false;
    var nolo = loadoutOf(G, squadIndex);
    if (!UNITTYPES.canArrest(nolo)) return false;   /* liaison, medics, firefighters */
    leader.arrestTarget = agent;
    leader.arrestManual = true;
    leader.arrestHold = 0;
    leader.arrestGiveUpAt = G.time + 45;
    leader._chaseAt = 0;
    G.log("Squad " + (squadIndex + 1) + " ordered to arrest");
    return true;
  }

  /* Shove: the squad pushes the crowd around it back a few tiles. Angers them a little. */
  function shove(G, squadIndex) {
    var n = 0, cx = 0, cy = 0, i;
    for (i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      if (o.squad !== squadIndex || o.escorting) continue;
      cx += o.x; cy += o.y; n++;
    }
    if (!n) return "none";
    if (!G.shoveReadyAt) G.shoveReadyAt = [];
    if (G.time < (G.shoveReadyAt[squadIndex] || 0)) return "cooldown";
    cx /= n; cy /= n;
    var r = CONFIG.shoveRadius || 2.6;
    Crowd.push(G, cx, cy, r, CONFIG.shoveStrength || 3.5, cx, cy);
    var nb = Crowd.neighbors(G, cx, cy, r);
    for (i = 0; i < nb.length; i++) {
      if (nb[i].active) nb[i].mood = Math.min(100, nb[i].mood + (CONFIG.shoveMoodRise || 4));
    }
    G.shoveReadyAt[squadIndex] = G.time + (CONFIG.shoveCooldown || 6);
    G.shoveFx = { x: cx, y: cy, r: r, until: G.time + 0.6 };
    if (typeof MEDIA !== "undefined") MEDIA.report(G, "shove", cx, cy);
    G.log("Squad " + (squadIndex + 1) + " shoves the crowd back");
    return "ok";
  }

  function update(G, dt) {
    if (G.over) return;
    if (G.time >= CONFIG.matchSeconds) {
      G.over = true;
      G.endReason = "time";
      return;
    }

    /* Per-squad observe radius: a car adds a bonus. */
    var squadObs = [];
    var s, i, j;
    for (s = 0; s < CONFIG.squadCount; s++) squadObs[s] = CONFIG.observeRadiusTiles + (loadoutOf(G, s) === "mounted" ? 1.5 : 0);   /* riders see over the crowd */
    for (i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i].type === "car") squadObs[G.vehicles[i].squad] += CONFIG.carObserveBonus;
    }

    /* Per-squad stamina floor so a squad runs together. */
    var squadMinStam = [];
    for (s = 0; s < CONFIG.squadCount; s++) squadMinStam[s] = 100;
    for (i = 0; i < G.officers.length; i++) {
      var q0 = G.officers[i];
      if (typeof q0.stamina !== "number") q0.stamina = 100;
      if (isFootOfficer(q0) && q0.stamina < squadMinStam[q0.squad]) squadMinStam[q0.squad] = q0.stamina;
    }

    /* Observation / suspicion. */
    var seen = {};
    for (i = 0; i < G.officers.length; i++) {
      var off = G.officers[i];
      var offSquad = [];
      for (j = 0; j < G.officers.length; j++) {
        if (G.officers[j].squad === off.squad) offSquad.push(G.officers[j]);
      }
      applyOfficerRun(G, off, offSquad, squadMinStam[off.squad], dt);
      /* hit by a thrown object: stands still for a moment */
      /* tear gas: masked officers move at 60% speed */
      var keepSp = off.speed;
      if (off.gasSlowUntil > G.time) off.speed *= 0.6;
      /* snatch-squad officers are moved by tactics.js */
      /* a bolting horse is moved by units.js */
      if (!(off.stunUntil > G.time) && !off.snatch && !(off.panicUntil > G.time)) stepThroughCrowd(G, off, dt, 0.9, 0.1, 0.2);
      off.speed = keepSp;
      var nb = Crowd.neighbors(G, off.x, off.y, squadObs[off.squad]);
      for (j = 0; j < nb.length; j++) {
        var a = nb[j];
        if (!a.active) continue;
        /* thick smoke hides people from the police */
        if (typeof FX !== "undefined" && FX.smokeAt(G, a.x, a.y) >= 0.5) continue;
        if (typeof GAS !== "undefined" && GAS.densityAt(G, a.x, a.y) >= 0.5) continue;
        /* after dark, someone in an unlit spot is only seen from closer */
        if (typeof NIGHT !== "undefined") {
          var vr = squadObs[off.squad] * NIGHT.visibility(G, a.x, a.y), vdx = a.x - off.x, vdy = a.y - off.y;
          if (vdx * vdx + vdy * vdy > vr * vr) continue;
        }
        seen[a.id] = true;
        var rise = 0;
        if (a.hasTool || a.revealedUntil > G.time || a.violentUntil > G.time) rise = 15;
        if (rise > 0 && a.defiant) rise *= 2;   /* stayed and fought after a dispersal order */
        if (rise > 0) a.suspicion = Math.min(100, a.suspicion + rise * dt);
      }
    }
    for (i = 0; i < G.agents.length; i++) {
      var a2 = G.agents[i];
      if (!a2.active) continue;
      if (!seen[a2.id]) a2.suspicion = Math.max(0, a2.suspicion - 2 * dt);
    }

    /* Vehicles follow their squad's home point. */
    for (i = 0; i < G.vehicles.length; i++) {
      var v = G.vehicles[i];
      /* transport.js steers vehicles that carry officers or arrested people; otherwise the
       * vehicle stays with its officers (their centre), so it never races ahead of them */
      /* an empty vehicle left behind (not parked on purpose) rejoins its squad once the
       * officers on foot are more than 8 tiles away: police stay near their vehicle */
      if (v.ctrl && !v.parked && !v.run && !(v.crew && v.crew.length) &&
          !(typeof TRANSPORT !== "undefined" && TRANSPORT.isBoarding(G, v.squad))) {
        var lx = 0, ly = 0, ln = 0;
        for (j = 0; j < G.officers.length; j++) {
          if (G.officers[j].squad === v.squad && !G.officers[j].escorting) { lx += G.officers[j].x; ly += G.officers[j].y; ln++; }
        }
        if (ln && (lx / ln - v.x) * (lx / ln - v.x) + (ly / ln - v.y) * (ly / ln - v.y) > 64) { v.ctrl = false; v.dest = null; }
      }
      if (!v.ctrl) {
        var fx = 0, fy = 0, fn = 0;
        for (j = 0; j < G.officers.length; j++) {
          var fo = G.officers[j];
          if (fo.squad === v.squad && !fo.escorting) { fx += fo.x; fy += fo.y; fn++; }
        }
        if (fn) { v.tx = fx / fn; v.ty = fy / fn; }
      }
      /* a vehicle on a tile it cannot drive on (alley, kerb, pushed into a wall) can never
       * find a route: after 1 s off-road, put it on the nearest drivable road tile */
      if (!driveTileOk(G, Math.floor(v.x), Math.floor(v.y))) {
        v._offRoad = (v._offRoad || 0) + dt;
        if (v._offRoad > 1) {
          var rt = nearestAllowed(G, Math.floor(v.x), Math.floor(v.y), function (x, y) { return driveTileOk(G, x, y); }, 12);
          if (rt) { v.x = rt.x + 0.5; v.y = rt.y + 0.5; if (typeof DRIVE !== "undefined") DRIVE.reset(v); }
          v._offRoad = 0;
        }
      } else v._offRoad = 0;
      if (CONFIG.crowdBlocksPolice) stepVehicleThroughCrowd(G, v, dt);
      else stepToward(G, v, dt);
      turnVehicle(v, dt);
      /* ambulance medics calm hurt and angry people around them */
      if (v.type === "ambulance") {
        var amb = Crowd.neighbors(G, v.x, v.y, CONFIG.ambulanceRadius || 3.5);
        for (j = 0; j < amb.length; j++) {
          if (amb[j].active && amb[j].mood > 40) amb[j].mood -= (CONFIG.ambulanceCalm || 2.5) * dt;
        }
      }
    }

    /* Arrest logic per squad. */
    for (s = 0; s < CONFIG.squadCount; s++) {
      var sr = squadObs[s];
      var squad = [];
      for (i = 0; i < G.officers.length; i++) {
        if (G.officers[i].squad === s) squad.push(G.officers[i]);
      }
      var leader = squad[0];
      if (!leader) continue;
      if (!UNITTYPES.canArrest(loadoutOf(G, s))) continue;

      if (leader.arrestTarget && leader.arrestManual) {
        updateManualArrest(G, s, squad, dt);
        continue;
      }
      if (leader.arrestTarget) {
        var tgt = leader.arrestTarget;
        if (!tgt.active || tgt.suspicion < CONFIG.suspicionThreshold) {
          leader.arrestTarget = null;
          leader.arrestHold = 0;
          for (j = 0; j < squad.length; j++) {
            squad[j].busy = false;
            squad[j].tx = squad[j].homeX;
            squad[j].ty = squad[j].homeY;
          }
        } else {
          var ddx = tgt.x - leader.x, ddy = tgt.y - leader.y;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd > sr) {
            leader.arrestTarget = null;
            leader.arrestHold = 0;
            for (j = 0; j < squad.length; j++) {
              squad[j].busy = false;
              squad[j].tx = squad[j].homeX;
              squad[j].ty = squad[j].homeY;
            }
          } else if (dd < 1.0) {
            if (typeof RESIST !== "undefined" && RESIST) {
              leader.arrestHold += dt * RESIST.arrestRate(G, tgt, s, squad);
              if (RESIST.breakFree(G, tgt, s, squad, dt)) {
                leader.arrestTarget = null;
                leader.arrestHold = 0;
                for (j = 0; j < squad.length; j++) {
                  squad[j].busy = false;
                  squad[j].tx = squad[j].homeX;
                  squad[j].ty = squad[j].homeY;
                }
                continue;   /* next squad */
              }
            } else {
              leader.arrestHold += dt;
            }
            for (j = 0; j < squad.length; j++) squad[j].busy = true;
            if (leader.arrestHold >= CONFIG.arrestSeconds) {
              if (Crowd.arrest(G, tgt)) startEscort(G, tgt, s);
              leader.arrestTarget = null;
              leader.arrestHold = 0;
              for (j = 0; j < squad.length; j++) {
                squad[j].busy = false;
                squad[j].tx = squad[j].homeX;
                squad[j].ty = squad[j].homeY;
              }
            }
          } else {
            if (squad[0]) { squad[0].tx = tgt.x; squad[0].ty = tgt.y; }
            if (squad[1]) { squad[1].tx = tgt.x; squad[1].ty = tgt.y; }
          }
        }
        continue;
      }

      var best = null, bestS = CONFIG.suspicionThreshold;
      var nb2 = Crowd.neighbors(G, leader.x, leader.y, sr);
      for (j = 0; j < nb2.length; j++) {
        var b = nb2[j];
        if (!b.active) continue;
        if (b.suspicion >= bestS) { bestS = b.suspicion; best = b; }
      }
      if (best) {
        leader.arrestTarget = best;
        leader.arrestHold = 0;
      }
    }

    /* Run after arrest handling, which may reset squad busy flags and targets. */
    updateEscorts(G, dt);
  }

  function drawVehicle(ctx, v, ts) {
    var ang = (typeof v.ang === "number") ? v.ang : 0;
    var c = Math.cos(ang), sn = Math.sin(ang);
    var px = v.x * ts, py = v.y * ts;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    var w, h;
    if (v.type === "car") {
      w = 1.6 * ts; h = 0.8 * ts;
      ctx.fillStyle = "#e8edf5";
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "#2a5db0";
      ctx.fillRect(-w / 2, -2, w, 4);
      ctx.fillStyle = "#e53935";
      ctx.fillRect(-4, -h / 2 - 2, 3, 3);
      ctx.fillStyle = "#1e88e5";
      ctx.fillRect(1, -h / 2 - 2, 3, 3);
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    } else if (v.type === "barriertruck") {
      w = 2.4 * ts; h = 1.0 * ts;
      ctx.fillStyle = "#7a5a2a";
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "#3d2c12";
      ctx.fillRect(w / 2 - 12, -h / 2, 12, h);
      ctx.fillStyle = "#ffcc33";
      ctx.fillRect(-w / 2 + 4, -3, w - 20, 6);
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    } else {
      w = 2.4 * ts; h = 1.0 * ts;
      ctx.fillStyle = "#4a86c5";
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "#2b4f7a";
      ctx.fillRect(w / 2 - 10, -h / 2, 10, h);
      ctx.fillStyle = "#bcd7f2";
      ctx.fillRect(-w / 2 + 4, -2, w - 18, 4);
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    }
    ctx.restore();
  }

  function draw(ctx, G) {
    var ts = CONFIG.tileSize;
    var i, s;
    /* Barriers. */
    for (i = 0; i < G.barriers.length; i++) {
      var b = G.barriers[i];
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(b.x * ts, b.y * ts, ts, ts);
      ctx.strokeStyle = "#ffcc33";
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x * ts + 0.5, b.y * ts + 0.5, ts - 1, ts - 1);
    }
    /* Vehicles (under the officers). */
    for (i = 0; i < G.vehicles.length; i++) drawVehicle(ctx, G.vehicles[i], ts);

    /* Water cannon spray. */
    if (G.waterFx && G.time < G.waterFx.until) {
      var fx = G.waterFx;
      ctx.strokeStyle = "rgba(120,190,255,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx.fromX * ts, fx.fromY * ts);
      ctx.lineTo(fx.x * ts, fx.y * ts);
      ctx.stroke();
      ctx.fillStyle = "rgba(120,190,255,0.25)";
      ctx.beginPath();
      ctx.arc(fx.x * ts, fx.y * ts, CONFIG.waterRadius * ts, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Officers: round body, light head, squad label. */
    for (i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      var px = o.x * ts, py = o.y * ts;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = (o.stance === "firm") ? "#e06030" : "#3060c0";
      ctx.fill();
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#e8edf5";
      ctx.beginPath();
      ctx.arc(px, py - 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
      if (o.busy) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* Detainees are rendered separately and never added back to G.agents. */
    for (i = 0; G.detainees && i < G.detainees.length; i++) {
      var d = G.detainees[i];
      var dx = d.x * ts, dy = d.y * ts;
      if (d.officer) {
        ctx.beginPath();
        ctx.moveTo(d.officer.x * ts, d.officer.y * ts);
        ctx.lineTo(dx, dy);
        ctx.strokeStyle = "#f2d34f";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(dx, dy, d.state === "loading" ? 2.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = d.state === "loading" ? "#aeb4bc" : "#d8dde3";
      ctx.fill();
      ctx.strokeStyle = "#343a40";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.save();
    ctx.font = "bold 11px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (s = 0; s < CONFIG.squadCount; s++) {
      var n = 0, sx = 0, minY = 1e9;
      for (i = 0; i < G.officers.length; i++) {
        if (G.officers[i].squad !== s) continue;
        n++; sx += G.officers[i].x;
        if (G.officers[i].y < minY) minY = G.officers[i].y;
      }
      if (!n) continue;
      ctx.fillStyle = "#ffd866";
      ctx.fillText("S" + (s + 1) + " x" + n, (sx / n) * ts, minY * ts - 8);
    }
    ctx.restore();
  }

  /* ----- Commands ----- */
  function moveSquad(G, squadIndex, x, y, run) {
    if (!G.squadRun) G.squadRun = [];
    G.squadRun[squadIndex] = !!run;
    var tv = null;
    if (typeof TRANSPORT !== "undefined" && TRANSPORT && TRANSPORT.vehicleOf) {
      tv = TRANSPORT.vehicleOf(G, squadIndex);
      if (tv) {
        var crew = TRANSPORT.crewCount ? TRANSPORT.crewCount(G, squadIndex) : (tv.crew ? tv.crew.length : 0);
        var boarding = TRANSPORT.isBoarding ? TRANSPORT.isBoarding(G, squadIndex) : false;
        var vdx = x - tv.x, vdy = y - tv.y;
        var vdist = Math.sqrt(vdx * vdx + vdy * vdy);
        var canBoard = !(tv._noBoardUntil && tv._noBoardUntil > G.time);
        if (crew > 0 || boarding) {
          if (TRANSPORT.drive) TRANSPORT.drive(G, squadIndex, x, y);
          tv.parked = false;
        } else if (vdist > 25 && canBoard && TRANSPORT.toggle) {
          var tr = TRANSPORT.toggle(G, squadIndex);
          if (tr === "boarding") {
            var t = G._transport, st = t && t.runs && t.runs[squadIndex];
            if (st) st.pendingDrive = { x: x, y: y };
            if (TRANSPORT.drive) TRANSPORT.drive(G, squadIndex, x, y);
            tv.parked = false;
          }
        }
      }
    }
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) {
        G.officers[i].kettleX = G.officers[i].kettleY = undefined;
        if (G.officers[i].arrestManual) {
          G.officers[i].arrestTarget = null;
          G.officers[i].arrestManual = false;
          G.officers[i].arrestHold = 0;
          for (var j = 0; j < G.officers.length; j++) {
            if (G.officers[j].squad === squadIndex && !G.officers[j].escorting) G.officers[j].busy = false;
          }
        }
        G.officers[i].tx = x;
        G.officers[i].ty = y;
        G.officers[i].homeX = x;
        G.officers[i].homeY = y;
      }
    }
    if (G._policeFlow) G._policeFlow[squadIndex] = null;
  }

  function setStance(G, squadIndex, stance) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) G.officers[i].stance = stance;
    }
  }

  function toggleStance(G, squadIndex) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) {
        G.officers[i].stance = (G.officers[i].stance === "firm") ? "calm" : "firm";
      }
    }
  }

  function isWalkable(G, x, y) { return !isSolidPolice(G, x, y); }

  /* Street tile where a squad may be placed during planning. */
  function canDeploy(G, x, y) {
    if (!inBounds(x, y)) return false;
    if (MAP.rows[y].charAt(x) !== ".") return false;
    if (x < CONFIG.deployMinX) return false;
    var zs = CONFIG.spawnZones || [];
    for (var zi = 0; zi < zs.length; zi++) {
      var z = zs[zi];
      if (x >= z.x - 2 && x < z.x + z.w + 2 && y >= z.y - 2 && y < z.y + z.h + 2) return false;
    }
    if (G.blocked && G.blocked.has(tkey(x, y))) return false;
    return true;
  }

  /* Teleport a whole squad (and its vehicles) to a centre point. Planning phase. */
  function deploySquad(G, squadIndex, cx, cy) {
    if (!canDeploy(G, Math.floor(cx), Math.floor(cy))) return false;
    if (G.squadRun) G.squadRun[squadIndex] = false;
    var i, e, gx, gy;
    for (i = 0; i < G.officers.length; i++) {
      e = G.officers[i];
      if (e.squad !== squadIndex) continue;
      e.tx = cx; e.ty = cy; e.homeX = cx; e.homeY = cy;
      gx = cx + e.ox; gy = cy + e.oy;
      if (isSolidPolice(G, Math.floor(gx), Math.floor(gy))) { gx = cx; gy = cy; }
      e.x = gx; e.y = gy;
      e.busy = false; e.arrestTarget = null; e.arrestHold = 0;
    }
    for (i = 0; i < G.vehicles.length; i++) {
      e = G.vehicles[i];
      if (e.squad !== squadIndex) continue;
      e.tx = cx; e.ty = cy;
      gx = cx + e.ox; gy = cy + e.oy;
      if (isSolidPolice(G, Math.floor(gx), Math.floor(gy))) { gx = cx; gy = cy; }
      e.x = gx; e.y = gy;
      e.ang = e._wantAng = streetAngle(G, gx, gy);
    }
    return true;
  }

  function barrierTruckFor(G, squadIndex) {
    for (var i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i].squad === squadIndex && G.vehicles[i].type === "barriertruck") return G.vehicles[i];
    }
    return null;
  }
  function hasBarrierTruck(G, squadIndex) { return barrierTruckFor(G, squadIndex) !== null; }
  function barrierStock(G, squadIndex) {
    var truck = barrierTruckFor(G, squadIndex);
    return (truck && typeof truck.stock === "number") ? truck.stock : 0;
  }
  function hasCar(G, squadIndex) {
    var lo = loadoutOf(G, squadIndex);
    return lo === "car" || lo === "van" || lo === "truck";   /* all carry a loudspeaker */
  }

  /* Reinforcements: add a new squad at (x, y) during play; returns its index or -1. */
  function addSquad(G, loadout, x, y) {
    var max = CONFIG.maxSquads || 10;
    if (CONFIG.squadCount >= max) return -1;
    var s = CONFIG.squadCount;
    CONFIG.squadCount++;
    G.squadCount = CONFIG.squadCount;
    G.squadLoadouts[s] = loadout;
    var id = 1;
    for (var i = 0; i < G.officers.length; i++) if (G.officers[i].id >= id) id = G.officers[i].id + 1;
    addSquadOfficers(G, s, loadout, x, y, id, "calm");
    var type = vehicleTypeFor(loadout);
    if (type) {
      G.vehicles.push({ id: "v" + (G.vehicles.length + 1) + "r", type: type, squad: s, x: x, y: y, ox: 0, oy: 0,
        tx: x, ty: y, ang: 0, _wantAng: 0, speed: vehicleSpeedFor(type), readyAt: 0 });
    }
    return s;
  }
  function hasWaterTruck(G, squadIndex) {
    for (var i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i].squad === squadIndex && G.vehicles[i].type === "watertruck") return true;
    }
    return false;
  }

  /* Swap a squad's loadout. Refuses if the total cost would exceed the budget.
   * Rebuilds that squad's vehicle at the squad's current centre. */
  function setLoadout(G, squadIndex, name) {
    if (!G || !G.squadLoadouts) return false;
    if (squadIndex < 0 || squadIndex >= G.squadLoadouts.length) return false;
    var defs = CONFIG.loadouts || {};
    if (!defs[name]) return false;
    var old = G.squadLoadouts[squadIndex];
    if (old === name) return true;
    var total = loadoutCost(name);
    for (var i = 0; i < G.squadLoadouts.length; i++) {
      if (i !== squadIndex) total += loadoutCost(G.squadLoadouts[i]);
    }
    if (total > (CONFIG.loadoutBudget || 10)) return false;
    G.squadLoadouts[squadIndex] = name;

    var kept = [];
    for (i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i].squad !== squadIndex) kept.push(G.vehicles[i]);
    }
    G.vehicles = kept;
    addVehicleFor(G, squadIndex);

    var cx = defaultCenter(squadIndex).x, cy = defaultCenter(squadIndex).y;
    for (i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) { cx = G.officers[i].homeX; cy = G.officers[i].homeY; break; }
    }
    for (i = 0; i < G.vehicles.length; i++) {
      var v = G.vehicles[i];
      if (v.squad !== squadIndex) continue;
      v.x = cx + v.ox; v.y = cy + v.oy;
      v.tx = cx; v.ty = cy;
    }

    /* a new loadout can change the head count and spacing: rebuild the squad
     * (unless someone is escorting a detainee, then keep the officers) */
    var rest = [], stance = "calm", maxId = 0, busy = false;
    for (i = 0; i < G.officers.length; i++) {
      var q = G.officers[i];
      if (q.id > maxId) maxId = q.id;
      if (q.squad !== squadIndex) rest.push(q);
      else { stance = q.stance; if (q.escorting) busy = true; }
    }
    if (!busy) {
      G.officers = rest;
      addSquadOfficers(G, squadIndex, name, cx, cy, maxId + 1, stance);
    }

    var spd = officerSpeedFor(name);
    for (i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad !== squadIndex) continue;
      G.officers[i].baseSpeed = spd;
      if (typeof G.officers[i].stamina !== "number") G.officers[i].stamina = 100;
      if (spd >= CONFIG.motorbikeSpeed) { G.officers[i].stamina = 100; G.officers[i]._exhausted = false; }
      if (!G.officers[i].escorting) G.officers[i].speed = spd;
    }
    return true;
  }

  function getLoadout(G, squadIndex) { return loadoutOf(G, squadIndex); }

  function loudspeaker(G, x, y, squadIndex) {
    if (!hasCar(G, squadIndex)) return false;
    if (G.time < G.loudspeakerReadyAt) return false;
    Crowd.loudspeaker(G, x, y, CONFIG.loudspeakerRadius, CONFIG.loudspeakerStrength);
    G.loudspeakerReadyAt = G.time + CONFIG.loudspeakerCooldown;
    G.log("Loudspeaker used");
    return true;
  }

  /* Returns "ok" | "none" | "cooldown" | "range". Needs the squad's own truck. */
  function waterCannon(G, x, y, squadIndex) {
    var truck = null;
    for (var i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i].type === "watertruck" && G.vehicles[i].squad === squadIndex) truck = G.vehicles[i];
    }
    if (!truck) return "none";
    if (G.time < truck.readyAt) return "cooldown";
    var dx = x - truck.x, dy = y - truck.y;
    if (Math.sqrt(dx * dx + dy * dy) > CONFIG.waterRange) return "range";
    Crowd.loudspeaker(G, x, y, CONFIG.waterRadius, CONFIG.waterStrength);
    Crowd.push(G, x, y, CONFIG.waterRadius, CONFIG.waterPushStrength, truck.x, truck.y);
    truck.readyAt = G.time + CONFIG.waterCooldown;
    G.waterFx = { x: x, y: y, fromX: truck.x, fromY: truck.y, until: G.time + 1.2 };
    G.log("Water cannon used");
    if (typeof FX !== "undefined") FX.water(G, x, y, CONFIG.waterRadius);
    if (typeof MEDIA !== "undefined") MEDIA.report(G, "water", x, y);
    return "ok";
  }

  function placeBarrier(G, x, y, squadIndex) {
    if (!inBounds(x, y)) return false;
    if (isSolid(G, x, y)) return false;
    var truck = barrierTruckFor(G, squadIndex);
    if (!truck || !(truck.stock > 0)) return false;
    truck.stock--;
    G.blocked.add(tkey(x, y));
    G.barriers.push({ x: x, y: y, squad: squadIndex });
    if (typeof Art !== "undefined") Art.invalidate();
    Crowd.rebuildFlow(G);
    G.log("Barrier placed at " + x + "," + y);
    return true;
  }

  return {
    init: init,
    update: update,
    draw: draw,
    startEscort: startEscort,
    finishEscort: finishEscort,
    addSquad: addSquad,
    setForce: setForce,
    orderArrest: orderArrest,
    shove: shove,
    moveSquad: moveSquad,
    setStance: setStance,
    toggleStance: toggleStance,
    isWalkable: isWalkable,
    canDeploy: canDeploy,
    deploySquad: deploySquad,
    loudspeaker: loudspeaker,
    waterCannon: waterCannon,
    placeBarrier: placeBarrier,
    setLoadout: setLoadout,
    getLoadout: getLoadout,
    barrierStock: barrierStock,
    hasBarrierTruck: hasBarrierTruck,
    hasCar: hasCar,
    hasWaterTruck: hasWaterTruck
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Police;
}
