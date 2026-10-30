/* crowd.js - crowd agents, mood propagation, hidden rioters, BFS flow field.
 * Exposes a global Crowd object. All coordinates are in tile units.
 * Police units (step 3) hook in through G.officers and Crowd.arrest /
 * Crowd.loudspeaker. Crowd never writes agent.suspicion - police.js owns it.
 */
var Crowd = (function () {
  "use strict";

  /* ---------------- tile helpers ---------------- */
  function tkey(x, y) { return x + "," + y; }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < MAP.width && y < MAP.height;
  }

  function tileChar(x, y) {
    if (!inBounds(x, y)) return "#";
    return MAP.rows[y].charAt(x);
  }

  /* Solid = buildings, shops, blocked tiles (barriers, van), off-map. */
  function isSolidTile(G, x, y) {
    if (!inBounds(x, y)) return true;
    var ch = MAP.rows[y].charAt(x);
    if (ch === "#" || ch === "S") return true;
    return G.blocked.has(tkey(x, y));
  }

  /* Path-search wall: real solids plus tiles covered by parked vehicles.
   * Only used by BFS; collision tests must NOT consult G.vehBlocked. */
  function isPathWall(G, x, y) {
    if (isSolidTile(G, x, y)) return true;
    var k = tkey(x, y);
    return !!((G.vehBlocked && G.vehBlocked.has(k)) || (G.fireBlocked && G.fireBlocked.has(k)));
  }

  /* Circle-vs-tile test used to stop agents ending a step inside a wall. */
  function collides(G, x, y, r) {
    r = r || CONFIG.agentRadius;
    var x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    var y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (isSolidTile(G, tx, ty)) return true;
      }
    }
    return false;
  }

  /* ---------------- spatial hash ---------------- */
  function rebuildHash(G) {
    var buckets = new Map();
    var cell = CONFIG.hashCell;
    var list = G.agents;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.active) continue;
      var k = Math.floor(a.x / cell) + "," + Math.floor(a.y / cell);
      var b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(a);
    }
    G._hash = { cell: cell, buckets: buckets };
  }

  function neighbors(G, x, y, radius) {
    var out = [];
    var h = G._hash;
    if (!h) return out;
    var cell = h.cell;
    var r2 = radius * radius;
    var cx0 = Math.floor((x - radius) / cell), cx1 = Math.floor((x + radius) / cell);
    var cy0 = Math.floor((y - radius) / cell), cy1 = Math.floor((y + radius) / cell);
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var b = h.buckets.get(cx + "," + cy);
        if (!b) continue;
        for (var i = 0; i < b.length; i++) {
          var a = b[i];
          var dx = a.x - x, dy = a.y - y;
          if (dx * dx + dy * dy <= r2) out.push(a);
        }
      }
    }
    return out;
  }

  /* ---------------- BFS fields ---------------- */
  /* Distance (in tiles) from every walkable tile to the nearest source tile. */
  function bfsFrom(G, sources) {
    var W = MAP.width, H = MAP.height;
    var dist = new Float32Array(W * H);
    dist.fill(Infinity);
    var queue = [];
    var i;
    for (i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!inBounds(s.x, s.y) || isPathWall(G, s.x, s.y)) continue;
      var si = s.y * W + s.x;
      if (dist[si] !== Infinity) continue;
      dist[si] = 0;
      queue.push(si);
    }
    var head = 0;
    while (head < queue.length) {
      var idx = queue[head++];
      var cx = idx % W, cy = (idx - cx) / W;
      var cd = dist[idx];
      if (cx > 0 && !isPathWall(G, cx - 1, cy) && dist[idx - 1] === Infinity) { dist[idx - 1] = cd + 1; queue.push(idx - 1); }
      if (cx < W - 1 && !isPathWall(G, cx + 1, cy) && dist[idx + 1] === Infinity) { dist[idx + 1] = cd + 1; queue.push(idx + 1); }
      if (cy > 0 && !isPathWall(G, cx, cy - 1) && dist[idx - W] === Infinity) { dist[idx - W] = cd + 1; queue.push(idx - W); }
      if (cy < H - 1 && !isPathWall(G, cx, cy + 1) && dist[idx + W] === Infinity) { dist[idx + W] = cd + 1; queue.push(idx + W); }
    }
    return dist;
  }

  /* Flow field from the whole plaza, recomputed when the map changes. */
  function rebuildFlow(G) {
    var W = MAP.width, H = MAP.height;
    var sources = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (tileChar(x, y) === "P") sources.push({ x: x, y: y });
      }
    }
    G.flow = bfsFrom(G, sources);
    G.flowVersion = (G.flowVersion || 0) + 1;
    G._shopFields = null;   // invalidate per-shop caches
    G._siteFields = null;
    G._zoneFields = null;
  }

  /* Half extents (length/width) of a vehicle type, kept local to crowd. */
  function vehDims(type) {
    if (type === "car") return { L: 0.9, W: 0.42 };
    return { L: 1.3, W: 0.5 };
  }

  /* Push an agent out of any vehicle's expanded oriented rectangle along the
   * nearest side. Never pushes into a solid tile; sub-steps avoid tunnelling. */
  function pushOutOfVehicles(G, a) {
    if (!G.vehicles) return;
    var rad = CONFIG.agentRadius || 0.25;
    for (var vi = 0; vi < G.vehicles.length; vi++) {
      var v = G.vehicles[vi];
      var d = vehDims(v.type);
      var hl = d.L + rad, hw = d.W + rad;
      var ang = (typeof v.ang === "number") ? v.ang : 0;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var dx = a.x - v.x, dy = a.y - v.y;
      var lx = dx * ca + dy * sa;       /* along the vehicle */
      var ly = -dx * sa + dy * ca;      /* across the vehicle */
      if (lx > -hl && lx < hl && ly > -hw && ly < hw) {
        /* minimal translation in local space */
        var px = (hl - lx) < (lx + hl) ? (hl - lx) : -(lx + hl);
        var py = (hw - ly) < (ly + hw) ? (hw - ly) : -(ly + hw);
        var mx = 0, my = 0;
        if (Math.abs(px) <= Math.abs(py)) mx = px; else my = py;
        /* rotate the push back into world space */
        var wx = mx * ca - my * sa, wy = mx * sa + my * ca;
        var steps = Math.ceil(Math.sqrt(wx * wx + wy * wy) / 0.1) || 1;
        var sxp = wx / steps, syp = wy / steps;
        for (var s = 0; s < steps; s++) {
          var tx = a.x + sxp, ty = a.y + syp;
          if (collides(G, tx, ty)) break;
          a.x = tx; a.y = ty;
        }
      }
    }
  }

  /* Walkable tiles around a shop the rioters can stand on to break it. */
  function shopAccessTiles(G, shop) {
    var out = [];
    var d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var x = shop.x + d[i][0], y = shop.y + d[i][1];
      if (!isSolidTile(G, x, y)) out.push({ x: x, y: y });
    }
    return out;
  }

  /* Cached per-shop BFS field (cheap: 6 shops, rebuilt only on map change). */
  function shopField(G, shop) {
    if (!G._shopFields) G._shopFields = {};
    if (Object.prototype.hasOwnProperty.call(G._shopFields, shop.id)) {
      return G._shopFields[shop.id];
    }
    var acc = shopAccessTiles(G, shop);
    var f = acc.length ? bfsFrom(G, acc) : null;
    G._shopFields[shop.id] = f;
    return f;
  }

  /* ---------------- street blockade sites ---------------- */
  function siteField(G, i) {
    var sites = CONFIG.blockSites || [];
    if (!sites[i]) return null;
    if (!G._siteFields) G._siteFields = {};
    if (Object.prototype.hasOwnProperty.call(G._siteFields, i)) return G._siteFields[i];
    var s = sites[i], src = [];
    for (var y = s.y; y < s.y + s.h; y++) {
      for (var x = s.x; x < s.x + s.w; x++) src.push({ x: x, y: y });
    }
    var f = bfsFrom(G, src);
    G._siteFields[i] = f;
    return f;
  }

  /* Pick a site for a peaceful agent: nearest by walking distance, with a
   * penalty for sites that already have many agents. -1 means plaza. */
  function assignSite(G, a) {
    var sites = CONFIG.blockSites || [];
    if (!G._siteLoad) G._siteLoad = [];
    if (a._site >= 0 && G._siteLoad[a._site] > 0) G._siteLoad[a._site]--;
    a._site = -1;
    var ps = (CONFIG.plazaShare === undefined) ? 0.25 : CONFIG.plazaShare;
    if (Math.random() < ps) return;
    var tx = Math.floor(a.x), ty = Math.floor(a.y), best = -1, bestCost = Infinity;
    for (var i = 0; i < sites.length; i++) {
      var f = siteField(G, i);
      var d = f ? f[ty * MAP.width + tx] : Infinity;
      if (d === undefined || d === Infinity) continue;
      var cost = d + (G._siteLoad[i] || 0) * 1.5;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    a._site = best;
    if (best >= 0) G._siteLoad[best] = (G._siteLoad[best] || 0) + 1;
  }

  /* Point a peaceful agent's flow field at its site; reassign if the site is unreachable. */
  function applySite(G, a) {
    var f = siteField(G, a._site);
    var v = f ? f[Math.floor(a.y) * MAP.width + Math.floor(a.x)] : Infinity;
    if (v === undefined || v === Infinity) {
      assignSite(G, a);
      f = (a._site >= 0) ? siteField(G, a._site) : null;
    }
    a._flow = (a._site >= 0) ? f : null;
  }

  /* ---------------- protest areas (random city mode) ----------------
   * CONFIG.rallyZones: areas the protesters occupy and stay in. Field value 0
   * means "inside the area"; there agents mill about instead of freezing. */
  function zoneField(G, i) {
    var zs = CONFIG.rallyZones || [];
    if (!zs[i]) return null;
    if (!G._zoneFields) G._zoneFields = {};
    if (Object.prototype.hasOwnProperty.call(G._zoneFields, i)) return G._zoneFields[i];
    var f = bfsFrom(G, zs[i].tiles || [{ x: zs[i].x, y: zs[i].y }]);
    G._zoneFields[i] = f;
    return f;
  }

  function leaveZone(G, a) {
    if (G._zoneLoad && a._zone >= 0 && G._zoneLoad[a._zone] > 0) G._zoneLoad[a._zone]--;
    a._zone = -1;
  }

  /* Pick an area: close by walking distance, not overfull, a little random. */
  function assignZone(G, a, avoidCurrent) {
    var zs = CONFIG.rallyZones || [];
    if (!G._zoneLoad) G._zoneLoad = [];
    var cur = a._zone;
    leaveZone(G, a);
    var idx = Math.floor(a.y) * MAP.width + Math.floor(a.x), best = -1, bestC = Infinity, bestF = null;
    for (var i = 0; i < zs.length; i++) {
      var f = zoneField(G, i), d = f ? f[idx] : Infinity;
      if (d === undefined || d === Infinity) continue;
      var cap = (zs[i].tiles ? zs[i].tiles.length : 20) * 1.3, load = G._zoneLoad[i] || 0;
      var cost = d * 0.6 + (load / cap) * 40 + Math.random() * 12;
      if (load >= cap) cost += 60;
      if (avoidCurrent && i === cur) cost += 80;
      if (cost < bestC) { bestC = cost; best = i; bestF = f; }
    }
    a._zone = best;
    a._flow = bestF;
    a._flowVer = G.flowVersion;
    a._zoneUntil = G.time + 45 + Math.random() * 90;
    if (best >= 0) G._zoneLoad[best] = (G._zoneLoad[best] || 0) + 1;
  }

  /* Keep a protester's area field fresh, and now and then march elsewhere. */
  function tendZone(G, a) {
    if (a._zone >= 0 && a._flowVer !== G.flowVersion) {
      a._flow = zoneField(G, a._zone);
      a._flowVer = G.flowVersion;
      var v = a._flow ? a._flow[Math.floor(a.y) * MAP.width + Math.floor(a.x)] : Infinity;
      if (v === undefined || v === Infinity) assignZone(G, a, true);
    }
    if (G.time >= a._zoneUntil) {
      if (Math.random() < (CONFIG.zoneSwitchChance || 0)) assignZone(G, a, true);
      else a._zoneUntil = G.time + 50 + Math.random() * 70;
    }
  }

  /* Random city mode: people come out of houses and in from the edges over time.
   * Rioters appear near the shopping strips. */
  function placeTrickle(G) {
    var doors = MAP.doors, trickle = CONFIG.spawnTrickleSeconds, i, k;
    var early = CONFIG.spawnAtStart || 0, doorShare = CONFIG.doorSpawnShare || 0;
    for (i = 0; i < G.agents.length; i++) {
      var a = G.agents[i], door = null;
      if (a.role === "rioter" && G.shops.length) {
        var sh = G.shops[Math.floor(Math.random() * G.shops.length)], near = [];
        for (k = 0; k < doors.length; k++) {
          var dx = doors[k].x - sh.x, dy = doors[k].y - sh.y;
          if (dx * dx + dy * dy < 144) near.push(doors[k]);
        }
        if (near.length) door = near[Math.floor(Math.random() * near.length)];
        a.spawnAt = 8 + Math.random() * trickle * 0.8;
      } else {
        if (Math.random() < doorShare) door = doors[Math.floor(Math.random() * doors.length)];
        a.spawnAt = Math.random() < early ? 0 : Math.random() * trickle;
      }
      if (door) {
        a.x = door.x + 0.25 + Math.random() * 0.5;
        a.y = door.y + 0.25 + Math.random() * 0.5;
      }
      if (a.spawnAt > 0) { a.active = false; a.pending = true; }
    }
  }

  /* ---------------- setup ---------------- */
  function init(G) {
    G.agents = [];
    G.time = 0;

    var sp = MAP.crowdSpawn;
    var zones = CONFIG.spawnZones || [{ x: sp.x, y: sp.y, w: sp.w, h: sp.h, share: 1 }];
    var zoneTiles = [], shareSum = 0, zi;
    for (zi = 0; zi < zones.length; zi++) {
      var zt = [], zz = zones[zi];
      for (var zy = zz.y; zy < zz.y + zz.h; zy++) {
        for (var zx = zz.x; zx < zz.x + zz.w; zx++) {
          if (inBounds(zx, zy) && !isSolidTile(G, zx, zy)) zt.push({ x: zx, y: zy });
        }
      }
      zoneTiles.push(zt);
      if (zt.length) shareSum += zz.share;
    }
    if (shareSum <= 0) { zones = [{ share: 1 }]; zoneTiles = [[{ x: sp.x, y: 18 }]]; shareSum = 1; }

    for (var i = 0; i < CONFIG.crowdSize; i++) {
      /* Round-robin over the spawn tiles: even spread, several per tile when
       * the spawn rectangle has fewer tiles than agents. */
      var pick = (i + 0.5) / CONFIG.crowdSize * shareSum, acc = 0, zsel = 0;
      for (zi = 0; zi < zones.length; zi++) {
        if (!zoneTiles[zi].length) continue;
        acc += zones[zi].share; zsel = zi;
        if (pick <= acc) break;
      }
      var zlist = zoneTiles[zsel];
      var t = zlist[i % zlist.length];
      G.agents.push({
        id: i,
        x: t.x + 0.2 + Math.random() * 0.6,
        y: t.y + 0.2 + Math.random() * 0.6,
        vx: 0, vy: 0,
        mood: 10 + Math.random() * 15,
        role: "peaceful",
        suspicion: 0,
        revealedUntil: 0,
        arrested: false,
        active: true,
        hasTool: false,
        state: "march",
        speed: CONFIG.agentSpeedMin + Math.random() * (CONFIG.agentSpeedMax - CONFIG.agentSpeedMin),
        stamina: 100,
        _exhausted: false,
        _flow: null,
        _targetShop: null,
        _wanderT: 0,
        _wanderA: 0,
        _highMoodTime: 0,
        _blocked: false,
        _fleeUntil: 0,
        _throwCd: 0,
        violentUntil: 0
      });
    }

    /* Pick exactly CONFIG.rioterCount rioters at random (Fisher-Yates). */
    var idx = [];
    for (var k = 0; k < G.agents.length; k++) idx.push(k);
    for (var m = idx.length - 1; m > 0; m--) {
      var q = Math.floor(Math.random() * (m + 1));
      var tmp = idx[m]; idx[m] = idx[q]; idx[q] = tmp;
    }
    var rn = Math.min(CONFIG.rioterCount, idx.length);
    for (var n = 0; n < rn; n++) G.agents[idx[n]].role = "rioter";
    G.rioterTotal = rn;

    var zoneMode = !!(CONFIG.rallyZones && CONFIG.rallyZones.length);
    if (zoneMode && CONFIG.spawnTrickleSeconds > 0 && MAP.doors && MAP.doors.length) placeTrickle(G);

    rebuildFlow(G);
    rebuildHash(G);

    G._siteLoad = [];
    G._zoneLoad = [];
    for (var ai = 0; ai < G.agents.length; ai++) {
      var ag = G.agents[ai];
      ag._site = -1;
      ag._zone = -1;
      if (ag.role !== "peaceful") continue;
      if (zoneMode) { if (ag.active) assignZone(G, ag); }
      else assignSite(G, ag);
    }
  }

  /* ---------------- helpers used by the sim ---------------- */
  function averageMood(G) {
    var sum = 0, n = 0;
    for (var i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (!a.active) continue;
      sum += a.mood; n++;
    }
    return n ? sum / n : 0;
  }

  function hasPath(G, a) {
    var tx = Math.floor(a.x), ty = Math.floor(a.y);
    if (!inBounds(tx, ty)) return false;
    if (isPathWall(G, tx, ty)) return false;
    var f = G.flow[ty * MAP.width + tx];
    return f !== undefined && f !== Infinity;
  }

  /* Unit direction down the current field (agent._flow or G.flow).
   * Returns null when the agent is at a source tile or has no path. */
  function desiredDir(G, a) {
    var W = MAP.width;
    var field = a._flow || G.flow;
    if (!field) return null;
    var tx = Math.floor(a.x), ty = Math.floor(a.y);
    var cur = field[ty * W + tx];
    if (cur === undefined || cur === Infinity || cur === 0) return null;
    var best = cur, bx = -1, by = -1;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = tx + dx, ny = ty + dy;
        if (!inBounds(nx, ny) || isSolidTile(G, nx, ny)) continue;
        /* no corner cutting */
        if (dx && dy && (isSolidTile(G, tx + dx, ty) || isSolidTile(G, tx, ty + dy))) continue;
        var v = field[ny * W + nx];
        if (v < best) { best = v; bx = nx; by = ny; }
      }
    }
    if (bx < 0) return null;
    var ddx = (bx + 0.5) - a.x, ddy = (by + 0.5) - a.y;
    var len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    return { x: ddx / len, y: ddy / len };
  }

  /* ---------------- mood ---------------- */
  function updateMood(G, a, nbrs, dt) {
    var C = CONFIG;
    var sum = 0, n = 0, near = 0;
    for (var i = 0; i < nbrs.length; i++) {
      var o = nbrs[i];
      if (o === a || !o.active) continue;
      var dx = o.x - a.x, dy = o.y - a.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= 1.0) near++;
      if (d2 <= C.moodSpreadRadius * C.moodSpreadRadius) { sum += o.mood; n++; }
    }

    var mood = a.mood;

    /* (a) spread: drift toward higher neighbour average */
    if (n > 0) {
      var avg = sum / n;
      if (avg > mood) mood += (avg - mood) * C.moodSpreadRate * dt;
    }

    /* (c) density */
    if (near > C.moodDensityThreshold) mood += C.moodDensityRise * dt;

    /* (b) blocked: no path to the plaza at all */
    var blocked = !hasPath(G, a);
    a._blocked = blocked;
    if (blocked) mood += C.moodBlockedRise * dt;

    /* (d) officers (police.js fills G.officers in step 3) */
    for (var oi = 0; oi < G.officers.length; oi++) {
      var off = G.officers[oi];
      var odx = off.x - a.x, ody = off.y - a.y;
      var od = Math.sqrt(odx * odx + ody * ody);
      if (off.stance === "firm") {
        if (od < C.moodOfficerFirmRadius) { mood += C.moodOfficerFirmRise * dt; break; }
      } else {
        if (od < C.moodOfficerCalmRadius) { mood += C.moodOfficerCalmRise * dt; break; }
      }
    }

    /* (e) a broken shop nearby raises tension */
    for (var si = 0; si < G.shops.length; si++) {
      var sh = G.shops[si];
      if (!sh.broken) continue;
      var sdx = sh.x - a.x, sdy = sh.y - a.y;
      if (sdx * sdx + sdy * sdy < C.moodBrokenShopRadius * C.moodBrokenShopRadius) {
        if (mood < C.moodBrokenShopCap) mood = Math.min(C.moodBrokenShopCap, mood + C.moodBrokenShopRise * dt);
        break;
      }
    }

    /* (f) decay toward the protest baseline: base, more in open space,
     * more with an open route. A crowd never becomes perfectly calm. */
    var decay = C.moodDecayBase;
    if (near < 3) decay += C.moodDecayOpenBonus;
    if (!blocked) decay += C.moodDecayPathBonus;
    if (mood > C.moodBaseline) {
      mood -= decay * dt;
      if (mood < C.moodBaseline) mood = C.moodBaseline;
    } else {
      mood += C.moodBaselineRecover * dt;
      if (mood > C.moodBaseline) mood = C.moodBaseline;
    }

    /* (g) a recent arrest nearby angers the crowd */
    if (G._angers) {
      for (var ei = 0; ei < G._angers.length; ei++) {
        var ev = G._angers[ei];
        if (ev.until <= G.time) continue;
        var edx = ev.x - a.x, edy = ev.y - a.y;
        if (edx * edx + edy * edy > C.arrestAngerRadius * C.arrestAngerRadius) continue;
        var arise = ev.wrong ? C.wrongArrestAngerRise : C.arrestAngerRise;
        var acap = ev.wrong ? C.wrongArrestAngerCap : C.arrestAngerCap;
        if (mood < acap) mood = Math.min(acap, mood + arise * dt);
      }
    }

    if (mood < 0) mood = 0;
    if (mood > 100) mood = 100;
    a.mood = mood;

    /* state hysteresis */
    if (a.mood >= C.agitMood && a.state === "march") a.state = "agitated";
    else if (a.mood < C.calmMood && a.state === "agitated") a.state = "march";

    /* radicalization: sustained extreme mood turns a peaceful agent violent */
    if (a.role === "peaceful") {
      if (a.mood >= C.radicalMood) {
        a._highMoodTime += dt;
        if (a._highMoodTime > C.radicalSeconds && Math.random() < C.radicalChance * dt) {
          a.role = "rioter";
          a._flow = null;
          a._targetShop = null;
          leaveZone(G, a);
          G.rioterTotal = (G.rioterTotal || 0) + 1;
          G.log("A protester has turned violent");
        }
      } else {
        a._highMoodTime = 0;
      }
    }
  }

  /* ---------------- movement ---------------- */
  function moveAgent(G, a, nbrs, dt) {
    var C = CONFIG;
    var vx = 0, vy = 0;

    var onPlaza = tileChar(Math.floor(a.x), Math.floor(a.y)) === "P";
    var rioterBusy = a.role === "rioter" && (a.state === "attackShop" || a.state === "flee");
    /* protest-area agents mill once inside their area; others on the plaza */
    var zoneMode = a.role === "peaceful" && a._zone >= 0 && a._flow;
    var mill = !rioterBusy && (zoneMode
      ? a._flow[Math.floor(a.y) * MAP.width + Math.floor(a.x)] === 0
      : onPlaza);

    if (mill) {
      /* Mill about the plaza instead of freezing. */
      a._wanderT -= dt;
      if (a._wanderT <= 0) {
        a._wanderT = 1 + Math.random() * 2;
        a._wanderA = Math.random() * Math.PI * 2;
      }
      vx = Math.cos(a._wanderA) * C.wanderSpeed;
      vy = Math.sin(a._wanderA) * C.wanderSpeed;
      /* milling about is walking: recover stamina */
      if (typeof a.stamina !== "number") a.stamina = 100;
      a.stamina = Math.min(100, a.stamina + C.staminaRegen * dt);
      if (a._exhausted && a.stamina >= C.staminaMinToRun) a._exhausted = false;
    } else {
      var dir = desiredDir(G, a);
      /* Running: rioters breaking shops or fleeing, and agitated agents sprint
       * while they still have stamina; exhausted agents fall back to walking. */
      var wantsRun = (a.role === "rioter" && (a.state === "attackShop" || a.state === "flee")) ||
                     a.state === "agitated";
      if (typeof a.stamina !== "number") a.stamina = 100;
      var running = wantsRun && !a._exhausted;
      if (running) {
        a.stamina -= C.staminaDrain * dt;
        if (a.stamina <= 0) { a.stamina = 0; a._exhausted = true; running = false; }
      } else {
        a.stamina = Math.min(100, a.stamina + C.staminaRegen * dt);
        if (a._exhausted && a.stamina >= C.staminaMinToRun) a._exhausted = false;
      }
      if (dir) {
        var sp = a.speed;
        if (running) {
          /* one run speed per agent, derived from its walk speed */
          var wmin = C.agentSpeedMin, wmax = C.agentSpeedMax;
          var rf = (wmax > wmin) ? (a.speed - wmin) / (wmax - wmin) : 0;
          if (rf < 0) rf = 0;
          if (rf > 1) rf = 1;
          sp = C.runSpeedMin + rf * (C.runSpeedMax - C.runSpeedMin);
        } else if (a.state === "agitated") {
          sp *= C.agitSpeedMul;
        }
        vx = dir.x * sp;
        vy = dir.y * sp;
        if (a.state === "agitated") {
          /* reduced obedience: random jitter, occasional pull toward police */
          vx += (Math.random() - 0.5) * C.agitJitter;
          vy += (Math.random() - 0.5) * C.agitJitter;
          if (G.officers.length && Math.random() < 0.02) {
            var off = G.officers[Math.floor(Math.random() * G.officers.length)];
            var odx = off.x - a.x, ody = off.y - a.y;
            var ol = Math.sqrt(odx * odx + ody * ody) || 1;
            vx += (odx / ol) * sp * 0.6;
            vy += (ody / ol) * sp * 0.6;
          }
        }
      } else {
        /* blocked / idle: only a small nervous shuffle */
        vx = (Math.random() - 0.5) * 0.4;
        vy = (Math.random() - 0.5) * 0.4;
      }
    }

    /* separation from close neighbours */
    var sepR = C.sepRadius;
    var sx = 0, sy = 0, cnt = 0;
    for (var i = 0; i < nbrs.length; i++) {
      var o = nbrs[i];
      if (o === a || !o.active) continue;
      var dx = a.x - o.x, dy = a.y - o.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > sepR * sepR) continue;
      if (d2 < 0.0001) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy + 0.0001; }
      var d = Math.sqrt(d2);
      sx += dx / d; sy += dy / d;
      cnt++;
    }
    if (cnt) {
      vx += (sx / cnt) * C.sepStrength;
      vy += (sy / cnt) * C.sepStrength;
    }

    /* police lines: foot officers slow nearby protesters (firm more than calm)
     * and softly push back anyone who gets right up against them */
    var lineR = C.policeLineRadius || 0;
    if (lineR > 0 && G.officers.length) {
      var slow = 1, rx = 0, ry = 0;
      for (var li = 0; li < G.officers.length; li++) {
        var lo = G.officers[li];
        if (lo.escorting || (typeof lo.baseSpeed === "number" && lo.baseSpeed >= C.motorbikeSpeed)) continue;
        var ldx = a.x - lo.x, ldy = a.y - lo.y;
        var ld2 = ldx * ldx + ldy * ldy;
        if (ld2 > lineR * lineR) continue;
        var lm = (lo.stance === "firm") ? C.policeLineSlowFirm : C.policeLineSlowCalm;
        if (lm < slow) slow = lm;
        var ld = Math.sqrt(ld2) || 0.001;
        if (ld < 0.6) {
          var lp = (0.6 - ld) / 0.6 * 2.0;
          rx += ldx / ld * lp;
          ry += ldy / ld * lp;
        }
      }
      vx = vx * slow + rx;
      vy = vy * slow + ry;
    }

    /* random city mode: people step out of the way of police vehicles.
     * With CONFIG.vehiclesBlock the push becomes a hard rectangle push-out
     * after the step instead (see below), so skip the soft push then. */
    if (C.crowdBlocksPolice && G.vehicles && !C.vehiclesBlock) {
      for (var vi = 0; vi < G.vehicles.length; vi++) {
        var vh = G.vehicles[vi];
        var vdx = a.x - vh.x, vdy = a.y - vh.y, vd2 = vdx * vdx + vdy * vdy;
        if (vd2 > 1.69) continue;
        var vd = Math.sqrt(vd2) || 0.001, vp = (1.3 - vd) / 1.3 * 2.5;
        vx += vdx / vd * vp;
        vy += vdy / vd * vp;
      }
    }

    /* water cannon push: decays linearly to zero by a._push.until */
    if (a._push && G.time < a._push.until) {
      var tLeft = (a._push.until - G.time) / C.waterPushSeconds;
      if (tLeft > 1) tLeft = 1;
      vx += a._push.vx * tLeft;
      vy += a._push.vy * tLeft;
    } else {
      a._push = null;
    }

    /* per-axis collision so agents slide along walls instead of sticking */
    var nx = a.x + vx * dt;
    if (!collides(G, nx, a.y)) a.x = nx;
    var ny = a.y + vy * dt;
    if (!collides(G, a.x, ny)) a.y = ny;

    /* vehicles are solid obstacles in random city mode */
    if (C.vehiclesBlock) pushOutOfVehicles(G, a);

    a.vx = vx; a.vy = vy;
  }

  /* ---------------- rioters ---------------- */
  function pickTargetShop(G, r) {
    var tx = Math.floor(r.x), ty = Math.floor(r.y);
    var best = null, bestD = Infinity, C = CONFIG;
    for (var i = 0; i < G.shops.length; i++) {
      var shop = G.shops[i];
      if (shop.broken) continue;
      var field = shopField(G, shop);
      if (!field) continue;
      var d = field[ty * MAP.width + tx];
      if (d === undefined || d === Infinity) continue;
      var score = d;
      if (C.shopDefense) {
        var guarded = false;
        if (G.officers) {
          var gr = C.shopGuardRadius || 4;
          for (var j = 0; j < G.officers.length; j++) {
            var o = G.officers[j];
            var ox = o.x - (shop.x + 1), oy = o.y - (shop.y + 1);
            if (ox * ox + oy * oy <= gr * gr) { guarded = true; break; }
          }
        }
        if ((shop.shutter || 0) < 0.5 && !guarded) score = d - 15;
      }
      if (score < bestD) { bestD = score; best = { shop: shop, field: field }; }
    }
    return best;
  }

  function shopGuardNear(G, shop, C) {
    if (!G.officers) return false;
    var gr = C.shopGuardRadius || 4, cx = shop.x + 1, cy = shop.y + 1;
    for (var j = 0; j < G.officers.length; j++) {
      var o = G.officers[j], ox = o.x - cx, oy = o.y - cy;
      if (ox * ox + oy * oy <= gr * gr) return true;
    }
    return false;
  }

  function startShutter(G, shop) {
    if (!CONFIG.shopDefense || shop.broken) return;
    if (shop.shutterClosing || shop.shutter >= 1) return;
    shop.shutterClosing = true;
    G.log("Shutters coming down at " + shop.name);
  }

  function updateShutters(G, dt) {
    var C = CONFIG;
    if (!C.shopDefense) return;
    var i, j, shop;
    var secs = C.shutterSeconds || 8;
    if (!G._shutterTick) G._shutterTick = 0;
    G._shutterTick += dt;
    var doMood = false;
    if (G._shutterTick >= 1) { G._shutterTick -= 1; doMood = true; }
    var radius = C.shutterAlertRadius || 14, r2 = radius * radius;
    for (i = 0; i < G.shops.length; i++) {
      shop = G.shops[i];
      if (shop.broken || shop.shutter >= 1) continue;
      if (doMood && !shop.shutterClosing) {
        var cx = shop.x + 1, cy = shop.y + 1, sum = 0, cnt = 0;
        for (j = 0; j < G.agents.length; j++) {
          var a = G.agents[j];
          if (!a.active) continue;
          var adx = a.x - cx, ady = a.y - cy;
          if (adx * adx + ady * ady <= 25) { sum += a.mood; cnt++; }
        }
        if (cnt && sum / cnt > (C.shutterMoodThreshold || 55)) startShutter(G, shop);
      }
      if (shop.shutterClosing) {
        shop.shutter = Math.min(1, (shop.shutter || 0) + dt / secs);
        if (shop.shutter >= 1) shop.shutter = 1;
      }
    }
    /* (b) shops near a broken shop start closing */
    for (i = 0; i < G.shops.length; i++) {
      if (!G.shops[i].broken) continue;
      for (j = 0; j < G.shops.length; j++) {
        shop = G.shops[j];
        if (shop.broken || shop.shutterClosing || shop.shutter >= 1) continue;
        var bx = shop.x - G.shops[i].x, by = shop.y - G.shops[i].y;
        if (bx * bx + by * by <= r2) startShutter(G, shop);
      }
    }
  }

  function updateRioter(G, r, dt) {
    var C = CONFIG;

    if (r.state === "flee") {
      if (G.time >= r._fleeUntil) {
        r.state = "march";
        r._flow = null;
        r._targetShop = null;
      } else if (!r._flow) {
        r._flow = G.flow;
      }
      return;
    }

    if (r.state === "attackShop") {
      var shop = r._targetShop;
      if (!shop || shop.broken) {
        r.state = "march"; r._flow = null; r._targetShop = null;
        return;
      }
      var dx = (shop.x + 0.5) - r.x, dy = (shop.y + 0.5) - r.y;
      if (Math.sqrt(dx * dx + dy * dy) < 1.6) {
        /* smashing it: visible for as long as the smashing continues */
        r.revealedUntil = Math.max(r.revealedUntil, G.time + 0.2);
        r.violentUntil = Math.max(r.violentUntil, G.time + C.violentSeconds);
        var rate = 100 / C.breakSeconds;
        if (C.shopDefense) {
          var gm = [1, 0.5, 0.3][shop.glass || 0];
          var sm = 1 - 0.8 * (shop.shutter || 0);
          var guarded = shopGuardNear(G, shop, C);
          var dm = guarded ? 0.25 : 1;
          rate = (100 / (C.shopBreakSeconds || 10)) * gm * sm * dm;
          startShutter(G, shop);
          if (guarded && G._guardTick !== G.time) {
            /* per-second abort check: cheap approach, independent rolls */
            if (!r._guardAbortAt || G.time >= r._guardAbortAt) {
              r._guardAbortAt = Math.floor(G.time) + 1;
              if (Math.random() < (C.guardAbortChance || 0.35)) {
                r.state = "flee";
                r._fleeUntil = G.time + C.fleeSeconds;
                r._flow = G.flow;
                r._targetShop = null;
                return;
              }
            }
          }
        }
        shop.hp -= rate * dt;
        if (shop.hp <= 0) {
          shop.hp = 0;
          shop.broken = true;
          if (typeof Art !== "undefined") Art.invalidate();
          G.stats.shopsDamaged++;
          G.log("Shop broken: " + shop.name);
          if (typeof FX !== "undefined") FX.shopBroken(G, shop);
          r.hasTool = true;
          r.revealedUntil = G.time + C.revealSeconds;
          G.log("Rioter spotted near " + shop.name);
          r.state = "flee";
          r._fleeUntil = G.time + C.fleeSeconds;
          r._flow = G.flow;
          r._targetShop = null;
          var nb = neighbors(G, r.x, r.y, 6), joined = 0;
          for (var i = 0; i < nb.length; i++) {
            if (nb[i].active) nb[i].mood = Math.min(100, nb[i].mood + C.shopBreakMoodSpike);
          }
          /* random city mode: angry bystanders close by join the looting */
          for (i = 0; C.lootJoinChance && i < nb.length && joined < 2; i++) {
            var by = nb[i], bdx = by.x - r.x, bdy = by.y - r.y;
            if (!by.active || by.role !== "peaceful" || by.mood < 50 || bdx * bdx + bdy * bdy > 16) continue;
            if (Math.random() >= C.lootJoinChance) continue;
            by.role = "rioter";
            by.state = "march";
            by._flow = null;
            by._targetShop = null;
            leaveZone(G, by);
            G.rioterTotal = (G.rioterTotal || 0) + 1;
            joined++;
          }
          if (joined) G.log("Bystanders join the looting near " + shop.name);
        }
      }
      return;
    }

    /* vanguard: a small chance per second to break off and go for a shop now */
    if (Math.random() < C.vanguardChance * dt) {
      var vt = pickTargetShop(G, r);
      if (vt) {
        r.state = "attackShop";
        r._targetShop = vt.shop;
        r._flow = vt.field;
        return;
      }
    }

    /* march: decide whether it is time to go after a shop */
    var onPlaza = tileChar(Math.floor(r.x), Math.floor(r.y)) === "P";
    var nearShop = false;
    if (!onPlaza) {
      for (var s = 0; s < G.shops.length; s++) {
        var sh = G.shops[s];
        if (sh.broken) continue;
        var sdx = sh.x - r.x, sdy = sh.y - r.y;
        if (sdx * sdx + sdy * sdy < C.rioterShopSeekRadius * C.rioterShopSeekRadius) { nearShop = true; break; }
      }
    }
    if (onPlaza || nearShop) {
      var target = pickTargetShop(G, r);
      if (target) {
        r.state = "attackShop";
        r._targetShop = target.shop;
        r._flow = target.field;
        return;
      }
    }

    /* armed rioters close to police may throw (police.js sets G.officers) */
    if (r.hasTool && G.officers.length && G.time >= r._throwCd) {
      for (var oi = 0; oi < G.officers.length; oi++) {
        var off = G.officers[oi];
        var odx = off.x - r.x, ody = off.y - r.y;
        if (Math.sqrt(odx * odx + ody * ody) < C.throwRange) {
          if (Math.random() < C.throwChance * dt) {
            r.revealedUntil = G.time + C.revealSeconds;
            r.violentUntil = Math.max(r.violentUntil, G.time + C.violentSeconds);
            r._throwCd = G.time + 3;
            G.log("Object thrown at police");
            if (typeof FX !== "undefined") FX.throwAt(G, r, off);
            var nb2 = neighbors(G, r.x, r.y, 5);
            for (var j = 0; j < nb2.length; j++) {
              if (nb2[j].active) nb2[j].mood = Math.min(100, nb2[j].mood + C.throwMoodSpike);
            }
          }
          break;
        }
      }
    }
  }

  /* ---------------- main update ---------------- */
  function update(G, dt) {
    if (!G.flow) rebuildFlow(G);
    if (!G.vehBlocked) G.vehBlocked = new Set();
    G.time += dt;

    var agents = G.agents, i;
    var zoneMode = !!(CONFIG.rallyZones && CONFIG.rallyZones.length);
    for (i = 0; i < agents.length; i++) {
      var pa = agents[i];
      if (!pa.pending || G.time < pa.spawnAt) continue;
      pa.pending = false;
      pa.active = true;
      if (zoneMode && pa.role === "peaceful") assignZone(G, pa);
    }
    rebuildHash(G);

    var queryR = Math.max(CONFIG.moodSpreadRadius, CONFIG.sepRadius);

    for (i = 0; i < agents.length; i++) {
      var am = agents[i];
      if (!am.active) continue;
      am._nbrs = neighbors(G, am.x, am.y, queryR);
      updateMood(G, am, am._nbrs, dt);
    }
    for (i = 0; i < agents.length; i++) {
      var sa = agents[i];
      if (!sa.active || sa.role !== "peaceful") continue;
      if (zoneMode) tendZone(G, sa);
      else if (sa._site >= 0) applySite(G, sa);
    }
    for (i = 0; i < agents.length; i++) {
      var mv = agents[i];
      if (!mv.active) continue;
      moveAgent(G, mv, mv._nbrs || [], dt);
    }
    for (i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (a.active && a.role === "rioter") updateRioter(G, a, dt);
    }
    updateShutters(G, dt);

    /* parked vehicles block narrow streets: recompute at most 4x per second */
    if (CONFIG.vehiclesBlock && G.vehicles) {
      G._vehBlockAcc = (G._vehBlockAcc || 0) + dt;
      if (G._vehBlockAcc >= 0.25) {
        G._vehBlockAcc = 0;
        var changed = recomputeVehBlocked(G);
        if (changed) rebuildFlow(G);
      }
    }

    /* stats: sample the average mood about once per second */
    G._moodAcc = (G._moodAcc || 0) + dt;
    if (G._moodAcc >= 1) {
      G._moodAcc = 0;
      var m = averageMood(G);
      G.stats.moodSum += m;
      G.stats.moodSamples++;
      if (m > G.stats.peakMood) G.stats.peakMood = m;
    }
  }

  /* Update each vehicle's parked state and rebuild G.vehBlocked.
   * Returns true if the set of blocked tiles changed. */
  function recomputeVehBlocked(G) {
    if (!G.vehBlocked) G.vehBlocked = new Set();
    var next = new Set();
    var W = MAP.width, H = MAP.height;
    for (var vi = 0; vi < G.vehicles.length; vi++) {
      var v = G.vehicles[vi];
      if (typeof v._px !== "number") { v._px = v.x; v._py = v.y; v._still = 0; }
      var moved = Math.abs(v.x - v._px) + Math.abs(v.y - v._py);
      if (moved >= 0.05) { v._still = 0; v._px = v.x; v._py = v.y; }
      else { v._still = (v._still || 0) + 0.25; v._px = v.x; v._py = v.y; }
      var parked = v._still >= 1.5;
      if (!parked) continue;
      var d = vehDims(v.type);
      var hl = d.L + 0.25, hw = d.W + 0.25;
      var ang = (typeof v.ang === "number") ? v.ang : 0;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var r = Math.sqrt(hl * hl + hw * hw);
      var x0 = Math.max(0, Math.floor(v.x - r)), x1 = Math.min(W - 1, Math.floor(v.x + r));
      var y0 = Math.max(0, Math.floor(v.y - r)), y1 = Math.min(H - 1, Math.floor(v.y + r));
      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          if (!inBounds(tx, ty)) continue;
          var ch = MAP.rows[ty].charAt(tx);
          if (ch === "#" || ch === "S") continue;
          var dx = (tx + 0.5) - v.x, dy = (ty + 0.5) - v.y;
          var lx = dx * ca + dy * sa;
          var ly = -dx * sa + dy * ca;
          if (lx > -hl && lx < hl && ly > -hw && ly < hw) next.add(tkey(tx, ty));
        }
      }
    }
    var same = (next.size === G.vehBlocked.size);
    if (same) {
      next.forEach(function (k) { if (!G.vehBlocked.has(k)) same = false; });
    }
    if (!same) G.vehBlocked = next;
    return !same;
  }

  /* ---------------- drawing ---------------- */
  function moodColor(m) {
    /* light blue-grey -> orange -> red */
    var r0 = 200, g0 = 220, b0 = 240;
    var r1 = 230, g1 = 140, b1 = 40;
    var r2 = 210, g2 = 40, b2 = 40;
    var t, r, g, b;
    if (m < 60) {
      t = m / 60;
      r = r0 + (r1 - r0) * t; g = g0 + (g1 - g0) * t; b = b0 + (b1 - b0) * t;
    } else {
      t = (m - 60) / 40; if (t > 1) t = 1;
      r = r1 + (r2 - r1) * t; g = g1 + (g2 - g1) * t; b = b1 + (b2 - b1) * t;
    }
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  function draw(ctx, G) {
    var ts = CONFIG.tileSize;
    var i;

    /* broken shops: dark tile with an X */
    for (i = 0; i < G.shops.length; i++) {
      var s = G.shops[i];
      if (!s.broken) continue;
      var sx = s.x * ts, sy = s.y * ts;
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(sx, sy, ts, ts);
      ctx.strokeStyle = "#0c0c0c";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx + 3, sy + 3); ctx.lineTo(sx + ts - 3, sy + ts - 3);
      ctx.moveTo(sx + ts - 3, sy + 3); ctx.lineTo(sx + 3, sy + ts - 3);
      ctx.stroke();
    }

    var r = CONFIG.agentRadius * ts;
    for (i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (!a.active) continue;
      var px = a.x * ts, py = a.y * ts;

      ctx.fillStyle = moodColor(a.mood);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      /* suspicion ring (police.js raises this in step 3) */
      if (a.suspicion > 20) {
        ctx.strokeStyle = "#ffe066";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (a.suspicion / 100));
        ctx.stroke();
      }

      /* revealed rioter marker (identical body, small red triangle above) */
      if (a.role === "rioter" && G.time < a.revealedUntil) {
        ctx.fillStyle = "#ff3030";
        ctx.beginPath();
        ctx.moveTo(px, py - r - 2);
        ctx.lineTo(px - 3, py - r - 7);
        ctx.lineTo(px + 3, py - r - 7);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /* ---------------- police hooks (used from step 3) ---------------- */
  function arrest(G, a) {
    if (!a || !a.active) return false;
    a.active = false;
    a.arrested = true;
    if (!G._angers) G._angers = [];
    G._angers = G._angers.filter(function (e) { return e.until > G.time; });
    G._angers.push({ x: a.x, y: a.y, until: G.time + CONFIG.arrestAngerSeconds, wrong: a.role !== "rioter" });
    if (a.role === "rioter") {
      G.stats.rioterArrested++;
      G.log("Rioter arrested");
    } else {
      G.stats.wrongArrests++;
      G.log("Wrong arrest");
      var nb = neighbors(G, a.x, a.y, 6);
      for (var i = 0; i < nb.length; i++) {
        if (nb[i].active) nb[i].mood = Math.min(100, nb[i].mood + CONFIG.wrongArrestMoodSpike);
      }
    }
    return true;
  }

  function loudspeaker(G, x, y, radiusTiles, strength) {
    var nb = neighbors(G, x, y, radiusTiles);
    for (var i = 0; i < nb.length; i++) {
      var a = nb[i];
      if (!a.active) continue;
      a.mood = Math.max(0, a.mood - strength);
    }
  }

  function push(G, x, y, radius, strength, fromX, fromY) {
    var nb = neighbors(G, x, y, radius);
    for (var i = 0; i < nb.length; i++) {
      var a = nb[i];
      if (!a.active) continue;
      var dx = a.x - fromX, dy = a.y - fromY;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.sqrt(dx * dx + dy * dy) || 1; }
      var vx = (dx / d) * strength;
      var vy = (dy / d) * strength;
      a._push = { vx: vx, vy: vy, until: G.time + CONFIG.waterPushSeconds };
    }
  }

  return {
    init: init,
    update: update,
    draw: draw,
    rebuildFlow: rebuildFlow,
    collides: collides,
    neighbors: neighbors,
    arrest: arrest,
    loudspeaker: loudspeaker,
    push: push,
    averageMood: averageMood
  };
})();