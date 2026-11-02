var LANDMARKS_ART = (function () {
  function A() { return typeof Art !== "undefined" ? Art : window.Art; }
  function TS() { return CONFIG.tileSize; }
  function S() { return A().camera.S; }

  function proj(x, y, z) {
    return A().project(x, y, z || 0);
  }
  function poly(ctx, pts, fill, stroke) {
    var i;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function quad(ctx, x0, y0, x1, y1, h, wallCol, roofCol) {
    var bl = proj(x0, y1, 0), br = proj(x1, y1, 0);
    var tr = proj(x1, y1, h), tl = proj(x0, y1, h);
    poly(ctx, [bl, br, tr, tl], wallCol);
    var a = proj(x0, y0, h), b = proj(x1, y0, h);
    var c = proj(x1, y1, h), d = proj(x0, y1, h);
    if (roofCol) poly(ctx, [a, b, c, d], roofCol);
    else poly(ctx, [a, b, c, d], wallCol);
    // side walls
    var sa = proj(x0, y0, 0), sb = proj(x0, y1, 0);
    poly(ctx, [sa, bl, tl, a], shade(wallCol, -0.18));
    var ra = proj(x1, y0, 0), rb = proj(x1, y1, 0);
    poly(ctx, [ra, br, tr, b], shade(wallCol, -0.1));
  }
  function shade(hex, amt) {
    if (hex.charAt(0) !== "#") return hex;
    var r = parseInt(hex.substr(1, 2), 16),
      g = parseInt(hex.substr(3, 2), 16),
      b = parseInt(hex.substr(5, 2), 16);
    function f(v) {
      var n = Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt));
      return Math.max(0, Math.min(255, n)).toString(16);
    }
    function p(v) { v = f(v); return v.length < 2 ? "0" + v : v; }
    return "#" + p(r) + p(g) + p(b);
  }
  function circle(ctx, x, y, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function nowS() { return Date.now() / 1000; }

  function onScreen(lm) {
    var s = S(), ts = TS();
    var p0 = proj(lm.x, lm.y, 0), p1 = proj(lm.x + lm.w, lm.y + lm.h, 0);
    var p2 = proj(lm.x, lm.y, 14);
    var minx = Math.min(p0.x, p1.x, p2.x) - 200, maxx = Math.max(p0.x, p1.x, p2.x) + 200;
    var miny = Math.min(p0.y, p1.y, p2.y) - 200, maxy = Math.max(p0.y, p1.y) + 200;
    return maxx > 0 && minx < MAP.width * ts && maxy > 0 && miny < MAP.height * ts;
  }

  function drawGraffiti(ctx, lm, stage, t) {
    if (stage < 1) return;
    var s = S();
    var n = 3 + (Math.floor((lm.x * 7 + lm.y * 13)) % 4);
    var cols = ["#ff2e88", "#39ff88", "#111111", "#ffe14d"];
    var wallTop = proj(lm.x, lm.y + lm.h, 1.2), wallBot = proj(lm.x, lm.y + lm.h, 0);
    var wpx = Math.abs(proj(lm.x + lm.w, lm.y + lm.h, 0).x - wallBot.x);
    var hpx = Math.abs(wallTop.y - wallBot.y);
    var i;
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.lineCap = "round";
    for (i = 0; i < n; i++) {
      var fx = lm.x * 31 + i * 17;
      var cx = wallBot.x + wpx * (0.15 + 0.7 * ((Math.sin(fx) * 0.5 + 0.5)));
      var cy = wallBot.y - hpx * (0.2 + 0.6 * ((Math.cos(fx * 1.7) * 0.5 + 0.5)));
      ctx.strokeStyle = cols[i % cols.length];
      ctx.beginPath();
      var px = cx, py = cy, j;
      ctx.moveTo(px, py);
      for (j = 0; j < 3; j++) {
        px += (Math.sin(fx + j * 2.1) * 6 + 3) * s;
        py += (Math.cos(fx + j * 1.3) * 5) * s;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  function drawBroken(ctx, lm, stage) {
    if (stage < 2) return;
    var s = S();
    var wallTop = proj(lm.x, lm.y + lm.h, 1.2), wallBot = proj(lm.x, lm.y + lm.h, 0);
    var wpx = Math.abs(proj(lm.x + lm.w, lm.y + lm.h, 0).x - wallBot.x);
    var hpx = Math.abs(wallTop.y - wallBot.y);
    var i;
    ctx.fillStyle = "#1b1b1b";
    for (i = 0; i < 4; i++) {
      var fx = Math.sin(lm.x * 11 + i * 3.3) * 0.5 + 0.5;
      var fy = Math.cos(lm.y * 9 + i * 2.2) * 0.5 + 0.5;
      var w = (4 + fx * 8) * s, h = (4 + fy * 8) * s;
      ctx.fillRect(wallBot.x + wpx * fx - w / 2, wallBot.y - hpx * (0.25 + fy * 0.5) - h / 2, w, h);
    }
    // debris
    var bl = proj(lm.x, lm.y + lm.h + 0.4, 0), br = proj(lm.x + lm.w, lm.y + lm.h + 0.6, 0);
    ctx.fillStyle = "#5a5348";
    for (i = 0; i < 10; i++) {
      var dx = (Math.sin(i * 7.7 + lm.x) * 0.5 + 0.5);
      var dy = (Math.cos(i * 3.3 + lm.y) * 0.5 + 0.5);
      var x = bl.x + (br.x - bl.x) * dx;
      var y = bl.y + (br.y - bl.y) * dy + 4 * s;
      ctx.fillRect(x, y, (1 + dx * 2) * s, (1 + dy * 2) * s);
    }
  }
  function drawFlames(ctx, lm, stage, t, roofZ, x0, y0, x1, y1) {
    if (stage < 3) return;
    var s = S();
    var i, n = 2 + (Math.floor(lm.x + lm.y) % 3);
    for (i = 0; i < n; i++) {
      var f = (i + 0.5) / n;
      var fx = x0 + (x1 - x0) * f;
      var fy = y1;
      var p = proj(fx, fy, roofZ);
      var sz = (10 + Math.sin(t * 6 + i * 2.1) * 6) * s;
      var wob = Math.sin(t * 8 + i) * 3 * s;
      ctx.fillStyle = i % 2 ? "#ff7a1a" : "#ffcc33";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(p.x - sz * 0.35 + wob, p.y);
      ctx.quadraticCurveTo(p.x - sz * 0.5 + wob, p.y - sz * 0.6, p.x + wob, p.y - sz);
      ctx.quadraticCurveTo(p.x + sz * 0.5 + wob, p.y - sz * 0.6, p.x + sz * 0.35 + wob, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function dome(ctx, cx, cy, r) {
    var i;
    ctx.fillStyle = "#7a9a90";
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#9dbcae";
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, cy - r * 0.2, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // lantern
    ctx.fillStyle = "#c8d8cf";
    ctx.fillRect(cx - r * 0.12, cy - r - r * 0.35, r * 0.24, r * 0.35);
    ctx.fillStyle = "#e6dfcf";
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.18, cy - r - r * 0.35);
    ctx.lineTo(cx + r * 0.18, cy - r - r * 0.35);
    ctx.lineTo(cx, cy - r - r * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  function drawGov(ctx, lm, s, t) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var h = 4.5;
    quad(ctx, x0, y0, x1, y1, h, "#e6dfcf", "#dcd4c2");
    // columns
    var n = 8, i;
    var wpx = Math.abs(proj(x1, y1, 0).x - proj(x0, y1, 0).x);
    var b = proj(x0, y1, 0), hh = Math.abs(proj(x0, y1, h).y - b.y);
    var cw = Math.max(2, (wpx / n) * 0.55 * s / s);
    ctx.fillStyle = "#f5f1e6";
    for (i = 0; i < n; i++) {
      var fx = (i + 0.5) / n;
      var px = b.x + wpx * fx - cw / 2;
      var py = b.y - hh * 0.85;
      ctx.fillRect(px, py, cw, hh * 0.85);
    }
    // pediment
    var mb = proj((x0 + x1) / 2, y1, h);
    var pl = proj(x0 + (x1 - x0) * 0.25, y1, h), pr = proj(x0 + (x1 - x0) * 0.75, y1, h);
    var apex = proj((x0 + x1) / 2, y1, h + 1.2);
    poly(ctx, [pl, pr, apex], "#f0ebdd", "#cfc7b5");
    // dome
    var c = proj((x0 + x1) / 2, (y0 + y1) / 2, 7);
    var r = Math.min(lm.w, lm.h) * 0.4 * TS() * s;
    dome(ctx, c.x, c.y, r);
    // flag
    var fb = proj((x0 + x1) / 2, (y0 + y1) / 2, 7.5);
    var ftop = proj((x0 + x1) / 2, (y0 + y1) / 2, 11);
    ctx.strokeStyle = "#8a8470";
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(fb.x, fb.y);
    ctx.lineTo(ftop.x, ftop.y);
    ctx.stroke();
    var fw = 18 * s, fh = 10 * s;
    var wave = Math.sin(t * 3) * 4 * s;
    var rows = ["#d33", "#fff", "#33a"];
    for (i = 0; i < 3; i++) {
      ctx.fillStyle = rows[i];
      ctx.beginPath();
      ctx.moveTo(ftop.x, ftop.y + (i * fh) / 3);
      ctx.quadraticCurveTo(ftop.x + fw * 0.5 + wave, ftop.y + (i * fh) / 3, ftop.x + fw + wave, ftop.y + (i * fh) / 3);
      ctx.lineTo(ftop.x + fw + wave, ftop.y + ((i + 1) * fh) / 3);
      ctx.quadraticCurveTo(ftop.x + fw * 0.5 + wave, ftop.y + ((i + 1) * fh) / 3, ftop.x, ftop.y + ((i + 1) * fh) / 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawChurch(ctx, lm, s, t) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var h = 4;
    var longX = lm.w >= lm.h;
    quad(ctx, x0, y0, x1, y1, h, "#cdb79a", null);
    // pitched roof
    var ridgeZ = h + 2;
    var a, b, c, d, r1, r2;
    if (longX) {
      a = proj(x0, y0, h); b = proj(x1, y0, h); c = proj(x1, y1, h); d = proj(x0, y1, h);
      r1 = proj(x0, (y0 + y1) / 2, ridgeZ); r2 = proj(x1, (y0 + y1) / 2, ridgeZ);
      poly(ctx, [a, b, r2, r1], "#4a545e");
      poly(ctx, [d, c, r2, r1], "#55606b");
    } else {
      a = proj(x0, y0, h); b = proj(x1, y0, h); c = proj(x1, y1, h); d = proj(x0, y1, h);
      r1 = proj((x0 + x1) / 2, y0, ridgeZ); r2 = proj((x0 + x1) / 2, y1, ridgeZ);
      poly(ctx, [a, d, r2, r1], "#4a545e");
      poly(ctx, [b, c, r2, r1], "#55606b");
    }
    // tower
    var tx0 = longX ? x0 + lm.w * 0.05 : x0, tx1 = longX ? x0 + lm.w * 0.28 : x1;
    var ty0 = longX ? y0 : y0 + lm.h * 0.05, ty1 = longX ? y1 : y0 + lm.h * 0.28;
    quad(ctx, tx0, ty0, tx1, ty1, 9, "#d4bfa0", "#c9b394");
    // spire
    var sc = proj((tx0 + tx1) / 2, (ty0 + ty1) / 2, 9);
    var st = proj((tx0 + tx1) / 2, (ty0 + ty1) / 2, 13);
    var sw = (tx1 - tx0) * 0.5 * TS() * s;
    poly(ctx, [{ x: sc.x - sw, y: sc.y }, { x: sc.x + sw, y: sc.y }, { x: st.x, y: st.y }], "#55606b");
    // cross
    var cs = 4 * s;
    ctx.strokeStyle = "#e8c64a";
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(st.x, st.y - cs);
    ctx.lineTo(st.x, st.y + cs);
    ctx.moveTo(st.x - cs * 0.6, st.y - cs * 0.3);
    ctx.lineTo(st.x + cs * 0.6, st.y - cs * 0.3);
    ctx.stroke();
    // rose window
    var wc = proj((tx0 + tx1) / 2, ty1, 6);
    circle(ctx, wc.x, wc.y, 4 * s, "#8a4a4a", "#55606b");
    circle(ctx, wc.x, wc.y, 1.6 * s, "#d4b060");
  }

  function drawTheatre(ctx, lm, s, t) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var h = 4;
    quad(ctx, x0, y0, x1, y1, h, "#efe6d2", "#e3d8c0");
    // cornice
    var a = proj(x0, y1, h - 0.3), b = proj(x1, y1, h - 0.3);
    var c = proj(x1, y1, h), d = proj(x0, y1, h);
    poly(ctx, [a, b, c, d], "#c9b98c");
    // marquee band
    var e = proj(x0, y1, 2.8), f = proj(x1, y1, 2.8), g = proj(x1, y1, 2.1), i2 = proj(x0, y1, 2.1);
    poly(ctx, [e, f, g, i2], "#b02a2a");
    // bulbs
    var n = 10, i;
    var bpx = proj(x0, y1, 2.45), bpx2 = proj(x1, y1, 2.45);
    for (i = 0; i < n; i++) {
      var fx = (i + 0.5) / n;
      var bx = bpx.x + (bpx2.x - bpx.x) * fx;
      var by = bpx.y + (bpx2.y - bpx.y) * fx;
      var on = Math.sin(t * 4 + i * 0.9) > 0;
      circle(ctx, bx, by, 1.2 * s, on ? "#fff2a8" : "#7a6a3a");
    }
  }

  function drawStatue(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var pw = 1.6;
    quad(ctx, cx - pw / 2, cy - pw / 2, cx + pw / 2, cy + pw / 2, 1.6, "#8a8a86", "#9a9a96");
    if (destroyed) return;
    var base = proj(cx, cy, 1.6);
    var top = proj(cx, cy, 1.6 + 2.2);
    var w = 5 * s;
    // body tapered
    poly(ctx, [{ x: base.x - w, y: base.y }, { x: base.x + w, y: base.y }, { x: top.x + w * 0.5, y: top.y + 6 * s }, { x: top.x - w * 0.5, y: top.y + 6 * s }], "#6f5a3a");
    // arm
    ctx.strokeStyle = "#6f5a3a";
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y + 8 * s);
    ctx.lineTo(top.x + 8 * s, top.y - 4 * s);
    ctx.stroke();
    ctx.strokeStyle = "#9a8458";
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(base.x - w * 0.6, base.y - 3 * s);
    ctx.lineTo(top.x - w * 0.2, top.y + 8 * s);
    ctx.stroke();
    // head
    circle(ctx, top.x, top.y, 3.2 * s, "#6f5a3a", "#9a8458");
  }

  function drawColumn(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var cw = 0.45;
    // shadow
    var a = proj(lm.x, lm.y, 0), b = proj(lm.x + lm.w, lm.y + lm.h, 0);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x + lm.w * 1.4 * TS() * s, b.y + lm.h * 0.5 * TS() * s);
    ctx.lineTo(a.x + lm.w * 1.4 * TS() * s, a.y + lm.h * 0.5 * TS() * s);
    ctx.closePath();
    ctx.fill();
    // plinth
    quad(ctx, cx - 0.9, cy - 0.9, cx + 0.9, cy + 0.9, 0.8, "#9a948a", "#a8a298");
    // column body
    var bl = proj(cx - cw / 2, cy + cw / 2, 0.8), br = proj(cx + cw / 2, cy + cw / 2, 0.8);
    var tl = proj(cx - cw / 2, cy + cw / 2, 14), tr = proj(cx + cw / 2, cy + cw / 2, 14);
    poly(ctx, [bl, br, tr, tl], "#c9c4b8");
    ctx.strokeStyle = "#a8a298";
    ctx.lineWidth = 1 * s;
    var i;
    for (i = 1; i < 4; i++) {
      var fx = i / 4;
      var x = bl.x + (br.x - bl.x) * fx, y = bl.y + (br.y - bl.y) * fx;
      var xt = tl.x + (tr.x - tl.x) * fx, yt = tl.y + (tr.y - tl.y) * fx;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(xt, yt);
      ctx.stroke();
    }
    if (!destroyed) {
      var top = proj(cx, cy, 14);
      circle(ctx, top.x, top.y, 3 * s, "#d4af37", "#b8962a");
    }
  }

  function drawLabel(ctx, lm, s, attackers) {
    var lh = lmTopZ(lm);
    var p = proj(lm.x + lm.w / 2, lm.y + lm.h / 2, lh);
    var txt = lm.name || "";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    var y = p.y - 4;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(txt, p.x, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, p.x, y);
    if (attackers > 0) {
      var t = nowS();
      var pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.fillStyle = "rgba(255,40,40," + (0.6 + pulse * 0.4) + ")";
      ctx.font = "bold 14px sans-serif";
      ctx.strokeText("!", p.x, y - 14 * s);
      ctx.fillText("!", p.x, y - 14 * s);
    }
  }

  function drawRing(ctx, lm, t) {
    var s = S();
    var c = proj(lm.x + lm.w / 2, lm.y + lm.h / 2, 0);
    var r = ((lm.w + lm.h) / 2) * TS() * s * 0.9;
    var pulse = 0.5 + 0.5 * Math.sin(t * 5);
    ctx.strokeStyle = "rgba(255,30,30," + (0.35 + pulse * 0.5) + ")";
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + pulse * 4 * s, 0, Math.PI * 2);
    ctx.stroke();
  }

  function normName(n) {
    var s = (n || "").toLowerCase();
    if (s.normalize) {
      try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    }
    var m = {
      "\u00e0":"a","\u00e1":"a","\u00e2":"a","\u00e3":"a","\u00e4":"a","\u00e5":"a","\u00e6":"ae",
      "\u00e7":"c","\u00e8":"e","\u00e9":"e","\u00ea":"e","\u00eb":"e",
      "\u00ec":"i","\u00ed":"i","\u00ee":"i","\u00ef":"i",
      "\u00f1":"n","\u00f2":"o","\u00f3":"o","\u00f4":"o","\u00f5":"o","\u00f6":"o","\u00f8":"o",
      "\u00f9":"u","\u00fa":"u","\u00fb":"u","\u00fc":"u","\u00fd":"y","\u00ff":"y",
      "\u0153":"oe","\u00df":"ss"
    };
    s = s.replace(/[^\u0000-\u007f]/g, function (ch) { return m[ch] || ch; });
    s = s.replace(/['\u2019`]/g, " ");
    s = s.replace(/[^a-z0-9]+/g, " ");
    return s.replace(/^\s+|\s+$/g, "");
  }

  function hashName(n) {
    var s = normName(n), h = 0, i;
    for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h & 0x7fffffff;   /* keep it positive: callers use h >> n as an index */
  }

  function nameHas(n, a) {
    var i;
    for (i = 0; i < a.length; i++) if (n.indexOf(a[i]) >= 0) return true;
    return false;
  }

  function lmTopZ(lm) {
    var n = normName(lm.name), tr = lm.type;
    if (n.indexOf("notre dame") >= 0) return 15;
    if (n.indexOf("elizabeth tower") >= 0) return 19;
    if (n.indexOf("july column") >= 0) return 15;
    if (n.indexOf("trajan") >= 0) return 15;
    if (n.indexOf("saint jacques") >= 0 || n.indexOf("st jacques") >= 0) return 18;
    if (n.indexOf("red city hall") >= 0) return 15;
    if (n.indexOf("saint mary") >= 0 || n.indexOf("st mary") >= 0 || n.indexOf("marien") >= 0) return 17;
    if (n.indexOf("saint patrick") >= 0 || n.indexOf("st patrick") >= 0) return 18;
    if (n.indexOf("hotel de ville") >= 0) return 13;
    if (n.indexOf("palazzo senatorio") >= 0) return 13;
    if (n.indexOf("vittoriano") >= 0 || n.indexOf("altare della patria") >= 0) return 9;
    if (nameHas(n, ["fountain", "fuente", "fontaine", "neptune"])) return 6;
    if (nameHas(n, ["turtle tower", "thap rua", "hoan kiem", "ngoc son"])) return 9;
    if (nameHas(n, ["nha hat", "uy ban"]) || (tr === "theatre" && n.indexOf("opera") >= 0) || n.indexOf("city hall") >= 0) return 8;
    if (nameHas(n, ["duke of york", "nelson"])) return 16;
    if (n.indexOf("tower") >= 0 || n.indexOf("tour") >= 0 || n.indexOf("torre") >= 0) return 18;
    if (tr === "church") return 15;
    if (tr === "gov") return 8;
    if (tr === "theatre") return 5;
    if (tr === "statue") return 4.5;
    if (tr === "column") return 15;
    return 8;
  }

  function drawNotreDame(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var wall = "#d9d4c4", roof = "#7f8589", stone = "#b8b2a0";
    var longX = lm.w >= lm.h, i, sc, st, sw, rc, p1, p2, fx, bx, by;
    if (longX) {
      quad(ctx, x0 + 2.4, y0 + 1, x1, y1 - 1, 5, wall, roof);
      quad(ctx, x0, y0 + 1, x0 + 2.4, y0 + 4, 10, wall, "#8a8f8a");
      quad(ctx, x0, y1 - 4, x0 + 2.4, y1 - 1, 10, wall, "#8a8f8a");
      sc = proj(cx, cy, 5); st = proj(cx, cy, 15); sw = 7 * s;
      poly(ctx, [{ x: sc.x - sw, y: sc.y }, { x: sc.x + sw, y: sc.y }, { x: st.x, y: st.y }], "#6f757a");
      rc = proj(x0 + 2.5, cy, 6);
      circle(ctx, rc.x, rc.y, 4.5 * s, "#8a4a4a", "#6f757a");
      circle(ctx, rc.x, rc.y, 1.8 * s, "#d4b060");
      ctx.strokeStyle = stone; ctx.lineWidth = 1 * s; ctx.beginPath();
      for (i = 0; i < 5; i++) {
        fx = (i + 0.5) / 5; bx = x0 + 2.4 + (x1 - x0 - 2.4) * fx;
        p1 = proj(bx, y0, 5); p2 = proj(bx, y0 + 0.7, 2.5);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        p1 = proj(bx, y1, 5); p2 = proj(bx, y1 - 0.7, 2.5);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
    } else {
      quad(ctx, x0 + 1, y0 + 2.4, x1 - 1, y1, 5, wall, roof);
      quad(ctx, x0 + 1, y0, x0 + 4, y0 + 2.4, 10, wall, "#8a8f8a");
      quad(ctx, x1 - 4, y0, x1 - 1, y0 + 2.4, 10, wall, "#8a8f8a");
      sc = proj(cx, cy, 5); st = proj(cx, cy, 15); sw = 7 * s;
      poly(ctx, [{ x: sc.x - sw, y: sc.y }, { x: sc.x + sw, y: sc.y }, { x: st.x, y: st.y }], "#6f757a");
      rc = proj(cx, y0 + 2.5, 6);
      circle(ctx, rc.x, rc.y, 4.5 * s, "#8a4a4a", "#6f757a");
      circle(ctx, rc.x, rc.y, 1.8 * s, "#d4b060");
      ctx.strokeStyle = stone; ctx.lineWidth = 1 * s; ctx.beginPath();
      for (i = 0; i < 5; i++) {
        fx = (i + 0.5) / 5; by = y0 + 2.4 + (y1 - y0 - 2.4) * fx;
        p1 = proj(x0, by, 5); p2 = proj(x0 + 0.7, by, 2.5);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        p1 = proj(x1, by, 5); p2 = proj(x1 - 0.7, by, 2.5);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
    }
  }

  function drawElizabeth(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var tx0 = cx - 1.6, tx1 = cx + 1.6, ty0 = cy - 1.6, ty1 = cy + 1.6;
    var c1, c2, top, apex, sw;
    quad(ctx, x0, y0, x1, y1, 3.5, "#c9b99a", "#8a8270");
    quad(ctx, tx0, ty0, tx1, ty1, 15, "#d8c9a8", "#6f7f5a");
    c1 = proj(tx0 + 0.3, ty1, 12);
    circle(ctx, c1.x, c1.y, 4 * s, "#f7f1d0", "#6b5a3a");
    ctx.strokeStyle = "#4a3a2a"; ctx.lineWidth = 1.3 * s; ctx.beginPath();
    ctx.moveTo(c1.x, c1.y); ctx.lineTo(c1.x + 2.2 * s, c1.y - 1.2 * s);
    ctx.moveTo(c1.x, c1.y); ctx.lineTo(c1.x, c1.y - 2.8 * s); ctx.stroke();
    c2 = proj(tx1, ty0 + 0.3, 12);
    circle(ctx, c2.x, c2.y, 3.5 * s, "#f7f1d0", "#6b5a3a");
    ctx.beginPath();
    ctx.moveTo(c2.x, c2.y); ctx.lineTo(c2.x + 1.8 * s, c2.y - 0.8 * s);
    ctx.moveTo(c2.x, c2.y); ctx.lineTo(c2.x, c2.y - 2.4 * s); ctx.stroke();
    top = proj(cx, cy, 15); apex = proj(cx, cy, 19); sw = 8 * s;
    poly(ctx, [{ x: top.x - sw, y: top.y }, { x: top.x + sw, y: top.y }, { x: apex.x, y: apex.y }], "#5f7a4a");
    circle(ctx, apex.x, apex.y, 1.5 * s, "#d4af37");
  }

  function drawJulyColumn(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var p = proj(cx, cy, 0), r = Math.max(7, Math.min(lm.w, lm.h) * 0.45 * TS() * s);
    var cw = 0.5, bl, br, tl, tr, f;
    circle(ctx, p.x, p.y, r, "#4f5a52", "#2b332e");
    quad(ctx, cx - 0.9, cy - 0.9, cx + 0.9, cy + 0.9, 1, "#8a8a80", "#a8a298");
    bl = proj(cx - cw / 2, cy + cw / 2, 1); br = proj(cx + cw / 2, cy + cw / 2, 1);
    tl = proj(cx - cw / 2, cy + cw / 2, 14); tr = proj(cx + cw / 2, cy + cw / 2, 14);
    poly(ctx, [bl, br, tr, tl], "#2f6f4f");
    if (!destroyed) {
      f = proj(cx, cy, 14.2);
      circle(ctx, f.x, f.y, 2.5 * s, "#d4af37", "#a88422");
      poly(ctx, [{ x: f.x - 1, y: f.y }, { x: f.x - 11 * s, y: f.y - 6 * s }, { x: f.x - 4 * s, y: f.y + 2 * s }], "#e2c24a");
      poly(ctx, [{ x: f.x + 1, y: f.y }, { x: f.x + 11 * s, y: f.y - 6 * s }, { x: f.x + 4 * s, y: f.y + 2 * s }], "#e2c24a");
    }
  }

  function drawTrajan(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var cw = 0.55, bl, br, tl, tr, i, z, pL, pR, top;
    quad(ctx, cx - 0.95, cy - 0.95, cx + 0.95, cy + 0.95, 0.9, "#9a948a", "#a8a298");
    bl = proj(cx - cw / 2, cy + cw / 2, 0.9); br = proj(cx + cw / 2, cy + cw / 2, 0.9);
    tl = proj(cx - cw / 2, cy + cw / 2, 13); tr = proj(cx + cw / 2, cy + cw / 2, 13);
    poly(ctx, [bl, br, tr, tl], "#d8d0bc");
    ctx.strokeStyle = "#a89f8c"; ctx.lineWidth = 1.2 * s; ctx.beginPath();
    for (i = 0; i < 7; i++) {
      z = 1.6 + i * 1.55;
      pL = proj(cx - cw / 2, cy + cw / 2, z);
      pR = proj(cx + cw / 2, cy + cw / 2, z + 0.55);
      ctx.moveTo(pL.x, pL.y); ctx.lineTo(pR.x, pR.y);
    }
    ctx.stroke();
    if (!destroyed) {
      top = proj(cx, cy, 13.2);
      circle(ctx, top.x, top.y, 2.8 * s, "#c9c0a8", "#9a948a");
      ctx.strokeStyle = "#9a948a"; ctx.lineWidth = 1.3 * s; ctx.beginPath();
      ctx.moveTo(top.x, top.y + 2 * s); ctx.lineTo(top.x, top.y - 6 * s); ctx.stroke();
    }
  }

  function drawSaintJacques(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var top, apex, p1, p2, p3;
    quad(ctx, cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5, 14, "#cfc6b4", "#6b6f66");
    top = proj(cx, cy, 14); apex = proj(cx, cy, 18);
    poly(ctx, [{ x: top.x - 9 * s, y: top.y }, { x: top.x + 9 * s, y: top.y }, { x: apex.x, y: apex.y }], "#59605c");
    p1 = proj(cx - 1.1, cy + 1.1, 14); p2 = proj(cx - 1.1, cy + 1.1, 16.5); p3 = proj(cx - 0.5, cy + 1.1, 14);
    poly(ctx, [p1, p3, p2], "#6b6f66");
    p1 = proj(cx + 1.1, cy + 1.1, 14); p2 = proj(cx + 1.1, cy + 1.1, 16.5); p3 = proj(cx + 0.5, cy + 1.1, 14);
    poly(ctx, [p1, p3, p2], "#6b6f66");
    circle(ctx, apex.x, apex.y - 2 * s, 1.2 * s, "#d4af37");
  }

  function drawRedCityHall(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var b, top, wpx, hpx, i, c;
    quad(ctx, x0, y0, x1, y1, 5, "#9c3f32", "#6d2e28");
    b = proj(x0, y1, 0); top = proj(x0, y1, 5);
    wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
    ctx.fillStyle = "#e8d2b0";
    for (i = 0; i < 7; i++) ctx.fillRect(b.x + wpx * (i + 0.5) / 7 - 1.5 * s, b.y - hpx * 0.6, 3 * s, 4 * s);
    quad(ctx, cx - 1.4, cy - 1.4, cx + 1.4, cy + 1.4, 14, "#9c3f32", "#6d2e28");
    c = proj(cx, cy + 1.4, 11.5);
    circle(ctx, c.x, c.y, 3.5 * s, "#f2e2c0", "#5a2a22");
    ctx.strokeStyle = "#5a2a22"; ctx.lineWidth = 1.2 * s; ctx.beginPath();
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - 2.4 * s);
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 1.8 * s, c.y); ctx.stroke();
  }

  function drawBrickChurch(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var top, apex, tx0 = cx - 1.4, tx1 = cx + 1.4, ty0 = y1 - 2.8, ty1 = y1 - 0.2;
    quad(ctx, x0 + 1, y0 + 1, x1 - 1, y1 - 1, 4, "#8f4a3a", "#5b342b");
    quad(ctx, tx0, ty0, tx1, ty1, 9, "#8f4a3a", "#5b342b");
    top = proj(cx, (ty0 + ty1) / 2, 9); apex = proj(cx, (ty0 + ty1) / 2, 17);
    poly(ctx, [{ x: top.x - 8 * s, y: top.y }, { x: top.x + 8 * s, y: top.y }, { x: apex.x, y: apex.y }], "#3f7a62");
    circle(ctx, apex.x, apex.y - 1.5 * s, 1.2 * s, "#d4af37");
  }

  function drawSaintPatrick(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var longX = lm.w >= lm.h, top, apex, i, rc;
    if (longX) {
      quad(ctx, x0 + 2.2, y0 + 1, x1, y1 - 1, 5, "#e8e6dc", "#6b7a86");
      quad(ctx, x0, y0 + 1, x0 + 2.2, y0 + 4, 10, "#e8e6dc", "#6b7a86");
      quad(ctx, x0, y1 - 4, x0 + 2.2, y1 - 1, 10, "#e8e6dc", "#6b7a86");
      top = proj(x0 + 1.1, y0 + 2.5, 10); apex = proj(x0 + 1.1, y0 + 2.5, 18);
      poly(ctx, [{ x: top.x - 7 * s, y: top.y }, { x: top.x + 7 * s, y: top.y }, { x: apex.x, y: apex.y }], "#6b7a86");
      top = proj(x0 + 1.1, y1 - 2.5, 10); apex = proj(x0 + 1.1, y1 - 2.5, 18);
      poly(ctx, [{ x: top.x - 7 * s, y: top.y }, { x: top.x + 7 * s, y: top.y }, { x: apex.x, y: apex.y }], "#6b7a86");
      rc = proj(x0 + 2.3, cy, 6); circle(ctx, rc.x, rc.y, 3.5 * s, "#8a4a4a", "#6b7a86");
    } else {
      quad(ctx, x0 + 1, y0 + 2.2, x1 - 1, y1, 5, "#e8e6dc", "#6b7a86");
      quad(ctx, x0 + 1, y0, x0 + 4, y0 + 2.2, 10, "#e8e6dc", "#6b7a86");
      quad(ctx, x1 - 4, y0, x1 - 1, y0 + 2.2, 10, "#e8e6dc", "#6b7a86");
      top = proj(x0 + 2.5, y0 + 1.1, 10); apex = proj(x0 + 2.5, y0 + 1.1, 18);
      poly(ctx, [{ x: top.x - 7 * s, y: top.y }, { x: top.x + 7 * s, y: top.y }, { x: apex.x, y: apex.y }], "#6b7a86");
      top = proj(x1 - 2.5, y0 + 1.1, 10); apex = proj(x1 - 2.5, y0 + 1.1, 18);
      poly(ctx, [{ x: top.x - 7 * s, y: top.y }, { x: top.x + 7 * s, y: top.y }, { x: apex.x, y: apex.y }], "#6b7a86");
      rc = proj(cx, y0 + 2.3, 6); circle(ctx, rc.x, rc.y, 3.5 * s, "#8a4a4a", "#6b7a86");
    }
  }

  function drawHotelVille(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var b, top, wpx, hpx, i, r, c;
    quad(ctx, x0, y0, x1, y1, 5, "#e2d4b8", "#6b7f96");
    b = proj(x0, y1, 0); top = proj(x0, y1, 5);
    wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
    ctx.fillStyle = "#5a5f6a";
    for (i = 0; i < 8; i++) {
      ctx.fillRect(b.x + wpx * (i + 0.5) / 8 - 2 * s, b.y - hpx * 0.72, 4 * s, 5 * s);
      ctx.fillRect(b.x + wpx * (i + 0.5) / 8 - 2 * s, b.y - hpx * 0.36, 4 * s, 5 * s);
    }
    quad(ctx, cx - 1.4, cy - 1.4, cx + 1.4, cy + 1.4, 10, "#e2d4b8", "#4f5f74");
    top = proj(cx, cy, 10); 
    poly(ctx, [{ x: top.x - 8 * s, y: top.y }, { x: top.x + 8 * s, y: top.y }, { x: top.x, y: top.y - 3 * s }], "#4f5f74");
    c = proj(cx, cy + 1.4, 8);
    circle(ctx, c.x, c.y, 3 * s, "#f7f1d0", "#6b5a3a");
    ctx.strokeStyle = "#4a3a2a"; ctx.lineWidth = 1.1 * s; ctx.beginPath();
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - 2 * s); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 1.5 * s, c.y); ctx.stroke();
  }

  function drawPalazzoSenatorio(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var top, bell, i;
    quad(ctx, x0, y0, x1, y1, 5, "#c9b58f", "#8a6a4a");
    quad(ctx, cx - 1.4, cy - 1.4, cx + 1.4, cy + 1.4, 12, "#c9b58f", "#7a5a3a");
    top = proj(cx, cy + 1.4, 12);
    ctx.fillStyle = "#3a2f24";
    ctx.fillRect(top.x - 4 * s, top.y - 7 * s, 8 * s, 7 * s);
    circle(ctx, top.x, top.y - 9 * s, 3 * s, "#d4af37", "#7a5a3a");
  }

  function drawVittoriano(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var b, top, wpx, hpx, i, c;
    quad(ctx, x0, y0, x1, y1, 2, "#f0eee6", "#e8e8e0");
    b = proj(x0, y1, 0); top = proj(x0, y1, 6);
    wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
    ctx.fillStyle = "#f7f5ee";
    for (i = 0; i < 12; i++) ctx.fillRect(b.x + wpx * (i + 0.5) / 12 - 1.8 * s, b.y - hpx * 0.9, 3.6 * s, hpx * 0.9);
    poly(ctx, [proj(x0, y1, 6), proj(x1, y1, 6), proj(x1, y1, 6.8), proj(x0, y1, 6.8)], "#ffffff", "#d8d4c8");
    c = proj(cx, cy, 3);
    ctx.fillStyle = "#d8d4c8"; ctx.fillRect(c.x - 7 * s, c.y - 2 * s, 14 * s, 4 * s);
    circle(ctx, c.x, c.y - 5 * s, 3 * s, "#e8e2d2");
  }

  function drawFountain(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var p = proj(cx, cy, 0), r = Math.max(9, Math.min(lm.w, lm.h) * 0.45 * TS() * s);
    var i, base, top, w;
    circle(ctx, p.x, p.y, r, "#3f9ac0", "#8a8a86");
    ctx.strokeStyle = "rgba(220,245,255,0.75)"; ctx.lineWidth = 1.4 * s;
    for (i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.3 + 0.2 * i) + Math.sin(t * 2 + i) * 2 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    quad(ctx, cx - 0.7, cy - 0.7, cx + 0.7, cy + 0.7, 1.5, "#9a948a", "#a8a298");
    if (!destroyed) {
      base = proj(cx, cy, 1.5); top = proj(cx, cy, 4.5); w = 4 * s;
      poly(ctx, [{ x: base.x - w, y: base.y }, { x: base.x + w, y: base.y }, { x: top.x + w * 0.5, y: top.y + 5 * s }, { x: top.x - w * 0.5, y: top.y + 5 * s }], "#6f5a3a");
      circle(ctx, top.x, top.y, 2.8 * s, "#6f5a3a", "#9a8458");
      ctx.strokeStyle = "#6f5a3a"; ctx.lineWidth = 1.4 * s; ctx.beginPath();
      ctx.moveTo(top.x + 4 * s, top.y + 6 * s); ctx.lineTo(top.x + 12 * s, top.y - 5 * s); ctx.stroke();
    }
  }

  function drawVietnamesePagoda(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var i, bx0, by0, bx1, by1, z, a, b, c, d, m;
    quad(ctx, x0 + 1, y0 + 1, x1 - 1, y1 - 1, 2, "#b08a5a", "#a33a2a");
    for (i = 0; i < 3; i++) {
      bx0 = x0 + 1 + i * 0.7; bx1 = x1 - 1 - i * 0.7;
      by0 = y0 + 1 + i * 0.7; by1 = y1 - 1 - i * 0.7;
      z = 2 + i * 2;
      if (bx1 - bx0 > 0.8 && by1 - by0 > 0.8) {
        quad(ctx, bx0, by0, bx1, by1, 1.6, "#c9a06a", "#a33a2a");
        a = proj(bx0, by1, z + 1.6); b = proj(bx1, by1, z + 1.6);
        c = proj(bx1, by0, z + 1.6); d = proj(bx0, by0, z + 1.6);
        m = proj((bx0 + bx1) / 2, (by0 + by1) / 2, z + 2.8);
        poly(ctx, [a, b, m], "#a33a2a");
        poly(ctx, [b, c, m], "#8f2f22");
        poly(ctx, [c, d, m], "#b34430");
        poly(ctx, [d, a, m], "#8f2f22");
      }
    }
    m = proj(cx, cy, 8.2);
    circle(ctx, m.x, m.y, 1.3 * s, "#d4af37");
  }

  function drawColonialYellow(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var b, top, wpx, hpx, i, ax, ay, c;
    quad(ctx, x0, y0, x1, y1, 5, "#e8c86a", "#b05a4a");
    b = proj(x0, y1, 0); top = proj(x0, y1, 5);
    wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
    poly(ctx, [proj(x0, y1, 4.1), proj(x1, y1, 4.1), proj(x1, y1, 4.5), proj(x0, y1, 4.5)], "#f7f1e0");
    ctx.fillStyle = "#5a3a2a";
    for (i = 0; i < 4; i++) {
      ax = b.x + wpx * (i + 0.5) / 4; ay = b.y - hpx * 0.38;
      ctx.fillRect(ax - 4 * s, ay, 8 * s, hpx * 0.38);
      circle(ctx, ax, ay, 4 * s, "#5a3a2a");
    }
    quad(ctx, cx - 1.3, cy - 1.3, cx + 1.3, cy + 1.3, 8, "#e8c86a", "#b05a4a");
    c = proj(cx, cy + 1.3, 6.5);
    circle(ctx, c.x, c.y, 2.8 * s, "#f7f1d0", "#6b5a3a");
  }

  function drawNamedColumnStatue(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var cw = 0.55, bl, br, tl, tr, top, base, w;
    quad(ctx, cx - 0.95, cy - 0.95, cx + 0.95, cy + 0.95, 0.9, "#9a948a", "#a8a298");
    bl = proj(cx - cw / 2, cy + cw / 2, 0.9); br = proj(cx + cw / 2, cy + cw / 2, 0.9);
    tl = proj(cx - cw / 2, cy + cw / 2, 14); tr = proj(cx + cw / 2, cy + cw / 2, 14);
    poly(ctx, [bl, br, tr, tl], "#c9c4b8");
    if (!destroyed) {
      base = proj(cx, cy, 14); top = proj(cx, cy, 16); w = 4 * s;
      poly(ctx, [{ x: base.x - w, y: base.y }, { x: base.x + w, y: base.y }, { x: top.x + w * 0.5, y: top.y + 5 * s }, { x: top.x - w * 0.5, y: top.y + 5 * s }], "#3f6f5a");
      circle(ctx, top.x, top.y, 2.6 * s, "#3f6f5a", "#2f5a48");
    }
  }

  function drawTowerModel(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var tx0 = cx - 1.5, tx1 = cx + 1.5, ty0 = cy - 1.5, ty1 = cy + 1.5;
    var top, apex, b, top2, wpx, hpx, i;
    quad(ctx, x0, y0, x1, y1, 3, "#c9b99a", "#8a8270");
    quad(ctx, tx0, ty0, tx1, ty1, 14, "#c9b99a", "#6f7f5a");
    b = proj(tx0, ty1, 0); top2 = proj(tx0, ty1, 14);
    wpx = Math.abs(proj(tx1, ty1, 0).x - b.x); hpx = Math.abs(top2.y - b.y);
    ctx.fillStyle = "#5a5040";
    for (i = 0; i < 3; i++) ctx.fillRect(b.x + wpx * (i + 0.5) / 3 - 1.5 * s, b.y - hpx * 0.75, 3 * s, 6 * s);
    top = proj(cx, cy, 14); apex = proj(cx, cy, 18);
    poly(ctx, [{ x: top.x - 8 * s, y: top.y }, { x: top.x + 8 * s, y: top.y }, { x: apex.x, y: apex.y }], "#5f7a4a");
    circle(ctx, apex.x, apex.y, 1.2 * s, "#d4af37");
  }

  function drawGenericChurch(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var hh = hashName(lm.name), v = hh % 3;
    var stones = ["#d8c9a8", "#bfc0b8", "#9a5a4a"], stone = stones[(hh >> 3) % 3];
    var top, apex, tx0, tx1, ty0, ty1, i, rc;
    if (v === 0) {
      quad(ctx, x0, y0, x1, y1, 4, stone, "#4a545e");
      tx0 = cx - 1.3; tx1 = cx + 1.3; ty0 = y1 - 2.8; ty1 = y1 - 0.2;
      quad(ctx, tx0, ty0, tx1, ty1, 9, stone, "#4a545e");
      top = proj(cx, (ty0 + ty1) / 2, 9); apex = proj(cx, (ty0 + ty1) / 2, 15);
      poly(ctx, [{ x: top.x - 8 * s, y: top.y }, { x: top.x + 8 * s, y: top.y }, { x: apex.x, y: apex.y }], "#4a545e");
      ctx.strokeStyle = shade(stone, -0.2); ctx.lineWidth = 1 * s; ctx.beginPath();
      for (i = 0; i < 4; i++) {
        var fx = (i + 0.5) / 4, bx = x0 + (x1 - x0) * fx;
        var p1 = proj(bx, y0, 4), p2 = proj(bx, y0 + 0.6, 2);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
    } else if (v === 1) {
      quad(ctx, x0 + 1, y0 + 1, x1 - 1, y1 - 1, 4, stone, "#6b6f66");
      quad(ctx, x0 + 0.8, y0 + 0.8, x0 + 3.2, y0 + 3.2, 9, stone, "#6b6f66");
      rc = proj(x1 - 1, y1 - 1, 4); circle(ctx, rc.x, rc.y, 5 * s, shade(stone, -0.1), "#6b6f66");
    } else {
      quad(ctx, x0 + 1, y0 + 1, x1 - 1, y1 - 1, 4, stone, "#6b7a86");
      quad(ctx, x0 + 0.8, y1 - 3.2, x0 + 3.2, y1 - 0.8, 9, stone, "#6b7a86");
      quad(ctx, x1 - 3.2, y1 - 3.2, x1 - 0.8, y1 - 0.8, 9, stone, "#6b7a86");
      var c = proj(cx, cy, 6), r = Math.min(lm.w, lm.h) * 0.28 * TS() * s;
      dome(ctx, c.x, c.y, r);
    }
  }

  function drawGenericGov(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var hh = hashName(lm.name), v = hh % 3, i, b, top, wpx, hpx, c;
    if (v === 0) {
      quad(ctx, x0, y0, x1, y1, 4.5, "#e6dfcf", "#dcd4c2");
      b = proj(x0, y1, 0); top = proj(x0, y1, 4.5);
      wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
      ctx.fillStyle = "#f5f1e6";
      for (i = 0; i < 8; i++) ctx.fillRect(b.x + wpx * (i + 0.5) / 8 - 2 * s, b.y - hpx * 0.85, 4 * s, hpx * 0.85);
      poly(ctx, [proj(x0 + (x1 - x0) * 0.25, y1, 4.5), proj(x0 + (x1 - x0) * 0.75, y1, 4.5), proj(cx, y1, 5.7)], "#f0ebdd", "#cfc7b5");
      quad(ctx, x0, y0, x1, y0 + 1.2, 0.5, "#d8d0be", "#e6dfcf");
    } else if (v === 1) {
      quad(ctx, x0, y0, x1, y1, 5, "#d8c9a8", "#6b7f96");
      b = proj(x0, y1, 0); top = proj(x0, y1, 5);
      wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
      ctx.fillStyle = "#5a5f6a";
      for (i = 0; i < 7; i++) {
        ctx.fillRect(b.x + wpx * (i + 0.5) / 7 - 2 * s, b.y - hpx * 0.7, 4 * s, 5 * s);
        ctx.fillRect(b.x + wpx * (i + 0.5) / 7 - 2 * s, b.y - hpx * 0.35, 4 * s, 5 * s);
      }
    } else {
      quad(ctx, x0, y0, x1, y1, 6, "#6f8a9a", "#4f5f6a");
      b = proj(x0, y1, 0); top = proj(x0, y1, 6);
      wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
      ctx.fillStyle = "#a8c8d8";
      for (i = 0; i < 6; i++) ctx.fillRect(b.x + wpx * (i + 0.5) / 6 - 3 * s, b.y - hpx * 0.75, 6 * s, 8 * s);
      c = proj(cx, cy, 6);
      ctx.strokeStyle = "#8a8470"; ctx.lineWidth = 1.2 * s; ctx.beginPath();
      ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - 14 * s); ctx.stroke();
      ctx.fillStyle = "#d33"; ctx.fillRect(c.x, c.y - 14 * s, 9 * s, 5 * s);
    }
  }

  function drawGenericTheatre(ctx, lm, s, t, destroyed) {
    var x0 = lm.x, y0 = lm.y, x1 = lm.x + lm.w, y1 = lm.y + lm.h;
    var b, top, wpx, hpx, i, ax, ay;
    quad(ctx, x0, y0, x1, y1, 4, "#efe6d2", "#b05a4a");
    b = proj(x0, y1, 0); top = proj(x0, y1, 4);
    wpx = Math.abs(proj(x1, y1, 0).x - b.x); hpx = Math.abs(top.y - b.y);
    ctx.fillStyle = "#7a4a3a";
    for (i = 0; i < 5; i++) {
      ax = b.x + wpx * (i + 0.5) / 5; ay = b.y - hpx * 0.42;
      ctx.fillRect(ax - 3 * s, ay, 6 * s, hpx * 0.42);
      circle(ctx, ax, ay, 3 * s, "#7a4a3a");
    }
    ctx.fillStyle = "#c9b98c";
    for (i = 0; i < 5; i++) ctx.fillRect(b.x + wpx * (i + 0.5) / 5 - 2 * s, b.y - hpx * 1.05, 4 * s, 4 * s);
  }

  function drawGenericStatue(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var hh = hashName(lm.name), equestrian = (hh & 1) === 1;
    var base, top, w, i;
    quad(ctx, cx - 1, cy - 1, cx + 1, cy + 1, 0.6, "#8a8a86", "#9a9a96");
    quad(ctx, cx - 0.7, cy - 0.7, cx + 0.7, cy + 0.7, 1.5, "#9a9a96", "#a8a8a4");
    if (destroyed) return;
    base = proj(cx, cy, 1.5); top = proj(cx, cy, 3.7); w = 3.5 * s;
    if (!equestrian) {
      poly(ctx, [{ x: base.x - w, y: base.y }, { x: base.x + w, y: base.y }, { x: top.x + w * 0.5, y: top.y + 5 * s }, { x: top.x - w * 0.5, y: top.y + 5 * s }], "#3f6f5a");
      circle(ctx, top.x, top.y, 2.6 * s, "#3f6f5a", "#2f5a48");
      ctx.strokeStyle = "#3f6f5a"; ctx.lineWidth = 1.8 * s; ctx.beginPath();
      ctx.moveTo(top.x, top.y + 7 * s); ctx.lineTo(top.x + 7 * s, top.y - 3 * s); ctx.stroke();
    } else {
      ctx.strokeStyle = "#3f6f5a"; ctx.lineWidth = 2.2 * s; ctx.beginPath();
      ctx.moveTo(base.x - 8 * s, base.y - 2 * s); ctx.lineTo(base.x - 10 * s, base.y + 4 * s);
      ctx.moveTo(base.x + 8 * s, base.y - 2 * s); ctx.lineTo(base.x + 10 * s, base.y + 4 * s);
      ctx.moveTo(base.x - 5 * s, base.y - 2 * s); ctx.lineTo(base.x - 6 * s, base.y + 4 * s);
      ctx.moveTo(base.x + 5 * s, base.y - 2 * s); ctx.lineTo(base.x + 6 * s, base.y + 4 * s);
      ctx.stroke();
      poly(ctx, [{ x: base.x - 11 * s, y: base.y - 5 * s }, { x: base.x + 9 * s, y: base.y - 7 * s }, { x: base.x + 11 * s, y: base.y - 2 * s }, { x: base.x - 9 * s, y: base.y }], "#3f6f5a");
      circle(ctx, base.x + 10 * s, base.y - 7 * s, 2.6 * s, "#3f6f5a");
      circle(ctx, base.x, base.y - 10 * s, 2.4 * s, "#3f6f5a");
    }
  }

  function drawGenericColumn(ctx, lm, s, t, destroyed) {
    var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
    var v = hashName(lm.name) % 3;
    var cw = 0.45, bl, br, tl, tr, top, apex, c, i, z, pL, pR;
    if (v === 0) {
      quad(ctx, cx - 0.9, cy - 0.9, cx + 0.9, cy + 0.9, 0.8, "#9a948a", "#a8a298");
      bl = proj(cx - cw / 2, cy + cw / 2, 0.8); br = proj(cx + cw / 2, cy + cw / 2, 0.8);
      tl = proj(cx - cw / 2, cy + cw / 2, 14); tr = proj(cx + cw / 2, cy + cw / 2, 14);
      poly(ctx, [bl, br, tr, tl], "#c9c4b8");
      ctx.strokeStyle = "#a8a298"; ctx.lineWidth = 1 * s; ctx.beginPath();
      for (i = 1; i < 4; i++) {
        var fx = i / 4, x = bl.x + (br.x - bl.x) * fx, y = bl.y + (br.y - bl.y) * fx;
        var xt = tl.x + (tr.x - tl.x) * fx, yt = tl.y + (tr.y - tl.y) * fx;
        ctx.moveTo(x, y); ctx.lineTo(xt, yt);
      }
      ctx.stroke();
      if (!destroyed) { top = proj(cx, cy, 14); circle(ctx, top.x, top.y, 2.8 * s, "#d4af37", "#b8962a"); }
    } else if (v === 1) {
      quad(ctx, cx - 0.8, cy - 0.8, cx + 0.8, cy + 0.8, 0.8, "#9a948a", "#a8a298");
      bl = proj(cx - 0.45, cy + 0.45, 0.8); br = proj(cx + 0.45, cy + 0.45, 0.8);
      tl = proj(cx - 0.18, cy + 0.45, 12); tr = proj(cx + 0.18, cy + 0.45, 12);
      poly(ctx, [bl, br, tr, tl], "#d8d0bc");
      if (!destroyed) {
        apex = proj(cx, cy, 13.2);
        poly(ctx, [{ x: tl.x - 2 * s, y: tl.y }, { x: tr.x + 2 * s, y: tr.y }, { x: apex.x, y: apex.y }], "#d4af37");
      }
    } else {
      quad(ctx, cx - 1.1, cy - 1.1, cx + 1.1, cy + 1.1, 10, "#c9b99a", "#6f7f5a");
      c = proj(cx, cy + 1.1, 8);
      circle(ctx, c.x, c.y, 3 * s, "#f7f1d0", "#6b5a3a");
      ctx.strokeStyle = "#4a3a2a"; ctx.lineWidth = 1.1 * s; ctx.beginPath();
      ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - 2.1 * s);
      ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 1.6 * s, c.y); ctx.stroke();
    }
  }

  function drawSignature(ctx, lm, s, t, destroyed) {
    var n = normName(lm.name), tr = lm.type;
    if (n.indexOf("notre dame") >= 0) { drawNotreDame(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("elizabeth tower") >= 0) { drawElizabeth(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("july column") >= 0) { drawJulyColumn(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("trajan") >= 0) { drawTrajan(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("saint jacques") >= 0 || n.indexOf("st jacques") >= 0) { drawSaintJacques(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("red city hall") >= 0) { drawRedCityHall(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("saint mary") >= 0 || n.indexOf("st mary") >= 0 || n.indexOf("marien") >= 0) { drawBrickChurch(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("saint patrick") >= 0 || n.indexOf("st patrick") >= 0) { drawSaintPatrick(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("hotel de ville") >= 0) { drawHotelVille(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("palazzo senatorio") >= 0) { drawPalazzoSenatorio(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("vittoriano") >= 0 || n.indexOf("altare della patria") >= 0) { drawVittoriano(ctx, lm, s, t, destroyed); return true; }
    if (nameHas(n, ["fountain", "fuente", "fontaine", "neptune"])) { drawFountain(ctx, lm, s, t, destroyed); return true; }
    if (nameHas(n, ["turtle tower", "thap rua", "hoan kiem", "ngoc son"])) { drawVietnamesePagoda(ctx, lm, s, t, destroyed); return true; }
    if (nameHas(n, ["nha hat", "uy ban"]) || (tr === "theatre" && n.indexOf("opera") >= 0) || n.indexOf("city hall") >= 0) { drawColonialYellow(ctx, lm, s, t, destroyed); return true; }
    if (nameHas(n, ["duke of york", "nelson"])) { drawNamedColumnStatue(ctx, lm, s, t, destroyed); return true; }
    if (n.indexOf("tower") >= 0 || n.indexOf("tour") >= 0 || n.indexOf("torre") >= 0) { drawTowerModel(ctx, lm, s, t, destroyed); return true; }
    return false;
  }

  function draw(ctx, G, list) {
    if (!list || !list.length) return;
    var s = S();
    var t = nowS();
    var i;
    ctx.save();
    ctx.lineJoin = "round";
    for (i = 0; i < list.length; i++) {
      var e = list[i], lm = e.lm;
      if (!lm || !onScreen(lm)) continue;
      var stage = e.stage || 0;
      var destroyed = (e.hp <= 0) || stage >= 4;
      var attackers = e.attackers || 0;

      if (attackers > 0) drawRing(ctx, lm, t);

      var tr = lm.type;
      if (!drawSignature(ctx, lm, s, t, destroyed)) {
        if (tr === "church") drawGenericChurch(ctx, lm, s, t, destroyed);
        else if (tr === "gov") drawGenericGov(ctx, lm, s, t, destroyed);
        else if (tr === "theatre") drawGenericTheatre(ctx, lm, s, t, destroyed);
        else if (tr === "statue") drawGenericStatue(ctx, lm, s, t, destroyed);
        else if (tr === "column") drawGenericColumn(ctx, lm, s, t, destroyed);
      }

      drawGraffiti(ctx, lm, stage, t);
      drawBroken(ctx, lm, stage);

      if (stage >= 3 && !destroyed) {
        var rz = Math.max(2, lmTopZ(lm) - 3);
        drawFlames(ctx, lm, stage, t, rz, lm.x + lm.w * 0.15, lm.y, lm.x + lm.w * 0.85, lm.y + lm.h * 0.4);
      }

      if (destroyed) {
        var p = proj(lm.x, lm.y, 0), q = proj(lm.x + lm.w, lm.y + lm.h, 0);
        var p2 = proj(lm.x, lm.y, lmTopZ(lm));
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "rgba(30,25,20,1)";
        var minx = Math.min(p.x, q.x, p2.x), maxx = Math.max(p.x, q.x, p2.x);
        var miny = Math.min(p.y, q.y, p2.y), maxy = Math.max(p.y, q.y);
        ctx.fillRect(minx - 4, miny - 4, maxx - minx + 8, maxy - miny + 8);
        ctx.restore();
      }

      if (s >= 0.8) drawLabel(ctx, lm, s, attackers);
    }
    ctx.restore();
  }

  return { draw: draw };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LANDMARKS_ART;
