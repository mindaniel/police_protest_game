/* lines.js - police lines & checkpoints for Police vs Protestors (ES5) */
var LINES = (function () {

  function init(G) {
    if (G._lines) releaseAll(G);
    G._lines = { bySquad: {} };
  }

  function ensure(G) {
    if (!G._lines) G._lines = { bySquad: {} };
    return G._lines;
  }

  function roleOf(G, s) {
    if (typeof Police !== "undefined" && Police.getLoadout) {
      var l = Police.getLoadout(G, s);
      if (l) return l;
    }
    return "";
  }

  function badRole(G, s) {
    var r = roleOf(G, s);
    if (r === "liaison" || r === "medic" || r === "ambulance" || r === "motorbike") return true;
    return false;
  }

  function squadOfficers(G, s) {
    var out = [], i, o, arr = G.officers || [];
    for (i = 0; i < arr.length; i++) {
      o = arr[i];
      if (o && o.squad === s) out.push(o);
    }
    return out;
  }

  function isWalk(G, tx, ty) {
    try { return Police.isWalkable(G, tx, ty); } catch (e) { return false; }
  }

  function runLen(G, x, y, dx, dy) {
    var n = 0, i, tx, ty;
    for (i = 1; i <= 8; i++) {
      tx = x + dx * i; ty = y + dy * i;
      if (!isWalk(G, tx, ty)) break;
      n++;
    }
    return n;
  }

  function collectRun(G, x, y, dx, dy, back, fwd) {
    var tiles = [], i, tx, ty;
    for (i = -back; i <= fwd; i++) {
      tx = x + dx * i; ty = y + dy * i;
      if (isWalk(G, tx, ty)) tiles.push({ x: tx, y: ty });
    }
    return tiles;
  }

  /* ---------- POLICE LINE ---------- */

  function formLine(G, s, x, y) {
    ensure(G);
    if (badRole(G, s)) return "role";
    if (!isWalk(G, x, y)) return "blocked";

    var hBack = runLen(G, x, y, -1, 0), hFwd = runLen(G, x, y, 1, 0);
    var vBack = runLen(G, x, y, 0, -1), vFwd = runLen(G, x, y, 0, 1);
    var hTotal = hBack + hFwd + 1, vTotal = vBack + vFwd + 1;

    var dx, dy, back, fwd, total, wide = false;
    if (hTotal <= vTotal) { dx = 1; dy = 0; back = hBack; fwd = hFwd; total = hTotal; }
    else { dx = 0; dy = 1; back = vBack; fwd = vFwd; total = vTotal; }

    if (total > 7) {
      wide = true;
      total = 7;
      var half = 3;
      back = Math.min(half, back); fwd = total - back - 1;
      if (fwd > 0 && fwd > (dx === 1 ? hFwd : vFwd)) { fwd = dx === 1 ? hFwd : vFwd; back = total - fwd - 1; }
      if (back < 0) { back = 0; }
    }

    var tiles = collectRun(G, x, y, dx, dy, back, fwd);
    if (!tiles.length) return "blocked";

    // clean any previous line for this squad
    release(G, s, true);

    var line = {
      kind: "line", squad: s, tiles: tiles, dx: dx, dy: dy,
      cx: x, cy: y, formed: false, awayT: 0, pushT: 0,
      keys: [], off: []
    };

    // spread officers evenly along tiles
    var offs = squadOfficers(G, s);
    var n = offs.length;
    if (n > 0) {
      var maxPer = 2, cap = tiles.length * maxPer;
      var k, t, spot, ox, oy;
      for (k = 0; k < n; k++) {
        var f = n === 1 ? 0.5 : k / (n - 1);
        var idx = Math.floor(f * (tiles.length - 1) + 0.0001);
        // second officer per tile offset
        var same = 0, m;
        for (m = 0; m < k; m++) {
          if (offs[m]._lineIdx === idx) same++;
        }
        t = tiles[idx];
        var along = same ? 0.22 : -0.22;
        var perp = 0; // along the line axis
        ox = t.x + (dx ? along : 0.5);
        oy = t.y + (dx ? 0.5 : along);
        // ensure tile centre-ish with slight offset across
        ox = t.x + 0.5 + (dx ? along * 0.9 : 0);
        oy = t.y + 0.5 + (dx ? 0 : along * 0.9);
        offs[k]._lineIdx = idx;
        offs[k].tx = ox; offs[k].ty = oy;
        offs[k].homeX = ox; offs[k].homeY = oy;
        line.off.push({ o: offs[k], x: ox, y: oy });
      }
      for (k = 0; k < n; k++) delete offs[k]._lineIdx;
    }

    try { Police.setStance(G, s, "firm"); } catch (e) {}

    // sealed tiles list (add once formed)
    line.tileKeys = [];
    for (var i = 0; i < tiles.length; i++) {
      line.tileKeys.push(tiles[i].x + "," + tiles[i].y);
    }

    G._lines.bySquad[s] = line;
    return wide ? "wide" : "ok";
  }

  function nearSpot(o, sp) {
    var dx = o.x - sp.x, dy = o.y - sp.y;
    return (dx * dx + dy * dy) <= (0.8 * 0.8);
  }

  function sealLine(G, line) {
    if (line.formed) return;
    line.formed = true;
    var i, k;
    if (!G.blocked) G.blocked = (typeof Set !== "undefined") ? new Set() : null;
    if (G.blocked && G.blocked.add) {
      for (i = 0; i < line.tileKeys.length; i++) {
        k = line.tileKeys[i];
        G.blocked.add(k);
        line.keys.push(k);
      }
    }
    try { Crowd.rebuildFlow(G); } catch (e) {}
    if (G.log) G.log("Squad " + (line.squad + 1) + " holds a police line");
  }

  function unsealLine(G, line) {
    if (G.blocked && G.blocked.delete) {
      for (var i = 0; i < line.keys.length; i++) G.blocked.delete(line.keys[i]);
    }
    line.keys = [];
  }

  function release(G, s, silent) {
    ensure(G);
    var line = G._lines.bySquad[s];
    if (!line) return;
    var wasFormed = line.formed && line.kind === "line";
    if (wasFormed) unsealLine(G, line);
    delete G._lines.bySquad[s];
    if (wasFormed) {
      try { Crowd.rebuildFlow(G); } catch (e) {}
      if (!silent && G.log) G.log("Squad " + (s + 1) + "'s line is released");
    }
  }

  function releaseAll(G) {
    if (!G._lines || !G._lines.bySquad) return;
    var s, key, byS = G._lines.bySquad;
    for (key in byS) {
      if (byS.hasOwnProperty(key)) {
        s = parseInt(key, 10);
        if (isNaN(s)) s = key;
        release(G, s, true);
      }
    }
  }

  function onManualMove(G, s) {
    ensure(G);
    var line = G._lines.bySquad[s];
    if (!line) return;
    if (line.kind === "line") release(G, s);
    else release(G, s);
  }

  function lineOf(G, s) {
    ensure(G);
    var line = G._lines.bySquad[s];
    if (!line || line.kind !== "line") return null;
    return { tiles: line.tiles, formed: line.formed };
  }

  function checkpointOf(G, s) {
    ensure(G);
    var cp = G._lines.bySquad[s];
    if (!cp || cp.kind !== "checkpoint") return null;
    return { x: cp.cx, y: cp.cy, searching: cp.searching, t: cp.t };
  }

  /* ---------- CHECKPOINT ---------- */

  function checkpoint(G, s, x, y) {
    ensure(G);
    if (badRole(G, s)) return "role";
    if (!isWalk(G, x, y)) return "blocked";

    release(G, s, true);

    var cp = {
      kind: "checkpoint", squad: s, cx: x, cy: y,
      searching: null, t: 0, seen: {}, off: []
    };

    var hW = runLen(G, x, y, 1, 0) > 0, vW = runLen(G, x, y, 0, 1) > 0;
    // two on each side of the street: pick perpendicular axis
    var dx = 1, dy = 0;
    if (hW && !vW) { dx = 0; dy = 1; }
    else if (vW && !hW) { dx = 1; dy = 0; }
    else { dx = 1; dy = 0; }

    var spots = [];
    var sideOffsets = [
      { x: -dx, y: -dy }, { x: -dx, y: -dy },
      { x: dx, y: dy }, { x: dx, y: dy }
    ];
    var along = [-0.28, 0.28, -0.28, 0.28];
    var i;
    for (i = 0; i < 4; i++) {
      var sx = x + 0.5 + sideOffsets[i].x * 0.62 + (dx ? along[i] : 0);
      var sy = y + 0.5 + sideOffsets[i].y * 0.62 + (dx ? 0 : along[i]);
      spots.push({ x: sx, y: sy });
    }

    var offs = squadOfficers(G, s);
    for (i = 0; i < offs.length && i < spots.length; i++) {
      offs[i].tx = spots[i].x; offs[i].ty = spots[i].y;
      offs[i].homeX = spots[i].x; offs[i].homeY = spots[i].y;
      cp.off.push({ o: offs[i], x: spots[i].x, y: spots[i].y });
    }
    // extras stand near centre
    for (; i < offs.length; i++) {
      offs[i].tx = x + 0.5; offs[i].ty = y + 0.5;
      offs[i].homeX = x + 0.5; offs[i].homeY = y + 0.5;
      cp.off.push({ o: offs[i], x: x + 0.5, y: y + 0.5 });
    }

    try { Police.setStance(G, s, "calm"); } catch (e) {}

    G._lines.bySquad[s] = cp;
    return "ok";
  }

  function updateCheckpoint(G, cp, dt) {
    var agents = G.agents || [], i, a, d2, r2 = 1.3 * 1.3, cand = null, best = 1e9;

    if (cp.searching) {
      var held = cp.searching;
      cp.t -= dt;
      if (cp.t <= 0) {
        finishSearch(G, cp, held);
      } else {
        // hold in place
        if (held.sx === undefined) { held.sx = held.x; held.sy = held.y; }
        held.x = held.sx; held.y = held.sy;
        if ("vx" in held) held.vx = 0;
        if ("vy" in held) held.vy = 0;
      }
      return;
    }

    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (!a || !a.active) continue;
      if (cp.seen[a.id] !== undefined) {
        if (G.time - cp.seen[a.id] < 60) continue;
        delete cp.seen[a.id];
      }
      var ddx = a.x - cp.cx - 0.5, ddy = a.y - cp.cy - 0.5;
      d2 = ddx * ddx + ddy * ddy;
      if (d2 <= r2 && d2 < best) { best = d2; cand = a; }
    }

    if (cand) {
      cp.searching = cand;
      cp.t = 3;
      cand.sx = cand.x; cand.sy = cand.y;
      cp.seen[cand.id] = G.time;
    }
  }

  function finishSearch(G, cp, a) {
    cp.searching = null;
    cp.t = 0;
    if (!G.stats) G.stats = {};
    if (a.hasTool) {
      a.revealedUntil = G.time + 20;
      if (G.stats.checkpointFinds === undefined) G.stats.checkpointFinds = 0;
      G.stats.checkpointFinds++;
      if (G.log) G.log("Checkpoint found a hidden tool on someone");
    } else {
      a.mood = (a.mood || 0) + 4;
      if (G.stats.checkpointSearches === undefined) G.stats.checkpointSearches = 0;
      G.stats.checkpointSearches++;
    }
  }

  /* ---------- UPDATE ---------- */

  function updateLine(G, line, dt) {
    var offs = line.off, near = 0, i, sp;
    for (i = 0; i < offs.length; i++) {
      sp = offs[i];
      if (nearSpot(sp.o, sp)) near++;
    }
    var n = offs.length || 1;
    if (!line.formed) {
      if (near >= Math.ceil(0.7 * n)) sealLine(G, line);
      return;
    }

    // tension
    var agents = G.agents || [], a, d2, r25 = 2.5 * 2.5, r15 = 1.5 * 1.5;
    var pushers = [], cx, cy, t, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (i = 0; i < line.tiles.length; i++) {
      t = line.tiles[i];
      if (t.x < minx) minx = t.x;
      if (t.x > maxx) maxx = t.x;
      if (t.y < miny) miny = t.y;
      if (t.y > maxy) maxy = t.y;
    }
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (!a || !a.active) continue;
      d2 = a.x - line.cx - 0.5;
      var e2 = a.y - line.cy - 0.5;
      d2 = d2 * d2 + e2 * e2;
      if (d2 <= r25) {
        a.mood = (a.mood || 0) + 1.5 * dt;
      }
      if (d2 <= r15) {
        var pusher = (a.state === "attackShop") || (a.role === "rioter" && a.hasTool);
        if (pusher) pushers.push(a);
      }
    }

    // push attempts every 3s
    line.pushT = (line.pushT || 0) + dt;
    if (line.pushT >= 3) {
      line.pushT -= 3;
      if (pushers.length && offs.length) {
        var tries = pushers.length, k, pp, chosen;
        for (k = 0; k < tries; k++) {
          if (Math.random() < 0.15) {
            pp = offs[Math.floor(Math.random() * offs.length)];
            chosen = pp.o;
            var ang = Math.random() * 6.2832;
            chosen.x += Math.cos(ang) * 0.6;
            chosen.y += Math.sin(ang) * 0.6;
            chosen.tx = chosen.x; chosen.ty = chosen.y;
          }
        }
      }
    }

    // break if too few near spots for 5s
    if (near < 0.5 * n) {
      line.awayT = (line.awayT || 0) + dt;
      if (line.awayT >= 5) release(G, line.squad);
    } else {
      line.awayT = 0;
    }
  }

  function update(G, dt) {
    ensure(G);
    var byS = G._lines.bySquad, key, thing, list = [];
    for (key in byS) {
      if (byS.hasOwnProperty(key)) list.push(byS[key]);
    }
    for (var i = 0; i < list.length; i++) {
      thing = list[i];
      if (!thing) continue;
      if (thing.kind === "line") updateLine(G, thing, dt);
      else if (thing.kind === "checkpoint") updateCheckpoint(G, thing, dt);
    }
  }

  /* ---------- DRAW ---------- */

  function proj(x, y, z) {
    if (typeof Art !== "undefined" && Art.project) return Art.project(x, y, z || 0);
    var S = (typeof Art !== "undefined" && Art.camera) ? Art.camera.S : 1;
    return { x: x * 32 * S, y: y * 32 * S };
  }

  function drawLine(ctx, G, line, S) {
    var i, t, a, b, tw = 0.5 * 32 * S, half = 0.25 * 32 * S;
    var dash = line.formed ? [] : [6 * S, 5 * S];
    ctx.save();
    ctx.setLineDash(dash);
    ctx.lineWidth = tw;
    ctx.strokeStyle = "rgba(40,90,200,0.35)";
    ctx.lineCap = "butt";
    for (i = 0; i < line.tiles.length; i++) {
      t = line.tiles[i];
      var p0 = proj(t.x, t.y, 0.02);
      var p1 = proj(t.x + 1, t.y + 1, 0.02);
      if (line.dx) {
        a = proj(t.x, t.y + 0.25, 0.02);
        b = proj(t.x + 1, t.y + 0.25, 0.02);
      } else {
        a = proj(t.x + 0.25, t.y, 0.02);
        b = proj(t.x + 0.25, t.y + 1, 0.02);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // chevrons toward larger crowd
    var agents = G.agents || [], left = 0, right = 0, k, ag;
    var mx = line.cx + 0.5, my = line.cy + 0.5;
    for (k = 0; k < agents.length; k++) {
      ag = agents[k];
      if (!ag || !ag.active) continue;
      var side = line.dx ? (ag.x - mx) : (ag.y - my);
      if (side < 0) left++; else right++;
    }
    var dir = right >= left ? 1 : -1;
    ctx.strokeStyle = "rgba(220,235,255,0.85)";
    ctx.lineWidth = Math.max(1, 2 * S);
    for (i = 0; i < line.tiles.length; i += 1) {
      t = line.tiles[i];
      var c = proj(t.x + 0.5, t.y + 0.5, 0.05);
      var nx = line.dx ? 0 : dir, ny = line.dx ? dir : 0;
      var s1 = proj(t.x + 0.5 - (line.dx ? 0 : 0.18), t.y + 0.5 - (line.dx ? 0.18 : 0), 0.05);
      var s2 = proj(t.x + 0.5 - (line.dx ? 0 : 0.18), t.y + 0.5 - (line.dx ? 0.18 : 0), 0.05);
      var tip = proj(t.x + 0.5 + nx * 0.28, t.y + 0.5 + ny * 0.28, 0.05);
      var la = proj(t.x + 0.5 + nx * 0.05 - (line.dx ? 0 : 0.16), t.y + 0.5 + ny * 0.05 - (line.dx ? 0.16 : 0), 0.05);
      var lb = proj(t.x + 0.5 + nx * 0.05 + (line.dx ? 0 : 0.16), t.y + 0.5 + ny * 0.05 + (line.dx ? 0.16 : 0), 0.05);
      ctx.beginPath();
      ctx.moveTo(la.x, la.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(lb.x, lb.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCheckpoint(ctx, G, cp, S) {
    ctx.save();
    var c = proj(cp.cx + 0.5, cp.cy + 0.5, 0.05);
    var R = 1.3 * 32 * S;
    ctx.setLineDash([5 * S, 4 * S]);
    ctx.strokeStyle = "rgba(255,216,102,0.8)";
    ctx.lineWidth = Math.max(1, 2 * S);
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, 6.2832);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255,216,102,0.95)";
    ctx.font = Math.max(9, 10 * S) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CHECK", c.x, c.y - R - 8 * S);

    if (cp.searching) {
      var a = cp.searching;
      var p = proj(a.x, a.y, 0.6);
      var pr = 0.42 * 32 * S;
      var frac = 1 - (cp.t / 3);
      if (frac < 0) frac = 0; if (frac > 1) frac = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(2, 3 * S);
      ctx.beginPath();
      ctx.arc(p.x, p.y, pr, 0, 6.2832);
      ctx.stroke();
      ctx.strokeStyle = "rgba(120,220,120,0.95)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, pr, -1.5708, -1.5708 + frac * 6.2832);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(ctx, G) {
    if (!G || !G._lines || !G._lines.bySquad) return;
    var S = (typeof Art !== "undefined" && Art.camera) ? Art.camera.S : 1;
    var byS = G._lines.bySquad, key, thing;
    ctx.save();
    for (key in byS) {
      if (!byS.hasOwnProperty(key)) continue;
      thing = byS[key];
      if (!thing) continue;
      if (thing.kind === "line") drawLine(ctx, G, thing, S);
      else if (thing.kind === "checkpoint") drawCheckpoint(ctx, G, thing, S);
    }
    ctx.restore();
  }

  return {
    formLine: formLine,
    checkpoint: checkpoint,
    release: release,
    onManualMove: onManualMove,
    update: update,
    draw: draw,
    lineOf: lineOf,
    checkpointOf: checkpointOf,
    init: init
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LINES;
