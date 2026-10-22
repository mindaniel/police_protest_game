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
      if (!inBounds(s.x, s.y) || isSolidTile(G, s.x, s.y)) continue;
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
      if (cx > 0 && !isSolidTile(G, cx - 1, cy) && dist[idx - 1] === Infinity) { dist[idx - 1] = cd + 1; queue.push(idx - 1); }
      if (cx < W - 1 && !isSolidTile(G, cx + 1, cy) && dist[idx + 1] === Infinity) { dist[idx + 1] = cd + 1; queue.push(idx + 1); }
      if (cy > 0 && !isSolidTile(G, cx, cy - 1) && dist[idx - W] === Infinity) { dist[idx - W] = cd + 1; queue.push(idx - W); }
      if (cy < H - 1 && !isSolidTile(G, cx, cy + 1) && dist[idx + W] === Infinity) { dist[idx + W] = cd + 1; queue.push(idx + W); }
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

  /* ---------------- setup ---------------- */
  function init(G) {
    G.agents = [];
    G.time = 0;

    var sp = MAP.crowdSpawn;
    var tiles = [];
    for (var y = sp.y; y < sp.y + sp.h; y++) {
      for (var x = sp.x; x < sp.x + sp.w; x++) {
        if (inBounds(x, y) && !isSolidTile(G, x, y)) tiles.push({ x: x, y: y });
      }
    }
    if (!tiles.length) tiles.push({ x: sp.x, y: 18 });   // safety fallback

    for (var i = 0; i < CONFIG.crowdSize; i++) {
      /* Round-robin over the spawn tiles: even spread, several per tile when
       * the spawn rectangle has fewer tiles than agents. */
      var t = tiles[i % tiles.length];
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
        _flow: null,
        _targetShop: null,
        _wanderT: 0,
        _wanderA: 0,
        _highMoodTime: 0,
        _blocked: false,
        _fleeUntil: 0,
        _throwCd: 0
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

    rebuildFlow(G);
    rebuildHash(G);
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
        mood += C.moodBrokenShopRise * dt;
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

    if (onPlaza && !rioterBusy) {
      /* Mill about the plaza instead of freezing. */
      a._wanderT -= dt;
      if (a._wanderT <= 0) {
        a._wanderT = 1 + Math.random() * 2;
        a._wanderA = Math.random() * Math.PI * 2;
      }
      vx = Math.cos(a._wanderA) * C.wanderSpeed;
      vy = Math.sin(a._wanderA) * C.wanderSpeed;
    } else {
      var dir = desiredDir(G, a);
      if (dir) {
        var sp = a.speed;
        if (a.state === "agitated") sp *= C.agitSpeedMul;
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

    /* per-axis collision so agents slide along walls instead of sticking */
    var nx = a.x + vx * dt;
    if (!collides(G, nx, a.y)) a.x = nx;
    var ny = a.y + vy * dt;
    if (!collides(G, a.x, ny)) a.y = ny;

    a.vx = vx; a.vy = vy;
  }

  /* ---------------- rioters ---------------- */
  function pickTargetShop(G, r) {
    var tx = Math.floor(r.x), ty = Math.floor(r.y);
    var best = null, bestD = Infinity;
    for (var i = 0; i < G.shops.length; i++) {
      var shop = G.shops[i];
      if (shop.broken) continue;
      var field = shopField(G, shop);
      if (!field) continue;
      var d = field[ty * MAP.width + tx];
      if (d === undefined || d === Infinity) continue;
      if (d < bestD) { bestD = d; best = { shop: shop, field: field }; }
    }
    return best;
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
        shop.hp -= (100 / C.breakSeconds) * dt;
        if (shop.hp <= 0) {
          shop.hp = 0;
          shop.broken = true;
          G.stats.shopsDamaged++;
          G.log("Shop broken: " + shop.name);
          r.hasTool = true;
          r.revealedUntil = G.time + C.revealSeconds;
          G.log("Rioter spotted near " + shop.name);
          r.state = "flee";
          r._fleeUntil = G.time + C.fleeSeconds;
          r._flow = G.flow;
          r._targetShop = null;
          var nb = neighbors(G, r.x, r.y, 6);
          for (var i = 0; i < nb.length; i++) {
            if (nb[i].active) nb[i].mood = Math.min(100, nb[i].mood + C.shopBreakMoodSpike);
          }
        }
      }
      return;
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
            r._throwCd = G.time + 3;
            G.log("Object thrown at police");
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
    G.time += dt;
    rebuildHash(G);

    var agents = G.agents, i;
    var queryR = Math.max(CONFIG.moodSpreadRadius, CONFIG.sepRadius);

    for (i = 0; i < agents.length; i++) {
      var am = agents[i];
      if (!am.active) continue;
      am._nbrs = neighbors(G, am.x, am.y, queryR);
      updateMood(G, am, am._nbrs, dt);
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

  return {
    init: init,
    update: update,
    draw: draw,
    rebuildFlow: rebuildFlow,
    neighbors: neighbors,
    arrest: arrest,
    loudspeaker: loudspeaker,
    averageMood: averageMood
  };
})();