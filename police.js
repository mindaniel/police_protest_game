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
    if (loadout === "car") return "car";
    if (loadout === "watertruck") return "watertruck";
    if (loadout === "barriertruck") return "barriertruck";
    return null;   /* motorbike and none have no big vehicle */
  }
  function vehicleSpeedFor(type) {
    return type === "car" ? CONFIG.carSpeed : CONFIG.truckSpeed;
  }
  function officersPerSquadFor(loadout) {
    return loadout === "motorbike" ? 2 : CONFIG.officersPerSquad;
  }
  function officerSpeedFor(loadout) {
    return loadout === "motorbike" ? CONFIG.motorbikeSpeed : CONFIG.officerSpeed;
  }
  var nextDetaineeId = 1;

  function tkey(x, y) { return x + "," + y; }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < MAP.width && y < MAP.height;
  }
  function isSolid(G, x, y) {
    if (!inBounds(x, y)) return true;
    var ch = MAP.rows[y].charAt(x);
    if (ch === "#" || ch === "S") return true;
    if (G.blocked && G.blocked.has(tkey(x, y))) return true;
    return false;
  }

  /* Solid test for police units: buildings and shops only. Barriers do NOT block police. */
  function isSolidPolice(G, x, y) {
    if (!inBounds(x, y)) return true;
    var ch = MAP.rows[y].charAt(x);
    return (ch === "#" || ch === "S");
  }

  var VEH_OFFSET_X = -1.9;   /* vehicle parks this far west of the squad centre */

  /* Default squad centres: six squads, four on the main boulevard (row 18) and
   * two on the lower boulevard (row 33). All are road tiles, none is within
   * two tiles of a crowd entrance, and no two centres coincide. */
  function defaultCenter(s) {
    if (CONFIG.squadCenters && CONFIG.squadCenters[s]) return CONFIG.squadCenters[s];
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
  function slotOffset(k, n) {
    var cols = 2, rows = Math.ceil(n / cols);
    return {
      x: ((k % cols) - 0.5) * 0.8,
      y: (Math.floor(k / cols) - (rows - 1) / 2) * 0.8
    };
  }

  /* Where a unit really aims: its target plus its formation offset,
   * unless that spot is solid, then the plain target. */
  function goalOf(G, e) {
    var gx = e.tx, gy = e.ty;
    if (e.ox || e.oy) {
      var cx = e.tx + e.ox, cy = e.ty + e.oy;
      if (!isSolidPolice(G, Math.floor(cx), Math.floor(cy))) { gx = cx; gy = cy; }
    }
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
    var key = home.x + "," + home.y;
    if (!G._policeFlow) G._policeFlow = [];
    var cached = G._policeFlow[squadIndex];
    if (cached && cached.key === key) return cached.dist;
    var W = MAP.width, H = MAP.height;
    var dist = new Int16Array(W * H);
    for (var i = 0; i < dist.length; i++) dist[i] = -1;
    if (home.x >= 0 && home.y >= 0 && home.x < W && home.y < H &&
        !isSolidPolice(G, home.x, home.y)) {
      var start = home.y * W + home.x;
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
    G._policeFlow[squadIndex] = { key: key, dist: dist };
    return dist;
  }

  /* Take one step toward the neighbouring tile with the smallest field
   * distance. Returns true if the unit moved. */
  function stepByField(G, off, dt, dist) {
    var W = MAP.width, H = MAP.height;
    var cx = Math.floor(off.x), cy = Math.floor(off.y);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    var curIdx = cy * W + cx;
    var curDist = dist[curIdx];
    if (curDist === -1) return false;
    var ddx = [1, -1, 0, 0];
    var ddy = [0, 0, 1, -1];
    var bestDist = curDist;
    var bestIdx = -1;
    for (var i = 0; i < 4; i++) {
      var nx = cx + ddx[i], ny = cy + ddy[i];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      var ni = ny * W + nx;
      var nd = dist[ni];
      if (nd === -1) continue;
      if (nd < bestDist) { bestDist = nd; bestIdx = ni; }
    }
    if (bestIdx === -1) return false;
    var bx = bestIdx % W;
    var by = (bestIdx - bx) / W;
    var tx = bx + 0.5, ty = by + 0.5;
    var dx = tx - off.x, dy = ty - off.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return false;
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
    if (d < 0.05) { off.x = goal.x; off.y = goal.y; return; }

    /* Farther than 2 tiles from a goal that is the squad's home: follow the
     * per-squad flow field so units get around building columns. */
    if (d > 2) {
      var hx = (typeof off.homeX === "number") ? off.homeX : off.tx;
      var hy = (typeof off.homeY === "number") ? off.homeY : off.ty;
      if (Math.abs(goal.x - hx) < 0.6 && Math.abs(goal.y - hy) < 0.6) {
        var field = policeFlowField(G, off.squad);
        if (field && stepByField(G, off, dt, field)) return;
      }
    }

    var step = off.speed * dt;
    if (step > d) step = d;
    var ux = dx / d, uy = dy / d;
    var nx = off.x + ux * step;
    var ny = off.y + uy * step;
    if (!isSolidPolice(G, Math.floor(nx), Math.floor(ny))) {
      off.x = nx; off.y = ny;
      return;
    }
    var nx2 = off.x + ux * step, ny2 = off.y;
    if (!isSolidPolice(G, Math.floor(nx2), Math.floor(ny2))) { off.x = nx2; return; }
    var nx3 = off.x, ny3 = off.y + uy * step;
    if (!isSolidPolice(G, Math.floor(nx3), Math.floor(ny3))) { off.y = ny3; return; }
  }

  function init(G) {
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
      G.squadLoadouts[s] = DEFAULT_LOADOUTS[s] || "none";
    }
    for (s = 0; s < CONFIG.squadCount; s++) {
      var loadout = G.squadLoadouts[s];
      var c = defaultCenter(s);
      var per = officersPerSquadFor(loadout);
      var spd = officerSpeedFor(loadout);
      for (k = 0; k < per; k++) {
        var so = slotOffset(k, per);
        G.officers.push({
          id: id++,
          squad: s,
          x: c.x + so.x,
          y: c.y + so.y,
          ox: so.x,
          oy: so.y,
          stance: "calm",
          tx: c.x,
          ty: c.y,
          homeX: c.x,
          homeY: c.y,
          speed: spd,
          baseSpeed: spd,
          stamina: 100,
          _exhausted: false,
          busy: false,
          arrestTarget: null,
          arrestHold: 0
        });
      }
    }
    for (s = 0; s < CONFIG.squadCount; s++) addVehicleFor(G, s);
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
    var vehicle = {
      id: "v" + (G.vehicles.length + 1),
      type: type,
      squad: squadIndex,
      x: c.x + ox,
      y: c.y + oy,
      ox: ox,
      oy: oy,
      tx: c.x,
      ty: c.y,
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

    var detainee = {
      id: nextDetaineeId++,
      agent: agent,
      x: agent.x,
      y: agent.y,
      wrong: agent.role !== "rioter",
      officer: officer,
      car: nearestVehicle(G, agent.x, agent.y),
      state: "walk",
      loadT: 0,
      holdT: 0,
      startedAt: typeof G.time === "number" ? G.time : 0
    };
    G.detainees.push(detainee);

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

      if (age > escortSafetyTime()) {
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
      leader.arrestHold += dt;
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
    for (s = 0; s < CONFIG.squadCount; s++) squadObs[s] = CONFIG.observeRadiusTiles;
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
      stepThroughCrowd(G, off, dt, 0.9, 0.1, 0.2);
      var nb = Crowd.neighbors(G, off.x, off.y, squadObs[off.squad]);
      for (j = 0; j < nb.length; j++) {
        var a = nb[j];
        if (!a.active) continue;
        seen[a.id] = true;
        var rise = 0;
        if (a.hasTool || a.revealedUntil > G.time || a.violentUntil > G.time) rise = 15;
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
      for (j = 0; j < G.officers.length; j++) {
        if (G.officers[j].squad === v.squad) { v.tx = G.officers[j].homeX; v.ty = G.officers[j].homeY; break; }
      }
      stepThroughCrowd(G, v, dt, 1.4, 0.15, 0.08);
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
            leader.arrestHold += dt;
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
    var px = v.x * ts, py = v.y * ts, w, h;
    if (v.type === "car") {
      w = 1.6 * ts; h = 0.8 * ts;
      ctx.fillStyle = "#e8edf5";
      ctx.fillRect(px - w / 2, py - h / 2, w, h);
      ctx.fillStyle = "#2a5db0";
      ctx.fillRect(px - w / 2, py - 2, w, 4);
      ctx.fillStyle = "#e53935";
      ctx.fillRect(px - 4, py - h / 2 - 2, 3, 3);
      ctx.fillStyle = "#1e88e5";
      ctx.fillRect(px + 1, py - h / 2 - 2, 3, 3);
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - w / 2 + 0.5, py - h / 2 + 0.5, w - 1, h - 1);
    } else if (v.type === "barriertruck") {
      w = 2.4 * ts; h = 1.0 * ts;
      ctx.fillStyle = "#7a5a2a";
      ctx.fillRect(px - w / 2, py - h / 2, w, h);
      ctx.fillStyle = "#3d2c12";
      ctx.fillRect(px + w / 2 - 12, py - h / 2, 12, h);
      ctx.fillStyle = "#ffcc33";
      ctx.fillRect(px - w / 2 + 4, py - 3, w - 20, 6);
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - w / 2 + 0.5, py - h / 2 + 0.5, w - 1, h - 1);
    } else {
      w = 2.4 * ts; h = 1.0 * ts;
      ctx.fillStyle = "#4a86c5";
      ctx.fillRect(px - w / 2, py - h / 2, w, h);
      ctx.fillStyle = "#2b4f7a";
      ctx.fillRect(px + w / 2 - 10, py - h / 2, 10, h);
      ctx.fillStyle = "#bcd7f2";
      ctx.fillRect(px - w / 2 + 4, py - 2, w - 18, 4);
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - w / 2 + 0.5, py - h / 2 + 0.5, w - 1, h - 1);
    }
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
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) {
        if (G.officers[i].arrestManual) {
          /* a new move order cancels a player-ordered arrest */
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
  function hasCar(G, squadIndex) { return loadoutOf(G, squadIndex) === "car"; }
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
