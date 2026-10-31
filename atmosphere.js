/* atmosphere.js - cheap pre-rendered atmosphere FX for Police vs Protestors */
var ATMO = (function () {
  "use strict";

  var glowSpr, smokeSpr, puddleSprs = [], coneSpr, redSpr, blueSpr;
  var smokePool = [], smokeCount = 0, SMOKE_MAX = 220;
  var puddles = [], PUDDLE_MAX = 60, PUDDLE_LIFE = 90;
  var emberPhase = [];
  var smokeAcc = 0, puddleAcc = 0;
  var rnd = Math.random;

  function mkCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function buildGlow() {
    var s = 128, c = mkCanvas(s, s), x = c.getContext("2d");
    var g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,150,40,0.55)");
    g.addColorStop(0.4, "rgba(255,90,20,0.25)");
    g.addColorStop(1, "rgba(255,90,20,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    glowSpr = c;
  }

  function buildSmoke() {
    var s = 128, c = mkCanvas(s, s), x = c.getContext("2d");
    var g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(70,72,78,0.55)");
    g.addColorStop(1, "rgba(70,72,78,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    smokeSpr = c;
  }

  function buildPuddles() {
    for (var k = 0; k < 3; k++) {
      var s = 128, c = mkCanvas(s, s), x = c.getContext("2d");
      var cx = s / 2, cy = s / 2;
      var n = 4 + Math.floor(rnd() * 3);
      x.beginPath();
      for (var i = 0; i < n; i++) {
        var a = rnd() * Math.PI * 2;
        var dist = rnd() * s * 0.16;
        var ex = cx + Math.cos(a) * dist;
        var ey = cy + Math.sin(a) * dist;
        var rx = s * (0.14 + rnd() * 0.12);
        var ry = s * (0.10 + rnd() * 0.10);
        x.moveTo(ex + rx, ey);
        x.ellipse(ex, ey, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
      }
      x.fillStyle = "rgba(40,60,85,0.35)";
      x.fill();
      x.strokeStyle = "rgba(200,220,255,0.18)";
      x.lineWidth = 2;
      x.stroke();
      puddleSprs.push(c);
    }
  }

  function buildCone() {
    var w = 64, h = 128, c = mkCanvas(w, h), x = c.getContext("2d");
    var g = x.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, "rgba(255,245,210,0.45)");
    g.addColorStop(1, "rgba(255,245,210,0)");
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(w / 2, h);
    x.lineTo(w / 2 - 28, 0);
    x.lineTo(w / 2 + 28, 0);
    x.closePath();
    x.fill();
    coneSpr = c;
  }

  function buildPolice() {
    function mk(r, g, b) {
      var s = 96, c = mkCanvas(s, s), x = c.getContext("2d");
      var gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(" + r + "," + g + "," + b + ",0.9)");
      gr.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
      x.fillStyle = gr;
      x.fillRect(0, 0, s, s);
      return c;
    }
    redSpr = mk(255, 60, 60);
    blueSpr = mk(60, 90, 255);
  }

  function ensureSprites() {
    if (glowSpr) return;
    buildGlow(); buildSmoke(); buildPuddles(); buildCone(); buildPolice();
  }

  function init(G) {
    ensureSprites();
    smokePool = [];
    smokeCount = 0;
    for (var i = 0; i < SMOKE_MAX; i++) {
      smokePool.push({ active: false, x: 0, y: 0, z: 0, r: 0, age: 0, life: 7, alpha: 0, dark: 0, vx: 0, vy: 0 });
    }
    puddles = [];
    emberPhase = [];
    smokeAcc = 0; puddleAcc = 0;
  }

  function getWind(G) {
    if (G && G.wind && typeof G.wind.x === "number") return G.wind;
    return { x: 0.25, y: -0.08 };
  }

  function getSmokeQuality() {
    if (typeof QUALITY !== "undefined" && QUALITY && QUALITY.flag) {
      var q = QUALITY.flag("smoke");
      if (q) return q;
    }
    return 4;
  }

  function onScreen(G, px, py, margin) {
    if (typeof MAP === "undefined" || typeof CONFIG === "undefined") return true;
    var w = MAP.width * CONFIG.tileSize;
    var h = MAP.height * CONFIG.tileSize;
    return px > -margin && py > -margin && px < w + margin && py < h + margin;
  }

  function emitSmoke(x, y, dark) {
    var p = null, i;
    for (i = 0; i < SMOKE_MAX; i++) {
      var cand = smokePool[(smokeCount + i) % SMOKE_MAX];
      if (!cand.active) { p = cand; smokeCount = (smokeCount + i + 1) % SMOKE_MAX; break; }
    }
    if (!p) {
      p = smokePool[smokeCount];
      smokeCount = (smokeCount + 1) % SMOKE_MAX;
    }
    p.active = true;
    p.x = x + (rnd() - 0.5) * 0.3;
    p.y = y + (rnd() - 0.5) * 0.3;
    p.z = 0.8;
    p.r = 0.5;
    p.age = 0;
    p.life = 7;
    p.alpha = 0;
    p.dark = dark;
    p.vx = (rnd() - 0.5) * 0.15;
    p.vy = (rnd() - 0.5) * 0.15;
  }

  function collectSources(G) {
    var src = [];
    var i;
    if (G && G.shops) {
      for (i = 0; i < G.shops.length; i++) {
        var s = G.shops[i];
        if (s.broken) src.push({ x: s.x + 1, y: s.y + 1, fire: false });
      }
    }
    if (typeof FX !== "undefined" && FX && FX.list) {
      var fl = FX.list();
      for (i = 0; i < fl.length; i++) {
        src.push({ x: fl[i].x, y: fl[i].y, fire: true });
      }
    }
    return src;
  }

  function update(G, dt) {
    if (typeof dt !== "number" || dt <= 0) return;
    if (dt > 0.05) dt = 0.05;
    if (!glowSpr) ensureSprites();
    var wind = getWind(G);
    var q = getSmokeQuality();
    var sources = collectSources(G);
    var i, j, p;

    // smoke emission
    smokeAcc += dt;
    while (smokeAcc >= 0.5) {
      smokeAcc -= 0.5;
      for (i = 0; i < sources.length; i++) {
        var s = sources[i];
        var num = Math.max(1, Math.floor(q / 2));
        for (j = 0; j < num; j++) emitSmoke(s.x, s.y, s.fire ? 1 : 0);
      }
    }

    // smoke update
    for (i = 0; i < SMOKE_MAX; i++) {
      p = smokePool[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }
      var t = p.age / p.life;
      p.r = 0.5 + t * 2.1;
      p.z += 0.5 * dt;
      p.x += (wind.x + p.vx) * dt;
      p.y += (wind.y + p.vy) * dt;
      var fin = Math.min(1, p.age / 0.8);
      var fout = 1 - Math.max(0, (p.age - p.life * 0.4) / (p.life * 0.6));
      p.alpha = fin * fout;
    }

    // puddles
    if (G && G.waterFx && G.waterFx.until && G.time * 1000 < G.waterFx.until) {
      puddleAcc += dt;
      while (puddleAcc >= 0.3) {
        puddleAcc -= 0.3;
        var wx = G.waterFx.x + (rnd() - 0.5) * 1.2;
        var wy = G.waterFx.y + (rnd() - 0.5) * 1.2;
        if (puddles.length >= PUDDLE_MAX) puddles.shift();
        puddles.push({
          x: wx, y: wy,
          size: 0.8 + rnd() * 0.8,
          rot: rnd() * Math.PI * 2,
          spr: Math.floor(rnd() * 3),
          age: 0
        });
      }
    }
    for (i = puddles.length - 1; i >= 0; i--) {
      puddles[i].age += dt;
      if (puddles[i].age >= PUDDLE_LIFE) puddles.splice(i, 1);
    }
  }

  function projXY(x, y, z) {
    var r = Art.project(x, y, z);
    return r;
  }

  function drawPuddles(ctx, G) {
    if (!puddles.length) return;
    ctx.save();
    for (var i = 0; i < puddles.length; i++) {
      var p = puddles[i];
      var a = 1;
      if (p.age > PUDDLE_LIFE - 30) a = (PUDDLE_LIFE - p.age) / 30;
      if (a <= 0) continue;
      var pr = projXY(p.x, p.y, 0);
      if (!onScreen(G, pr.x, pr.y, 200)) continue;
      var S = Art.camera.S;
      var sz = p.size * 32 * S * 2;
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(pr.x, pr.y);
      ctx.rotate(p.rot);
      ctx.drawImage(puddleSprs[p.spr], -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawGlows(ctx, G, night, fireAlphaMul) {
    var sources = collectSources(G);
    var wind = getWind(G);
    var time = (G && G.time) ? G.time : 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var pr = projXY(s.x, s.y, 0);
      if (!onScreen(G, pr.x, pr.y, 400)) continue;
      var phase = i * 1.7;
      var flick = 0.85 + 0.15 * Math.sin(time * 7 + phase) + 0.08 * Math.sin(time * 13.3 + phase * 2);
      var radTiles = night ? 3.2 : 2.4;
      var S = Art.camera.S;
      var rad = radTiles * 32 * S * flick;
      var baseA = night ? 0.9 : 0.5;
      if (fireAlphaMul) baseA *= fireAlphaMul;
      var a = baseA * flick;
      if (a > 1) a = 1;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(glowSpr, pr.x - rad, pr.y - rad, rad * 2, rad * 2);

      // embers
      if (!night) {
        var nEmb = 3 + (i % 4);
        ctx.fillStyle = "rgba(255,180,60,1)";
        for (var e = 0; e < nEmb; e++) {
          var ph = (time * 0.9 + e * 0.37 + i * 0.13) % 1;
          var ex = s.x + Math.sin(time * 1.3 + e + i) * 0.35 + wind.x * ph * 0.5;
          var ey = s.y + Math.cos(time * 1.1 + e * 1.7) * 0.3 + wind.y * ph * 0.5;
          var ez = 0.5 + ph * 2.2;
          var ep = projXY(ex, ey, ez);
          var ea = (1 - ph) * 0.9;
          if (ea <= 0.02) continue;
          ctx.globalAlpha = ea;
          var es = Math.max(1, 2.2 * Art.camera.S);
          ctx.fillRect(ep.x - es / 2, ep.y - es / 2, es, es);
        }
      }
    }
    ctx.restore();
  }

  function draw(ctx, G) {
    if (!glowSpr) ensureSprites();
    if (!G) return;
    var dark = 0;
    if (typeof NIGHT !== "undefined" && NIGHT && NIGHT.darkness) {
      dark = NIGHT.darkness(G) || 0;
    }
    var night = dark > 0.15;
    drawPuddles(ctx, G);
    drawSmoke(ctx, G);
    drawGlows(ctx, G, night, 0);
  }

  function drawSmoke(ctx, G) {
    if (!smokeCount && smokePool.length === 0) return;
    var list = [];
    var i;
    for (i = 0; i < SMOKE_MAX; i++) {
      var p = smokePool[i];
      if (p.active && p.alpha > 0.02) list.push(p);
    }
    if (!list.length) return;
    // older first
    list.sort(function (a, b) { return b.age - a.age; });
    ctx.save();
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      var pr = projXY(q.x, q.y, q.z);
      if (!onScreen(G, pr.x, pr.y, 400)) continue;
      var S = Art.camera.S;
      var rad = q.r * 32 * S;
      var a = q.alpha * (q.dark ? 0.85 : 0.6);
      if (a > 1) a = 1;
      ctx.globalAlpha = a;
      ctx.drawImage(smokeSpr, pr.x - rad, pr.y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  function drawNight(ctx, G) {
    if (!glowSpr) ensureSprites();
    if (!G) return;
    var dark = 0;
    if (typeof NIGHT !== "undefined" && NIGHT && NIGHT.darkness) {
      dark = NIGHT.darkness(G) || 0;
    }
    if (dark <= 0.15) return;
    var strength = dark / 0.6;
    if (strength > 1) strength = 1;
    var time = G.time || 0;

    // headlights
    if (G.vehicles && G.vehicles.length) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var S = Art.camera.S;
      for (var i = 0; i < G.vehicles.length; i++) {
        var v = G.vehicles[i];
        var pr = projXY(v.x, v.y, 0);
        if (!onScreen(G, pr.x, pr.y, 600)) continue;
        var len = 4 * 32 * S;
        var wid = 2 * 32 * S;
        var a = 0.7 * strength;
        if (a <= 0.02) continue;
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(v.ang + Math.PI / 2);
        ctx.globalAlpha = a;
        // cone sprite: tip at bottom center, pointing up
        ctx.drawImage(coneSpr, -wid / 2, -len, wid, len);
        ctx.restore();
      }
      ctx.restore();
    }

    // police flashes
    if (G.vehicles && G.vehicles.length) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var S2 = Art.camera.S;
      var phase = Math.floor(time / 0.25) % 2;
      for (var k = 0; k < G.vehicles.length; k++) {
        var veh = G.vehicles[k];
        var t = veh.type;
        var isPolice = (t === "car" || t === "van" || t === "truck" ||
                        t === "watertruck" || t === "barriertruck" || t === "ambulance");
        if (!isPolice) continue;
        var pv = projXY(veh.x, veh.y, 0);
        if (!onScreen(G, pv.x, pv.y, 400)) continue;
        var radP = 1.6 * 32 * S2;
        var ap = 0.55 * strength;
        if (ap <= 0.02) continue;
        var cosA = Math.cos(veh.ang);
        var sinA = Math.sin(veh.ang);
        var off = 0.5 * 32 * S2;
        // side vector perpendicular to heading
        var sx = -sinA * off;
        var sy = cosA * off;
        var leftCol = (phase === 0) ? blueSpr : redSpr;
        var rightCol = (phase === 0) ? redSpr : blueSpr;
        ctx.globalAlpha = ap;
        ctx.drawImage(leftCol, pv.x + sx - radP, pv.y + sy - radP, radP * 2, radP * 2);
        ctx.drawImage(rightCol, pv.x - sx - radP, pv.y - sy - radP, radP * 2, radP * 2);
      }
      ctx.restore();
    }

    // fire glow at night
    drawGlows(ctx, G, true, 0.6 * strength);
  }

  return { init: init, update: update, draw: draw, drawNight: drawNight };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ATMO;
