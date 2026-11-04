/* parked.js - real parked cars: they block people, rioters smash, flip and burn them (DeepSeek) */
var PARKED = (function () {
  var cars = [], cells = {}, sprites = {};
  var COLS = ["#9b5a4f", "#4f6f93", "#d2ccbc", "#6d8a5f", "#3d4246"];

  function hash2(a, b) {
    var h = (a | 0) * 73856093 ^ (b | 0) * 19349663;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function addCar(px, py, ang, seed) {
    var c = { x: px, y: py, ang: ang, hl: 0.69, hw: 0.31, col: COLS[seed % 5], hp: 100, state: "ok" };
    cars.push(c);
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var ex = Math.abs(ca) * c.hl + Math.abs(sa) * c.hw + 0.32;
    var ey = Math.abs(sa) * c.hl + Math.abs(ca) * c.hw + 0.32;
    for (var yy = Math.floor(py - ey); yy <= Math.floor(py + ey); yy++)
      for (var xx = Math.floor(px - ex); xx <= Math.floor(px + ex); xx++) {
        var key = xx + "," + yy;
        if (!cells[key]) cells[key] = [];
        cells[key].push(c);
      }
  }

  /* art.js buildProps places the cars (PARKED.add); a new map clears them */
  var mapRows = null;
  function begin() {
    if (typeof MAP === "undefined" || MAP.rows === mapRows) return false;
    mapRows = MAP.rows; cars = []; cells = {};
    return true;
  }

  /* new match: every car back to intact and linked to the game state */
  function build(G) {
    for (var i = 0; i < cars.length; i++) { var c = cars[i]; c.hp = 100; c.state = "ok"; c._log = null; c._bt = 0; }
    if (G) G.parked = cars;
    return cars;
  }

  function pushOut(G, a, rad) {
    rad = rad || 0.25;
    var cell = cells[Math.floor(a.x) + "," + Math.floor(a.y)];
    if (!cell) return;
    for (var i = 0; i < cell.length; i++) {
      var c = cell[i];
      if (c.state === "towed") continue;
      var hl = c.hl + rad, hw = c.hw + rad;
      var ca = Math.cos(c.ang), sa = Math.sin(c.ang);
      var dx = a.x - c.x, dy = a.y - c.y;
      var lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
      if (lx > -hl && lx < hl && ly > -hw && ly < hw) {
        var px = (hl - lx) < (lx + hl) ? (hl - lx) : -(lx + hl);
        var py = (hw - ly) < (ly + hw) ? (hw - ly) : -(ly + hw);
        var mx = 0, my = 0;
        if (Math.abs(px) <= Math.abs(py)) mx = px; else my = py;
        a.x += mx * ca - my * sa;
        a.y += mx * sa + my * ca;
      }
    }
  }

  function fireOn(c) {
    if (typeof FX === "undefined" || !FX.listFires) return false;
    var fs = FX.listFires(), tx = Math.floor(c.x), ty = Math.floor(c.y);
    for (var i = 0; i < fs.length; i++) if (fs[i].hp >= 1 && fs[i].tx === tx && fs[i].ty === ty) return true;
    return false;
  }
  function setState(G, c, st, msg) {
    c.state = st; c._log = c._log || {};
    if (!c._log[st]) { c._log[st] = 1; if (G && G.log) G.log(msg); }
  }
  function bump(G, c) {
    for (var i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (!a.active) continue;
      var dx = a.x - c.x, dy = a.y - c.y;
      if (dx * dx + dy * dy <= 25) a.mood = Math.min(100, (a.mood || 0) + 6);
    }
  }

  /* only cars next to a rioter (cell index) or burning are touched each frame */
  function update(G, dt) {
    if (G && !G.parked) build(G);   /* first frame of a fresh game state */
    if (!G || !G.agents) return;
    if (G.time < (CONFIG.calmStartSeconds || 0)) return;
    var A = G.agents, hit = [], i, j, k, a, c, cell;
    for (i = 0; i < A.length; i++) {
      a = A[i];
      if (!a.active || a.role !== "rioter") continue;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        cell = cells[(Math.floor(a.x) + ox) + "," + (Math.floor(a.y) + oy)];
        if (!cell) continue;
        for (k = 0; k < cell.length; k++) {
          c = cell[k];
          if (c.state === "towed" || c.state === "burnt" || c.state === "burning") continue;
          if (c._tick !== G.time) { c._tick = G.time; c._near = 0; c._near2 = 0; c._att = []; hit.push(c); }
          var dx = a.x - c.x, dy = a.y - c.y, d2 = dx * dx + dy * dy;
          if (c._att.indexOf(a) >= 0) continue;
          if (d2 <= 4) c._near2++;
          if (d2 <= 1.44) { c._near++; c._att.push(a); }
        }
      }
    }
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      if (c.state === "burning" && G.time - (c._bt || 0) > 0.8 && !fireOn(c))
        setState(G, c, "burnt", "Car burnt out on " + Math.floor(c.x) + "," + Math.floor(c.y));
    }
    for (i = 0; i < hit.length; i++) {
      c = hit[i];
      var loc = Math.floor(c.x) + "," + Math.floor(c.y);
      if (c._near > 0) {
        var rate = Math.min(0.9, 0.15 * c._near);
        if (Math.random() < 1 - Math.pow(1 - rate, dt)) {
          c.hp -= 20 * dt;
          for (j = 0; j < c._att.length; j++) {
            c._att[j].violentUntil = G.time + (CONFIG.violentSeconds || 0);
            c._att[j].revealedUntil = G.time + 2;
          }
        }
      }
      if (c.state === "ok" && c.hp < 70) setState(G, c, "smashed", "Car smashed on " + loc);
      if (c.state === "smashed" && c.hp < 35 && c._near2 >= 3) { setState(G, c, "flipped", "Car flipped on " + loc); bump(G, c); }
      if ((c.state === "smashed" || c.state === "flipped") && c._near > 0 && Math.random() < 1 - Math.pow(0.95, dt)) {
        setState(G, c, "burning", "Car set on fire on " + loc);
        c._bt = G.time;
        if (typeof FX !== "undefined" && FX.addFire) FX.addFire(G, Math.floor(c.x), Math.floor(c.y));
        bump(G, c);
      }
    }
  }

  function tow(G, car) { if (car) car.state = "towed"; }
  function nearest(G, x, y, r) {
    var best = null, bd = r * r, L = (G && G.parked) ? G.parked : cars;
    for (var i = 0; i < L.length; i++) {
      var c = L[i];
      if (c.state === "towed") continue;
      var dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = c; }
    }
    return best;
  }

  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    return "rgb(" + Math.round(((n >> 16) & 255) * f) + "," + Math.round(((n >> 8) & 255) * f) + "," + Math.round((n & 255) * f) + ")";
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function paint(c, col, st, kq, L, W) {
    var hl = L / 2, hw = W / 2;
    var ww = Math.max(1.5, kq * 0.09), wl = Math.max(2, kq * 0.20);
    var wx = hl * 0.60, wy = hw + ww * 0.25;
    c.fillStyle = "#17181a";
    c.fillRect(-wx - wl / 2, -wy - ww / 2, wl, ww);
    c.fillRect(wx - wl / 2, -wy - ww / 2, wl, ww);
    c.fillRect(-wx - wl / 2, wy - ww / 2, wl, ww);
    c.fillRect(wx - wl / 2, wy - ww / 2, wl, ww);
    if (st === "flipped") {
      c.fillStyle = "#3d4045"; rr(c, -hl, -hw, L, W, Math.min(hw, kq * 0.10)); c.fill();
      c.strokeStyle = "#25272b"; c.lineWidth = Math.max(1, kq * 0.04);
      c.beginPath();
      c.moveTo(-hl * 0.55, -hw * 0.85); c.lineTo(-hl * 0.55, hw * 0.85);
      c.moveTo(hl * 0.55, -hw * 0.85); c.lineTo(hl * 0.55, hw * 0.85);
      c.stroke();
      c.fillStyle = "#101012";
      var rad = Math.max(2, kq * 0.12);
      var pts = [[-hl * 0.55, -hw * 0.88], [hl * 0.55, -hw * 0.88], [-hl * 0.55, hw * 0.88], [hl * 0.55, hw * 0.88]];
      for (var i = 0; i < 4; i++) { c.beginPath(); c.arc(pts[i][0], pts[i][1], rad, 0, 6.2832); c.fill(); }
      c.fillStyle = "#2a2d31"; c.fillRect(-hl * 0.22, -hw * 0.42, hl * 0.44, hw * 0.84);
      return;
    }
    var body = st === "burnt" ? "#151517" : (st === "burning" ? shade(col, 0.35) : col);
    c.fillStyle = body; rr(c, -hl, -hw, L, W, Math.min(hw, kq * 0.11)); c.fill();
    if (st !== "burnt") {
      c.fillStyle = shade(col, st === "burning" ? 0.22 : 0.7);
      rr(c, -hl * 0.42, -hw * 0.72, L * 0.84, W * 0.72, Math.min(hw * 0.5, kq * 0.07)); c.fill();
    }
    c.fillStyle = st === "burnt" ? "#26262a" : "#b7c7d2";
    c.fillRect(hl * 0.30, -hw * 0.55, hl * 0.20, hw * 1.1);
    c.fillRect(-hl * 0.52, -hw * 0.55, hl * 0.16, hw * 1.1);
    if (st === "smashed" || st === "burning") {
      c.strokeStyle = "rgba(240,248,255,0.85)"; c.lineWidth = Math.max(1, kq * 0.03);
      for (var s = 0; s < 6; s++) {
        var bx = (s - 2.5) * kq * 0.09;
        c.beginPath(); c.moveTo(bx, -hw * 0.65); c.lineTo(bx + kq * 0.06, -hw * 0.1); c.lineTo(bx - kq * 0.04, hw * 0.3); c.stroke();
      }
      c.fillStyle = "rgba(235,245,255,0.9)";
      for (var q = 0; q < 7; q++) {
        var sxp = ((q * 37) % 100) / 100 * L - hl, syp = ((q * 53) % 100) / 100 * W - hw;
        c.beginPath(); c.moveTo(sxp, syp); c.lineTo(sxp + kq * 0.05, syp + kq * 0.02); c.lineTo(sxp + kq * 0.01, syp + kq * 0.06); c.fill();
      }
    }
    if (st === "burnt") {
      c.fillStyle = "#6b4128";
      c.fillRect(-hl * 0.6, -hw * 0.4, kq * 0.12, kq * 0.08);
      c.fillRect(hl * 0.1, hw * 0.2, kq * 0.1, kq * 0.07);
      c.fillRect(-hl * 0.1, -hw * 0.1, kq * 0.08, kq * 0.05);
    }
  }
  function sprite(col, st, kq, step) {
    var key = col + "|" + st + "|" + kq + "|" + step, sp = sprites[key];
    if (sp) return sp;
    var L = 1.38 * kq, W = 0.62 * kq;
    var R = Math.ceil(Math.sqrt(L * L + W * W) / 2 + kq * 0.22) + 4;
    var cv = document.createElement("canvas");
    cv.width = cv.height = R * 2;
    var c = cv.getContext("2d");
    c.save(); c.translate(R, R); c.rotate(step * Math.PI / 8);
    paint(c, col, st, kq, L, W);
    c.restore();
    sp = { c: cv, r: R }; sprites[key] = sp;
    return sp;
  }
  function drawCar(ctx, car, sx, sy, k, G) {
    var kq = Math.max(6, Math.round(k / 2) * 2);
    var step = Math.round(car.ang / (Math.PI / 8)) & 15;
    var sp = sprite(car.col, car.state, kq, step);
    ctx.drawImage(sp.c, sx - sp.r, sy - sp.r);
    if (car.state === "burning") {
      var t = (G && G.time) || 0;
      for (var i = 0; i < 5; i++) {
        var ph = t * 6 + i * 1.7;
        var fx = sx + Math.sin(ph + i * 2.1) * kq * 0.28;
        var fy = sy + Math.cos(ph * 1.3 + i) * kq * 0.14 - kq * 0.04;
        var fr = kq * (0.08 + 0.04 * (0.5 + 0.5 * Math.sin(ph * 2.7)));
        ctx.fillStyle = (i & 1) ? "#ffd27a" : "#ff8a3c";
        ctx.beginPath();
        ctx.moveTo(fx, fy - fr * 1.7);
        ctx.quadraticCurveTo(fx + fr, fy, fx, fy + fr * 0.6);
        ctx.quadraticCurveTo(fx - fr, fy, fx, fy - fr * 1.7);
        ctx.fill();
      }
    }
  }

  return { begin: begin, add: addCar, build: build, list: function () { return cars; }, pushOut: pushOut, update: update, tow: tow, nearest: nearest, drawCar: drawCar };
})();
