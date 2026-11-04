/* frontline.js (DeepSeek) */
(function (global) {
  'use strict';

  var FRONTLINE = {
    _lastLine: -999,
    _vecStop: {},
    _markerT: 0
  };

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  function pushOut(G, a, ox, oy, rad) {
    var dx = a.x - ox, dy = a.y - oy;
    var d2 = dx * dx + dy * dy;
    if (d2 >= rad * rad || d2 < 1e-8) return;
    var d = Math.sqrt(d2);
    var nx = ox + (dx / d) * rad;
    var ny = oy + (dy / d) * rad;
    if (Crowd.collides(G, nx, a.y)) {
      if (!Crowd.collides(G, a.x, ny)) { a.y = ny; }
      return;
    }
    if (Crowd.collides(G, nx, ny)) {
      if (!Crowd.collides(G, nx, a.y)) { a.x = nx; return; }
      if (!Crowd.collides(G, a.x, ny)) { a.y = ny; return; }
      return;
    }
    a.x = nx; a.y = ny;
  }

  function contact(G, dt) {
    var offs = G.officers, i, j, o, list, a;
    var R = 0.55, R2 = R * R;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!o || o.escorting || o.arrestTarget) continue;
      list = Crowd.neighbors(G, o.x, o.y, R + 0.4);
      for (j = 0; j < list.length; j++) {
        a = list[j];
        if (!a || !a.active || a.braced) continue;
        if (dist2(a.x, a.y, o.x, o.y) < R2) pushOut(G, a, o.x, o.y, R);
      }
    }
  }

  function findSquadCrowd(G, s, cx, cy) {
    var list = Crowd.neighbors(G, cx, cy, 10), i, a, n = 0, sx = 0, sy = 0;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || !a.active) continue;
      sx += a.x; sy += a.y; n++;
    }
    if (n < 3) return null;
    return { x: sx / n, y: sy / n };
  }

  function squadCentre(G, s, out) {
    var offs = G.officers, i, o, n = 0, sx = 0, sy = 0;
    for (i = 0; i < offs.length; i++) {
      o = offs[i];
      if (!o || o.squad !== s || o.escorting || o.arrestTarget) continue;
      sx += o.x; sy += o.y; n++;
    }
    if (!n) return false;
    out.x = sx / n; out.y = sy / n; out.n = n;
    return true;
  }

  function lineFormation(G, dt) {
    if (G.time - FRONTLINE._lastLine < 1) return;
    var orders = G.orders || {}, i, o, s, ord, crowd, ctr = { x: 0, y: 0, n: 0 };
    var tmp = { x: 0, y: 0 };
    var seen = {};
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (!o) continue;
      s = o.squad;
      if (seen[s]) continue;
      seen[s] = true;
      ord = orders[s];
      if (!ord) continue;
      if (ord.order !== 'hold' && ord.order !== 'guard' && ord.order !== 'push') continue;
      if (!squadCentre(G, s, ctr)) continue;
      crowd = findSquadCrowd(G, s, ctr.x, ctr.y);
      if (!crowd) continue;
      var dx = crowd.x - ctr.x, dy = crowd.y - ctr.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-4) continue;
      dx /= d; dy /= d;
      var px = -dy, py = dx;
      var count = 0, j;
      for (j = 0; j < G.officers.length; j++) {
        o = G.officers[j];
        if (!o || o.squad !== s || o.escorting || o.arrestTarget) continue;
        count++;
      }
      if (!count) continue;
      var span = (count - 1) * 1.2;
      var start = -span / 2;
      var idx = 0;
      for (j = 0; j < G.officers.length; j++) {
        o = G.officers[j];
        if (!o || o.squad !== s || o.escorting || o.arrestTarget) continue;
        var off = start + idx * 1.2;
        var tx = ctr.x + px * off + dx * 1.6;
        var ty = ctr.y + py * off + dy * 1.6;
        idx++;
        if (Crowd.collides(G, tx, ty)) continue;
        o.tx = tx; o.ty = ty;
      }
    }
    FRONTLINE._lastLine = G.time;
  }

  function standoff(G, dt) {
    var orders = G.orders || {}, i, j, o, list, a, s;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (!o) continue;
      s = o.squad;
      var ord = orders[s];
      if (!ord) continue;
      if (ord.order !== 'hold' && ord.order !== 'guard' && ord.order !== 'push') continue;
      list = Crowd.neighbors(G, o.x, o.y, 1.6 + 0.3);
      for (j = 0; j < list.length; j++) {
        a = list[j];
        if (!a || !a.active || a.role !== 'peaceful') continue;
        var dx = a.x - o.x, dy = a.y - o.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > 1.6 * 1.6 || d2 < 1e-6) continue;
        var d = Math.sqrt(d2);
        var step = 0.8 * dt;
        var nx = a.x + (dx / d) * step;
        var ny = a.y + (dy / d) * step;
        if (!Crowd.collides(G, nx, ny)) { a.x = nx; a.y = ny; }
      }
    }
  }

  function vehicles(G, dt) {
    var i, j, v, list, a, n, cx, cy, k, stopped;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v) continue;
      if (v._baseSpeed === undefined) v._baseSpeed = v.speed;
      if (v._crowdStop) {
        v.speed = v._baseSpeed;
        v._crowdStop = false;
      }
      var ca = Math.cos(v.ang), sa = Math.sin(v.ang);
      var px = -sa, py = ca;
      var cx0 = v.x, cy0 = v.y;
      var frontX = cx0 + ca * 1.0, frontY = cy0 + sa * 1.0;
      list = Crowd.neighbors(G, frontX, frontY, 2.0);
      n = 0; cx = 0; cy = 0;
      for (j = 0; j < list.length; j++) {
        a = list[j];
        if (!a || !a.active) continue;
        var rx = a.x - cx0, ry = a.y - cy0;
        var along = rx * ca + ry * sa;
        var lat = rx * px + ry * py;
        if (along >= 0.3 && along <= 1.6 && Math.abs(lat) <= 0.7) {
          n++; cx += a.x; cy += a.y;
        }
      }
      if (n >= 4) {
        v._crowdStop = true;
        v.speed = 0;
        if (!v._stopT) v._stopT = G.time;
        if (v.type === 'watertruck' && (G.time - v._stopT) > 2 && G.time > CONFIG.calmStartSeconds) {
          if (!v._lastFire || G.time - v._lastFire > 4) {
            var fx = cx0 + ca * 1.8, fy = cy0 + sa * 1.8;
            if (Police.waterCannon(G, fx, fy, v.squad)) v._lastFire = G.time;
          }
        }
      } else {
        v._stopT = 0;
      }
    }
  }

  FRONTLINE.update = function (G, dt) {
    contact(G, dt);
    standoff(G, dt);
    lineFormation(G, dt);
    vehicles(G, dt);
  };

  FRONTLINE.draw = function (ctx, G) {
    var i, v, p;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v || !v._crowdStop) continue;
      p = Art.project(v.x, v.y, 1);
      if (!p) continue;
      ctx.save();
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffcc00';
      ctx.fillText('!', p.x, p.y - 14);
      ctx.restore();
    }
  };

  FRONTLINE.reset = function () {
    FRONTLINE._lastLine = -999;
    FRONTLINE._vecStop = {};
    FRONTLINE._markerT = 0;
  };

  global.FRONTLINE = FRONTLINE;
})(this);
