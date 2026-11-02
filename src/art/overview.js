var OVERVIEW = (function () {
  var CH = 32; // chunk size in tiles
  var cache = {}; // key "cx,cy,k" -> canvas
  var levels = {}; // key "cx,cy" -> k currently cached
  var chunkKeys = []; // list of "cx,cy" strings currently cached
  var state = false; // hysteresis state
  var lastRows = null, lastW = 0, lastH = 0;
  var compId = null, compW = 0, compH = 0, compRows = null;
  var blockCol = {}; // component id -> rgb array

  function getTp() {
    return Art.project(1, 0, 0).x - Art.project(0, 0, 0).x;
  }
  function limit() {
    var l = (window.CONFIG && CONFIG.overviewTilePx !== undefined) ? CONFIG.overviewTilePx : 9;
    return l;
  }
  function use(G) {
    var tp = getTp(), l = limit();
    if (state) { if (tp > l * 1.2) state = false; }
    else { if (tp < l) state = true; }
    return state;
  }
  function invalidate() {
    cache = {}; levels = {}; chunkKeys = [];
    lastRows = null;
    compId = null; compRows = null; blockCol = {};
  }

  function hash(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return (h ^ (h >> 16)) & 0x7fffffff;
  }
  function rowChar(rows, x, y) {
    if (y < 0 || y >= rows.length) return '.';
    var r = rows[y];
    if (!r) return '.';
    var c = r.charAt(x);
    return c || '.';
  }
  var PAL = {
    paris: [[185,178,166],[169,163,154],[154,162,173],[196,180,157]],
    other: [[184,165,150],[156,158,163],[168,146,127],[183,176,165]]
  };
  function isB(ch) { return ch === '#' || ch === 'S'; }
  function isBuildChar(ch) { return ch === '#' || ch === 'S'; }

  function buildComponents(rows, w, h, style) {
    compId = new Int32Array(w * h);
    compRows = rows;
    blockCol = {};
    var pal = style === "paris" ? PAL.paris : PAL.other;
    var stack = new Int32Array(w * h);
    var next = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (compId[idx] !== 0) continue;
        if (!isBuildChar(rowChar(rows, x, y))) continue;
        next++;
        var sp = 0;
        stack[sp++] = idx;
        compId[idx] = next;
        while (sp > 0) {
          var cur = stack[--sp];
          var cxx = cur % w, cyy = (cur / w) | 0;
          var nb = [cur - 1, cur + 1, cur - w, cur + w];
          var nx = [cxx - 1, cxx + 1, cxx, cxx];
          var ny = [cyy, cyy, cyy - 1, cyy + 1];
          for (var d = 0; d < 4; d++) {
            var nxx = nx[d], nyy = ny[d];
            if (nxx < 0 || nxx >= w || nyy < 0 || nyy >= h) continue;
            var nidx = nyy * w + nxx;
            if (compId[nidx] !== 0) continue;
            if (!isBuildChar(rowChar(rows, nxx, nyy))) continue;
            compId[nidx] = next;
            stack[sp++] = nidx;
          }
        }
        var hh = hash(next * 7919 + 104729, next * 6271 + 31);
        blockCol[next] = pal[hh % pal.length];
      }
    }
    compW = w; compH = h;
  }
  function getComp(x, y) {
    if (!compId) return 0;
    if (x < 0 || x >= compW || y < 0 || y >= compH) return 0;
    return compId[y * compW + x];
  }
  function bcol(x, y) {
    var id = getComp(x, y);
    if (!id || !blockCol[id]) return 'rgb(170,165,158)';
    // per 6x5 cell with brick-bond offset; deterministic shade within +/- 7%
    var cy = Math.floor(y / 5);
    var cx = Math.floor((x + (cy % 2 ? 3 : 0)) / 6);
    var sh = hash(id * 131 + cx * 17 + cy * 7 + 5, cx * 29 + cy * 13 + id) % 15;
    var f = 1 + (sh - 7) / 100; // 0.93 .. 1.07
    var c = blockCol[id];
    return 'rgb(' + Math.floor(c[0] * f) + ',' + Math.floor(c[1] * f) + ',' + Math.floor(c[2] * f) + ')';
  }
  function cellShade(x, y, id) {
    var cy = Math.floor(y / 5);
    var cx = Math.floor((x + (cy % 2 ? 3 : 0)) / 6);
    return hash(id * 131 + cx * 17 + cy * 7 + 5, cx * 29 + cy * 13 + id) % 15;
  }
  function shade(rgb, f) {
    var m = rgb.match(/\d+/g);
    if (!m) return rgb;
    return 'rgb(' + Math.floor(m[0] * f) + ',' + Math.floor(m[1] * f) + ',' + Math.floor(m[2] * f) + ')';
  }

  // render one chunk at k px/tile into a canvas
  function renderChunk(cx, cy, k, rows, w, h, style, station, sites) {
    if (!compId || compRows !== rows || compW !== w || compH !== h) {
      buildComponents(rows, w, h, style);
    }
    var cw = Math.min(CH, w - cx * CH), chh = Math.min(CH, h - cy * CH);
    if (cw <= 0 || chh <= 0) return null;
    var cv = document.createElement('canvas');
    cv.width = cw * k; cv.height = chh * k;
    var g = cv.getContext('2d');
    var x0 = cx * CH, y0 = cy * CH;
    var i, j, ch;
    // ground passes: fill runs per row for base chars
    for (j = 0; j < chh; j++) {
      var y = y0 + j;
      i = 0;
      while (i < cw) {
        ch = rowChar(rows, x0 + i, y);
        var colr;
        if (ch === '.') colr = '#d3d6db';
        else if (ch === 'a') colr = '#c3c6cb';
        else if (ch === 'P') colr = '#e3dccd';
        else if (ch === 'G' || ch === 'T') colr = '#9cc489';
        else if (ch === 'W') colr = '#7fb2d9';
        else if (isBuildChar(ch)) { i++; continue; }
        else colr = '#d3d6db';
        var st = i;
        while (i < cw) {
          var c2 = rowChar(rows, x0 + i, y);
          var cc;
          if (c2 === '.') cc = '#d3d6db';
          else if (c2 === 'a') cc = '#c3c6cb';
          else if (c2 === 'P') cc = '#e3dccd';
          else if (c2 === 'G' || c2 === 'T') cc = '#9cc489';
          else if (c2 === 'W') cc = '#7fb2d9';
          else if (isBuildChar(c2)) break;
          else cc = '#d3d6db';
          if (cc !== colr) break;
          i++;
        }
        g.fillStyle = colr;
        g.fillRect(st * k, j * k, (i - st) * k, k);
      }
    }
    // ground shadows (north + east sides of buildings), before buildings drawn
    if (k >= 4) {
      var sw = Math.max(1, 0.45 * k), ew = Math.max(1, 0.3 * k);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      for (j = 0; j < chh; j++) {
        var ys = y0 + j;
        for (i = 0; i < cw; i++) {
          var xs = x0 + i;
          if (isBuildChar(rowChar(rows, xs, ys))) continue;
          if (isBuildChar(rowChar(rows, xs, ys - 1))) {
            g.fillRect(i * k, j * k, k, sw);
          }
          if (isBuildChar(rowChar(rows, xs - 1, ys))) {
            g.fillRect(i * k, j * k, ew, k);
          }
        }
      }
    }
    // buildings + shops, using block colour + per-cell shade + shade-change seam
    for (j = 0; j < chh; j++) {
      var yy = y0 + j;
      for (i = 0; i < cw; i++) {
        var xx = x0 + i;
        ch = rowChar(rows, xx, yy);
        if (isBuildChar(ch)) {
          g.fillStyle = bcol(xx, yy);
          g.fillRect(i * k, j * k, k, k);
        }
      }
    }
    // seam lines between cells of same block where shade changes (k>=4)
    if (k >= 4) {
      g.fillStyle = 'rgba(0,0,0,0.10)';
      for (j = 0; j < chh; j++) {
        var yl = y0 + j;
        for (i = 0; i < cw; i++) {
          var xl = x0 + i;
          var cl = rowChar(rows, xl, yl);
          if (!isBuildChar(cl)) continue;
          var id = getComp(xl, yl);
          if (!id) continue;
          var s0 = cellShade(xl, yl, id);
          // east neighbour
          if (isBuildChar(rowChar(rows, xl + 1, yl)) && getComp(xl + 1, yl) === id) {
            if (cellShade(xl + 1, yl, id) !== s0) {
              g.fillRect(i * k + k - 1, j * k, 1, k);
            }
          }
          // south neighbour
          if (isBuildChar(rowChar(rows, xl, yl + 1)) && getComp(xl, yl + 1) === id) {
            if (cellShade(xl, yl + 1, id) !== s0) {
              g.fillRect(i * k, j * k + k - 1, k, 1);
            }
          }
        }
      }
    }
    // trees, water edges, speckles
    if (k >= 4) {
      for (j = 0; j < chh; j++) {
        var y2 = y0 + j;
        for (i = 0; i < cw; i++) {
          var x2 = x0 + i;
          var cc2 = rowChar(rows, x2, y2);
          if (cc2 === 'T') {
            g.fillStyle = '#4f7d4a';
            g.beginPath();
            g.arc((i + 0.5) * k, (j + 0.5) * k, 0.45 * k, 0, 6.2832);
            g.fill();
          } else if (cc2 === 'G') {
            if (hash(x2, y2) % 7 === 0) {
              g.fillStyle = 'rgba(70,120,60,0.25)';
              g.fillRect(i * k + k * 0.2, j * k + k * 0.2, k * 0.35, k * 0.35);
            }
          } else if (cc2 === 'W') {
            var nn = rowChar(rows, x2, y2 - 1);
            if (nn !== 'W' && (nn === '.' || nn === 'a' || nn === 'G' || nn === 'T' || nn === 'P' || isBuildChar(nn))) {
              g.fillStyle = '#b8d8ef';
              g.fillRect(i * k, j * k, k, Math.max(1, k * 0.15));
            }
            var n2 = rowChar(rows, x2 - 1, y2);
            if (n2 !== 'W' && !isBuildChar(n2) && n2 !== undefined) {
              g.fillStyle = '#b8d8ef';
              g.fillRect(i * k, j * k, Math.max(1, k * 0.15), k);
            }
          }
        }
      }
      // shop awnings
      for (j = 0; j < chh; j++) {
        var y3 = y0 + j;
        for (i = 0; i < cw; i++) {
          var x3 = x0 + i;
          if (rowChar(rows, x3, y3) !== 'S') continue;
          var aw = ['#d0473a', '#2f7d5b', '#2f5d9a'];
          g.fillStyle = aw[hash(x3, y3) % 3];
          var below = rowChar(rows, x3, y3 + 1);
          var above = rowChar(rows, x3, y3 - 1);
          var left = rowChar(rows, x3 - 1, y3);
          var right = rowChar(rows, x3 + 1, y3);
          var t = Math.max(1, k * 0.12);
          if (below === '.' || below === 'a') g.fillRect(i * k, j * k + k - t, k, t);
          else if (above === '.' || above === 'a') g.fillRect(i * k, j * k, k, t);
          else if (left === '.' || left === 'a') g.fillRect(i * k, j * k, t, k);
          else if (right === '.' || right === 'a') g.fillRect(i * k + k - t, j * k, t, k);
        }
      }
    }
    // fake depth bands on building edges (south/east darker)
    for (j = 0; j < chh; j++) {
      var y4 = y0 + j;
      for (i = 0; i < cw; i++) {
        var x4 = x0 + i;
        var cc4 = rowChar(rows, x4, y4);
        if (isBuildChar(cc4)) {
          var col4 = bcol(x4, y4);
          var south = rowChar(rows, x4, y4 + 1);
          if (!isBuildChar(south)) {
            g.fillStyle = shade(col4, 0.7);
            g.fillRect(i * k, j * k + k * 0.75, k, k * 0.25);
          }
          var east = rowChar(rows, x4 + 1, y4);
          if (!isBuildChar(east)) {
            g.fillStyle = shade(col4, 0.7);
            g.fillRect(i * k + k * 0.88, j * k, k * 0.12, k);
          }
        }
      }
    }
    if (k >= 4) {
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      for (j = 0; j < chh; j++) {
        var y5 = y0 + j;
        for (i = 0; i < cw; i++) {
          var x5 = x0 + i;
          if (!isBuildChar(rowChar(rows, x5, y5))) continue;
          var s5 = rowChar(rows, x5, y5 + 1);
          var e5 = rowChar(rows, x5 + 1, y5);
          if (!isBuildChar(s5)) {
            g.beginPath(); g.moveTo(i * k, j * k + k); g.lineTo(i * k + k, j * k + k); g.stroke();
          }
          if (!isBuildChar(e5)) {
            g.beginPath(); g.moveTo(i * k + k, j * k); g.lineTo(i * k + k, j * k + k); g.stroke();
          }
        }
      }
    }
    // landmarks + station
    if (station) drawFoot(g, station, x0, y0, k, '#5b6b85', k >= 3 ? 'P' : null);
    if (sites) {
      for (i = 0; i < sites.length; i++) {
        var s = sites[i];
        var colr2;
        if (s.type === 'gov') colr2 = '#e6dfcf';
        else if (s.type === 'church') colr2 = '#55606b';
        else if (s.type === 'theatre') colr2 = '#c9a77c';
        else colr2 = '#dddddd';
        drawFoot(g, s, x0, y0, k, colr2, null);
        if (s.type === 'gov') {
          g.fillStyle = '#6f8a72';
          var cxm = (s.x - x0 + s.w / 2) * k, cym = (s.y - y0 + s.h / 2) * k;
          g.beginPath(); g.arc(cxm, cym, Math.max(1, Math.min(s.w, s.h) * k * 0.25), 0, 6.2832); g.fill();
        } else if (s.type === 'church') {
          g.strokeStyle = '#f0f0f0'; g.lineWidth = Math.max(1, k * 0.15);
          var mx = (s.x - x0 + s.w / 2) * k, my = (s.y - y0 + s.h / 2) * k, r = Math.min(s.w, s.h) * k * 0.25;
          g.beginPath(); g.moveTo(mx - r, my); g.lineTo(mx + r, my); g.moveTo(mx, my - r); g.lineTo(mx, my + r); g.stroke();
        } else if (s.type === 'statue' || s.type === 'column') {
          g.fillStyle = '#f0ede4';
          g.fillRect((s.x - x0) * k, (s.y - y0) * k, s.w * k, s.h * k);
          g.fillStyle = '#3a3a3a';
          g.beginPath(); g.arc((s.x - x0 + s.w / 2) * k, (s.y - y0 + s.h / 2) * k, Math.min(s.w, s.h) * k * 0.22, 0, 6.2832); g.fill();
        }
      }
    }
    return cv;
  }
  function drawFoot(g, s, x0, y0, k, col, label) {
    var fx = (s.x - x0) * k, fy = (s.y - y0) * k, fw = s.w * k, fh = s.h * k;
    if (fx + fw < 0 || fy + fh < 0 || fx > g.canvas.width || fy > g.canvas.height) return;
    g.fillStyle = col;
    g.fillRect(fx, fy, fw, fh);
    if (label) {
      g.fillStyle = '#ffffff';
      g.font = 'bold ' + Math.max(6, Math.floor(fh * 0.6)) + 'px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, fx + fw / 2, fy + fh / 2);
    }
  }
  function ck(cx, cy, k) { return cx + ',' + cy + ',' + k; }

  function draw(ctx, G) {
    var rows = MAP.rows;
    if (rows !== lastRows || MAP.width !== lastW || MAP.height !== lastH) {
      invalidate(); lastRows = rows; lastW = MAP.width; lastH = MAP.height;
    }
    var tp = getTp();
    if (!tp) return;
    var dpr = window.devicePixelRatio || 1;
    var k = Math.min(8, Math.max(2, Math.ceil(tp * dpr)));
    if (k > 2) k = (k <= 4) ? 4 : 8;
    var W = MAP.width, H = MAP.height;
    var ncx = Math.ceil(W / CH), ncy = Math.ceil(H / CH);
    // visible tile bounds
    var o = Art.project(0, 0, 0);
    var lw = MAP.width * CONFIG.tileSize, lh = MAP.height * CONFIG.tileSize;
    var vx0 = (0 - o.x) / tp, vy0 = (0 - o.y) / tp;
    var vx1 = (lw - o.x) / tp, vy1 = (lh - o.y) / tp;
    var cx0 = Math.max(0, Math.floor(vx0 / CH)), cx1 = Math.min(ncx - 1, Math.floor(vx1 / CH));
    var cy0 = Math.max(0, Math.floor(vy0 / CH)), cy1 = Math.min(ncy - 1, Math.floor(vy1 / CH));
    var rendered = 0, MAXR = 6;
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var key = ck(cx, cy, k);
        var cv = cache[key];
        if (!cv) {
          var prev = levels[cx + ',' + cy];
          if (prev !== undefined && prev !== k) {
            delete cache[ck(cx, cy, prev)];
          }
          if (rendered < MAXR) {
            cv = renderChunk(cx, cy, k, rows, W, H, MAP.style, MAP.station, MAP.sites);
            if (cv) {
              cache[key] = cv; levels[cx + ',' + cy] = k;
              if (chunkKeys.indexOf(cx + ',' + cy) < 0) chunkKeys.push(cx + ',' + cy);
            }
            rendered++;
          }
        }
        var x0 = cx * CH, y0 = cy * CH;
        var p0 = Art.project(x0, y0, 0);
        var p1 = Art.project(Math.min(W, x0 + CH), Math.min(H, y0 + CH), 0);
        if (cv) {
          ctx.drawImage(cv, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        } else {
          ctx.fillStyle = '#c9ccd1';
          ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        }
      }
    }
    // live overlay: broken shops
    if (G.shops) {
      for (var i = 0; i < G.shops.length; i++) {
        var s = G.shops[i];
        if (!s.broken) continue;
        var pp = Art.project(s.x, s.y, 0);
        var pw = tp * 2;
        ctx.fillStyle = 'rgba(30,20,20,0.75)';
        ctx.beginPath();
        ctx.arc(pp.x + pw / 2, pp.y + tp / 2, tp * 0.9, 0, 6.2832);
        ctx.fill();
      }
    }
    // labels
    if (tp >= 4 && MAP.sites) {
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var m = 0; m < MAP.sites.length; m++) {
        var si = MAP.sites[m];
        if (!si.name) continue;
        var sp = Art.project(si.x + si.w / 2, si.y + si.h / 2, 0);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(si.name, sp.x, sp.y);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(si.name, sp.x, sp.y);
      }
    }
  }

  function peopleDots(ctx, G) {
    var tp = getTp();
    if (!tp) return;
    var r = Math.max(1.2, 0.28 * tp);
    var useRect = r < 2;
    var buckets = [[], [], [], []];
    var agents = G.agents || [];
    var t = G.time || 0;
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (!a.active) continue;
      var col = 0;
      if (a.revealedUntil && a.revealedUntil > t) col = 3;
      else if (a.mood > 70) col = 2;
      else if (a.mood >= 40) col = 1;
      buckets[col].push(a);
    }
    var cols = ['#6aa9ff', '#ffb347', '#ff5a4f', '#b000ff'];
    for (var b = 0; b < 4; b++) {
      var arr = buckets[b];
      if (!arr.length) continue;
      ctx.fillStyle = cols[b];
      ctx.beginPath();
      for (var j = 0; j < arr.length; j++) {
        var p = Art.project(arr[j].x, arr[j].y, 0);
        if (useRect) ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        else { ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, 6.2832); }
      }
      ctx.fill();
    }
    // officers
    var offs = G.officers || [];
    if (offs.length) {
      ctx.fillStyle = '#1b2c8f';
      ctx.beginPath();
      for (var o = 0; o < offs.length; o++) {
        var op = Art.project(offs[o].x, offs[o].y, 0);
        if (useRect) ctx.rect(op.x - r, op.y - r, r * 2, r * 2);
        else { ctx.moveTo(op.x + r, op.y); ctx.arc(op.x, op.y, r, 0, 6.2832); }
      }
      ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var o2 = 0; o2 < offs.length; o2++) {
        var op2 = Art.project(offs[o2].x, offs[o2].y, 0);
        if (useRect) ctx.rect(op2.x - r, op2.y - r, r * 2, r * 2);
        else { ctx.moveTo(op2.x + r, op2.y); ctx.arc(op2.x, op2.y, r, 0, 6.2832); }
      }
      ctx.stroke();
    }
    // vehicles
    var veh = G.vehicles || [];
    if (veh.length) {
      var vw = Math.max(4, tp * 1.7), vh = Math.max(2, tp * 0.8);
      for (var v = 0; v < veh.length; v++) {
        var vp = Art.project(veh[v].x, veh[v].y, 0);
        ctx.save();
        ctx.translate(vp.x, vp.y);
        ctx.rotate(veh[v].ang || 0);
        var base = '#ffffff';
        if (veh[v].type === 'watertruck') base = '#3f7fd0';
        else if (veh[v].type === 'ambulance') base = '#c8e05a';
        ctx.fillStyle = base;
        ctx.fillRect(-vw / 2, -vh / 2, vw, vh);
        ctx.fillStyle = '#1b4fa0';
        ctx.fillRect(-vw / 2, -vh / 2, vw * 0.3, vh);
        ctx.restore();
      }
    }
  }

  return { use: use, draw: draw, peopleDots: peopleDots, invalidate: invalidate };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OVERVIEW;
