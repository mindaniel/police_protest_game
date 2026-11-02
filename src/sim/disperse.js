var DISPERSE = (function () {
  var R = 8; // order radius in tiles
  var ANNOUNCE = 15; // announcement seconds
  var DURATION = 45; // total order seconds
  var EXIT_RADIUS = 1; // tiles from exit to remove agent

  function init(G) {
    G._disperse = {
      exit: null, // {x, y, side}
      order: null // {s, x, y, t, elapsed, announceLeft, path, cx, cy, ex, ey}
    };
  }

  function ensure(G) {
    if (!G._disperse) init(G);
    if (!G.stats) G.stats = {};
    if (typeof G.stats.dispersed !== "number") G.stats.dispersed = 0;
    return G._disperse;
  }

  function walkable(G, x, y) {
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
    var c = MAP.rows[y].charAt(x);
    return c === "." || c === "a" || c === "P" || c === "G";
  }

  function setExit(G, ex, ey) {
    ensure(G);
    var best = null, bestD = Infinity;
    var W = MAP.width, H = MAP.height;
    var edge = [];
    var x, y;
    for (x = 0; x < W; x++) { edge.push([x, 0]); edge.push([x, H - 1]); }
    for (y = 0; y < H; y++) { edge.push([0, y]); edge.push([W - 1, y]); }
    for (var i = 0; i < edge.length; i++) {
      x = edge[i][0]; y = edge[i][1];
      if (!walkable(G, x, y)) continue;
      var dx = x - ex, dy = y - ey;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { x: x, y: y }; }
    }
    if (!best) return "noexit";
    var side;
    if (best.x === 0) side = "west";
    else if (best.x === W - 1) side = "east";
    else if (best.y === 0) side = "north";
    else side = "south";
    G._disperse.exit = { x: best.x, y: best.y, side: side };
    return "ok";
  }

  function exitOf(G) {
    if (!G._disperse || !G._disperse.exit) return null;
    var e = G._disperse.exit;
    return { x: e.x, y: e.y, side: e.side };
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  function hasSpeaker(G, s) {
    var vs = G.vehicles || [];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (v.squad !== s) continue;
      if (v.type === "car" || v.type === "van" || v.type === "truck") return true;
    }
    return false;
  }

  function vehiclePos(G, s) {
    var vs = G.vehicles || [];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (v.squad !== s) continue;
      if (v.type === "car" || v.type === "van" || v.type === "truck") return { x: v.x, y: v.y };
    }
    return null;
  }

  // Build descent path from area centre to exit once.
  function buildPath(G, field, cx, cy, ex, ey) {
    var path = [];
    var W = MAP.width, H = MAP.height;
    var tx = Math.round(ex), ty = Math.round(ey);
    var x = Math.round(cx), y = Math.round(cy);
    var steps = 0;
    while (steps < 60) {
      path.push({ x: x, y: y });
      if (x === tx && y === ty) break;
      var bestV = Infinity, bx = -1, by = -1;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          var nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var v = field[ny * W + nx];
          if (v < bestV) { bestV = v; bx = nx; by = ny; }
        }
      }
      if (bx < 0 || !isFinite(bestV)) break;
      x = bx; y = by;
      steps++;
    }
    return path;
  }

  function order(G, s, x, y) {
    var st = ensure(G);
    if (st.order) return "busy";
    if (!hasSpeaker(G, s)) return "nocar";
    var ex = st.exit;
    if (!ex) return "noexit";
    var vp = vehiclePos(G, s);
    if (!vp) return "nocar";
    var field = Crowd.fieldTo(G, ex.x, ex.y);
    var path = buildPath(G, field, vp.x, vp.y, ex.x, ex.y);
    st.order = {
      s: s,
      x: vp.x, y: vp.y,
      t: DURATION,
      elapsed: 0,
      announceLeft: ANNOUNCE,
      cx: vp.x, cy: vp.y,
      path: path,
      field: field,
      acc: 0
    };
    G.log("Squad " + s + " orders the crowd to disperse via the " + ex.side + " exit");
    return "ok";
  }

  function active(G) {
    if (!G._disperse || !G._disperse.order) return null;
    var o = G._disperse.order;
    var phase = o.announceLeft > 0 ? "announce" : "enforce";
    return { s: o.s, x: o.x, y: o.y, r: R, t: o.t, phase: phase };
  }

  function inArea(ax, ay, cx, cy, r) {
    return dist2(ax, ay, cx, cy) <= r * r;
  }

  function update(G, dt) {
    var st = ensure(G);
    var o = st.order;

    // Exit removal always happens for _leaving agents.
    var ex = st.exit;
    var agents = G.agents || [];
    var i, a;
    if (ex) {
      for (i = 0; i < agents.length; i++) {
        a = agents[i];
        if (!a.active || !a._leaving) continue;
        if (Math.abs(a.x - ex.x) <= EXIT_RADIUS && Math.abs(a.y - ex.y) <= EXIT_RADIUS) {
          Crowd.removeAgent(G, a);
        }
      }
    }

    if (!o) return;

    o.t -= dt;
    if (o.t <= 0) { st.order = null; return; }

    var wasAnnounce = o.announceLeft > 0;
    if (wasAnnounce) {
      o.announceLeft -= dt;
      var field = o.field;
      var cx = o.cx, cy = o.cy;
      for (i = 0; i < agents.length; i++) {
        a = agents[i];
        if (!a.active || a._leaving || a.role !== "peaceful") continue;
        if (!inArea(a.x, a.y, cx, cy, R)) continue;
        var mood = a.mood;
        var p = 0;
        if (mood < 55) p = 0.25 * dt;
        else if (mood <= 75) p = 0.08 * dt;
        else p = 0;
        if (p > 0 && Math.random() < p) {
          Crowd.sendAway(G, a, field);
          G.stats.dispersed = (G.stats.dispersed || 0) + 1;
        }
      }
    }

    // Enforcement phase (and any remaining announcement time)
    var exArea = inArea.bind ? null : null;
    var cx2 = o.cx, cy2 = o.cy;
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (!a.active || a._leaving) continue;
      if (!inArea(a.x, a.y, cx2, cy2, R)) continue;
      var defy = (a.role === "rioter") || (a.mood > 75);
      if (defy && o.announceLeft <= 0) a.defiant = true;
      if (o.announceLeft <= 0 && a.role === "rioter") {
        var violent = (a.state === "attackShop") || (a.violentUntil && a.violentUntil > G.time);
        if (violent) {
          var want = G.time + 20;
          if (!(a.revealedUntil >= want)) a.revealedUntil = want;
        }
      }
    }
  }

  function sideArrow(ctx, px, py, side, size) {
    ctx.beginPath();
    var h = size * 0.5;
    if (side === "east") {
      ctx.moveTo(px - h, py - h); ctx.lineTo(px + h, py); ctx.lineTo(px - h, py + h);
    } else if (side === "west") {
      ctx.moveTo(px + h, py - h); ctx.lineTo(px - h, py); ctx.lineTo(px + h, py + h);
    } else if (side === "north") {
      ctx.moveTo(px - h, py + h); ctx.lineTo(px, py - h); ctx.lineTo(px + h, py + h);
    } else {
      ctx.moveTo(px - h, py - h); ctx.lineTo(px, py + h); ctx.lineTo(px + h, py - h);
    }
    ctx.closePath();
  }

  function draw(ctx, G) {
    if (!G._disperse) return;
    var st = G._disperse;
    var S = Art.camera.S;
    var tilePx = 32 * S;

    ctx.save();

    // Exit marker
    if (st.exit) {
      var ep = Art.project(st.exit.x + 0.5, st.exit.y + 0.5, 0);
      var ax = ep.x, ay = ep.y;
      var ox = 0, oy = 0;
      if (st.exit.side === "east") ox = 0.7; else if (st.exit.side === "west") ox = -0.7;
      else if (st.exit.side === "north") oy = -0.7; else oy = 0.7;
      var ap = Art.project(st.exit.x + 0.5 + ox, st.exit.y + 0.5 + oy, 0);
      ctx.save();
      ctx.strokeStyle = "rgba(30,180,80,0.95)";
      ctx.fillStyle = "rgba(30,180,80,0.9)";
      ctx.lineWidth = Math.max(2, 2 * S);
      sideArrow(ctx, ap.x, ap.y, st.exit.side, 16 * S);
      ctx.fill();
      ctx.stroke();
      ctx.font = "bold " + Math.round(13 * S) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var lx = ep.x + (st.exit.side === "east" ? -20 * S : st.exit.side === "west" ? 20 * S : 0);
      var ly = ep.y + (st.exit.side === "north" ? 20 * S : st.exit.side === "south" ? -20 * S : 0);
      ctx.lineWidth = Math.max(3, 3 * S);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText("EXIT", lx, ly);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("EXIT", lx, ly);
      ctx.restore();
    }

    var o = st.order;
    if (o) {
      var cp = Art.project(o.cx + 0.5, o.cy + 0.5, 0);
      var radPx = R * tilePx;

      // Faint dotted path hint
      if (o.path && o.path.length > 1) {
        ctx.save();
        ctx.strokeStyle = "rgba(30,200,90,0.35)";
        ctx.fillStyle = "rgba(30,200,90,0.5)";
        ctx.lineWidth = Math.max(1, 1.5 * S);
        for (var pi = 3; pi < o.path.length; pi += 3) {
          var pp = Art.project(o.path[pi].x + 0.5, o.path[pi].y + 0.5, 0);
          var qp = Art.project(o.path[pi - 1].x + 0.5, o.path[pi - 1].y + 0.5, 0);
          var ang = Math.atan2(pp.y - qp.y, pp.x - qp.x);
          var sz = 4 * S;
          ctx.save();
          ctx.translate(pp.x, pp.y);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(sz, 0);
          ctx.lineTo(-sz * 0.6, -sz * 0.6);
          ctx.lineTo(-sz * 0.6, sz * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }

      // Dashed area circle
      ctx.save();
      ctx.setLineDash([6 * S, 6 * S]);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1, 1.5 * S);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, radPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Announcement rings
      if (o.announceLeft > 0) {
        var pulses = 3;
        var period = 1.5;
        for (var k = 0; k < pulses; k++) {
          var ph = ((o.elapsed + k * (period / pulses)) % period) / period;
          var rr = radPx * (0.35 + 0.75 * ph);
          var alpha = 0.45 * (1 - ph);
          ctx.strokeStyle = "rgba(255,190,60," + alpha.toFixed(3) + ")";
          ctx.lineWidth = Math.max(2, 2.5 * S);
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Remaining seconds label
      ctx.save();
      ctx.font = "bold " + Math.round(14 * S) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = Math.max(3, 3 * S);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      var secs = Math.max(0, Math.ceil(o.t));
      var label = secs + "s";
      var tx = cp.x, ty = cp.y - radPx - 6 * S;
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = o.announceLeft > 0 ? "#ffcc44" : "#ffffff";
      ctx.fillText(label, tx, ty);
      ctx.restore();

      o.elapsed += 1 / 60;
      if (o.elapsed > 1000) o.elapsed = 0;
    }

    ctx.restore();
    if (ctx.setLineDash) ctx.setLineDash([]);
  }

  return {
    init: init,
    setExit: setExit,
    exitOf: exitOf,
    order: order,
    active: active,
    update: update,
    draw: draw
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = DISPERSE;
