// reinforce.js - Police station + reinforcements for "Police vs Protestors"
var REINFORCE = (function () {
  var OPTIONS = [
    { name: "Foot squad", loadout: "none", cost: 2, label: "4 officers", kind: "foot" },
    { name: "Riot van", loadout: "van", cost: 3, label: "6 officers + van", kind: "van" },
    { name: "Arrest truck", loadout: "truck", cost: 4, label: "8 officers + truck", kind: "truck" },
    { name: "Mounted unit", loadout: "mounted", cost: 3, label: "4 horses", kind: "mounted" }
  ];
  var menu = false;
  var chosen = 0; // 0 = none

  // Small deterministic hash for tie-breaking
  function hash3(x, y, seed) {
    var h = (x * 73856093) ^ (y * 19349663) ^ (Math.floor(seed) * 83492791);
    h = h ^ (h >>> 13);
    h = (h * 1274126177) | 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function walkableTile(cfg, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= cfg.width || ty >= cfg.height) return false;
    var ch = cfg.rows[ty].charAt(tx);
    return ch === '.' || ch === 'a' || ch === 'P' || ch === 'G';
  }

  function solidHashAt(cfg, x, y) {
    if (x < 0 || y < 0 || x >= cfg.width || y >= cfg.height) return false;
    return cfg.rows[y].charAt(x) === '#';
  }

  function nearSpawn(x, y) {
    var zones = (typeof CONFIG !== "undefined" && CONFIG.spawnZones) ? CONFIG.spawnZones : [];
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (x >= z.x - 8 && x <= z.x + z.w + 8 && y >= z.y - 8 && y <= z.y + z.h + 8) return true;
    }
    return false;
  }

  function nearestEdgeRoadDist(cfg, x, y) {
    // Chebyshev-ish distance to nearest border walkable tile (BFS-lite: search border)
    var best = 9999;
    var bx, by;
    for (bx = 0; bx < cfg.width; bx++) {
      if (walkableTile(cfg, bx, 0)) {
        var d1 = Math.max(Math.abs(bx - x), Math.abs(0 - y));
        if (d1 < best) best = d1;
      }
      if (walkableTile(cfg, bx, cfg.height - 1)) {
        var d2 = Math.max(Math.abs(bx - x), Math.abs(cfg.height - 1 - y));
        if (d2 < best) best = d2;
      }
    }
    for (by = 0; by < cfg.height; by++) {
      if (walkableTile(cfg, 0, by)) {
        var d3 = Math.max(Math.abs(0 - x), Math.abs(by - y));
        if (d3 < best) best = d3;
      }
      if (walkableTile(cfg, cfg.width - 1, by)) {
        var d4 = Math.max(Math.abs(cfg.width - 1 - x), Math.abs(by - y));
        if (d4 < best) best = d4;
      }
    }
    return best;
  }

  function tryPlace(cfg, w, h, doorCol) {
    var center = cfg.plazaCenter || { x: cfg.width / 2, y: cfg.height / 2 };
    var best = null;
    var bestScore = -1e9;
    for (var y = 0; y + h <= cfg.height; y++) {
      for (var x = 0; x + w <= cfg.width; x++) {
        var ok = true;
        for (var yy = 0; yy < h && ok; yy++) {
          for (var xx = 0; xx < w && ok; xx++) {
            if (cfg.rows[y + yy].charAt(x + xx) !== '#') ok = false;
          }
        }
        if (!ok) continue;
        var doorX = x + doorCol;
        var doorY = y + h;
        if (!walkableTile(cfg, doorX, doorY)) continue;
        if (nearSpawn(x + w / 2, y + h / 2)) continue;
        var cx = x + w / 2, cy = y + h / 2;
        var dist = Math.sqrt((cx - center.x) * (cx - center.x) + (cy - center.y) * (cy - center.y));
        var score = 0;
        if (dist >= 22 && dist <= 40) score += 100;
        else score -= Math.abs(dist - 31) * 0.5;
        var edge = nearestEdgeRoadDist(cfg, cx, cy);
        if (edge <= 10) score += 50;
        else score -= edge;
        var hsh = hash3(x, y, cfg.seed || 0);
        score += (hsh % 1000) / 1000;
        if (score > bestScore) {
          bestScore = score;
          best = { x: x, y: y, w: w, h: h, doorX: doorX, doorY: doorY };
        }
      }
    }
    return best;
  }

  function placeStation() {
    var cfg = MAP;
    var r = tryPlace(cfg, 3, 2, 1);
    if (!r) r = tryPlace(cfg, 2, 2, 0);
    MAP.station = r || null;
  }

  function stateOf(G) {
    if (!G._reinforce) {
      G._reinforce = {
        points: 4,
        pending: [], // {opts, destX, destY, entryX, entryY, tLeft, name}
        calls: 0,
        timer: 0
      };
    }
    return G._reinforce;
  }

  function init(G) {
    G.station = (MAP.station) ? { x: MAP.station.doorX + 0.5, y: MAP.station.doorY + 0.5 } : null;
    G._reinforce = null;
    stateOf(G);
    menu = false;
    chosen = 0;
  }

  function points(G) {
    return stateOf(G).points;
  }

  function toggleMenu() { menu = !menu; if (!menu) chosen = 0; }
  function menuOpen() { return menu; }
  function pending() { return chosen > 0 ? OPTIONS[chosen - 1] : null; }
  function cancel() { chosen = 0; menu = false; }

  function choose(n) {
    if (n < 1 || n > 4) return "blocked";
    var G = (typeof window !== "undefined" && window.G) ? window.G : null;
    // We need points/max check via last state; do it lazily if G available
    chosen = n;
    menu = true;
    return "pick";
  }

  function inSpawnZone(x, y) {
    var zones = CONFIG.spawnZones || [];
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return true;
    }
    return false;
  }

  function findEntry(cfg, destX, destY) {
    var best = null, bestD = 1e9, bestInZone = null, bestInD = 1e9;
    function consider(tx, ty) {
      if (!walkableTile(cfg, tx, ty)) return;
      var d = Math.abs(tx - destX) + Math.abs(ty - destY);
      var zone = inSpawnZone(tx, ty);
      if (!zone && d < bestD) { bestD = d; best = { x: tx, y: ty }; }
      if (d < bestInD) { bestInD = d; bestInZone = { x: tx, y: ty }; }
    }
    var i;
    for (i = 0; i < cfg.width; i++) { consider(i, 0); consider(i, cfg.height - 1); }
    for (i = 0; i < cfg.height; i++) { consider(0, i); consider(cfg.width - 1, i); }
    var e = best || bestInZone;
    if (!e) return null;
    // nudge 1 tile inward
    var nx = e.x, ny = e.y;
    if (e.x === 0) nx = 1; else if (e.x === cfg.width - 1) nx = cfg.width - 2;
    if (e.y === 0) ny = 1; else if (e.y === cfg.height - 1) ny = cfg.height - 2;
    if (walkableTile(cfg, nx, ny)) return { x: nx, y: ny };
    return e;
  }

  function order(G, x, y) {
    var st = stateOf(G);
    var opt = chosen > 0 ? OPTIONS[chosen - 1] : null;
    if (!opt) return "blocked";
    if (st.calls >= 4 || CONFIG.squadCount >= (CONFIG.maxSquads || 14)) { chosen = 0; menu = false; return "max"; }
    if (st.points < opt.cost) return "points";
    if (!Police.isWalkable(G, x, y)) return "blocked";
    var entry = findEntry(MAP, x, y);
    if (!entry) return "blocked";
    st.points -= opt.cost;
    st.calls++;
    st.pending.push({
      opt: opt,
      destX: x, destY: y,
      entryX: entry.x, entryY: entry.y,
      tLeft: 6
    });
    chosen = 0;
    menu = false;
    G.log("Reinforcements dispatched: " + opt.name + " - arriving in 6 s");
    return "ok";
  }

  function update(G, dt) {
    var st = stateOf(G);
    st.timer += dt;
    while (st.timer >= 45 && st.points < 10) {
      st.timer -= 45;
      st.points = Math.min(10, st.points + 1);
    }
    if (st.points >= 10) st.timer = 0;
    var i;
    for (i = st.pending.length - 1; i >= 0; i--) {
      var p = st.pending[i];
      p.tLeft -= dt;
      if (p.tLeft <= 0) {
        st.pending.splice(i, 1);
        arrive(G, p);
      }
    }
  }

  function arrive(G, p) {
    var opt = p.opt;
    var s = Police.addSquad(G, opt.loadout, p.entryX, p.entryY);
    if (s < 0) return;
    G.log(opt.name + " arrives as squad " + (s + 1) + " (key " + ((s + 1) % 10) + ")");
    if (opt.kind === "van" || opt.kind === "truck") {
      if (typeof TRANSPORT !== "undefined") {
        TRANSPORT.toggle(G, s);
        TRANSPORT.drive(G, s, p.destX, p.destY);
      } else {
        Police.moveSquad(G, s, p.destX, p.destY, true);
      }
    } else {
      Police.moveSquad(G, s, p.destX, p.destY, true);
    }
  }

  function hud(G) {
    var st = stateOf(G);
    var s = "Reinforcements " + st.points + " pts [R]";
    if (st.pending.length > 0) s += " - " + st.pending.length + " on the way";
    return s;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function draw(ctx, G) {
    var S = Art.camera.S;
    var st = G._reinforce || stateOf(G);
    // Station
    if (MAP.station) {
      var stn = MAP.station;
      var c = Art.project(stn.x + stn.w / 2, stn.y + stn.h / 2, 1.9);
      var w = Math.max(46, 46 * S), h = Math.max(14, 14 * S);
      ctx.save();
      ctx.fillStyle = "#1d4ed8";
      roundRect(ctx, c.x - w / 2, c.y - h / 2, w, h, 4 * S);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold " + Math.max(9, 9 * S) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("POLICE", c.x, c.y + 0.5);
      // flashing light
      var t = (G.time && G.time > 0) ? G.time : (Date.now() / 1000);
      var phase = Math.floor(t / 0.4) % 2;
      ctx.fillStyle = phase ? "#ef4444" : "#3b82f6";
      var lr = Math.max(3, 3 * S);
      ctx.beginPath();
      ctx.arc(c.x, c.y - h / 2 - lr - 1, lr, 0, Math.PI * 2);
      ctx.fill();
      // door marker
      var d = Art.project(stn.doorX + 0.5, stn.doorY + 0.5, 0);
      var ds = Math.max(10, 10 * S);
      ctx.fillStyle = "rgba(147,197,253,0.85)";
      ctx.fillRect(d.x - ds / 2, d.y - ds / 2, ds, ds);
      ctx.restore();
    }
    // Pending calls
    var i;
    for (i = 0; i < st.pending.length; i++) {
      var p = st.pending[i];
      var dp = Art.project(p.destX + 0.5, p.destY + 0.5, 0);
      var ph = ((G.time || 0) * 1.5 + i) % 1;
      var rad = (0.8 + ph * 0.5) * 32 * S;
      ctx.save();
      ctx.strokeStyle = "rgba(80,160,255,0.8)";
      ctx.lineWidth = Math.max(1, 2 * S);
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#bfdbfe";
      ctx.font = "bold " + Math.max(10, 10 * S) + "px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText(Math.ceil(p.tLeft) + "s", dp.x, dp.y - rad - 4);
      // arrow at entry
      var ep = Art.project(p.entryX + 0.5, p.entryY + 0.5, 0);
      var ang = Math.atan2(dp.y - ep.y, dp.x - ep.x);
      ctx.translate(ep.x, ep.y);
      ctx.rotate(ang);
      var as = Math.max(6, 6 * S);
      ctx.fillStyle = "#93c5fd";
      ctx.beginPath();
      ctx.moveTo(as, 0);
      ctx.lineTo(-as, as * 0.6);
      ctx.lineTo(-as, -as * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPanel(ctx, G, w, h) {
    if (!menu) return;
    var st = stateOf(G);
    var panelW = Math.min(520, w - 40);
    var rowH = 24;
    var titleH = 26, footH = 26;
    var panelH = titleH + 4 * rowH + footH + 10;
    var px = (w - panelW) / 2;
    var py = h - 34 - panelH;
    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,0.92)";
    roundRect(ctx, px, py, panelW, panelH, 8);
    ctx.fill();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, panelW, panelH, 8);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e3e8f0";
    ctx.font = "bold 14px Consolas, monospace";
    ctx.fillText("CALL REINFORCEMENTS  (points: " + st.points + ")", px + 12, py + titleH / 2 + 2);
    var canMax = st.calls >= 4 || CONFIG.squadCount >= (CONFIG.maxSquads || 14);
    for (var i = 0; i < 4; i++) {
      var o = OPTIONS[i];
      var yy = py + titleH + i * rowH + rowH / 2;
      var affordable = st.points >= o.cost && !canMax;
      ctx.fillStyle = affordable ? "#e3e8f0" : "#6b7280";
      ctx.font = "bold 14px Consolas, monospace";
      var left = (i + 1) + "  " + o.name;
      ctx.fillText(left, px + 12, yy);
      ctx.fillText(o.label, px + 160, yy);
      ctx.fillStyle = affordable ? "#ffd866" : "#6b7280";
      ctx.fillText(o.cost + " pts", px + panelW - 90, yy);
    }
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px Consolas, monospace";
    var footer;
    if (chosen > 0) {
      footer = "click on the map where the " + OPTIONS[chosen - 1].name + " should go";
    } else {
      footer = "press 1-4 then click where they should go - R / Esc closes";
    }
    ctx.fillText(footer, px + 12, py + panelH - footH / 2 - 2);
    ctx.restore();
  }

  return {
    placeStation: placeStation,
    init: init,
    update: update,
    toggleMenu: toggleMenu,
    menuOpen: menuOpen,
    choose: choose,
    pending: pending,
    cancel: cancel,
    order: order,
    hud: hud,
    draw: draw,
    drawPanel: drawPanel,
    points: points
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = REINFORCE;
