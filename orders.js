var ORDERS = (function () {
  var NAMES = ["hold", "guard", "patrol", "push", "retreat", "auto"];
  var LETTER = { hold: "H", guard: "G", patrol: "P", push: ">", retreat: "<", auto: "A" };
  var RING = { hold: "#9aa5b5", guard: "#4a7fd0", patrol: "#2a9d8f", push: "#e63946", retreat: "#f4a261", auto: "#b07ce8" };

  function init(G) {
    if (!G) return;
    G.orders = [];
    G.ordersInit = true;
    for (var i = 0; i < CONFIG.squadCount; i++) G.orders.push(makeRec(G, i));
  }

  /* One squad's record; default order depends on unit type. */
  function makeRec(G, i) {
    var s, cx, cy, rec, loadout, patrol;
    {
      s = squadCenter(G, i);
      cx = s ? s.x : 0; cy = s ? s.y : 0;
      loadout = "none";
      if (typeof Police !== "undefined" && Police.getLoadout) loadout = Police.getLoadout(G, i);
      patrol = (loadout === "car" || loadout === "motorbike");
      rec = {
        order: patrol ? "patrol" : "hold",
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
        nextLiaison: 0,
        autoRoute: true,
        autoFrom: { x: cx, y: cy },
        area: null,
        areaAuto: true,
        areaTried: false,
        areaTargetX: null,
        areaTargetY: null,
        roamPauseUntil: 0,
        roamLast: [],
        roamBestDist: 1e9,
        roamProgressT: 0
      };
    }
    return rec;
  }

  function ensure(G) {
    if (!G) return false;
    if (!G.orders || !G.orders.length) init(G);
    while (G.orders.length < CONFIG.squadCount) G.orders.push(makeRec(G, G.orders.length));
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

  function nearestShopDist(G, x, y) {
    var shops = G.shops || [], i, sh, dx, dy, d, best = 1e9;
    for (i = 0; i < shops.length; i++) {
      sh = shops[i];
      dx = sh.x + 0.5 - x; dy = sh.y + 0.5 - y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    return best;
  }

  function findWalkableNear(G, x, y, r) {
    var i, j, nx, ny;
    if (walkable(G, x, y)) return { x: x, y: y };
    for (i = 1; i <= r; i++) {
      for (j = -i; j <= i; j++) {
        nx = x + j; ny = y - i; if (walkable(G, nx, ny)) return { x: nx, y: ny };
        nx = x + j; ny = y + i; if (walkable(G, nx, ny)) return { x: nx, y: ny };
        nx = x - i; ny = y + j; if (walkable(G, nx, ny)) return { x: nx, y: ny };
        nx = x + i; ny = y + j; if (walkable(G, nx, ny)) return { x: nx, y: ny };
      }
    }
    return null;
  }

  function autoRoute(G, s) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    if (!r) return;
    var c = squadCenter(G, s);
    if (!c) return;

    var loadout = "none";
    if (typeof Police !== "undefined" && Police.getLoadout) loadout = Police.getLoadout(G, s);
    var fast = (loadout === "car" || loadout === "motorbike");
    var minR = fast ? 10 : 6;
    var maxR = fast ? 18 : 10;
    var desiredR = fast ? 14 : 8;

    var sx = Math.floor(c.x), sy = Math.floor(c.y);
    var start = findWalkableNear(G, sx, sy, 4);
    if (!start) {
      r.waypoints = [];
      r.wpIndex = 0;
      r.autoFrom = { x: c.x, y: c.y };
      return;
    }

    var seen = {}, q = [], head = 0, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var key = start.x + "," + start.y;
    seen[key] = true;
    q.push({ x: start.x, y: start.y, d: 0 });

    var candidates = [];
    while (head < q.length) {
      var cur = q[head++];
      if (cur.d > 0) {
        var dx = cur.x - start.x, dy = cur.y - start.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd >= 2 && dd <= maxR) {
          candidates.push({ x: cur.x, y: cur.y, d: dd, ang: Math.atan2(dy, dx) });
        }
      }
      if (cur.d >= maxR) continue;
      for (var k = 0; k < 4; k++) {
        var nx = cur.x + dirs[k][0], ny = cur.y + dirs[k][1];
        var nk = nx + "," + ny;
        if (seen[nk]) continue;
        seen[nk] = true;
        if (walkable(G, nx, ny)) q.push({ x: nx, y: ny, d: cur.d + 1 });
      }
    }

    var n = 4 + Math.floor(Math.random() * 3);
    var sectors = [], i, j, cand, sec, best, bd, score, sd;

    for (i = 0; i < n; i++) sectors.push(null);

    for (i = 0; i < candidates.length; i++) {
      cand = candidates[i];
      if (cand.d < minR) continue;
      sec = Math.floor(((cand.ang + Math.PI) / (Math.PI * 2)) * n) % n;
      sd = nearestShopDist(G, cand.x + 0.5, cand.y + 0.5);
      score = Math.min(sd, 8) * 0.7 + Math.abs(cand.d - desiredR) * 0.15;
      if (!sectors[sec] || score < sectors[sec].score) {
        sectors[sec] = { x: cand.x, y: cand.y, d: cand.d, ang: cand.ang, score: score };
      }
    }

    for (i = 0; i < n; i++) {
      if (sectors[i]) continue;
      best = null; bd = 1e9;
      for (j = 0; j < candidates.length; j++) {
        cand = candidates[j];
        sec = Math.floor(((cand.ang + Math.PI) / (Math.PI * 2)) * n) % n;
        if (sec !== i) continue;
        sd = nearestShopDist(G, cand.x + 0.5, cand.y + 0.5);
        score = Math.min(sd, 8) * 0.7 + Math.abs(cand.d - desiredR) * 0.15;
        if (score < bd) {
          bd = score;
          best = { x: cand.x, y: cand.y, d: cand.d, ang: cand.ang, score: score };
        }
      }
      sectors[i] = best;
    }

    var picked = [];
    for (i = 0; i < sectors.length; i++) if (sectors[i]) picked.push(sectors[i]);

    if (picked.length < 4) {
      var used = {}, rest = [];
      for (i = 0; i < picked.length; i++) used[picked[i].x + "," + picked[i].y] = true;
      for (i = 0; i < candidates.length; i++) {
        cand = candidates[i];
        if (used[cand.x + "," + cand.y]) continue;
        sd = nearestShopDist(G, cand.x + 0.5, cand.y + 0.5);
        score = Math.min(sd, 8) * 0.7 + Math.abs(cand.d - desiredR) * 0.15;
        rest.push({ x: cand.x, y: cand.y, d: cand.d, ang: cand.ang, score: score });
      }
      rest.sort(function (a, b) { return a.score - b.score; });
      for (i = 0; i < rest.length && picked.length < 4; i++) picked.push(rest[i]);
    }

    picked.sort(function (a, b) { return a.ang - b.ang; });

    var wps = [];
    for (i = 0; i < picked.length; i++) wps.push({ x: picked[i].x + 0.5, y: picked[i].y + 0.5 });

    r.waypoints = wps;
    r.wpIndex = 0;
    r.autoFrom = { x: c.x, y: c.y };
    r.pauseUntil = 0;
  }

  function set(G, s, order, x, y) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    if (!r) return;
    var c;
    if (order === "guard" || order === "auto") {
      c = squadCenter(G, s);
      r.postX = (typeof x === "number") ? x : (c ? c.x : 0);
      r.postY = (typeof y === "number") ? y : (c ? c.y : 0);
    }
    if (order === "retreat") {
      if (typeof x === "number") { r.rallyX = x; r.rallyY = y; }
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
    if (order === "patrol") {
      if (!r.area && (!r.waypoints || r.waypoints.length < 2)) {
        r.areaAuto = true;
        r.areaTried = false;
        r.areaTargetX = null;
        r.areaTargetY = null;
        r.roamPauseUntil = 0;
      }
      if (r.waypoints.length < 2) r.autoRoute = true;
    }
  }

  function setOrder(G, s, name) {
    if (!ensure(G)) return;
    var c = squadCenter(G, s);
    if (c && (name === "guard" || name === "auto" || name === "retreat")) set(G, s, name, c.x, c.y);
    else set(G, s, name);
  }

  function get(G, s) {
    if (!ensure(G)) return null;
    var r = G.orders[s];
    return {
      order: r.order, postX: r.postX, postY: r.postY,
      targetX: r.targetX, targetY: r.targetY,
      waypoints: r.waypoints, responding: r.responding,
      area: r.area ? { x0: r.area.x0, y0: r.area.y0, x1: r.area.x1, y1: r.area.y1 } : null,
      areaAuto: r.areaAuto
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
    r.autoRoute = false;
    if (r.waypoints.length >= 6) return;
    r.waypoints.push({ x: x, y: y });
  }

  function clearWaypoints(G, s) {
    if (!ensure(G)) return;
    G.orders[s].waypoints = [];
    G.orders[s].wpIndex = 0;
    G.orders[s].autoRoute = false;
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
    var under, i, best, bd, d, aim, wp, target, a, ev;

    if (!r.area && (!r.waypoints || r.waypoints.length < 2)) {
      if (!r.areaTried) {
        r.areaTried = true;
        autoDivide(G);
      }
      if (!r.area) return;
    }

    if (r.area) {
      ev = areaTrouble(G, r.area);
      if (ev) {
        r.areaTargetX = null;
        r.areaTargetY = null;
        r.roamPauseUntil = 0;
        aim = ev.shop ? shopAim(G, ev.shop, cx, cy) : ev;
        moveTo(G, s, aim.x, aim.y, true);
        return;
      }

      if (G.time < r.roamPauseUntil) return;

      if (r.areaTargetX !== null) {
        d = dist(cx, cy, r.areaTargetX, r.areaTargetY);
        if (d < 1.0) {
          r.areaTargetX = null;
          r.areaTargetY = null;
          r.roamPauseUntil = G.time + 2 + Math.random() * 4;
          return;
        }
        if (d < r.roamBestDist - 0.5) {
          r.roamBestDist = d;
          r.roamProgressT = G.time;
        }
        if (G.time - r.roamProgressT > 12) {
          r.areaTargetX = null;
          r.areaTargetY = null;
          r.roamProgressT = G.time;
          return;
        }
        moveTo(G, s, r.areaTargetX, r.areaTargetY, false);
        return;
      }

      target = pickRoamTarget(G, r);
      if (target) {
        r.areaTargetX = target.x;
        r.areaTargetY = target.y;
        r.roamBestDist = dist(cx, cy, target.x, target.y);
        r.roamProgressT = G.time;
        r.roamLast.push({ x: target.x, y: target.y });
        if (r.roamLast.length > 3) r.roamLast.shift();
        moveTo(G, s, target.x, target.y, false);
      }
      return;
    }

    if (r.waypoints.length < 2) return;

    under = shopsUnderAttack(G);
    best = null; bd = 1e9;
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

    wp = r.waypoints[r.wpIndex % r.waypoints.length];
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
  function mapDims(G) {
    var map = G.map, w = 0, h = 0;
    if (map) {
      w = map.width || map.w || map.cols || 0;
      h = map.height || map.h || map.rows || 0;
      if ((!w || !h) && map.length) {
        h = map.length;
        if (map[0]) w = map[0].length || 0;
      }
    }
    return { w: w || 0, h: h || 0 };
  }

  function walkableBounds(G) {
    var d = mapDims(G), w = d.w, h = d.h, i, j;
    if (!w || !h) { w = 256; h = 256; }
    var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, found = false;
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) {
        if (!walkable(G, i, j)) continue;
        found = true;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
    if (!found) return null;
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function countWalkableIn(G, x0, y0, x1, y1) {
    var i, j, n = 0;
    for (j = y0; j <= y1; j++) for (i = x0; i <= x1; i++) if (walkable(G, i, j)) n++;
    return n;
  }

  function setArea(G, s, x0, y0, x1, y1) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    if (!r) return;
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    var t;
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    var d = mapDims(G);
    if (d.w > 0) {
      if (x0 < 0) x0 = 0;
      if (x1 >= d.w) x1 = d.w - 1;
    }
    if (d.h > 0) {
      if (y0 < 0) y0 = 0;
      if (y1 >= d.h) y1 = d.h - 1;
    }
    var add;
    if (x1 - x0 + 1 < 6) {
      add = 6 - (x1 - x0 + 1);
      x0 -= Math.floor(add / 2);
      x1 += Math.ceil(add / 2);
      if (d.w > 0) {
        if (x0 < 0) x0 = 0;
        if (x1 >= d.w) x1 = d.w - 1;
      }
    }
    if (y1 - y0 + 1 < 6) {
      add = 6 - (y1 - y0 + 1);
      y0 -= Math.floor(add / 2);
      y1 += Math.ceil(add / 2);
      if (d.h > 0) {
        if (y0 < 0) y0 = 0;
        if (y1 >= d.h) y1 = d.h - 1;
      }
    }
    r.area = { x0: x0, y0: y0, x1: x1, y1: y1 };
    r.areaAuto = false;
    r.areaTried = true;
    r.areaTargetX = null;
    r.areaTargetY = null;
    r.roamPauseUntil = 0;
    r.order = "patrol";
    r.responding = false;
    r.savedOrder = null;
  }

  function clearArea(G, s) {
    if (!ensure(G)) return;
    var r = G.orders[s];
    if (!r) return;
    r.area = null;
    r.areaAuto = false;
    r.areaTried = false;
    r.areaTargetX = null;
    r.areaTargetY = null;
    r.roamPauseUntil = 0;
  }

  function autoDivide(G) {
    if (!ensure(G)) return;
    var i, j, r, idx, squads = [], n = 0;
    for (i = 0; i < G.orders.length; i++) {
      r = G.orders[i];
      if (r.order === "patrol" && r.areaAuto !== false) squads.push(i);
    }
    n = squads.length;
    if (!n) return;

    var box = walkableBounds(G);
    if (!box) return;
    var W = box.x1 - box.x0 + 1, H = box.y1 - box.y0 + 1;
    var best = null, rows, cols, cw, ch, score;
    for (rows = 1; rows <= n; rows++) {
      cols = Math.ceil(n / rows);
      cw = W / cols;
      ch = H / rows;
      score = Math.abs(cw - ch);
      if (!best || score < best.score) best = { cols: cols, rows: rows, score: score };
    }
    cols = best.cols;
    rows = best.rows;

    var cells = [], x0, x1, y0, y1, cnt, gx, gy;
    for (gy = 0; gy < rows; gy++) {
      for (gx = 0; gx < cols; gx++) {
        x0 = box.x0 + Math.floor(gx * W / cols);
        x1 = box.x0 + Math.floor((gx + 1) * W / cols) - 1;
        y0 = box.y0 + Math.floor(gy * H / rows);
        y1 = box.y0 + Math.floor((gy + 1) * H / rows) - 1;
        if (x1 < x0 || y1 < y0) continue;
        cnt = countWalkableIn(G, x0, y0, x1, y1);
        if (cnt >= 40) cells.push({ x0: x0, y0: y0, x1: x1, y1: y1, count: cnt });
      }
    }
    if (!cells.length) cells.push({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, count: 0 });

    while (cells.length > n) {
      var bi = 0, bj = 1, bd = 1e9;
      for (i = 0; i < cells.length; i++) {
        for (j = i + 1; j < cells.length; j++) {
          var ax = (cells[i].x0 + cells[i].x1) / 2, ay = (cells[i].y0 + cells[i].y1) / 2;
          var bx = (cells[j].x0 + cells[j].x1) / 2, by = (cells[j].y0 + cells[j].y1) / 2;
          var dx = ax - bx, dy = ay - by, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; bi = i; bj = j; }
        }
      }
      var A = cells[bi], B = cells[bj];
      cells[bi] = {
        x0: Math.min(A.x0, B.x0), y0: Math.min(A.y0, B.y0),
        x1: Math.max(A.x1, B.x1), y1: Math.max(A.y1, B.y1),
        count: (A.count || 0) + (B.count || 0)
      };
      cells.splice(bj, 1);
    }

    var used = [];
    for (i = 0; i < squads.length; i++) {
      idx = squads[i];
      r = G.orders[idx];
      var c = squadCenter(G, idx);
      if (!c) continue;
      var bestCell = -1, bd2 = 1e9;
      for (j = 0; j < cells.length; j++) {
        if (used[j]) continue;
        var ccx = (cells[j].x0 + cells[j].x1 + 1) / 2;
        var ccy = (cells[j].y0 + cells[j].y1 + 1) / 2;
        var d2 = dist(c.x, c.y, ccx, ccy);
        if (d2 < bd2) { bd2 = d2; bestCell = j; }
      }
      if (bestCell >= 0) {
        used[bestCell] = true;
        r.area = {
          x0: cells[bestCell].x0, y0: cells[bestCell].y0,
          x1: cells[bestCell].x1, y1: cells[bestCell].y1
        };
        r.areaAuto = true;
        r.areaTried = true;
        r.areaTargetX = null;
        r.areaTargetY = null;
        r.roamPauseUntil = 0;
      }
    }
  }

  function inArea(area, x, y, m) {
    if (!area) return false;
    if (typeof m !== "number") m = 0;
    return x >= area.x0 - m && x <= area.x1 + 1 + m && y >= area.y0 - m && y <= area.y1 + 1 + m;
  }

  function areaTrouble(G, area) {
    var under = shopsUnderAttack(G), i, sh, a;
    for (i = 0; i < under.length; i++) {
      sh = under[i].shop;
      if (inArea(area, sh.x + 0.5, sh.y + 0.5, 4)) return { x: sh.x + 0.5, y: sh.y + 0.5, shop: sh };
    }
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a.active || !visibleViolent(G, a)) continue;
      if (inArea(area, a.x, a.y, 4)) return { x: a.x, y: a.y };
    }
    return null;
  }

  function pickRoamTarget(G, r) {
    var a = r.area;
    if (!a) return null;
    r.roamLast = r.roamLast || [];
    var shops = G.shops || [], shopInside = [], i, tries, tx, ty, sh, ok, j, last;
    for (i = 0; i < shops.length; i++) {
      sh = shops[i];
      if (sh.x >= a.x0 && sh.x <= a.x1 && sh.y >= a.y0 && sh.y <= a.y1) shopInside.push(sh);
    }

    for (tries = 0; tries < 30; tries++) {
      if (Math.random() < 0.5 && shopInside.length) {
        sh = shopInside[Math.floor(Math.random() * shopInside.length)];
        tx = sh.x + (Math.random() * 7 - 3);
        ty = sh.y + (Math.random() * 7 - 3);
      } else {
        tx = a.x0 + Math.random() * (a.x1 - a.x0 + 1);
        ty = a.y0 + Math.random() * (a.y1 - a.y0 + 1);
      }
      tx = Math.floor(tx);
      ty = Math.floor(ty);
      if (tx < a.x0 || tx > a.x1 || ty < a.y0 || ty > a.y1) continue;
      if (!walkable(G, tx, ty)) continue;
      ok = true;
      for (j = 0; j < r.roamLast.length; j++) {
        last = r.roamLast[j];
        if (dist(tx + 0.5, ty + 0.5, last.x, last.y) < 4) { ok = false; break; }
      }
      if (!ok) continue;
      return { x: tx + 0.5, y: ty + 0.5 };
    }

    for (tries = 0; tries < 30; tries++) {
      tx = Math.floor(a.x0 + Math.random() * (a.x1 - a.x0 + 1));
      ty = Math.floor(a.y0 + Math.random() * (a.y1 - a.y0 + 1));
      if (!walkable(G, tx, ty)) continue;
      return { x: tx + 0.5, y: ty + 0.5 };
    }
    return null;
  }

  function drawAreas(ctx, G, selected, planning) {
    if (!ensure(G)) return;
    var i, r, sig = "", need = false;
    for (i = 0; i < G.orders.length; i++) {
      r = G.orders[i];
      if (r.order === "patrol") sig += i + ",";
    }
    if (planning) {
      if (G._patrolSig !== sig) need = true;
      for (i = 0; i < G.orders.length; i++) {
        r = G.orders[i];
        if (r.order === "patrol" && r.areaAuto !== false && !r.area) need = true;
      }
      if (need && (typeof G._areaDivideT !== "number" || G.time - G._areaDivideT > 1)) {
        autoDivide(G);
        G._areaDivideT = G.time;
        G._patrolSig = sig;
      }
    }

    ctx.save();
    for (i = 0; i < G.orders.length; i++) {
      r = G.orders[i];
      if (r.order !== "patrol" || !r.area) continue;
      if (!planning && i !== selected) continue;
      var a = r.area;
      var p0 = Art.project(a.x0, a.y0, 0);
      var p1 = Art.project(a.x1 + 1, a.y1 + 1, 0);
      var x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      var w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
      if (planning) {
        ctx.globalAlpha = (i === selected) ? 0.18 : 0.08;
        ctx.fillStyle = RING.patrol;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = RING.patrol;
        ctx.lineWidth = (i === selected) ? 1.6 : 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.fillStyle = RING.patrol;
        ctx.font = "bold " + Math.max(10, Math.round(10 * Art.camera.S)) + "px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("S" + (i + 1) + " patrol", x + 4, y + 4);
      } else {
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = RING.patrol;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

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
    drawAreas(ctx, G, selected, planning);
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
      var bs = Math.max(7, 6 * S);
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

      // while planning, auto patrol previews follow the squad when it is moved
      if (planning && r.order === "patrol" && r.autoRoute) {
        if (!r.autoFrom || !r.waypoints || r.waypoints.length < 2 ||
            dist(c.x, c.y, r.autoFrom.x, r.autoFrom.y) > 2) {
          autoRoute(G, i);
        }
      }

      // patrol route (auto or manual)
      if (r.order === "patrol" && r.waypoints && r.waypoints.length) {
        var routeAlpha = (i === selected) ? 1 : 0.28;
        ctx.globalAlpha = routeAlpha;
        ctx.strokeStyle = RING.patrol;
        ctx.lineWidth = (i === selected) ? 1.4 : 1;
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
        ctx.fillStyle = RING.patrol;
        var dotR = Math.max(2.5, 2.5 * S);
        for (var k2 = 0; k2 < r.waypoints.length; k2++) {
          var wp = Art.project(r.waypoints[k2].x, r.waypoints[k2].y, 0);
          ctx.beginPath();
          ctx.arc(wp.x, wp.y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
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
    autoRoute: autoRoute, setOrder: setOrder,
    setArea: setArea, clearArea: clearArea, autoDivide: autoDivide,
    NAMES: NAMES, startPlay: startPlay
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ORDERS;
