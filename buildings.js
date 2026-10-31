// buildings.js - textures, rooftop details and soft shadows for Police vs Protestors
// ES5, classic script. Patterns are cached once per style.
var BUILDINGS = (function () {
  "use strict";

  var cache = {};

  // deterministic hash -> 0..1
  function hash(a, b) {
    var n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return ((n >>> 0) % 100000) / 100000;
  }

  function rnd(seed) {
    var s = seed;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s >>> 8) / 8388608;
    };
  }

  function mk(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function pat(ctx, canvas) {
    var p = ctx.createPattern(canvas, "repeat");
    if (p && p.setTransform && typeof DOMMatrix !== "undefined") {
      var s = 32 / 128; // pattern canvas is 128 px per tile
      p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
    }
    return p;
  }

  // ---------- roof canvases ----------
  function gridRoofA() {
    var c = mk(128, 128), x = c.getContext("2d"), r = rnd(11), i, y;
    x.fillStyle = "#3d4147"; x.fillRect(0, 0, 128, 128);
    // faint seams every 0.5 tile (64 px)
    x.strokeStyle = "rgba(0,0,0,0.18)"; x.lineWidth = 1;
    for (i = 0; i <= 2; i++) {
      x.beginPath(); x.moveTo(i * 64 + 0.5, 0); x.lineTo(i * 64 + 0.5, 128); x.stroke();
      x.beginPath(); x.moveTo(0, i * 64 + 0.5); x.lineTo(128, i * 64 + 0.5); x.stroke();
    }
    // random small stains
    for (i = 0; i < 26; i++) {
      y = r();
      x.fillStyle = "rgba(90,96,102," + (0.05 + 0.10 * r()).toFixed(3) + ")";
      var sx = r() * 128, sy = r() * 128, rr = 1.5 + r() * 4;
      x.beginPath(); x.arc(sx, sy, rr, 0, 6.2832); x.fill();
    }
    // slight noise
    for (i = 0; i < 300; i++) {
      x.fillStyle = "rgba(255,255,255,0.03)";
      x.fillRect((r() * 128) | 0, (r() * 128) | 0, 1, 1);
    }
    return c;
  }

  function gridRoofB() {
    var c = mk(128, 128), x = c.getContext("2d"), r = rnd(23), i;
    x.fillStyle = "#b9b3a8"; x.fillRect(0, 0, 128, 128);
    // fine speckle of 3 greys
    var cols = ["#a9a396", "#c6c0b4", "#8f8a80"];
    for (i = 0; i < 1600; i++) {
      x.fillStyle = cols[(r() * 3) | 0];
      x.fillRect((r() * 128) | 0, (r() * 128) | 0, 1, 1);
    }
    // lighter parapet border line along pattern edges, every 2 tiles (256 world px)
    // pattern is 1 tile; draw border on the tile edge so repeats line up every 2 tiles
    // use two variants by drawing both top-left edges lightly -> simple: border every tile edge
    x.strokeStyle = "rgba(230,226,218,0.55)"; x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, 127, 127);
    return c;
  }

  function gridRoofC() {
    var c = mk(128, 128), x = c.getContext("2d"), r = rnd(37), i, row, col;
    x.fillStyle = "#8f4a34"; x.fillRect(0, 0, 128, 128);
    var rowH = 0.12 * 128; // ~15.36 px
    var rows = Math.ceil(128 / rowH) + 1;
    for (row = 0; row < rows; row++) {
      var y0 = row * rowH;
      var off = (row % 2) * (rowH * 0.8);
      for (col = -1; col < 9; col++) {
        var tileW = rowH * 0.9;
        var x0 = col * tileW + off;
        var sh = 0.85 + r() * 0.3;
        var rr = (143 * sh) | 0, gg = (74 * sh) | 0, bb = (52 * sh) | 0;
        x.fillStyle = "rgb(" + rr + "," + gg + "," + bb + ")";
        x.fillRect(x0, y0, tileW - 0.6, rowH - 0.6);
        // darker bottom edge, lighter top
        x.fillStyle = "rgba(0,0,0,0.22)";
        x.fillRect(x0, y0 + rowH - 1.6, tileW - 0.6, 1.2);
        x.fillStyle = "rgba(255,255,255,0.10)";
        x.fillRect(x0, y0, tileW - 0.6, 1);
      }
    }
    return c;
  }

  function parisZinc(darker) {
    var c = mk(128, 128), x = c.getContext("2d"), i;
    x.fillStyle = darker ? "#7d8794" : "#8b96a3"; x.fillRect(0, 0, 128, 128);
    // standing seams every 0.2 tile = 25.6 px
    for (i = 0; i <= 5; i++) {
      var px = i * 25.6;
      x.fillStyle = darker ? "rgba(200,208,218,0.45)" : "rgba(214,222,232,0.5)";
      x.fillRect(px, 0, 1, 128);
      x.fillStyle = "rgba(0,0,0,0.20)";
      x.fillRect(px + 1, 0, 1, 128);
    }
    // faint horizontal weathering
    x.fillStyle = "rgba(0,0,0,0.05)";
    for (i = 0; i < 4; i++) x.fillRect(0, (i * 32 + 8) | 0, 128, 1);
    return c;
  }

  function parisSlate() {
    var c = mk(128, 128), x = c.getContext("2d"), r = rnd(51), i, row, col;
    x.fillStyle = "#4d535c"; x.fillRect(0, 0, 128, 128);
    var rowH = 16, tileW = 16;
    for (row = 0; row < 9; row++) {
      var y0 = row * rowH;
      var off = (row % 2) * (tileW / 2);
      for (col = -1; col < 10; col++) {
        var x0 = col * tileW + off;
        var sh = 0.85 + r() * 0.3;
        x.fillStyle = "rgb(" + ((77 * sh) | 0) + "," + ((83 * sh) | 0) + "," + ((92 * sh) | 0) + ")";
        x.fillRect(x0 + 0.5, y0 + 0.5, tileW - 1, rowH - 1);
        x.fillStyle = "rgba(0,0,0,0.25)";
        x.fillRect(x0 + 0.5, y0 + rowH - 1.5, tileW - 1, 1);
      }
    }
    return c;
  }

  // ---------- wall canvases (tile 128 wide, height units -> we tile vertically) ----------
  // walls repeat vertically: 1 tile = 128 px, but height unit = 18 world units.
  // Use a canvas 128 x 128 representing 1 tile wide x (128/18) height units.
  function gridWall() {
    var c = mk(128, 128), x = c.getContext("2d"), r = rnd(71), i;
    x.fillStyle = "#c3bfb8"; x.fillRect(0, 0, 128, 128);
    // subtle noise
    for (i = 0; i < 900; i++) {
      x.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
      x.fillRect((r() * 128) | 0, (r() * 128) | 0, 1, 1);
    }
    // floor lines every 0.45 height units = 0.45*18 = 8.1 world units -> px: 8.1/32*128 = 32.4
    var fl = 32.4;
    x.fillStyle = "rgba(0,0,0,0.10)";
    for (i = 0; i < 4; i++) x.fillRect(0, Math.round(i * fl), 128, 1);
    // vertical panel joints
    x.fillStyle = "rgba(0,0,0,0.07)";
    for (i = 1; i < 4; i++) x.fillRect(i * 32, 0, 1, 128);
    return c;
  }

  function parisWall() {
    var c = mk(128, 128), x = c.getContext("2d"), r = rnd(83), i, row, col;
    x.fillStyle = "#e3d5b8"; x.fillRect(0, 0, 128, 128);
    // ashlar courses: block 0.5 tile wide (64 px) x 0.25 height (0.25*18=4.5 wu -> 18 px)
    var bh = 18, bw = 64;
    x.strokeStyle = "rgba(0,0,0,0.12)"; x.lineWidth = 1;
    for (row = 0; row < 8; row++) {
      var y0 = row * bh;
      var off = (row % 2) * (bw / 2);
      for (col = -1; col < 3; col++) {
        var x0 = col * bw + off;
        var sh = 0.97 + r() * 0.06;
        x.fillStyle = "rgb(" + ((227 * sh) | 0) + "," + ((213 * sh) | 0) + "," + ((184 * sh) | 0) + ")";
        x.fillRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
        x.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
      }
    }
    // balcony band every floor: floor = 0.45 height = 8.1 wu -> 32.4 px
    x.fillStyle = "rgba(59,63,70,0.15)";
    for (i = 0; i < 4; i++) x.fillRect(0, Math.round(i * 32.4), 128, 3);
    return c;
  }

  // ---------- window glass ----------
  function windowGlass() {
    var c = mk(128, 128), x = c.getContext("2d"), i;
    x.fillStyle = "#2b3a4a"; x.fillRect(0, 0, 128, 128);
    // diagonal reflection streaks
    x.save();
    x.translate(64, 64);
    x.rotate(-0.6);
    x.fillStyle = "rgba(170,200,225,0.22)";
    x.fillRect(-90, -14, 180, 10);
    x.fillStyle = "rgba(190,215,235,0.14)";
    x.fillRect(-90, 2, 180, 6);
    x.restore();
    // gradient sky reflection
    var g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(150,180,210,0.30)");
    g.addColorStop(0.5, "rgba(80,110,140,0.05)");
    g.addColorStop(1, "rgba(20,30,40,0.15)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    // 1px light frame around pattern edge
    x.strokeStyle = "rgba(210,225,240,0.55)"; x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, 127, 127);
    return c;
  }

  // ---------- shop front ----------
  function shopWall() {
    var c = mk(128, 128), x = c.getContext("2d"), i;
    x.fillStyle = "#1f2a33"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "rgba(120,150,175,0.18)"; x.fillRect(0, 0, 128, 40);
    // vertical mullions every 0.25 tile = 32 px
    for (i = 0; i <= 4; i++) {
      x.fillStyle = "#5a6470";
      x.fillRect(i * 32 - 1, 0, 2, 128);
      x.fillStyle = "rgba(0,0,0,0.35)";
      x.fillRect(i * 32 + 1, 0, 1, 128);
    }
    // horizontal transom
    x.fillStyle = "#4a5460"; x.fillRect(0, 46, 128, 3);
    return c;
  }

  function shopTop() {
    var c = mk(128, 128), x = c.getContext("2d");
    x.fillStyle = "#b6bac0"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "rgba(0,0,0,0.08)";
    x.fillRect(0, 0, 128, 1); x.fillRect(0, 127, 128, 1);
    x.fillRect(0, 0, 1, 128); x.fillRect(127, 0, 1, 128);
    return c;
  }

  // ---------- rooftop box textures ----------
  function roofTop() {
    var c = mk(128, 128), x = c.getContext("2d"), i;
    x.fillStyle = "#c7ccd2"; x.fillRect(0, 0, 128, 128);
    // grille texture: horizontal slats
    for (i = 0; i < 16; i++) {
      x.fillStyle = i % 2 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)";
      x.fillRect(0, i * 8, 128, 3);
    }
    x.strokeStyle = "rgba(0,0,0,0.18)"; x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, 127, 127);
    return c;
  }

  function roofSide() {
    var c = mk(128, 128), x = c.getContext("2d"), i;
    x.fillStyle = "#8e959e"; x.fillRect(0, 0, 128, 128);
    for (i = 0; i < 6; i++) {
      x.fillStyle = "rgba(0,0,0,0.07)";
      x.fillRect(0, i * 22, 128, 1);
    }
    x.fillStyle = "rgba(255,255,255,0.08)"; x.fillRect(0, 0, 128, 2);
    return c;
  }

  // ---------- build & cache fills ----------
  function fills(ctx, style) {
    var key = style === "paris" ? "paris" : "grid";
    if (cache[key]) return cache[key];

    var out = {};
    if (key === "grid") {
      out.wall = pat(ctx, gridWall());
      out.window = pat(ctx, windowGlass());
      out.tops = [pat(ctx, gridRoofA()), pat(ctx, gridRoofB()), pat(ctx, gridRoofC())];
    } else {
      out.wall = pat(ctx, parisWall());
      out.window = pat(ctx, windowGlass());
      out.tops = [pat(ctx, parisZinc(false)), pat(ctx, parisZinc(true)), pat(ctx, parisSlate())];
    }
    out.shopWall = pat(ctx, shopWall());
    out.shopTop = pat(ctx, shopTop());
    out.roofSide = pat(ctx, roofSide());
    out.roofTop = pat(ctx, roofTop());
    cache[key] = out;
    return out;
  }

  // ---------- rooftop details ----------
  // add(x0, y0, x1, y1, z0, z1) in tile coordinates and heights
  function details(x, y, h, r, style, add) {
    var isParis = style === "paris";
    if (isParis) {
      // chimney stack 0.15 x 0.4, 0.35 tall, p=0.25
      if (r < 0.25) {
        var cx = x + 0.15 + (r * 0.5 % 0.6);
        var cy = y + 0.2;
        add(cx, cy, cx + 0.15, cy + 0.4, h, h + 0.35);
        return;
      }
      // dormer box along south edge, 0.25 x 0.2, 0.18 tall, p=0.2
      if (r < 0.45) {
        var dx = x + 0.3 + (r * 0.4 % 0.4);
        add(dx, y + 0.78, dx + 0.25, y + 0.98, h, h + 0.18);
        return;
      }
      return;
    }
    // grid: probability 0.18 of ONE detail
    if (r >= 0.18) return;
    var t = (r * 1000) % 1; // secondary deterministic value
    var px, py;
    if (t < 0.28) {
      // single AC unit 0.35 x 0.25, 0.12 tall
      px = x + 0.1 + t; py = y + 0.1 + t * 0.8;
      add(px, py, px + 0.35, py + 0.25, h, h + 0.12);
    } else if (t < 0.5) {
      // pair of AC units
      px = x + 0.12; py = y + 0.15;
      add(px, py, px + 0.3, py + 0.22, h, h + 0.12);
      add(px + 0.4, py + 0.15, px + 0.7, py + 0.37, h, h + 0.12);
    } else if (t < 0.75) {
      // skylight flat 0.4 x 0.4, 0.04 tall
      px = x + 0.3; py = y + 0.3;
      add(px, py, px + 0.4, py + 0.4, h, h + 0.04);
    } else {
      // water tank 0.3 x 0.3, 0.3 tall
      px = x + 0.35; py = y + 0.3;
      add(px, py, px + 0.3, py + 0.3, h, h + 0.3);
    }
  }

  // ---------- soft shadows on the ground ----------
  function shadows(g, W, H, GT, hAt) {
    // draw at 1/4 of the ground resolution, then scale up (that is the blur)
    var sc = 0.25;
    var sw = Math.max(1, Math.ceil(W * GT * sc));
    var sh = Math.max(1, Math.ceil(H * GT * sc));
    var off = mk(sw, sh);
    var o = off.getContext("2d");
    o.fillStyle = "#000";
    var x, y, h, hx, hy;
    // iterate all tiles
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        h = hAt(x, y);
        if (!h) continue;
        hx = h * 0.55; hy = h * 0.35;
        // sweep the footprint from the building to its offset (a solid shadow volume)
        for (var st = 0.25; st <= 1.001; st += 0.25) {
          o.fillRect((x + hx * st) * GT * sc, (y + hy * st) * GT * sc, GT * sc, GT * sc);
        }
      }
    }
    // composite blurred shadow onto ground once
    g.save();
    g.globalAlpha = 0.28;
    g.globalCompositeOperation = "multiply";
    // cheap blur: draw downscaled canvas scaled up (its own pixel blur from scaling)
    g.imageSmoothingEnabled = true;
    if (g.imageSmoothingQuality) g.imageSmoothingQuality = "low";
    g.drawImage(off, 0, 0, sw, sh, 0, 0, W * GT, H * GT);
    g.restore();
    // fallback if multiply unsupported
    var op = g.globalCompositeOperation;
    if (op === "source-over") {
      // already source-over; nothing special
    }
  }

  return { fills: fills, details: details, shadows: shadows };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BUILDINGS;
