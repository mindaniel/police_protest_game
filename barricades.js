var BAR = (function () {
  var items = [];
  var searchTimer = 0;
  var builtCount = 0;
  var lastG = null;
  var seedCounter = 1;

  function C(key, dflt) {
    if (typeof CONFIG !== "undefined" && CONFIG[key] != null) return CONFIG[key];
    return dflt;
  }

  function init(G) {
    items = [];
    searchTimer = 0;
    builtCount = 0;
    seedCounter = 1;
    lastG = G;
    G.barricadeTiles = new Set();
    G._policeFlow = null;
  }

  function ensure(G) {
    if (G !== lastG) init(G);
  }

  // Tile lookup helper
  function tileAt(G, tx, ty) {
    if (typeof MAP === "undefined") return "#";
    if (tx < 0 || ty < 0 || ty >= MAP.height || tx >= MAP.width) return "#";
    var row = MAP.rows[ty];
    if (!row) return "#";
    return row.charAt(tx);
  }

  function isWall(ch) {
    return ch === "#" || ch === "S";
  }

  function isWalkable(ch) {
    return ch === "." || ch === "a" || ch === "P" || ch === "G";
  }

  function isStreetTile(ch) {
    return ch === "." || ch === "a";
  }

  // Walkable run length through (tx,ty) along one axis.
  function runLength(G, tx, ty, dx, dy) {
    var n = 0;
    var x = tx, y = ty;
    while (true) {
      x += dx; y += dy;
      var ch = tileAt(G, x, y);
      if (isWall(ch) || !isWalkable(ch)) break;
      n++;
      if (n > 30) break;
    }
    x = tx; y = ty;
    while (true) {
      x -= dx; y -= dy;
      var ch2 = tileAt(G, x, y);
      if (isWall(ch2) || !isWalkable(ch2)) break;
      n++;
      if (n > 30) break;
    }
    return n + 1;
  }

  function isNarrow(G, tx, ty) {
    var horiz = runLength(G, tx, ty, 1, 0);
    var vert = runLength(G, tx, ty, 0, 1);
    return horiz <= 3 || vert <= 3;
  }

  function nearBarricade(tx, ty, r) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var dx = it.tx - tx, dy = it.ty - ty;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  function nearOfficer(G, tx, ty, r) {
    var offs = G.officers || [];
    for (var i = 0; i < offs.length; i++) {
      var o = offs[i];
      var dx = o.x - (tx + 0.5);
      var dy = o.y - (ty + 0.5);
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  function canBuild(G, a) {
    var tx = Math.floor(a.x);
    var ty = Math.floor(a.y);
    var ch = tileAt(G, tx, ty);
    if (!isStreetTile(ch)) return false;
    if (!isNarrow(G, tx, ty)) return false;
    if (nearBarricade(tx, ty, 7)) return false;
    if (nearOfficer(G, tx, ty, 3)) return false;
    var key = tx + "," + ty;
    if (G.blocked && G.blocked.has(key)) return false;
    return true;
  }

  function tryBuild(G) {
    if (builtCount >= C("maxBarricades", 5)) return;
    var agents = G.agents || [];
    var moodMin = C("barricadeMood", 72);
    var checked = 0;
    // Deterministic-ish scan order: start from G.time offset for variety
    var start = Math.floor((G.time || 0) * 7) % (agents.length || 1);
    for (var k = 0; k < agents.length && checked < 40; k++) {
      var idx = (start + k) % agents.length;
      var a = agents[idx];
      if (!a || !a.active) continue;
      if (a.mood < moodMin) continue;
      checked++;
      var tx = Math.floor(a.x);
      var ty = Math.floor(a.y);
      var ch = tileAt(G, tx, ty);
      if (!isStreetTile(ch)) continue;
      if (!isNarrow(G, tx, ty)) continue;
      if (nearBarricade(tx, ty, 7)) continue;
      if (nearOfficer(G, tx, ty, 3)) continue;
      var key = tx + "," + ty;
      if (G.blocked && G.blocked.has(key)) continue;
      var near = (typeof Crowd !== "undefined" && Crowd.neighbors) ? Crowd.neighbors(G, a.x, a.y, 3) : [];
      var cnt = 0;
      for (var j = 0; j < near.length; j++) {
        var n = near[j];
        if (n !== a && n.active && n.mood >= 60) cnt++;
      }
      if (cnt < 4) continue;
      // Build it!
      var item = {
        tx: tx, ty: ty,
        x: tx + 0.5, y: ty + 0.5,
        progress: 0, done: false, clear: 0,
        seed: seedCounter++,
        lastWork: G.time || 0
      };
      items.push(item);
      builtCount++;
      if (G.log) G.log("Protesters are building a barricade");
      return;
    }
  }

  function recomputeBlocked(G) {
    G.barricadeTiles = new Set();
    for (var i = 0; i < items.length; i++) {
      if (items[i].done) G.barricadeTiles.add(items[i].tx + "," + items[i].ty);
    }
    G._policeFlow = null;
  }

  function update(G, dt) {
    ensure(G);
    if (dt > 0.05) dt = 0.05;
    var now = G.time || 0;
    var agents = G.agents || [];
    var moodMin = C("barricadeMood", 72);

    // Candidate search every 0.5s
    searchTimer += dt;
    if (searchTimer >= 0.5) {
      searchTimer = 0;
      tryBuild(G);
    }

    var changed = false;
    var maxB = C("maxBarricades", 5);
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];

      if (!it.done) {
        // Count workers
        var workers = 0;
        var near = (typeof Crowd !== "undefined" && Crowd.neighbors) ? Crowd.neighbors(G, it.x, it.y, 2) : [];
        for (var w = 0; w < near.length; w++) {
          var ag = near[w];
          if (ag.active && ag.mood >= 55) workers++;
        }
        if (workers >= 3) {
          it.progress += dt / 8;
          it.lastWork = now;
          if (it.progress >= 1) {
            it.progress = 1;
            it.done = true;
            changed = true;
            if (G.log) G.log("Barricade up - police and vehicles cannot pass");
            if (G.stats) G.stats.barricadesBuilt = (G.stats.barricadesBuilt || 0) + 1;
          }
        } else {
          // abandonment check
          if (now - it.lastWork > 20) {
            items.splice(i, 1);
            changed = true;
            continue;
          }
        }
      }

      // Clearing (both finished and in-progress)
      var squads = {};
      var offs = G.officers || [];
      for (var oi = 0; oi < offs.length; oi++) {
        var o = offs[oi];
        var dx = o.x - it.x, dy = o.y - it.y;
        if (dx * dx + dy * dy <= 1.3 * 1.3) {
          var s = o.squad != null ? o.squad : 0;
          squads[s] = (squads[s] || 0) + 1;
        }
      }
      // How many protesters hold it?
      var holders = 0;
      var pn = (typeof Crowd !== "undefined" && Crowd.neighbors) ? Crowd.neighbors(G, it.x, it.y, 2) : [];
      for (var h = 0; h < pn.length; h++) {
        var pa = pn[h];
        if (pa.active && pa.role !== "police") holders++;
      }
      if (holders <= 6) {
        var bestSquad = -1, bestCount = 0;
        for (var sk in squads) {
          if (squads[sk] > bestCount) { bestCount = squads[sk]; bestSquad = parseInt(sk, 10); }
        }
        if (bestSquad >= 0 && bestCount >= 2) {
          var clearTime = C("barricadeClearSeconds", 7);
          var rate = dt / clearTime;
          if (typeof Police !== "undefined" && Police.getLoadout) {
            if (Police.getLoadout(G, bestSquad) === "barriertruck") rate *= 2;
          }
          it.clear += rate;
          it._clearSquad = bestSquad;
          if (it.clear >= 1) {
            items.splice(i, 1);
            changed = true;
            if (G.log) G.log("Barricade cleared by squad " + (bestSquad + 1));
            if (!G.stats) G.stats = {};
            G.stats.barricadesCleared = (G.stats.barricadesCleared || 0) + 1;
            continue;
          }
        }
      }
    }

    if (changed) recomputeBlocked(G);

    // Mood bonus near finished barricades
    for (var bi = 0; bi < items.length; bi++) {
      var bit = items[bi];
      if (!bit.done) continue;
      var bn = (typeof Crowd !== "undefined" && Crowd.neighbors) ? Crowd.neighbors(G, bit.x, bit.y, 4) : [];
      for (var bj = 0; bj < bn.length; bj++) {
        var ba = bn[bj];
        if (!ba.active) continue;
        ba.mood = Math.min(100, (ba.mood || 0) + 0.5 * dt);
      }
    }
  }

  function isBlocked(G, tx, ty) {
    ensure(G);
    if (!G.barricadeTiles) return false;
    return G.barricadeTiles.has(tx + "," + ty);
  }

  // --- Drawing ---
  function rng(seed) {
    var s = seed * 9301 + 49297;
    s = s % 233280;
    return (s < 0 ? -s : s) / 233280;
  }

  function drawItem(ctx, kind, r, cx, cy, S) {
    var w = 32 * S;
    if (kind === 0) {
      // tyre
      var rx = (6 + r * 4) * S;
      var ry = (3 + r * 2) * S;
      ctx.save();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2) : ctx.arc(cx, cy, rx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 0.6 * S;
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(cx, cy, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2) : ctx.arc(cx, cy, rx * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (kind === 1) {
      // pallet
      var pw = (10 + r * 4) * S;
      var ph = (5 + r * 2) * S;
      ctx.save();
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
      ctx.fillStyle = "#a06a33";
      var slats = 3;
      for (var s = 0; s < slats; s++) {
        ctx.fillRect(cx - pw / 2, cy - ph / 2 + (s * ph / slats), pw, ph / slats * 0.6);
      }
      ctx.restore();
    } else if (kind === 2) {
      // green bin on side
      var bw = (11 + r * 3) * S;
      var bh = (6 + r * 2) * S;
      ctx.save();
      ctx.fillStyle = "#3d7a3d";
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.fillStyle = "#2c5a2c";
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw * 0.15, bh);
      ctx.fillStyle = "#4f914f";
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh * 0.25);
      ctx.restore();
    } else {
      // plank at angle
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((r - 0.5) * 0.9);
      ctx.fillStyle = "#b07a3c";
      ctx.fillRect(-7 * S, -1.5 * S, 14 * S, 3 * S);
      ctx.restore();
    }
  }

  function draw(ctx, G) {
    ensure(G);
    if (typeof Art === "undefined" || !Art.project) return;
    var S = Art.camera && Art.camera.S ? Art.camera.S : 1;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var p = Art.project(it.x, it.y, 0);
      var cx = p.x, cy = p.y;
      var seed = it.seed || 1;
      var count = 6 + Math.floor(rng(seed) * 4); // 6..9
      var shown = it.done ? count : Math.ceil(it.progress * count);
      var kinds = [];
      for (var k = 0; k < count; k++) {
        kinds.push(Math.floor(rng(seed * 13 + k * 7) * 4));
      }
      // draw items
      for (var k2 = 0; k2 < shown; k2++) {
        var r = rng(seed * 31 + k2 * 17);
        var ox = (r - 0.5) * 20 * S;
        var oy = (rng(seed * 41 + k2 * 11) - 0.5) * 12 * S;
        drawItem(ctx, kinds[k2], r, cx + ox, cy + oy, S);
      }
      // finished striped plank on top
      if (it.done) {
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.fillRect(cx - 9 * S, cy - 9 * S, 18 * S, 3 * S);
        ctx.fillStyle = "#d32";
        var segs = 4;
        for (var sp = 0; sp < segs; sp += 2) {
          ctx.fillRect(cx - 9 * S + (sp * 18 * S / segs), cy - 9 * S, 18 * S / segs, 3 * S);
        }
        ctx.restore();
      }
      // progress arcs
      if (!it.done && it.progress > 0) {
        ctx.save();
        ctx.strokeStyle = "#e8a020";
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.arc(cx, cy - 12 * S, 5 * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * it.progress);
        ctx.stroke();
        ctx.restore();
      }
      if (it.clear > 0) {
        ctx.save();
        ctx.strokeStyle = "#2f6fd6";
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.arc(cx, cy - 12 * S, 7 * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, it.clear));
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  return {
    init: init,
    update: update,
    draw: draw,
    isBlocked: isBlocked,
    list: function () { return items; }
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = BAR;
