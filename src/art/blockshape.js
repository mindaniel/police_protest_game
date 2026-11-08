/* blockshape.js - smooth building outlines: staircase edges along diagonal roads become
 * one slanted edge. Built once per map; art.js asks cell(x,y) for the cut shape of a tile.
 * Coordinates are tiles, y down. Tile (x,y) covers [x,x+1] x [y,y+1]. */
var BLOCKSHAPE = (function make() {   /* make() gives a separate instance (roads use one) */
  "use strict";
  var W = 0, H = 0, cells = [], outl = [], stats = { regions: 0, cells: 0, ms: 0 };
  var KEEP_RUN = 5, TOL = 1.0;

  /* Boundary edges run with the solid side on their right (y down), so the
   * outward normal of edge (dx,dy) is (dy,-dx). */
  function trace(solid) {
    var out = {}, x, y, loops = [];
    function add(ax, ay, bx, by) { var k = ay * (W + 1) + ax; (out[k] || (out[k] = [])).push([ax, ay, bx, by]); }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) add(x, y, x + 1, y);
      if (!solid(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!solid(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!solid(x - 1, y)) add(x, y + 1, x, y);
    }
    for (var k in out) {
      while (out[k] && out[k].length) {
        var e = out[k].pop(), pts = [e[0], e[1]], dx = e[2] - e[0], dy = e[3] - e[1];
        var sx = e[0], sy = e[1], cx = e[2], cy = e[3], guard = 0;
        while ((cx !== sx || cy !== sy) && guard++ < 1e6) {
          var list = out[cy * (W + 1) + cx];
          if (!list || !list.length) break;
          var pick = 0;
          if (list.length > 1) {   /* saddle: turn right to keep diagonal tiles apart */
            for (var j = 0; j < list.length; j++) {
              var ndx = list[j][2] - list[j][0], ndy = list[j][3] - list[j][1];
              if (ndx === -dy && ndy === dx) { pick = j; break; }
            }
          }
          var n = list.splice(pick, 1)[0];
          pts.push(cx, cy);
          dx = n[2] - n[0]; dy = n[3] - n[1]; cx = n[2]; cy = n[3];
        }
        if (pts.length >= 8) loops.push(pts);
      }
    }
    return loops;
  }

  /* corner points only (drop points in the middle of straight runs) */
  function corners(p) {
    var n = p.length / 2, o = [], i;
    for (i = 0; i < n; i++) {
      var a = (i + n - 1) % n, b = (i + 1) % n;
      var d1x = p[i * 2] - p[a * 2], d1y = p[i * 2 + 1] - p[a * 2 + 1];
      var d2x = p[b * 2] - p[i * 2], d2y = p[b * 2 + 1] - p[i * 2 + 1];
      if (d1x * d2y - d1y * d2x !== 0) o.push(p[i * 2], p[i * 2 + 1]);
    }
    return o;
  }

  function dp(xs, ys, i0, i1, keep) {
    var ax = xs[i0], ay = ys[i0], bx = xs[i1], by = ys[i1], best = -1, bd = TOL;
    var lx = bx - ax, ly = by - ay, L = Math.sqrt(lx * lx + ly * ly) || 1;
    for (var i = i0 + 1; i < i1; i++) {
      var d = Math.abs((xs[i] - ax) * ly - (ys[i] - ay) * lx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    keep[best] = 1;
    dp(xs, ys, i0, best, keep); dp(xs, ys, best, i1, keep);
  }

  function simplify(c) {
    var n = c.length / 2, i;
    if (n < 4) return c;
    var run = [];   /* run[i] = length of edge i -> i+1 */
    for (i = 0; i < n; i++) { var j = (i + 1) % n; run.push(Math.abs(c[j * 2] - c[i * 2]) + Math.abs(c[j * 2 + 1] - c[i * 2 + 1])); }
    var keep = [], anchors = [];
    for (i = 0; i < n; i++) {
      if (run[(i + n - 1) % n] >= KEEP_RUN && run[i] >= KEEP_RUN) { keep[i] = 1; anchors.push(i); }
    }
    if (!anchors.length) {   /* no square corner: anchor on the two farthest-apart points */
      var far = 0, fd = -1;
      for (i = 1; i < n; i++) { var ex = c[i * 2] - c[0], ey = c[i * 2 + 1] - c[1]; if (ex * ex + ey * ey > fd) { fd = ex * ex + ey * ey; far = i; } }
      keep[0] = keep[far] = 1; anchors = [0, far];
    }
    for (var a = 0; a < anchors.length; a++) {
      var s = anchors[a], e = anchors[(a + 1) % anchors.length];
      var xs = [], ys = [], m = (e - s + n) % n || n;
      for (i = 0; i <= m; i++) { var q = (s + i) % n; xs.push(c[q * 2]); ys.push(c[q * 2 + 1]); }
      var kk = [];
      dp(xs, ys, 0, m, kk);
      for (i = 1; i < m; i++) if (kk[i]) keep[(s + i) % n] = 1;
    }
    var o = [];
    for (i = 0; i < n; i++) if (keep[i]) o.push(c[i * 2], c[i * 2 + 1]);
    return o.length >= 6 ? o : c;
  }

  /* Sutherland-Hodgman against one axis line: keep side where sign*(v - k) >= 0 */
  function clipAxis(p, axis, k, sign) {
    var o = [], n = p.length / 2;
    if (!n) return o;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
      var av = (axis ? ay : ax) - k, bv = (axis ? by : bx) - k;
      var ain = sign * av >= 0, bin = sign * bv >= 0;
      if (ain) o.push(ax, ay);
      if (ain !== bin) { var t = av / (av - bv); o.push(ax + (bx - ax) * t, ay + (by - ay) * t); }
    }
    return o;
  }
  function area(p) {
    var s = 0, n = p.length / 2;
    for (var i = 0; i < n; i++) { var j = (i + 1) % n; s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
    return s / 2;
  }

  function bounds(p, axis) {
    var lo = 1e9, hi = -1e9;
    for (var i = axis; i < p.length; i += 2) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; }
    return [lo, hi];
  }
  function splitY(p, ya, yb, touched) {
    if (p.length < 6 || yb <= ya) return;
    if (yb - ya === 1) {
      var bx = bounds(p, 0);
      splitX(p, ya, Math.max(0, Math.floor(bx[0])), Math.min(W, Math.ceil(bx[1])), touched);
      return;
    }
    var m = (ya + yb) >> 1;
    splitY(clipAxis(p, 1, m, -1), ya, m, touched);
    splitY(clipAxis(p, 1, m, 1), m, yb, touched);
  }
  function splitX(p, y, xa, xb, touched) {
    if (p.length < 6 || xb <= xa) return;
    if (xb - xa === 1) {
      var a = area(p);
      if (Math.abs(a) < 1e-4) return;
      var c = cells[y * W + xa] || (cells[y * W + xa] = { polys: [], walls: [], area: 0 });
      c.polys.push(p); c.area += a;
      touched[y * W + xa] = 1;
      return;
    }
    var m = (xa + xb) >> 1;
    splitX(clipAxis(p, 0, m, -1), y, xa, m, touched);
    splitX(clipAxis(p, 0, m, 1), y, m, xb, touched);
  }

  function build(w, h, solid) {
    var t0 = Date.now(), i, x, y;
    W = w; H = h; cells = new Array(W * H);
    function sol(x, y) { return x >= 0 && y >= 0 && x < W && y < H && !!solid(x, y); }
    var loops = trace(sol), polys = [];
    for (i = 0; i < loops.length; i++) polys.push(simplify(corners(loops[i])));
    stats.regions = polys.length;
    outl = polys;
    /* clip each polygon into row strips, then strips into cells */
    var touched = {};
    for (var pi = 0; pi < polys.length; pi++) {
      var P = polys[pi], y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
      for (i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
      /* halve the polygon recursively (rows, then columns) instead of clipping the whole outline
         once per row and column: same pieces, far less work for big outlines like a road network */
      splitY(P, Math.max(0, Math.floor(y0)), Math.min(H, Math.ceil(y1)), touched);
      /* south-facing walls: edges with outward normal pointing +y, i.e. dx < 0 */
      var n = P.length / 2;
      for (i = 0; i < n; i++) {
        var j = (i + 1) % n, ax = P[i * 2], ay = P[i * 2 + 1], bx = P[j * 2], by = P[j * 2 + 1];
        if (!(bx < ax)) continue;
        /* split at every integer x / y crossing */
        var ts = [0, 1], kx, ky;
        for (kx = Math.ceil(bx); kx < ax; kx++) ts.push((ax - kx) / (ax - bx));
        if (by !== ay) for (ky = Math.ceil(Math.min(ay, by)); ky < Math.max(ay, by); ky++) ts.push((ky - ay) / (by - ay));
        ts.sort(function (p, q) { return p - q; });
        for (var s = 0; s + 1 < ts.length; s++) {
          if (ts[s + 1] - ts[s] < 1e-6) continue;
          var px = ax + (bx - ax) * ts[s], py = ay + (by - ay) * ts[s];
          var qx = ax + (bx - ax) * ts[s + 1], qy = ay + (by - ay) * ts[s + 1];
          var cx = Math.floor((px + qx) / 2), cy = Math.floor((py + qy) / 2 - 1e-6);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          var cc = cells[cy * W + cx] || (cells[cy * W + cx] = { polys: [], walls: [], area: 0 });
          cc.walls.push([px, py, qx, qy]);
          touched[cy * W + cx] = 1;
        }
      }
    }
    /* cells whose shape equals the plain tile need no special drawing */
    var count = 0;
    for (var key in touched) {
      var ki = +key, tx = ki % W, ty = (ki - tx) / W, cl = cells[ki];
      var full = Math.abs(cl.area) > 0.999, isSolid = sol(tx, ty);
      var plain = isSolid && full && plainWalls(cl, tx, ty, sol);
      if (plain) cells[ki] = null; else count++;
    }
    /* solid tiles left outside every simplified outline are cut away completely */
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (sol(x, y) && cells[y * W + x] === undefined) { cells[y * W + x] = { polys: [], walls: [], area: 0 }; count++; }
    }
    stats.cells = count;
    stats.ms = Date.now() - t0;
    return stats;
  }
  /* a full tile with only its own bottom edge as wall = drawn the normal way */
  function plainWalls(cl, x, y, sol) {
    for (var i = 0; i < cl.walls.length; i++) {
      var wl = cl.walls[i];
      if (wl[1] !== y + 1 || wl[3] !== y + 1) return false;
    }
    return cl.walls.length ? !sol(x, y + 1) : true;
  }

  function cell(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return cells[y * W + x] || null;
  }
  /* baked shapes (tools/bake.py): save() gives a compact object, load() puts it back instead of build() */
  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  /* skip(i, cell) -> true leaves a cell out (the reader treats it as plain); numbers are stored
     relative to their tile, so most are short like 0, 1 or 0.5 */
  function save(skip) {
    var d = { v: 2, W: W, H: H, regions: stats.regions, ncells: stats.cells, outl: [], idx: [], area: [], np: [], pl: [], pv: [], nw: [], wv: [] };
    var i, j, k, c, p, last = 0;
    for (i = 0; i < outl.length; i++) { p = []; for (j = 0; j < outl[i].length; j++) p.push(r4(outl[i][j])); d.outl.push(p); }
    for (i = 0; i < W * H; i++) {
      c = cells[i];
      if (!c || (skip && skip(i, c))) continue;
      var tx = i % W, ty = (i - tx) / W;
      d.idx.push(i - last); last = i;
      d.area.push(r4(c.area));
      d.np.push(c.polys.length);
      for (j = 0; j < c.polys.length; j++) { p = c.polys[j]; d.pl.push(p.length); for (k = 0; k < p.length; k++) d.pv.push(r4(p[k] - (k & 1 ? ty : tx))); }
      d.nw.push(c.walls.length);
      for (j = 0; j < c.walls.length; j++) for (k = 0; k < 4; k++) d.wv.push(r4(c.walls[j][k] - (k & 1 ? ty : tx)));
    }
    return d;
  }
  function load(d) {
    W = d.W; H = d.H; cells = new Array(W * H); outl = d.outl;
    var i, j, k, n, c, p, at = 0, pi = 0, pv = 0, wv = 0;
    for (n = 0; n < d.idx.length; n++) {
      at += d.idx[n];
      var tx = at % W, ty = (at - tx) / W;
      c = { polys: [], walls: [], area: d.area[n] };
      for (j = 0; j < d.np[n]; j++) {
        p = d.pv.slice(pv, pv + d.pl[pi]); pv += d.pl[pi++];
        for (k = 0; k < p.length; k++) p[k] += k & 1 ? ty : tx;
        c.polys.push(p);
      }
      for (j = 0; j < d.nw[n]; j++, wv += 4) c.walls.push([d.wv[wv] + tx, d.wv[wv + 1] + ty, d.wv[wv + 2] + tx, d.wv[wv + 3] + ty]);
      cells[at] = c;
    }
    stats.regions = d.regions; stats.cells = d.ncells; stats.ms = 0;
    return stats;
  }
  function debugStats() { return { regions: stats.regions, cells: stats.cells, ms: stats.ms }; }
  /* simplified outlines as flat [x0,y0,x1,y1,...] loops (solid on the right of each edge) */
  function outlines() { return outl; }
  return { build: build, cell: cell, outlines: outlines, debugStats: debugStats, make: make, save: save, load: load };
})();
