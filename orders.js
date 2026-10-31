var ORDERS = (function () {
  var NAMES = ["hold", "guard", "patrol", "push", "retreat", "auto"];
  var LETTER = { hold: "H", guard: "G", patrol: "P", push: ">", retreat: "<", auto: "A" };
  var RING = { hold: "#9aa5b5", guard: "#4a7fd0", patrol: "#2a9d8f", push: "#e63946", retreat: "#f4a261", auto: "#b07ce8" };

  function init(G) {
    if (!G) return;
    G.orders = [];
    G.ordersInit = true;
    var i, s, cx, cy, rec;
    for (i = 0; i < CONFIG.squadCount; i++) {
      s = squadCenter(G, i);
      cx = s ? s.x : 0; cy = s ? s.y : 0;
      rec = {
        order: "hold",
        postX: cx, postY: cy,
        targetX: null, targetY: null,
        rallyX: cx, rallyY: cy,
        waypoints: [],
        responding: false,
        savedOrder: null,
        respStart: 0, respQuiet: 0,
        lastMoveX: null, lastMoveY: null, lastMoveT: -999,
        nextThink: i * 0.17,
        pauseUntil: 0, wpIndex: 0,
        atPost: true,
        trigger: null,
        targetShop: null,
        lastShopX: 0, lastShopY: 0,
        nextLiaison: 0
      };
      G.orders.push(rec);
    }
  }

  function ensure(G) {
    if (!G) return false;
    if (!G.orders || !G.orders.length) init(G);
    return !!G.orders;
  }

  function rec(G, s) { return G.orders[s]; }

  function squadCenter(G, s) {
    var i, o, n = 0, x = 0, y = 0;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o.squad !== s || o.escorting) continue;
      x += o.x; y += o.y; n++;
    }
    if (!n) return null;
    return { x: x / n, y: y / n };
  }

  function leader(G, s) {
    var i;
    for (i = 0; i < G.officers.length; i++) if (G.officers[i].squad === s) return G.officers[i];
    return null;
  }

  function busy(G, s) {
    var i, o, any = false, allEsc = true, lead = leader(G, s);
    if (lead && lead.arrestTarget) return true;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o.squad !== s) continue;
      any = true;
      if (typeof o.kettleX === "number" || o.snatch) return true;
      if (!o.escorting) allEsc = false;
    }
    if (any && allEsc) return true;
    return false;
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function walkable(G, x, y) {
    return Police.isWalkable(G, Math.floor(x), Math.floor(y));
  }

  function shopAim(G, shop, fromX, fromY) {
    var cand = [
      [shop.x + 0.5, shop.y + 1.5],
      [shop.x + 0.5, shop.y - 0.5],
      [shop.x - 0.5, shop.y + 0.5],
      [shop.x + 1.5, shop.y + 0.5],
      [shop.x + 1.5, shop.y + 1.5],
      [shop.x - 0.5, shop.y + 1.5],
      [shop.x + 1.5, shop.y - 0.5],
      [shop.x - 0.5, shop.y - 0.5]
    ];
    var i, best = null, bd = 1e9, d;
    for (i = 0; i < cand.length; i++) {
      if (!walkable(G, cand[i][0], cand[i][1])) continue;
      d = dist(cand[i][0], cand[i][1], fromX, fromY);
      if (d < bd) { bd = d; best = cand[i]; }
    }
    if (best) return { x: best[0], y: best[1] };
    return { x: shop.x + 0.5, y: shop.y + 1.5 };
  }

  function moveTo(G, s, x, y, run) {
    var r = rec(G, s);
    if (!walkable(G, x, y)) {
      if (r.lastMoveX === null) return;
      x = r.lastMoveX; y = r.lastMoveY;
    }
    if (r.lastMoveX !== null && dist(x, y, r.lastMoveX, r.lastMoveY) <= 1 && G.time - r.lastMoveT < 5) return;
    if (G.time - r.lastMoveT < 1) return;
    Police.moveSquad(G, s, x, y, !!run);
    r.lastMoveX = x; r.lastMoveY = y; r.lastMoveT = G.time;
  }

  function activeAttackers(G, shop) {
    var out = [], i, a;
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (a.active && a.state === "attackShop" && a._targetShop === shop) out.push(a);
    }
    return out;
  }

  function shopAttacked(G, shop) {
    if (!shop || shop.broken) return null;
    var att = activeAttackers(G, shop);
    return att.length ? att : null;
  }

  function shopsUnderAttack(G) {
    var out = [], i, att;
    for (i = 0; i < G.shops.length; i++) {
      att = shopAttacked(G, G.shops[i]);
      if (att) out.push({ shop: G.shops[i], attackers: att });
    }
    return out;
  }

  function visibleViolent(G, a) {
    return a.active && (a.hasTool || a.revealedUntil > G.time || a.violentUntil > G.time);
  }

  function violentNear(G, x, y, r) {
    var i, a, rr = r * r, dx, dy;
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a.active || !visibleViolent(G, a)) continue;
      dx = a.x - x; dy = a.y - y;
      if (dx * dx + dy * dy <= rr) return a;
    }
    return null;
  }

  function avgMood(G, x, y, r) {
    var i, a, n = 0, sum = 0, rr = r * r, dx, dy;
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a.active) continue;
      dx = a.x - x; dy = a.y - y;
      if (dx * dx + dy * dy <= rr) { sum += a.mood; n++; }
    }
    return n ? sum / n : -1;
  }

  function countAgentsNear(G, x, y, r, arr) {
    var i, a, n = 0, rr = r * r, dx, dy;
    var list = arr || G.agents;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      dx = a.x - x; dy = a.y - y;
      if (dx * dx + dy * dy <= rr) n++;
    }
    return n;
  }

  function nearestWaypoint(r, cx, cy) {
    var i, best = 0, bd = 1e9, d;
    for (i = 0; i < r.waypoints.length; i++) {
      d = dist(cx, cy, r.waypoints[i].x, r.waypoints[i].y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function set(G, s, order, x, y) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    if (!r) return;
    if (order === "guard" || order === "auto") {
      r.postX = (typeof x === "number") ? x : (squadCenter(G, s) || { x: 0, y: 0 }).x;
      r.postY = (typeof y === "number") ? y : (squadCenter(G, s) || { x: 0, y: 0 }).y;
      if (typeof x !== "number") { var c = squadCenter(G, s); if (c) { r.postX = c.x; r.postY = c.y; } }
    }
    if (order === "retreat") {
      if (typeof x === "number") { r.rallyX = x; r.rallyY = y; }   // else the planned start point
      Police.setStance(G, s, "calm");
    }
    if (order === "push") {
      r.targetX = (typeof x === "number") ? x : null;
      r.targetY = (typeof y === "number") ? y : null;
      Police.setStance(G, s, "firm");
    }
    if (order !== "push") Police.setStance(G, s, "calm");
    r.order = order;
    r.responding = false;
    r.savedOrder = null;
    r.targetShop = null;
    r.wpIndex = 0;
    r.pauseUntil = 0;
    r.atPost = false;
    r.lastMoveX = null; r.lastMoveY = null;
  }

  function get(G, s) {
    if (!ensure(G)) return null;
    var r = G.orders[s];
    return {
      order: r.order, postX: r.postX, postY: r.postY,
      targetX: r.targetX, targetY: r.targetY,
      waypoints: r.waypoints, responding: r.responding
    };
  }

  function setTarget(G, s, x, y) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    r.targetX = x; r.targetY = y;
    if (r.order !== "push") { r.order = "push"; Police.setStance(G, s, "firm"); }
  }

  function setAll(G, order) {
    if (!ensure(G)) return;
    var i, c;
    for (i = 0; i < G.orders.length; i++) {
      if (order === "push" || order === "patrol") continue;
      c = squadCenter(G, i);
      if (order === "retreat" || !c) set(G, i, order);
      else set(G, i, order, c.x, c.y);
    }
    G.log("All squads: " + order);
  }

  function cycle(G, s) {
    if (!ensure(G)) return "hold";
    var r = G.orders[s];
    var idx = NAMES.indexOf(r.order);
    if (idx < 0) idx = 0;
    var next = NAMES[(idx + 1) % NAMES.length];
    if (next === "retreat") {
      set(G, s, "retreat");
    } else if (next === "push") {
      r.order = "push"; r.targetX = null; r.targetY = null;
      Police.setStance(G, s, "firm");
      r.responding = false; r.savedOrder = null;
    } else {
      var c = squadCenter(G, s);
      if (c) set(G, s, next, c.x, c.y); else set(G, s, next);
    }
    return r.order;
  }

  function addWaypoint(G, s, x, y) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    if (r.waypoints.length >= 6) return;
    r.waypoints.push({ x: x, y: y });
  }

  function clearWaypoints(G, s) {
    if (!ensure(G)) return;
    G.orders[s].waypoints = [];
    G.orders[s].wpIndex = 0;
  }

  function setTrigger(G, s, x, y, r) {
    if (!ensure(G)) return;
    G.orders[s].trigger = { x: x, y: y, r: (typeof r === "number") ? r : 6 };
  }

  function clearTrigger(G, s) {
    if (!ensure(G)) return;
    G.orders[s].trigger = null;
  }

  function onManualMove(G, s, x, y) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    r.responding = false;
    r.savedOrder = null;
    r.targetShop = null;
    if (r.order === "guard" || r.order === "auto") {
      r.postX = x; r.postY = y;
    } else if (r.order === "patrol" || r.order === "push" || r.order === "retreat") {
      r.order = "hold";
      Police.setStance(G, s, "calm");
    }
    r.lastMoveX = null; r.lastMoveY = null;
  }

  // --- trigger zone event detection ---
  function zoneEvent(G, t, cx, cy, cr) {
    var i, j, sh, att, a, rr = cr * cr, dx, dy;
    for (i = 0; i < G.shops.length; i++) {
      sh = G.shops[i];
      if (sh.broken) continue;
      att = shopAttacked(G, sh);
      if (!att) continue;
      dx = sh.x - cx; dy = sh.y - cy;
      if (dx * dx + dy * dy <= rr) return { x: sh.x + 0.5, y: sh.y + 0.5, shop: sh };
    }
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a.active || !visibleViolent(G, a)) continue;
      dx = a.x - cx; dy = a.y - cy;
      if (dx * dx + dy * dy <= rr) return { x: a.x, y: a.y };
    }
    if (typeof BAR !== "undefined" && BAR && BAR.list) {
      var bl = BAR.list();
      for (j = 0; j < bl.length; j++) {
        if (bl[j].done) continue;
        dx = bl[j].x - cx; dy = bl[j].y - cy;
        if (dx * dx + dy * dy <= rr) return { x: bl[j].x, y: bl[j].y };
      }
    }
    return null;
  }

  // --- per-order logic, called once per second ---
  function thinkGuard(G, s, r, cx, cy) {
    var C = CONFIG, radius = C.guardRadius || 8;
    var under = shopsUnderAttack(G), i, best = null, bd = 1e9, d, aim;
    for (i = 0; i < under.length; i++) {
      d = dist(under[i].shop.x + 0.5, under[i].shop.y + 0.5, r.postX, r.postY);
      if (d <= radius && d < bd) { bd = d; best = under[i]; }
    }
    if (best) {
      r.targetShop = best.shop;
      aim = shopAim(G, best.shop, cx, cy);
      moveTo(G, s, aim.x, aim.y, true);
      return;
    }
    r.targetShop = null;
    if (dist(cx, cy, r.postX, r.postY) > 1.2) {
      if (walkable(G, r.postX, r.postY)) moveTo(G, s, r.postX, r.postY, false);
      else moveTo(G, s, r.postX, r.postY, false);
    }
  }

  function thinkPatrol(G, s, r, cx, cy) {
    if (r.waypoints.length < 2) return;   // acts as hold until the route has 2 points
    var under = shopsUnderAttack(G), i, best = null, bd = 1e9, d, aim;
    for (i = 0; i < under.length; i++) {
      d = dist(under[i].shop.x + 0.5, under[i].shop.y + 0.5, cx, cy);
      if (d <= 6 && d < bd) { bd = d; best = under[i]; }
    }
    if (best) {
      r.wpIndex = nearestWaypoint(r, cx, cy);
      r.pauseUntil = 0;
      aim = shopAim(G, best.shop, cx, cy);
      moveTo(G, s, aim.x, aim.y, true);
      return;
    }
    var wp = r.waypoints[r.wpIndex % r.waypoints.length];
    if (!wp) return;
    if (dist(cx, cy, wp.x, wp.y) < 0.8) {
      if (r.pauseUntil === 0) { r.pauseUntil = G.time + 4; return; }
      if (G.time < r.pauseUntil) return;
      r.pauseUntil = 0;
      r.wpIndex = (r.wpIndex + 1) % r.waypoints.length;
      wp = r.waypoints[r.wpIndex];
    }
    if (r.pauseUntil && G.time < r.pauseUntil) return;
    moveTo(G, s, wp.x, wp.y, false);
  }

  function thinkPush(G, s, r, cx, cy) {
    if (r.targetX === null || typeof r.targetX !== "number") return;
    if (dist(cx, cy, r.targetX, r.targetY) <= 1.5) {
      r.order = "hold";
      Police.setStance(G, s, "calm");
      G.log("Squad " + (s + 1) + " reached its push line");
      return;
    }
    var near = 0, i, nb = Crowd.neighbors(G, cx, cy, 2.5), dx, dy;
    for (i = 0; i < nb.length; i++) {
      if (!nb[i].active) continue;
      dx = nb[i].x - cx; dy = nb[i].y - cy;
      if (dx * dx + dy * dy <= 6.25) near++;
    }
    if (near >= 8) { Police.shove(G, s); }
    moveTo(G, s, r.targetX, r.targetY, false);
  }

  function thinkRetreat(G, s, r, cx, cy) {
    Police.setStance(G, s, "calm");
    if (dist(cx, cy, r.rallyX, r.rallyY) <= 1.2) {
      r.order = "hold"; r.postX = r.rallyX; r.postY = r.rallyY;
      return;
    }
    moveTo(G, s, r.rallyX, r.rallyY, true);
  }

  function thinkAuto(G, s, r, cx, cy) {
    var C = CONFIG, range = C.autoRange || 14;
    var loadout = Police.getLoadout(G, s);
    var under = shopsUnderAttack(G);
    var i, best = null, bd = 1e9, d, aim, a;

    if (loadout === "liaison") {
      if (G.time < r.nextLiaison) return;
      r.nextLiaison = G.time + 5;
      var cand = [], tries = 0, ag;
      while (tries < 40 && cand.length < 40) {
        tries++;
        ag = G.agents[Math.floor(Math.random() * G.agents.length)];
        if (!ag || !ag.active) continue;
        if (dist(ag.x, ag.y, r.postX, r.postY) > range) continue;
        cand.push({ x: ag.x, y: ag.y });
      }
      var bestPt = null, bestMood = 60;
      for (i = 0; i < cand.length; i++) {
        if (violentNear(G, cand[i].x, cand[i].y, 4)) continue;
        var m = avgMood(G, cand[i].x, cand[i].y, 4);
        if (m > bestMood) { bestMood = m; bestPt = cand[i]; }
      }
      if (bestPt) moveTo(G, s, bestPt.x, bestPt.y, true);
      else if (dist(cx, cy, r.postX, r.postY) > 2) moveTo(G, s, r.postX, r.postY, false);
      return;
    }

    if (Police.hasCar(G, s)) {
      if (avgMood(G, cx, cy, 6) > 65) Police.loudspeaker(G, cx, cy, s);
    }

    // 1. shop under attack
    for (i = 0; i < under.length; i++) {
      d = dist(under[i].shop.x + 0.5, under[i].shop.y + 0.5, r.postX, r.postY);
      if (d <= range && d < bd) { bd = d; best = under[i]; }
    }
    if (best) {
      r.targetShop = best.shop;
      r.lastShopX = best.shop.x + 0.5; r.lastShopY = best.shop.y + 0.5;
      if (Police.hasWaterTruck(G, s)) {
        var cnt = countAgentsNear(G, best.shop.x + 0.5, best.shop.y + 0.5, 3, best.attackers);
        if (cnt >= 2) {
          var wr = CONFIG.waterRange || 8;
          var truck = getTruckPos(G, s);
          if (truck && dist(truck.x, truck.y, best.shop.x + 0.5, best.shop.y + 0.5) <= wr) {
            Police.waterCannon(G, best.shop.x + 0.5, best.shop.y + 0.5, s);
          }
        }
      }
      aim = shopAim(G, best.shop, cx, cy);
      moveTo(G, s, aim.x, aim.y, true);
      return;
    }
    r.targetShop = null;

    // 2. violent person near squad
    var thr = CONFIG.suspicionThreshold || 60;
    var bd2 = 1e9, bestA = null;
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a.active || !visibleViolent(G, a) || a.suspicion < thr) continue;
      d = dist(a.x, a.y, cx, cy);
      if (d <= 10 && d < bd2) { bd2 = d; bestA = a; }
    }
    if (bestA) { Police.orderArrest(G, s, bestA); return; }

    // 3. barricade being built
    if (typeof BAR !== "undefined" && BAR && BAR.list) {
      var bl = BAR.list(), bd3 = 1e9, bestB = null;
      for (i = 0; i < bl.length; i++) {
        if (bl[i].done) continue;
        d = dist(bl[i].x, bl[i].y, r.postX, r.postY);
        if (d <= range && d < bd3) { bd3 = d; bestB = bl[i]; }
      }
      if (bestB) {
        var tx = bestB.x + 0.5, ty = bestB.y + 0.5;
        if (!walkable(G, tx, ty)) { tx = bestB.x + 1.5; ty = bestB.y + 1.5; }
        moveTo(G, s, tx, ty, true);
        return;
      }
    }

    // 4. back to post
    if (dist(cx, cy, r.postX, r.postY) > 2) moveTo(G, s, r.postX, r.postY, false);
  }

  /* Called when live play starts: the planned positions become the rally points. */
  function startPlay(G) {
    if (!ensure(G)) return;
    for (var i = 0; i < G.orders.length; i++) {
      var c = squadCenter(G, i);
      if (c) { G.orders[i].rallyX = c.x; G.orders[i].rallyY = c.y; }
    }
  }

  function getTruckPos(G, s) {
    for (var i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i].squad === s && G.vehicles[i].type === "watertruck") return G.vehicles[i];
    }
    return null;
  }

  function thinkTrigger(G, s, r, cx, cy) {
    var t = r.trigger, ev = zoneEvent(G, t, t.x, t.y, t.r);
    if (ev) r.respQuiet = 0;
    else if (r.respQuiet === 0) r.respQuiet = G.time;
    if ((!ev && G.time - r.respQuiet >= 8) || G.time - r.respStart >= 40) {
      // done: resume the old order; a holding squad walks back to where it stood
      r.responding = false;
      r.order = r.savedOrder || "hold";
      r.savedOrder = null;
      r.respQuiet = 0; r.respStart = 0;
      r.lastMoveX = null;
      if (r.order === "push") Police.setStance(G, s, "firm");
      if (r.order === "hold" && typeof r.retX === "number") moveTo(G, s, r.retX, r.retY, false);
      return;
    }
    if (!ev || busy(G, s)) return;
    var aim = ev.shop ? shopAim(G, ev.shop, cx, cy) : ev;
    if (dist(cx, cy, aim.x, aim.y) > 1.2) moveTo(G, s, aim.x, aim.y, true);
  }

  function think(G, s) {
    var r = G.orders[s];
    if (!r) return;
    var c = squadCenter(G, s);
    if (!c) return;
    var cx = c.x, cy = c.y;

    if (r.responding) { thinkTrigger(G, s, r, cx, cy); return; }

    // trigger check for non-busy squads
    if (r.trigger && !busy(G, s)) {
      if (zoneEvent(G, r.trigger, r.trigger.x, r.trigger.y, r.trigger.r)) {
        r.savedOrder = r.order;
        r.responding = true;
        r.retX = cx; r.retY = cy;
        r.respStart = G.time; r.respQuiet = 0;
        G.log("Squad " + (s + 1) + " responds to its trigger zone");
        if (!G.stats) G.stats = {};
        G.stats.autoResponses = (G.stats.autoResponses || 0) + 1;
        thinkTrigger(G, s, r, cx, cy);
        return;
      }
    }

    if (r.order === "hold" || busy(G, s)) return;

    if (r.order === "guard") thinkGuard(G, s, r, cx, cy);
    else if (r.order === "patrol") thinkPatrol(G, s, r, cx, cy);
    else if (r.order === "push") thinkPush(G, s, r, cx, cy);
    else if (r.order === "retreat") thinkRetreat(G, s, r, cx, cy);
    else if (r.order === "auto") thinkAuto(G, s, r, cx, cy);
  }

  function update(G, dt) {
    if (!ensure(G)) return;
    var i, r;
    for (i = 0; i < G.orders.length; i++) {
      r = G.orders[i];
      if (G.time < r.nextThink) continue;
      r.nextThink = G.time + 1 + i * 0.03;
      think(G, i);
    }
  }

  // --- drawing ---
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ctx, G, selected, planning) {
    if (!ensure(G)) return;
    var S = Art.camera.S;
    var i, r, c, p, letter, col;
    ctx.save();

    // badges
    for (i = 0; i < G.orders.length; i++) {
      r = G.orders[i];
      if (!planning && r.order === "hold") continue;
      c = squadCenter(G, i);
      if (!c) continue;
      p = Art.project(c.x, c.y, 3);
      var bs = Math.max(7, 6 * S);   // half-size: readable at full-map zoom
      var bx = p.x + Math.max(12, 10 * S), by = p.y;
      letter = LETTER[r.order] || "H";
      col = RING[r.order] || RING.hold;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = col;
      roundRect(ctx, bx - bs, by - bs, bs * 2, bs * 2, bs * 0.4);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold " + Math.round(bs * 1.5) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, bx, by + 0.5);
      ctx.globalAlpha = 1;
    }

    // detail for selected / planning
    for (i = 0; i < G.orders.length; i++) {
      if (!planning && i !== selected) continue;
      r = G.orders[i];
      c = squadCenter(G, i);
      if (!c) continue;

      // patrol waypoints
      if (r.waypoints.length) {
        ctx.strokeStyle = "rgba(42,157,143,0.7)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        var w0 = Art.project(r.waypoints[0].x, r.waypoints[0].y, 0);
        ctx.moveTo(w0.x, w0.y);
        for (var k = 1; k < r.waypoints.length; k++) {
          var wk = Art.project(r.waypoints[k].x, r.waypoints[k].y, 0);
          ctx.lineTo(wk.x, wk.y);
        }
        if (r.waypoints.length > 1) {
          var wl = Art.project(r.waypoints[0].x, r.waypoints[0].y, 0);
          ctx.lineTo(wl.x, wl.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (var k2 = 0; k2 < r.waypoints.length; k2++) {
          var wp = Art.project(r.waypoints[k2].x, r.waypoints[k2].y, 0);
          ctx.fillStyle = "#2a9d8f";
          ctx.beginPath();
          ctx.arc(wp.x, wp.y, Math.max(6, 3.5 * S), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "bold " + Math.max(8, Math.round(8 * S)) + "px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(k2 + 1), wp.x, wp.y);
        }
      }

      // post + radius
      if (r.order === "guard" || r.order === "auto") {
        var pp = Art.project(r.postX, r.postY, 0);
        ctx.fillStyle = RING[r.order];
        ctx.beginPath();
        var ds = Math.max(5, 5 * S);
        ctx.moveTo(pp.x, pp.y - ds);
        ctx.lineTo(pp.x + ds, pp.y);
        ctx.lineTo(pp.x, pp.y + ds);
        ctx.lineTo(pp.x - ds, pp.y);
        ctx.closePath();
        ctx.fill();
        var rad = (r.order === "guard") ? (CONFIG.guardRadius || 8) : (CONFIG.autoRange || 14);
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, rad * 32 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // push arrow
      if (r.order === "push" && typeof r.targetX === "number") {
        var s0 = Art.project(c.x, c.y, 0);
        var t0 = Art.project(r.targetX, r.targetY, 0);
        ctx.strokeStyle = "#e63946";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(t0.x, t0.y);
        ctx.stroke();
        var ang = Math.atan2(t0.y - s0.y, t0.x - s0.x);
        ctx.fillStyle = "#e63946";
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t0.x - 8 * S * Math.cos(ang - 0.4), t0.y - 8 * S * Math.sin(ang - 0.4));
        ctx.lineTo(t0.x - 8 * S * Math.cos(ang + 0.4), t0.y - 8 * S * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
      }

      // trigger zone
      if (r.trigger) {
        var tp = Art.project(r.trigger.x, r.trigger.y, 0);
        var tr = r.trigger.r * 32 * S;
        ctx.fillStyle = "rgba(255,210,80,0.10)";
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,210,80,0.65)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffd250";
        ctx.font = "bold " + Math.max(10, Math.round(10 * S)) + "px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), tp.x, tp.y);
      }
    }

    ctx.restore();
  }

  return {
    init: init, update: update, draw: draw, set: set, get: get,
    setAll: setAll, cycle: cycle, setTarget: setTarget,
    addWaypoint: addWaypoint, clearWaypoints: clearWaypoints,
    setTrigger: setTrigger, clearTrigger: clearTrigger,
    onManualMove: onManualMove,
    NAMES: NAMES, startPlay: startPlay
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ORDERS;
