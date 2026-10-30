// gas.js - Tear gas system for Police vs Protestors. ES5, classic script.
var GAS = (function () {
  var C_DEF = {
    gasPerSquad: 3,
    gasCooldown: 6,
    gasRange: 9,
    gasSeconds: 22
  };

  var api = {
    init: init,
    update: update,
    draw: draw,
    launch: launch,
    stock: stock,
    cooldownLeft: cooldownLeft,
    densityAt: densityAt,
    preview: null
  };

  var lastG = null;
  var stocks = [];
  var cooldowns = [];
  var emitters = [];
  var puffs = [];
  var puffCount = 0;
  var canisters = [];
  var puffPool = [];
  var PUFF_MAX = 500;
  var PUFF_LIFE = 9;
  var PUFF_SPAWN = 0.15;
  var EMIT_RATE = 5; // effects per second
  var emitAcc = 0;
  var grid = {}; // coarse grid key -> array of puff indices
  var gridStamp = 0;
  var tmpAgents = [];
  var tmpSeen = {};

  function cfg(G, k, d) {
    if (typeof CONFIG !== "undefined" && CONFIG && CONFIG[k] !== undefined) return CONFIG[k];
    return d;
  }

  function init(G) {
    lastG = G;
    stocks = [];
    cooldowns = [];
    emitters = [];
    puffs = [];
    puffCount = 0;
    puffPool = [];
    canisters = [];
    emitAcc = 0;
    grid = {};
    gridStamp = 0;
    resetStocks(G);
    if (!G.stats) G.stats = {};
    if (G.stats.gasUsed === undefined) G.stats.gasUsed = 0;
    if (G.stats.gassedPeaceful === undefined) G.stats.gassedPeaceful = 0;
  }

  function resetStocks(G) {
    var s, lo;
    for (s = 0; s < 6; s++) {
      lo = "none";
      try {
        if (typeof Police !== "undefined" && Police && Police.getLoadout) lo = Police.getLoadout(G, s);
      } catch (e) { lo = "none"; }
      if (lo === "car" || lo === "none") stocks[s] = cfg(G, "gasPerSquad", C_DEF.gasPerSquad);
      else if (lo === "motorbike") stocks[s] = 0;
      else stocks[s] = 1;
      cooldowns[s] = 0;
    }
  }

  function ensure(G) {
    if (lastG !== G) init(G);
    else if (!(G.time > 0)) resetStocks(G);   /* planning: loadouts may still change */
  }

  function firstOfficer(G, s) {
    var i, o;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o.squad === s) return o;
    }
    return null;
  }

  function stock(G, s) {
    ensure(G);
    return stocks[s] || 0;
  }

  function cooldownLeft(G, s) {
    ensure(G);
    var c = cooldowns[s] || 0;
    return c > 0 ? c : 0;
  }

  function launch(G, s, x, y) {
    ensure(G);
    if (!stocks[s] || stocks[s] <= 0) return "none";
    if ((cooldowns[s] || 0) > 0) return "cooldown";
    var o = firstOfficer(G, s);
    if (!o) return "none";
    var dx = x - o.x, dy = y - o.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > cfg(G, "gasRange", C_DEF.gasRange)) return "range";
    stocks[s]--;
    cooldowns[s] = cfg(G, "gasCooldown", C_DEF.gasCooldown);
    canisters.push({
      sx: o.x, sy: o.y, tx: x, ty: y,
      t: 0, dur: 0.9,
      trail: []
    });
    G.stats.gasUsed = (G.stats.gasUsed || 0) + 1;
    if (G.log) G.log("Tear gas fired by squad " + (s + 1));
    return "ok";
  }

  function windVec(G) {
    var w = G.wind;
    if (w && (w.x !== 0 || w.y !== 0)) {
      var m = Math.sqrt(w.x * w.x + w.y * w.y);
      if (m > 0.0001) return { x: w.x / m, y: w.y / m };
    }
    var d = Math.sqrt(0.7 * 0.7 + 0.7 * 0.7);
    return { x: 0.7 / d, y: 0.7 / d };
  }

  function newPuff() {
    var p;
    if (puffPool.length) {
      p = puffPool.pop();
    } else {
      p = { x: 0, y: 0, vx: 0, vy: 0, age: 0, r: 0.5, alive: false };
    }
    p.alive = true;
    p.age = 0;
    p.r = 0.5;
    return p;
  }

  function spawnPuff(G, ex, ey, wx, wy) {
    if (puffCount >= PUFF_MAX) return;
    var p = newPuff();
    p.x = ex;
    p.y = ey;
    var spread = 0.6;
    var ang = Math.random() * Math.PI * 2;
    var sp = Math.random() * spread;
    p.vx = wx * 0.5 + Math.cos(ang) * sp;
    p.vy = wy * 0.5 + Math.sin(ang) * sp;
    puffs.push(p);
    puffCount++;
  }

  function tileKey(x, y) {
    return (Math.floor(x) + 1000) * 4096 + (Math.floor(y) + 1000);
  }

  function rebuildGrid() {
    grid = {};
    var i, p, k, arr;
    for (i = 0; i < puffs.length; i++) {
      p = puffs[i];
      if (!p.alive) continue;
      k = tileKey(p.x, p.y);
      arr = grid[k];
      if (!arr) { arr = []; grid[k] = arr; }
      arr.push(p);
    }
  }

  function densityAt(G, x, y) {
    ensure(G);
    if (puffCount === 0) return 0;
    var total = 0;
    var i, p, dx, dy, d, dist, rr;
    var gx = Math.floor(x), gy = Math.floor(y);
    var cx, cy, arr, j;
    for (cx = gx - 3; cx <= gx + 3; cx++) {
      for (cy = gy - 3; cy <= gy + 3; cy++) {
        arr = grid[(cx + 1000) * 4096 + (cy + 1000)];
        if (!arr) continue;
        for (j = 0; j < arr.length; j++) {
          p = arr[j];
          if (!p.alive) continue;
          dx = x - p.x; dy = y - p.y;
          dist = Math.sqrt(dx * dx + dy * dy);
          rr = p.r;
          if (dist >= rr) continue;
          d = 1 - dist / rr;
          if (d < 0) d = 0;
          total += d;
        }
      }
    }
    if (total > 1) total = 1;
    return total;
  }

  function updateGridPositions() {
    // rebuild grid infrequently is fine; do it each update tick
    rebuildGrid();
  }

  function applyGasEffects(G) {
    // union agents from emitters
    tmpAgents.length = 0;
    var seen = {};
    var e, i, j, arr;
    for (e = 0; e < emitters.length; e++) {
      var ex = emitters[e].x, ey = emitters[e].y;
      arr = null;
      try { arr = Crowd.neighbors(G, ex, ey, 7); } catch (er) { arr = null; }
      if (!arr) continue;
      for (i = 0; i < arr.length; i++) {
        var a = arr[i];
        if (!a || !a.active) continue;
        if (seen[a.id]) continue;
        seen[a.id] = true;
        tmpAgents.push(a);
      }
    }
    var k, a, d;
    for (k = 0; k < tmpAgents.length; k++) {
      a = tmpAgents[k];
      if (!a.active) continue;
      d = densityAt(G, a.x, a.y);
      if (d < 0.25) continue;
      // find nearest emitter
      var ne = null, nd = 1e9, ee, dx, dy, dist;
      for (ee = 0; ee < emitters.length; ee++) {
        dx = a.x - emitters[ee].x; dy = a.y - emitters[ee].y;
        dist = dx * dx + dy * dy;
        if (dist < nd) { nd = dist; ne = emitters[ee]; }
      }
      if (ne) {
        dx = a.x - ne.x; dy = a.y - ne.y;
        var m = Math.sqrt(dx * dx + dy * dy);
        if (m < 0.001) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; m = Math.sqrt(dx * dx + dy * dy) || 1; }
        var spd = (1.6 + 1.2 * d) * (1 / 5); // per tick at EMIT_RATE
        var mx = (dx / m) * spd, my = (dy / m) * spd;
        var collides = false;
        try { collides = Crowd.collides(G, a.x + mx, a.y + my); } catch (er2) { collides = false; }
        if (collides) {
          var okx = true, oky = true;
          try { okx = !Crowd.collides(G, a.x + mx, a.y); } catch (er3) { okx = true; }
          try { oky = !Crowd.collides(G, a.x, a.y + my); } catch (er4) { oky = true; }
          if (okx) a.x += mx;
          if (oky) a.y += my;
        } else {
          a.x += mx; a.y += my;
        }
      }
      // mood
      var gassedAt = a._gassedAt;
      var now = G.time;
      var first = (gassedAt === undefined) || (now - gassedAt > 20);
      if (first) {
        a._gassedAt = now;
        a.mood = (a.mood || 0) + 6;
        if (a.role === "peaceful" && !a._gassedPeacefulMark) {
          a._gassedPeacefulMark = true;
          G.stats.gassedPeaceful = (G.stats.gassedPeaceful || 0) + 1;
        }
      }
      a.mood = (a.mood || 0) + 1.5 * (1 / EMIT_RATE);
      if (a.mood > 100) a.mood = 100;
      // rioter attackShop gives up
      if (a.role === "rioter" && a.state === "attackShop") {
        a.state = "flee";
        a._fleeUntil = G.time + 6;
        a._targetShop = null;
        a._flow = G.flow;
      }
    }
    // officers
    var oi, o, od;
    for (oi = 0; oi < G.officers.length; oi++) {
      o = G.officers[oi];
      od = densityAt(G, o.x, o.y);
      if (od >= 0.25) {
        if (o.baseSpeed >= 0 && (!o.baseSpeed || o.baseSpeed < 1e9)) {
          // check motorbike via CONFIG
        }
        var isMoto = false;
        if (typeof CONFIG !== "undefined" && CONFIG && CONFIG.motorbikeSpeed !== undefined) {
          if (o.baseSpeed >= CONFIG.motorbikeSpeed) isMoto = true;
        } else if (o.baseSpeed >= 1e9) {
          isMoto = true;
        }
        if (isMoto) {
          o.stunUntil = G.time + 0.6;
        } else {
          o.gasSlowUntil = G.time + 0.3;
        }
      }
    }
  }

  function update(G, dt) {
    ensure(G);
    if (dt === undefined || dt === null) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    var i, s;
    for (s = 0; s < cooldowns.length; s++) {
      if (cooldowns[s] > 0) cooldowns[s] -= dt;
    }
    var w = windVec(G);
    // canisters in flight
    for (i = canisters.length - 1; i >= 0; i--) {
      var c = canisters[i];
      c.t += dt;
      var tt = c.t / c.dur;
      if (tt > 1) tt = 1;
      c.trail.push({ x: c.sx + (c.tx - c.sx) * tt, y: c.sy + (c.ty - c.sy) * tt, t: c.t });
      if (c.trail.length > 6) c.trail.shift();
      if (c.t >= c.dur) {
        emitters.push({ x: c.tx, y: c.ty, age: 0, spawnAcc: 0 });
        canisters.splice(i, 1);
      }
    }
    // emitters spawn puffs
    var gasSec = cfg(G, "gasSeconds", C_DEF.gasSeconds);
    for (i = emitters.length - 1; i >= 0; i--) {
      var e = emitters[i];
      e.age += dt;
      e.spawnAcc += dt;
      while (e.spawnAcc >= PUFF_SPAWN) {
        e.spawnAcc -= PUFF_SPAWN;
        spawnPuff(G, e.x, e.y, w.x, w.y);
      }
      if (e.age >= gasSec) {
        emitters.splice(i, 1);
      }
    }
    // puffs update
    var pi;
    for (pi = 0; pi < puffs.length; pi++) {
      var p = puffs[pi];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= PUFF_LIFE) {
        p.alive = false;
        puffCount--;
        puffPool.push(p);
        puffs[pi] = null;
        continue;
      }
      // grow
      p.r = 0.5 + (2.6 - 0.5) * (p.age / PUFF_LIFE);
      var nx = p.x + p.vx * dt;
      var ny = p.y + p.vy * dt;
      var cx = false, cy = false;
      try { cx = Crowd.collides(G, nx, p.y); } catch (e1) { cx = false; }
      try { cy = Crowd.collides(G, p.x, ny); } catch (e2) { cy = false; }
      if (!cx) p.x = nx;
      if (!cy) p.y = ny;
    }
    // compact puffs in place (dead slots were set to null)
    var keep = 0;
    for (pi = 0; pi < puffs.length; pi++) if (puffs[pi] && puffs[pi].alive) puffs[keep++] = puffs[pi];
    puffs.length = keep;
    updateGridPositions();
    // effects at EMIT_RATE
    emitAcc += dt;
    var step = 1 / EMIT_RATE;
    while (emitAcc >= step) {
      emitAcc -= step;
      applyGasEffects(G);
    }
  }

  // ---------- draw ----------
  function project(x, y, z) {
    if (typeof Art !== "undefined" && Art && Art.project) return Art.project(x, y, z || 0);
    var S = (typeof Art !== "undefined" && Art.camera && Art.camera.S) ? Art.camera.S : 1;
    return { x: x * 32 * S, y: y * 32 * S - (z || 0) * 12 * S };
  }

  function camS() {
    if (typeof Art !== "undefined" && Art.camera && Art.camera.S) return Art.camera.S;
    return 1;
  }

  function draw(ctx, G) {
    ensure(G);
    var S = camS();
    var i, p, e, pt;
    // puffs
    for (i = 0; i < puffs.length; i++) {
      p = puffs[i];
      if (!p || !p.alive) continue;
      var ageN = p.age / PUFF_LIFE;
      var alpha;
      if (ageN < 0.1) alpha = 0.35 * (ageN / 0.1);
      else if (ageN > 0.6) alpha = 0.35 * (1 - (ageN - 0.6) / 0.4);
      else alpha = 0.35;
      if (alpha < 0) alpha = 0;
      var z = 0.3 + p.age * 0.08;
      pt = project(p.x, p.y, z);
      var rad = p.r * 32 * S * 0.5;
      ctx.beginPath();
      ctx.fillStyle = "rgba(235,235,225," + alpha.toFixed(3) + ")";
      ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // emitters
    for (i = 0; i < emitters.length; i++) {
      e = emitters[i];
      pt = project(e.x, e.y, 0);
      var pulse = 0.5 + 0.5 * Math.sin(G.time * 6 + i);
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255," + (0.4 + 0.4 * pulse).toFixed(3) + ")";
      ctx.arc(pt.x, pt.y - 8 * S, (2 + 3 * pulse) * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "rgba(40,40,40,0.9)";
      ctx.arc(pt.x, pt.y - 2 * S, 2 * S, 0, Math.PI * 2);
      ctx.fill();
    }
    // canisters in flight
    for (i = 0; i < canisters.length; i++) {
      var c = canisters[i];
      var tt = c.t / c.dur;
      if (tt > 1) tt = 1;
      var fx = c.sx + (c.tx - c.sx) * tt;
      var fy = c.sy + (c.ty - c.sy) * tt;
      var hz = 4 * tt * (1 - tt) * 2; // parabola peak 2 at tt=0.5
      // trail
      var ti;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = Math.max(1, S);
      ctx.beginPath();
      for (ti = 0; ti < c.trail.length; ti++) {
        var tp = c.trail[ti];
        var tpt = project(tp.x, tp.y, 0.3);
        if (ti === 0) ctx.moveTo(tpt.x, tpt.y);
        else ctx.lineTo(tpt.x, tpt.y);
      }
      ctx.stroke();
      pt = project(fx, fy, hz);
      ctx.beginPath();
      ctx.fillStyle = "rgba(30,30,30,0.95)";
      ctx.arc(pt.x, pt.y, 2 * S, 0, Math.PI * 2);
      ctx.fill();
    }
    // preview range circle
    var pv = api.preview;
    if (pv) {
      var o = firstOfficer(G, pv.s);
      if (o) {
        var range = cfg(G, "gasRange", C_DEF.gasRange);
        var cc = project(o.x, o.y, 0);
        var rpx = range * 32 * S;
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = Math.max(1, S);
        if (ctx.setLineDash) ctx.setLineDash([4 * S, 4 * S]);
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, rpx, 0, Math.PI * 2);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        // target cross
        var tc = project(pv.x, pv.y, 0);
        ctx.beginPath();
        ctx.moveTo(tc.x - 5 * S, tc.y); ctx.lineTo(tc.x + 5 * S, tc.y);
        ctx.moveTo(tc.x, tc.y - 5 * S); ctx.lineTo(tc.x, tc.y + 5 * S);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  return api;
})();

if (typeof module !== "undefined" && module.exports) module.exports = GAS;
