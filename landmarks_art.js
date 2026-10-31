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
    var p = proj(lm.x + lm.w / 2, lm.y, 14);
    var txt = lm.name || "";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    var y = p.y - 8 * s;
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
      if (tr === "gov") drawGov(ctx, lm, s, t);
      else if (tr === "church") drawChurch(ctx, lm, s, t);
      else if (tr === "theatre") drawTheatre(ctx, lm, s, t);
      else if (tr === "statue") drawStatue(ctx, lm, s, t, destroyed);
      else if (tr === "column") drawColumn(ctx, lm, s, t, destroyed);

      drawGraffiti(ctx, lm, stage, t);
      drawBroken(ctx, lm, stage);

      if (stage >= 3 && !destroyed) {
        var rz = tr === "church" ? 6 : tr === "gov" ? 4.5 : tr === "theatre" ? 4 : 2;
        drawFlames(ctx, lm, stage, t, rz, lm.x + lm.w * 0.15, lm.y, lm.x + lm.w * 0.85, lm.y + lm.h * 0.4);
      }

      if (destroyed) {
        var p = proj(lm.x, lm.y, 0), q = proj(lm.x + lm.w, lm.y + lm.h, 0);
        var p2 = proj(lm.x, lm.y, 14);
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
