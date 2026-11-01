var MINIMAP = (function () {
  var hidden = false;
  var dragging = false;
  var base = null;
  var baseRef = null;
  var px = 2; // offscreen px per tile
  var arrows = []; // clickable edge arrows from last draw
  var api = {};

  function zoomedIn() {
    return typeof Art !== "undefined" && Art && Art.camera &&
      typeof Art.camera.zoom === "number" && Art.camera.zoom >= 1.35;
  }

  function bigEnough() {
    return api.forced === true ||
      (typeof MAP !== "undefined" && MAP && MAP.width * MAP.height > 9000);
  }

  function available() { return bigEnough() && zoomedIn(); }

  function geom() {
    var ts = (typeof CONFIG !== "undefined" && CONFIG.tileSize) ? CONFIG.tileSize : 1;
    var w = MAP.width * ts;
    var h = MAP.height * ts;
    var r = 0.13 * h;
    return { LW: w, LH: h, r: r, x: 16 + r, y: h - 46 - r };
  }

  function showButton() {
    var g = geom();
    return { x: 30, y: g.LH - 60, r: 14 };
  }

  function closeButton(g) {
    var a = -Math.PI / 4;
    var rr = Math.max(8, Math.min(13, g.r * 0.09));
    return { x: g.x + Math.cos(a) * g.r, y: g.y + Math.sin(a) * g.r, r: rr };
  }

  function d2(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  function tileColor(ch) {
    if (ch === '#') return '#8c8a86';
    if (ch === 'S') return '#8c8a86';
    if (ch === '.') return '#cfd2d6';
    if (ch === 'a') return '#bfc2c6';
    if (ch === 'P') return '#e0d8c8';
    if (ch === 'G') return '#8fbf7a';
    if (ch === 'T') return '#8fbf7a';
    if (ch === 'W') return '#6fa6d6';
    return null;
  }

  function buildBase() {
    if (typeof MAP === "undefined" || !MAP || !MAP.rows) return;
    if (baseRef === MAP.rows && base) return;
    baseRef = MAP.rows;
    base = document.createElement('canvas');
    base.width = MAP.width * px;
    base.height = MAP.height * px;
    var c = base.getContext('2d');
    var y, x, ch, col, i, row, nx, ny, nch, s;
    for (y = 0; y < MAP.height; y++) {
      row = MAP.rows[y];
      for (x = 0; x < MAP.width; x++) {
        ch = row.charAt(x);
        col = tileColor(ch);
        if (col) {
          c.fillStyle = col;
          c.fillRect(x * px, y * px, px, px);
        }
      }
    }
    // darker edge on buildings next to roads
    c.fillStyle = '#6f6d69';
    for (y = 0; y < MAP.height; y++) {
      row = MAP.rows[y];
      for (x = 0; x < MAP.width; x++) {
        ch = row.charAt(x);
        if (ch !== '#' && ch !== 'S') continue;
        if (x > 0) {
          nch = row.charAt(x - 1);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px, y * px, 1, px); }
        }
        if (x < MAP.width - 1) {
          nch = row.charAt(x + 1);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px + px - 1, y * px, 1, px); }
        }
        if (y > 0) {
          nch = MAP.rows[y - 1].charAt(x);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px, y * px, px, 1); }
        }
        if (y < MAP.height - 1) {
          nch = MAP.rows[y + 1].charAt(x);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px, y * px + px - 1, px, 1); }
        }
      }
    }
    // landmarks
    c.fillStyle = '#f2d17b';
    var sites = MAP.sites || [];
    for (i = 0; i < sites.length; i++) {
      s = sites[i];
      c.fillRect(s.x * px, s.y * px, Math.max(2, s.w * px), Math.max(2, s.h * px));
    }
  }

  function viewInfo(g) {
    var tl = null, br = null, hw = 20, hh = 20, wr;
    if (typeof Art !== "undefined" && Art && typeof Art.screenToTile === "function") {
      tl = Art.screenToTile(0, 0);
      br = Art.screenToTile(g.LW, g.LH);
      hw = Math.abs(br.x - tl.x) / 2;
      hh = Math.abs(br.y - tl.y) / 2;
    }
    wr = 1.3 * Math.max(hw, hh);
    if (!isFinite(wr) || wr <= 0.001) wr = 10;
    return { s: g.r / wr, wr: wr, tl: tl, br: br };
  }

  function lootList(G) {
    var out = [], i, j, a, sh, found;
    if (!G || !G.agents) return out;
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (!a || !a.active || a.state !== "attackShop" || !a._targetShop) continue;
      sh = a._targetShop;
      if (typeof sh.x !== "number" || typeof sh.y !== "number") continue;
      found = false;
      for (j = 0; j < out.length; j++) { if (out[j] === sh) { found = true; break; } }
      if (!found) out.push(sh);
    }
    return out;
  }

  function squadList(G) {
    var out = [], map = {}, i, o, k, e;
    if (!G || !G.officers) return out;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
      k = (o.squad === undefined || o.squad === null) ? "?" : String(o.squad);
      e = map[k];
      if (!e) { e = { key: o.squad, x: 0, y: 0, n: 0 }; map[k] = e; out.push(e); }
      e.x += o.x; e.y += o.y; e.n++;
    }
    for (i = 0; i < out.length; i++) { out[i].x /= out[i].n; out[i].y /= out[i].n; }
    return out;
  }

  function drawArrow(ctx, cx, cy, R, ang, size, fill, label, labelColor, meters, fontPx) {
    var cos = Math.cos(ang), sin = Math.sin(ang);
    var ax = cx + cos * R, ay = cy + sin * R;
    var nx = -sin, ny = cos;
    var tipX = ax + cos * size * 1.4, tipY = ay + sin * size * 1.4;
    var baseX = ax - cos * size * 0.5, baseY = ay - sin * size * 0.5;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + nx * size * 0.85, baseY + ny * size * 0.85);
    ctx.lineTo(baseX - nx * size * 0.85, baseY - ny * size * 0.85);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0b1420";
    ctx.stroke();
    if (label) {
      ctx.fillStyle = labelColor;
      ctx.font = "bold " + Math.max(7, Math.round(size * 1.15)) + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, ax + cos * size * 0.5, ay + sin * size * 0.5);
    }
    var tx = cx + cos * (R + size * 2.6);
    var ty = cy + sin * (R + size * 2.6);
    ctx.font = "bold " + fontPx + "px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10,14,22,0.9)";
    ctx.strokeText(meters + "m", tx, ty);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(meters + "m", tx, ty);
    return { x: ax, y: ay };
  }

  function draw(ctx, G) {
    if (!available()) return;
    if (typeof Art === "undefined" || !Art.camera) return;
    buildBase();
    var g = geom();
    var cam = Art.camera;
    var vi = viewInfo(g);
    var s = vi.s;
    var cxp = g.x, cyp = g.y;
    var tNow = (G && typeof G.time === "number") ? G.time : Date.now() / 1000;
    var sel = (typeof UI !== "undefined" && UI) ? UI.selected : undefined;
    var i, dx, dy, d, ang, mt, pos, isSel, sz, lbl, sh, o, a2;
    var sqs = squadList(G);
    var loot = lootList(G);
    var blipR = Math.max(1.5, Math.min(3, g.r * 0.025));

    ctx.save();

    if (hidden) {
      var b = showButton();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(16,21,29,0.9)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#10151d";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("map", b.x, b.y - 1);
      ctx.font = "8px monospace";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText("J", b.x, b.y + b.r + 8);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cxp, cyp, g.r, 0, Math.PI * 2);
    ctx.clip();

    // ground
    ctx.fillStyle = "#222a33";
    ctx.fillRect(cxp - g.r, cyp - g.r, g.r * 2, g.r * 2);
    if (base) {
      ctx.drawImage(base, cxp - cam.cx * s, cyp - cam.cy * s, MAP.width * s, MAP.height * s);
    }

    // current view rectangle
    if (vi.tl && vi.br) {
      var vx = cxp + (vi.tl.x - cam.cx) * s;
      var vy = cyp + (vi.tl.y - cam.cy) * s;
      var vw = (vi.br.x - vi.tl.x) * s;
      var vh = (vi.br.y - vi.tl.y) * s;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.strokeRect(vx, vy, vw, vh);
    }

    // protest / rally areas
    if (typeof CONFIG !== "undefined" && CONFIG.rallyZones) {
      ctx.lineWidth = 1;
      for (i = 0; i < CONFIG.rallyZones.length; i++) {
        var rz = CONFIG.rallyZones[i];
        if (!rz || typeof rz.x !== "number" || typeof rz.y !== "number") continue;
        var zx = cxp + (rz.x - cam.cx) * s;
        var zy = cyp + (rz.y - cam.cy) * s;
        var zr = (typeof rz.r === "number" ? rz.r : 5) * s;
        ctx.fillStyle = "rgba(240,160,48,0.18)";
        ctx.strokeStyle = "rgba(240,160,48,0.45)";
        ctx.beginPath();
        ctx.arc(zx, zy, zr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // broken shops as dark red crosses
    if (G && G.shops) {
      var cr = Math.max(2, g.r * 0.02);
      ctx.lineWidth = Math.max(1, cr * 0.6);
      ctx.strokeStyle = "#7a1f1f";
      for (i = 0; i < G.shops.length; i++) {
        sh = G.shops[i];
        if (!sh || !sh.broken) continue;
        var bx = cxp + (sh.x - cam.cx) * s;
        var by = cyp + (sh.y - cam.cy) * s;
        ctx.beginPath();
        ctx.moveTo(bx - cr, by - cr);
        ctx.lineTo(bx + cr, by + cr);
        ctx.moveTo(bx + cr, by - cr);
        ctx.lineTo(bx - cr, by + cr);
        ctx.stroke();
      }
    }

    // shops being looted: flashing red dots
    if (loot.length) {
      var pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tNow * 7));
      ctx.fillStyle = "rgba(229,72,63," + pulse.toFixed(2) + ")";
      for (i = 0; i < loot.length; i++) {
        var lx = cxp + (loot[i].x - cam.cx) * s;
        var ly = cyp + (loot[i].y - cam.cy) * s;
        ctx.beginPath();
        ctx.arc(lx, ly, blipR * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // officers: small blue dots
    if (G && G.officers && G.officers.length) {
      ctx.fillStyle = "#3f7fe0";
      ctx.beginPath();
      for (i = 0; i < G.officers.length; i++) {
        o = G.officers[i];
        if (!o || typeof o.x !== "number") continue;
        var ox = cxp + (o.x - cam.cx) * s;
        var oy = cyp + (o.y - cam.cy) * s;
        ctx.moveTo(ox + blipR, oy);
        ctx.arc(ox, oy, blipR, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // vehicles: small blue squares
    if (G && G.vehicles && G.vehicles.length) {
      ctx.fillStyle = "#3f7fe0";
      var vs = blipR * 2;
      for (i = 0; i < G.vehicles.length; i++) {
        var v = G.vehicles[i];
        if (!v || typeof v.x !== "number") continue;
        ctx.fillRect(cxp + (v.x - cam.cx) * s - vs / 2, cyp + (v.y - cam.cy) * s - vs / 2, vs, vs);
      }
    }

    // revealed rioters: red dots
    if (G && G.agents && G.agents.length) {
      ctx.fillStyle = "#e5483f";
      for (i = 0; i < G.agents.length; i++) {
        a2 = G.agents[i];
        if (!a2 || !(a2.revealedUntil > tNow)) continue;
        var ax = cxp + (a2.x - cam.cx) * s;
        var ay = cyp + (a2.y - cam.cy) * s;
        ctx.beginPath();
        ctx.arc(ax, ay, blipR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // squad badges
    for (i = 0; i < sqs.length; i++) {
      var bx2 = cxp + (sqs[i].x - cam.cx) * s;
      var by2 = cyp + (sqs[i].y - cam.cy) * s;
      isSel = (sel !== undefined && sel !== null && String(sel) === String(sqs[i].key));
      var br2 = Math.max(5, Math.min(11, g.r * 0.06)) * (isSel ? 1.25 : 1);
      ctx.beginPath();
      ctx.arc(bx2, by2, br2, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "#f0c040" : "#2f6fd0";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0b1420";
      ctx.stroke();
      ctx.fillStyle = isSel ? "#1a1206" : "#ffffff";
      ctx.font = "bold " + Math.max(7, Math.round(br2 * 1.15)) + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lbl = (sqs[i].key === undefined || sqs[i].key === null) ? "?" : String(sqs[i].key);
      ctx.fillText(lbl, bx2, by2 + 0.5);
    }

    ctx.restore(); // clip

    // rim
    ctx.beginPath();
    ctx.arc(cxp, cyp, g.r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#10151d";
    ctx.stroke();

    // north marker
    var nf = Math.max(9, Math.min(14, Math.round(g.r * 0.12)));
    ctx.font = "bold " + nf + "px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10,14,22,0.9)";
    ctx.strokeText("N", cxp, cyp - g.r + nf * 0.9);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("N", cxp, cyp - g.r + nf * 0.9);

    // edge arrows
    arrows = [];
    var asz = Math.max(5, Math.min(8, g.r * 0.05));
    var df = Math.max(8, Math.min(12, Math.round(g.r * 0.07)));

    for (i = 0; i < sqs.length; i++) {
      dx = sqs[i].x - cam.cx;
      dy = sqs[i].y - cam.cy;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d <= vi.wr) continue;
      ang = Math.atan2(dy, dx);
      isSel = (sel !== undefined && sel !== null && String(sel) === String(sqs[i].key));
      sz = isSel ? asz * 1.5 : asz;
      lbl = (sqs[i].key === undefined || sqs[i].key === null) ? "?" : String(sqs[i].key);
      mt = Math.max(10, Math.round(d * 3.5 / 10) * 10);
      pos = drawArrow(ctx, cxp, cyp, g.r, ang, sz,
        isSel ? "#f0c040" : "#2f6fd0", lbl, isSel ? "#1a1206" : "#ffffff", mt, df);
      arrows.push({ x: pos.x, y: pos.y, tx: sqs[i].x, ty: sqs[i].y });
    }

    for (i = 0; i < loot.length; i++) {
      dx = loot[i].x - cam.cx;
      dy = loot[i].y - cam.cy;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d <= vi.wr) continue;
      ang = Math.atan2(dy, dx);
      mt = Math.max(10, Math.round(d * 3.5 / 10) * 10);
      pos = drawArrow(ctx, cxp, cyp, g.r, ang, asz, "#e5483f", "!", "#ffffff", mt, df);
      arrows.push({ x: pos.x, y: pos.y, tx: loot[i].x, ty: loot[i].y });
    }

    // close button on top-right of rim
    var cb = closeButton(g);
    ctx.beginPath();
    ctx.arc(cb.x, cb.y, cb.r, 0, Math.PI * 2);
    ctx.fillStyle = "#10151d";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#3a4553";
    ctx.stroke();
    var xx = cb.r * 0.45;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cb.x - xx, cb.y - xx);
    ctx.lineTo(cb.x + xx, cb.y + xx);
    ctx.moveTo(cb.x + xx, cb.y - xx);
    ctx.lineTo(cb.x - xx, cb.y + xx);
    ctx.stroke();

    ctx.restore();
  }

  function moveCamera(lx, ly) {
    if (typeof Art === "undefined" || !Art.camera) return;
    var g = geom();
    var vi = viewInfo(g);
    Art.camera.cx += (lx - g.x) / vi.s;
    Art.camera.cy += (ly - g.y) / vi.s;
  }

  function contains(lx, ly) {
    if (!available()) return false;
    var g, cb, i, b;
    if (hidden) {
      b = showButton();
      return d2(lx, ly, b.x, b.y) <= b.r * b.r;
    }
    g = geom();
    cb = closeButton(g);
    if (d2(lx, ly, cb.x, cb.y) <= cb.r * cb.r) return true;
    for (i = 0; i < arrows.length; i++) {
      if (d2(lx, ly, arrows[i].x, arrows[i].y) <= 144) return true;
    }
    return d2(lx, ly, g.x, g.y) <= g.r * g.r;
  }

  function mouseDown(lx, ly) {
    if (!available()) return false;
    var g, cb, i, b;
    if (hidden) {
      b = showButton();
      if (d2(lx, ly, b.x, b.y) <= b.r * b.r) {
        hidden = false;
        return true;
      }
      return false;
    }
    g = geom();
    cb = closeButton(g);
    if (d2(lx, ly, cb.x, cb.y) <= cb.r * cb.r) {
      hidden = true;
      dragging = false;
      return true;
    }
    for (i = 0; i < arrows.length; i++) {
      if (d2(lx, ly, arrows[i].x, arrows[i].y) <= 144) {
        if (typeof Art !== "undefined" && Art.camera) {
          Art.camera.cx = arrows[i].tx;
          Art.camera.cy = arrows[i].ty;
        }
        return true;
      }
    }
    if (d2(lx, ly, g.x, g.y) <= g.r * g.r) {
      dragging = true;
      moveCamera(lx, ly);
      return true;
    }
    return false;
  }

  function mouseMove(lx, ly) {
    if (!dragging) return;
    if (!available() || hidden) { dragging = false; return; }
    moveCamera(lx, ly);
  }

  function mouseUp() {
    dragging = false;
  }

  function toggle() {
    hidden = !hidden;
    dragging = false;
  }

  api.draw = draw;
  api.mouseDown = mouseDown;
  api.mouseMove = mouseMove;
  api.mouseUp = mouseUp;
  api.contains = contains;
  api.toggle = toggle;
  api.isHidden = function () { return hidden; };
  api.forced = false;
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = MINIMAP;
