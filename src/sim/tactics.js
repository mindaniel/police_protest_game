var TACT = (function () {
  var C = function () { return CONFIG; };
  var kettleObj = null;       // active kettle
  var snatchRuns = [];        // active snatch runs
  var lastG = null;
  var nextId = 1;

  function init(G) {
    kettleObj = null;
    snatchRuns = [];
    nextId = 1;
    lastG = G || null;
  }

  function ensure(G) {
    if (G !== lastG) init(G);
  }

  function counter(G, key, add) {
    if (!G.stats) G.stats = {};
    if (typeof G.stats[key] !== "number") G.stats[key] = 0;
    G.stats[key] += add;
  }

  function isFoot(o) {
    if (o.escorting) return false;
    if (o.baseSpeed >= CONFIG.motorbikeSpeed) return false;
    return true;
  }

  function dist2(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  function squadOfficers(G, s) {
    var out = [], i, o;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o.squad === s) out.push(o);
    }
    return out;
  }

  function firstSquadOfficer(G, s) {
    var list = squadOfficers(G, s);
    return list.length ? list[0] : null;
  }

  /* ---------------- Kettling ---------------- */

  function kettle(G, x, y) {
    ensure(G);
    if (kettleObj) { release(G); return "released"; }
    var Cfg = C();
    var range = Cfg.kettleRange || 12;
    var R = Cfg.kettleRadius || 3.5;
    var r2 = range * range;
    // gather squads with >=3 foot officers near (x,y)
    var counts = {}, quals = [], i, o, d2;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (!isFoot(o)) continue;
      d2 = dist2(o.x, o.y, x, y);
      if (d2 > r2) continue;
      if (typeof o.squad !== "number") continue;
      if (!counts[o.squad]) counts[o.squad] = 0;
      counts[o.squad]++;
    }
    for (var s in counts) {
      if (counts[s] >= 3) quals.push(parseInt(s, 10));
    }
    if (quals.length < 2) return "few";

    // participating officers
    var offs = [];
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (!isFoot(o)) continue;
      if (quals.indexOf(o.squad) < 0) continue;
      offs.push(o);
    }
    if (offs.length < 4) return "few";

    // order by current angle
    var arr = [];
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      arr.push({ o: o, a: Math.atan2(o.y - y, o.x - x) });
    }
    arr.sort(function (p, q) { return p.a - q.a; });

    var n = arr.length;
    var slot = 0;
    var offsSorted = [];
    for (i = 0; i < n; i++) {
      o = arr[i].o;
      var ang = (i / n) * Math.PI * 2;
      var sx = x + Math.cos(ang) * R;
      var sy = y + Math.sin(ang) * R;
      // a slot inside a building slides in along the radius to the first open spot
      for (var tries = 1; tries <= 14 && Crowd.collides(G, sx, sy); tries++) {
        sx = x + Math.cos(ang) * R * (1 - tries / 14);
        sy = y + Math.sin(ang) * R * (1 - tries / 14);
      }
      o.kettleX = sx;
      o.kettleY = sy;
      offsSorted.push(o);
    }
    // set firm stance
    for (i = 0; i < quals.length; i++) Police.setStance(G, quals[i], "firm");

    var k = {
      id: nextId++,
      x: x, y: y, R: R,
      officers: offsSorted,
      squads: quals,
      closed: false,
      t: 0
    };
    kettleObj = k;
    return "ok";
  }

  function release(G, reason) {
    if (!kettleObj) return false;
    var k = kettleObj;
    var i, o, a;
    for (i = 0; i < k.officers.length; i++) {
      o = k.officers[i];
      o.kettleX = null;
      o.kettleY = null;
    }
    if (G && G.agents) {
      for (i = 0; i < G.agents.length; i++) {
        a = G.agents[i];
        if (a._kettled === k.id) a._kettled = null;
      }
    }
    kettleObj = null;
    if (G) G.log(reason || "Kettle released");
    return true;
  }

  function kettleClose(G, k) {
    var inside = 0, i, a;
    var ri = k.R - 0.3;
    var ri2 = ri * ri;
    var list = Crowd.neighbors(G, k.x, k.y, k.R + 1.5);
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || a.active === false) continue;
      if (dist2(a.x, a.y, k.x, k.y) <= ri2) {
        a._kettled = k.id;
        inside++;
      }
    }
    k.closed = true;
    counter(G, "kettles", 1);
    counter(G, "kettledPeople", inside);
    G.log("Kettle closed: " + inside + " people inside");
  }

  function kettleUpdate(G, dt) {
    var k = kettleObj;
    if (!k) return;
    var Cfg = C();
    var maxSec = Cfg.kettleMaxSeconds || 60;
    k.t += dt;

    // count remaining assigned officers
    var assigned = 0, i, o;
    for (i = 0; i < k.officers.length; i++) {
      o = k.officers[i];
      if (o.kettleX != null && o.kettleY != null) assigned++;
    }
    if (assigned < 4) { release(G); return; }
    if (k.t >= maxSec) { release(G, "Kettle released (time limit)"); return; }

    if (!k.closed) {
      var near = 0;
      for (i = 0; i < k.officers.length; i++) {
        o = k.officers[i];
        if (o.kettleX == null) continue;
        if (dist2(o.x, o.y, o.kettleX, o.kettleY) <= 0.8 * 0.8) near++;
      }
      if (near >= 0.7 * k.officers.length) kettleClose(G, k);
    }

    if (k.closed) {
      var innerR = k.R - 0.4;
      var outerR = k.R + 0.3;
      var list = Crowd.neighbors(G, k.x, k.y, k.R + 1.5);
      var j, a, dx, dy, d, nx, ny;
      for (j = 0; j < list.length; j++) {
        a = list[j];
        if (!a || a.active === false) continue;
        dx = a.x - k.x; dy = a.y - k.y;
        d = Math.sqrt(dx * dx + dy * dy);
        if (a._kettled === k.id) {
          if (d > innerR) {
            if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
            nx = k.x + (dx / d) * innerR;
            ny = k.y + (dy / d) * innerR;
            if (!Crowd.collides(G, nx, ny)) { a.x = nx; a.y = ny; }
          }
          a.mood = Math.min(100, (a.mood || 0) + 1.2 * dt);
        } else {
          if (d < outerR) {
            if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
            nx = k.x + (dx / d) * outerR;
            ny = k.y + (dy / d) * outerR;
            if (!Crowd.collides(G, nx, ny)) { a.x = nx; a.y = ny; }
          }
        }
      }
    }
  }

  /* ---------------- Snatch ---------------- */

  function snatch(G, s, agent) {
    ensure(G);
    if (!agent || agent.active === false) return "none";
    var list = squadOfficers(G, s);
    var free = [], i, o;
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (!isFoot(o)) continue;
      if (o.snatch) continue;
      free.push(o);
    }
    // busy?
    for (i = 0; i < snatchRuns.length; i++) {
      if (snatchRuns[i].s === s) return "busy";
    }
    if (free.length < 2) return "none";
    var first = list[0];
    var range = C().snatchRange || 10;
    if (first && dist2(first.x, first.y, agent.x, agent.y) > range * range) return "far";

    // pick 2 closest to agent
    free.sort(function (p, q) {
      return dist2(p.x, p.y, agent.x, agent.y) - dist2(q.x, q.y, agent.x, agent.y);
    });
    var o1 = free[0], o2 = free[1];
    var run = {
      id: nextId++,
      s: s,
      target: agent,
      phase: "dash",
      t: 0,
      officers: [o1, o2]
    };
    o1.snatch = run;
    o2.snatch = run;
    snatchRuns.push(run);
    return "ok";
  }

  function moveToward(G, o, tx, ty, speed, dt) {
    var dx = tx - o.x, dy = ty - o.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return;
    var step = speed * dt;
    if (step > d) step = d;
    var ux = dx / d, uy = dy / d;
    var nx = o.x + ux * step;
    var ny = o.y + uy * step;
    // axis separated
    if (!Crowd.collides(G, nx, o.y, 0.2)) o.x = nx;
    if (!Crowd.collides(G, o.x, ny, 0.2)) o.y = ny;
  }

  function removeRun(run) {
    var i;
    for (i = 0; i < run.officers.length; i++) {
      run.officers[i].snatch = null;
    }
    for (i = 0; i < snatchRuns.length; i++) {
      if (snatchRuns[i] === run) { snatchRuns.splice(i, 1); break; }
    }
  }

  function riskCheck(G, run) {
    var o1 = run.officers[0];
    var list = Crowd.neighbors(G, o1.x, o1.y, 2);
    var n = 0, i, a;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || a.active === false) continue;
      if ((a.mood || 0) >= 60) n++;
    }
    return n >= 7;
  }

  function snatchUpdate(G, dt) {
    var Cfg = C();
    var dashSpeed = Cfg.snatchSpeed || 3.2;
    var retSpeed = 1.8;
    var grabSec = Cfg.snatchGrabSeconds || 0.8;
    var i, j, run, o, tgt, o1, o2;

    for (i = snatchRuns.length - 1; i >= 0; i--) {
      run = snatchRuns[i];
      o1 = run.officers[0];
      o2 = run.officers[1];
      tgt = run.target;

      if (run.phase === "dash" || run.phase === "grab") {
        if (riskCheck(G, run)) {
          o1.stunUntil = G.time + 2;
          o2.stunUntil = G.time + 2;
          run.phase = "return";
          G.log("Snatch squad " + (run.s + 1) + " was pushed back by the crowd");
          counter(G, "snatchFailed", 1);
          run.t = 0;
          continue;
        }
      }

      if (run.phase === "dash") {
        run.t += dt;
        if (!tgt || tgt.active === false) {
          run.phase = "return";
          run.t = 0;
          continue;
        }
        // side by side: perpendicular offset
        var dx = tgt.x - o1.x, dy = tgt.y - o1.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < 1e-6) { dx = 1; dy = 0; dd = 1; }
        var px = -dy / dd * 0.5, py = dx / dd * 0.5;
        moveToward(G, o1, tgt.x - px, tgt.y - py, dashSpeed, dt);
        moveToward(G, o2, tgt.x + px, tgt.y + py, dashSpeed, dt);
        if (dist2(o1.x, o1.y, tgt.x, tgt.y) <= 0.7 * 0.7 ||
            dist2(o2.x, o2.y, tgt.x, tgt.y) <= 0.7 * 0.7) {
          run.phase = "grab";
          run.t = 0;
        }
      } else if (run.phase === "grab") {
        run.t += dt;
        if (run.t >= grabSec) {
          if (tgt && tgt.active !== false) {
            /* end the run first so the nearest snatcher can take the escort */
            removeRun(run);
            if (Crowd.arrest(G, tgt)) {
              Police.startEscort(G, tgt, run.s);
              counter(G, "snatches", 1);
              G.log("Snatch squad " + (run.s + 1) + " made an arrest");
            }
            continue;
          }
          run.phase = "return";
          run.t = 0;
        }
      } else if (run.phase === "return") {
        run.t += dt;
        var home = firstSquadOfficer(G, run.s);
        var hx, hy;
        if (home && !home.snatch) { hx = home.x; hy = home.y; }
        else if (home) { hx = home.homeX != null ? home.homeX : home.x; hy = home.homeY != null ? home.homeY : home.y; }
        else { hx = o1.homeX != null ? o1.homeX : o1.x; hy = o1.homeY != null ? o1.homeY : o1.y; }

        moveToward(G, o1, hx, hy, retSpeed, dt);
        moveToward(G, o2, hx, hy, retSpeed, dt);

        var near1 = dist2(o1.x, o1.y, hx, hy) <= 1;
        var near2 = dist2(o2.x, o2.y, hx, hy) <= 1;
        if ((near1 && near2) || run.t >= 15) {
          removeRun(run);
        }
      }
    }
  }

  /* ---------------- Update / Draw ---------------- */

  function update(G, dt) {
    ensure(G);
    if (dt > 0.05) dt = 0.05;
    kettleUpdate(G, dt);
    snatchUpdate(G, dt);
  }

  function draw(ctx, G) {
    if (!G) return;
    ensure(G);
    var S = Art.camera.S;
    var tilePx = 32 * S;
    var i, k, run, o, p, p2, tp;

    // kettle
    if (kettleObj) {
      k = kettleObj;
      p = Art.project(k.x, k.y, 0);
      p2 = Art.project(k.x + k.R, k.y, 0);
      var rpx = Math.abs(p2.x - p.x);
      ctx.save();
      ctx.strokeStyle = "#2f6fd6";
      if (k.closed) {
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rpx, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.lineWidth = 1.5 * S;
        ctx.setLineDash([6 * S, 6 * S]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, rpx, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // snatch
    for (i = 0; i < snatchRuns.length; i++) {
      run = snatchRuns[i];
      o = run.officers[0];
      var tgt = run.target;
      if (!tgt) continue;
      tp = Art.project(tgt.x, tgt.y, 0);
      if (run.phase === "dash") {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1 * S;
        ctx.setLineDash([4 * S, 4 * S]);
        for (var j = 0; j < run.officers.length; j++) {
          var oo = run.officers[j];
          var op = Art.project(oo.x, oo.y, 0);
          ctx.beginPath();
          ctx.moveTo(op.x, op.y);
          ctx.lineTo(tp.x, tp.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      // pulsing ring
      var pulse = 0.6 + 0.4 * Math.abs(Math.sin(G.time * 4));
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255," + (0.5 + 0.4 * pulse) + ")";
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 0.5 * tilePx * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (run.phase === "grab") {
        var grabSec = C().snatchGrabSeconds || 0.8;
        var frac = Math.min(1, run.t / grabSec);
        ctx.save();
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y - 0.9 * tilePx, 0.35 * tilePx,
                -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // preview
    if (TACT.preview) {
      var pv = TACT.preview;
      ctx.save();
      ctx.strokeStyle = "rgba(47,111,214,0.45)";
      ctx.lineWidth = 1 * S;
      ctx.setLineDash([5 * S, 5 * S]);
      if (pv.mode === "kettle") {
        var R = C().kettleRadius || 3.5;
        var cpp = Art.project(pv.x, pv.y, 0);
        var cpp2 = Art.project(pv.x + R, pv.y, 0);
        var rr = Math.abs(cpp2.x - cpp.x);
        ctx.beginPath();
        ctx.arc(cpp.x, cpp.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      } else if (pv.mode === "snatch") {
        var first = firstSquadOfficer(G, pv.s);
        if (first) {
          var range = C().snatchRange || 10;
          var fp = Art.project(first.x, first.y, 0);
          var fp2 = Art.project(first.x + range, first.y, 0);
          var fr = Math.abs(fp2.x - fp.x);
          ctx.beginPath();
          ctx.arc(fp.x, fp.y, fr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  var api = {
    init: init,
    update: update,
    draw: draw,
    kettle: kettle,
    release: release,
    snatch: snatch,
    kettleActive: function () { return !!kettleObj; },
    preview: null
  };
  return api;
})();

if (typeof module !== "undefined" && module.exports) module.exports = TACT;
