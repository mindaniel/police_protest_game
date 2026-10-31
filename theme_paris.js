var THEME_PARIS = (function () {
  var COLORS = {
    wall: "#e3d5b8", window: "#5d6b7d",
    tops: ["#8f9cab", "#99a6b4", "#8796a6"],
    shopWall: "#d9c7a3", shopTop: "#a8b3bf",
    roofBoxSide: "#7d8a99", roofBoxTop: "#b0bac6",
    balcony: "#3b3f46",
    road: "#d8d4cc", lane: "#cbc6bc", plaza: "#e6dcc8",
    garden: "#a9c98f", gravel: "#ddd2b6", water: "#5f93b8",
    quay: "#c9bb9c", pavement: "#ebe6dc"
  };
  var C_WATER_DEEP = "rgba(0,0,0,0.10)";
  var C_RIPPLE = "rgba(255,255,255,0.18)";
  var C_QUAY_LINE = "rgba(0,0,0,0.25)";
  var C_FLAG = "rgba(0,0,0,0.05)";
  var C_GARDEN_EDGE = "rgba(0,0,0,0.12)";
  var C_CENTERLINE = "rgba(255,255,255,0.5)";
  var C_COBBLE = "rgba(0,0,0,0.07)";
  var C_TABLE = "#ffffff", C_TABLE_EDGE = "#9a9a9a";
  var C_CHAIR = "#8b2f2f", C_AWNING_A = "#c0392b", C_AWNING_B = "#f2f2f2";
  var C_METRO_DARK = "#1f3d2b", C_METRO_LIGHT = "#6fbf8b";
  var C_TRUNK = "#8a7a64";
  var C_CROWN = ["#6f9a5a", "#7fae68", "#5d8a4c"];
  var C_STONE = "#e8dcc0", C_STONE_DARK = "#c9bda1";
  var C_BRONZE = "#5f7f6a", C_GOLD = "#d9b44a";
  var C_SAND = "#d4b483";
  var C_CATH = "#d9d0bd", C_CATH_DARK = "#b8ae98";
  var C_ROSE = "#4a3f52";
  var LM = { arch: 2.6, column: 3.2, obelisk: 2.4, cathedral: 3.0 };
  var lmLookup = null;
  var lmRows = null;

  function hash(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  function buildLookup() {
    if (lmLookup && lmRows === MAP.rows) return;
    lmRows = MAP.rows;
    lmLookup = new Uint8Array(MAP.width * MAP.height);
    var lms = MAP.landmarks;
    if (!lms) return;
    for (var i = 0; i < lms.length; i++) {
      var L = lms[i], code = 0;
      if (L.type === "arch") code = 1;
      else if (L.type === "column") code = 2;
      else if (L.type === "obelisk") code = 3;
      else if (L.type === "cathedral") code = 4;
      if (!code) continue;
      for (var yy = L.y; yy < L.y + L.h; yy++) {
        for (var xx = L.x; xx < L.x + L.w; xx++) {
          if (xx >= 0 && yy >= 0 && xx < MAP.width && yy < MAP.height) {
            lmLookup[yy * MAP.width + xx] = code;
          }
        }
      }
    }
  }

  function height(x, y, ch, r) {
    buildLookup();
    var code = lmLookup[y * MAP.width + x];
    if (code === 1) return 2.6;
    if (code === 2) return 3.2;
    if (code === 3) return 2.4;
    if (code === 4) return 3.0;
    if (ch === "S") return 0.95;
    return 1.35 + r * 0.15;
  }

  function isLandmarkTile(x, y) {
    buildLookup();
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
    return lmLookup[y * MAP.width + x] !== 0;
  }

  function tileAt(x, y) {
    if (x < 0 || y < 0 || y >= MAP.height || x >= MAP.width) return "#";
    return MAP.rows[y].charAt(x);
  }

  function isWater(ch) { return ch === "W"; }
  function isBuilding(ch) { return ch === "#" || ch === "S"; }

  function ground(g, W, H, GT, tile) {
    var x, y, ch, px, py, h1;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        ch = tile(x, y);
        px = x * GT; py = y * GT;
        if (ch === "W") {
          g.fillStyle = COLORS.water;
          g.fillRect(px, py, GT, GT);
          h1 = hash(x, y);
          g.fillStyle = C_WATER_DEEP;
          g.fillRect(px, py + GT * 0.45, GT, GT * 0.1);
          g.fillStyle = C_RIPPLE;
          var n = h1 < 0.5 ? 1 : 2;
          for (var i = 0; i < n; i++) {
            var rh = hash(x + i * 7, y + i * 13);
            var rx = px + GT * (0.15 + rh * 0.5);
            var ry = py + GT * (0.2 + hash(x * 3 + i, y + 5) * 0.6);
            g.fillRect(rx, ry, GT * 0.22, 1);
          }
          // quay edges
          if (tile(x - 1, y) !== "W" && x > 0) drawQuay(g, px, py, GT, 0);
          if (tile(x + 1, y) !== "W" && x < W - 1) drawQuay(g, px, py, GT, 1);
          if (tile(x, y - 1) !== "W" && y > 0) drawQuay(g, px, py, GT, 2);
          if (tile(x, y + 1) !== "W" && y < H - 1) drawQuay(g, px, py, GT, 3);
        } else if (ch === "P") {
          g.fillStyle = COLORS.plaza;
          g.fillRect(px, py, GT, GT);
          g.strokeStyle = C_FLAG; g.lineWidth = 1;
          var s;
          for (s = 1; s < 2; s++) {
            g.beginPath();
            g.moveTo(px + GT * 0.5 * s, py);
            g.lineTo(px + GT * 0.5 * s, py + GT);
            g.moveTo(px, py + GT * 0.5 * s);
            g.lineTo(px + GT, py + GT * 0.5 * s);
            g.stroke();
          }
        } else if (ch === "G") {
          var touchesP = tile(x - 1, y) === "P" || tile(x + 1, y) === "P" ||
                         tile(x, y - 1) === "P" || tile(x, y + 1) === "P";
          g.fillStyle = touchesP ? COLORS.gravel : COLORS.garden;
          g.fillRect(px, py, GT, GT);
          if (!touchesP) {
            g.strokeStyle = C_GARDEN_EDGE; g.lineWidth = 1;
            g.strokeRect(px + 0.5, py + 0.5, GT - 1, GT - 1);
          }
        } else if (ch === ".") {
          g.fillStyle = COLORS.road;
          g.fillRect(px, py, GT, GT);
          // pavement strip along buildings
          if (isBuilding(tile(x, y - 1))) { g.fillStyle = COLORS.pavement; g.fillRect(px, py, GT, GT * 0.28); }
          if (isBuilding(tile(x, y + 1))) { g.fillStyle = COLORS.pavement; g.fillRect(px, py + GT * 0.72, GT, GT * 0.28); }
          if (isBuilding(tile(x - 1, y))) { g.fillStyle = COLORS.pavement; g.fillRect(px, py, GT * 0.28, GT); }
          if (isBuilding(tile(x + 1, y))) { g.fillStyle = COLORS.pavement; g.fillRect(px + GT * 0.72, py, GT * 0.28, GT); }
        } else if (ch === "a") {
          g.fillStyle = COLORS.lane;
          g.fillRect(px, py, GT, GT);
          var hh = hash(x, y);
          if (hh < 0.55) {
            g.fillStyle = C_COBBLE;
            g.fillRect(px + GT * 0.3, py + GT * 0.4, 2, 2);
            if (hh < 0.25) g.fillRect(px + GT * 0.65, py + GT * 0.7, 2, 2);
          }
        }
      }
    }
    // dashed centre lines on wide roads
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (tile(x, y) !== ".") continue;
        if ((x + y) % 2 !== 0) continue;
        var horiz = tile(x - 1, y) === "." && tile(x + 1, y) === ".";
        var vert = tile(x, y - 1) === "." && tile(x, y + 1) === ".";
        if (horiz) {
          var runL = 1, runR = 1;
          while (tile(x - runL - 1, y) === ".") runL++;
          while (tile(x + runR + 1, y) === ".") runR++;
          if (runL + runR + 1 >= 3) {
            g.fillStyle = C_CENTERLINE;
            g.fillRect(x * GT, y * GT + GT * 0.48, GT, Math.max(1, GT * 0.06));
          }
        } else if (vert) {
          var runU = 1, runD = 1;
          while (tile(x, y - runU - 1) === ".") runU++;
          while (tile(x, y + runD + 1) === ".") runD++;
          if (runU + runD + 1 >= 3) {
            g.fillStyle = C_CENTERLINE;
            g.fillRect(x * GT + GT * 0.48, y * GT, Math.max(1, GT * 0.06), GT);
          }
        }
      }
    }
    drawTerraces(g, GT, tile);
    drawMetro(g, GT, tile);
  }

  function drawQuay(g, px, py, GT, side) {
    g.fillStyle = COLORS.quay;
    if (side === 0) g.fillRect(px, py, GT * 0.18, GT);
    else if (side === 1) g.fillRect(px + GT * 0.82, py, GT * 0.18, GT);
    else if (side === 2) g.fillRect(px, py, GT, GT * 0.18);
    else g.fillRect(px, py + GT * 0.82, GT, GT * 0.18);
    g.fillStyle = C_QUAY_LINE;
    if (side === 0) g.fillRect(px + GT * 0.18, py, 1, GT);
    else if (side === 1) g.fillRect(px + GT * 0.82 - 1, py, 1, GT);
    else if (side === 2) g.fillRect(px, py + GT * 0.18, GT, 1);
    else g.fillRect(px, py + GT * 0.82 - 1, GT, 1);
  }

  function drawTerraces(g, GT, tile) {
    if (!MAP.decor || !MAP.decor.terraces) return;
    var list = MAP.decor.terraces;
    var r = GT * 0.12, cr = GT * 0.07;
    for (var i = 0; i < list.length; i++) {
      var T = list[i], px = T.x * GT, py = T.y * GT;
      // awning strip along building side
      if (tile(T.x, T.y - 1) === "#" || tile(T.x, T.y - 1) === "S") {
        for (var k = 0; k < 4; k++) {
          g.fillStyle = (k % 2 === 0) ? C_AWNING_A : C_AWNING_B;
          g.fillRect(px + k * GT * 0.25, py, GT * 0.25, GT * 0.12);
        }
      } else if (tile(T.x, T.y + 1) === "#" || tile(T.x, T.y + 1) === "S") {
        for (var k2 = 0; k2 < 4; k2++) {
          g.fillStyle = (k2 % 2 === 0) ? C_AWNING_A : C_AWNING_B;
          g.fillRect(px + k2 * GT * 0.25, py + GT * 0.88, GT * 0.25, GT * 0.12);
        }
      }
      var txs = [0.32, 0.68], tys = [0.35, 0.65];
      for (var a = 0; a < 2; a++) {
        var tx = px + GT * txs[a], ty = py + GT * tys[a];
        g.fillStyle = C_TABLE;
        g.beginPath(); g.arc(tx, ty, r, 0, 6.2832); g.fill();
        g.strokeStyle = C_TABLE_EDGE; g.lineWidth = 1; g.stroke();
        g.fillStyle = C_CHAIR;
        g.fillRect(tx - r - cr - 1, ty - cr * 0.5, cr, cr);
        g.fillRect(tx + r + 1, ty - cr * 0.5, cr, cr);
        g.fillRect(tx - cr * 0.5, ty - r - cr - 1, cr, cr);
        g.fillRect(tx - cr * 0.5, ty + r + 1, cr, cr);
      }
    }
  }

  function drawMetro(g, GT, tile) {
    if (!MAP.decor || !MAP.decor.metro) return;
    var list = MAP.decor.metro;
    for (var i = 0; i < list.length; i++) {
      var M = list[i], px = M.x * GT, py = M.y * GT;
      g.fillStyle = C_METRO_DARK;
      g.fillRect(px + GT * 0.2, py + GT * 0.32, GT * 0.6, GT * 0.35);
      g.strokeStyle = C_METRO_LIGHT; g.lineWidth = 1;
      g.strokeRect(px + GT * 0.2 + 0.5, py + GT * 0.32 + 0.5, GT * 0.6 - 1, GT * 0.35 - 1);
    }
  }

  function props() {
    var out = [];
    if (!MAP.decor) return out;
    var i, T;
    if (MAP.decor.trees) {
      for (i = 0; i < MAP.decor.trees.length; i++) {
        T = MAP.decor.trees[i];
        out.push({ x: T.x + 0.5, y: T.y + 0.5, kind: "plane", seed: hash(T.x, T.y) });
      }
    }
    if (MAP.decor.metro) {
      for (i = 0; i < MAP.decor.metro.length; i++) {
        T = MAP.decor.metro[i];
        out.push({ x: T.x + 0.5, y: T.y + 0.5, kind: "metro" });
      }
    }
    if (MAP.landmarks) {
      for (i = 0; i < MAP.landmarks.length; i++) {
        T = MAP.landmarks[i];
        out.push({ x: T.x + T.w * 0.5, y: T.y + T.h, kind: T.type, w: T.w, h: T.h, lx: T.x, ly: T.y });
      }
    }
    return out;
  }

  function proj(x, y, z) { return Art.project(x, y, z); }

  function poly4(ctx, a, b, c, d, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }

  function drawProp(ctx, p, t) {
    var S = Art.camera.S;
    if (p.kind === "plane") {
      var base = proj(p.x, p.y, 0);
      // trunk: vertical in screen space
      var tw = 1.6 * S;
      ctx.fillStyle = C_TRUNK;
      ctx.fillRect(base.x - tw * 0.5, base.y - 9 * S, tw, 9 * S);
      var sway = Math.sin(t * 1.1 + (p.seed || 0) * 6.28) * 0.6 * S;
      var cx = base.x + sway, cy = base.y - 13 * S;
      ctx.fillStyle = C_CROWN[0];
      ctx.beginPath(); ctx.arc(cx - 3 * S, cy + 1 * S, 6.5 * S, 0, 6.2832); ctx.fill();
      ctx.fillStyle = C_CROWN[1];
      ctx.beginPath(); ctx.arc(cx + 3.5 * S, cy - 1 * S, 5 * S, 0, 6.2832); ctx.fill();
      ctx.fillStyle = C_CROWN[2];
      ctx.beginPath(); ctx.arc(cx + 0.5 * S, cy - 4 * S, 4.5 * S, 0, 6.2832); ctx.fill();
    } else if (p.kind === "metro") {
      var b = proj(p.x, p.y, 0);
      var pw = Math.max(1, 1.2 * S);
      ctx.fillStyle = C_METRO_DARK;
      ctx.fillRect(b.x - pw * 0.5, b.y - 12 * S, pw, 12 * S);
      ctx.fillStyle = C_METRO_LIGHT;
      ctx.beginPath(); ctx.arc(b.x, b.y - 12 * S, 2.4 * S, 0, 6.2832); ctx.fill();
      ctx.fillStyle = C_GOLD;
      ctx.beginPath(); ctx.arc(b.x, b.y - 12 * S, 1.2 * S, 0, 6.2832); ctx.fill();
    } else if (p.kind === "arch") {
      var w = p.w, h = p.h, x0 = p.lx, y0 = p.ly, H2 = 2.6;
      var fl = proj(x0, y0 + h, 0), fr = proj(x0 + w, y0 + h, 0);
      var bl = proj(x0, y0 + h, H2), br = proj(x0 + w, y0 + h, H2);
      var tl = proj(x0, y0, H2), tr = proj(x0 + w, y0, H2);
      poly4(ctx, bl, br, tr, tl, C_STONE);
      // cornice
      var cb1 = proj(x0, y0 + h, H2 - 0.15), cb2 = proj(x0 + w, y0 + h, H2 - 0.15);
      poly4(ctx, bl, br, cb2, cb1, C_STONE_DARK);
      // opening
      var ow = w * 0.4, oh = H2 * 0.6;
      var oL = proj(x0 + (w - ow) * 0.5, y0 + h, 0);
      var oR = proj(x0 + (w + ow) * 0.5, y0 + h, 0);
      var oT = proj(x0 + (w - ow) * 0.5, y0 + h, oh);
      var oTR = proj(x0 + (w + ow) * 0.5, y0 + h, oh);
      var rad = (oR.x - oL.x) * 0.5;
      ctx.fillStyle = "#2a2622";
      ctx.beginPath();
      ctx.moveTo(oL.x, oL.y);
      ctx.lineTo(oR.x, oR.y);
      ctx.lineTo(oTR.x, oTR.y);
      ctx.arc((oL.x + oTR.x) * 0.5, oTR.y, rad, 0, Math.PI, true);
      ctx.lineTo(oL.x, oL.y);
      ctx.closePath(); ctx.fill();
    } else if (p.kind === "column") {
      var bx = p.x, by = p.y;
      var baseB = proj(bx, by, 0), baseT = proj(bx, by, 0.4);
      var cw = 0.8 * 32 * S, cw2 = 0.35 * 32 * S;
      ctx.fillStyle = C_STONE;
      ctx.fillRect(baseT.x - cw * 0.5, baseT.y, cw, baseB.y - baseT.y);
      var colT = proj(bx, by, 3.2);
      ctx.fillStyle = C_BRONZE;
      ctx.beginPath();
      ctx.moveTo(baseT.x - cw2 * 0.5, baseT.y);
      ctx.lineTo(baseT.x + cw2 * 0.5, baseT.y);
      ctx.lineTo(colT.x + cw2 * 0.5, colT.y);
      ctx.lineTo(colT.x - cw2 * 0.5, colT.y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C_GOLD;
      ctx.beginPath(); ctx.arc(colT.x, colT.y - 2 * S, 2.4 * S, 0, 6.2832); ctx.fill();
    } else if (p.kind === "obelisk") {
      var ox = p.x, oy = p.y, OH = 2.4;
      var ob = proj(ox, oy, 0), ot = proj(ox, oy, OH);
      var wb = 0.35 * 32 * S * 0.5, wt = 0.1 * 32 * S * 0.5;
      ctx.fillStyle = C_SAND;
      ctx.beginPath();
      ctx.moveTo(ob.x - wb, ob.y);
      ctx.lineTo(ob.x + wb, ob.y);
      ctx.lineTo(ot.x + wt, ot.y);
      ctx.lineTo(ot.x - wt, ot.y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C_GOLD;
      ctx.beginPath();
      ctx.moveTo(ot.x - wt, ot.y);
      ctx.lineTo(ot.x + wt, ot.y);
      ctx.lineTo(ot.x, ot.y - 3 * S);
      ctx.closePath(); ctx.fill();
    } else if (p.kind === "cathedral") {
      var cX = p.lx, cY = p.ly, cW = p.w, cH = p.h;
      var bodyBl = proj(cX, cY + cH, 0), bodyBr = proj(cX + cW, cY + cH, 0);
      var bodyTl = proj(cX, cY + cH, 2.0), bodyTr = proj(cX + cW, cY + cH, 2.0);
      poly4(ctx, bodyBl, bodyBr, bodyTr, bodyTl, C_CATH);
      var tw = cW * 0.28;
      drawTower(ctx, cX, cY, tw, 3.0);
      drawTower(ctx, cX + cW - tw, cY, tw, 3.0);
      var rw = proj(cX + cW * 0.5, cY + cH, 1.1);
      ctx.fillStyle = C_ROSE;
      ctx.beginPath(); ctx.arc(rw.x, rw.y, 4 * S, 0, 6.2832); ctx.fill();
      var sp = proj(cX + cW * 0.5, cY, 3.8);
      var spb = proj(cX + cW * 0.5, cY, 2.0);
      ctx.fillStyle = C_CATH_DARK;
      ctx.beginPath();
      ctx.moveTo(spb.x - 3 * S, spb.y);
      ctx.lineTo(spb.x + 3 * S, spb.y);
      ctx.lineTo(sp.x, sp.y);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawTower(ctx, x0, y0, tw, th) {
    var bl = proj(x0, y0 + tw, 0), br = proj(x0 + tw, y0 + tw, 0);
    var tl = proj(x0, y0 + tw, th), tr = proj(x0 + tw, y0 + tw, th);
    poly4(ctx, bl, br, tr, tl, C_CATH);
    ctx.fillStyle = C_CATH_DARK;
    var mid = proj(x0 + tw * 0.5, y0 + tw, th * 0.55);
    ctx.fillRect(mid.x - 2 * Art.camera.S, mid.y - 2 * Art.camera.S, 4 * Art.camera.S, 4 * Art.camera.S);
  }

  function night(x, y) {
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
    if ((x + y) % 4 !== 0) return false;
    var ch = MAP.rows[y].charAt(x);
    if (ch !== "." && ch !== "P") return false;
    if (MAP.river) {
      for (var i = 0; i < MAP.river.length; i++) {
        var R = MAP.river[i];
        if (Math.abs(R.x - x) + Math.abs(R.y - y) <= 2) return true;
      }
    }
    return isBuilding(tileAt(x - 1, y)) || isBuilding(tileAt(x + 1, y)) ||
           isBuilding(tileAt(x, y - 1)) || isBuilding(tileAt(x, y + 1));
  }

  var colors = COLORS;

  return {
    height: height,
    colors: colors,
    ground: ground,
    props: props,
    drawProp: drawProp,
    isLandmarkTile: isLandmarkTile,
    night: night
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = THEME_PARIS;
