/* transport.js - officers ride in their squad vehicle */
var TRANSPORT = (function () {
  var SEATS = {
    car: { crew: 4, arrest: 2 },
    van: { crew: 6, arrest: 5 },
    truck: { crew: 8, arrest: 8 },
    watertruck: { crew: 4, arrest: 0 },
    barriertruck: { crew: 4, arrest: 0 },
    ambulance: { crew: 2, arrest: 0 }
  };

  function seats(type) {
    return SEATS[type] || { crew: 4, arrest: 0 };
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
    return o && !o.escorting && !o.snatch && typeof o.kettleX !== "number";
  }

  function removeOfficer(G, o) {
    var i;
    for (i = 0; i < G.officers.length; i++) {
      if (G.officers[i] === o) { G.officers.splice(i, 1); return true; }
    }
    return false;
  }

  function toggle(G, s) {
    ensure(G);
    var v = vehicleOf(G, s);
    if (!v) return "novehicle";
    var t = G._transport, st = t.runs[s];
    if (st && st.phase === "board") {
      // cancel: cancel boarding, dismount anyone already inside
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
    // start boarding
    var cap = seats(v.type).crew;
    if (!v.crew) v.crew = [];
    if (v.crew.length >= cap) return "dismount";
    st = t.runs[s] = { phase: "board", t: 0, cap: cap };
    v.ctrl = true;
    v.tx = v.x; v.ty = v.y;
    var offs = squadOfficers(G, s), i, o;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (eligible(o)) { o.tx = v.x; o.ty = v.y; o.homeX = v.x; o.homeY = v.y; }
    }
    return "boarding";
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
    var tiles = neighbourTiles(G, v);
    var counts = {}, placed, tx, ty, tkey, ang, bx, by;
    var pi = 0;
    for (i = 0; i < crew.length; i++) {
      o = crew[i];
      placed = false;
      var attempts = 0;
      while (attempts < tiles.length) {
        var tt = tiles[(pi + attempts) % tiles.length];
        tkey = tt.x + "," + tt.y;
        if ((counts[tkey] || 0) < 2) {
          counts[tkey] = (counts[tkey] || 0) + 1;
          var off = (counts[tkey] - 1) * 0.25;
          o.x = tt.wx + off; o.y = tt.wy + off;
          o.tx = tt.wx + off; o.ty = tt.wy + off;
          o.homeX = o.tx; o.homeY = o.ty;
          o.busy = false;
          placed = true;
          pi = (pi + attempts + 1) % tiles.length;
          break;
        }
        attempts++;
      }
      if (!placed) {
        o.x = v.x; o.y = v.y;
        o.tx = v.x; o.ty = v.y;
        o.homeX = v.x; o.homeY = v.y;
        o.busy = false;
      }
      if (G.officers) G.officers.push(o);
    }
    v.crew = [];
    if (v.run !== "station") v.ctrl = false;
    if (G.log && s !== null) G.log("Squad " + (s + 1) + " gets out");
  }

  // ordered list of walkable tile centres around vehicle
  function neighbourTiles(G, v) {
    var out = [], i, j, tx, ty;
    var cx = Math.round(v.x), cy = Math.round(v.y);
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
        tx = Math.round(v.x + d.x * j);
        ty = Math.round(v.y + d.y * j);
        if (seen[tx + "," + ty]) continue;
        seen[tx + "," + ty] = true;
        if (isWalk(G, tx, ty)) out.push({ x: tx, y: ty, wx: tx, wy: ty });
      }
    }
    // 8 neighbours fallback
    for (i = -1; i <= 1; i++) {
      for (j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        tx = cx + i; ty = cy + j;
        if (seen[tx + "," + ty]) continue;
        seen[tx + "," + ty] = true;
        if (isWalk(G, tx, ty)) out.push({ x: tx, y: ty, wx: tx, wy: ty });
      }
    }
    if (!out.length) out.push({ x: cx, y: cy, wx: cx, wy: cy });
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
      if (v.run === "station" || v.run === "unload") continue;
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
    // build squad lookup lazily only when needed
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v) continue;
      // crew positions + stamina
      if (v.crew && v.crew.length) {
        for (j = 0; j < v.crew.length; j++) {
          o = v.crew[j];
          o.x = v.x; o.y = v.y;
          o.tx = v.x; o.ty = v.y;
          if (typeof o.stamina === "number") {
            o.stamina = Math.min(100, o.stamina + 8 * dt);
          }
        }
      }
      s = findSquad(G, v.squad);
      st = s !== null ? t.runs[s] : null;

      // boarding
      if (st && st.phase === "board" && s !== null) {
        st.t += dt;
        cap = seats(v.type).crew;
        v.ctrl = true;
        v.tx = v.x; v.ty = v.y;
        offs = squadOfficers(G, s);
        found = false;
        for (j = 0; j < offs.length; j++) {
          o = offs[j];
          if (!eligible(o)) continue;
          found = true;
          o.tx = v.x; o.ty = v.y;
          var dx = o.x - v.x, dy = o.y - v.y;
          if (v.crew.length < cap && (dx * dx + dy * dy) <= 1.21) {
            removeOfficer(G, o);
            v.crew.push(o);
          }
        }
        if (v.crew.length >= cap || st.t >= 10 || !found) {
          // finish boarding
          var pend = st.pendingDrive;
          delete t.runs[s];
          if (pend) {
            v.ctrl = true; v.tx = pend.x; v.ty = pend.y;
            v.dest = { x: pend.x, y: pend.y };
          } else if (v.crew.length > 0) {
            v.ctrl = true;
            // stay put
            v.tx = v.x; v.ty = v.y;
          } else {
            v.ctrl = false;
          }
        }
        continue;
      }

      // station run phases
      if (v.run === "station") {
        var sdx = v.tx - v.x, sdy = v.ty - v.y;
        if (sdx * sdx + sdy * sdy <= 1.96) {
          v.run = "unload";
          v.unloadT = 3;
          v.ctrl = true;
          v.tx = v.x; v.ty = v.y;
        }
      } else if (v.run === "unload") {
        v.unloadT -= dt;
        if (v.unloadT <= 0) {
          onDelivered(G, v.load || 0);
          v.load = 0; v.reserved = 0;
          v.run = "back";
          var hp = s !== null ? homePoint(G, v, s) : { x: v.backX, y: v.backY };
          v.tx = hp.x; v.ty = hp.y;
          v.ctrl = true;
          if (G.log) G.log("Squad " + (v.squad + 1) + "'s vehicle is back");
        }
      } else if (v.run === "back") {
        var bdx = v.tx - v.x, bdy = v.ty - v.y;
        if (bdx * bdx + bdy * bdy <= 2.25) {
          v.run = null;
          if (hasCrew(v) && s !== null && autoDismount(G, s)) {
            dismount(G, v, s);
          } else if (!hasCrew(v)) {
            v.ctrl = false;
          }
        }
      } else if (hasCrew(v) && s !== null && v.dest) {
        // normal drive order, auto-dismount
        var ddx = v.dest.x - v.x, ddy = v.dest.y - v.y;
        if (ddx * ddx + ddy * ddy <= 1.44 && autoDismount(G, s)) {
          dismount(G, v, s);
          v.dest = null;
        }
      } else if (!v.run && !hasCrew(v) && seats(v.type).arrest > 0 && (v.load || 0) >= seats(v.type).arrest) {
        // full and idle (a drive order interrupted the run): go now
        startStation(G, v, v.squad);
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
    drive: drive,
    setAutoDismount: setAutoDismount,
    pickVehicle: pickVehicle,
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
