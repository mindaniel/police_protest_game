/* art.js - isometric low-poly renderer for the protest scenario.
 * Light city: cached ground texture, extruded buildings (Path2D per diagonal),
 * capsule people, 3D vehicles, depth-sorted by diagonal, plus a camera
 * (wheel zoom, right/middle-drag pan, arrow keys, H = low buildings, 0 = reset).
 * Reads MAP/CONFIG/G only inside functions. Classic script, ES5, no images.
 * Tests never load this file.
 */
var Art = (function () {
  "use strict";

  var TS = 32, ZU = 18;                  // world units per tile, per height unit
  var SQUAD_COLORS = ["#e63946", "#f4a261", "#2a9d8f", "#e9c46a", "#9b5de5", "#00b4d8"];
  var GT = 24;                           // ground texture pixels per tile

  var cam = { cx: 50, cy: 32, zoom: 1, S: 1, OX: 0, OY: 0, fit: 1 };
  var W = 0, H = 0, LW = 1600, LH = 1024, ND = 0;
  var heights = null, tints = null, shopIdx = null;
  var diags = null, shopTiles = null;
  var groundCv = null, _dirty = true, lowMode = false;
  var trees = [], lamps = [];
  var buckets = [], ghosts = [];
  var palettes = null;
  var _G = null, _rs = 1, _px = 0, _py = 0;
  var inputBound = false, drag = null;
  var cityVer = 0, HMAXZ = 2.6;

  /* ---------- helpers ---------- */
  function rnd(seed) {
    var s = (seed >>> 0) || 1;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  }
  function hash2(x, y) {
    var h = (x * 73856093) ^ (y * 19349663) ^ (x * 13 + y * 7);
    h = (h ^ (h >>> 13)) >>> 0;
    return h;
  }
  function tile(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return "#";
    return MAP.rows[y].charAt(x);
  }
  function solidCh(ch) { return ch === "#" || ch === "S"; }
  function hAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    return heights[y * W + x];
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rgb(c, k) {
    return "rgb(" + clamp(c[0] * k | 0, 0, 255) + "," + clamp(c[1] * k | 0, 0, 255) + "," + clamp(c[2] * k | 0, 0, 255) + ")";
  }
  function hexRgb(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function sqCol(s) { return SQUAD_COLORS[((s % 6) + 6) % 6]; }

  /* ---------- camera / projection ---------- */
  function updateCamera() {
    cam.fit = LW / (W * TS);
    cam.zoom = clamp(cam.zoom, 1, 6);
    cam.S = cam.fit * cam.zoom;
    var vw = LW / cam.S, vh = LH / cam.S;
    var x0 = W * TS - vw, y0 = H * TS - vh;
    cam.cx = clamp(cam.cx, vw / 2 / TS, x0 > 0 ? (W * TS - vw / 2) / TS : W / 2);
    cam.cy = clamp(cam.cy, vh / 2 / TS, y0 > 0 ? (H * TS - vh / 2) / TS : H / 2);
    cam.OX = LW / 2 - cam.S * cam.cx * TS;
    cam.OY = LH / 2 - cam.S * cam.cy * TS;
  }
  function P(x, y, z) {
    _px = cam.OX + cam.S * x * TS;
    _py = cam.OY + cam.S * (y * TS - (z || 0) * ZU);
  }
  function project(x, y, z) {
    P(x, y, z || 0);
    return { x: _px, y: _py };
  }
  function screenToTile(lx, ly) {
    return { x: ((lx - cam.OX) / cam.S) / TS, y: ((ly - cam.OY) / cam.S) / TS };
  }
  function setScreen(ctx) { ctx.setTransform(_rs, 0, 0, _rs, 0, 0); }
  function setIso(ctx) { ctx.setTransform(_rs * cam.S, 0, 0, _rs * cam.S, _rs * cam.OX, _rs * cam.OY); }
  function setGround(ctx, unit) {
    var a = cam.S * TS / unit;
    ctx.setTransform(_rs * a, 0, 0, _rs * a, _rs * cam.OX, _rs * cam.OY);
  }
  /* For UI: draw in tile-pixel units (tileSize per tile) on the ground plane. */
  function groundBegin(ctx) {
    var m = ctx.getTransform ? ctx.getTransform() : null;
    _rs = m ? m.a : _rs;
    ctx.save();
    setGround(ctx, CONFIG.tileSize);
  }
  function groundEnd(ctx) { ctx.restore(); }

  function panScreen(dlx, dly) {
    cam.cx += (dlx / cam.S) / TS;
    cam.cy += (dly / cam.S) / TS;
    updateCamera();
  }
  function zoomAt(lx, ly, f) {
    var a = screenToTile(lx, ly);
    cam.zoom = clamp(cam.zoom * f, 1, 6);
    updateCamera();
    var b = screenToTile(lx, ly);
    cam.cx += a.x - b.x;
    cam.cy += a.y - b.y;
    updateCamera();
  }

  function bindInput() {
    if (inputBound || typeof document === "undefined") return;
    var cv = document.getElementById("game");
    if (!cv) return;
    inputBound = true;
    function logical(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * LW, y: (e.clientY - r.top) / r.height * LH };
    }
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = logical(e);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("mousedown", function (e) {
      if (e.button === 1) { drag = logical(e); e.preventDefault(); }
    });
    window.addEventListener("mousemove", function (e) {
      if (!drag) return;
      var p = logical(e);
      panScreen(drag.x - p.x, drag.y - p.y);
      drag = p;
    });
    window.addEventListener("mouseup", function () { drag = null; });
    window.addEventListener("keydown", function (e) {
      var k = e.key, step = 80;
      if (k === "ArrowLeft") panScreen(-step, 0);
      else if (k === "ArrowRight") panScreen(step, 0);
      else if (k === "ArrowUp") panScreen(0, -step);
      else if (k === "ArrowDown") panScreen(0, step);
      else if (k === "+" || k === "=") zoomAt(LW / 2, LH / 2, 1.25);
      else if (k === "-" || k === "_") zoomAt(LW / 2, LH / 2, 0.8);
      else if (k === "0" || k === "Home") { cam.zoom = 1; updateCamera(); }
      else if (k === "h" || k === "H") { lowMode = !lowMode; buildCity(); }
      else return;
      if (k.indexOf("Arrow") === 0) e.preventDefault();
    });
  }

  /* ---------- city geometry ---------- */
  function computeHeights() {
    heights = new Float32Array(W * H);
    tints = new Uint8Array(W * H);
    var x, y;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var ch = tile(x, y), i = y * W + x;
        if (ch === "#") {
          var lx = Math.floor((x + 2) / 5), ly = Math.floor((y + 1) / 4);
          var r = rnd(hash2(lx * 7 + 3, ly * 5 + 11));
          heights[i] = lowMode ? 0.3 : 0.7 + r * 1.0;
          tints[i] = hash2(lx, ly) % 3;
        } else if (ch === "S") {
          heights[i] = lowMode ? 0.3 : 0.8;
          tints[i] = 3;
        }
      }
    }
  }

  function ix(x, y) { return x * TS; }
  function iy(x, y, z) { return y * TS - z * ZU; }
  function quad(p, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    p.moveTo(ix(x0, y0), iy(x0, y0, z0));
    p.lineTo(ix(x1, y1), iy(x1, y1, z1));
    p.lineTo(ix(x2, y2), iy(x2, y2, z2));
    p.lineTo(ix(x3, y3), iy(x3, y3, z3));
    p.closePath();
  }
  function newSet() {
    var o = { tops: [new Path2D(), new Path2D(), new Path2D()], sw: new Path2D(),
      winS: new Path2D(), shTop: new Path2D(), shS: new Path2D(),
      rTop: new Path2D(), rS: new Path2D(), roof: false, shop: false };
    return o;
  }
  /* Axis-aligned box faces (top, south) into a set's paths. */
  function addBox(set, x0, y0, x1, y1, z0, z1, pt, ps, showS) {
    quad(pt, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
    if (showS) quad(ps, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1);
  }

  function buildCity() {
    computeHeights();
    cityVer++;
    HMAXZ = 0.5;
    for (var hi = 0; hi < heights.length; hi++) if (heights[hi] + 0.5 > HMAXZ) HMAXZ = heights[hi] + 0.5;
    ND = H;
    diags = new Array(ND);
    shopTiles = new Array(ND);
    var x, y;
    if (typeof Path2D === "undefined") return;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var h = heights[y * W + x];
        if (!(h > 0)) continue;
        var d = y, set = diags[d] || (diags[d] = newSet());
        var hS = hAt(x, y + 1);
        var showS = hS < h, z, a;
        if (tints[y * W + x] === 3) {
          set.shop = true;
          addBox(set, x, y, x + 1, y + 1, 0, h, set.shTop, set.shS, showS);
          /* fronts facing a street: south is drawn on the wall, north/east/west as a roof-edge strip */
          var oN = !solidCh(tile(x, y - 1)), oE = !solidCh(tile(x + 1, y)), oW = !solidCh(tile(x - 1, y));
          if (showS || oN || oE || oW) (shopTiles[d] || (shopTiles[d] = [])).push({ x: x, y: y, s: showS, n: oN, e: oE, w: oW, h: h, i: shopIdx[y * W + x] });
          continue;
        }
        addBox(set, x, y, x + 1, y + 1, 0, h, set.tops[tints[y * W + x]], set.sw, showS);
        if (lowMode) continue;
        for (z = Math.max(hS, 0) + 0.28; z + 0.22 < h - 0.12; z += 0.45) {
          if (!showS) break;
          for (a = 0; a < 2; a++) {
            var xa = x + 0.16 + a * 0.4;
            quad(set.winS, xa, y + 1, z, xa + 0.26, y + 1, z, xa + 0.26, y + 1, z + 0.22, xa, y + 1, z + 0.22);
          }
        }
        if (!showS && hAt(x - 1, y) === h && hAt(x, y - 1) === h && hash2(x, y) % 9 === 0) {
          set.roof = true;
          addBox(set, x + 0.22, y + 0.25, x + 0.78, y + 0.75, h, h + 0.22, set.rTop, set.rS, true);
        }
      }
    }
  }

  /* ---------- ground texture ---------- */
  function buildGround() {
    if (typeof document === "undefined") return;
    cityVer++;
    groundCv = document.createElement("canvas");
    groundCv.width = W * GT;
    groundCv.height = H * GT;
    var g = groundCv.getContext("2d"), x, y, ch, t = GT;
    var base = { ".": "#eef1f5", "P": "#e4e8ee", "G": "#bfd8a8", "a": "#d4dae2", "#": "#cdd4dd", "S": "#cdd4dd" };
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        ch = tile(x, y);
        g.fillStyle = base[ch] || "#e3e8ee";
        g.fillRect(x * t, y * t, t + 1, t + 1);
        if (ch === "G" && hash2(x, y) % 2 === 0) {
          g.fillStyle = "rgba(90,140,70,0.18)";
          g.fillRect(x * t + rnd(hash2(x, y)) * t * 0.6, y * t + rnd(hash2(y, x)) * t * 0.6, t * 0.3, t * 0.25);
        }
      }
    }
    /* sidewalks + curbs along buildings */
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        ch = tile(x, y);
        if (solidCh(ch) || ch === "G") continue;
        var sw = t * 0.26;
        g.fillStyle = ch === "P" ? "#e6eaf0" : "#f1f4f7";
        if (solidCh(tile(x, y - 1))) g.fillRect(x * t, y * t, t, sw);
        if (solidCh(tile(x, y + 1))) g.fillRect(x * t, y * t + t - sw, t, sw);
        if (solidCh(tile(x - 1, y))) g.fillRect(x * t, y * t, sw, t);
        if (solidCh(tile(x + 1, y))) g.fillRect(x * t + t - sw, y * t, sw, t);
        g.fillStyle = "#c6ceda";
        if (solidCh(tile(x, y - 1))) g.fillRect(x * t, y * t + sw, t, 1.5);
        if (solidCh(tile(x, y + 1))) g.fillRect(x * t, y * t + t - sw - 1.5, t, 1.5);
        if (solidCh(tile(x - 1, y))) g.fillRect(x * t + sw, y * t, 1.5, t);
        if (solidCh(tile(x + 1, y))) g.fillRect(x * t + t - sw - 1.5, y * t, 1.5, t);
      }
    }
    /* soft cast shadows: light from the north-west */
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (solidCh(tile(x, y))) continue;
        var gr;
        if (solidCh(tile(x - 1, y))) {
          gr = g.createLinearGradient(x * t, 0, x * t + t * 0.8, 0);
          gr.addColorStop(0, "rgba(70,85,110,0.22)"); gr.addColorStop(1, "rgba(70,85,110,0)");
          g.fillStyle = gr; g.fillRect(x * t, y * t, t * 0.8, t);
        }
        if (solidCh(tile(x, y - 1))) {
          gr = g.createLinearGradient(0, y * t, 0, y * t + t * 0.8);
          gr.addColorStop(0, "rgba(70,85,110,0.22)"); gr.addColorStop(1, "rgba(70,85,110,0)");
          g.fillStyle = gr; g.fillRect(x * t, y * t, t, t * 0.8);
        }
      }
    }
    /* lane markings in corridors */
    function run(x0, y0, dx, dy) {
      var n = 0, xx = x0, yy = y0;
      while (tile(xx, yy) === ".") { n++; xx += dx; yy += dy; }
      return n;
    }
    g.fillStyle = "rgba(255,255,255,0.95)";
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (tile(x, y) !== ".") continue;
        var up = run(x, y - 1, 0, -1), dn = run(x, y + 1, 0, 1), vext = up + dn + 1;
        var lf = run(x - 1, y, -1, 0), rt = run(x + 1, y, 1, 0), hext = lf + rt + 1;
        if (vext === 3 && up === 1 && hext > 4) g.fillRect(x * t + t * 0.15, y * t + t * 0.46, t * 0.45, t * 0.08);
        if (vext === 2 && up === 0 && hext > 4) g.fillRect(x * t + t * 0.15, y * t + t - t * 0.04, t * 0.45, t * 0.08);
        if (hext === 3 && lf === 1 && vext > 4) g.fillRect(x * t + t * 0.46, y * t + t * 0.15, t * 0.08, t * 0.45);
        if (hext === 2 && lf === 0 && vext > 4) g.fillRect(x * t + t - t * 0.04, y * t + t * 0.15, t * 0.08, t * 0.45);
      }
    }
    /* plaza paving + central ring */
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 1;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (tile(x, y) === "P") g.strokeRect(x * t + 0.5, y * t + 0.5, t - 1, t - 1);
      }
    }
    var pc = MAP.plazaCenter;
    g.fillStyle = "#cbd3de";
    g.beginPath(); g.arc((pc.x + 0.5) * t, (pc.y + 0.5) * t, t * 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e4e9f0";
    g.beginPath(); g.arc((pc.x + 0.5) * t, (pc.y + 0.5) * t, t * 2.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#b9c3d0"; g.lineWidth = 2;
    g.beginPath(); g.arc((pc.x + 0.5) * t, (pc.y + 0.5) * t, t * 1.2, 0, Math.PI * 2); g.stroke();
  }

  function buildProps() {
    trees = []; lamps = [];
    var x, y;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var ch = tile(x, y);
        if (ch === "G" && hash2(x, y) % 3 === 0) {
          trees.push({ x: x + 0.3 + rnd(hash2(x, y)) * 0.4, y: y + 0.3 + rnd(hash2(y, x)) * 0.4, s: 0.8 + rnd(hash2(x + 9, y)) * 0.5 });
        }
        if (ch === "." && x % 7 === 3) {
          if (solidCh(tile(x, y - 1)) && tile(x, y + 1) === "." && tile(x, y + 2) === ".") lamps.push({ x: x + 0.5, y: y + 0.22 });
          if (solidCh(tile(x, y + 1)) && tile(x, y - 1) === "." && tile(x, y - 2) === ".") lamps.push({ x: x + 0.5, y: y + 0.78 });
        }
      }
    }
  }

  function buildPalettes() {
    var calm = ["#4a8fe7", "#38b2c4", "#5b9bd5", "#2e9e94", "#6f8fe0", "#4fb0a0"];
    var red = hexRgb("#d62839"), i, s;
    palettes = [];
    for (i = 0; i < calm.length; i++) {
      var c = hexRgb(calm[i]), row = [];
      for (s = 0; s <= 10; s++) {
        var m = mix(c, red, s / 10);
        row.push({ id: i + ":" + s, base: rgb(m, 1), dark: rgb(m, 0.78), light: rgb(mix(m, [255, 255, 255], 0.35), 1) });
      }
      palettes.push(row);
    }
  }

  function mapShops(G) {
    shopIdx = new Int16Array(W * H);
    var i, k;
    for (k = 0; k < W * H; k++) shopIdx[k] = -1;
    if (!G || !G.shops) return;
    for (i = 0; i < G.shops.length; i++) {
      var s = G.shops[i], dx, dy;
      for (dy = 0; dy < 2; dy++) for (dx = 0; dx < 2; dx++) {
        var x = s.x + dx, y = s.y + dy;
        if (x < W && y < H && tile(x, y) === "S") shopIdx[y * W + x] = i;
      }
    }
  }

  function invalidate() { _dirty = true; }

  function init(G) {
    _G = G;
    W = MAP.width; H = MAP.height;
    LW = W * CONFIG.tileSize; LH = H * CONFIG.tileSize;
    if (!heights) { cam.cx = W / 2; cam.cy = H / 2; }
    updateCamera();
    mapShops(G);
    buildCity();
    buildGround();
    buildProps();
    buildPalettes();
    bindInput();
    _dirty = false;
  }

  /* ---------- primitives ---------- */
  function capsule(ctx, x, by, r, h, fill) {
    ctx.beginPath();
    ctx.arc(x, by - r, r, 0, Math.PI);
    ctx.lineTo(x - r, by - h + r);
    ctx.arc(x, by - h + r, r, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function disc(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  /* Oriented box: along heading (c,sn) from f0..f1, half-width w2, z0..z1. */
  function obox(ctx, cx, cy, c, sn, f0, f1, w2, z0, z1, top, side, band) {
    var fs = [f0, f1, f1, f0], ws = [-w2, -w2, w2, w2], X = [], Y = [], i;
    for (i = 0; i < 4; i++) { X.push(cx + c * fs[i] - sn * ws[i]); Y.push(cy + sn * fs[i] + c * ws[i]); }
    var mx = cx + c * (f0 + f1) / 2, my = cy + sn * (f0 + f1) / 2;
    for (i = 0; i < 4; i++) {
      var j = (i + 1) % 4;
      var nx = (X[i] + X[j]) / 2 - mx, ny = (Y[i] + Y[j]) / 2 - my, nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      if (ny <= 0.001) continue;
      var k = 0.86 + 0.14 * ny;
      ctx.beginPath();
      P(X[i], Y[i], z0); ctx.moveTo(_px, _py);
      P(X[j], Y[j], z0); ctx.lineTo(_px, _py);
      P(X[j], Y[j], z1); ctx.lineTo(_px, _py);
      P(X[i], Y[i], z1); ctx.lineTo(_px, _py);
      ctx.closePath();
      ctx.fillStyle = rgb(side, k);
      ctx.fill();
      if (band) {
        ctx.beginPath();
        P(X[i], Y[i], band[3]); ctx.moveTo(_px, _py);
        P(X[j], Y[j], band[3]); ctx.lineTo(_px, _py);
        P(X[j], Y[j], band[4]); ctx.lineTo(_px, _py);
        P(X[i], Y[i], band[4]); ctx.lineTo(_px, _py);
        ctx.closePath();
        ctx.fillStyle = rgb(band, k);
        ctx.fill();
      }
    }
    ctx.beginPath();
    for (i = 0; i < 4; i++) { P(X[i], Y[i], z1); if (i) ctx.lineTo(_px, _py); else ctx.moveTo(_px, _py); }
    ctx.closePath();
    ctx.fillStyle = top;
    ctx.fill();
  }
  /* ---------- sprites ---------- */
  var BLOC_PAL = { id: "bloc", base: "#2b2d33", dark: "#16171b", light: "#4a4d55" };
  function agentPal(a) {
    if (a.blocDressed) return BLOC_PAL;   /* black bloc: dark clothes */
    var row = palettes[hash2(a.id | 0, 7) % palettes.length];
    var t = clamp((a.mood - 45) / 40, 0, 1);
    return row[Math.round(t * 10)];
  }

  /* Pre-drawn body sprites (capsule + head), one per colour, per zoom level. */
  var SPR = { k: 0, map: {} };
  function agentSprite(id, dark, base, light) {
    var k = _rs * cam.S;
    if (SPR.k !== k) { SPR.k = k; SPR.map = {}; }
    var e = SPR.map[id];
    if (e) return e;
    var r = 2.9, hb = 8.6, w = r * 2 + 2, h = hb + 1.8 + 2.3 + 2;
    var c = makeCanvas(w * k, h * k), g = c.getContext("2d");
    var ax = (r + 1) * k, ay = (h - 1) * k;
    g.setTransform(k, 0, 0, k, ax, ay);
    capsule(g, 0, 0, r, hb, dark);
    capsule(g, -r * 0.25, -0.4, r * 0.72, hb - 0.8, base);
    disc(g, 0, -hb - 1.8, 2.3, light);
    e = { c: c, ax: ax, ay: ay };
    SPR.map[id] = e;
    return e;
  }

  function drawAgent(ctx, a, t) {
    var s = cam.S;
    P(a.x, a.y, 0);
    var bx = _px, by = _py;
    var sp2 = (a.vx || 0) * (a.vx || 0) + (a.vy || 0) * (a.vy || 0);
    if (sp2 > 0.02) by -= Math.abs(Math.sin(t * 11 + a.id)) * 1.3 * s;
    var r = 2.9 * s, hb = 8.6 * s;
    var revealed = a.role === "rioter" && _G && _G.time < a.revealedUntil;
    var pal = agentPal(a);
    var base = revealed ? "#ff2338" : pal.base, dark = revealed ? "#b3121f" : pal.dark;
    var hid = hash2(a.id | 0, 3);
    var placard = !revealed && hid % 4 === 0;
    if (placard) {
      var wob = a.mood > 65 ? Math.sin(t * 9 + a.id) * 1.5 * s : 0;
      var px = bx + r * 1.1 + wob, top = by - hb - 7 * s;
      ctx.strokeStyle = "#6b4f2a"; ctx.lineWidth = Math.max(0.6, 0.8 * s);
      ctx.beginPath(); ctx.moveTo(bx + r * 0.8, by - hb * 0.45); ctx.lineTo(px, top + 3 * s); ctx.stroke();
      ctx.fillStyle = hid % 8 === 0 ? "#ffffff" : "#f6c445";
      ctx.fillRect(px - 3.6 * s, top - 2.2 * s, 7.2 * s, 4.6 * s);
      ctx.fillStyle = "rgba(60,40,10,0.55)";
      ctx.fillRect(px - 2.4 * s, top - 0.4 * s, 4.8 * s, 0.8 * s);
    }
    var sp = revealed ? agentSprite("R", dark, base, "#ff6b78") : agentSprite(pal.id, dark, base, pal.light);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sp.c, _rs * bx - sp.ax, _rs * by - sp.ay);
    setScreen(ctx);
    if (a.hasTool) {
      ctx.strokeStyle = "#2b2b2b"; ctx.lineWidth = Math.max(0.8, 1.1 * s);
      ctx.beginPath(); ctx.moveTo(bx - r, by - hb * 0.4); ctx.lineTo(bx - r - 3 * s, by - hb - 2 * s); ctx.stroke();
    }
    if (revealed) {
      var my = by - hb - 7.5 * s - Math.abs(Math.sin(t * 5)) * 2 * s, ms = Math.max(3, 3 * s);
      ctx.beginPath();
      ctx.moveTo(bx, my); ctx.lineTo(bx - ms, my - ms * 1.4); ctx.lineTo(bx + ms, my - ms * 1.4); ctx.closePath();
      ctx.fillStyle = "#ff2338"; ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function officerAng(o) {
    var dx = o.tx - o.x, dy = o.ty - o.y;
    if (dx * dx + dy * dy > 0.04) o._artAng = Math.atan2(dy, dx);
    return typeof o._artAng === "number" ? o._artAng : Math.PI;
  }

  function drawShield(ctx, o, c, sn) {
    var ox = o.x + c * 0.3, oy = o.y + sn * 0.3, w = 0.26;
    ctx.beginPath();
    P(ox + sn * w, oy - c * w, 0.05); ctx.moveTo(_px, _py);
    P(ox - sn * w, oy + c * w, 0.05); ctx.lineTo(_px, _py);
    P(ox - sn * w, oy + c * w, 0.95); ctx.lineTo(_px, _py);
    P(ox + sn * w, oy - c * w, 0.95); ctx.lineTo(_px, _py);
    ctx.closePath();
    ctx.fillStyle = "rgba(170,195,220,0.85)";
    ctx.fill();
    ctx.strokeStyle = "#2c3a4c"; ctx.lineWidth = Math.max(0.6, 0.6 * cam.S);
    ctx.stroke();
  }

  function drawOfficer(ctx, o, t) {
    var s = cam.S, ang = officerAng(o), c = Math.cos(ang), sn = Math.sin(ang);
    var firm = o.stance === "firm", bike = o.baseSpeed >= CONFIG.motorbikeSpeed;
    if (bike) {
      ctx.strokeStyle = "#22262e"; ctx.lineWidth = Math.max(1, 1.6 * s);
      P(o.x - c * 0.38, o.y - sn * 0.38, 0.12); var ax = _px, ay = _py;
      P(o.x + c * 0.4, o.y + sn * 0.4, 0.12);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(_px, _py); ctx.stroke();
      disc(ctx, ax, ay, 1.8 * s, "#22262e"); disc(ctx, _px, _py, 1.8 * s, "#22262e");
      ctx.strokeStyle = sqCol(o.squad); ctx.lineWidth = Math.max(1, 2 * s);
      P(o.x - c * 0.25, o.y - sn * 0.25, 0.32); ax = _px; ay = _py;
      P(o.x + c * 0.3, o.y + sn * 0.3, 0.38);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(_px, _py); ctx.stroke();
    }
    var front = c + sn > 0;
    if (firm && !front) drawShield(ctx, o, c, sn);
    P(o.x, o.y, bike ? 0.25 : 0);
    var bx = _px, by = _py, r = 3.2 * s, hb = 9 * s;
    capsule(ctx, bx, by, r, hb, firm ? "#151a22" : "#16294a");
    capsule(ctx, bx - r * 0.25, by - 0.4 * s, r * 0.72, hb - 0.8 * s, firm ? "#2a323f" : "#24406e");
    if (!firm) { ctx.fillStyle = "#d9f24a"; ctx.fillRect(bx - r, by - hb * 0.62, r * 2, 1.6 * s); }
    disc(ctx, bx, by - hb - 2 * s, 2.6 * s, firm ? "#0f1218" : "#1b2c4a");
    if (firm) { ctx.fillStyle = "rgba(150,190,230,0.8)"; ctx.fillRect(bx - 1.8 * s, by - hb - 2.4 * s, 3.6 * s, 1.1 * s); }
    disc(ctx, bx, by - hb - 4 * s, Math.max(1, 1.2 * s), sqCol(o.squad));
    if (firm && front) drawShield(ctx, o, c, sn);
    if (typeof o.stamina === "number" && o.stamina < 100) {
      var bw = 9 * s, frac = clamp(o.stamina / 100, 0, 1), yb = by - hb - 8 * s;
      ctx.fillStyle = "rgba(20,25,35,0.6)"; ctx.fillRect(bx - bw / 2, yb, bw, Math.max(1, 1.3 * s));
      ctx.fillStyle = frac > 0.5 ? "#3fbf5f" : (frac > 0.25 ? "#e8b422" : "#e63946");
      ctx.fillRect(bx - bw / 2, yb, bw * frac, Math.max(1, 1.3 * s));
    }
  }

  function drawDetainee(ctx, d) {
    var s = cam.S;
    if (d.officer) {
      P(d.officer.x, d.officer.y, 0.45); var ax = _px, ay = _py;
      P(d.x, d.y, 0.45);
      ctx.strokeStyle = "#e0b520"; ctx.lineWidth = Math.max(0.8, 0.8 * s);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(_px, _py); ctx.stroke();
    }
    P(d.x, d.y, 0);
    var small = d.state === "loading" ? 0.75 : 1;
    capsule(ctx, _px, _py, 2.6 * s * small, 7.6 * s * small, "#8d96a2");
    disc(ctx, _px, _py - 7.6 * s * small - 1.6 * s, 2 * s * small, "#b7bec8");
  }

  var C_WHITE = [236, 240, 245], C_BLUE = [42, 93, 176], C_DARK = [44, 48, 56];
  function vehAng(v) {
    if (typeof v.ang === "number") return v.ang;
    var dx = v.tx - v.x, dy = v.ty - v.y;
    if (dx * dx + dy * dy > 0.04) v._artAng = Math.atan2(dy, dx);
    return typeof v._artAng === "number" ? v._artAng : 0;
  }
  function drawVehicle(ctx, v, t) {
    var ang = vehAng(v), c = Math.cos(ang), sn = Math.sin(ang), x = v.x, y = v.y;
    var on = (t % 0.6) < 0.3;
    if (v.type === "car") {
      obox(ctx, x, y, c, sn, -0.85, 0.85, 0.4, 0, 0.14, "#2a2f38", C_DARK);
      obox(ctx, x, y, c, sn, -0.9, 0.9, 0.42, 0.12, 0.48, "#f5f7fa", C_WHITE, [42, 93, 176, 0.24, 0.34]);
      obox(ctx, x, y, c, sn, -0.45, 0.35, 0.36, 0.48, 0.76, "#dde6f0", [110, 140, 180]);
      obox(ctx, x, y, c, sn, -0.18, 0.06, 0.3, 0.76, 0.84, on ? "#ff3b3b" : "#3b7dff", on ? [200, 40, 40] : [40, 90, 210]);
    } else if (v.type === "watertruck") {
      obox(ctx, x, y, c, sn, -1.25, 1.25, 0.48, 0, 0.16, "#2a2f38", C_DARK);
      obox(ctx, x, y, c, sn, -1.3, 0.55, 0.5, 0.14, 0.95, "#3b8ae0", [30, 111, 208]);
      obox(ctx, x, y, c, sn, 0.62, 1.3, 0.5, 0.14, 0.9, "#f2f5f9", C_WHITE, [42, 93, 176, 0.4, 0.5]);
      obox(ctx, x, y, c, sn, 0.75, 1.0, 0.3, 0.9, 0.98, on ? "#ff3b3b" : "#3b7dff", on ? [200, 40, 40] : [40, 90, 210]);
      var tx = x + c, ty = y + sn;
      if (_G && _G.waterFx && _G.time < _G.waterFx.until) { tx = _G.waterFx.x; ty = _G.waterFx.y; }
      var ta = Math.atan2(ty - (y + sn * 0.3), tx - (x + c * 0.3));
      P(x + c * 0.3, y + sn * 0.3, 1.02); var ax = _px, ay = _py;
      P(x + c * 0.3 + Math.cos(ta) * 0.6, y + sn * 0.3 + Math.sin(ta) * 0.6, 1.12);
      disc(ctx, ax, ay, 2.6 * cam.S, "#d9e1ea");
      ctx.strokeStyle = "#596678"; ctx.lineWidth = Math.max(1, 1.8 * cam.S);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(_px, _py); ctx.stroke();
    } else {
      obox(ctx, x, y, c, sn, -1.25, 1.25, 0.48, 0, 0.16, "#2a2f38", C_DARK);
      obox(ctx, x, y, c, sn, -1.3, 0.6, 0.5, 0.14, 0.38, "#59616d", [80, 88, 100]);
      obox(ctx, x, y, c, sn, -1.15, -0.3, 0.32, 0.38, 0.62, "#f3f3f3", [230, 230, 230], [214, 48, 49, 0.46, 0.54]);
      obox(ctx, x, y, c, sn, -0.2, 0.5, 0.32, 0.38, 0.62, "#f3f3f3", [230, 230, 230], [214, 48, 49, 0.46, 0.54]);
      obox(ctx, x, y, c, sn, 0.65, 1.3, 0.5, 0.14, 0.92, "#f7cf2a", [240, 190, 20]);
      obox(ctx, x, y, c, sn, 0.8, 1.05, 0.3, 0.92, 1.0, on ? "#ff3b3b" : "#3b7dff", on ? [200, 40, 40] : [40, 90, 210]);
    }
  }

  function barrierAng(G, b) {
    var i, ns = false, ew = false;
    for (i = 0; i < G.barriers.length; i++) {
      var o = G.barriers[i];
      if (o.x === b.x && Math.abs(o.y - b.y) === 1) ns = true;
      if (o.y === b.y && Math.abs(o.x - b.x) === 1) ew = true;
    }
    if (ns) return Math.PI / 2;
    if (ew) return 0;
    return (tile(b.x, b.y - 1) === "." || tile(b.x, b.y + 1) === ".") ? 0 : Math.PI / 2;
  }
  function drawBarrier(ctx, b) {
    var a = b._artAng || 0;
    obox(ctx, b.x + 0.5, b.y + 0.5, Math.cos(a), Math.sin(a), -0.49, 0.49, 0.2, 0, 0.42, "#f4f4f4", [232, 232, 232], [214, 48, 49, 0.16, 0.28]);
  }

  function drawTree(ctx, tr) {
    var s = cam.S * tr.s;
    P(tr.x, tr.y, 0);
    ctx.fillStyle = "#7a5a3a";
    ctx.fillRect(_px - 0.8 * s, _py - 7 * s, 1.6 * s, 7 * s);
    disc(ctx, _px, _py - 11 * s, 6 * s, "#5f9a52");
    disc(ctx, _px - 1.6 * s, _py - 12.5 * s, 4 * s, "#79b467");
  }
  function drawLamp(ctx, l) {
    var s = cam.S;
    P(l.x, l.y, 0); var ax = _px, ay = _py;
    P(l.x, l.y, 1.8);
    ctx.strokeStyle = "#5d6878"; ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(_px, _py); ctx.lineTo(_px + 3 * s, _py + 1 * s); ctx.stroke();
    disc(ctx, _px + 3 * s, _py + 1.5 * s, 1.4 * s, "#fff4c8");
  }

  function drawObj(ctx, it, t) {
    if (it.k === 0) drawAgent(ctx, it.o, t);
    else if (it.k === 1) drawOfficer(ctx, it.o, t);
    else if (it.k === 2) drawVehicle(ctx, it.o, t);
    else if (it.k === 3) drawBarrier(ctx, it.o);
    else if (it.k === 4) drawDetainee(ctx, it.o);
    else if (it.k === 5) drawTree(ctx, it.o);
    else drawLamp(ctx, it.o);
  }

  /* ---------- per-frame passes ---------- */
  var pool = [], poolN = 0;
  function push(k, o, x, y) {
    var it = pool[poolN] || (pool[poolN] = { k: 0, o: null });
    poolN++;
    it.k = k; it.o = o;
    var b = clamp(Math.floor(y), 0, ND);
    (buckets[b] || (buckets[b] = [])).push(it);
    if (k <= 2 && (k === 2 || hAt(Math.floor(x), Math.floor(y) + 1) > 0.4)) ghosts.push(it);
  }

  function collect(G) {
    var i;
    poolN = 0; ghosts.length = 0;
    for (i = 0; i < buckets.length; i++) if (buckets[i]) buckets[i].length = 0;
    for (i = 0; i < trees.length; i++) push(5, trees[i], trees[i].x, trees[i].y);
    for (i = 0; i < lamps.length; i++) push(6, lamps[i], lamps[i].x, lamps[i].y);
    if (!G) return;
    if (G.agents) for (i = 0; i < G.agents.length; i++) { var a = G.agents[i]; if (a.active) push(0, a, a.x, a.y); }
    if (G.barriers) for (i = 0; i < G.barriers.length; i++) {
      var b = G.barriers[i];
      if (typeof b._artAng !== "number") b._artAng = barrierAng(G, b);
      push(3, b, b.x + 0.5, b.y + 0.5);
    }
    if (G.vehicles) for (i = 0; i < G.vehicles.length; i++) push(2, G.vehicles[i], G.vehicles[i].x, G.vehicles[i].y);
    if (G.officers) for (i = 0; i < G.officers.length; i++) push(1, G.officers[i], G.officers[i].x, G.officers[i].y);
    if (G.detainees) for (i = 0; i < G.detainees.length; i++) push(4, G.detainees[i], G.detainees[i].x, G.detainees[i].y);
  }

  function drawBackdrop(ctx) {
    var gr = ctx.createLinearGradient(0, 0, 0, LH);
    gr.addColorStop(0, "#eef1f5"); gr.addColorStop(1, "#dde3ea");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, LW, LH);
  }

  function drawGround(ctx) {
    if (!groundCv) return;
    setGround(ctx, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(groundCv, 0, 0, W, H);
    setScreen(ctx);
  }
  function drawDecals(ctx, G) {
    var i, o, a;
    setGround(ctx, 1);
    ctx.beginPath();
    if (G.agents) for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a.active) continue;
      ctx.moveTo(a.x + 0.33, a.y + 0.08); ctx.arc(a.x + 0.08, a.y + 0.08, 0.25, 0, Math.PI * 2);
    }
    if (G.officers) for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      ctx.moveTo(o.x + 0.36, o.y + 0.08); ctx.arc(o.x + 0.08, o.y + 0.08, 0.28, 0, Math.PI * 2);
    }
    for (i = 0; i < trees.length; i++) {
      ctx.moveTo(trees[i].x + 0.65 * trees[i].s, trees[i].y + 0.25);
      ctx.arc(trees[i].x + 0.25, trees[i].y + 0.25, 0.4 * trees[i].s, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(50,62,85,0.2)";
    ctx.fill();
    if (G.vehicles) {
      ctx.fillStyle = "rgba(50,62,85,0.22)";
      for (i = 0; i < G.vehicles.length; i++) {
        var v = G.vehicles[i], ang = vehAng(v), c = Math.cos(ang), sn = Math.sin(ang);
        var L = v.type === "car" ? 1.0 : 1.4, w2 = 0.55;
        var vx = v.x + 0.15, vy = v.y + 0.15;
        ctx.beginPath();
        ctx.moveTo(vx - c * L + sn * w2, vy - sn * L - c * w2);
        ctx.lineTo(vx + c * L + sn * w2, vy + sn * L - c * w2);
        ctx.lineTo(vx + c * L - sn * w2, vy + sn * L + c * w2);
        ctx.lineTo(vx - c * L - sn * w2, vy - sn * L + c * w2);
        ctx.closePath(); ctx.fill();
      }
    }
    if (G.officers) {
      ctx.lineWidth = 0.07;
      for (i = 0; i < G.officers.length; i++) {
        o = G.officers[i];
        ctx.strokeStyle = sqCol(o.squad);
        ctx.beginPath(); ctx.arc(o.x, o.y, 0.36, 0, Math.PI * 2); ctx.stroke();
        if (o.busy) {
          ctx.strokeStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(o.x, o.y, 0.47, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    if (G.agents) {
      ctx.lineWidth = 0.09;
      ctx.strokeStyle = "#f2a900";
      for (i = 0; i < G.agents.length; i++) {
        a = G.agents[i];
        if (!a.active || !(a.suspicion > 20)) continue;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.suspicion / 100));
        ctx.stroke();
      }
    }
    if (G.waterFx && G.time < G.waterFx.until) {
      var R = CONFIG.waterRadius || 3;
      ctx.fillStyle = "rgba(110,180,250,0.28)";
      ctx.beginPath(); ctx.arc(G.waterFx.x, G.waterFx.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(90,160,240,0.8)"; ctx.lineWidth = 0.1; ctx.stroke();
    }
    if (G.shoveFx && G.time < G.shoveFx.until) {
      var sk = (G.shoveFx.until - G.time) / 0.6;
      ctx.strokeStyle = "rgba(35,45,60," + (0.7 * sk).toFixed(2) + ")";
      ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.arc(G.shoveFx.x, G.shoveFx.y, G.shoveFx.r * (1.15 - sk * 0.5), 0, Math.PI * 2); ctx.stroke();
    }
    setScreen(ctx);
  }

  /* Shop window seen from above: a strip along the roof edge that faces the
   * street, showing glass, shutter (grey, ribbed), cracks or the broken glow. */
  function drawRoofFront(ctx, st, shop, t, s) {
    var x = st.x, y = st.y, z = st.h, k = 0.3, sides = [], i;
    if (st.n) sides.push([x, y, x + 1, y + k]);
    if (st.e) sides.push([x + 1 - k, y, x + 1, y + 1]);
    if (st.w) sides.push([x, y, x + k, y + 1]);
    for (i = 0; i < sides.length; i++) {
      var r = sides[i], vert = (r[2] - r[0]) < 0.5;
      ctx.beginPath();
      P(r[0], r[1], z); ctx.moveTo(_px, _py); P(r[2], r[1], z); ctx.lineTo(_px, _py);
      P(r[2], r[3], z); ctx.lineTo(_px, _py); P(r[0], r[3], z); ctx.lineTo(_px, _py);
      ctx.closePath();
      if (shop.broken) {
        ctx.fillStyle = "#2b2622"; ctx.fill();
        ctx.fillStyle = "rgba(255,140,40," + (0.3 + 0.2 * Math.sin(t * 13 + x)).toFixed(2) + ")"; ctx.fill();
        continue;
      }
      ctx.fillStyle = shop.glass === 2 ? "#7fb0d8" : "#9cc6e6"; ctx.fill();
      var sh = shop.shutter || 0;
      if (sh > 0) {
        /* shutter rolls across the strip from the building side */
        ctx.beginPath();
        if (vert) {
          var x0 = st.e ? r[2] - (r[2] - r[0]) * sh : r[0], x1 = st.e ? r[2] : r[0] + (r[2] - r[0]) * sh;
          P(x0, r[1], z); ctx.moveTo(_px, _py); P(x1, r[1], z); ctx.lineTo(_px, _py);
          P(x1, r[3], z); ctx.lineTo(_px, _py); P(x0, r[3], z); ctx.lineTo(_px, _py);
        } else {
          var y1 = r[1] + (r[3] - r[1]) * sh;
          P(r[0], r[1], z); ctx.moveTo(_px, _py); P(r[2], r[1], z); ctx.lineTo(_px, _py);
          P(r[2], y1, z); ctx.lineTo(_px, _py); P(r[0], y1, z); ctx.lineTo(_px, _py);
        }
        ctx.closePath(); ctx.fillStyle = "#8a8f94"; ctx.fill();
        ctx.strokeStyle = "rgba(60,65,70,0.7)"; ctx.lineWidth = Math.max(0.4, 0.4 * s); ctx.stroke();
      }
      if (shop.hp < 100) {
        var n = Math.min(4, 2 + Math.floor((100 - shop.hp) / 40)), c;
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = Math.max(0.4, 0.5 * s);
        for (c = 0; c < n; c++) {
          var u = rnd(hash2(x * 5 + i, c * 3 + 1)), v = rnd(hash2(y * 5 + i, c * 3 + 2)), a = rnd(hash2(x + y, c)) * Math.PI;
          var cx = r[0] + (r[2] - r[0]) * (0.15 + 0.7 * u), cy = r[1] + (r[3] - r[1]) * (0.15 + 0.7 * v);
          ctx.beginPath();
          P(cx - Math.cos(a) * 0.08, cy - Math.sin(a) * 0.08, z); ctx.moveTo(_px, _py);
          P(cx + Math.cos(a) * 0.08, cy + Math.sin(a) * 0.08, z); ctx.lineTo(_px, _py);
          ctx.stroke();
        }
      }
    }
  }

  function drawShopDecor(ctx, list, G, t) {
    var i, s = cam.S;
    for (i = 0; i < list.length; i++) {
      var st = list[i], shop = (G && G.shops && st.i >= 0) ? G.shops[st.i] : null;
      var broken = shop && shop.broken;
      var aw = ["#e63946", "#2a9d8f", "#f4a261", "#4a7fd0"][(st.i < 0 ? 0 : st.i) % 4];
      var fx = st.x, fy = st.y, glass = broken ? "#2b2622" : "#9cc6e6";
      if (!st.s) { if (shop) drawRoofFront(ctx, st, shop, t, s); continue; }
      if (shop && shop.glass === 2) glass = "#7fb0d8";
      ctx.beginPath();
      P(fx + 0.12, fy + 1, 0.06); ctx.moveTo(_px, _py); P(fx + 0.88, fy + 1, 0.06); ctx.lineTo(_px, _py);
      P(fx + 0.88, fy + 1, 0.46); ctx.lineTo(_px, _py); P(fx + 0.12, fy + 1, 0.46); ctx.lineTo(_px, _py);
      ctx.closePath();
      ctx.fillStyle = glass; ctx.fill();
      if (broken) {
        ctx.fillStyle = "rgba(255,140,40," + (0.25 + 0.2 * Math.sin(t * 13 + st.x)).toFixed(2) + ")";
        ctx.fill();
        continue;
      }
      var shut = shop ? (shop.shutter || 0) : 0;
      var hp = shop ? shop.hp : 100;
      var fy1 = fy + 1, sid = st.i < 0 ? 0 : st.i;
      if (hp < 100) {
        var n = Math.min(4, 2 + Math.floor((100 - hp) / 40));
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(0.4, 0.5 * s);
        for (var c = 0; c < n; c++) {
          var hx = rnd(hash2(sid * 7 + fx, c * 3 + 1)), hz = rnd(hash2(sid * 7 + fx, c * 3 + 2));
          var ang = rnd(hash2(sid * 7 + fx, c * 3 + 3)) * Math.PI;
          var cxp = fx + 0.2 + hx * 0.6, czp = 0.12 + hz * 0.28, len = 0.08 + hz * 0.06;
          ctx.beginPath();
          P(cxp - Math.cos(ang) * len, fy1, czp - Math.sin(ang) * len * 0.6); ctx.moveTo(_px, _py);
          P(cxp + Math.cos(ang) * len, fy1, czp + Math.sin(ang) * len * 0.6); ctx.lineTo(_px, _py);
          ctx.stroke();
        }
      }
      if (shut > 0) {
        /* roller shutter comes down from the top of the window (z 0.46) */
        var zt = 0.46, zb = 0.46 - 0.4 * shut;
        ctx.beginPath();
        P(fx + 0.12, fy1, zt); ctx.moveTo(_px, _py); P(fx + 0.88, fy1, zt); ctx.lineTo(_px, _py);
        P(fx + 0.88, fy1, zb); ctx.lineTo(_px, _py); P(fx + 0.12, fy1, zb); ctx.lineTo(_px, _py);
        ctx.closePath();
        ctx.fillStyle = "#8a8f94"; ctx.fill();
        ctx.strokeStyle = "rgba(60,65,70,0.7)";
        ctx.lineWidth = Math.max(0.4, 0.4 * s);
        for (var rz = zt - 0.06; rz > zb; rz -= 0.07) {
          ctx.beginPath();
          P(fx + 0.13, fy1, rz); ctx.moveTo(_px, _py); P(fx + 0.87, fy1, rz); ctx.lineTo(_px, _py);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      P(fx, fy + 1, 0.62); ctx.moveTo(_px, _py); P(fx + 1, fy + 1, 0.62); ctx.lineTo(_px, _py);
      P(fx + 1, fy + 1.22, 0.5); ctx.lineTo(_px, _py); P(fx, fy + 1.22, 0.5); ctx.lineTo(_px, _py);
      ctx.closePath();
      ctx.fillStyle = aw; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = Math.max(0.5, 0.6 * s); ctx.stroke();
    }
  }

  function fillSet(ctx, d) {
    setIso(ctx);
    fillPaths(ctx, diags[d]);
    setScreen(ctx);
  }

  /* Fill one row's building paths in the current (world-unit) transform. */
  function fillPaths(ctx, p) {
    ctx.fillStyle = "#9fb0c4"; ctx.fill(p.sw);
    ctx.fillStyle = "#8193aa"; ctx.fill(p.winS);
    ctx.fillStyle = "#c5d0dd"; ctx.fill(p.tops[0]);
    ctx.fillStyle = "#bccad9"; ctx.fill(p.tops[1]);
    ctx.fillStyle = "#cbd5e1"; ctx.fill(p.tops[2]);
    if (p.shop) {
      ctx.fillStyle = "#eadfc9"; ctx.fill(p.shS);
      ctx.fillStyle = "#f3ece0"; ctx.fill(p.shTop);
    }
    if (p.roof) {
      ctx.fillStyle = "#b3c0cf"; ctx.fill(p.rS);
      ctx.fillStyle = "#e6ebf1"; ctx.fill(p.rTop);
    }
  }

  /* ---------- static layer cache ----------
   * Ground and buildings only change when the camera zooms, pans far or the
   * city is rebuilt, so they are rendered once into canvases: a background
   * (ground) and one strip per pair of rows. Each frame blits them; people
   * drawn between strips keep correct depth: objects on the first row of a
   * pair go before its strip, the second after it. */
  var SC = { k: 0, ver: -1, rx0: 0, rx1: 0, ry0: 0, ry1: 0, bg: null, strips: [], lastK: 0, zoomAt: 0 };

  function isoBounds() {
    return { x0: -2, x1: W * TS + 2, y0: -HMAXZ * ZU - 4, y1: H * TS + 4 };
  }
  function viewIso(m) {
    var x0 = -cam.OX / cam.S, x1 = (LW - cam.OX) / cam.S, y0 = -cam.OY / cam.S, y1 = (LH - cam.OY) / cam.S;
    var mx = (x1 - x0) * m, my = (y1 - y0) * m;
    return { x0: x0 - mx, x1: x1 + mx, y0: y0 - my, y1: y1 + my };
  }
  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function snap(v, o, k) { return o + Math.floor((v - o) * k) / k; }

  function buildCache() {
    var k = _rs * cam.S, b = isoBounds(), v = viewIso(0.25), d0;
    var rx0 = Math.max(b.x0, v.x0), rx1 = Math.min(b.x1, v.x1);
    var ry0 = Math.max(b.y0, v.y0), ry1 = Math.min(b.y1, v.y1);
    SC.k = k; SC.lastK = k; SC.ver = cityVer;
    SC.rx0 = rx0; SC.rx1 = rx1; SC.ry0 = ry0; SC.ry1 = ry1;
    var bg = makeCanvas((rx1 - rx0) * k, (ry1 - ry0) * k), g = bg.getContext("2d");
    g.setTransform(k, 0, 0, k, -rx0 * k, -ry0 * k);
    if (groundCv) {
      g.imageSmoothingEnabled = true;
      g.drawImage(groundCv, 0, 0, W * TS, H * TS);
    }
    SC.bg = { c: bg, ox: rx0, oy: ry0 };
    SC.strips = [];
    for (d0 = 0; d0 < ND; d0 += 2) {
      var e = null;
      if (diags && (diags[d0] || diags[d0 + 1])) {
        var sx0 = Math.max(rx0, 0), sx1 = Math.min(rx1, W * TS);
        var top = snap(Math.max(ry0, d0 * TS - HMAXZ * ZU - 1), ry0, k);
        var bot = Math.min(ry1, (d0 + 2) * TS + 1);
        if (bot > top && sx1 > sx0) {
          var c = makeCanvas((sx1 - sx0) * k, (bot - top) * k), cg = c.getContext("2d");
          cg.setTransform(k, 0, 0, k, -sx0 * k, -top * k);
          if (diags[d0]) fillPaths(cg, diags[d0]);
          if (diags[d0 + 1]) fillPaths(cg, diags[d0 + 1]);
          e = { c: c, ox: sx0, oy: top };
        }
      }
      SC.strips.push(e);
    }
  }

  /* Rebuild when the city changed, the view left the cached area, or a zoom
   * has settled (while the wheel is turning the old cache is scaled). */
  function ensureCache() {
    var k = _rs * cam.S, need = !SC.bg || SC.ver !== cityVer;
    if (!need) {
      if (Math.abs(k - SC.k) > 1e-6) {
        if (Math.abs(k - SC.lastK) > 1e-6) { SC.lastK = k; SC.zoomAt = Date.now(); }
        if (Date.now() - SC.zoomAt > 160) need = true;
      } else {
        var v = viewIso(0), b = isoBounds();
        if (Math.max(v.x0, b.x0) < SC.rx0 - 0.5 || Math.min(v.x1, b.x1) > SC.rx1 + 0.5 ||
            Math.max(v.y0, b.y0) < SC.ry0 - 0.5 || Math.min(v.y1, b.y1) > SC.ry1 + 0.5) need = true;
      }
    }
    if (need) buildCache();
  }

  function blit(ctx, e) {
    var sc = _rs * cam.S / SC.k;
    if (Math.abs(sc - 1) < 1e-6) {
      var bx = Math.round(_rs * (cam.OX + cam.S * SC.rx0)), by = Math.round(_rs * (cam.OY + cam.S * SC.ry0));
      ctx.drawImage(e.c, bx + Math.round((e.ox - SC.rx0) * SC.k), by + Math.round((e.oy - SC.ry0) * SC.k));
    } else {
      ctx.drawImage(e.c, _rs * (cam.OX + cam.S * e.ox), _rs * (cam.OY + cam.S * e.oy), e.c.width * sc, e.c.height * sc);
    }
  }
  function drawWater(ctx, G, t) {
    if (!G.waterFx || !(G.time < G.waterFx.until)) return;
    var fx = G.waterFx, i, N = 26, s = cam.S;
    ctx.strokeStyle = "rgba(170,215,255,0.55)";
    ctx.lineWidth = Math.max(1.5, 3 * s);
    ctx.beginPath();
    for (i = 0; i <= 16; i++) {
      var u = i / 16;
      P(fx.fromX + (fx.x - fx.fromX) * u, fx.fromY + (fx.y - fx.fromY) * u, 1.1 * (1 - u) + 2.2 * u * (1 - u));
      if (i) ctx.lineTo(_px, _py); else ctx.moveTo(_px, _py);
    }
    ctx.stroke();
    for (i = 0; i < N; i++) {
      var q = (i / N + t * 1.7) % 1;
      var jx = (rnd(hash2(i, 5)) - 0.5) * 0.5 * q, jy = (rnd(hash2(i, 9)) - 0.5) * 0.5 * q;
      P(fx.fromX + (fx.x - fx.fromX) * q + jx, fx.fromY + (fx.y - fx.fromY) * q + jy, 1.1 * (1 - q) + 2.2 * q * (1 - q));
      disc(ctx, _px, _py, (1 + q * 2) * s, "rgba(200,232,255," + (0.85 - q * 0.4).toFixed(2) + ")");
    }
  }

  function drawSmoke(ctx, G, t) {
    if (!G.shops) return;
    var i, k, s = cam.S;
    for (i = 0; i < G.shops.length; i++) {
      var sh = G.shops[i];
      if (!sh.broken) continue;
      for (k = 0; k < 7; k++) {
        var ph = (t * 0.22 + k / 7) % 1;
        P(sh.x + 1 + ph * 0.9, sh.y + 1 - ph * 0.3, 0.9 + ph * 4.5);
        disc(ctx, _px, _py, (3 + ph * 9) * s, "rgba(95,102,115," + (0.5 * (1 - ph)).toFixed(2) + ")");
      }
    }
  }

  function badge(ctx, x, y, text, col, gold) {
    ctx.font = "bold 10px Consolas, monospace";
    var w = ctx.measureText(text).width + 8;
    ctx.fillStyle = gold ? "#ffd23f" : "rgba(255,255,255,0.92)";
    ctx.fillRect(x - w / 2 - 1.5, y - 7.5, w + 3, 15);
    ctx.fillStyle = col;
    ctx.fillRect(x - w / 2, y - 6, w, 12);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
  }

  function drawTags(ctx, G) {
    var i, seen = {}, sel = (typeof UI !== "undefined") ? UI.selected : -1;
    if (G.officers) for (i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      if (seen[o.squad]) continue;
      seen[o.squad] = true;
      P(o.x, o.y, 1.55);
      badge(ctx, _px, _py - 4, String(o.squad + 1), sqCol(o.squad), o.squad === sel);
    }
    if (G.vehicles) for (i = 0; i < G.vehicles.length; i++) {
      var v = G.vehicles[i];
      P(v.x, v.y, 1.55);
      var nm = v.type === "car" ? "CAR" : (v.type === "watertruck" ? "WATER" : "BARRIER");
      badge(ctx, _px, _py - 4, (v.squad + 1) + " " + nm, sqCol(v.squad), v.squad === sel);
    }
  }

  /* ---------- public draw ---------- */
  function beginFrame(ctx, G) {
    if (!heights) init(G);
    if (_dirty) { mapShops(G); _dirty = false; }
    _G = G;
    var m = ctx.getTransform ? ctx.getTransform() : null;
    _rs = m ? m.a : 1;
    ctx.save();
    updateCamera();
  }

  function drawTerrain(ctx, G) {
    beginFrame(ctx, G);
    drawBackdrop(ctx);
    drawGround(ctx);
    var d;
    if (diags) for (d = 0; d < ND; d++) if (diags[d]) fillSet(ctx, d);
    ctx.restore();
  }
  function drawAgents(ctx, G) {
    beginFrame(ctx, G);
    var t = Date.now() / 1000, i;
    if (G && G.agents) for (i = 0; i < G.agents.length; i++) if (G.agents[i].active) drawAgent(ctx, G.agents[i], t);
    ctx.restore();
  }

  function drawPolice(ctx, G) {
    beginFrame(ctx, G);
    var t = Date.now() / 1000, i;
    if (G.barriers) for (i = 0; i < G.barriers.length; i++) drawBarrier(ctx, G.barriers[i]);
    if (G.vehicles) for (i = 0; i < G.vehicles.length; i++) drawVehicle(ctx, G.vehicles[i], t);
    if (G.officers) for (i = 0; i < G.officers.length; i++) drawOfficer(ctx, G.officers[i], t);
    if (G.detainees) for (i = 0; i < G.detainees.length; i++) drawDetainee(ctx, G.detainees[i]);
    ctx.restore();
  }

  function draw(ctx, G) {
    beginFrame(ctx, G);
    var t = Date.now() / 1000, d, i, b;
    var gr = ctx.createLinearGradient(0, 0, 0, LH);
    gr.addColorStop(0, "#eef1f5"); gr.addColorStop(1, "#dde3ea");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, LW, LH);
    var cached = typeof document !== "undefined";
    if (cached) {
      ensureCache();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      blit(ctx, SC.bg);
      setScreen(ctx);
    } else {
      drawBackdrop(ctx);
      drawGround(ctx);
    }
    drawDecals(ctx, G);
    collect(G);
    for (d = 0; d < ND; d++) {
      b = buckets[d];
      if (b) for (i = 0; i < b.length; i++) drawObj(ctx, b[i], t);
      if (cached) {
        if ((d & 1) === 0 && SC.strips[d >> 1]) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          blit(ctx, SC.strips[d >> 1]);
          setScreen(ctx);
        }
      } else if (diags && diags[d]) fillSet(ctx, d);
      if (shopTiles && shopTiles[d]) drawShopDecor(ctx, shopTiles[d], G, t);
    }
    b = buckets[ND];
    if (b) for (i = 0; i < b.length; i++) drawObj(ctx, b[i], t);
    drawWater(ctx, G, t);
    drawSmoke(ctx, G, t);
    if (typeof FX !== "undefined") FX.draw(ctx, G);
    if (typeof BAR !== "undefined") BAR.draw(ctx, G);
    if (typeof MEDIA !== "undefined") MEDIA.draw(ctx, G);
    if (typeof TACT !== "undefined") TACT.draw(ctx, G);
    if (typeof GAS !== "undefined") GAS.draw(ctx, G);
    ctx.globalAlpha = 0.28;
    for (i = 0; i < ghosts.length; i++) drawObj(ctx, ghosts[i], t);
    ctx.globalAlpha = 1;
    drawTags(ctx, G);
    ctx.restore();
  }
  return {
    invalidate: invalidate,
    init: init,
    drawTerrain: drawTerrain,
    drawAgents: drawAgents,
    drawPolice: drawPolice,
    draw: draw,
    project: project,
    screenToTile: screenToTile,
    groundBegin: groundBegin,
    groundEnd: groundEnd,
    panBy: panScreen,
    camera: cam
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Art;
}
