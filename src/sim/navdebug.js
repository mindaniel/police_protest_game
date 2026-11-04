var NAVDEBUG = (function () {
  var lines = [];
  var tr = {};
  var MAXT = 120, ARR = 1.5, STUCKD = 0.2, WIN = 3;

  function num(v) { return typeof v === "number" && isFinite(v); }
  function r2(n) { return (Math.round(n * 100) / 100).toFixed(2); }
  function lg(s) {
    lines.push(s);
    if (typeof console !== "undefined" && console.log) console.log("[nav] " + s);
  }
  function mw() { return (typeof MAP !== "undefined" && MAP && MAP.width) ? MAP.width : 0; }
  function mh() { return (typeof MAP !== "undefined" && MAP && MAP.height) ? MAP.height : 0; }
  function solidT(x, y) {
    if (x < 0 || y < 0 || x >= mw() || y >= mh()) return true;
    if (typeof MAP === "undefined" || !MAP || !MAP.rows || typeof MAP.rows[y] !== "string") return false;
    var ch = MAP.rows[y].charAt(x);
    return ch === "#" || ch === "S" || ch === "W";
  }
  function barT(G, x, y) {
    if (!G || !G.barricadeTiles || typeof G.barricadeTiles.has !== "function") return false;
    try {
      var w = mw();
      return !!G.barricadeTiles.has(x + "," + y) || !!G.barricadeTiles.has(y * w + x);
    } catch (e) { return false; }
  }
  function walkT(G, x, y) { return !solidT(x, y) && !barT(G, x, y); }
  function has2x2(G, x, y) {
    if (!walkT(G, x, y)) return false;
    return (walkT(G, x + 1, y) && walkT(G, x, y + 1) && walkT(G, x + 1, y + 1)) ||
      (walkT(G, x - 1, y) && walkT(G, x, y + 1) && walkT(G, x - 1, y + 1)) ||
      (walkT(G, x + 1, y) && walkT(G, x, y - 1) && walkT(G, x + 1, y - 1)) ||
      (walkT(G, x - 1, y) && walkT(G, x, y - 1) && walkT(G, x - 1, y - 1));
  }
  function dist(a, b, c, d) { var x = c - a, y = d - b; return Math.sqrt(x * x + y * y); }
  function deg(r) { return r * 180 / Math.PI; }
  function wrapDeg(a) { a = a % 360; if (a > 180) a -= 360; else if (a < -180) a += 360; return a; }

  function offsOf(G, s) {
    var a = [];
    if (!G || !G.officers) return a;
    for (var i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      if (o && o.squad === s) a.push({ id: "o" + i, o: o });
    }
    return a;
  }
  function vehOf(G, s) {
    var T = (typeof TRANSPORT !== "undefined") ? TRANSPORT : null;
    if (!T || typeof T.vehicleOf !== "function") return null;
    try { return T.vehicleOf(G, s) || null; } catch (e) { return null; }
  }
  function crewN(G, s) {
    var T = (typeof TRANSPORT !== "undefined") ? TRANSPORT : null;
    if (!T || typeof T.crewCount !== "function") return -1;
    try { return T.crewCount(G, s); } catch (e) { return -1; }
  }
  function isBoarding(G, s) {
    var T = (typeof TRANSPORT !== "undefined") ? TRANSPORT : null;
    if (!T || typeof T.isBoarding !== "function") return false;
    try { return !!T.isBoarding(G, s); } catch (e) { return false; }
  }
  function crowdN(G, x, y, r) {
    var C = (typeof Crowd !== "undefined") ? Crowd : null;
    if (!C || typeof C.neighbors !== "function") return 0;
    var nb;
    try { nb = C.neighbors(G, x, y, r); } catch (e) { return 0; }
    if (!nb || !nb.length) return 0;
    var n = 0;
    for (var i = 0; i < nb.length; i++) if (nb[i] && nb[i].active !== false) n++;
    return n;
  }
  function otherVeh(G, o) {
    var arr = G && G.vehicles;
    if (!arr || !arr.length) return false;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!v || v === o || !num(v.x) || !num(v.y)) continue;
      if (dist(v.x, v.y, o.x, o.y) < 2.2) return true;
    }
    return false;
  }
  function ffVal(G, s, o) {
    var w = mw();
    if (!w || !num(o.x) || !num(o.y)) return "?";
    var arr = null;
    try { if (G._policeFlow && G._policeFlow[s] && G._policeFlow[s].dist) arr = G._policeFlow[s].dist; } catch (e) { arr = null; }
    if (!arr || typeof arr.length !== "number") return "?";
    var i = Math.floor(o.y) * w + Math.floor(o.x);
    if (i < 0 || i >= arr.length) return "?";
    return String(arr[i]);
  }

  function goTo(G, s, x, y) {
    if (!G) { lg("goto: no game state"); return; }
    var P = (typeof Police !== "undefined") ? Police : null;
    if (P && typeof P.moveSquad === "function") {
      try { P.moveSquad(G, s, x, y, true); } catch (e) { lg("goto: moveSquad threw " + e); }
    } else lg("goto: Police.moveSquad unavailable");
    var list = offsOf(G, s), v = vehOf(G, s), i, cx = 0, cy = 0, n = 0;
    for (i = 0; i < list.length; i++) {
      var o = list[i].o;
      if (num(o.x) && num(o.y)) { cx += o.x; cy += o.y; n++; }
    }
    if (!n && v && num(v.x) && num(v.y)) { cx = v.x; cy = v.y; n = 1; }
    if (n) { cx /= n; cy /= n; }
    lg("ORDER squad " + s + " -> tile(" + x + "," + y + ") start=(" + r2(cx) + "," + r2(cy) + ")" +
      " officers=" + list.length + " veh=" + (v ? (v.type || "?") : "none") + " crew=" + crewN(G, s) +
      " goalWalk=" + (walkT(G, x, y) ? "yes" : "no") + " goalDrive=" + (has2x2(G, x, y) ? "yes" : "no") +
      " dist=" + r2(dist(cx, cy, x + 0.5, y + 0.5)));
    tr[s] = { squad: s, gx: x, gy: y, t: 0, units: {}, spots: [] };
  }

  function unitsOf(G, t) {
    var out = [], i, list = offsOf(G, t.squad);
    for (i = 0; i < list.length; i++) out.push({ id: list[i].id, kind: "officer", obj: list[i].o });
    var v = vehOf(G, t.squad);
    if (v) out.push({ id: "veh", kind: "vehicle", obj: v });
    return out;
  }

  function sample(h, tt) {
    for (var i = h.length - 1; i >= 0; i--) if (h[i].t <= tt) return h[i];
    return h.length ? h[0] : null;
  }
  function headingFrom(st) {
    var h = st.hist;
    if (h.length < 2) return num(st.ang) ? st.ang : 0;
    var a = h[h.length - 2], b = h[h.length - 1];
    var dx = b.x - a.x, dy = b.y - a.y;
    if (dx * dx + dy * dy < 1e-8) return num(st.ang) ? st.ang : 0;
    return Math.atan2(dy, dx);
  }

  function stateOf(G, t, u, o) {
    if (u.kind === "vehicle") {
      if (isBoarding(G, t.squad)) return "boarding";
      if (o._drReverse) return "reversing";
      if (o._drArrived) return "parked";
      return "driving";
    }
    if (o.escorting) return "escorting";
    if (o.arrestTarget || o.arrestManual) return "arresting";
    if (o.busy) return "busy";
    if (o.hidden || o.inVehicle || o.riding) return "in-vehicle";
    return "walking";
  }

  function aheadStr(G, u, o, hd) {
    var out = [];
    var a = num(hd) ? hd : 0;
    var tx = Math.floor(o.x + Math.cos(a) * 1.1), ty = Math.floor(o.y + Math.sin(a) * 1.1);
    if (solidT(tx, ty)) out.push("solid");
    if (barT(G, tx, ty)) out.push("barrier");
    var cn = crowdN(G, o.x, o.y, 1.5);
    if (cn > 0) out.push("crowd" + cn);
    if (otherVeh(G, o)) out.push("vehicle");
    if (u.kind === "vehicle" && !has2x2(G, tx, ty)) out.push("narrow");
    return out.length ? out.join("+") : "clear";
  }

  function reason(G, t, u, o, hd) {
    if (u.kind === "vehicle" && isBoarding(G, t.squad)) return "waiting for boarding";
    var f = ffVal(G, t.squad, o);
    if (f === "?" || f === "-1") return "no path / unreachable field value";
    var a = num(hd) ? hd : 0;
    var tx = Math.floor(o.x + Math.cos(a) * 0.9), ty = Math.floor(o.y + Math.sin(a) * 0.9);
    if (solidT(tx, ty)) return "wall ahead";
    if (crowdN(G, o.x, o.y, 1.0) >= 2) return "crowd ahead";
    if (u.kind === "vehicle" && (!has2x2(G, tx, ty) || !has2x2(G, Math.floor(o.x), Math.floor(o.y))))
      return "vehicle on a street narrower than allowed";
    if (barT(G, tx, ty)) return "barrier ahead";
    return "other";
  }

  function logUnit(G, t, u, st, o, hd) {
    var hdg = deg(hd);
    var turn = "start";
    if (typeof st.prevDeg === "number") {
      var dd = wrapDeg(hdg - st.prevDeg);
      if (Math.abs(dd) < 1.5) turn = "straight";
      else turn = (dd > 0 ? "RIGHT " : "LEFT ") + r2(Math.abs(dd)) + "deg";
    }
    st.prevDeg = hdg;
    lg("t=" + r2(t.t) + " s" + t.squad + " " + u.id + " pos=(" + r2(o.x) + "," + r2(o.y) + ")" +
      " hd=" + r2(hdg) + " " + turn + " dist=" + r2(dist(o.x, o.y, t.gx + 0.5, t.gy + 0.5)) +
      " moved=" + r2(st.acc) + " state=" + stateOf(G, t, u, o) +
      " ahead=" + aheadStr(G, u, o, hd) + " ff=" + ffVal(G, t.squad, o));
  }

  function checkStuck(G, t, u, st, o, hd) {
    if (t.t < WIN) return;
    var past = sample(st.hist, t.t - WIN);
    var d = past ? dist(past.x, past.y, o.x, o.y) : 0;
    if (d >= STUCKD) { st.stuck = false; return; }
    if (st.stuck) return;
    st.stuck = true;
    lg("STUCK t=" + r2(t.t) + " s" + t.squad + " " + u.id + " pos=(" + r2(o.x) + "," + r2(o.y) + ")" +
      " moved=" + r2(d) + " in " + WIN + "s reason=" + reason(G, t, u, o, hd));
    if (!t.spots) t.spots = [];
    t.spots.push({ x: o.x, y: o.y, t: t.t });
  }

  function unitTick(G, t, u, dt) {
    var o = u.obj;
    if (!o || !num(o.x) || !num(o.y)) return;
    var st = t.units[u.id];
    if (!st) {
      st = t.units[u.id] = { x: o.x, y: o.y, ang: num(o.ang) ? o.ang : null, hist: [], acc: 0, accT: 0, stuck: false };
      return;
    }
    st.acc += dist(st.x, st.y, o.x, o.y);
    st.accT += dt;
    st.hist.push({ t: t.t, x: o.x, y: o.y });
    while (st.hist.length > 1 && st.hist[0].t < t.t - 31) st.hist.shift();
    var hd = num(o.ang) ? o.ang : headingFrom(st);
    if (st.accT >= 1) {
      logUnit(G, t, u, st, o, hd);
      st.acc = 0;
      st.accT = 0;
    }
    checkStuck(G, t, u, st, o, hd);
    st.x = o.x; st.y = o.y; st.ang = hd;
  }

  function arrived(G, t) {
    var us = unitsOf(G, t), best = 1e9, i;
    for (i = 0; i < us.length; i++) {
      var o = us[i].obj;
      if (!o || !num(o.x) || !num(o.y)) continue;
      var d = dist(o.x, o.y, t.gx + 0.5, t.gy + 0.5);
      if (d < best) best = d;
    }
    return best <= ARR;
  }

  function update(G, dt) {
    if (!(dt > 0) || !G) return;
    var keys = [], k, i;
    for (k in tr) if (tr.hasOwnProperty(k)) keys.push(k);
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      var t = tr[k];
      if (!t) continue;
      t.t += dt;
      var us = unitsOf(G, t);
      for (var j = 0; j < us.length; j++) unitTick(G, t, us[j], dt);
      if (arrived(G, t)) {
        lg("ARRIVED squad " + t.squad + " t=" + r2(t.t) + " took " + r2(t.t) + "s");
        delete tr[k];
      } else if (t.t >= MAXT) {
        lg("TIMEOUT squad " + t.squad + " t=" + r2(t.t) + " (120s) trace stopped");
        delete tr[k];
      }
    }
  }

  function cross(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = "#0ff"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.restore();
  }
  function trail(ctx, A, hist, t) {
    if (!hist || hist.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,255,0.5)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    var first = true;
    for (var i = 0; i < hist.length; i++) {
      if (hist[i].t < t - 30) continue;
      var p = null;
      try { p = A.project(hist[i].x, hist[i].y, 0); } catch (e) { p = null; }
      if (!p) continue;
      if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  function ring(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = "#f33"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function draw(ctx, G) {
    if (!ctx) return;
    var A = (typeof Art !== "undefined") ? Art : null;
    if (!A || typeof A.project !== "function") return;
    for (var k in tr) {
      if (!tr.hasOwnProperty(k)) continue;
      var t = tr[k];
      if (!t) continue;
      var g = null;
      try { g = A.project(t.gx + 0.5, t.gy + 0.5, 0); } catch (e) { g = null; }
      if (g) cross(ctx, g.x, g.y);
      var us = unitsOf(G, t), i;
      for (i = 0; i < us.length; i++) {
        var st = t.units[us[i].id];
        if (st) trail(ctx, A, st.hist, t.t);
      }
      if (t.spots) for (i = 0; i < t.spots.length; i++) {
        var p = null;
        try { p = A.project(t.spots[i].x, t.spots[i].y, 0); } catch (e2) { p = null; }
        if (p) ring(ctx, p.x, p.y);
      }
    }
  }

  function dump() { return lines.join("\n"); }
  function clear() { lines.length = 0; }

  return { goto: goTo, update: update, draw: draw, dump: dump, clear: clear, log: lines };
})();
if (typeof module !== "undefined" && module.exports) module.exports = NAVDEBUG;
