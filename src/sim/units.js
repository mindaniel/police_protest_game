var UNITS = (function () {
  var lastG = null;
  var drone = null;
  var lastPanicLog = -999;
  var mountedSquads = {};

  function init(G) {
    lastG = G;
    drone = {
      state: "ready",       // ready | out | hover | back | cooldown
      x: 0, y: 0,           // tile pos
      tx: 0, ty: 0,         // target
      ox: 0, oy: 0,         // origin/return point
      hoverT: 0,
      cdT: 0,
      obsT: 0,
      phase: 0
    };
    mountedSquads = {};
    lastPanicLog = -999;
  }

  function ensureG(G) {
    if (lastG !== G) init(G);
  }

  function edgePoint(G, x, y) {
    var w = MAP.width, h = MAP.height;
    var dl = x, dr = w - x, dt = y, db = h - y;
    var m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: 0, y: y };
    if (m === dr) return { x: w, y: y };
    if (m === dt) return { x: x, y: 0 };
    return { x: x, y: h };
  }

  function droneTo(G, x, y) {
    ensureG(G);
    var C = CONFIG;
    var cd = C.droneCooldown || 45;
    if (drone.state === "cooldown") {
      if (drone.cdT < cd) return "cooldown";
      drone.state = "ready";
    }
    if (drone.state === "ready") {
      drone.ox = x; drone.oy = y;
      var e = edgePoint(G, x, y);
      drone.x = e.x; drone.y = e.y;
      drone.tx = x; drone.ty = y;
      drone.state = "out";
      drone.obsT = 0;
      drone.hoverT = 0;
      if (G.stats.droneFlights === undefined) G.stats.droneFlights = 0;
      G.stats.droneFlights += 1;
      if (G.log) G.log("Drone launched");
      return "ok";
    }
    drone.tx = x; drone.ty = y;
    drone.ox = x; drone.oy = y;
    return "ok";
  }

  function droneState(G) {
    ensureG(G);
    var C = CONFIG;
    var cd = C.droneCooldown || 45;
    var hs = C.droneSeconds || 30;
    if (drone.state === "ready") return { state: "ready", left: 0 };
    if (drone.state === "out") return { state: "out", left: hs };
    if (drone.state === "hover") return { state: "hover", left: Math.max(0, hs - drone.hoverT) };
    if (drone.state === "back") return { state: "back", left: 0 };
    return { state: "cooldown", left: Math.max(0, cd - drone.cdT) };
  }

  function updateDrone(G, dt) {
    var C = CONFIG;
    var hs = C.droneSeconds || 30;
    var cd = C.droneCooldown || 45;
    var spd = 6 * dt;
    var d = drone;

    if (d.state === "out") {
      var dx = d.tx - d.x, dy = d.ty - d.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= spd) { d.x = d.tx; d.y = d.ty; d.state = "hover"; d.hoverT = 0; d.obsT = 0; }
      else { d.x += dx / dist * spd; d.y += dy / dist * spd; }
    } else if (d.state === "hover") {
      d.hoverT += dt;
      d.phase += dt;
      d.obsT += dt;
      var cx = d.tx + Math.cos(d.phase * 1.1) * 0.6;
      var cy = d.ty + Math.sin(d.phase * 1.1) * 0.6;
      d.x = cx; d.y = cy;
      if (d.obsT >= 0.2) {
        d.obsT -= 0.2;
        observe(G, cx, cy);
      }
      if (d.hoverT >= hs) {
        var e = edgePoint(G, d.tx, d.ty);
        d.ox = e.x; d.oy = e.y;
        d.state = "back";
        if (G.log) G.log("Drone returning");
      }
    } else if (d.state === "back") {
      var bx = d.ox - d.x, by = d.oy - d.y;
      var bd = Math.sqrt(bx * bx + by * by);
      if (bd <= spd) { d.x = d.ox; d.y = d.oy; d.state = "cooldown"; d.cdT = 0; }
      else { d.x += bx / bd * spd; d.y += by / bd * spd; }
    } else if (d.state === "cooldown") {
      d.cdT += dt;
      if (d.cdT >= cd) { d.state = "ready"; d.cdT = 0; }
    }
  }

  function observe(G, cx, cy) {
    var C = CONFIG;
    var R = C.droneRadius || 9;
    var list = Crowd.neighbors(G, cx, cy, R);
    var i, a;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a.active) continue;
      if (typeof FX !== "undefined" && FX.smokeAt(G, a.x, a.y) >= 0.5) continue;
      if (typeof GAS !== "undefined" && GAS.densityAt(G, a.x, a.y) >= 0.5) continue;
      if (a.hasTool || a.revealedUntil > G.time || a.violentUntil > G.time) {
        a.suspicion += 12 * 0.2;
        if (a.suspicion > 100) a.suspicion = 100;
        a._droneSeenAt = G.time;
      }
      a.mood += 0.2 * 0.2;
      if (a.mood > 100) a.mood = 100;
    }
  }

  // ---- Mounted police ----

  function isMounted(G, s) {
    if (mountedSquads[s] !== undefined) return mountedSquads[s];
    var r = false;
    if (typeof Police !== "undefined" && Police.getLoadout) {
      r = Police.getLoadout(G, s) === "mounted";
    }
    mountedSquads[s] = r;
    return r;
  }

  function updateMounted(G, dt) {
    mountedSquads = {};
    var offs = G.officers;
    var i, j, o;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!isMounted(G, o.squad)) continue;
      if (o.panicUntil !== undefined && o.panicUntil > G.time) continue;

      // Panic triggers
      var causeX = 0, causeY = 0, cause = false;
      if (typeof GAS !== "undefined" && GAS.densityAt && GAS.densityAt(G, o.x, o.y) >= 0.25) {
        cause = true;
      }
      if (!cause && G.fireBlocked) {
        var fx = Math.floor(o.x), fy = Math.floor(o.y);
        for (var ax = -3; ax <= 3 && !cause; ax++) {
          for (var ay = -3; ay <= 3; ay++) {
            if (G.fireBlocked.has((fx + ax) + "," + (fy + ay))) { cause = true; break; }
          }
        }
      }
      if (!cause && o.stunUntil !== undefined && o.stunUntil > G.time && o._panicHit !== G.time) {
        cause = true;
        o._panicHit = G.time;
      }
      if (cause) {
        o.panicUntil = G.time + 3;
        if (o._panicAng === undefined || G.time - (o._panicSet || -99) > 0.2) {
          o._panicAng = Math.random() * Math.PI * 2;
          o._panicSet = G.time;
        }
        if (G.time - lastPanicLog > 5) {
          lastPanicLog = G.time;
          if (G.log) G.log("A police horse panicked");
        }
        if (G.stats.horsePanics === undefined) G.stats.horsePanics = 0;
        G.stats.horsePanics += 1;
      }

      if (o.panicUntil !== undefined && o.panicUntil > G.time) {
        // Bolt
        var bspd = 2.5 * dt;
        var bx = Math.cos(o._panicAng || 0) * bspd;
        var by = Math.sin(o._panicAng || 0) * bspd;
        if (!Crowd.collides(G, o.x + bx, o.y)) o.x += bx;
        else if (!Crowd.collides(G, o.x, o.y + by)) o.y += by;
        else o._panicAng += Math.PI / 2;
        continue;
      }

      // Push crowd
      var firm = o.stance === "firm";
      var base = 2.2 * (firm ? 1.4 : 1);
      var list = Crowd.neighbors(G, o.x, o.y, 1.3);
      for (j = 0; j < list.length; j++) {
        var a = list[j];
        if (!a.active) continue;
        var dx = a.x - o.x, dy = a.y - o.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 0.0001) { dx = 1; dy = 0; d2 = 1; }
        var dist = Math.sqrt(d2);
        if (dist > 1.3) continue;
        var strength = base * (1 - dist / 1.3);
        var px = dx / dist * strength * dt;
        var py = dy / dist * strength * dt;
        var nx = a.x + px, ny = a.y + py;
        if (!Crowd.collides(G, nx, a.y)) a.x = nx;
        if (!Crowd.collides(G, a.x, ny)) a.y = ny;
        a.mood += 0.5 * dt;
        if (a.mood > 100) a.mood = 100;
      }
    }
  }

  function update(G, dt) {
    ensureG(G);
    updateDrone(G, dt);
    updateMounted(G, dt);
  }

  // ---- Drawing ----

  function drawHorse(ctx, x, y, ang, S, t, panic) {
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var shx = 0, shy = 0;
    if (panic) { shx = Math.sin(t * 40) * S; shy = Math.cos(t * 37) * S; }
    function P(fx, fy) {
      return { x: x + (ca * fx - sa * fy) * S + shx, y: y + (sa * fx + ca * fy) * S + shy };
    }
    // legs
    var legPh = Math.sin(t * 8) * 0.6;
    ctx.strokeStyle = "#5a3520";
    ctx.lineWidth = Math.max(1, 1.2 * S);
    var l1 = P(4, 2.2), l2 = P(4, -2.2), l3 = P(-4, 2.2), l4 = P(-4, -2.2);
    ctx.beginPath();
    ctx.moveTo(l1.x, l1.y); ctx.lineTo(l1.x + legPh * S, l1.y + 3 * S);
    ctx.moveTo(l2.x, l2.y); ctx.lineTo(l2.x - legPh * S, l2.y + 3 * S);
    ctx.moveTo(l3.x, l3.y); ctx.lineTo(l3.x - legPh * S, l3.y + 3 * S);
    ctx.moveTo(l4.x, l4.y); ctx.lineTo(l4.x + legPh * S, l4.y + 3 * S);
    ctx.stroke();
    // tail
    var tl = P(-7, 0);
    ctx.strokeStyle = "#4a2a14";
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tl.x - ca * 3 * S + Math.sin(t * 3) * S, tl.y - 2 * S);
    ctx.stroke();
    // body
    var b0 = P(-7, -2.5), b1 = P(7, -2.5), b2 = P(7, 2.5), b3 = P(-7, 2.5);
    ctx.fillStyle = "#7a4a2a";
    ctx.beginPath();
    ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y); ctx.lineTo(b3.x, b3.y);
    ctx.closePath();
    ctx.fill();
    // mane
    var m0 = P(4, 0), m1 = P(7, 0);
    ctx.strokeStyle = "#3a2010";
    ctx.lineWidth = Math.max(1, 1.5 * S);
    ctx.beginPath();
    ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y);
    ctx.stroke();
    // saddle cloth
    var s0 = P(-2, -2), s1 = P(2, -2), s2 = P(2, 2), s3 = P(-2, 2);
    ctx.fillStyle = "#2f6fd6";
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y); ctx.lineTo(s3.x, s3.y);
    ctx.closePath();
    ctx.fill();
    // neck + head
    var hh = panic ? 5 : 3;
    var n0 = P(6, -1.5), n1 = P(6, 1.5);
    var hd = P(9, 0);
    ctx.fillStyle = "#7a4a2a";
    ctx.beginPath();
    ctx.moveTo(n0.x, n0.y - hh * S * 0.3);
    ctx.lineTo(hd.x, hd.y - hh * S);
    ctx.lineTo(hd.x, hd.y - hh * S + 3 * S);
    ctx.lineTo(n1.x, n1.y - hh * S * 0.3);
    ctx.closePath();
    ctx.fill();
  }

  function drawDrone(ctx, G, S) {
    var d = drone;
    if (d.state === "ready" || d.state === "cooldown") return;
    var C = CONFIG;
    var R = C.droneRadius || 9;
    var ground = Art.project(d.x, d.y, 0);
    var air = Art.project(d.x, d.y, 4);
    var size = 16 * S;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, size * 0.5, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // hover ring
    if (d.state === "hover") {
      var g = Art.project(d.tx, d.ty, 0);
      var rpx = R * 32 * S;
      ctx.strokeStyle = "rgba(80,160,255,0.25)";
      ctx.lineWidth = Math.max(1, S);
      ctx.setLineDash([6 * S, 6 * S]);
      ctx.beginPath();
      ctx.arc(g.x, g.y, rpx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // light cone
      ctx.fillStyle = "rgba(255,255,180,0.06)";
      ctx.beginPath();
      ctx.moveTo(air.x, air.y);
      ctx.lineTo(g.x - rpx * 0.5, g.y);
      ctx.lineTo(g.x + rpx * 0.5, g.y);
      ctx.closePath();
      ctx.fill();
    }

    // rotors
    ctx.fillStyle = "rgba(180,180,180,0.35)";
    var rot = Math.sin(d.phase * 30) * 0.5 + 1;
    var arms = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (var i = 0; i < 4; i++) {
      var ax = air.x + arms[i][0] * size * 0.5;
      var ay = air.y + arms[i][1] * size * 0.5;
      ctx.beginPath();
      ctx.ellipse(ax, ay, size * 0.35 * rot, size * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // X frame
    ctx.strokeStyle = "#333";
    ctx.lineWidth = Math.max(1, 1.2 * S);
    ctx.beginPath();
    ctx.moveTo(air.x - size * 0.5, air.y - size * 0.5);
    ctx.lineTo(air.x + size * 0.5, air.y + size * 0.5);
    ctx.moveTo(air.x + size * 0.5, air.y - size * 0.5);
    ctx.lineTo(air.x - size * 0.5, air.y + size * 0.5);
    ctx.stroke();
    // body
    ctx.fillStyle = "#444";
    ctx.beginPath();
    ctx.ellipse(air.x, air.y, size * 0.25, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // lights
    var blink = (Math.floor(G.time * 4) % 2) === 0;
    ctx.fillStyle = blink ? "#ff2020" : "#20ff20";
    ctx.beginPath();
    ctx.arc(air.x - size * 0.15, air.y - size * 0.15, Math.max(1, 1.5 * S), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = blink ? "#20ff20" : "#ff2020";
    ctx.beginPath();
    ctx.arc(air.x + size * 0.15, air.y - size * 0.15, Math.max(1, 1.5 * S), 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(ctx, G) {
    ensureG(G);
    var S = Art.camera.S;
    drawDrone(ctx, G, S);
  }

  return {
    init: init,
    update: update,
    draw: draw,
    droneTo: droneTo,
    droneState: droneState,
    drawHorse: drawHorse
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = UNITS;
