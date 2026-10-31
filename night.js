// night.js - liaison officers and dusk/night lighting (ES5, classic script)
var LIAISON = (function () {
  var lastG = null;
  var squadLiaison = {}; // squad id -> bool, rebuilt per update
  var lastWithdrawLog = -999;

  function isLiaison(G, o) {
    return Police.getLoadout(G, o.squad) === "liaison";
  }

  function init(G) {
    lastG = G || null;
    squadLiaison = {};
    lastWithdrawLog = -999;
    if (G && G.stats) {
      if (typeof G.stats.liaisonTalkSeconds !== "number") G.stats.liaisonTalkSeconds = 0;
      if (typeof G.stats.liaisonWithdrawals !== "number") G.stats.liaisonWithdrawals = 0;
    }
  }

  function ensureStats(G) {
    if (!G.stats) G.stats = {};
    if (typeof G.stats.liaisonTalkSeconds !== "number") G.stats.liaisonTalkSeconds = 0;
    if (typeof G.stats.liaisonWithdrawals !== "number") G.stats.liaisonWithdrawals = 0;
  }

  function calmAgent(G, a, dist, radius, calm, frame) {
    if (a._calmF === frame) return;
    if (!a.active) return;
    if (a.role === "rioter") return;
    if (a.hasTool || a.violentUntil > G.time) return;
    a._calmF = frame;
    var amt = calm * (1 - 0.5 * (dist / radius));
    var m = a.mood - amt;
    if (m < 0) m = 0;
    a.mood = m;
    if (a.role !== "rioter" && m < 30) a.calmedUntil = G.time + 20;
  }

  function update(G, dt) {
    if (G !== lastG) init(G);
    ensureStats(G);
    var C = CONFIG;
    var radius = C.liaisonRadius || 4;
    var calm = C.liaisonCalm || 2.0;
    var offs = G.officers;
    var i, o, n, list, j, a, dx, dy, d;
    var angryR = 2.5;
    var frame = (G._liaisonFrame || 0) + 1;
    G._liaisonFrame = frame;
    squadLiaison = {};
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      var sq = o.squad;
      if (squadLiaison[sq] === undefined) squadLiaison[sq] = isLiaison(G, o);
      if (!squadLiaison[sq]) { o.talking = false; continue; }
      var lx = (typeof o._lx === "number") ? o._lx : o.x;
      var ly = (typeof o._ly === "number") ? o._ly : o.y;
      dx = o.x - lx; dy = o.y - ly;
      var moved = Math.sqrt(dx * dx + dy * dy);
      var still = moved < 0.3 * dt;   // under 0.3 tiles/s
      var stunned = o.stunUntil > G.time;
      var backing = o._liaisonBackoff > G.time;
      var talking = still && !stunned && !backing;
      o.talking = talking;
      o._lx = o.x; o._ly = o.y;
      if (talking) {
        G.stats.liaisonTalkSeconds += dt;
        list = Crowd.neighbors(G, o.x, o.y, radius);
        for (j = 0; j < list.length; j++) {
          a = list[j];
          dx = a.x - o.x; dy = a.y - o.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius) continue;
          calmAgent(G, a, d, radius, calm, frame);
        }
      }
      // danger check
      if (!stunned && !backing) {
        list = Crowd.neighbors(G, o.x, o.y, angryR);
        var angry = 0;
        for (j = 0; j < list.length; j++) {
          a = list[j];
          if (!a.active) continue;
          if (a.mood >= 75) {
            dx = a.x - o.x; dy = a.y - o.y;
            d = Math.sqrt(dx * dx + dy * dy);
            if (d <= angryR) angry++;
          }
        }
        if (angry >= 6) {
          o._liaisonBackoff = G.time + 6;
          o.talking = false;
          G.stats.liaisonWithdrawals += 1;
          if (G.time - lastWithdrawLog >= 8) {
            lastWithdrawLog = G.time;
            if (G.log) G.log("Liaison officers step back from an angry group");
          }
        }
      }
    }
  }

  function draw(ctx, G) {
    if (G !== lastG) init(G);
    var S = Art.camera.S;
    var C = CONFIG;
    var radius = C.liaisonRadius || 4;
    var offs = G.officers;
    var i, o;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!isLiaison(G, o)) continue;
      var backing = o._liaisonBackoff > G.time;
      if (!o.talking && !backing) continue;
      var p = Art.project(o.x, o.y, 0);
      if (o.talking) {
        // faint green pool
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(80,200,120,0.10)";
        var rp = radius * 32 * S;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rp, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      var bx = p.x;
      var by = p.y - 22 * S;
      if (backing) {
        ctx.save();
        ctx.fillStyle = "#ff9a3a";
        ctx.font = "bold " + Math.round(14 * S) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", bx, by);
        ctx.restore();
        continue;
      }
      // speech bubble
      ctx.save();
      var bw = 16 * S, bh = 11 * S;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = Math.max(1, S);
      ctx.beginPath();
      // rounded rect
      var rr = 3 * S;
      var x0 = bx - bw / 2, y0 = by - bh / 2;
      ctx.moveTo(x0 + rr, y0);
      ctx.lineTo(x0 + bw - rr, y0);
      ctx.quadraticCurveTo(x0 + bw, y0, x0 + bw, y0 + rr);
      ctx.lineTo(x0 + bw, y0 + bh - rr);
      ctx.quadraticCurveTo(x0 + bw, y0 + bh, x0 + bw - rr, y0 + bh);
      ctx.lineTo(x0 + rr, y0 + bh);
      ctx.quadraticCurveTo(x0, y0 + bh, x0, y0 + bh - rr);
      ctx.lineTo(x0, y0 + rr);
      ctx.quadraticCurveTo(x0, y0, x0 + rr, y0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // tail
      ctx.beginPath();
      ctx.moveTo(bx - 2 * S, y0 + bh);
      ctx.lineTo(bx + 2 * S, y0 + bh);
      ctx.lineTo(bx, y0 + bh + 4 * S);
      ctx.closePath();
      ctx.fill();
      // three dots bouncing
      ctx.fillStyle = "#445";
      var t = G.time;
      for (var k = 0; k < 3; k++) {
        var ph = t * 6 + k * 2;
        var oy = Math.sin(ph) * 1.2 * S;
        ctx.beginPath();
        ctx.arc(bx + (k - 1) * 4 * S, by + oy, 1.3 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  return { init: init, update: update, draw: draw, isLiaison: isLiaison, vestColor: "#9fd3ff" };
})();

var NIGHT = (function () {
  var lastG = null;
  var lightList = [];
  var grid = null;
  var gridW = 0, gridH = 0;
  var lastGridTime = -999;
  var offCanvas = null;
  var offW = 0, offH = 0;
  var logDusk = false, logNight = false;

  function init(G) {
    lastG = G || null;
    lightList = [];
    grid = null;
    gridW = 0; gridH = 0;
    lastGridTime = -999;
    logDusk = false; logNight = false;
    if (typeof MAP !== "undefined" && MAP.rows) {
      buildLights();
    }
  }

  function buildLights() {
    var rows = MAP.rows;
    var H = MAP.height, W = MAP.width;
    var candidates = [];
    for (var y = 0; y < H; y++) {
      var row = rows[y] || "";
      for (var x = 0; x < W; x++) {
        var ch = row.charAt(x);
        if (ch !== "." && ch !== "P") continue;
        var nb = false;
        if (x > 0) { var c1 = row.charAt(x - 1); if (c1 === "#" || c1 === "S") nb = true; }
        if (!nb && x < W - 1) { var c2 = row.charAt(x + 1); if (c2 === "#" || c2 === "S") nb = true; }
        if (!nb && y > 0) { var c3 = (rows[y - 1] || "").charAt(x); if (c3 === "#" || c3 === "S") nb = true; }
        if (!nb && y < H - 1) { var c4 = (rows[y + 1] || "").charAt(x); if (c4 === "#" || c4 === "S") nb = true; }
        if (nb) candidates.push({ x: x, y: y });
      }
    }
    var kept = [];
    for (var i = 0; i < candidates.length && kept.length < 140; i++) {
      var c = candidates[i];
      var ok = true;
      for (var k = 0; k < kept.length; k++) {
        if (Math.abs(kept[k].x - c.x) <= 5 && Math.abs(kept[k].y - c.y) <= 5) { ok = false; break; }
      }
      if (ok) kept.push({ x: c.x + 0.5, y: c.y + 0.5 });
    }
    lightList = kept;
  }

  function darkness(G) {
    if (G !== lastG) init(G);
    if (!CONFIG.nightCycle) return 0;
    var C = CONFIG;
    var matchSec = C.matchSeconds || 300;
    var t0 = (C.duskStart !== undefined ? C.duskStart : 0.4) * matchSec;
    var dur = C.duskSeconds || 70;
    var maxD = C.nightMax !== undefined ? C.nightMax : 0.72;
    var t = G.time - t0;
    if (t <= 0) return 0;
    if (t >= dur) return maxD;
    var u = t / dur;
    u = u * u * (3 - 2 * u);
    return maxD * u;
  }

  function addSource(x, y, rad, peak) {
    // tile-space grid accumulation
    var W = gridW, H = gridH;
    var cx = Math.round(x), cy = Math.round(y);
    var r = Math.ceil(rad);
    var y0 = cy - r, y1 = cy + r, x0 = cx - r, x1 = cx + r;
    if (y0 < 0) y0 = 0; if (x0 < 0) x0 = 0;
    if (y1 >= H) y1 = H - 1; if (x1 >= W) x1 = W - 1;
    for (var yy = y0; yy <= y1; yy++) {
      var rowOff = yy * W;
      for (var xx = x0; xx <= x1; xx++) {
        var dx = xx - x, dy = yy - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= rad) continue;
        var v = peak * (1 - d / rad);
        if (v > grid[rowOff + xx]) grid[rowOff + xx] = v;
      }
    }
  }

  function rebuildGrid(G) {
    gridW = MAP.width; gridH = MAP.height;
    if (!grid || grid.length !== gridW * gridH) grid = new Float32Array(gridW * gridH);
    else { for (var z = 0; z < grid.length; z++) grid[z] = 0; }
    var i;
    for (i = 0; i < lightList.length; i++) addSource(lightList[i].x, lightList[i].y, 3.5, 0.85);
    if (G.fireBlocked && G.fireBlocked.forEach) {
      G.fireBlocked.forEach(function (key) {
        var parts = key.split(",");
        var fx = parseFloat(parts[0]) + 0.5, fy = parseFloat(parts[1]) + 0.5;
        addSource(fx, fy, 4, 1);
      });
    }
    if (G.shops) {
      for (i = 0; i < G.shops.length; i++) {
        var s = G.shops[i];
        if (s.broken) continue;
        addSource(s.x + 0.5, s.y + 1 + 0.5, 2.5, 0.6);
      }
    }
    if (G.vehicles) {
      for (i = 0; i < G.vehicles.length; i++) {
        var v = G.vehicles[i];
        addSource(v.x, v.y, 3, 0.9);
      }
    }
  }

  function lightAt(G, x, y) {
    if (G !== lastG) init(G);
    if (!CONFIG.nightCycle) return 0;
    if (G.time - lastGridTime >= 0.5 || !grid) {
      rebuildGrid(G);
      lastGridTime = G.time;
    }
    var ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= gridW || iy >= gridH) return 0;
    return grid[iy * gridW + ix];
  }

  function visibility(G, x, y) {
    if (!CONFIG.nightCycle) return 1;
    var d = darkness(G);
    var l = lightAt(G, x, y);
    return 1 - 0.55 * d * (1 - l);
  }

  function boldness(G) {
    if (!CONFIG.nightCycle) return 1;
    return 1 + 0.6 * darkness(G);
  }

  function lights(G) {
    if (G !== lastG) init(G);
    return lightList;
  }

  function update(G, dt) {
    if (G !== lastG) init(G);
    if (!CONFIG.nightCycle) return;
    var d = darkness(G);
    if (!logDusk && d > 0.1) { logDusk = true; if (G.log) G.log("Dusk is falling"); }
    var maxD = CONFIG.nightMax !== undefined ? CONFIG.nightMax : 0.72;
    if (!logNight && d >= 0.9 * maxD) { logNight = true; if (G.log) G.log("Night: the streets are dark"); }
  }

  function ensureOffCanvas(w, h) {
    if (!offCanvas) {
      offCanvas = document.createElement("canvas");
    }
    if (offW !== w || offH !== h) {
      offCanvas.width = w; offCanvas.height = h;
      offW = w; offH = h;
    }
    return offCanvas;
  }

  // pre-drawn radial sprites: drawImage is far cheaper than a new gradient per light
  var sprites = {};
  function sprite(rgb) {
    if (sprites[rgb]) return sprites[rgb];
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var x = c.getContext("2d");
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(" + rgb + ",1)");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    sprites[rgb] = c;
    return c;
  }

  function drawLightPool(oc, proj, radPx, strength, flicker) {
    // proj: {x,y} in device px, radPx: radius in device px
    oc.globalAlpha = Math.min(1, strength * (flicker || 1));
    oc.drawImage(sprite("0,0,0"), proj.x - radPx, proj.y - radPx, radPx * 2, radPx * 2);
    oc.globalAlpha = 1;
  }

  function draw(ctx, G) {
    if (G !== lastG) init(G);
    if (!CONFIG.nightCycle) return;
    var d = darkness(G);
    if (d <= 0.001) return;
    var canvas = ctx.canvas;
    var fullW = canvas.width, fullH = canvas.height;
    // the shade is soft gradients only, so a quarter-resolution layer is enough
    var Q = 0.25;
    var cw = Math.ceil(fullW * Q), ch = Math.ceil(fullH * Q);
    var oc = ensureOffCanvas(cw, ch);
    var octx = oc.getContext("2d");
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = "source-over";
    octx.globalAlpha = 1;
    octx.clearRect(0, 0, cw, ch);
    octx.fillStyle = "rgba(8,12,34," + d + ")";
    octx.fillRect(0, 0, cw, ch);
    octx.globalCompositeOperation = "destination-out";

    var rs0 = ctx.getTransform().a;
    if (!rs0 || !isFinite(rs0)) rs0 = 1;
    var rs = rs0 * Q;
    var S = Art.camera.S;
    var tileDev = 32 * S * rs;
    var margin = 400 * rs;
    var i, p, gp, radDev;

    function projTile(tx, ty) {
      var pt = Art.project(tx, ty, 0);
      return { x: pt.x * rs, y: pt.y * rs };
    }

    // streetlights
    for (i = 0; i < lightList.length; i++) {
      var L = lightList[i];
      p = projTile(L.x, L.y);
      radDev = 3.5 * tileDev;
      if (p.x < -margin || p.y < -margin || p.x > cw + margin || p.y > ch + margin) continue;
      drawLightPool(octx, p, radDev, 0.85, 1);
    }
    // fires
    if (G.fireBlocked && G.fireBlocked.forEach) {
      var fl = 1 + 0.1 * Math.sin(G.time * 9.0);
      G.fireBlocked.forEach(function (key) {
        var parts = key.split(",");
        var fx = parseFloat(parts[0]) + 0.5, fy = parseFloat(parts[1]) + 0.5;
        var pp = projTile(fx, fy);
        var rd = 4 * tileDev;
        if (pp.x < -margin || pp.y < -margin || pp.x > cw + margin || pp.y > ch + margin) return;
        drawLightPool(octx, pp, rd, 1, fl);
      });
    }
    // shops
    if (G.shops) {
      for (i = 0; i < G.shops.length; i++) {
        var s = G.shops[i];
        if (s.broken) continue;
        var sp = projTile(s.x + 0.5, s.y + 1.5);
        var sd = 2.5 * tileDev;
        if (sp.x < -margin || sp.y < -margin || sp.x > cw + margin || sp.y > ch + margin) continue;
        drawLightPool(octx, sp, sd, 0.6, 1);
      }
    }
    // vehicles
    if (G.vehicles) {
      for (i = 0; i < G.vehicles.length; i++) {
        var v = G.vehicles[i];
        var vx = v.x + Math.cos(v.ang) * 1.5;
        var vy = v.y + Math.sin(v.ang) * 1.5;
        var vp = projTile(vx, vy);
        var vd = 3 * tileDev;
        if (vp.x >= -margin && vp.y >= -margin && vp.x <= cw + margin && vp.y <= ch + margin) {
          drawLightPool(octx, vp, vd, 0.9, 1);
        }
        var vp2 = projTile(v.x, v.y);
        if (vp2.x >= -margin && vp2.y >= -margin && vp2.x <= cw + margin && vp2.y <= ch + margin) {
          drawLightPool(octx, vp2, 1 * tileDev, 0.9, 1);
        }
      }
    }

    // composite offscreen onto ctx
    octx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(oc, 0, 0, fullW, fullH);
    ctx.restore();

    // additive glows
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var glowA = 0.55 * d;
    rs = rs0; cw = fullW; ch = fullH; margin = 400 * rs;
    var lampP, hv;
    // streetlight lamp heads
    ctx.globalAlpha = glowA;
    for (i = 0; i < lightList.length; i++) {
      var L2 = lightList[i];
      var pt = Art.project(L2.x, L2.y, 3);
      var lx = pt.x, ly = pt.y;
      // screen test
      if (lx * rs < -margin || ly * rs < -margin || lx * rs > cw + margin || ly * rs > ch + margin) continue;
      var rg = 0.6 * 32 * S;
      ctx.globalAlpha = Math.min(1, 0.9 * d);
      ctx.drawImage(sprite("255,211,138"), lx - rg, ly - rg, rg * 2, rg * 2);
    }
    // fires
    if (G.fireBlocked && G.fireBlocked.forEach) {
      G.fireBlocked.forEach(function (key) {
        var parts = key.split(",");
        var fx = parseFloat(parts[0]) + 0.5, fy = parseFloat(parts[1]) + 0.5;
        var fp = Art.project(fx, fy, 0.8);
        var rg = 3.5 * 32 * S;
        var grd = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, rg);
        grd.addColorStop(0, "rgba(255,150,50," + (0.5 * d) + ")");
        grd.addColorStop(1, "rgba(255,150,50,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(fp.x, fp.y, rg, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // police vehicle flashing lights
    if (G.vehicles) {
      var phase = Math.floor(G.time / 0.25) % 2;
      for (i = 0; i < G.vehicles.length; i++) {
        var vv = G.vehicles[i];
        var vpt = Art.project(vv.x, vv.y, 1.5);
        var col = phase === 0 ? "58,123,255" : "255,58,58";
        var rg2 = 2.0 * 32 * S;
        var g2 = ctx.createRadialGradient(vpt.x, vpt.y, 0, vpt.x, vpt.y, rg2);
        g2.addColorStop(0, "rgba(" + col + "," + (0.8 * d) + ")");
        g2.addColorStop(1, "rgba(" + col + ",0)");
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(vpt.x, vpt.y, rg2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  return {
    init: init, update: update, draw: draw,
    darkness: darkness, lightAt: lightAt, visibility: visibility,
    boldness: boldness, lights: lights
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { LIAISON: LIAISON, NIGHT: NIGHT };
