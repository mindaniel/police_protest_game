/* cardrive.js - arcade car physics for the vehicle the player drives (DeepSeek) */
var CARDRIVE = (function () {
  "use strict";

  var drivenV = null;
  var inUp = false, inDown = false, inLeft = false, inRight = false, inBrake = false;
  var lastCrashSay = -999;

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  function topSpeed(type) {
    if (type === "van") return 11;
    if (type === "truck" || type === "watertruck" || type === "barriertruck" || type === "fireengine") return 8;
    return 14;
  }

  function accelOf(type) {
    if (type === "truck" || type === "watertruck" || type === "barriertruck" || type === "fireengine") return 4;
    return 7;
  }

  function solidAt(x, y) {
    if (!MAP || !MAP.rows) return true;
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return true;
    var ch = MAP.rows[y].charAt(x);
    if (ch === "#" || ch === "S" || ch === "W" || ch === "T") return true;
    return false;
  }

  function tileSolid(px, py) {
    // px, py in tiles
    return solidAt(Math.floor(px), Math.floor(py));
  }

  function getSize(v) {
    var len = 44, wid = 20;
    if (typeof UNITTYPES !== "undefined" && UNITTYPES && UNITTYPES.vehicle) {
      var s = UNITTYPES.vehicle(v.type);
      if (s) {
        if (typeof s.len === "number") len = s.len;
        if (typeof s.wid === "number") wid = s.wid;
      }
    }
    return { len: len, wid: wid };
  }

  function ensureState(v) {
    if (!v._cd) {
      v._cd = { vf: 0, vs: 0, yawRate: 0, crash: 0, steer: 0 };
    }
    if (typeof v._cd.steer !== "number") v._cd.steer = 0;
    return v._cd;
  }

  function setInput(up, down, left, right, handbrake) {
    inUp = !!up; inDown = !!down; inLeft = !!left; inRight = !!right; inBrake = !!handbrake;
  }

  function drive(v) {
    if (drivenV && drivenV !== v) {
      // release old
      if (drivenV._cd) { drivenV._cd.steer = 0; }
    }
    drivenV = v || null;
    if (drivenV) { ensureState(drivenV); }
  }

  function release() {
    if (drivenV && drivenV._cd) { drivenV._cd.steer = 0; drivenV._cd.vf = 0; drivenV._cd.vs = 0; }
    if (drivenV) { drivenV._drive = false; drivenV.tx = drivenV.x; drivenV.ty = drivenV.y; if (typeof DRIVE !== "undefined") DRIVE.reset(drivenV); }
    drivenV = null;
  }

  function driven() { return drivenV; }
  function owns(v) { return v === drivenV && v !== null; }

  function speed() {
    if (!drivenV || !drivenV._cd) return 0;
    return Math.abs(drivenV._cd.vf);
  }

  function kmh() {
    return Math.round(Math.abs(speed()) * 3.5 * 3.6);
  }

  // collision test: returns true if any corner or front-centre is solid
  function testCollision(v, len, wid, x, y, ang) {
    var hx = (len / 32) * 0.5;
    var hy = (wid / 32) * 0.5;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    // local corners (in tiles): forward axis is (ca,sa), right is (-sa,ca)
    var fx = ca * hx, fy = sa * hx;
    var rx = -sa * hy, ry = ca * hy;
    // 4 corners: (+f+r), (+f-r), (-f+r), (-f-r)
    var pts = [
      [x + fx + rx, y + fy + ry],
      [x + fx - rx, y + fy - ry],
      [x - fx + rx, y - fy + ry],
      [x - fx - rx, y - fy - ry],
      [x + fx, y + fy]
    ];
    for (var i = 0; i < pts.length; i++) {
      if (tileSolid(pts[i][0], pts[i][1])) return true;
    }
    return false;
  }

  function update(G, dt) {
    if (!drivenV) return;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;

    var v = drivenV;
    var st = ensureState(v);

    var sz = getSize(v);
    var len = sz.len, wid = sz.wid;
    var lenT = len / 32;
    var widT = wid / 32;
    var wheelbase = 0.8 * lenT;
    if (wheelbase < 0.01) wheelbase = 0.01;

    var tSpeed = topSpeed(v.type);
    var accel = accelOf(v.type);

    // integrate in sub-steps
    var remaining = dt;
    var maxStep = 1 / 60;
    while (remaining > 0) {
      var step = remaining > maxStep ? maxStep : remaining;
      remaining -= step;
      subStep(v, st, step, tSpeed, accel, wheelbase, len, wid, G);
    }

    // crash timer decay
    if (st.crash > 0) st.crash -= dt;
    if (st.crash < 0) st.crash = 0;
  }

  function subStep(v, st, dt, tSpeed, accel, wheelbase, len, wid, G) {
    var lenT = len / 32;
    // ---- Steering ----
    var speedRatio = Math.abs(st.vf) / tSpeed;
    if (speedRatio > 1) speedRatio = 1;
    var maxSteer = 0.6 - (0.6 - 0.18) * speedRatio;
    var steerInput = (inRight ? 1 : 0) - (inLeft ? 1 : 0);
    var targetSteer = steerInput * maxSteer;

    var steer = st.steer;
    if (steerInput !== 0) {
      // move toward target at 4 rad/s
      var d = targetSteer - steer;
      var maxd = 4 * dt;
      if (d > maxd) d = maxd; else if (d < -maxd) d = -maxd;
      steer += d;
    } else {
      // back to 0 at 6 rad/s
      var back = 6 * dt;
      if (steer > back) steer -= back;
      else if (steer < -back) steer += back;
      else steer = 0;
    }
    st.steer = steer;

    // ---- Longitudinal ----
    var vf = st.vf;
    var handbrake = inBrake;

    if (inUp) {
      if (vf < 0) {
        // braking from reverse
        vf += 18 * dt;
        if (vf > 0) vf = 0;
      } else {
        vf += accel * dt;
        if (vf > tSpeed) vf = tSpeed;
      }
    } else if (inDown) {
      if (vf > 0.1) {
        // braking
        vf -= 18 * dt;
        if (vf < 0) vf = 0;
      } else {
        // reverse
        vf -= accel * dt;
        if (vf < -4) vf = -4;
      }
    }

    // engine drag
    vf -= 0.6 * vf * dt;

    // rolling friction
    if (Math.abs(vf) > 0) {
      var fr = 1.5 * dt;
      if (Math.abs(vf) <= fr) vf = 0;
      else vf -= (vf > 0 ? fr : -fr);
    }

    // handbrake decays vf
    if (handbrake) {
      vf -= 3 * vf * dt;
    }

    // ---- Yaw ----
    var yawRate = (vf / wheelbase) * Math.tan(steer);
    if (handbrake && Math.abs(vf) > 4) {
      yawRate *= 1.4;
    }
    st.yawRate = yawRate;

    // ---- Grip / side velocity ----
    var grip = handbrake ? 1.5 : 9;
    var vs = st.vs;
    vs -= vs * Math.min(1, grip * dt);
    st.vs = vs;

    // ---- Convert to world velocity ----
    var ca = Math.cos(v.ang), sa = Math.sin(v.ang);
    // forward: (ca, sa), right-hand normal: (-sa, ca)
    var wvx = ca * vf + (-sa) * vs;
    var wvy = sa * vf + ca * vs;

    // ---- Move ----
    var oldX = v.x, oldY = v.y;
    var newX = oldX + wvx * dt;
    var newY = oldY + wvy * dt;
    var newAng = v.ang + yawRate * dt;

    // apply rotation first for collision test
    var hit = testCollision(v, len, wid, newX, newY, newAng);
    if (!hit) {
      v.x = newX;
      v.y = newY;
      v.ang = newAng;
    } else {
      // try sliding
      var slid = false;
      if (!testCollision(v, len, wid, newX, oldY, newAng)) {
        v.x = newX;
        v.ang = newAng;
        slid = true;
      } else if (!testCollision(v, len, wid, oldX, newY, newAng)) {
        v.y = newY;
        v.ang = newAng;
        slid = true;
      }

      if (!slid) {
        // bounce
        var vfBefore = st.vf;
        st.vf *= -0.25;
        st.vs *= 0.5;
        st.crash = 0.3;
        if (Math.abs(vfBefore) > 7) {
          var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
          if (now - lastCrashSay > 2000) {
            lastCrashSay = now;
            if (typeof UI !== "undefined" && UI.say) UI.say("Crash!");
          }
        }
      } else {
        // sliding: dampen velocity a bit
        st.vf *= 0.7;
        st.vs *= 0.7;
      }
    }

    // keep in map
    v.x = clamp(v.x, 0.01, MAP.width - 0.01);
    v.y = clamp(v.y, 0.01, MAP.height - 0.01);

    // ---- Traffic cars ----
    if (typeof TRAFFIC !== "undefined" && TRAFFIC.list) {
      var list = TRAFFIC.list();
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c) continue;
        var dx = c.x - v.x;
        var dy = c.y - v.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.2 && dist > 0.0001) {
          var overlap = 1.2 - dist;
          var nx = dx / dist, ny = dy / dist;
          var push = overlap * 0.5;
          c.x += nx * push;
          c.y += ny * push;
          v.x -= nx * push;
          v.y -= ny * push;
          st.vf *= 0.6;
        }
      }
    }

    // ---- People ----
    if (typeof Crowd !== "undefined" && Crowd.neighbors) {
      var frontX = v.x + ca * (lenT * 0.5);
      var frontY = v.y + sa * (lenT * 0.5);
      var radius = len / 64 + 0.4;
      var out = _crowdOut;
      out.length = 0;
      var n = Crowd.neighbors(G, frontX, frontY, radius, out);
      var pushed = false;
      for (var j = 0; j < n; j++) {
        var p = out[j];
        if (!p) continue;
        var pdx = p.x - frontX;
        var pdy = p.y - frontY;
        var pd = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pd < 0.0001) { pdx = -sa; pdy = ca; pd = 1; }
        var ux = pdx / pd, uy = pdy / pd;
        var pushAmt = Math.min(0.6, radius - pd + 0.2);
        if (pushAmt < 0) pushAmt = 0.6;
        var npx = p.x + ux * pushAmt;
        var npy = p.y + uy * pushAmt;
        if (!tileSolid(npx, npy)) {
          p.x = npx;
          p.y = npy;
          pushed = true;
        }
        if (typeof p.mood === "number") {
          p.mood = Math.min(100, p.mood + 15);
        } else {
          p.mood = 15;
        }
      }
      if (pushed && Math.abs(st.vf) > 3) {
        st.vf = st.vf > 0 ? 3 : -3;
      }
    }

    // ---- write back ----
    st.vf = vf;
    v.tx = v.x;
    v.ty = v.y;
    v._drive = true;
  }

  var _crowdOut = [];

  return {
    setInput: setInput,
    update: update,
    drive: drive,
    release: release,
    driven: driven,
    owns: owns,
    speed: speed,
    kmh: kmh
  };
})();
