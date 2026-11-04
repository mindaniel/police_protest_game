var HOLDLINE = (function () {
  var HOLD_AT = 3, RELEASE_AT = 1.8, QUIET_FOR = 4, R = 6, R2 = 36;

  var seen = [], hits = [], squadState = {}, lastTime = -1;

  function reset() { seen = []; hits = []; squadState = {}; lastTime = -1; }

  function center(G, s) {
    var offs = (G && G.officers) || [], i, o, n = 0, x = 0, y = 0;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!o || o.squad !== s) continue;
      x += o.x; y += o.y; n++;
    }
    if (!n) return null;
    return { x: x / n, y: y / n, n: n };
  }

  function squadOfficers(G, s) {
    var offs = (G && G.officers) || [], i, out = [];
    for (i = 0; i < offs.length; i++) if (offs[i] && offs[i].squad === s) out.push(offs[i]);
    return out;
  }

  function setFlags(G, s, v) {
    var list = squadOfficers(G, s), i;
    for (i = 0; i < list.length; i++) list[i].holdLine = v;
  }

  function log(G, msg) { if (G && typeof G.log === "function") G.log(msg); }

  function move(G, s, x, y, run) {
    if (typeof Police !== "undefined" && Police && typeof Police.moveSquad === "function") {
      Police.moveSquad(G, s, x, y, run);
    }
  }

  function computePressure(G, s, c, recentHits) {
    var agents = (G && G.agents) || [], offs = (G && G.officers) || [];
    var i, a, o, dx, dy, rioters = 0, cops = 0, p, tot = 0, n = 0;

    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (!a || !a.active || a.role !== "rioter") continue;
      dx = a.x - c.x; dy = a.y - c.y;
      if (dx * dx + dy * dy <= R2) rioters++;
    }
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!o) continue;
      dx = o.x - c.x; dy = o.y - c.y;
      if (dx * dx + dy * dy <= R2) cops++;
    }
    p = rioters / (cops > 0 ? cops : 1);

    for (i = 0; i < recentHits.length; i++) {
      dx = recentHits[i].x - c.x; dy = recentHits[i].y - c.y;
      if (dx * dx + dy * dy <= R2) p += 0.5;
    }

    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!o || o.squad !== s) continue;
      tot += (typeof o.stamina === "number" ? o.stamina : 100);
      n++;
    }
    if (n > 0 && (tot / n) < 35) p += 1;

    return p;
  }

  function update(G, dt) {
    if (!G || !G.orders || !G.officers) return;
    var i, o, s, r, k, keys = [], q, c, pressure, S, su;

    if (seen.length !== G.officers.length) reset();
    if (typeof G.time === "number") {
      if (G.time < lastTime) reset();
      lastTime = G.time;
    }
    if (typeof dt !== "number" || !isFinite(dt) || dt < 0) dt = 0;

    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (!o) { seen[i] = 0; continue; }
      su = (typeof o.stunUntil === "number") ? o.stunUntil : 0;
      if (su > (seen[i] || 0) && su > (G.time || 0)) {
        hits.push({ x: o.x, y: o.y, t: (G.time || 0) });
      }
      seen[i] = su;
    }

    var keep = [], cutoff = (G.time || 0) - 5;
    for (i = 0; i < hits.length; i++) if (hits[i].t >= cutoff) keep.push(hits[i]);
    hits = keep;

    for (k in G.orders) if (Object.prototype.hasOwnProperty.call(G.orders, k)) keys.push(k);

    for (q = 0; q < keys.length; q++) {
      s = +keys[q];   /* order keys are strings; squads are numbers */
      r = G.orders[s];
      if (!r) continue;

      if (r.order !== "push") {
        if (r.holdLine) { r.holdLine = false; setFlags(G, s, false); }
        if (squadState[s]) { squadState[s].holding = false; squadState[s].quiet = 0; }
        continue;
      }

      c = center(G, s);
      if (!c) continue;

      pressure = computePressure(G, s, c, hits);
      S = squadState[s];
      if (!S) S = squadState[s] = { holding: !!r.holdLine, quiet: 0, pressure: pressure };
      S.pressure = pressure;

      if (S.holding || r.holdLine) {
        S.holding = true;
        if (pressure < RELEASE_AT) S.quiet += dt; else S.quiet = 0;

        if (S.quiet >= QUIET_FOR) {
          S.holding = false;
          S.quiet = 0;
          r.holdLine = false;
          setFlags(G, s, false);
          log(G, "Squad " + (Number(s) + 1) + " resumes the push");
          if (r.holdTarget && typeof r.holdTarget.x === "number" && typeof r.holdTarget.y === "number") {
            move(G, s, r.holdTarget.x, r.holdTarget.y, false);
          }
        } else {
          r.holdLine = true;
          setFlags(G, s, true);
          move(G, s, c.x, c.y, false);
        }
      } else if (pressure >= HOLD_AT) {
        S.holding = true;
        S.quiet = 0;
        r.holdLine = true;
        r.holdTarget = { x: r.targetX, y: r.targetY };
        setFlags(G, s, true);
        move(G, s, c.x, c.y, false);
        log(G, "Squad " + (Number(s) + 1) + " holds the line (outnumbered)");
      }
    }
  }

  function state(G, s) {
    var r = (G && G.orders) ? G.orders[s] : null;
    var S = squadState[s];
    var holding = !!(r && r.holdLine) || !!(S && S.holding);
    var pressure = S ? S.pressure : 0;
    if (!S && r && r.order === "push" && G && G.officers) {
      var c = center(G, s);
      if (c) pressure = computePressure(G, s, c, hits);
    }
    if (typeof pressure !== "number" || !isFinite(pressure)) pressure = 0;
    return { holding: holding, pressure: pressure };
  }

  function draw(ctx, G) {
    if (!ctx || !G || !G.orders) return;
    var keys = [], k, q, s, r, c, sx, sy, p;
    for (k in G.orders) if (Object.prototype.hasOwnProperty.call(G.orders, k)) keys.push(k);

    for (q = 0; q < keys.length; q++) {
      s = +keys[q];   /* order keys are strings; squads are numbers */
      r = G.orders[s];
      if (!r || !r.holdLine) continue;
      c = center(G, s);
      if (!c) continue;

      sx = c.x; sy = c.y;
      if (typeof Art !== "undefined" && Art && typeof Art.project === "function") {
        p = Art.project(c.x, c.y, 2);
        if (p && typeof p.x === "number" && typeof p.y === "number") { sx = p.x; sy = p.y; }
      }

      ctx.save();
      ctx.translate(sx, sy - 14);

      ctx.beginPath();
      ctx.moveTo(-5, -7);
      ctx.lineTo(5, -7);
      ctx.lineTo(5, 0);
      ctx.quadraticCurveTo(5, 5, 0, 8);
      ctx.quadraticCurveTo(-5, 5, -5, 0);
      ctx.closePath();
      ctx.fillStyle = "#1b3f6b";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#dfe8f5";
      ctx.stroke();

      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "#dfe8f5";
      ctx.fillText("HOLD", 0, -9);

      ctx.restore();
    }
  }

  return { update: update, draw: draw, state: state };
})();

if (typeof module !== "undefined" && module.exports) module.exports = HOLDLINE;
