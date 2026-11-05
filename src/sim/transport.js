/* transport.js - officers ride in their squad vehicle */
var TRANSPORT = (function () {
  var SEATS = {};   /* from src/units/*.js */
  UNITTYPES.list().forEach(function (d) { if (d.vehicle) SEATS[d.id] = { crew: d.vehicle.crew, arrest: d.vehicle.arrest }; });

  function seats(type) {
    var k = String(type || "").toLowerCase();
    if (k === "riot truck" || k === "riot_truck" || k === "riot-truck") k = "truck";
    if (SEATS[k]) return SEATS[k];
    if (k.indexOf("truck") >= 0 && k.indexOf("water") < 0 && k.indexOf("barrier") < 0) return SEATS.truck;
    return { crew: 4, arrest: 0 };
  }

  function init(G) {
    G._transport = { runs: {}, nextId: 1 };
    var i, v;
    if (G.vehicles) {
      for (i = 0; i < G.vehicles.length; i++) {
        v = G.vehicles[i];
        v.crew = v.crew || [];
        v.load = v.load || 0;
        v.reserved = v.reserved || 0;
        v.ctrl = false;
        v.run = null;
        v.dest = null;
      }
    }
    return G._transport;
  }

  function ensure(G) {
    if (!G._transport) init(G);
    return G._transport;
  }

  function vehicleOf(G, s) {
    if (!G.vehicles || typeof s !== "number") return null;
    var i, v;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v) continue;
      if (v.squad === s) return v;
    }
    return null;
  }

  function hasCrew(v) {
    return !!(v && v.crew && v.crew.length > 0);
  }

  function isBoarding(G, s) {
    var t = ensure(G);
    var b = t.runs[s];
    return !!(b && b.phase === "board");
  }

  function isAboard(G, s) {
    var v = vehicleOf(G, s);
    if (!v) return false;
    if (isBoarding(G, s)) return false;
    return hasCrew(v);
  }

  function crewCount(G, s) {
    var v = vehicleOf(G, s);
    return v && v.crew ? v.crew.length : 0;
  }

  function squadOfficers(G, sid) {
    var out = [], i, o;
    if (!G.officers) return out;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o && o.squad === sid) out.push(o);
    }
    return out;
  }

  function eligible(o) {
    return o && !o.escorting && !o.snatch && typeof o.kettleX !== "number" && !o.entering;
  }

  function removeOfficer(G, o) {
    var i;
    for (i = 0; i < G.officers.length; i++) {
      if (G.officers[i] === o) { G.officers.splice(i, 1); return true; }
    }
    return false;
  }

  function doorPoint(G, v, idx) {
    var ang = v.ang || 0;
    var px = Math.cos(ang), py = Math.sin(ang);
    var side = (idx % 2 === 0) ? 1 : -1;
    var along = 0;
    if (v.type === "van" || v.type === "truck") along = -0.55;
    var d = 0.6;
    var cx = v.x + px * along;
    var cy = v.y + py * along;
    return { x: cx - py * d * side, y: cy + px * d * side };
  }

  function toggle(G, s) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v) return "novehicle";
    var t = G._transport, st = t.runs[s];
    if (st && st.phase === "board") {
      cancelBoarding(G, v, s);
      if (hasCrew(v)) dismount(G, v, s);
      delete t.runs[s];
      return "cancel";
    }
    if (hasCrew(v) && !(st && st.phase === "board")) {
      dismount(G, v, s);
      if (v.run === "back") { v.run = null; }
      return "dismount";
    }
    if (!v.crew) v.crew = [];
    if (v.crew.length >= seats(v.type).crew) return "dismount";
    startBoarding(G, v, s);
    return "boarding";
  }

  /* Officers on foot walk to the doors. The vehicle waits long enough for the
   * farthest one to arrive (walk time + margin, at most 45 s), so nobody is left behind. */
  function startBoarding(G, v, s) {
    var cap = seats(v.type).crew;
    var st = G._transport.runs[s] = { phase: "board", t: 0, cap: cap, boarded: 0, grace: 6 };
    v.parked = false;
    v.ctrl = true;
    v.tx = v.x; v.ty = v.y;
    var offs = squadOfficers(G, s), i, o, dp, n = 0, far = 0, dx, dy;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (eligible(o)) {
        dp = doorPoint(G, v, n++);
        o.tx = dp.x; o.ty = dp.y;
        o.homeX = v.x; o.homeY = v.y;
        dx = o.x - dp.x; dy = o.y - dp.y;
        far = Math.max(far, Math.sqrt(dx * dx + dy * dy));
      }
    }
    st.grace = Math.min(45, Math.max(6, far / (CONFIG.officerSpeed || 1.6) * 1.5 + 4));
  }

  /* Send squad s to (x, y) the sensible way: ride if it is aboard (boarding the rest first),
   * get in and drive when the trip is long and the vehicle is closer than half the trip.
   * Returns true when a ride was arranged; false means the squad should walk. */
  function travel(G, s, x, y) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v || seats(v.type).crew <= 0) return false;
    if (hasCrew(v)) { boardRest(G, s); return drive(G, s, x, y); }
    var offs = squadOfficers(G, s), i, n = 0, cx = 0, cy = 0;
    for (i = 0; i < offs.length; i++) if (!offs[i].escorting) { cx += offs[i].x; cy += offs[i].y; n++; }
    if (!n) return false;
    cx /= n; cy /= n;
    var trip = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    var near = Math.sqrt((v.x - cx) * (v.x - cx) + (v.y - cy) * (v.y - cy)) < Math.max(6, trip * 0.5);
    if (trip > (CONFIG.autoRideDistance || 12) && near && toggle(G, s) === "boarding") return drive(G, s, x, y);
    return false;
  }

  /* Before a ride order: if part of the squad is still on foot and seats are free,
   * board them first (the drive becomes pending). Returns true when boarding started. */
  function boardRest(G, s) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v || v.run || !hasCrew(v)) return false;
    var st = G._transport.runs[s];
    if (st && st.phase === "board") return true;
    var offs = squadOfficers(G, s), i, foot = 0;
    for (i = 0; i < offs.length; i++) if (eligible(offs[i])) foot++;
    if (!foot || v.crew.length >= seats(v.type).crew) return false;
    startBoarding(G, v, s);
    return true;
  }

  function cancelBoarding(G, v, s) {
    var t = G._transport, st = t.runs[s], offs, i, o;
    if (!st) return;
    offs = squadOfficers(G, s);
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      o.homeX = o.tx; o.homeY = o.ty;
    }
  }

  function drive(G, s, x, y) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v) return false;
    var st = G._transport.runs[s];
    if (st && st.phase === "board") {
      st.pendingDrive = { x: x, y: y };
      return true;
    }
    if (!hasCrew(v)) return false;
    v.ctrl = true;
    v.tx = x; v.ty = y;
    v.dest = { x: x, y: y };
    if (v.run === "unload") return true;
    if (v.run === "station") { v.run = null; }
    if (v.run === "back") { v.run = null; }
    return true;
  }

  /* Drive the vehicle alone (squad stays on foot); it parks there until the squad boards. */
  function driveEmpty(G, s, x, y) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v || hasCrew(v) || v.run) return false;
    v.ctrl = true;
    v.parked = true;
    v.tx = x; v.ty = y;
    v.dest = null;
    return true;
  }

  function setAutoDismount(G, s, b) {
    ensure(G);
    G._transport.runs[s] = G._transport.runs[s] || {};
    G._transport.runs[s].autoDismount = !!b;
  }

  function autoDismount(G, s) {
    ensure(G);
    var st = G._transport.runs[s];
    if (st && typeof st.autoDismount === "boolean") return st.autoDismount;
    return true;
  }

  // dismount crew onto walkable tiles around vehicle
  function dismount(G, v, s) {
    var crew = v.crew || [], i, o;
    var counts = {}, placed, tkey, pi = 0;
    var dest = v.dest || { x: v.x, y: v.y };
    for (i = 0; i < crew.length; i++) {
      o = crew[i];
      var dp = doorPoint(G, v, i);
      var ang = v.ang || 0;
      var px = Math.cos(ang), py = Math.sin(ang);
      var out = 0.8;
      var side = (i % 2 === 0) ? 1 : -1;
      o.x = dp.x - py * out * side;
      o.y = dp.y + px * out * side;
      var fx = Math.floor(o.x), fy = Math.floor(o.y);
      if (!Police.isWalkable(G, fx, fy)) {
        o.x = v.x; o.y = v.y;
        fx = Math.floor(o.x); fy = Math.floor(o.y);
        if (!Police.isWalkable(G, fx, fy)) {
          var found = false;
          for (var r = 1; r <= 4 && !found; r++) {
            for (var oy = -r; oy <= r && !found; oy++) {
              for (var ox = -r; ox <= r && !found; ox++) {
                var nx = Math.floor(v.x) + ox, ny = Math.floor(v.y) + oy;
                if (!!Police.isWalkable(G, nx, ny)) { o.x = nx + 0.5; o.y = ny + 0.5; found = true; }
              }
            }
          }
        }
      }
      o.tx = dest.x; o.ty = dest.y;
      o.homeX = dest.x; o.homeY = dest.y;
      o.drawAlpha = 0;
      o.drawScale = 0.4;
      o.busy = false;
      if (!G.officers) G.officers = [];
      G.officers.push(o);
    }
    v.crew = [];
    if (v.run !== "station") v.ctrl = false;
    if (G._policeFlow && s !== null) G._policeFlow[s] = null;
    if (G.log && s !== null) G.log("Squad " + (s + 1) + " gets out");
  }

  // ordered list of walkable tile centres around vehicle
  function neighbourTiles(G, v) {
    var out = [], i, j, tx, ty;
    var cx = Math.floor(v.x), cy = Math.floor(v.y);
    var ang = v.ang || 0;
    var dirs = [];
    // behind first (opposite ang), then sides, then front
    var back = { x: -Math.cos(ang), y: -Math.sin(ang) };
    var front = { x: Math.cos(ang), y: Math.sin(ang) };
    var left = { x: -Math.sin(ang), y: Math.cos(ang) };
    var right = { x: Math.sin(ang), y: -Math.cos(ang) };
    var order = [back, left, right, front];
    var seen = {};
    for (i = 0; i < order.length; i++) {
      var d = order[i];
      for (j = 1; j <= 2; j++) {
        tx = Math.floor(v.x + d.x * j);
        ty = Math.floor(v.y + d.y * j);
        if (seen[tx + "," + ty]) continue;
        seen[tx + "," + ty] = true;
        if (isWalk(G, tx, ty)) out.push({ x: tx, y: ty, wx: tx + 0.35, wy: ty + 0.35 });
      }
    }
    // 8 neighbours fallback
    for (i = -1; i <= 1; i++) {
      for (j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        tx = cx + i; ty = cy + j;
        if (seen[tx + "," + ty]) continue;
        seen[tx + "," + ty] = true;
        if (isWalk(G, tx, ty)) out.push({ x: tx, y: ty, wx: tx + 0.35, wy: ty + 0.35 });
      }
    }
    if (!out.length) out.push({ x: cx, y: cy, wx: v.x, wy: v.y });
    return out;
  }

  function isWalk(G, tx, ty) {
    if (typeof Police !== "undefined" && Police.isWalkable) {
      try { return Police.isWalkable(G, tx, ty); } catch (e) { return true; }
    }
    return true;
  }

  function pickVehicle(G, x, y) {
    ensure(G);
    if (!G.vehicles) return null;
    var best = null, bestD = 30 * 30, i, v, dx, dy, d, cap;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v) continue;
      cap = seats(v.type).arrest;
      if (cap <= 0) continue;
      if ((v.load || 0) + (v.reserved || 0) >= cap) continue;
      if (v.run === "station" || v.run === "unload" || v.run === "pickup") continue;
      dx = v.x - x; dy = v.y - y; d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = v; }
    }
    if (best) best.reserved = (best.reserved || 0) + 1;
    return best;
  }

  function onLoaded(G, v) {
    if (!v) return;
    v.reserved = Math.max(0, (v.reserved || 0) - 1);
    v.load = (v.load || 0) + 1;
    var cap = seats(v.type).arrest;
    if (v.load >= cap && cap > 0) startStation(G, v, null);
  }

  function release(G, v) {
    if (!v) return;
    v.reserved = Math.max(0, (v.reserved || 0) - 1);
  }

  /* A motorbike officer holds a suspect: send the nearest vehicle with a free seat. */
  function requestPickup(G, d) {
    ensure(G);
    var v = pickVehicle(G, d.x, d.y);
    if (!v) return null;
    v.run = "pickup";
    v.ctrl = true;
    v.pick = d;
    v.backX = v.x; v.backY = v.y;
    v.tx = d.x; v.ty = d.y;
    if (G.log) G.log("Squad " + (v.squad + 1) + "'s vehicle goes to pick up an arrested person");
    return v;
  }

  function stationTarget(G) {
    if (G.station && typeof G.station.x === "number") {
      return { x: G.station.x, y: G.station.y, station: true };
    }
    return null;
  }

  function onDelivered(G, n) {
    if (!G.stats) G.stats = {};
    G.stats.delivered = (G.stats.delivered || 0) + (n || 0);
  }

  function edgeTarget(G, v) {
    var w = MAP.width, h = MAP.height;
    var best = null, bestD = Infinity, i, t, cx, cy, d;
    // scan border
    for (i = 0; i < w; i++) {
      t = [ [i,0],[i,h-1] ];
      for (var k = 0; k < 2; k++) {
        cx = t[k][0]; cy = t[k][1];
        if (isWalk(G, cx, cy)) {
          d = (cx - v.x) * (cx - v.x) + (cy - v.y) * (cy - v.y);
          if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
        }
      }
    }
    for (i = 0; i < h; i++) {
      t = [ [0,i],[w-1,i] ];
      for (var k2 = 0; k2 < 2; k2++) {
        cx = t[k2][0]; cy = t[k2][1];
        if (isWalk(G, cx, cy)) {
          d = (cx - v.x) * (cx - v.x) + (cy - v.y) * (cy - v.y);
          if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
        }
      }
    }
    return best || { x: v.x, y: v.y };
  }

  function startStation(G, v, s) {
    var tgt = stationTarget(G);
    var station = !!tgt;
    if (!tgt) tgt = edgeTarget(G, v);
    v.run = "station";
    v.ctrl = true;
    v.backX = v.x; v.backY = v.y;
    v.tx = tgt.x; v.ty = tgt.y;
    v._station = station;
    if (s === null || s === undefined) s = v.squad;
    if (G.log) {
      var nm = v.type === "car" ? "sedan" : v.type;
      G.log("Squad " + (s + 1) + "'s " + nm + " takes " + (v.load || 0) + " arrested people to the station");
    }
    return true;
  }

  function sendToStation(G, s) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v) return false;
    if (!(v.load > 0)) return false;
    if (v.run === "station" || v.run === "unload") return false;
    startStation(G, v, s);
    return true;
  }

  function homePoint(G, v, s) {
    var offs = squadOfficers(G, s), i;
    for (i = 0; i < offs.length; i++) {
      if (typeof offs[i].homeX === "number") return { x: offs[i].homeX, y: offs[i].homeY };
    }
    return { x: v.backX || v.x, y: v.backY || v.y };
  }

  function update(G, dt) {
    ensure(G);
    if (!G.vehicles) return;
    var t = G._transport, i, v, s, st, offs, o, j, cap, found;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v) continue;
      if (v.crew && v.crew.length) {
        for (j = 0; j < v.crew.length; j++) {
          o = v.crew[j];
          o.x = v.x; o.y = v.y; o.tx = v.x; o.ty = v.y;
          if (typeof o.stamina === "number") o.stamina = Math.min(100, o.stamina + 8 * dt);
        }
      }
      if (v.run || v.dest || (v.crew && v.crew.length)) v.parked = false;
      s = findSquad(G, v.squad);
      st = s !== null ? t.runs[s] : null;
      if (st && st.phase === "board" && s !== null) {
        st.t += dt;
        cap = seats(v.type).crew;
        v.ctrl = true; v.parked = false;
        if (st.fetchTo) { v.tx = st.fetchTo.x; v.ty = st.fetchTo.y; }   /* driving over to stragglers */
        else { v.tx = v.x; v.ty = v.y; }
        offs = squadOfficers(G, s);
        found = false;
        var waiting = 0, n = 0;
        for (j = 0; j < offs.length; j++) {
          o = offs[j];
          if (o.entering) {
            o.entering -= dt;
            o.drawScale = 1 - 0.6 * (1 - Math.max(0, o.entering) / 0.5);
            o.drawAlpha = Math.max(0, o.entering) / 0.5;
            if (o.entering <= 0) {
              removeOfficer(G, o);
              v.crew.push(o);
              o.drawScale = 1; o.drawAlpha = 1; o.entering = 0;
            } else found = true;
            continue;
          }
          if (!eligible(o)) continue;
          waiting++;
          var dp = doorPoint(G, v, n++);
          o.tx = dp.x; o.ty = dp.y;
          var dx = o.x - dp.x, dy = o.y - dp.y;
          var vx = o.x - v.x, vy = o.y - v.y;
          /* close to the door, or touching the car (the door spot can be blocked by a wall or the body) */
          if (v.crew.length < cap && ((dx * dx + dy * dy) <= 0.64 || (vx * vx + vy * vy) <= 1.96)) {
            o.entering = 0.5;
            o.drawScale = 1; o.drawAlpha = 1;
            o.tx = v.x; o.ty = v.y;
            waiting--;
            found = true;
          }
        }
        if (waiting > 0 || found) found = true;
        var grace = st.grace || 6;
        var full = (v.crew.length >= cap);
        var anyEntering = false;
        for (j = 0; j < offs.length; j++) if (offs[j].entering) anyEntering = true;
        if (!anyEntering && !full && waiting > 0 && st.t >= grace) {
          /* time is up but officers are still out (often stuck behind a wall):
           * twice the vehicle drives over to them; after that they are seated anyway,
           * so nobody is ever left behind on the map */
          var outs = [], ox = 0, oy = 0;
          for (j = 0; j < offs.length; j++) if (eligible(offs[j])) { outs.push(offs[j]); ox += offs[j].x; oy += offs[j].y; }
          st.fetch = (st.fetch || 0) + 1;
          var rd = st.fetch <= 2 && Police.roadNear ? Police.roadNear(G, ox / outs.length, oy / outs.length, 8) : null;
          if (rd && ((rd.x + 0.5 - v.x) * (rd.x + 0.5 - v.x) + (rd.y + 0.5 - v.y) * (rd.y + 0.5 - v.y)) > 4) {
            st.fetchTo = { x: rd.x + 0.5, y: rd.y + 0.5 };
            st.t = 0; st.grace = 25;
            continue;
          }
          if (st.fetch > 2 || !rd) {
            for (j = 0; j < outs.length && v.crew.length < cap; j++) {
              removeOfficer(G, outs[j]);
              outs[j].x = v.x; outs[j].y = v.y;
              v.crew.push(outs[j]);
            }
            waiting = 0;
          } else { st.t = 0; st.grace = 10; continue; }
        }
        if (!anyEntering && (full || waiting === 0 || st.t >= grace)) {
          var pend = st.pendingDrive;
          delete t.runs[s];
          var dest = pend ? { x: pend.x, y: pend.y } : { x: v.x, y: v.y };
          var left = squadOfficers(G, s);
          for (j = 0; j < left.length; j++) {
            o = left[j];
            if (!eligible(o)) continue;
            o.tx = dest.x; o.ty = dest.y;
            o.homeX = dest.x; o.homeY = dest.y;
          }
          if (pend) {
            v.ctrl = true; v.tx = pend.x; v.ty = pend.y;
            v.dest = { x: pend.x, y: pend.y }; v.parked = false;
          } else if (v.crew.length > 0) {
            v.ctrl = true; v.tx = v.x; v.ty = v.y; v.parked = false;
          } else v.ctrl = false;
        }
        continue;
      }
      if (v.run === "pickup") {
        var pd = v.pick;
        if (!pd || G.detainees.indexOf(pd) < 0) {
          v.reserved = Math.max(0, (v.reserved || 0) - (pd && pd.car === v ? 0 : 1));
          v.pick = null; v.run = "back";
          var hb = homePoint(G, v, v.squad); v.tx = hb.x; v.ty = hb.y;
        } else {
          v.tx = pd.x; v.ty = pd.y;
          var pdx = pd.x - v.x, pdy = pd.y - v.y;
          if (pdx * pdx + pdy * pdy <= 2.6) {
            v.pick = null; v.run = null;
            pd.car = v; pd.pickup = false;
            if (typeof Police !== "undefined" && Police.finishEscort) Police.finishEscort(G, pd);
            if (!v.run) { v.run = "back"; var hb2 = homePoint(G, v, v.squad); v.tx = hb2.x; v.ty = hb2.y; }
          }
        }
        continue;
      }
      if (v.run === "station") {
        var sdx = v.tx - v.x, sdy = v.ty - v.y;
        if (sdx * sdx + sdy * sdy <= 1.96) {
          v.run = "unload"; v.unloadT = 3; v.ctrl = true; v.tx = v.x; v.ty = v.y;
        }
      } else if (v.run === "unload") {
        v.unloadT -= dt;
        if (v.unloadT <= 0) {
          onDelivered(G, v.load || 0);
          v.load = 0; v.reserved = 0; v.run = "back";
          var hp = s !== null ? homePoint(G, v, s) : { x: v.backX, y: v.backY };
          v.tx = hp.x; v.ty = hp.y; v.ctrl = true;
          if (G.log) G.log("Squad " + (v.squad + 1) + "'s vehicle is back");
        }
      } else if (v.run === "back") {
        var bdx = v.tx - v.x, bdy = v.ty - v.y;
        if (bdx * bdx + bdy * bdy <= 2.25) {
          v.run = null;
          if (hasCrew(v) && s !== null && autoDismount(G, s)) dismount(G, v, s);
          else if (!hasCrew(v)) v.ctrl = false;
        }
      } else if (hasCrew(v) && s !== null && v.dest) {
        v.ctrl = true; v.parked = false;
        var ddx = v.dest.x - v.x, ddy = v.dest.y - v.y;
        var mv = (v._tpX === undefined) ? 1 : Math.abs(v.x - v._tpX) + Math.abs(v.y - v._tpY) + Math.abs((v.ang || 0) - v._tpA);
        v._tpX = v.x; v._tpY = v.y; v._tpA = v.ang || 0;
        v._tpStill = mv < 0.02 * dt / 0.05 ? (v._tpStill || 0) + dt : 0;
        if (autoDismount(G, s) && (ddx * ddx + ddy * ddy <= 1.44 || v._tpStill >= 4)) {
          var dest2 = v.dest;
          if (v._tpStill >= 4) v._noBoardUntil = G.time + 15;
          dismount(G, v, s);
          v.dest = null; v._tpStill = 0;
          if (typeof Police !== "undefined") Police.moveSquad(G, s, dest2.x, dest2.y);
        }
      } else if (!v.run && !hasCrew(v) && seats(v.type).arrest > 0 && (v.load || 0) >= seats(v.type).arrest) {
        startStation(G, v, v.squad);
      }
    }
    if (G.officers) {
      for (i = 0; i < G.officers.length; i++) {
        o = G.officers[i];
        if (!o || o.entering) continue;
        if (o.drawAlpha !== undefined && o.drawAlpha < 1) o.drawAlpha = Math.min(1, o.drawAlpha + dt / 0.5);
        if (o.drawScale !== undefined && o.drawScale < 1) o.drawScale = Math.min(1, o.drawScale + 0.6 * dt / 0.5);
      }
    }
  }

  /* squads are plain indices; kept as a helper for readability */
  function findSquad(G, id) {
    return typeof id === "number" ? id : null;
  }

  function status(G, s) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v) return "on foot";
    var cap = seats(v.type).crew;
    var arrCap = seats(v.type).arrest;
    var extra = "";
    if (arrCap > 0) extra = " - arrests " + (v.load || 0) + "/" + arrCap;
    if (isBoarding(G, s)) {
      var st = G._transport.runs[s];
      var n = v.crew ? v.crew.length : 0;
      return "boarding " + n + "/" + cap + extra;
    }
    if (v.run === "station") return "to station " + (v.load || 0) + "/" + arrCap + extra;
    if (v.run === "unload") return "unloading" + extra;
    if (v.run === "back") return "returning" + extra;
    if (v.run === "pickup") return "picking up an arrest" + extra;
    if (hasCrew(v)) return "aboard " + v.crew.length + "/" + cap + extra;
    return "on foot" + extra;
  }

  function draw(ctx, G) {
    if (typeof Art === "undefined" || !Art.project) return;
    var S = (Art.camera && Art.camera.S) || 1;
    var i, v, sq, sz, gap, px, py, p, x0, k, cap, load, crewN;
    ctx.save();
    for (i = 0; i < (G.vehicles ? G.vehicles.length : 0); i++) {
      v = G.vehicles[i];
      if (!v) continue;
      cap = seats(v.type).arrest;
      if (cap > 0) {
        p = Art.project(v.x, v.y, 1.9);
        sz = Math.max(4, 4 * S);
        gap = 1.5;
        load = v.load || 0;
        var total = cap;
        var wAll = total * sz + (total - 1) * gap;
        x0 = p.x - wAll / 2;
        var yy = p.y - 14 * S;
        // pill background
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        var pad = 3;
        roundRect(ctx, x0 - pad, yy - pad, wAll + pad * 2, sz + pad * 2, 3);
        ctx.fill();
        for (k = 0; k < total; k++) {
          var sx = x0 + k * (sz + gap);
          if (k < load) {
            ctx.fillStyle = "#b3121f";
            ctx.fillRect(sx, yy, sz, sz);
          } else {
            ctx.strokeStyle = "#b3121f";
            ctx.lineWidth = Math.max(1, S);
            ctx.strokeRect(sx + 0.5, yy + 0.5, sz - 1, sz - 1);
          }
        }
        crewN = v.crew ? v.crew.length : 0;
        if (crewN > 0) {
          var fs = Math.max(9, 9 * S);
          ctx.font = "bold " + fs + "px sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          var txt = String(crewN);
          var tw = ctx.measureText(txt).width;
          var cx = x0 + wAll + 6;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.beginPath();
          roundRect(ctx, cx - 2, yy - 2, tw + 8, sz + 4, 3);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.fillText(txt, cx + 2, yy + sz / 2);
        }
      }
      // station dashed line
      if (v.run === "station" || v.run === "unload") {
        var tgt = stationTarget(G);
        if (tgt) {
          var pa = Art.project(v.x, v.y, 0.2);
          var pb = Art.project(tgt.x, tgt.y, 0.2);
          ctx.setLineDash([4 * S, 3 * S]);
          ctx.strokeStyle = "rgba(80,140,255,0.5)";
          ctx.lineWidth = Math.max(1, S);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
          ctx.setLineDash([]);
          var fs2 = Math.max(9, 9 * S);
          ctx.font = "bold " + fs2 + "px sans-serif";
          ctx.fillStyle = "rgba(80,140,255,0.85)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("STATION", pb.x, pb.y - 10 * S);
        }
      }
      // boarding ring
      if (isBoarding(G, findSquad(G, v.squad))) {
        var pc = Art.project(v.x, v.y, 0.2);
        ctx.strokeStyle = "rgba(255,216,102,0.8)";
        ctx.lineWidth = Math.max(1, 1.5 * S);
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, 1.1 * 32 * S, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  return {
    init: init,
    update: update,
    draw: draw,
    toggle: toggle,
    travel: travel,
    boardRest: boardRest,
    drive: drive,
    driveEmpty: driveEmpty,
    setAutoDismount: setAutoDismount,
    pickVehicle: pickVehicle,
    requestPickup: requestPickup,
    onLoaded: onLoaded,
    release: release,
    stationTarget: stationTarget,
    onDelivered: onDelivered,
    sendToStation: sendToStation,
    isAboard: isAboard,
    isBoarding: isBoarding,
    crewCount: crewCount,
    vehicleOf: vehicleOf,
    seats: seats,
    status: status
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = TRANSPORT;
