var DRIVE = (function () {
  var PI = Math.PI, TAU = PI * 2;

  function wrap(a) {
    a = a % TAU;
    if (a > PI) a -= TAU;
    else if (a < -PI) a += TAU;
    return a;
  }

  function gw() { return (typeof MAP !== "undefined" && MAP) ? MAP.width : 0; }
  function gh() { return (typeof MAP !== "undefined" && MAP) ? MAP.height : 0; }

  /* physics size = drawn size (unit defs are in world units, 32 per tile) */
  var specs = {};
  function spec(t) {
    if (specs[t]) return specs[t];
    var d = typeof UNITTYPES !== "undefined" ? UNITTYPES.vehicle(t) : null, o = spec0(t);
    if (d) { o.len = d.len / 32; o.wid = d.wid / 32; o.rmin = o.len * (o.wid > 0.75 ? 1.15 : 0.9); }
    specs[t] = o;
    return o;
  }
  function spec0(t) {
    if (t === "van") return { len: 2.0, wid: 0.9, rmin: 2.0, acc: 3.0 };
    if (t === "truck" || t === "watertruck" || t === "barriertruck") return { len: 2.4, wid: 1.0, rmin: 2.8, acc: 2.2 };
    if (t === "ambulance") return { len: 2.1, wid: 0.9, rmin: 2.0, acc: 3.5 };
    if (t === "fireengine") return { len: 2.4, wid: 1.0, rmin: 2.8, acc: 2.6 };
    return { len: 1.8, wid: 0.84, rmin: 1.6, acc: 3.5 };
  }

  function solidAt(x, y, opts) {
    return !!(opts.solid && opts.solid(x, y));
  }

  function clearAt(tx, ty, opts) {
    if (solidAt(tx, ty, opts)) return false;
    var w = gw();
    if (!w || tx < 0 || ty < 0 || tx >= w || ty >= gh()) return false;
    return !!(opts.clear && opts.clear[ty * w + tx] === 1);
  }

  function pointOk(px, py, opts, vtx, vty) {
    var tx = Math.floor(px), ty = Math.floor(py);
    if (solidAt(tx, ty, opts)) return false;
    var w = gw();
    if (!w) return false;
    var i = ty * w + tx;
    if (i < 0 || !opts.clear || i >= opts.clear.length) return false;
    var c = opts.clear[i];
    if (c === 1) return true;
    return c === 0 && tx === vtx && ty === vty;
  }

  function los(x0, y0, x1, y1, hw, opts, vtx, vty) {
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return true;
    var nx = -dy / len, ny = dx / len, o = hw + 0.1;
    var n = Math.ceil(len / 0.25);
    if (n < 1) n = 1;
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var px = x0 + dx * t, py = y0 + dy * t;
      if (!pointOk(px, py, opts, vtx, vty)) return false;
      if (!pointOk(px + nx * o, py + ny * o, opts, vtx, vty)) return false;
      if (!pointOk(px - nx * o, py - ny * o, opts, vtx, vty)) return false;
    }
    return true;
  }

  function buildPath(v, gx, gy, opts) {
    var path = [];
    var w = gw();
    var tx = Math.floor(v.x), ty = Math.floor(v.y);
    var dgx = gx - v.x, dgy = gy - v.y;
    var dg = Math.sqrt(dgx * dgx + dgy * dgy);
    var f = opts.field;
    if (!f || !w || f[ty * w + tx] < 0 || dg < 2.5) {
      path.push([gx, gy]);
      return path;
    }
    var cx = tx, cy = ty;
    for (var s = 0; s < 12; s++) {
      var best = -1, bx = 0, by = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = cx + dx, ny = cy + dy;
          if (!clearAt(nx, ny, opts)) continue;
          if (dx && dy && (!clearAt(cx + dx, cy, opts) || !clearAt(cx, cy + dy, opts))) continue;
          var val = f[ny * w + nx];
          if (val < 0) continue;
          if (best < 0 || val < best) { best = val; bx = nx; by = ny; }
        }
      }
      if (best < 0) break;
      cx = bx; cy = by;
      path.push([cx + 0.5, cy + 0.5]);
      if (best === 0) break;
    }
    if (!path.length) path.push([gx, gy]);
    return path;
  }

  /* bicycle model: move strictly along heading, reverse-safe, then rotate by distance/radius */
  function move(v, sp, dt, opts) {
    var s = v._drSpeed;
    if (Math.abs(s) < 0.001) { v._drSpeed = 0; return false; }
    var c = Math.cos(v.ang), sn = Math.sin(v.ang);
    var dx = c * s * dt, dy = sn * s * dt;
    var off = 0.5 * sp.len * (s >= 0 ? 1 : -1);
    var blocked = function (nx, ny) {
      if (solidAt(Math.floor(nx), Math.floor(ny), opts)) return true;
      if (solidAt(Math.floor(nx + c * off), Math.floor(ny + sn * off), opts)) return true;
      return false;
    };
    if (!blocked(v.x + dx, v.y + dy)) {
      v.x += dx; v.y += dy;
      return true;
    }
    /* cannot advance: try a scaled-down move so we still creep and rotate validly */
    for (var k = 0.5; k >= 0.125; k *= 0.5) {
      var mx = dx * k, my = dy * k;
      if (!blocked(v.x + mx, v.y + my)) { v.x += mx; v.y += my; return true; }
    }
    v._drSpeed = 0;
    v._drBrake = true;
    return false;
  }

  function step(G, v, gx, gy, dt, opts) {
    if (!(dt > 0)) dt = 0.05;
    var sp = spec(v.type);
    if (v._drSpeed === undefined) v._drSpeed = 0;
    if (v._drReverse === undefined) v._drReverse = false;
    if (v._drBrake === undefined) v._drBrake = false;
    if (v._drRevT === undefined) v._drRevT = 0;
    if (v._drRevD === undefined) v._drRevD = 0;
    if (v._drCool === undefined) v._drCool = 0;
    if (v._drProgT === undefined) { v._drProgT = 0; v._drProgX = v.x; v._drProgY = v.y; v._drStuck = false; }
    if (v._drArrived === undefined) v._drArrived = false;

    var dgx = gx - v.x, dgy = gy - v.y;
    var distGoal = Math.sqrt(dgx * dgx + dgy * dgy);

    if (distGoal < 0.6) v._drArrived = true;
    else if (distGoal > 1.2) v._drArrived = false;

    if (v._drCool > 0) v._drCool -= dt;

    if (v._drArrived) {
      var s0 = v._drSpeed, dec = 7 * dt;
      if (Math.abs(s0) <= dec) s0 = 0;
      else s0 -= (s0 > 0 ? 1 : -1) * dec;
      v._drSpeed = s0;
      v._drBrake = true;
      v._drReverse = false;
      v._drRevT = 0;
      move(v, sp, dt, opts);
      return v.x !== undefined;
    }

    v._drProgT += dt;
    if (v._drProgT >= 1.5) {
      var pdx = v.x - v._drProgX, pdy = v.y - v._drProgY;
      v._drStuck = Math.sqrt(pdx * pdx + pdy * pdy) < 0.15;
      var gain = (v._drProgD === undefined) ? 1 : v._drProgD - distGoal;
      v._drProgD = distGoal;
      v._drStuckN = (v._drStuck || gain < 0.3) ? (v._drStuckN || 0) + 1 : 0;
      if (v._drStuckN >= 2) { v._drStuckN = 0; v._drNudge = 1.5; }
      v._drProgT = 0;
      v._drProgX = v.x;
      v._drProgY = v.y;
    }

    var path = buildPath(v, gx, gy, opts);
    var Ld = 1.6 + 0.5 * Math.abs(v._drSpeed);
    var vtx = Math.floor(v.x), vty = Math.floor(v.y);
    var tgt = null;
    for (var i = path.length - 1; i >= 0; i--) {
      var px = path[i][0], py = path[i][1];
      var ddx = px - v.x, ddy = py - v.y;
      if (Math.sqrt(ddx * ddx + ddy * ddy) <= Ld &&
          los(v.x, v.y, px, py, sp.wid * 0.5, opts, vtx, vty)) {
        tgt = path[i];
        break;
      }
    }
    if (!tgt) tgt = path[0];

    var e = wrap(Math.atan2(tgt[1] - v.y, tgt[0] - v.x) - v.ang);

    /* 3-point turn state machine: reverse max 2 tiles with opposite steering */
    if (v._drReverse) {
      v._drRevT += dt;
      var rx = v.x - Math.cos(v.ang) * sp.len * 0.5;
      var ry = v.y - Math.sin(v.ang) * sp.len * 0.5;
      var rearBlocked = solidAt(Math.floor(rx), Math.floor(ry), opts);
      if (v._drRevD >= 2.0 || v._drRevT > 1.6 || rearBlocked ||
          (v._drRevT > 0.7 && Math.abs(e) < 0.6)) {
        v._drReverse = false;
        v._drRevT = 0;
        v._drRevD = 0;
        v._drCool = 1.2;
      }
    } else if (v._drCool <= 0 && (Math.abs(e) > 1.9 || v._drStuck)) {
      v._drReverse = true;
      v._drRevT = 0;
      v._drRevD = 0;
      v._drStuck = false;
    }

    var tSpeed;
    if (v._drReverse) {
      tSpeed = -0.45 * v.speed;
    } else {
      tSpeed = v.speed * Math.max(0.3, 1 - Math.abs(e) / 1.6);
      var lim = Math.sqrt(2 * 7 * Math.max(0, distGoal));
      if (tSpeed > lim) tSpeed = lim;
    }

    var s = v._drSpeed;
    var sameDir = (s >= 0 && tSpeed >= 0) || (s <= 0 && tSpeed <= 0);
    var rate = sameDir ? sp.acc : 7;
    if (tSpeed > s) { s += rate * dt; if (s > tSpeed) s = tSpeed; }
    else if (tSpeed < s) { s -= rate * dt; if (s < tSpeed) s = tSpeed; }
    v._drSpeed = s;
    v._drBrake = (!sameDir) || (Math.abs(tSpeed) < Math.abs(s) - 0.05);

    /* rotate only by amount proportional to distance actually travelled; do move first */
    var angBefore = v.ang;
    var xBefore = v.x, yBefore = v.y;
    var moved = move(v, sp, dt, opts);
    var distMoved = Math.sqrt((v.x - xBefore) * (v.x - xBefore) + (v.y - yBefore) * (v.y - yBefore));
    if (distMoved > 1e-6) {
      var radius = sp.rmin;
      var maxAng = distMoved / radius;
      var desiredAng;
      /* reversing with opposite lock also swings the nose toward the target */
      desiredAng = 2.2 * e * dt;
      if (desiredAng > maxAng) desiredAng = maxAng;
      else if (desiredAng < -maxAng) desiredAng = -maxAng;
      /* also cap at vehTurnRate-like physical rate */
      var cap = 3.0 * dt;
      if (desiredAng > cap) desiredAng = cap;
      else if (desiredAng < -cap) desiredAng = -cap;
      v.ang = wrap(v.ang + desiredAng);
      if (v._drReverse) v._drRevD += distMoved;
    } else {
      /* no movement: cannot rotate */
      v.ang = angBefore;
    }

    return moved;
  }

  function reset(v) {
    v._drSpeed = 0;
    v._drReverse = false;
    v._drBrake = false;
    v._drRevT = 0;
    v._drRevD = 0;
    v._drCool = 0;
    v._drProgT = 0;
    v._drProgX = v.x;
    v._drProgY = v.y;
    v._drStuck = false;
    v._drArrived = false;
    v._drStuckN = 0;
    v._drNudge = 0;
  }

  return { step: step, reset: reset };
})();
if (typeof module !== "undefined" && module.exports) module.exports = DRIVE;
