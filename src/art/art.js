/* art.js - isometric low-poly renderer for the protest scenario.
 * Light city: cached ground texture, extruded buildings (Path2D per diagonal),
 * capsule people, 3D vehicles, depth-sorted by diagonal, plus a camera
 * (wheel zoom, right/middle-drag pan, arrow keys, H = low buildings, Home = reset).
 * Reads MAP/CONFIG/G only inside functions. Classic script, ES5, no images.
 * Tests never load this file.
 */
var Art = (function () {
  "use strict";

  var TS = 32, ZU = 18;                  // world units per tile, per height unit (ZU set by setView)
  var VIEW_ZU = { top: 6, tilt: 26 };    // view modes: top-down / tilted 3D
  var viewMode = "tilt", _savedView = false;
  /* zoom detail levels (far / mid / near) */
  var MAX_ZOOM = 28;   /* close enough to see officers and car details */ var FAR_DIRTY = true; var FC = { c: null, key: "", w: 0, h: 0 }; var FARG = {}; var FARORDER = [];
  var SQUAD_COLORS = ["#e63946", "#f4a261", "#2a9d8f", "#e9c46a", "#9b5de5", "#00b4d8"];
  var GT = 32;                           // ground texture pixels per tile

  var cam = { cx: 50, cy: 32, zoom: 1, S: 1, OX: 0, OY: 0, fit: 1 };
  var W = 0, H = 0, LW = 1600, LH = 1024, ND = 0;
  var heights = null, tints = null, shopIdx = null;
  var diags = null, shopTiles = null;
  var groundCv = null, _dirty = true, lowMode = false;
  try { lowMode = localStorage.getItem("ppg_low") === "1"; } catch (e) {}
  var trees = [], lamps = [], tprops = [], streetProps = [];
  var TREE_CACHE = {};          /* key: variety + "|" + quantised scale -> {c, ax, ay} */
  var CLUTTER_CACHE = {};
  var TREE_VARS = null;         /* lazy-built list of variety descriptors */
  var TREE_VAR_KEYS = ["decid", "conifer", "bush"];
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
  /* Paris look (theme_paris.js) for Paris-style cities */
  function paris() { return typeof THEME_PARIS !== "undefined" && typeof MAP !== "undefined" && MAP.style === "paris"; }
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
  function loadView() {
    if (_savedView) return;
    _savedView = true;
    try {
      var v = localStorage.getItem("ppg_view");
      if (v === "top" || v === "tilt") viewMode = v;
    } catch (e) {}
    ZU = VIEW_ZU[viewMode];
  }

  function setView(mode) {
    if (mode !== "top" && mode !== "tilt") mode = "tilt";
    viewMode = mode;
    ZU = VIEW_ZU[viewMode];
    try { localStorage.setItem("ppg_view", viewMode); } catch (e) {}
    /* keep the camera centred on the same map point */
    var ccx = cam.cx, ccy = cam.cy;
    if (W > 0 && H > 0) {
      buildCity();
      buildGround();
      buildProps();
      cam.cx = ccx; cam.cy = ccy;
      updateCamera();
      invalidate();
      SC.bg = null;
      SC.strips = [];
      SC.k = 0;
      SC.ver = -1;
      SC.lastK = 0;
      SC.zoomAt = 0;
      if (typeof document !== "undefined") buildCache();
    } else {
      invalidate();
      SC.bg = null;
      SC.strips = [];
      SC.k = 0;
      SC.ver = -1;
      SC.lastK = 0;
      SC.zoomAt = 0;
    }
  }

  function getView() { return viewMode; }

  function toggleView() { setView(viewMode === "tilt" ? "top" : "tilt"); return viewMode; }

  /* low buildings: see the street behind blocks (settings menu or H), remembered */
  function toggleLow() {
    lowMode = !lowMode;
    try { localStorage.setItem("ppg_low", lowMode ? "1" : "0"); } catch (e) {}
    buildCity();
    return lowMode;
  }

  function detail() {
    return cam.zoom < 1.8 ? "far" : (cam.zoom > 4 ? "near" : "mid");
  }

  function cullMargin() {
    return (2 * TS + HMAXZ * ZU) * cam.S + 24;
  }

  function visibleWorld(x, y, z, m) {
    if (m === undefined) m = cullMargin();
    P(x, y, z || 0);
    return _px >= -m && _px <= LW + m && _py >= -m && _py <= LH + m;
  }

  function visibleRowRange() {
    var v = viewIso(0), m = (2 * TS + HMAXZ * ZU);
    var y0 = v.y0 - m, y1 = v.y1 + m;
    return { d0: Math.max(0, Math.floor(y0 / TS) - 1), d1: Math.min(ND - 1, Math.ceil(y1 / TS) + 1) };
  }

  function spriteScale(s) {
    var k = _rs * s;
    var q = k > 4 ? Math.round(k * 2) / 2 : Math.round(k * 4) / 4;
    return q < 0.25 ? 0.25 : q;
  }

  function farKey() {
    return cam.OX.toFixed(3) + "," + cam.OY.toFixed(3) + "," + cam.S.toFixed(5) + "," +
      _rs + "," + cityVer + "," + viewMode + "," + (lowMode ? 1 : 0) + "," + W + "," + H;
  }

  function farAdd(col, x, y) {
    var g = FARG[col];
    if (!g) g = FARG[col] = { n: 0, xs: [], ys: [] };
    if (!g.n) FARORDER.push(col);   /* order list is cleared every frame */
    P(x, y, 0);
    g.xs[g.n] = _px; g.ys[g.n] = _py; g.n++;
  }

  function farRoundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawFarVehicles(ctx, G) {
    if (!G || !G.vehicles) return;
    var m = cullMargin(), s = cam.S, i, v, w, h, r, x, y;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v || !visibleWorld(v.x, v.y, 0, m)) continue;
      P(v.x, v.y, 0); x = _px; y = _py;
      w = (v.type === "car" ? 1.8 : 2.6) * TS * s;
      if (w < 5) w = 5;
      h = Math.max(3, w * 0.45);
      r = Math.min(3, h * 0.45);
      ctx.fillStyle = v.type === "ambulance" ? "#f2f5f9" : (v.type === "watertruck" ? "#3b8ae0" : sqCol(v.squad));
      farRoundRect(ctx, x - w * 0.5, y - h * 0.5, w, h, r);
      ctx.fill();
    }
  }

  function drawFarUnits(ctx, G) {
    var i, a, o, col, g, k, r, m = cullMargin(), s = cam.S;
    for (i = 0; i < FARORDER.length; i++) FARG[FARORDER[i]].n = 0;
    FARORDER.length = 0;

    if (G) {
      if (G.agents) for (i = 0; i < G.agents.length; i++) {
        a = G.agents[i];
        if (!a.active) continue;
        if (!visibleWorld(a.x, a.y, 0, m)) continue;
        col = (a.role === "rioter" && G.time < a.revealedUntil) ? "#ff2338" : (a.mood > 65 ? "#d62839" : "#4a8fe7");
        farAdd(col, a.x, a.y);
      }
      if (G.officers) for (i = 0; i < G.officers.length; i++) {
        o = G.officers[i];
        if (!visibleWorld(o.x, o.y, 0, m)) continue;
        farAdd(sqCol(o.squad), o.x, o.y);
      }
      if (G.detainees) for (i = 0; i < G.detainees.length; i++) {
        var d = G.detainees[i];
        if (!visibleWorld(d.x, d.y, 0, m)) continue;
        farAdd("#8d96a2", d.x, d.y);
      }
    }

    r = Math.max(2, 0.35 * TS * s * _rs) * 0.5;
    for (k = 0; k < FARORDER.length; k++) {
      col = FARORDER[k];
      g = FARG[col];
      if (!g.n) continue;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (i = 0; i < g.n; i++) ctx.rect(g.xs[i] - r, g.ys[i] - r, r * 2, r * 2);
      ctx.fill();
    }

    drawFarVehicles(ctx, G);

    if (G && G.barriers) {
      ctx.fillStyle = "#d9dde3";
      for (i = 0; i < G.barriers.length; i++) {
        var b = G.barriers[i];
        if (!visibleWorld(b.x + 0.5, b.y + 0.5, 0, m)) continue;
        P(b.x + 0.5, b.y + 0.5, 0);
        var bw = Math.max(4, TS * s);
        ctx.fillRect(_px - bw * 0.5, _py - 2, bw, 4);
      }
    }
  }

  function drawFarCache(ctx, G) {
    if (typeof document === "undefined") {
      drawBackdrop(ctx);
      drawGround(ctx);
      var rr = visibleRowRange(), d;
      if (diags) for (d = rr.d0; d <= rr.d1; d++) if (drow(d)) fillSet(ctx, d);
      return;
    }
    var cw = Math.max(1, Math.ceil(LW * _rs)), ch = Math.max(1, Math.ceil(LH * _rs));
    if (!FC.c || FC.w !== cw || FC.h !== ch) {
      FC.c = document.createElement("canvas");
      FC.c.width = cw; FC.c.height = ch;
      FC.w = cw; FC.h = ch;
      FC.key = "";
      FAR_DIRTY = true;
    }
    var key = farKey();
    if (FAR_DIRTY || key !== FC.key) {
      var g = FC.c.getContext("2d");
      g.setTransform(_rs, 0, 0, _rs, 0, 0);
      g.clearRect(0, 0, LW, LH);
      drawBackdrop(g);
      drawGround(g);
      var rr2 = visibleRowRange(), d2;
      paintFarTrees(g);
      if (diags) for (d2 = rr2.d0; d2 <= rr2.d1; d2++) if (drow(d2)) fillSet(g, d2);
      FC.key = key;
      FAR_DIRTY = false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(FC.c, 0, 0);
    setScreen(ctx);
  }

  function drawFarScene(ctx, G, t) {
    drawFarCache(ctx, G);
    drawFarUnits(ctx, G);
  }

  function updateCamera() {
    cam.fit = LW / (Math.min(W, 480) * TS);   /* zoom 1 = at most 480 tiles across: big maps cannot zoom out further (draw cost) */
    cam.zoom = clamp(cam.zoom, 1, MAX_ZOOM);
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
  /* Jump the view to tile (x, y), zooming in to at least minZoom (alerts, minimap). */
  function centerOn(x, y, minZoom) {
    if (minZoom) cam.zoom = clamp(Math.max(cam.zoom, minZoom), 1, MAX_ZOOM);
    cam.cx = x; cam.cy = y; updateCamera();
  }
  function zoomAt(lx, ly, f) {
    var a = screenToTile(lx, ly);
    cam.zoom = clamp(cam.zoom * f, 1, MAX_ZOOM);
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
    var touchpadUntil = 0;   /* touchpad seen recently: small wheel steps pan */
    cv.addEventListener("wheel", function (e) {
      if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) { SETTINGS.wheel(e.deltaY); return; }
      var p = logical(e);
      if (typeof SQUADPLAN !== "undefined" && typeof UI !== "undefined" && UI.screen === "planning" && !(typeof FORCE !== "undefined" && FORCE.isOpen()) && SQUADPLAN.wheel(e.deltaY, p.x, p.y)) return;
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var f = LW / r.width;
      var now = Date.now();
      var isPinch = e.ctrlKey === true;
      var smallDelta = e.deltaMode === 0 && (Math.abs(e.deltaY) < 50 || e.deltaY % 1 !== 0);
      var isPan = !isPinch && e.deltaMode === 0 && (e.deltaX !== 0 || smallDelta);
      if (isPan) {
        touchpadUntil = now + 1000;
        panScreen(e.deltaX * f, e.deltaY * f);
        return;
      }
      if (!isPinch && e.deltaMode === 0 && (Math.abs(e.deltaY) < 50 || e.deltaY % 1 !== 0) && now < touchpadUntil) {
        touchpadUntil = now + 1000;
        panScreen(e.deltaX * f, e.deltaY * f);
        return;
      }
      if (isPinch) {
        zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
      } else {
        zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }
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
      else if (k === "Home") { cam.zoom = 1; updateCamera(); }   /* 0 selects a unit type */
      else return;
      if (k.indexOf("Arrow") === 0) e.preventDefault();
    });
  }

  /* ---------- city geometry ---------- */
  function computeHeights() {
    heights = new Float32Array(W * H);
    tints = new Uint8Array(W * H);
    var x, y, isParis = paris();
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var ch = tile(x, y), i = y * W + x;
        if (ch === "#") {
          var lx = Math.floor((x + 2) / 5), ly = Math.floor((y + 1) / 4);
          var r = rnd(hash2(lx * 7 + 3, ly * 5 + 11));
          heights[i] = lowMode ? 0.3 : 0.7 + r * 1.0;
          tints[i] = hash2(lx, ly) % 3;
          if (isParis) {
            /* landmarks are drawn as props; their tiles stay flat */
            if (THEME_PARIS.isLandmarkTile(x, y)) heights[i] = 0;
            else if (!lowMode) heights[i] = THEME_PARIS.height(x, y, ch, r);
          }
        } else if (ch === "S") {
          heights[i] = lowMode ? 0.3 : (isParis ? THEME_PARIS.height(x, y, ch, 0.5) : 0.8);
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

  /* ---------- staircase smoothing: wedges in the inner corners of diagonal edges ---------- */
  function tri(p, x0, y0, z0, x1, y1, z1, x2, y2, z2) {
    p.moveTo(ix(x0, y0), iy(x0, y0, z0));
    p.lineTo(ix(x1, y1), iy(x1, y1, z1));
    p.lineTo(ix(x2, y2), iy(x2, y2, z2));
    p.closePath();
  }

  /* Returns corner code for open tile (x,y) or 0.
     Codes: 1=NW, 2=NE, 3=SW, 4=SE.
     Corner requires two orthogonal building neighbours (>0 h, not shop, h<=2),
     the diagonal between them solid, and the staircase to continue. */
  function cornerAt(x, y) {
    var hN = hAt(x, y - 1), hS = hAt(x, y + 1);
    var hW = hAt(x - 1, y), hE = hAt(x + 1, y);
    var bN = hN > 0 && hN <= 2 && tints[(y - 1) * W + x] !== 3;
    var bS = hS > 0 && hS <= 2 && tints[(y + 1) * W + x] !== 3;
    var bW = hW > 0 && hW <= 2 && tints[y * W + x - 1] !== 3;
    var bE = hE > 0 && hE <= 2 && tints[y * W + x + 1] !== 3;
    /* NW: N+W buildings, S+E not solid, diagonal (x-1,y-1) building */
    if (bN && bW && !solidCh(tile(x, y + 1)) && !solidCh(tile(x + 1, y)) &&
        hAt(x - 1, y - 1) > 0 &&
        (!solidCh(tile(x + 1, y + 1)) || hAt(x + 1, y - 1) > 0 || hAt(x - 1, y + 1) > 0))
      return 1;
    /* NE: N+E buildings, S+W not solid, diagonal (x+1,y-1) building */
    if (bN && bE && !solidCh(tile(x, y + 1)) && !solidCh(tile(x - 1, y)) &&
        hAt(x + 1, y - 1) > 0 &&
        (!solidCh(tile(x - 1, y + 1)) || hAt(x - 1, y - 1) > 0 || hAt(x + 1, y + 1) > 0))
      return 2;
    /* SW: S+W buildings, N+E not solid, diagonal (x-1,y+1) building */
    if (bS && bW && !solidCh(tile(x, y - 1)) && !solidCh(tile(x + 1, y)) &&
        hAt(x - 1, y + 1) > 0 &&
        (!solidCh(tile(x + 1, y - 1)) || hAt(x - 1, y - 1) > 0 || hAt(x + 1, y + 1) > 0))
      return 3;
    /* SE: S+E buildings, N+W not solid, diagonal (x+1,y+1) building */
    if (bS && bE && !solidCh(tile(x, y - 1)) && !solidCh(tile(x - 1, y)) &&
        hAt(x + 1, y + 1) > 0 &&
        (!solidCh(tile(x - 1, y - 1)) || hAt(x + 1, y - 1) > 0 || hAt(x - 1, y + 1) > 0))
      return 4;
    return 0;
  }

  /* 1 window quad centred on slanted wall segment (ax,ay)-(bx,by) in tile coords. */
  function wedgeWins(p, ax, ay, bx, by, h) {
    var mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
    var dx = bx - ax, dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return;
    var ux = dx / len, uy = dy / len;      /* along wall */
    var vx = uy, vy = -ux;                 /* inward (toward tile centre) */
    if (vx * (0.5 - mx) + vy * (0.5 - my) < 0) { vx = -vx; vy = -vy; }
    var half = 0.12;                       /* window half-width along wall */
    var depth = 0.06;                      /* push inward slightly */
    var z;
    for (z = 0.28; z + 0.22 < h - 0.12; z += 0.45) {
      var x0 = mx - ux * half + vx * depth, y0 = my - uy * half + vy * depth;
      var x1 = mx + ux * half + vx * depth, y1 = my + uy * half + vy * depth;
      quad(p, x0, y0, z, x1, y1, z, x1, y1, z + 0.22, x0, y0, z + 0.22);
    }
  }

  function addWedgesRow(y) {
    var x;
    {
      for (x = 0; x < W; x++) {
        if (solidCh(tile(x, y))) continue;
        var c = cornerAt(x, y);
        if (!c) continue;
        var hN = hAt(x, y - 1), hS = hAt(x, y + 1);
        var hW = hAt(x - 1, y), hE = hAt(x + 1, y);
        var h, t, set;
        if (c === 1) {                       /* NW: tri (x,y)-(x+1,y)-(x,y+1) */
          h = Math.min(hN, hW);
          t = tints[(y - 1) * W + x];
          if (t > 2) t = tints[y * W + x - 1];
          if (t > 2) t = 0;
          set = diags[y] || (diags[y] = newSet());
          tri(set.tops[t], x, y, h, x + 1, y, h, x, y + 1, h);
          /* slanted wall (x+1,y)->(x,y+1) faces SE, visible */
          quad(set.sw, x + 1, y, 0, x, y + 1, 0, x, y + 1, h, x + 1, y, h);
          if (!lowMode) wedgeWins(set.winS, x + 1, y, x, y + 1, h);
        } else if (c === 2) {                /* NE: tri (x,y)-(x+1,y)-(x+1,y+1) */
          h = Math.min(hN, hE);
          t = tints[(y - 1) * W + x];
          if (t > 2) t = tints[y * W + x + 1];
          if (t > 2) t = 0;
          set = diags[y] || (diags[y] = newSet());
          tri(set.tops[t], x, y, h, x + 1, y, h, x + 1, y + 1, h);
          /* slanted wall (x,y)->(x+1,y+1) faces SW, visible */
          quad(set.sw, x, y, 0, x + 1, y + 1, 0, x + 1, y + 1, h, x, y, h);
          if (!lowMode) wedgeWins(set.winS, x, y, x + 1, y + 1, h);
        } else if (c === 3) {                /* SW: tri (x,y)-(x,y+1)-(x+1,y+1) */
          h = Math.min(hS, hW);
          t = tints[(y + 1) * W + x];
          if (t > 2) t = tints[y * W + x - 1];
          if (t > 2) t = 0;
          set = diags[y] || (diags[y] = newSet());
          tri(set.tops[t], x, y, h, x, y + 1, h, x + 1, y + 1, h);
          /* slanted wall (x,y)->(x+1,y+1) looks N, hidden: top only */
        } else {                             /* SE: tri (x+1,y)-(x+1,y+1)-(x,y+1) */
          h = Math.min(hS, hE);
          t = tints[(y + 1) * W + x];
          if (t > 2) t = tints[y * W + x + 1];
          if (t > 2) t = 0;
          set = diags[y] || (diags[y] = newSet());
          tri(set.tops[t], x + 1, y, h, x + 1, y + 1, h, x, y + 1, h);
          /* slanted wall (x+1,y)->(x,y+1) looks NE, hidden: top only */
        }
      }
    }
  }

  /* pavement follows the diagonal on the ground too */
  function groundWedges(g, t) {
    if (BSON) return;
    var x, y;
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
        if (solidCh(tile(x, y))) continue;
        var c = cornerAt(x, y);
        if (!c) continue;
        var ax, ay, bx, by, cx, cy;
        if (c === 1) { ax = x; ay = y; bx = x + 1; by = y; cx = x; cy = y + 1; }
        else if (c === 2) { ax = x; ay = y; bx = x + 1; by = y; cx = x + 1; cy = y + 1; }
        else if (c === 3) { ax = x; ay = y; bx = x; by = y + 1; cx = x + 1; cy = y + 1; }
        else { ax = x + 1; ay = y; bx = x + 1; by = y + 1; cx = x; cy = y + 1; }
        g.beginPath();
        g.moveTo(ax * t, ay * t);
        g.lineTo(bx * t, by * t);
        g.lineTo(cx * t, cy * t);
        g.closePath();
        g.fillStyle = paris() ? THEME_PARIS.colors.pavement : "#f1f4f7";
        g.fill();
        /* kerb along hypotenuse: the two non-origin pts of the right angle corner */
        var hx0, hy0, hx1, hy1;
        if (c === 1) { hx0 = bx; hy0 = by; hx1 = cx; hy1 = cy; }
        else { hx0 = ax; hy0 = ay; hx1 = cx; hy1 = cy; }
        g.beginPath();
        g.moveTo(hx0 * t, hy0 * t);
        g.lineTo(hx1 * t, hy1 * t);
        g.strokeStyle = "#c6ceda";
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }

  /* Corner code of a BUILDING tile whose box corner is cut by a diagonal
     street, or 0. Codes: 1=NW, 2=NE, 3=SW, 4=SE (the OPEN corner). */
  function chamferAt(x, y) {
    if (BSON) return 0;   /* blockshape.js draws smooth outlines instead */
    var h = hAt(x, y);
    if (!(h > 0) || h > 2.0 || tints[y * W + x] === 3) return 0;
    var nN = hAt(x, y - 1), nS = hAt(x, y + 1);
    var nW = hAt(x - 1, y), nE = hAt(x + 1, y);
    var oN = !solidCh(tile(x, y - 1)), oS = !solidCh(tile(x, y + 1));
    var oW = !solidCh(tile(x - 1, y)), oE = !solidCh(tile(x + 1, y));
    /* NW: N+W open, S+E buildings, diagonal (x-1,y-1) open */
    if (oN && oW && nS > 0 && nE > 0 &&
        !solidCh(tile(x - 1, y - 1)) &&
        (hAt(x + 1, y - 1) > 0 || hAt(x - 1, y + 1) > 0))
      return 1;
    /* NE: N+E open, S+W buildings, diagonal (x+1,y-1) open */
    if (oN && oE && nS > 0 && nW > 0 &&
        !solidCh(tile(x + 1, y - 1)) &&
        (hAt(x - 1, y - 1) > 0 || hAt(x + 1, y + 1) > 0))
      return 2;
    /* SW: S+W open, N+E buildings, diagonal (x-1,y+1) open */
    if (oS && oW && nN > 0 && nE > 0 &&
        !solidCh(tile(x - 1, y + 1)) &&
        (hAt(x + 1, y + 1) > 0 || hAt(x - 1, y - 1) > 0))
      return 3;
    /* SE: S+E open, N+W buildings, diagonal (x+1,y+1) open */
    if (oS && oE && nN > 0 && nW > 0 &&
        !solidCh(tile(x + 1, y + 1)) &&
        (hAt(x - 1, y + 1) > 0 || hAt(x + 1, y - 1) > 0))
      return 4;
    return 0;
  }

  /* Slanted-wall windows for a visible chamfer wall (ax,ay)-(bx,by). */
  function chamWins(p, ax, ay, bx, by, h) {
    wedgeWins(p, ax, ay, bx, by, h);
  }

  /* Cut building tile geometry instead of its full box. */
  function addChamfer(set, x, y, h, t, code) {
    var z;
    if (code === 4) {
      /* roof: (x,y)(x+1,y)(x,y+1); wall (x+1,y)->(x,y+1) faces SE */
      tri(set.tops[t], x, y, h, x + 1, y, h, x, y + 1, h);
      quad(set.sw, x + 1, y, 0, x, y + 1, 0, x, y + 1, h, x + 1, y, h);
      chamWins(set.winS, x + 1, y, x, y + 1, h);
    } else if (code === 3) {
      /* roof: (x,y)(x+1,y)(x+1,y+1); wall (x,y)->(x+1,y+1) faces SW */
      tri(set.tops[t], x, y, h, x + 1, y, h, x + 1, y + 1, h);
      quad(set.sw, x, y, 0, x + 1, y + 1, 0, x + 1, y + 1, h, x, y, h);
      chamWins(set.winS, x, y, x + 1, y + 1, h);
    } else if (code === 1) {
      /* roof: (x+1,y)(x+1,y+1)(x,y+1); slanted face NW hidden */
      tri(set.tops[t], x + 1, y, h, x + 1, y + 1, h, x, y + 1, h);
      var hS = hAt(x, y + 1);
      if (hS < h) {
        quad(set.sw, x, y + 1, hS, x + 1, y + 1, hS,
             x + 1, y + 1, h, x, y + 1, h);
        for (z = Math.max(hS, 0) + 0.28; z + 0.22 < h - 0.12; z += 0.45) {
          var xa = x + 0.16, xb = x + 0.56;
          quad(set.winS, xa, y + 1, z, xb, y + 1, z,
               xb, y + 1, z + 0.22, xa, y + 1, z + 0.22);
        }
      }
    } else {
      /* code 2: roof (x,y)(x,y+1)(x+1,y+1); slanted face NE hidden */
      tri(set.tops[t], x, y, h, x, y + 1, h, x + 1, y + 1, h);
      var hS2 = hAt(x, y + 1);
      if (hS2 < h) {
        quad(set.sw, x, y + 1, hS2, x + 1, y + 1, hS2,
             x + 1, y + 1, h, x, y + 1, h);
        for (z = Math.max(hS2, 0) + 0.28; z + 0.22 < h - 0.12; z += 0.45) {
          var xa2 = x + 0.16, xb2 = x + 0.56;
          quad(set.winS, xa2, y + 1, z, xb2, y + 1, z,
               xb2, y + 1, z + 0.22, xa2, y + 1, z + 0.22);
        }
      }
    }
  }

  /* Ground pavement under each chamfer cut, plus a kerb along the diagonal. */
  function groundChamfers(g, t) {
    var x, y, cc;
    g.lineWidth = 1.5;
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
        cc = chamferAt(x, y);
        if (!cc) continue;
        g.beginPath();
        if (cc === 1) {           /* NW open: triangle (x,y)(x+1,y)(x,y+1) of ground */
          g.moveTo(x * t, y * t);
          g.lineTo((x + 1) * t, y * t);
          g.lineTo(x * t, (y + 1) * t);
          g.closePath();
        } else if (cc === 2) {    /* NE open */
          g.moveTo((x + 1) * t, y * t);
          g.lineTo((x + 1) * t, (y + 1) * t);
          g.lineTo(x * t, y * t);
          g.closePath();
        } else if (cc === 3) {    /* SW open */
          g.moveTo(x * t, (y + 1) * t);
          g.lineTo((x + 1) * t, (y + 1) * t);
          g.lineTo(x * t, y * t);
          g.closePath();
        } else {                  /* SE open */
          g.moveTo((x + 1) * t, (y + 1) * t);
          g.lineTo((x + 1) * t, y * t);
          g.lineTo(x * t, (y + 1) * t);
          g.closePath();
        }
        g.fillStyle = PAVE;
        g.fill();
        /* kerb along the diagonal edge */
        g.beginPath();
        if (cc === 1) { g.moveTo((x + 1) * t, y * t); g.lineTo(x * t, (y + 1) * t); }
        else if (cc === 2) { g.moveTo((x + 1) * t, (y + 1) * t); g.lineTo(x * t, y * t); }
        else if (cc === 3) { g.moveTo((x + 1) * t, (y + 1) * t); g.lineTo(x * t, y * t); }
        else { g.moveTo((x + 1) * t, y * t); g.lineTo(x * t, (y + 1) * t); }
        g.strokeStyle = "#c6ceda";
        g.stroke();
      }
    }
  }

  /* ---------- smooth outlines (blockshape.js): staircase edges become slanted walls ---------- */
  var BSON = false;
  function shapeSolid(x, y) { return heights[y * W + x] > 0; }
  function shapeTop(p, poly, h) {
    p.moveTo(ix(poly[0], poly[1]), iy(poly[0], poly[1], h));
    for (var i = 2; i < poly.length; i += 2) p.lineTo(ix(poly[i], poly[i + 1]), iy(poly[i], poly[i + 1], h));
    p.closePath();
  }
  function addShape(set, c, h, t) {
    var i, w;
    for (i = 0; i < c.polys.length; i++) shapeTop(set.tops[t], c.polys[i], h);
    for (i = 0; i < c.walls.length; i++) {
      w = c.walls[i];
      quad(set.sw, w[0], w[1], 0, w[2], w[3], 0, w[2], w[3], h, w[0], w[1], h);
    }
  }
  /* open tile that the smoothed outline reaches into: take the tallest plain neighbour */
  function shapeWedge(x, y) {
    var c = BLOCKSHAPE.cell(x, y);
    if (!c || !c.polys.length) return;
    var best = -1, bh = 0, d, nx, ny;
    var DX = [0, 1, 0, -1, 1, 1, -1, -1], DY = [-1, 0, 1, 0, -1, 1, 1, -1];
    for (d = 0; d < 8; d++) {
      nx = x + DX[d]; ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      var hh = heights[ny * W + nx];
      if (hh > bh && tints[ny * W + nx] !== 3) { bh = hh; best = ny * W + nx; }
    }
    if (best < 0) return;
    addShape(diags[y] || (diags[y] = newSet()), c, bh, tints[best]);
  }
  /* pavement where a building tile was cut away by the smooth outline */
  function groundShapes(g, t) {
    if (!BSON) return;
    var x, y, c;
    g.fillStyle = PAVE;
    for (y = GY0; y < GY1; y++) for (x = GX0; x < GX1; x++) {
      if (!(heights[y * W + x] > 0) || tints[y * W + x] === 3) continue;
      c = BLOCKSHAPE.cell(x, y);
      if (!c) continue;
      g.beginPath();
      g.rect(x * t, y * t, t, t);
      for (var pi = 0; pi < c.polys.length; pi++) {
        var P = c.polys[pi];
        g.moveTo(P[0] * t, P[1] * t);
        for (var pj = 2; pj < P.length; pj += 2) g.lineTo(P[pj] * t, P[pj + 1] * t);
        g.closePath();
      }
      g.fill("evenodd");
    }
  }

  /* smooth road outline: edge cells repainted (pavement, then the asphalt part), kerb + pavement strip on slanted edges */
  var RSHAPE = null;
  function roadSolid(x, y) { return tile(x, y) === "."; }
  function slantCell(x, y) {
    var c = RSHAPE.cell(x, y);
    if (!c) return false;
    return tile(x, y) === "." ? c.area <= 0.999 : c.area >= 0.001;
  }
  function nearSlant(x, y) {
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if ((dx || dy) && slantCell(x + dx, y + dy)) return true;
    return false;
  }
  function groundRoads(g, t) {
    if (!BSON || !RSHAPE) return;
    var x, y, c, i, j, n, P, isR, base = (MAP.roads && MAP.roads.length) ? "#666a71" : "#54585e";
    for (y = GY0; y < GY1; y++) for (x = GX0; x < GX1; x++) {
      c = RSHAPE.cell(x, y);
      if (solidCh(tile(x, y))) continue;
      isR = tile(x, y) === ".";
      if (!c || (isR ? c.area > 0.999 : c.area < 0.001)) {
        /* full road tile beside a slanted edge: clear the old tile-stepped pavement strip */
        if (isR && nearSlant(x, y)) { g.fillStyle = base; g.fillRect(x * t, y * t, t, t); }
        continue;
      }
      g.fillStyle = PAVE; g.fillRect(x * t, y * t, t, t);
      g.fillStyle = base; g.beginPath();
      for (i = 0; i < c.polys.length; i++) {
        P = c.polys[i];
        g.moveTo(P[0] * t, P[1] * t);
        for (j = 2; j < P.length; j += 2) g.lineTo(P[j] * t, P[j + 1] * t);
        g.closePath();
      }
      g.fill();
    }
    /* pavement strip + kerb inside the road along slanted edges (clipped to the road shape) */
    var L = RSHAPE.outlines(), pass;
    g.save();
    g.beginPath();
    for (i = 0; i < L.length; i++) {
      P = L[i];
      g.moveTo(P[0] * t, P[1] * t);
      for (j = 2; j < P.length; j += 2) g.lineTo(P[j] * t, P[j + 1] * t);
      g.closePath();
    }
    g.clip("evenodd");
    g.lineCap = "round";
    for (pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? PAVE : "rgba(80,84,90,0.75)";
      g.lineWidth = t * (pass ? 0.56 : 0.64);
      g.beginPath();
      for (i = 0; i < L.length; i++) {
        P = L[i]; n = P.length / 2;
        for (j = 0; j < n; j++) {
          var k2 = (j + 1) % n, ax = P[j * 2], ay = P[j * 2 + 1], bx = P[k2 * 2], by = P[k2 * 2 + 1];
          if (ax === bx || ay === by) continue;   /* straight tile edges keep the normal kerb */
          if (Math.max(ay, by) < GY0 - 1 || Math.min(ay, by) > GY1 + 1) continue;
          g.moveTo(ax * t, ay * t); g.lineTo(bx * t, by * t);
        }
      }
      g.stroke();
    }
    g.restore();
  }

  function buildCity() {
    computeHeights();
    BSON = !lowMode && typeof BLOCKSHAPE !== "undefined";
    if (BSON) {
      BLOCKSHAPE.build(W, H, shapeSolid);
      RSHAPE = RSHAPE || BLOCKSHAPE.make();
      RSHAPE.build(W, H, roadSolid);
    }
    cityVer++;
    HMAXZ = 0.5;
    for (var hi = 0; hi < heights.length; hi++) if (heights[hi] + 0.5 > HMAXZ) HMAXZ = heights[hi] + 0.5;
    ND = H;
    diags = new Array(ND);
    shopTiles = new Array(ND);
    var x, y;
    if (typeof Path2D === "undefined") return;
    rowDone = new Uint8Array(ND);   /* building shapes are made per row when a row is first drawn */
  }
  var rowDone = null;
  function drow(d) {
    if (!diags || d < 0 || d >= ND) return null;
    if (rowDone && !rowDone[d]) { rowDone[d] = 1; buildRow(d); }
    return diags[d];
  }
  function buildRow(y) {
    var x;
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
        /* outer step of a diagonal edge: cut the open corner off */
        if (BSON) {
          var bsc = BLOCKSHAPE.cell(x, y);
          if (bsc) { addShape(set, bsc, h, tints[y * W + x]); continue; }
        }
        var cc = lowMode ? 0 : chamferAt(x, y);
        if (cc) { addChamfer(set, x, y, h, tints[y * W + x], cc); continue; }
        addBox(set, x, y, x + 1, y + 1, 0, h, set.tops[tints[y * W + x]], set.sw, showS);
        if (lowMode) continue;
        for (z = Math.max(hS, 0) + 0.28; z + 0.22 < h - 0.12; z += 0.45) {
          if (!showS) break;
          for (a = 0; a < 2; a++) {
            var xa = x + 0.16 + a * 0.4;
            quad(set.winS, xa, y + 1, z, xa + 0.26, y + 1, z, xa + 0.26, y + 1, z + 0.22, xa, y + 1, z + 0.22);
          }
        }
        if (typeof BUILDINGS !== "undefined") {
          /* rooftop equipment: AC units, tanks, skylights, chimneys, dormers */
          if (!showS && hAt(x - 1, y) === h && hAt(x, y - 1) === h) {
            BUILDINGS.details(x, y, h, rnd(hash2(x * 3 + 1, y * 7 + 2)), paris() ? "paris" : "grid", function (x0, y0, x1, y1, z0, z1) {
              set.roof = true;
              addBox(set, x0, y0, x1, y1, z0, z1, set.rTop, set.rS, true);
            });
          }
        } else if (!showS && hAt(x - 1, y) === h && hAt(x, y - 1) === h && hash2(x, y) % 9 === 0) {
          set.roof = true;
          addBox(set, x + 0.22, y + 0.25, x + 0.78, y + 0.75, h, h + 0.22, set.rTop, set.rS, true);
        }
      }
    if (!lowMode && !BSON) addWedgesRow(y);
    if (BSON) for (x = 0; x < W; x++) if (!(heights[y * W + x] > 0)) shapeWedge(x, y);
  }

  /* ---------- ground texture ---------- */
  /* The ground is cut into CH x CH tile chunks, each its own canvas, painted in the
   * background nearest-to-view first; chunks far from view are dropped when memory runs
   * short (big maps). A cheap 2 px-per-tile picture of the whole map (miniCv) shows under
   * chunks that are not painted yet and when zoomed far out. */
  var GY0 = 0, GY1 = 0, GX0 = 0, GX1 = 0, groundJob = 0;
  var CH = 32, MS = 2, CW = 0, CHH = 0, chunks = null, chunkWant = [], chunkCount = 0, CHMAX = 100, chunkTick = 0, pumping = false, miniCv = null;
  function groundSpinner(on) {
    var d = document.getElementById("loading");
    if (d) d.style.display = on ? "flex" : "none";
  }
  function buildMini() {
    var cv = makeCanvas(W * MS, H * MS), g = cv.getContext("2d"), one = makeCanvas(W, H), og = one.getContext("2d");
    var img = og.createImageData(W, H), d = img.data, x, y, i = 0, c;
    var col = { ".": [102, 106, 113], "a": [150, 154, 162], "P": [228, 224, 214], "G": [150, 186, 120], "#": [184, 178, 166], "S": [184, 178, 166], "W": [134, 183, 220] };
    for (y = 0; y < H; y++) for (x = 0; x < W; x++, i += 4) {
      c = col[tile(x, y)] || [226, 222, 212];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(one, 0, 0, W * MS, H * MS);
    return cv;
  }
  function buildGround() {
    if (typeof document === "undefined") return;
    cityVer++;
    groundJob++;
    CW = Math.ceil(W / CH); CHH = Math.ceil(H / CH);
    chunks = new Array(CW * CHH); chunkWant = []; chunkCount = 0;
    CHMAX = Math.max(24, Math.floor(420e6 / (CH * GT * CH * GT * 4)));   /* about 420 MB of chunks */
    miniCv = buildMini();
    groundCv = miniCv;   /* "ground ready"; detail comes per chunk */
    FAR_DIRTY = true;
    if (CW * CHH <= CHMAX) for (var i = 0; i < CW * CHH; i++) chunkWant.push(i);   /* small map: paint it all */
    pumpChunks();
  }
  function paintChunk(ci) {
    var cx = ci % CW, cy = (ci - cx) / CW, x0 = cx * CH, y0 = cy * CH, x1 = Math.min(W, x0 + CH), y1 = Math.min(H, y0 + CH);
    var cv = makeCanvas((x1 - x0) * GT, (y1 - y0) * GT), g = cv.getContext("2d");
    g.translate(-x0 * GT, -y0 * GT);
    window.GROUNDWIN = { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 };   /* painters outside art.js read it */
    try { paintGroundBand(g, y0, y1, x0, x1); } finally { window.GROUNDWIN = null; }
    chunks[ci] = { cv: cv, used: chunkTick };
    chunkCount++;
    if (chunkCount > CHMAX) {   /* drop the chunk unused the longest */
      var old = -1, ou = 1e18;
      for (var k = 0; k < chunks.length; k++) if (chunks[k] && chunks[k].used < ou && k !== ci) { ou = chunks[k].used; old = k; }
      if (old >= 0 && ou < chunkTick) { chunks[old] = null; chunkCount--; }
    }
    cityVer++; FAR_DIRTY = true;
  }
  function pumpChunks() {
    if (pumping) return;
    pumping = true;
    var job = groundJob;
    function tick() {
      if (job !== groundJob) { pumping = false; if (chunkWant.length) pumpChunks(); return; }
      var t0 = Date.now();
      while (chunkWant.length && Date.now() - t0 < 12) {
        var ci = chunkWant.shift();
        if (!chunks[ci]) paintChunk(ci);
      }
      if (chunkWant.length) setTimeout(tick, 0); else pumping = false;
    }
    setTimeout(tick, 0);
  }
  /* Draw ground tiles [tx0,tx1) x [ty0,ty1); tile (x, y) lands at (ox + x * s, oy + y * s) in g's
   * current transform. fine = use painted chunks (else only the mini picture). */
  function blitGround(g, tx0, ty0, tx1, ty1, ox, oy, s, fine) {
    if (!miniCv) return;
    tx0 = Math.max(0, Math.floor(tx0)); ty0 = Math.max(0, Math.floor(ty0));
    tx1 = Math.min(W, Math.ceil(tx1)); ty1 = Math.min(H, Math.ceil(ty1));
    if (tx1 <= tx0 || ty1 <= ty0) return;
    g.imageSmoothingEnabled = true;
    g.drawImage(miniCv, tx0 * MS, ty0 * MS, (tx1 - tx0) * MS, (ty1 - ty0) * MS, ox + tx0 * s, oy + ty0 * s, (tx1 - tx0) * s, (ty1 - ty0) * s);
    if (!fine || !chunks) return;
    chunkTick++;
    var want = [], cx, cy, c0x = Math.floor(tx0 / CH), c1x = Math.floor((tx1 - 1) / CH), c0y = Math.floor(ty0 / CH), c1y = Math.floor((ty1 - 1) / CH);
    for (cy = c0y; cy <= c1y; cy++) for (cx = c0x; cx <= c1x; cx++) {
      var ci = cy * CW + cx, c = chunks[ci];
      if (c) {
        c.used = chunkTick;
        g.drawImage(c.cv, ox + cx * CH * s, oy + cy * CH * s, c.cv.width / GT * s, c.cv.height / GT * s);
      } else if (chunkWant.indexOf(ci) < 0) want.push(ci);
    }
    if (want.length) {   /* nearest to the view centre first, ahead of background work */
      var mx = (c0x + c1x) / 2, my = (c0y + c1y) / 2;
      want.sort(function (a, b) {
        var ax = a % CW - mx, ay = (a - a % CW) / CW - my, bx = b % CW - mx, by = (b - b % CW) / CW - my;
        return (ax * ax + ay * ay) - (bx * bx + by * by);
      });
      chunkWant = want.concat(chunkWant);
      pumpChunks();
    }
  }
  /* visible tile rectangle of a context whose transform maps tiles * unit to device pixels */
  function visTiles(g, unit) {
    var m = g.getTransform(), inv = m.inverse(), cw = g.canvas.width, ch = g.canvas.height;
    var a = inv.transformPoint({ x: 0, y: 0 }), b = inv.transformPoint({ x: cw, y: ch });
    return { x0: Math.min(a.x, b.x) / unit, y0: Math.min(a.y, b.y) / unit, x1: Math.max(a.x, b.x) / unit, y1: Math.max(a.y, b.y) / unit, px: m.a * unit };
  }

  function paintGroundBand(g, B0, B1, X0, X1) {
    var x, y, ch, t = GT;
    /* paint a 2-tile margin so tiles that spill over the edge layer correctly, clipped to the chunk */
    GY0 = Math.max(0, B0 - 2); GY1 = Math.min(H, B1 + 2);
    GX0 = Math.max(0, X0 - 2); GX1 = Math.min(W, X1 + 2);
    g.save();
    g.beginPath(); g.rect(X0 * t, B0 * t, (X1 - X0) * t, (B1 - B0) * t); g.clip();
    var base = { ".": "#eef1f5", "P": "#e4e8ee", "G": "#bfd8a8", "a": "#d4dae2", "#": "#cdd4dd", "S": "#cdd4dd", "W": "#86b7dc" };
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
        ch = tile(x, y);
        g.fillStyle = base[ch] || "#e3e8ee";
        g.fillRect(x * t, y * t, t + 1, t + 1);
        if (ch === "G") {
          var hh = hash2(x, y);
          /* mossy variation patches */
          if (hh % 2 === 0) {
            g.fillStyle = "rgba(90,140,70,0.18)";
            g.fillRect(x * t + rnd(hh) * t * 0.6, y * t + rnd(hash2(y, x)) * t * 0.6, t * 0.3, t * 0.25);
          }
          /* grass tufts: small green strokes deterministic on tile */
          var nTuft = 3 + (hh % 4);
          for (var ti = 0; ti < nTuft; ti++) {
            var th = hash2(x * 7 + ti, y * 11 + ti);
            var tx = x * t + rnd(th) * (t - 3) + 1;
            var ty = y * t + rnd(hash2(th, 3)) * (t - 3) + 2;
            g.strokeStyle = "rgba(70,120,50,0.65)";
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(tx, ty + 2);
            g.lineTo(tx - 0.8, ty);
            g.moveTo(tx, ty + 2);
            g.lineTo(tx + 0.8, ty);
            g.stroke();
          }
          /* flower dots: sparse, 3 palette colours */
          if (hh % 6 === 0) {
            var fc = (hh % 3 === 0) ? "#f2f0d8" : (hh % 3 === 1 ? "#e9d36b" : "#e8a1b8");
            var fx = x * t + (hash2(x + 1, y) % (t - 4)) + 2;
            var fy = y * t + (hash2(x, y + 1) % (t - 4)) + 2;
            g.fillStyle = fc;
            g.beginPath(); g.arc(fx, fy, 1.2, 0, Math.PI * 2); g.fill();
          }
          continue;
        }
      }
    }
    /* sidewalks + curbs along buildings */
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
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
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
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
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
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
    for (y = GY0; y < GY1; y++) {
      for (x = GX0; x < GX1; x++) {
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
    if (paris()) THEME_PARIS.ground(g, W, H, t, tile);
    if (typeof STREETS !== "undefined") {
      STREETS.paint(g, W, H, t, tile, paris() ? "paris" : "grid", GY0, GY1, "band");
      if (paris()) THEME_PARIS.decor(g, t, tile);
    }
    if (typeof BUILDINGS !== "undefined" && !lowMode) BUILDINGS.shadows(g, W, H, t, hAt);
    if (!lowMode) { groundWedges(g, t); PAVE = paris() ? THEME_PARIS.colors.pavement : "#f1f4f7"; groundChamfers(g, t); groundRoads(g, t); groundShapes(g, t); }
    if (typeof STREETS !== "undefined") STREETS.paint(g, W, H, GT, tile, paris() ? "paris" : "grid", 0, 0, "marks");   /* road markings on top */
    g.restore();
  }

  function treeVariety(seed) {
    var h = hash2(seed | 0, 977);
    var r = (h >>> 0) / 4294967295;
    if (r < 0.58) return "decid";
    if (r < 0.82) return "conifer";
    return "bush";
  }

  function makeTreeSprite(variety, k, seed) {
    var h = hash2(seed | 0, 3131);
    var r0 = rnd(h), r1 = rnd(h ^ 0x9e37), r2 = rnd(h ^ 0x51ed), r3 = rnd(h ^ 0x1b56);
    /* world-unit dimensions (tile = 1.0) */
    var trunkH, trunkW, canopyR, canopyTop, canopyW;
    if (variety === "conifer") {
      trunkH = 0.35 + r0 * 0.20; trunkW = 0.09;
      canopyR = 0.34 + r1 * 0.08;        /* narrow */
      canopyTop = 1.55 + r0 * 0.35;       /* taller */
      canopyW = 0.70 + r1 * 0.10;
    } else if (variety === "bush") {
      trunkH = 0.10 + r0 * 0.06; trunkW = 0.07;
      canopyR = 0.26 + r1 * 0.08;
      canopyTop = 0.52 + r0 * 0.12;
      canopyW = 0.58 + r1 * 0.10;
    } else {
      trunkH = 0.45 + r0 * 0.22; trunkW = 0.10;
      canopyR = 0.44 + r1 * 0.10;
      canopyTop = 1.05 + r0 * 0.25;
      canopyW = 1.00 + r1 * 0.22;
    }

    /* colour variation per tree: base hue shift */
    var gv = (r2 - 0.5) * 0.22;
    var dark = [Math.round(30 + gv * 30), Math.round(72 + gv * 40), Math.round(34 + gv * 24)];
    var mid = [Math.round(62 + gv * 40), Math.round(118 + gv * 50), Math.round(54 + gv * 34)];
    var light = [Math.round(108 + gv * 50), Math.round(168 + gv * 54), Math.round(88 + gv * 36)];

    /* world-space bounding box around the anchor (ground contact) */
    var padU = 0.12;
    var wU = canopyW + padU * 2;
    var hU = canopyTop + padU * 2;
    var w = Math.max(1, Math.ceil(wU * k));
    var hh = Math.max(1, Math.ceil(hU * k));
    var c = makeCanvas(w, hh), g = c.getContext("2d");
    var cx = Math.floor(w * 0.5);
    var baseY = hh - Math.floor(padU * k);                /* ground contact */
    var trunkTop = baseY - trunkH * k;
    var canopyTopY = baseY - canopyTop * k;
    var canopyCy = canopyTopY + canopyR * k * 0.9;         /* canopy centre */
    var canopyCx = cx;
    var R = canopyR * k;

    g.save();

    /* soft dark oval shadow to the bottom-right */
    var shX = cx + R * 0.45, shY = baseY + Math.max(1, 1 * k);
    var shR = R * (variety === "bush" ? 1.0 : 1.25);
    g.beginPath();
    g.ellipse(shX, shY, shR, shR * 0.42, 0, 0, Math.PI * 2);
    g.fillStyle = "rgba(28,44,26,0.28)";
    g.fill();

    /* trunk */
    g.fillStyle = "#6b4a2e";
    g.fillRect(cx - trunkW * k * 0.5, trunkTop, Math.max(1, trunkW * k), trunkH * k + 1);
    g.fillStyle = "#8a623d";
    g.fillRect(cx - trunkW * k * 0.5, trunkTop, Math.max(1, trunkW * k * 0.4), trunkH * k + 1);

    /* canopy leaf clusters */
    var clusters = [], i, ang, rad, dx, dy, col;
    if (variety === "conifer") {
      /* stacked cones: three tiers of overlapping circles, narrow at top */
      var tiers = 4, ti;
      for (ti = 0; ti < tiers; ti++) {
        var u = ti / (tiers - 1);
        var ty = canopyTopY + (baseY - trunkH * k * 0.9 - canopyTopY) * u;
        var tr = R * (0.45 + u * 0.75);
        var cc = ti === tiers - 1 ? dark : (ti === 0 ? light : mid);
        clusters.push({ x: cx, y: ty, r: tr, c: cc });
        clusters.push({ x: cx - tr * 0.45, y: ty + tr * 0.25, r: tr * 0.68, c: ti >= 2 ? dark : mid });
        clusters.push({ x: cx + tr * 0.45, y: ty + tr * 0.25, r: tr * 0.68, c: dark });
      }
    } else if (variety === "bush") {
      for (i = 0; i < 5; i++) {
        ang = (i / 5) * Math.PI * 2 + r0 * Math.PI;
        rad = R * 0.55;
        dx = Math.cos(ang) * rad * 0.7;
        dy = Math.sin(ang) * rad * 0.4;
        col = (i % 3 === 0) ? dark : mid;
        clusters.push({ x: canopyCx + dx, y: canopyCy + dy, r: R * 0.6, c: col });
      }
      clusters.push({ x: canopyCx - R * 0.25, y: canopyCy - R * 0.25, r: R * 0.62, c: light });
      clusters.push({ x: canopyCx + R * 0.1, y: canopyCy - R * 0.05, r: R * 0.5, c: mid });
    } else {
      var n = 6 + (h % 2);
      /* under-layer dark clusters spread wide */
      for (i = 0; i < n; i++) {
        ang = (i / n) * Math.PI * 2 + rnd(hash2(seed | 0, i * 7 + 3)) * 0.6;
        rad = R * (0.55 + rnd(hash2(seed | 0, i * 5 + 9)) * 0.25);
        dx = Math.cos(ang) * R * 0.55;
        dy = Math.sin(ang) * R * 0.42;
        col = (i % 3 === 0) ? dark : mid;
        clusters.push({ x: canopyCx + dx, y: canopyCy + dy, r: rad, c: col });
      }
      /* mid layer slightly higher */
      for (i = 0; i < 4; i++) {
        ang = (i / 4) * Math.PI * 2 + 0.7;
        rad = R * 0.5;
        dx = Math.cos(ang) * R * 0.38;
        dy = Math.sin(ang) * R * 0.30;
        clusters.push({ x: canopyCx + dx, y: canopyCy - R * 0.10 + dy, r: rad, c: mid });
      }
      /* top-left highlight cluster */
      clusters.push({ x: canopyCx - R * 0.32, y: canopyCy - R * 0.34, r: R * 0.66, c: light });
      clusters.push({ x: canopyCx - R * 0.05, y: canopyCy - R * 0.22, r: R * 0.5, c: light });
    }

    /* draw dark under-layer first, then mid, then light so it reads as lit from top-left */
    for (i = 0; i < clusters.length; i++) {
      if (clusters[i].c === dark) drawLeafCluster(g, clusters[i].x, clusters[i].y, clusters[i].r, clusters[i].c, k);
    }
    for (i = 0; i < clusters.length; i++) {
      if (clusters[i].c === mid) drawLeafCluster(g, clusters[i].x, clusters[i].y, clusters[i].r, clusters[i].c, k);
    }
    for (i = 0; i < clusters.length; i++) {
      if (clusters[i].c === light) drawLeafCluster(g, clusters[i].x, clusters[i].y, clusters[i].r, clusters[i].c, k);
    }

    g.restore();
    return { c: c, ax: cx, ay: baseY };
  }

  function drawLeafCluster(g, x, y, r, col, k) {
    if (r < 0.5) r = 0.5;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = "rgb(" + (col[0] | 0) + "," + (col[1] | 0) + "," + (col[2] | 0) + ")";
    g.fill();
    /* subtle inner shading: a smaller darker circle offset down-right */
    g.beginPath();
    g.arc(x + r * 0.18, y + r * 0.18, r * 0.72, 0, Math.PI * 2);
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fill();
  }

  function treeSprite(variety, k, seed) {
    /* few cached sizes: quantise by variety + seed bucket so the cache stays small */
    var q = k > 40 ? Math.round(k / 8) * 8 : (k > 16 ? Math.round(k / 4) * 4 : Math.max(4, Math.round(k)));
    var bucket = hash2(seed | 0, 17) % 4;   /* 4 distinct trees per size/variety */
    var key = variety + "|" + q + "|" + bucket;
    var e = TREE_CACHE[key];
    if (e) return e;
    var vseed = hash2(seed | 0, 17);
    e = makeTreeSprite(variety, q, vseed);
    TREE_CACHE[key] = e;
    return e;
  }

  function clutterSprite(type, k, seed) {
    var q = k > 40 ? Math.round(k / 8) * 8 : (k > 16 ? Math.round(k / 4) * 4 : Math.max(4, Math.round(k)));
    var bucket = hash2(seed | 0, 29) % 4;
    var key = type + "|" + q + "|" + bucket;
    var e = CLUTTER_CACHE[key];
    if (e) return e;
    var vertical = type === "carV";
    var w = type.indexOf("car") === 0 ? Math.max(8, q * (vertical ? 0.42 : 0.86)) :
            (type === "bench" ? Math.max(8, q * 0.62) : (type === "hedge" ? Math.max(8, q * 0.88) : Math.max(6, q * 0.30)));
    var h = type.indexOf("car") === 0 ? Math.max(12, q * (vertical ? 0.86 : 0.42)) :
            (type === "bench" ? Math.max(5, q * 0.30) : (type === "hedge" ? Math.max(4, q * 0.22) : Math.max(6, q * 0.30)));
    var c = makeCanvas(w + 4, h + 5), g = c.getContext("2d");
    var bodyCols = ["#9b5a4f", "#4f6f93", "#d2ccbc", "#6d8a5f"];   /* muted but readable on asphalt */
    var body = bodyCols[bucket], dark = "#343b3d";
    function roundRect(rx, ry, rw, rh, r, col) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(rx + r, ry); g.lineTo(rx + rw - r, ry);
      g.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
      g.lineTo(rx + rw, ry + rh - r);
      g.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
      g.lineTo(rx + r, ry + rh);
      g.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
      g.lineTo(rx, ry + r); g.quadraticCurveTo(rx, ry, rx + r, ry);
      g.closePath(); g.fill();
    }
    if (type.indexOf("car") === 0) {
      roundRect(2, 2, w, h, Math.max(2, q * 0.10), dark);
      roundRect(3, 1, w - 2, h - 3, Math.max(2, q * 0.10), body);
      if (vertical) {
        roundRect(4, h * 0.27, w - 4, h * 0.42, 2, "#424b50");
        roundRect(5, h * 0.31, w - 6, h * 0.13, 1, "#9aaeb2");
        roundRect(5, h * 0.51, w - 6, h * 0.13, 1, "#9aaeb2");
      } else {
        roundRect(w * 0.27, 3, w * 0.42, h - 5, 2, "#424b50");
        roundRect(w * 0.31, 4, w * 0.13, h - 7, 1, "#9aaeb2");
        roundRect(w * 0.51, 4, w * 0.13, h - 7, 1, "#9aaeb2");
      }
    } else if (type === "bench") {
      roundRect(2, 2, w, h * 0.48, 2, "#80694f");
      g.fillStyle = "#b49a72";
      g.fillRect(3, 3, w - 2, Math.max(1, h * 0.12));
      g.fillStyle = "#454747";
      g.fillRect(w * 0.2, h * 0.48, 2, h * 0.45);
      g.fillRect(w * 0.78, h * 0.48, 2, h * 0.45);
    } else if (type === "bin") {
      roundRect(2, 2, w, h, 2, "#596d69");
      g.fillStyle = "#aab5aa";
      g.fillRect(3, 2, w - 2, Math.max(1, h * 0.16));
    } else {
      roundRect(1, h * 0.25, w + 2, h * 0.75, 2, "#426b45");
      g.fillStyle = "#65905a";
      g.fillRect(2, h * 0.28, w, Math.max(1, h * 0.22));
    }
    e = { c: c, ax: (w + 4) / 2, ay: h + 4 };
    CLUTTER_CACHE[key] = e;
    return e;
  }

  function paintFarTrees(g) {
    var i, tr, s = cam.S, r, col, v;
    for (i = 0; i < trees.length; i++) {
      tr = trees[i];
      if (!visibleWorld(tr.x, tr.y, 0, cullMargin())) continue;
      v = tr.v || treeVariety(tr.sd || 1);
      col = v === "conifer" ? "#3f7a48" : (v === "bush" ? "#4f8f5a" : "#5c9a52");
      if (hash2(tr.sd || 1, 9) % 5 === 0) col = v === "conifer" ? "#356b3d" : "#4c8a46";
      P(tr.x, tr.y, 0);
      var baseR = (v === "bush" ? 0.30 : 0.48) * TS * s * tr.s;
      r = Math.max(2, baseR);
      /* soft shadow */
      g.fillStyle = "rgba(0,0,0,0.16)";
      g.beginPath();
      g.ellipse(_px + r * 0.35, _py + r * 0.08, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
      g.fill();
      /* canopy blob (raised above ground) */
      g.fillStyle = col;
      g.beginPath();
      g.arc(_px, _py - r * 0.9, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.beginPath();
      g.arc(_px - r * 0.3, _py - r * 1.15, r * 0.55, 0, Math.PI * 2);
      g.fill();
    }
  }

  function buildProps() {
    trees = []; lamps = []; streetProps = [];
    var placeCars = typeof PARKED !== "undefined" && PARKED.begin();   /* new map: place parked cars once (they keep their damage) */
    tprops = paris() ? THEME_PARIS.props() : [];
    var x, y, ch, i, runW, n;

    function runLen(x, y, dx, dy) {
      var n = 1;
      for (var j = 1; j < 10 && tile(x + dx * j, y + dy * j) === "."; j++) n++;
      for (var j = 1; j < 10 && tile(x - dx * j, y - dy * j) === "."; j++) n++;
      return n;
    }

    function isSidewalk(ch) {
      return ch && ch !== "." && ch !== "G" && ch !== "P" && ch !== " " && !solidCh(ch);
    }

    function edgeTile(ch) {
      return ch && ch !== "." && ch !== "G" && ch !== "P" && ch !== " ";
    }

    function nearSite(x, y) {
      var ss = MAP.sites;
      if (!ss) return false;
      for (var j = 0; j < ss.length; j++) {
        var s = ss[j];
        if (!s) continue;
        if (s.x !== undefined && s.y !== undefined &&
            Math.abs(x - s.x) <= 3 && Math.abs(y - s.y) <= 3) return true;
        if (s.x1 !== undefined && x >= s.x1 - 3 && x <= s.x2 + 3 &&
            y >= s.y1 - 3 && y <= s.y2 + 3) return true;
      }
      return false;
    }

    function atCrossing(x, y) {
      var cs = MAP.crossings;
      if (!cs) return false;
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        if (!c) continue;
        if (c.x === x && c.y === y) return true;
        if (c[0] === x && c[1] === y) return true;
        if (c.x1 !== undefined && x >= c.x1 && x <= c.x2 &&
            y >= c.y1 && y <= c.y2) return true;
      }
      return false;
    }

    function parkDensity(x, y) {
      return (hash2(x * 3 + 1, y * 5 + 7) >>> 0) / 4294967295;
    }

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        ch = tile(x, y);

        if (ch === "G") {
          var d = parkDensity(x, y);
          var cluster = (hash2(x >> 1, y >> 1) % 5) * 0.15;
          var p = 0.78 - cluster + (d - 0.5) * 0.35;
          if (d < 0.72 && p > 0.42) {
            var vx = x + 0.28 + rnd(hash2(x, y)) * 0.44;
            var vy = y + 0.28 + rnd(hash2(y, x)) * 0.44;
            var s = 0.80 + rnd(hash2(x + 9, y)) * 0.5;
            var isBush = (d > 0.6) && (hash2(x + 3, y + 11) % 4 === 0);
            var variety = isBush ? "bush" : ((hash2(x, y) % 100) < 26 ? "conifer" : "decid");
            trees.push({ x: vx, y: vy, s: s, v: variety, sd: hash2(x, y) });
          }

          if (!nearSite(x, y) && hash2(x + 9, y + 8) % 3 !== 0) {
            if (isSidewalk(tile(x - 1, y))) {
              streetProps.push({ x: x + 0.22, y: y + 0.5, type: "hedge", seed: hash2(x + 3, y + 4) });
            } else if (isSidewalk(tile(x + 1, y))) {
              streetProps.push({ x: x + 0.78, y: y + 0.5, type: "hedge", seed: hash2(x + 4, y + 3) });
            } else if (isSidewalk(tile(x, y - 1))) {
              streetProps.push({ x: x + 0.5, y: y + 0.22, type: "hedge", seed: hash2(x + 5, y + 2) });
            } else if (isSidewalk(tile(x, y + 1))) {
              streetProps.push({ x: x + 0.5, y: y + 0.78, type: "hedge", seed: hash2(x + 6, y + 1) });
            }
          }
          continue;
        }

        if (ch === ".") {
          runW = 1;
          for (i = 1; i < 6 && tile(x + i, y) === "."; i++) runW++;
          for (i = 1; i < 6 && tile(x - i, y) === "."; i++) runW++;
          var runH = 1;
          for (i = 1; i < 6 && tile(x, y + i) === "."; i++) runH++;
          for (i = 1; i < 6 && tile(x, y - i) === "."; i++) runH++;

          var isWideV = runW >= 4, isWideH = runH >= 4;
          var place = false, sx = x + 0.5, sy = y + 0.5;
          if (isWideV && !isWideH && (y % 3 === 1 || y % 4 === 2)) {
            if (solidCh(tile(x - 1, y))) { sx = x + 0.22; sy = y + 0.5; place = true; }
            else if (solidCh(tile(x + 1, y))) { sx = x + 0.78; sy = y + 0.5; place = true; }
          }
          if (isWideH && !isWideV && (x % 3 === 1 || x % 4 === 2)) {
            if (solidCh(tile(x, y - 1))) { sx = x + 0.5; sy = y + 0.22; place = true; }
            else if (solidCh(tile(x, y + 1))) { sx = x + 0.5; sy = y + 0.78; place = true; }
          }
          if (isWideV && isWideH) place = false;
          if (place && hash2(x + 5, y + 3) % 5 !== 0) {
            trees.push({ x: sx, y: sy, s: 0.85 + rnd(hash2(x, y + 1)) * 0.25, v: "decid", sd: hash2(x, y + 1) });
          }

          if (!atCrossing(x, y) && !nearSite(x, y)) {
            var rw = runLen(x, y, 1, 0);
            var rh = runLen(x, y, 0, 1);
            if (Math.min(rw, rh) <= 9) {   /* skip junctions and squares (wide both ways) */
              if (rw > rh && rh >= 3) {
                var side = 0;
                if (edgeTile(tile(x, y - 1))) side = -1;
                else if (edgeTile(tile(x, y + 1))) side = 1;
                if (side) {
                  var spacing = 4 + (hash2(side > 0 ? 17 : 31, y + 5) % 4);
                  var phase = hash2(side > 0 ? 23 : 37, y + 9) % spacing;
                  if ((x - phase) % spacing === 0) {
                    if (placeCars) PARKED.add(x + 0.5, y + 0.5 + side * 0.28, 0, hash2(x, y + side));
                  }
                }
              } else if (rh > rw && rw >= 3) {
                var sideV = 0;
                if (edgeTile(tile(x - 1, y))) sideV = -1;
                else if (edgeTile(tile(x + 1, y))) sideV = 1;
                if (sideV) {
                  var spacingV = 4 + (hash2(x + 7, sideV > 0 ? 19 : 23) % 4);
                  var phaseV = hash2(x + 11, sideV > 0 ? 29 : 41) % spacingV;
                  if ((y - phaseV) % spacingV === 0) {
                    if (placeCars) PARKED.add(x + 0.5 + sideV * 0.28, y + 0.5, Math.PI / 2, hash2(x + sideV, y));
                  }
                }
              }
            }
          }
        }

        if (ch === "P") {
          var edge = solidCh(tile(x - 1, y)) || solidCh(tile(x + 1, y)) ||
                     solidCh(tile(x, y - 1)) || solidCh(tile(x, y + 1));
          if (edge && hash2(x + 7, y + 1) % 3 !== 0) {
            var px = x + 0.5, py = y + 0.5;
            if (solidCh(tile(x - 1, y))) px = x + 0.22;
            else if (solidCh(tile(x + 1, y))) px = x + 0.78;
            else if (solidCh(tile(x, y - 1))) py = y + 0.22;
            else if (solidCh(tile(x, y + 1))) py = y + 0.78;
            trees.push({ x: px, y: py, s: 0.85 + rnd(hash2(x + 1, y)) * 0.3, v: hash2(x, y) % 100 < 20 ? "conifer" : "decid", sd: hash2(x + 1, y) });
          }

          if (edge && !nearSite(x, y) && !atCrossing(x, y)) {
            var spP = 8 + (hash2(x + 19, y + 31) % 7);
            if (((x + y * 2) % spP) === 0 && hash2(x + 2, y + 3) % 3 !== 0) {
              var isBenchP = hash2(x + 13, y + 2) % 2 === 0;
              streetProps.push({ x: x + 0.5, y: y + 0.5, type: isBenchP ? "bench" : "bin", seed: hash2(x + 1, y + 9) });
            }
          }
        }

        if (ch !== "." && ch !== "G" && ch !== "P" && !solidCh(ch) &&
            !nearSite(x, y) && !atCrossing(x, y)) {
          var sp2 = 8 + (hash2(x + 41, y + 17) % 7);
          if (((x + y * 3) % sp2) === 0 && hash2(x + 5, y + 7) % 3 !== 0) {
            var isBench = hash2(x + 13, y + 2) % 2 === 0;
            streetProps.push({ x: x + 0.5, y: y + 0.5, type: isBench ? "bench" : "bin", seed: hash2(x + 1, y + 9) });
          }
        }

        if (ch === "." && x % 7 === 3) {
          if (solidCh(tile(x, y - 1)) && tile(x, y + 1) === "." && tile(x, y + 2) === ".") lamps.push({ x: x + 0.5, y: y + 0.22 });
          if (solidCh(tile(x, y + 1)) && tile(x, y - 1) === "." && tile(x, y - 2) === ".") lamps.push({ x: x + 0.5, y: y + 0.78 });
        }
      }
    }
    if (typeof PARKED !== "undefined") {
      var pc = PARKED.list();
      for (i = 0; i < pc.length; i++) streetProps.push({ x: pc[i].x, y: pc[i].y, type: "parked", car: pc[i] });
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

  function invalidate() { _dirty = true; FAR_DIRTY = true; }

  function init(G) {
    loadView();
    _G = G;
    var resized = W !== MAP.width || H !== MAP.height;
    W = MAP.width; H = MAP.height;
    LW = W * CONFIG.tileSize; LH = H * CONFIG.tileSize;
    /* ground detail per tile: 32 px, less on big maps so the cached ground stays under ~4096 px */
    GT = Math.max(16, Math.min(32, Math.floor(4096 / Math.max(W, H))));
    if (!heights || resized) { cam.cx = W / 2; cam.cy = H / 2; cam.zoom = 1; }
    updateCamera();
    mapShops(G);
    pickColors();
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

  /* Drawn positions glide toward the simulated ones: no jitter, no 30 Hz steps. */
  var smoothK = 1, lastDrawT = 0;
  function smoothPos(e) {
    if (e._rx === undefined || Math.abs(e._rx - e.x) > 1.5 || Math.abs(e._ry - e.y) > 1.5) { e._rx = e.x; e._ry = e.y; }
    else { e._rx += (e.x - e._rx) * smoothK; e._ry += (e.y - e._ry) * smoothK; }
  }
  /* the crowd's person sprite for other modules (civilians, owners, culprits):
   * x, y in tiles, id picks the look, shirt colour, speed animates the walk */
  var personSpecs = {};
  function drawPerson(ctx, x, y, id, shirt, speed) {
    if (typeof PEOPLE === "undefined") return false;
    var key = (id | 0) + shirt, spec = personSpecs[key];
    if (!spec) spec = personSpecs[key] = PEOPLE.civSpec(hash2(id | 0, 11) % 24, shirt);
    P(x, y, 0);
    var fr = Q_BOB ? PEOPLE.frameFor(id | 0, speed || 0, Date.now() / 1000) : 0;
    var sp = PEOPLE.sprite(spec, fr, spriteScale(cam.S));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sp.c, _rs * _px - sp.ax, _rs * _py - sp.ay);
    ctx.restore();
    return true;
  }

  function drawAgent(ctx, a, t) {
    var s = cam.S;
    smoothPos(a);
    P(a._rx, a._ry, 0);
    var bx = _px, by = _py;
    var sp2 = (a.vx || 0) * (a.vx || 0) + (a.vy || 0) * (a.vy || 0);
    if (sp2 > 0.02 && Q_BOB) by -= Math.abs(Math.sin(t * 11 + a.id)) * 1.3 * s;
    var r = 2.9 * s, hb = 8.6 * s;
    var revealed = a.role === "rioter" && _G && _G.time < a.revealedUntil;
    var pal = agentPal(a);
    var base = revealed ? "#ff2338" : pal.base, dark = revealed ? "#b3121f" : pal.dark;
    var hid = hash2(a.id | 0, 3);
    var placard = Q_PLACARDS && !revealed && hid % 4 === 0 && typeof PEOPLE === "undefined";
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
    var sp;
    if (typeof PEOPLE !== "undefined") {
      var shirt = revealed ? "#ff2338" : base;
      var sk = (a.blocDressed ? "b" : "c") + shirt;
      var specs = a._ppl || (a._ppl = {});
      var spec = specs[sk];
      if (!spec) {
        spec = PEOPLE.civSpec(hash2(a.id | 0, 11) % 24, shirt);
        if (a.blocDressed) { spec.hat = "hood"; spec.top = "hoodie"; spec.pants = "#1d1f24"; spec.sign = null; }
        specs[sk] = spec;
      }
      var fr = Q_BOB ? PEOPLE.frameFor(a.id | 0, Math.sqrt(sp2), t) : 0;
      sp = PEOPLE.sprite(spec, fr, spriteScale(s));
      by = _py;
    } else {
      sp = revealed ? agentSprite("R", dark, base, "#ff6b78") : agentSprite(pal.id, dark, base, pal.light);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (a.mood > 55) {   /* anger shows as a red glow on the ground: clothes hide the shirt tint */
      var ga = Math.min(0.75, (a.mood - 55) / 45 * 0.75);
      ctx.fillStyle = a.mood > 80 ? "rgba(235,30,45," + ga + ")" : "rgba(240,120,40," + ga + ")";
      ctx.beginPath();
      ctx.ellipse(_rs * bx, _rs * _py, _rs * r * 1.7, _rs * r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
    }
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
    var firm = o.stance === "firm";
    var fwd, side, w, z0, z1, tilt;
    if (firm) {
      /* raised in front, across the officer: 0.55 tall, 0.32 wide */
      fwd = 0.22; side = 0.0; w = 0.16; z0 = 0.10; z1 = 0.65; tilt = 0.0;
    } else {
      /* held at the side, offset to the officer's left (across heading): 0.45 x 0.26 */
      fwd = 0.10; side = 0.20; w = 0.13; z0 = 0.04; z1 = 0.49; tilt = 0.08;
    }
    var ox = o.x + c * fwd + sn * side, oy = o.y + sn * fwd - c * side;
    /* corners in ground-plane offsets: across heading = (sn,-c) */
    var ax = sn * w, ay = -c * w;
    /* slight angle: shift the far edge along heading */
    var bx = ax + c * tilt, by = ay + sn * tilt;
    var x0, y0, x1, y1, x2, y2, x3, y3;

    P(ox + bx, oy + by, z0); x0 = _px; y0 = _py;
    P(ox - bx, oy - by, z0); x1 = _px; y1 = _py;
    P(ox - bx, oy - by, z1); x2 = _px; y2 = _py;
    P(ox + bx, oy + by, z1); x3 = _px; y3 = _py;

    /* polycarbonate body: light-blue fill */
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fillStyle = "rgba(160,205,240,0.80)";
    ctx.fill();

    /* dark rim */
    var rw = Math.max(1, 0.02 * CONFIG.tileSize * cam.S);
    ctx.strokeStyle = "rgba(20,30,45,0.9)";
    ctx.lineWidth = rw;
    ctx.stroke();

    /* highlight stripe: thin band down the middle */
    var hx0, hy0, hx1, hy1, hx2, hy2, hx3, hy3;
    P(ox + ax * 0.45, oy + ay * 0.45, z0 + (z1 - z0) * 0.15); hx0 = _px; hy0 = _py;
    P(ox - ax * 0.45, oy - ay * 0.45, z0 + (z1 - z0) * 0.15); hx1 = _px; hy1 = _py;
    P(ox - ax * 0.45, oy - ay * 0.45, z1 - (z1 - z0) * 0.15); hx2 = _px; hy2 = _py;
    P(ox + ax * 0.45, oy + ay * 0.45, z1 - (z1 - z0) * 0.15); hx3 = _px; hy3 = _py;
    ctx.beginPath();
    ctx.moveTo(hx0, hy0);
    ctx.lineTo(hx1, hy1);
    ctx.lineTo(hx2, hy2);
    ctx.lineTo(hx3, hy3);
    ctx.closePath();
    ctx.fillStyle = "rgba(235,244,252,0.30)";
    ctx.fill();

    /* dark horizontal band with POLICE hint */
    var bz0 = z0 + (z1 - z0) * 0.52, bz1 = bz0 + (z1 - z0) * 0.16;
    var b0x, b0y, b1x, b1y, b2x, b2y, b3x, b3y;
    P(ox + ax, oy + ay, bz0); b0x = _px; b0y = _py;
    P(ox - ax, oy - ay, bz0); b1x = _px; b1y = _py;
    P(ox - ax, oy - ay, bz1); b2x = _px; b2y = _py;
    P(ox + ax, oy + ay, bz1); b3x = _px; b3y = _py;
    ctx.beginPath();
    ctx.moveTo(b0x, b0y);
    ctx.lineTo(b1x, b1y);
    ctx.lineTo(b2x, b2y);
    ctx.lineTo(b3x, b3y);
    ctx.closePath();
    ctx.fillStyle = "rgba(15,25,40,0.85)";
    ctx.fill();
  }

  function drawWheel(ctx, x, y, c, sn, r, s) {
    /* ellipse squashed across the heading */
    var ax = c, ay = sn, bx = -sn, by = c;
    ctx.beginPath();
    var n = 14, i, u, v, a, ca, sa;
    for (i = 0; i <= n; i++) {
      a = (i / n) * Math.PI * 2;
      ca = Math.cos(a) * r;
      sa = Math.sin(a) * r * 0.62;
      P(x + ax * ca + bx * sa, y + ay * ca + by * sa, r);
      if (i === 0) ctx.moveTo(_px, _py); else ctx.lineTo(_px, _py);
    }
    ctx.closePath();
    ctx.fillStyle = "#1c2028";
    ctx.fill();
    /* hub */
    P(x, y, r);
    var hx = _px, hy = _py;
    var hr = Math.max(0.8, 0.30 * r * CONFIG.tileSize * cam.S);
    ctx.beginPath();
    ctx.ellipse(hx, hy, hr, hr * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#8a929e";
    ctx.fill();
  }

  function angScreen(c) {
    return 0;
  }

  function drawMotorbike(ctx, o, t, s, c, sn) {
    var lean = typeof o._lean === "number" ? o._lean : 0;
    var lx = -sn * lean * 0.12, ly = c * lean * 0.12;   /* lateral lean shift */
    var bx = o.x + lx, by = o.y + ly;
    var fast = (o.speed || 0) > 1.2 || Math.abs(o.vx || 0) + Math.abs(o.vy || 0) > 1.2;
    var TS = CONFIG.tileSize * cam.S;
    var lw = Math.max(1, Math.min(0.06 * TS, 0.05 * TS + 0.5));
    var zAx = 0.13, wR = 0.13;
    /* rear and front wheel positions (total length ~0.85 tiles) */
    var rf = -0.30, ff = 0.30;

    /* exhaust */
    P(bx + c * rf + sn * 0.08, by + sn * rf - c * 0.08, 0.15);
    var ex0 = _px, ey0 = _py;
    P(bx + c * (rf - 0.08) + sn * 0.08, by + sn * (rf - 0.08) - c * 0.08, 0.15);
    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(ex0, ey0); ctx.lineTo(_px, _py); ctx.stroke();

    /* body: white/blue hull along heading */
    obox(ctx, bx, by, c, sn, rf + 0.02, ff - 0.04, 0.14, zAx, 0.40, "#f2f5f8", [32, 48, 74], [39, 75, 143, 0.24, 0.32]);   /* side colours are [r,g,b]; band [r,g,b,z0,z1] */
    /* lower blue fairing */
    obox(ctx, bx, by, c, sn, rf + 0.02, ff - 0.08, 0.15, zAx + 0.02, 0.26, "#274b8f", [26, 47, 87], null);
    /* front fairing / nose */
    obox(ctx, bx, by, c, sn, ff - 0.12, ff + 0.02, 0.12, 0.16, 0.42, "#eef3f8", [32, 48, 74], [43, 99, 184, 0.3, 0.36]);
    /* seat */
    obox(ctx, bx, by, c, sn, rf + 0.05, rf + 0.20, 0.09, 0.38, 0.44, "#151a20", [14, 18, 24], null);
    /* windscreen (translucent) */
    obox(ctx, bx, by, c, sn, ff - 0.04, ff + 0.03, 0.10, 0.42, 0.58, "rgba(200,225,245,0.55)", [160, 190, 220], null);
    /* handlebars across the heading */
    P(bx + c * (ff - 0.05) + sn * 0.15, by + sn * (ff - 0.05) - c * 0.15, 0.50);
    var hx0 = _px, hy0 = _py;
    P(bx + c * (ff - 0.05) - sn * 0.15, by + sn * (ff - 0.05) + c * 0.15, 0.50);
    ctx.strokeStyle = "#2a303a";
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(hx0, hy0); ctx.lineTo(_px, _py); ctx.stroke();
    /* rear light bar */
    P(bx + c * rf, by + sn * rf, 0.44);
    var lbx = _px, lby = _py;
    var on = fast && (Math.floor(t * 4) % 2) === 0;
    var lwR = Math.max(2, 0.05 * TS);
    var lhR = Math.max(1.5, 0.035 * TS);
    ctx.fillStyle = on ? "#3b7bff" : "#1d2f55";
    ctx.fillRect(lbx - lwR * 0.5, lby - lhR * 0.5, lwR, lhR);
    /* wheels drawn after body */
    drawWheel(ctx, bx + c * rf, by + sn * rf, c, sn, wR, s);
    drawWheel(ctx, bx + c * ff, by + sn * ff, c, sn, wR, s);
  }

  var OFF_SPECS = {};
  function drawOfficer(ctx, o, t) {
    if (o.drawAlpha === 0) return;
    var s = cam.S * (typeof o.drawScale === "number" ? o.drawScale : 1), ang = officerAng(o), c = Math.cos(ang), sn = Math.sin(ang);
    var a0 = ctx.globalAlpha;
    if (typeof o.drawAlpha === "number") ctx.globalAlpha = a0 * Math.max(0, Math.min(1, o.drawAlpha));   /* getting in / out of a vehicle */
    smoothPos(o);
    var ox0 = o.x, oy0 = o.y;
    o.x = o._rx; o.y = o._ry;   /* draw at the smoothed spot (restored below) */
    try { drawOfficerAt(ctx, o, t, s, ang, c, sn); } finally { o.x = ox0; o.y = oy0; ctx.globalAlpha = a0; }
  }
  function drawOfficerAt(ctx, o, t, s, ang, c, sn) {
    var firm = o.stance === "firm", bike = o.baseSpeed >= CONFIG.motorbikeSpeed;
    var lo = Police.getLoadout(_G, o.squad);
    var riot = !!UNITTYPES.get(lo).riotGear;   /* riot helmets and shields (src/units/*.js) */
    var horse = lo === "mounted";
    if (bike) drawMotorbike(ctx, o, t, s, c, sn);
    var front = c + sn > 0;
    if (horse && typeof UNITS !== "undefined") { P(o.x, o.y, 0); UNITS.drawHorse(ctx, _px, _py, ang, s * 1.9, t, o.panicUntil > _G.time); }
    if (riot && firm && !front) drawShield(ctx, o, c, sn);
    P(o.x, o.y, bike ? 0.25 : 0);
    var bx = _px, by = _py - (horse ? 11 * s : 0), r = 3.2 * s, hb = 9 * s;
    var liaison = typeof LIAISON !== "undefined" && lo === "liaison";
    if (typeof PEOPLE !== "undefined") {
      var kind, hat;
      if (lo === "ambulance") { kind = "medic"; hat = null; }
      else if (liaison) { kind = "liaison"; hat = null; }
      else if (riot) { kind = "riot"; hat = "riothelmet"; }
      else { kind = "officer"; hat = "cap"; }
      var ospec = OFF_SPECS[kind] || (OFF_SPECS[kind] = { kind: kind, hat: hat });
      if (ospec.hat !== hat) ospec.hat = hat;
      var spd = Math.sqrt((o.tx - o.x) * (o.tx - o.x) + (o.ty - o.y) * (o.ty - o.y)) > 0.1 ? o.speed || 1.5 : 0;
      var osp = PEOPLE.sprite(ospec, Q_BOB && !horse && !bike ? PEOPLE.frameFor(o.id | 0, spd, t) : 0, spriteScale(s));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(osp.c, _rs * bx - osp.ax, _rs * by - osp.ay);
      setScreen(ctx);
    } else {
      capsule(ctx, bx, by, r, hb, riot ? "#151a22" : "#16294a");
      capsule(ctx, bx - r * 0.25, by - 0.4 * s, r * 0.72, hb - 0.8 * s, riot ? "#2a323f" : "#24406e");
      if (liaison) { ctx.fillStyle = LIAISON.vestColor; ctx.fillRect(bx - r, by - hb * 0.75, r * 2, hb * 0.5); }
      else if (!riot) { ctx.fillStyle = "#d9f24a"; ctx.fillRect(bx - r, by - hb * 0.62, r * 2, 1.6 * s); }
      disc(ctx, bx, by - hb - 2 * s, 2.6 * s, riot ? "#0f1218" : "#1b2c4a");
      if (riot) { ctx.fillStyle = "rgba(150,190,230,0.8)"; ctx.fillRect(bx - 1.8 * s, by - hb - 2.4 * s, 3.6 * s, 1.1 * s); }
    }
    disc(ctx, bx, by - hb - 6 * s, Math.max(1, 1.3 * s), sqCol(o.squad));
    if (riot && (!firm || front)) drawShield(ctx, o, c, sn);
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
    if (typeof VEHICLES !== "undefined" && VEHICLES.size && v.type !== "watertruck") {
      /* detailed pre-rendered vehicle sprite, one per heading */
      var vsp = VEHICLES.sprite(v.type, VEHICLES.angleIndex(ang), _rs * cam.S, on);
      P(x, y, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(vsp.c, _rs * _px - vsp.ax, _rs * _py - vsp.ay);
      setScreen(ctx);
      return;
    }
    if (typeof VEHICLES !== "undefined" && v.type === "watertruck") {
      var wsp = VEHICLES.sprite("watertruck", VEHICLES.angleIndex(ang), _rs * cam.S, on);
      P(x, y, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(wsp.c, _rs * _px - wsp.ax, _rs * _py - wsp.ay);
      setScreen(ctx);
      if (!(_G && _G.waterFx && _G.time < _G.waterFx.until)) return;   /* turret only matters while spraying */
    }
    if (v.type === "car") {
      obox(ctx, x, y, c, sn, -0.85, 0.85, 0.4, 0, 0.14, "#2a2f38", C_DARK);
      obox(ctx, x, y, c, sn, -0.9, 0.9, 0.42, 0.12, 0.48, "#f5f7fa", C_WHITE, [42, 93, 176, 0.24, 0.34]);
      obox(ctx, x, y, c, sn, -0.45, 0.35, 0.36, 0.48, 0.76, "#dde6f0", [110, 140, 180]);
      obox(ctx, x, y, c, sn, -0.18, 0.06, 0.3, 0.76, 0.84, on ? "#ff3b3b" : "#3b7dff", on ? [200, 40, 40] : [40, 90, 210]);
    } else if (v.type === "ambulance") {
      /* ambulance: white box with red stripe and cross, blue lights */
      obox(ctx, x, y, c, sn, -1.0, 1.0, 0.44, 0, 0.15, "#2a2f38", C_DARK);
      obox(ctx, x, y, c, sn, -1.05, 0.5, 0.46, 0.13, 0.9, "#fbfbfb", C_WHITE, [220, 38, 38, 0.4, 0.52]);
      obox(ctx, x, y, c, sn, 0.5, 1.05, 0.46, 0.13, 0.7, "#f1f3f5", C_WHITE, [220, 38, 38, 0.4, 0.52]);
      obox(ctx, x, y, c, sn, -0.45, -0.05, 0.12, 0.9, 0.95, "#dc2626", [190, 30, 30]);
      obox(ctx, x, y, c, sn, -0.6, 0.1, 0.05, 0.9, 0.95, "#dc2626", [190, 30, 30]);
      obox(ctx, x, y, c, sn, 0.3, 0.5, 0.3, 0.9, 0.98, on ? "#3b7dff" : "#bcd4ff", [40, 90, 210]);
    } else if (v.type === "van") {
      /* police van: tall white box with a blue band, light bar on the cab */
      obox(ctx, x, y, c, sn, -1.05, 1.05, 0.45, 0, 0.15, "#2a2f38", C_DARK);
      obox(ctx, x, y, c, sn, -1.1, 0.55, 0.47, 0.13, 0.92, "#f2f5f9", C_WHITE, [42, 93, 176, 0.36, 0.5]);
      obox(ctx, x, y, c, sn, 0.55, 1.1, 0.47, 0.13, 0.72, "#e8eef6", C_WHITE, [42, 93, 176, 0.36, 0.5]);
      obox(ctx, x, y, c, sn, 0.62, 0.95, 0.4, 0.5, 0.7, "#cfdcec", [110, 140, 180]);
      obox(ctx, x, y, c, sn, 0.3, 0.55, 0.32, 0.92, 1.0, on ? "#ff3b3b" : "#3b7dff", on ? [200, 40, 40] : [40, 90, 210]);
    } else if (v.type === "truck") {
      /* riot truck: long dark-blue armoured body with mesh windows */
      obox(ctx, x, y, c, sn, -1.4, 1.4, 0.52, 0, 0.18, "#22262e", C_DARK);
      obox(ctx, x, y, c, sn, -1.45, 0.75, 0.54, 0.16, 1.05, "#2b4a7a", [36, 64, 110], [230, 236, 245, 0.62, 0.7]);
      obox(ctx, x, y, c, sn, 0.75, 1.45, 0.54, 0.16, 0.9, "#355a92", [44, 76, 128]);
      obox(ctx, x, y, c, sn, 0.85, 1.3, 0.45, 0.62, 0.86, "#9fb3cf", [120, 140, 170]);
      obox(ctx, x, y, c, sn, 0.95, 1.25, 0.3, 0.9, 0.98, on ? "#ff3b3b" : "#3b7dff", on ? [200, 40, 40] : [40, 90, 210]);
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
    var k = _rs * cam.S * TS * tr.s;   /* device px per tile */
    var sp = treeSprite(tr.v || treeVariety(tr.sd || 1), k, tr.sd || 1);
    P(tr.x, tr.y, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sp.c, _rs * _px - sp.ax, _rs * _py - sp.ay);
    setScreen(ctx);
  }
  function drawClutter(ctx, tr) {
    if (_rs * cam.S * TS < 8) return;
    if (tr.type === "parked") {   /* real parked car (parked.js), drawn at real size with its damage */
      P(tr.x, tr.y, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      PARKED.drawCar(ctx, tr.car, _rs * _px, _rs * _py, _rs * cam.S * TS, G);
      setScreen(ctx);
      return;
    }
    var k = _rs * cam.S * TS * (tr.s || 1);
    var sp = clutterSprite(tr.type, k, tr.seed || 0);
    P(tr.x, tr.y, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sp.c, _rs * _px - sp.ax, _rs * _py - sp.ay);
    setScreen(ctx);
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
    else if (it.k === 5) { if (it.o.type) drawClutter(ctx, it.o); else drawTree(ctx, it.o); }
    else if (it.k === 7) THEME_PARIS.drawProp(ctx, it.o, t);
    else if (it.k === 8) drawPerson(ctx, it.o.x, it.o.y, it.o.id, it.o.shirt, it.o.speed);
    else if (it.k === 9) {   /* moving civilian car (traffic.js), same sprite as parked cars */
      if (_rs * cam.S * TS < 6) return;
      P(it.o.x, it.o.y, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      PARKED.drawCar(ctx, it.o, _rs * _px, _rs * _py, _rs * cam.S * TS, G);
      setScreen(ctx);
    }
    else drawLamp(ctx, it.o);
  }

  /* passers-by, shop owners and thieves join the depth-sorted pass so buildings hide them */
  function ppOf(src, id, shirt, speed) {
    var o = src._pp || (src._pp = { x: 0, y: 0, id: id, shirt: shirt, speed: 0 });
    o.x = src.x; o.y = src.y; o.shirt = shirt; o.speed = speed;
    return o;
  }
  function pushPeople(G, cm) {
    var i, j, c, L;
    if (typeof TRAFFIC !== "undefined" && typeof PARKED !== "undefined") {
      L = TRAFFIC.list();
      for (i = 0; i < L.length; i++) if (visibleWorld(L[i].x, L[i].y, 0, cm)) push(9, L[i], L[i].x, L[i].y);
      L = TRAFFIC.people();
      for (i = 0; i < L.length; i++) { c = L[i]; if (visibleWorld(c.x, c.y, 0, cm)) push(8, ppOf(c, 12000 + c.id, c.col || "#8a7a6a", c.state === "walk" ? 1 : 0), c.x, c.y); }
    }
    if (typeof CIVLIFE !== "undefined" && CIVLIFE.list) for (i = 0; i < CIVLIFE.list.length; i++) {
      c = CIVLIFE.list[i];
      if (visibleWorld(c.x, c.y, 0, cm)) push(8, ppOf(c, 5000 + c.id, c.color, c.state === "flee" ? 2.5 : 1), c.x, c.y);
    }
    if (typeof OWNERS !== "undefined" && OWNERS.list) { L = OWNERS.list(); for (i = 0; i < L.length; i++) {
      c = L[i];
      if (!c.hurt && visibleWorld(c.x, c.y, 0, cm)) push(8, ppOf(c, 9000 + i, c.arguing ? "#5577cc" : "#99bbee", 0), c.x, c.y);
    } }
    if (typeof CRIME !== "undefined" && CRIME.list) { L = CRIME.list(); for (i = 0; i < L.length; i++) {
      for (j = 0; L[i].culprits && j < L[i].culprits.length; j++) {
        c = L[i].culprits[j];
        if (!c.caught && visibleWorld(c.x, c.y, 0, cm)) push(8, ppOf(c, 7000 + L[i].id * 3 + j, "#2a2030", c.fleeT > 0 ? 2.5 : 0), c.x, c.y);
      }
    } }
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
    var i, cm = cullMargin();
    poolN = 0; ghosts.length = 0;
    for (i = 0; i < buckets.length; i++) if (buckets[i]) buckets[i].length = 0;
    for (i = 0; i < trees.length; i++) if (visibleWorld(trees[i].x, trees[i].y, 0, cm)) push(5, trees[i], trees[i].x, trees[i].y);
    for (i = 0; i < streetProps.length; i++) if (cam.S > 0.35 && visibleWorld(streetProps[i].x, streetProps[i].y, 0, cm)) push(5, streetProps[i], streetProps[i].x, streetProps[i].y);
    for (i = 0; i < lamps.length; i++) if (visibleWorld(lamps[i].x, lamps[i].y, 0, cm)) push(6, lamps[i], lamps[i].x, lamps[i].y);
    for (i = 0; i < tprops.length; i++) if (visibleWorld(tprops[i].x, tprops[i].y, 0, cm)) push(7, tprops[i], tprops[i].x, tprops[i].y);
    if (!G) return;
    lodDots = 15 * _rs * cam.S < (CONFIG.peopleLodPx || 9);
    lodN = 0;
    if (G.agents) for (i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (!a.active) continue;
      if (!visibleWorld(a.x, a.y, 0, cm)) continue;
      if (lodDots) { lodList[lodN++] = a; continue; }
      push(0, a, a.x, a.y);
    }
    if (!lodDots) pushPeople(G, cm);
    if (G.barriers) for (i = 0; i < G.barriers.length; i++) {
      var b = G.barriers[i];
      if (!visibleWorld(b.x + 0.5, b.y + 0.5, 0, cm)) continue;
      if (typeof b._artAng !== "number") b._artAng = barrierAng(G, b);
      push(3, b, b.x + 0.5, b.y + 0.5);
    }
    if (G.vehicles) for (i = 0; i < G.vehicles.length; i++) if (visibleWorld(G.vehicles[i].x, G.vehicles[i].y, 0, cm)) push(2, G.vehicles[i], G.vehicles[i].x, G.vehicles[i].y);
    if (G.officers) for (i = 0; i < G.officers.length; i++) if (visibleWorld(G.officers[i].x, G.officers[i].y, 0, cm)) push(1, G.officers[i], G.officers[i].x, G.officers[i].y);
    if (G.detainees) for (i = 0; i < G.detainees.length; i++) if (visibleWorld(G.detainees[i].x, G.detainees[i].y, 0, cm)) push(4, G.detainees[i], G.detainees[i].x, G.detainees[i].y);
  }

  /* Far zoom: every visible person as a small dot, one path per colour. */
  var lodDots = false, lodList = [], lodN = 0, lodGroups = {};
  function drawLodPeople(ctx) {
    var s = cam.S, r = Math.max(1.2, 2.6 * s), h = Math.max(2, 7 * s), i, k, a, col, g;
    for (k in lodGroups) if (lodGroups.hasOwnProperty(k)) lodGroups[k].n = 0;
    for (i = 0; i < lodN; i++) {
      a = lodList[i];
      col = (a.role === "rioter" && _G && _G.time < a.revealedUntil) ? "#ff2338" : agentPal(a).base;
      g = lodGroups[col] || (lodGroups[col] = { n: 0, xs: [], ys: [] });
      P(a.x, a.y, 0);
      g.xs[g.n] = _px; g.ys[g.n] = _py; g.n++;
    }
    ctx.fillStyle = "rgba(0,0,0,0.28)";   /* shadows */
    ctx.beginPath();
    for (k in lodGroups) if (lodGroups.hasOwnProperty(k)) {
      g = lodGroups[k];
      for (i = 0; i < g.n; i++) ctx.rect(g.xs[i] - r, g.ys[i] - r * 0.4, r * 2, r * 0.8);
    }
    ctx.fill();
    for (k in lodGroups) if (lodGroups.hasOwnProperty(k)) {
      g = lodGroups[k];
      if (!g.n) continue;
      ctx.fillStyle = k;
      ctx.beginPath();
      for (i = 0; i < g.n; i++) ctx.rect(g.xs[i] - r * 0.7, g.ys[i] - h, r * 1.4, h);
      ctx.fill();
    }
    ctx.fillStyle = "#3a2c22";   /* heads */
    ctx.beginPath();
    for (k in lodGroups) if (lodGroups.hasOwnProperty(k)) {
      g = lodGroups[k];
      for (i = 0; i < g.n; i++) ctx.rect(g.xs[i] - r * 0.55, g.ys[i] - h - r, r * 1.1, r * 1.1);
    }
    ctx.fill();
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
    var v = visTiles(ctx, 1);
    blitGround(ctx, v.x0 - 1, v.y0 - 1, v.x1 + 1, v.y1 + 1, 0, 0, 1, v.px >= 7);   /* chunks only when tiles are big enough to see */
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
    /* trees: no extra blob — the sprite has its own soft shadow */
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
    fillPaths(ctx, drow(d));
    setScreen(ctx);
  }

  /* Fill one row's building paths in the current (world-unit) transform. */
  var PAVE = "#f1f4f7";   /* pavement colour under cut building corners */
  var COL_DEFAULT = { wall: "#9fb0c4", window: "#8193aa", tops: ["#c5d0dd", "#bccad9", "#cbd5e1"],
    shopWall: "#eadfc9", shopTop: "#f3ece0", roofSide: "#b3c0cf", roofTop: "#e6ebf1" };
  var COL = COL_DEFAULT;
  function pickColors() {
    COL = COL_DEFAULT;
    if (typeof BUILDINGS !== "undefined" && typeof document !== "undefined") {
      /* textured roofs, walls and windows (canvas patterns) */
      var f = BUILDINGS.fills(document.createElement("canvas").getContext("2d"), paris() ? "paris" : "grid");
      COL = { wall: f.wall, window: f.window, tops: f.tops, shopWall: f.shopWall, shopTop: f.shopTop, roofSide: f.roofSide, roofTop: f.roofTop };
      return;
    }
    if (!paris()) return;
    var c = THEME_PARIS.colors;
    COL = { wall: c.wall, window: c.window, tops: c.tops, shopWall: c.shopWall, shopTop: c.shopTop,
      roofSide: c.roofBoxSide || "#7d8a99", roofTop: c.roofBoxTop || "#b0bac6" };
  }
  function fillPaths(ctx, p) {
    ctx.fillStyle = COL.wall; ctx.fill(p.sw);
    ctx.fillStyle = COL.window; ctx.fill(p.winS);
    ctx.fillStyle = COL.tops[0]; ctx.fill(p.tops[0]);
    ctx.fillStyle = COL.tops[1]; ctx.fill(p.tops[1]);
    ctx.fillStyle = COL.tops[2]; ctx.fill(p.tops[2]);
    if (p.shop) {
      ctx.fillStyle = COL.shopWall; ctx.fill(p.shS);
      ctx.fillStyle = COL.shopTop; ctx.fill(p.shTop);
    }
    if (p.roof) {
      ctx.fillStyle = COL.roofSide; ctx.fill(p.rS);
      ctx.fillStyle = COL.roofTop; ctx.fill(p.rTop);
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
    if (groundCv) blitGround(g, rx0 / TS - 1, ry0 / TS - 1, rx1 / TS + 1, ry1 / TS + 1, 0, 0, TS, true);
    SC.bg = { c: bg, ox: rx0, oy: ry0 };
    SC.strips = [];
    for (d0 = 0; d0 < ND; d0 += 2) {
      var e = null;
      var inY = (d0 + 2) * TS + 1 > ry0 && d0 * TS - HMAXZ * ZU - 1 < ry1;   /* only rows in this cache area get built */
      if (diags && inY && (drow(d0) || drow(d0 + 1))) {
        var sx0 = Math.max(rx0, 0), sx1 = Math.min(rx1, W * TS);
        var top = snap(Math.max(ry0, d0 * TS - HMAXZ * ZU - 1), ry0, k);
        var bot = Math.min(ry1, (d0 + 2) * TS + 1);
        if (bot > top && sx1 > sx0) {
          var c = makeCanvas((sx1 - sx0) * k, (bot - top) * k), cg = c.getContext("2d");
          cg.setTransform(k, 0, 0, k, -sx0 * k, -top * k);
          if (drow(d0)) fillPaths(cg, drow(d0));
          if (drow(d0 + 1)) fillPaths(cg, drow(d0 + 1));
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
    var fx = G.waterFx, i, N = 26, s = cam.S, cm = cullMargin();
    if (!visibleWorld(fx.x, fx.y, 0, cm) && !visibleWorld(fx.fromX, fx.fromY, 0, cm)) return;
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
    var i, k, s = cam.S, cm = cullMargin();
    for (i = 0; i < G.shops.length; i++) {
      var sh = G.shops[i];
      if (!sh.broken) continue;
      if (!visibleWorld(sh.x + 1, sh.y + 1, 0, cm)) continue;
      var nk = (typeof QUALITY !== "undefined") ? QUALITY.flag("smoke") : 7;
      for (k = 0; k < nk; k++) {
        var ph = (t * 0.22 + k / nk) % 1;
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
      badge(ctx, _px, _py - 4, UNITTYPES.tag(_G, o.squad), sqCol(o.squad), o.squad === sel);
    }
    if (G.vehicles) for (i = 0; i < G.vehicles.length; i++) {
      var v = G.vehicles[i];
      P(v.x, v.y, 1.55);
      badge(ctx, _px, _py - 4, UNITTYPES.tag(_G, v.squad), sqCol(v.squad), v.squad === sel);
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
    var rr = visibleRowRange(), d;
    if (diags) for (d = rr.d0; d <= rr.d1; d++) if (drow(d)) fillSet(ctx, d);
    ctx.restore();
  }
  function drawAgents(ctx, G) {
    beginFrame(ctx, G);
    var t = Date.now() / 1000, i, cm = cullMargin();
    if (G && G.agents) for (i = 0; i < G.agents.length; i++) if (G.agents[i].active && visibleWorld(G.agents[i].x, G.agents[i].y, 0, cm)) drawAgent(ctx, G.agents[i], t);
    ctx.restore();
  }

  function drawPolice(ctx, G) {
    beginFrame(ctx, G);
    var t = Date.now() / 1000, i, cm = cullMargin();
    if (G.barriers) for (i = 0; i < G.barriers.length; i++) if (visibleWorld(G.barriers[i].x + 0.5, G.barriers[i].y + 0.5, 0, cm)) drawBarrier(ctx, G.barriers[i]);
    if (G.vehicles) for (i = 0; i < G.vehicles.length; i++) if (visibleWorld(G.vehicles[i].x, G.vehicles[i].y, 0, cm)) drawVehicle(ctx, G.vehicles[i], t);
    if (G.officers) for (i = 0; i < G.officers.length; i++) if (visibleWorld(G.officers[i].x, G.officers[i].y, 0, cm)) drawOfficer(ctx, G.officers[i], t);
    if (G.detainees) for (i = 0; i < G.detainees.length; i++) if (visibleWorld(G.detainees[i].x, G.detainees[i].y, 0, cm)) drawDetainee(ctx, G.detainees[i]);
    ctx.restore();
  }

  /* graphics quality flags, read once per frame */
  var Q_BOB = true, Q_PLACARDS = true, Q_GHOSTS = true;
  function drawHiddenOutlines(ctx, G) {
    if (typeof Art !== "undefined" && Art.getView && Art.getView() === "top") return;
    if (typeof lowMode !== "undefined" && lowMode) return;
    if (typeof P !== "function" || typeof hAt !== "function") return;
    var camS = (cam && cam.S) || 1;
    var RAD = 0.28 * TS * camS;               /* officer marker radius (screen px) */
    var VW = 0.9 * TS * camS, VH = 0.45 * TS * camS, VR = Math.min(VW, VH) * 0.32;
    var DIA = 0.25 * TS * camS;               /* revealed-rioter diamond half-size */
    var MARG = 60, PIE2 = Math.PI * 2;
    var DARK = "rgba(10,12,16,0.92)", RED = "#e0392b";
    var i, o, a, px, py, bx, by, y0, y1, h, col, list;

    function hiddenAt(px, py) {                /* 6 tile lookups max */
      bx = Math.floor(px);
      y0 = Math.floor(py) + 1;
      y1 = y0 + 5;
      for (by = y0; by <= y1; by++) {
        h = hAt(bx, by);
        if (h > 0 && h * ZU > (by - py) * TS) return true;
      }
      return false;
    }
    function rr(x, y, w, hh, r) {              /* rounded rect path, centred */
      var hw = w / 2, yh = hh / 2;
      ctx.beginPath();
      ctx.moveTo(x - hw + r, y - yh);
      ctx.lineTo(x + hw - r, y - yh);
      ctx.quadraticCurveTo(x + hw, y - yh, x + hw, y - yh + r);
      ctx.lineTo(x + hw, y + yh - r);
      ctx.quadraticCurveTo(x + hw, y + yh, x + hw - r, y + yh);
      ctx.lineTo(x - hw + r, y + yh);
      ctx.quadraticCurveTo(x - hw, y + yh, x - hw, y + yh - r);
      ctx.lineTo(x - hw, y - yh + r);
      ctx.quadraticCurveTo(x - hw, y - yh, x - hw + r, y - yh);
      ctx.closePath();
    }

    setScreen(ctx);
    ctx.globalAlpha = 0.9;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    /* officers: hollow circle + tiny dot in squad colour */
    list = G.officers || [];
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (!o) continue;
      P(o.x, o.y, 0);
      px = _px; py = _py;
      if (px < -MARG || px > LW + MARG || py < -MARG || py > LH + MARG) continue;
      if (!hiddenAt(o.x, o.y)) continue;
      col = sqCol(o.squad);
      ctx.beginPath();
      ctx.arc(px, py, RAD, 0, PIE2);
      ctx.lineWidth = 4; ctx.strokeStyle = DARK; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, RAD * 0.34, 0, PIE2);
      ctx.fillStyle = col;
      ctx.fill();
    }

    /* vehicles: hollow rounded rectangle in squad colour */
    list = G.vehicles || [];
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (!o) continue;
      P(o.x, o.y, 0);
      px = _px; py = _py;
      if (px < -MARG || px > LW + MARG || py < -MARG || py > LH + MARG) continue;
      if (!hiddenAt(o.x, o.y)) continue;
      col = sqCol(o.squad);
      rr(px, py, VW, VH, VR);
      ctx.lineWidth = 4; ctx.strokeStyle = DARK; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
    }

    /* revealed rioters: small red diamond */
    list = G.agents || [];
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || a.role !== "rioter" || !(a.revealedUntil > G.time)) continue;
      P(a.x, a.y, 0);
      px = _px; py = _py;
      if (px < -MARG || px > LW + MARG || py < -MARG || py > LH + MARG) continue;
      if (!hiddenAt(a.x, a.y)) continue;
      ctx.beginPath();
      ctx.moveTo(px, py - DIA);
      ctx.lineTo(px + DIA, py);
      ctx.lineTo(px, py + DIA);
      ctx.lineTo(px - DIA, py);
      ctx.closePath();
      ctx.lineWidth = 4; ctx.strokeStyle = DARK; ctx.stroke();
      ctx.fillStyle = RED; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = RED; ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function draw(ctx, G) {
    var nowT = Date.now() / 1000, fdt = lastDrawT ? Math.min(0.1, nowT - lastDrawT) : 0.016;
    lastDrawT = nowT;
    smoothK = 1 - Math.exp(-fdt * 9);
    if (typeof QUALITY !== "undefined") {
      Q_BOB = QUALITY.flag("agentBob"); Q_PLACARDS = QUALITY.flag("placards"); Q_GHOSTS = QUALITY.flag("ghosts");
    }
    beginFrame(ctx, G);
    var t = Date.now() / 1000, d, i, b;
    var det = detail();
    if (det === "far") {
      drawFarScene(ctx, G, t);
    } else {
      var gr = ctx.createLinearGradient(0, 0, 0, LH);
      gr.addColorStop(0, "#eef1f5"); gr.addColorStop(1, "#dde3ea");
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, LW, LH);
      var cached = typeof document !== "undefined";
      var ov = cached && typeof OVERVIEW !== "undefined" && OVERVIEW.use(G);
      if (ov) {
        OVERVIEW.draw(ctx, G);
        OVERVIEW.peopleDots(ctx, G);
      } else {
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
        if (lodDots && lodN) drawLodPeople(ctx);
        var lmRows = null;
        if (typeof LANDMARKS !== "undefined" && typeof LANDMARKS_ART !== "undefined") {
          var lml = LANDMARKS.list(G);
          for (i = 0; i < lml.length; i++) {
            var lmr = Math.max(0, Math.min(ND - 1, lml[i].lm.y + lml[i].lm.h - 1));
            if (!lmRows) lmRows = {};
            (lmRows[lmr] = lmRows[lmr] || []).push(lml[i]);
          }
        }
        var rr = visibleRowRange();
        for (d = 0; d < ND; d++) {
          if (d >= rr.d0 && d <= rr.d1) {
            b = buckets[d];
            if (b) for (i = 0; i < b.length; i++) drawObj(ctx, b[i], t);
          }
          if (cached) {
            if ((d & 1) === 0 && SC.strips[d >> 1]) {
              if (d + 1 >= rr.d0 && d <= rr.d1) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                blit(ctx, SC.strips[d >> 1]);
                setScreen(ctx);
              }
            }
          } else if (diags && d >= rr.d0 && d <= rr.d1 && drow(d)) fillSet(ctx, d);
          if (d >= rr.d0 && d <= rr.d1) {
            if (shopTiles && (drow(d), shopTiles[d])) drawShopDecor(ctx, shopTiles[d], G, t);
            if (lmRows && lmRows[d]) LANDMARKS_ART.draw(ctx, G, lmRows[d]);
          }
        }
        if (ND >= rr.d0 && ND <= rr.d1) {
          b = buckets[ND];
          if (b) for (i = 0; i < b.length; i++) drawObj(ctx, b[i], t);
        }
      }
    }
    drawWater(ctx, G, t);
    if (typeof ATMO !== "undefined") ATMO.draw(ctx, G);
    else drawSmoke(ctx, G, t);
    if (typeof FX !== "undefined") FX.draw(ctx, G);
    if (typeof BAR !== "undefined") BAR.draw(ctx, G);
    if (typeof MEDIA !== "undefined") MEDIA.draw(ctx, G);
    if (typeof TACT !== "undefined") TACT.draw(ctx, G);
    if (typeof UNITS !== "undefined") UNITS.draw(ctx, G);
    if (typeof LIAISON !== "undefined") LIAISON.draw(ctx, G);
    if (typeof TRANSPORT !== "undefined") TRANSPORT.draw(ctx, G);
    if (typeof METERS !== "undefined") METERS.draw(ctx, G);
    if (typeof REINFORCE !== "undefined") REINFORCE.draw(ctx, G);
    if (typeof HOSPITAL !== "undefined") HOSPITAL.draw(ctx, G);
    if (typeof LINES !== "undefined") LINES.draw(ctx, G);
    if (typeof DISPERSE !== "undefined") DISPERSE.draw(ctx, G);
    if (typeof MARCHES !== "undefined") MARCHES.draw(ctx, G);
    if (typeof GAS !== "undefined") GAS.draw(ctx, G);
    if (typeof NIGHT !== "undefined") NIGHT.draw(ctx, G);
    if (typeof ATMO !== "undefined") ATMO.drawNight(ctx, G);
    if (typeof ORDERS !== "undefined") ORDERS.draw(ctx, G, typeof UI !== "undefined" ? UI.selected : -1, typeof UI !== "undefined" && UI.screen === "planning");
    if (Q_GHOSTS && det !== "far") {
      ctx.globalAlpha = 0.28;
      for (i = 0; i < ghosts.length; i++) drawObj(ctx, ghosts[i], t);
      ctx.globalAlpha = 1;
    }
    drawTags(ctx, G);
    ctx.restore();
    if (det !== "far") drawHiddenOutlines(ctx, G);
  }
  return {
    heightAt: function (x, y) { return heights ? hAt(x, y) : 0; },   /* building height (view3d.js) */
    invalidate: invalidate,
    drawPerson: drawPerson,
    init: init,
    drawTerrain: drawTerrain,
    drawAgents: drawAgents,
    drawPolice: drawPolice,
    draw: draw,
    detail: detail,
    project: project,
    screenToTile: screenToTile,
    groundBegin: groundBegin,
    groundEnd: groundEnd,
    panBy: panScreen,
    centerOn: centerOn,
    isLow: function () { return lowMode; },
    toggleLow: toggleLow,
    groundStats: function () { return { chunks: chunkCount, want: chunkWant.length, CW: CW, CHH: CHH, CHMAX: CHMAX, GT: GT, pumping: pumping, tick: chunkTick }; },
    ground: function () { return groundCv ? { cv: miniCv, GT: MS } : null; },
    /* draw ground tiles [x0,x0+w) x [y0,y0+h) into the screen rect (dx,dy,dw,dh) (squad cam inset) */
    groundDraw: function (ctx, x0, y0, w, h, dx, dy, dw, dh) {
      if (!groundCv) return false;
      var s = dw / w;
      ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
      blitGround(ctx, x0, y0, x0 + w, y0 + h, dx - x0 * s, dy - y0 * s, s, true);
      ctx.restore();
      return true;
    },   /* cached street layer (GT px per tile) for insets */
    camera: cam,
    setView: setView,
    getView: getView,
    toggleView: toggleView
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Art;
}
