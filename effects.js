var FX = (function () {
  var bins = [], fires = [], puffs = [], projectiles = [], rings = [], sparkles = [], stars = [];
  var inited = false, flowDirty = false, smokeAcc = 0;
  var POOL = [];
  function now() { return 0; }
  function hash2(x, y, s) {
    var h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function key(x, y) { return x + "," + y; }

  function buildBins(G) {
    bins = [];
    if (typeof MAP === "undefined" || !MAP.rows) return;
    var w = MAP.width, h = MAP.height, rows = MAP.rows;
    var total = 0, i, j;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) if (rows[j].charAt(i) === '.') total++;
    var want = Math.max(1, Math.round(total / 40));
    if (want > 200) want = 200;
    var seed = (typeof MAP.seed === "number") ? MAP.seed : 12345;
    var candidates = [], step = Math.max(1, Math.floor(total / (want * 3)));
    for (j = 1; j < h - 1; j++) {
      for (i = 1; i < w - 1; i++) {
        if (rows[j].charAt(i) !== '.') continue;
        var adj = false;
        if (rows[j - 1].charAt(i) === '#' || rows[j - 1].charAt(i) === 'S') adj = true;
        if (rows[j + 1].charAt(i) === '#' || rows[j + 1].charAt(i) === 'S') adj = true;
        if (rows[j].charAt(i - 1) === '#' || rows[j].charAt(i - 1) === 'S') adj = true;
        if (rows[j].charAt(i + 1) === '#' || rows[j].charAt(i + 1) === 'S') adj = true;
        if (!adj) continue;
        var r = hash2(i, j, seed);
        candidates.push({ x: i + 0.5, y: j + 0.5, r: r });
      }
    }
    candidates.sort(function (a, b) { return a.r - b.r; });
    for (i = 0; i < candidates.length && bins.length < want; i++) {
      var c = candidates[i], ok = true;
      for (j = 0; j < bins.length; j++) if (dist2(bins[j].x, bins[j].y, c.x, c.y) < 4) { ok = false; break; }
      if (ok) bins.push({ x: c.x, y: c.y, lit: false });
    }
  }

  function init(G) {
    inited = true;
    bins = []; fires = []; puffs = []; projectiles = []; rings = []; sparkles = []; stars = [];
    flowDirty = false; smokeAcc = 0;
    buildBins(G);
    var seed = (typeof MAP !== "undefined" && typeof MAP.seed === "number") ? MAP.seed : 0;
    var ang = hash2(seed | 0, 7, 13) * Math.PI * 2;
    G.wind = { x: Math.cos(ang), y: Math.sin(ang), base: ang };
    G.fireBlocked = new Set();
  }
  function ensure(G) { if (!inited) init(G); if (!G.wind) init(G); }

  function addFire(G, tx, ty) {
    for (var i = 0; i < fires.length; i++) if (fires[i].tx === tx && fires[i].ty === ty) return;
    var f = { x: tx + 0.5, y: ty + 0.5, tx: tx, ty: ty, hp: 100, born: G.time, smokeT: 0 };
    fires.push(f);
    G.fireBlocked.add(key(tx, ty));
    flowDirty = true;
  }

  function throwAt(G, from, target) {
    ensure(G);
    if (!from || !target) return;
    var kind = Math.random() < 0.6 ? "stone" : "bottle";
    var tx = target.x + (Math.random() * 1.2 - 0.6);
    var ty = target.y + (Math.random() * 1.2 - 0.6);
    projectiles.push({
      x0: from.x, y0: from.y, x1: tx, y1: ty,
      t: 0, dur: 0.7 + Math.random() * 0.3,
      peak: 1.2 + Math.random() * 0.6, kind: kind
    });
  }

  function shopBroken(G, shop) {
    ensure(G);
    if (!shop) return;
    if (Math.random() >= 0.3) return;
    var tries = 0;
    while (tries < 12) {
      tries++;
      var dx = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 1 : 2);
      var dy = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 1 : 2);
      var tx = shop.x + dx, ty = shop.y + dy;
      if (tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) continue;
      var ch = MAP.rows[ty].charAt(tx);
      if (ch === '.' || ch === 'P' || ch === 'a') { addFire(G, tx, ty); return; }
    }
  }

  function water(G, x, y, r) {
    ensure(G);
    var r2 = r * r, i;
    for (i = fires.length - 1; i >= 0; i--) {
      var f = fires[i];
      if (dist2(x, y, f.x, f.y) <= r2) {
        G.fireBlocked.delete(key(f.tx, f.ty));
        fires.splice(i, 1);
        flowDirty = true;
      }
    }
  }

  function puffDensity(p, x, y) {
    var dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
    var r = p.r;
    if (d2 > r * r) return 0;
    var d = Math.sqrt(d2);
    var a = (1 - d / r) * p.alpha;
    return a > 0 ? a : 0;
  }

  function smokeAt(G, x, y) {
    if (!inited || !puffs.length) return 0;
    var s = 0;
    for (var i = 0; i < puffs.length; i++) s += puffDensity(puffs[i], x, y);
    return s > 1 ? 1 : s;
  }

  function collides(G, x, y) {
    return Crowd.collides(G, x, y);
  }

  function rebuild() { flowDirty = false; }

  function update(G, dt) {
    ensure(G);
    if (dt > 0.05) dt = 0.05;
    var C = (typeof CONFIG !== "undefined") ? CONFIG : {};
    var i, j, a, o, f, p;
    var fireChance = (C.fireLightChance || 0.08);
    var fireSeconds = (C.fireSeconds || 70);
    var revealSeconds = (C.revealSeconds || 4);

    // projectiles
    for (i = projectiles.length - 1; i >= 0; i--) {
      p = projectiles[i];
      p.t += dt;
      var u = p.t / p.dur;
      if (u >= 1) {
        var hit = false;
        for (j = 0; j < G.officers.length; j++) {
          o = G.officers[j];
          if (dist2(o.x, o.y, p.x1, p.y1) <= 0.45 * 0.45) {
            o.stunUntil = G.time + 1.5;
            G.log("Officer hit by a thrown object");
            hit = true;
          }
        }
        rings.push({ x: p.x1, y: p.y1, t: 0 });
        if (p.kind === "bottle") sparkles.push({ x: p.x1, y: p.y1, t: 0 });
        projectiles.splice(i, 1);
        continue;
      }
    }

    // ignition: rioter with tool near unlit bin
    var nBins = bins.length;
    if (nBins > 0) {
      for (i = 0; i < G.agents.length; i++) {
        a = G.agents[i];
        if (!a.active || a.role !== "rioter" || a.state === "flee" || !a.hasTool) continue;
        if (a._fxBinT === undefined) a._fxBinT = Math.random() * 2;
        for (j = 0; j < nBins; j++) {
          var b = bins[j];
          if (b.lit) continue;
          if (dist2(a.x, a.y, b.x, b.y) <= 1.2 * 1.2) {
            if (Math.random() < fireChance * dt) {
              b.lit = true;
              a.revealedUntil = G.time + revealSeconds;
              a.violentUntil = G.time + revealSeconds;
              G.log("Bin set on fire");
              addFire(G, Math.floor(b.x), Math.floor(b.y));
            }
            break;
          }
        }
      }
    }

    // fires lifetime + smoke spawn
    smokeAcc += dt;
    var spawnSmoke = smokeAcc >= 0.25;
    if (spawnSmoke) smokeAcc = 0;
    for (i = fires.length - 1; i >= 0; i--) {
      f = fires[i];
      if (G.time - f.born >= fireSeconds) {
        G.fireBlocked.delete(key(f.tx, f.ty));
        fires.splice(i, 1);
        flowDirty = true;
        continue;
      }
      if (spawnSmoke && puffs.length < 400) {
        puffs.push({ x: f.x, y: f.y, vx: G.wind.x * 0.6, vy: G.wind.y * 0.6, age: 0, r: 0.4, alpha: 0.5 });
      }
    }

    // wind rotate
    var seed = (typeof MAP !== "undefined" && typeof MAP.seed === "number") ? MAP.seed : 0;
    var wob = Math.sin(G.time * 0.1 + seed) * 0.35;
    var wa = G.wind.base + wob;
    G.wind.x = Math.cos(wa); G.wind.y = Math.sin(wa);

    // puffs
    for (i = puffs.length - 1; i >= 0; i--) {
      p = puffs[i];
      p.age += dt;
      if (p.age >= 6) { puffs.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.r = 0.4 + (p.age / 6) * 1.8;
      p.alpha = 0.5 * (1 - p.age / 6);
    }

    // rings/sparkles/stars decay
    for (i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t >= 0.3) rings.splice(i, 1); }
    for (i = sparkles.length - 1; i >= 0; i--) { sparkles[i].t += dt; if (sparkles[i].t >= 4) sparkles.splice(i, 1); }

    // agent push & mood near fires
    if (fires.length > 0) {
      for (i = 0; i < fires.length; i++) {
        f = fires[i];
        var near = Crowd.neighbors(G, f.x, f.y, 4.1);
        for (j = 0; j < near.length; j++) {
          a = near[j];
          if (!a.active) continue;
          var d2 = dist2(a.x, a.y, f.x, f.y);
          if (d2 <= 4 * 4) {
            var m = a.mood === undefined ? 50 : a.mood;
            m += 2 * dt;
            a.mood = m > 100 ? 100 : m;
          }
          if (d2 > 0.0001 && d2 <= 0.9 * 0.9) {
            var d = Math.sqrt(d2);
            var nx = a.x + (a.x - f.x) / d * 2.5 * dt;
            var ny = a.y + (a.y - f.y) / d * 2.5 * dt;
            if (!collides(G, nx, ny)) { a.x = nx; a.y = ny; }
          }
        }
      }
    }

    if (flowDirty) {
      Crowd.rebuildFlow(G);
      flowDirty = false;
    }
  }

  function project(x, y, z) {
    if (typeof Art !== "undefined" && Art.project) return Art.project(x, y, z);
    return { x: x * 20, y: y * 20 - z * 20 };
  }

  function S() { return (typeof Art !== "undefined" && Art.camera) ? Art.camera.S : 10; }

  function drawFire(ctx, G, f) {
    var s = S();
    var p = project(f.x, f.y, 0);
    var age = G.time - f.born;
    var life = (CONFIG.fireSeconds || 70);
    var fade = age > life - 6 ? Math.max(0, (life - age) / 6) : 1;
    // charred bin under
    var binBelow = false;
    for (var bi = 0; bi < bins.length; bi++) {
      if (Math.floor(bins[bi].x) === f.tx && Math.floor(bins[bi].y) === f.ty) { binBelow = true; break; }
    }
    if (binBelow) {
      ctx.globalAlpha = 0.8 * fade;
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(p.x, p.y, 1.6 * s, 0.8 * s, 0, 0, Math.PI * 2) : ctx.arc(p.x, p.y, 1.4 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // glow
    var gp = project(f.x, f.y, 0);
    ctx.globalAlpha = 0.22 * fade;
    ctx.fillStyle = "#ff8822";
    ctx.beginPath();
    ctx.arc(gp.x, gp.y, 12 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // flames
    var n = 3 + Math.floor((f.tx * 7 + f.ty * 13) % 3);
    for (var i = 0; i < n; i++) {
      var ph = G.time * 7 + i * 1.7 + f.tx;
      var sway = Math.sin(ph) * 2.2 * s;
      var hgt = (10 + Math.sin(ph * 1.3) * 3.5 - i * 1.1) * s;
      var fp = { x: p.x + (i - (n - 1) / 2) * 2.3 * s, y: p.y - 1 * s };
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = i % 2 === 0 ? "#ff6611" : "#ffcc22";
      ctx.beginPath();
      var w = 2.6 * s;
      ctx.moveTo(fp.x - w, fp.y);
      ctx.quadraticCurveTo(fp.x + sway, fp.y - hgt * 1.6, fp.x + w, fp.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(ctx, G) {
    ensure(G);
    var s = S(), i, j, p, q;
    var C = (typeof CONFIG !== "undefined") ? CONFIG : {};

    // shadows, sparkles, glow, rings first
    ctx.save();
    for (i = 0; i < projectiles.length; i++) {
      p = projectiles[i];
      var u = p.t / p.dur;
      var cx = p.x0 + (p.x1 - p.x0) * u;
      var cy = p.y0 + (p.y1 - p.y0) * u;
      var z = p.peak * Math.sin(Math.PI * u);
      var gp = project(cx, cy, 0);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(gp.x, gp.y, 1.4 * s, 0.7 * s, 0, 0, Math.PI * 2) : ctx.arc(gp.x, gp.y, 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // sparkles
    for (i = 0; i < sparkles.length; i++) {
      q = sparkles[i];
      var sp = project(q.x, q.y, 0.15);
      ctx.globalAlpha = Math.max(0, 1 - q.t / 4) * 0.8;
      ctx.fillStyle = "#cce8ff";
      for (j = 0; j < 4; j++) {
        var ang = j * Math.PI / 2 + q.t;
        ctx.beginPath();
        ctx.arc(sp.x + Math.cos(ang) * 4 * s, sp.y + Math.sin(ang) * 2 * s, Math.max(0.6, 0.6 * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // impact rings
    for (i = 0; i < rings.length; i++) {
      q = rings[i];
      var rp = project(q.x, q.y, 0.3);
      var rr = (2 + q.t * 25) * s;
      ctx.globalAlpha = Math.max(0, 1 - q.t / 0.3) * 0.7;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // bins
    for (i = 0; i < bins.length; i++) {
      var b = bins[i];
      var bp = project(b.x, b.y, 0);
      if (b.lit) continue; // drawn as fire
      ctx.fillStyle = "#1e4d2b";
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(bp.x, bp.y, 1.5 * s, 0.7 * s, 0, 0, Math.PI * 2) : ctx.arc(bp.x, bp.y, 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(bp.x - 1.5 * s, bp.y - 5 * s, 3 * s, 5 * s);
      ctx.fillStyle = "#2e6b3d";
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(bp.x, bp.y - 5 * s, 1.5 * s, 0.6 * s, 0, 0, Math.PI * 2) : ctx.arc(bp.x, bp.y - 5 * s, 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // fires
    for (i = 0; i < fires.length; i++) drawFire(ctx, G, fires[i]);

    // projectiles
    for (i = 0; i < projectiles.length; i++) {
      p = projectiles[i];
      var uu = p.t / p.dur;
      var px = p.x0 + (p.x1 - p.x0) * uu;
      var py = p.y0 + (p.y1 - p.y0) * uu;
      var pz = p.peak * Math.sin(Math.PI * uu);
      var pp = project(px, py, pz);
      if (p.kind === "stone") {
        ctx.fillStyle = "#888";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, Math.max(1, 1.1 * s), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#4a7a3a";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, Math.max(1, 1.0 * s), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a2a1a";
        ctx.fillRect(pp.x - 0.4 * s, pp.y - 2 * s, 0.8 * s, 1.4 * s);
      }
    }

    // smoke
    for (i = 0; i < puffs.length; i++) {
      p = puffs[i];
      var z = 1.0 + p.age * 0.6;
      var sp2 = project(p.x, p.y, z);
      ctx.globalAlpha = p.alpha * 0.55;
      ctx.fillStyle = "#888";
      ctx.beginPath();
      ctx.arc(sp2.x, sp2.y, p.r * 32 * s * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // stun stars
    for (i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      if (o.stunUntil === undefined || o.stunUntil <= G.time) continue;
      var op = project(o.x, o.y, 1.6);
      ctx.fillStyle = "#ffe066";
      for (j = 0; j < 3; j++) {
        var a2 = G.time * 4 + j * (Math.PI * 2 / 3);
        var sx = op.x + Math.cos(a2) * 4 * s;
        var sy = op.y - 6 * s + Math.sin(a2) * 1.5 * s;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1, 1.2 * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  return { init: init, update: update, draw: draw, throwAt: throwAt, shopBroken: shopBroken, water: water, smokeAt: smokeAt };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FX;
