var STREETS = (function () {
  function h(x, y, i) {
    var n = (x * 374761393 + y * 668265263 + i * 1442695040888963407) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }
  function rgba(r, g, b, a) { return "rgba(" + r + "," + g + "," + b + "," + a + ")"; }

  function paint(g, W, H, GT, tile, style) {
    var T = GT, i, x, y, px, py, n, k;
    var isGrid = style !== "paris";
    var roadBase = isGrid ? "#c4c8ce" : "#cfc8bb";   /* light, clean road like before */
    var paveCol = isGrid ? "#eceef1" : "#ece6da";
    var cobBase = isGrid ? "#7b7770" : "#9a8e7a";
    var plazaBase = isGrid ? "#c9c6bf" : "#e3d8c2";
    var grassCol = isGrid ? "#6e9a52" : "#7da15e";

    function isB(c) { return c === "#" || c === "S"; }
    function isRoad(c) { return c === "." || c === "a"; }

    // ---- 1. ROAD SURFACE ----
    g.fillStyle = roadBase;
    var spkA = [], spkB = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;
      var ox = x * T, oy = y * T;
      g.fillStyle = roadBase;   /* reset: patches below change fillStyle */
      g.fillRect(ox, oy, T, T);
      var cnt = 25 + (h(x, y, 1) * 15 | 0);
      for (i = 0; i < cnt; i++) {
        var sx = ox + (h(x, y, i * 3) * T | 0), sy = oy + (h(x, y, i * 3 + 1) * T | 0);
        var lite = h(x, y, i * 3 + 2) > 0.5;
        var a = 0.10 + h(x, y, i + 50) * 0.15;
        if (lite) spkA.push([sx, sy, a]); else spkB.push([sx, sy, a]);
      }
      // patches
      var np = 0;   /* no dirty patches */
      for (i = 0; i < np; i++) {
        g.fillStyle = rgba(0, 0, 0, 0.06);
        var pw = T * (0.3 + h(x, y, 80 + i) * 0.4), ph = T * (0.2 + h(x, y, 90 + i) * 0.3);
        g.fillRect(ox + h(x, y, 100 + i) * (T - pw), oy + h(x, y, 110 + i) * (T - ph), pw, ph);
      }
      // crack
      if (false) {   /* no cracks */
        g.strokeStyle = "rgba(30,30,30,0.35)"; g.lineWidth = 1;
        g.beginPath();
        var cx = ox + T * 0.2, cy = oy + T * 0.3;
        g.moveTo(cx, cy);
        for (i = 0; i < 3; i++) {
          cx += (h(x, y, 200 + i) - 0.5) * T * 0.4;
          cy += h(x, y, 210 + i) * T * 0.25;
          g.lineTo(cx, cy);
        }
        g.stroke();
      }
    }
    // draw speckles batched
    g.fillStyle = "rgba(255,255,255,0.10)";
    g.beginPath();
    for (i = 0; i < spkA.length; i++) g.rect(spkA[i][0], spkA[i][1], 1, 1);
    g.fill();
    g.fillStyle = "rgba(60,60,70,0.07)";
    g.beginPath();
    for (i = 0; i < spkB.length; i++) g.rect(spkB[i][0], spkB[i][1], 1, 1);
    g.fill();

    // ---- 2. PAVEMENTS ----
    var paveW = T * 0.32;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;
      var sides = [];
      if (isB(tile(x, y - 1))) sides.push(0);
      if (isB(tile(x, y + 1))) sides.push(1);
      if (isB(tile(x - 1, y))) sides.push(2);
      if (isB(tile(x + 1, y))) sides.push(3);
      var ox2 = x * T, oy2 = y * T;
      for (i = 0; i < sides.length; i++) {
        var s = sides[i];
        g.fillStyle = paveCol;
        var rx, ry, rw, rh, kx, ky, kw, kh;
        if (s === 0) { rx = ox2; ry = oy2; rw = T; rh = paveW; kx = ox2; ky = oy2 + paveW; kw = T; kh = 1; }
        else if (s === 1) { rx = ox2; ry = oy2 + T - paveW; rw = T; rh = paveW; kx = ox2; ky = oy2 + T - paveW; kw = T; kh = 1; }
        else if (s === 2) { rx = ox2; ry = oy2; rw = paveW; rh = T; kx = ox2 + paveW; ky = oy2; kw = 1; kh = T; }
        else { rx = ox2 + T - paveW; ry = oy2; rw = paveW; rh = T; kx = ox2 + T - paveW; ky = oy2; kw = 1; kh = T; }
        g.fillRect(rx, ry, rw, rh);
        // joints
        g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1;
        g.beginPath();
        if (s < 2) {
          for (k = 0.5; k < 1; k += 0.5) { g.moveTo(ox2 + k * T, ry); g.lineTo(ox2 + k * T, ry + rh); }
        } else {
          for (k = 0.5; k < 1; k += 0.5) { g.moveTo(rx, oy2 + k * T); g.lineTo(rx + rw, oy2 + k * T); }
        }
        g.stroke();
        // kerb
        g.fillStyle = "rgba(255,255,255,0.35)";
        if (s === 0) g.fillRect(kx, ky - 1, kw, 1.5);
        else if (s === 1) g.fillRect(kx, ky, kw, 1.5);
        else if (s === 2) g.fillRect(kx - 1, ky, 1.5, kh);
        else g.fillRect(kx, ky, 1.5, kh);
        g.fillStyle = "rgba(0,0,0,0.35)";
        if (s === 0) g.fillRect(kx, ky + 1, kw, 1);
        else if (s === 1) g.fillRect(kx, ky - 1, kw, 1);
        else if (s === 2) g.fillRect(kx + 1, ky, 1, kh);
        else g.fillRect(kx - 1, ky, 1, kh);
      }
      // outer corner
      if (!sides.length) {
        var hasN = isB(tile(x, y - 1)), hasS = isB(tile(x, y + 1)), hasW = isB(tile(x - 1, y)), hasE = isB(tile(x + 1, y));
        var corners = [[-1, -1, 0, 0], [1, -1, T, 0], [-1, 1, 0, T], [1, 1, T, T]];
        for (i = 0; i < 4; i++) {
          var c = corners[i];
          if (isB(tile(x + c[0], y + c[1]))) {
            g.fillStyle = paveCol;
            g.beginPath();
            var cx2 = ox2 + c[2], cy2 = oy2 + c[3];
            /* quarter circle centred on the tile corner, inside the tile */
            var a0 = c[0] < 0 ? (c[1] < 0 ? 0 : 1.5 * Math.PI) : (c[1] < 0 ? 0.5 * Math.PI : Math.PI);
            g.moveTo(cx2, cy2);
            g.arc(cx2, cy2, paveW, a0, a0 + 0.5 * Math.PI);
            g.closePath();
            g.fill();
          }
        }
      }
    }

    // ---- 3 & 4. LANE MARKINGS + ZEBRA ----
    // Precompute run lengths
    var runs = {};
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;
      var hl = 1, hr = 1, vu = 1, vd = 1;
      while (tile(x - hl, y) === ".") hl++;
      while (tile(x + hr, y) === ".") hr++;
      while (tile(x, y - vu) === ".") vu++;
      while (tile(x, y + vd) === ".") vd++;
      runs[x + "," + y] = { h: hl + hr - 1, v: vu + vd - 1, hl: hl - 1, hr: hr - 1, vu: vu - 1, vd: vd - 1 };
    }
    var white = "rgba(255,255,255,1)";
    var edge = "rgba(255,255,255,0.9)";
    var drawn = {};
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;
      var r = runs[x + "," + y];
      // junction?
      var isJuncH = r.hl >= 2 && r.hr >= 2 && r.v >= 3;
      var isJuncV = r.vu >= 2 && r.vd >= 2 && r.h >= 3;
      var junc = isJuncH || isJuncV;
      if (junc) continue;
      var ox3 = x * T, oy3 = y * T;
      // horizontal road (runs H)
      if (r.h >= 2 && r.v <= 2) {
        if (r.h === 2) {
          // center line on boundary of 2 rows: draw on top edge if this is bottom row
          var topIsRoad = tile(x, y - 1) === ".";
          if (!topIsRoad) {
            g.fillStyle = white;
            for (var dx = 0; dx < T; dx += T * 0.8) {
              g.fillRect(ox3 + dx, oy3 - T * 0.03, T * 0.45, T * 0.06);
            }
          }
        } else if (r.h >= 3) {
          // middle tile gets dashed
          var mid = Math.floor(r.h / 2);
          var posInRun = r.hl;
          if (posInRun === mid - 1 || posInRun === mid - 2) {
            // not exact; approximate: draw dashes on tiles in middle band
          }
          // simpler: if this tile is middle of run
          if (posInRun === mid - 1) {
            g.fillStyle = white;
            for (var dx2 = 0; dx2 < T; dx2 += T * 0.8) g.fillRect(ox3 + dx2, oy3 + T * 0.47, T * 0.45, T * 0.06);
          }
          // edge lines
          if (r.vu > 0 && tile(x, y - 1) !== ".") {
            g.fillStyle = edge; g.fillRect(ox3, oy3 + T * 0.15, T, T * 0.04);
          }
          if (tile(x, y + 1) !== ".") {
            g.fillStyle = edge; g.fillRect(ox3, oy3 + T * 0.81, T, T * 0.04);
          }
        }
      }
      // vertical road
      if (r.v >= 2 && r.h <= 2) {
        if (r.v === 2) {
          var leftIsRoad = tile(x - 1, y) === ".";
          if (!leftIsRoad) {
            g.fillStyle = white;
            for (var dy = 0; dy < T; dy += T * 0.8) g.fillRect(ox3 - T * 0.03, oy3 + dy, T * 0.06, T * 0.45);
          }
        } else if (r.v >= 3) {
          var mid2 = Math.floor(r.v / 2);
          if (r.vu === mid2 - 1) {
            g.fillStyle = white;
            for (var dy2 = 0; dy2 < T; dy2 += T * 0.8) g.fillRect(ox3 + T * 0.47, oy3 + dy2, T * 0.06, T * 0.45);
          }
          if (tile(x - 1, y) !== ".") { g.fillStyle = edge; g.fillRect(ox3 + T * 0.15, oy3, T * 0.04, T); }
          if (tile(x + 1, y) !== ".") { g.fillStyle = edge; g.fillRect(ox3 + T * 0.81, oy3, T * 0.04, T); }
        }
      }
      // junction zebra
      if (isJuncH || isJuncV) {
        var arms = [];
        if (isJuncH) {
          // horizontal road runs through; vertical road crosses here
          // crossing on the vertical arms: just north and south
          if (tile(x, y - 1) === "." && runs[x + "," + (y - 1)] && runs[x + "," + (y - 1)].v > 2) arms.push([x, y - 1, "v"]);
          if (tile(x, y + 1) === "." && runs[x + "," + (y + 1)] && runs[x + "," + (y + 1)].v > 2) arms.push([x, y + 1, "v"]);
        }
        if (isJuncV) {
          if (tile(x - 1, y) === "." && runs[(x - 1) + "," + y] && runs[(x - 1) + "," + y].h > 2) arms.push([x - 1, y, "h"]);
          if (tile(x + 1, y) === "." && runs[(x + 1) + "," + y] && runs[(x + 1) + "," + y].h > 2) arms.push([x + 1, y, "h"]);
        }
        for (i = 0; i < arms.length; i++) {
          var ax = arms[i][0], ay = arms[i][1], ad = arms[i][2];
          var key = ax + "," + ay + "," + ad;
          if (drawn[key]) continue;
          drawn[key] = 1;
          var aox = ax * T, aoy = ay * T;
          g.fillStyle = "rgba(255,255,255,1)";
          if (ad === "v") {
            for (var b = 0; b < T; b += T * 0.36) g.fillRect(aox + b, aoy, T * 0.18, T);
          } else {
            for (var b2 = 0; b2 < T; b2 += T * 0.36) g.fillRect(aox, aoy + b2, T, T * 0.18);
          }
        }
      }
    }

    // ---- 5. STREET FURNITURE ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;
      var ox4 = x * T, oy4 = y * T;
      var nearPave = isB(tile(x - 1, y)) || isB(tile(x + 1, y)) || isB(tile(x, y - 1)) || isB(tile(x, y + 1));
      if (nearPave) {
        var drain = (x + y) % 6 === 0 && h(x, y, 3) > 0.5;
        if (drain) {
          var dxp = ox4 + T * 0.3, dyp = oy4 + T * 0.4;
          if (isB(tile(x - 1, y))) dxp = ox4 + T * 0.05;
          else if (isB(tile(x + 1, y))) dxp = ox4 + T * 0.7;
          else if (isB(tile(x, y - 1))) dyp = oy4 + T * 0.05;
          else dyp = oy4 + T * 0.75;
          g.fillStyle = "#2a2a2a";
          g.fillRect(dxp, dyp, T * 0.25, T * 0.1);
          g.fillStyle = "#555";
          for (var db = 0; db < 3; db++) g.fillRect(dxp + 1 + db * (T * 0.25 - 2) / 3, dyp + 1, 1, T * 0.1 - 2);
        }
      } else if (h(x, y, 7) < 1 / 90) {
        var mhx = ox4 + T * 0.5, mhy = oy4 + T * 0.5, mr = T * 0.16;
        g.fillStyle = "#8d9096";
        g.beginPath(); g.arc(mhx, mhy, mr, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(200,200,200,0.4)"; g.lineWidth = 1;
        g.beginPath(); g.arc(mhx, mhy, mr - 1, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.beginPath(); g.moveTo(mhx - mr * 0.5, mhy); g.lineTo(mhx + mr * 0.5, mhy);
        g.moveTo(mhx, mhy - mr * 0.5); g.lineTo(mhx, mhy + mr * 0.5); g.stroke();
      }
    }

    // ---- 6. LANES 'a' ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== "a") continue;
      var ox5 = x * T, oy5 = y * T;
      g.fillStyle = cobBase; g.fillRect(ox5, oy5, T, T);
      var ss = T * 0.18;
      for (var row = 0; row < T; row += ss) {
        var off = ((row / ss) % 2) * (ss * 0.5);
        for (var col = -ss * 0.5; col < T; col += ss) {
          var shade = 0.85 + h(x * 10 + col | 0, y * 10 + row | 0, 1) * 0.3;
          var rcol = Math.floor(parseInt(cobBase.substr(1, 2), 16) * shade);
          var gcol = Math.floor(parseInt(cobBase.substr(3, 2), 16) * shade);
          var bcol = Math.floor(parseInt(cobBase.substr(5, 2), 16) * shade);
          g.fillStyle = "rgb(" + rcol + "," + gcol + "," + bcol + ")";
          g.fillRect(ox5 + col + off, oy5 + row, ss - 0.5, ss - 0.5);
        }
      }
    }

    // ---- 7. PLAZA 'P' ----
    var plazaCount = 0, pminx = W, pmaxx = 0, pminy = H, pmaxy = 0;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) === "P") {
        plazaCount++;
        if (x < pminx) pminx = x; if (x > pmaxx) pmaxx = x;
        if (y < pminy) pminy = y; if (y > pmaxy) pmaxy = y;
      }
    }
    var bigPlaza = plazaCount > 60 && (pmaxx - pminx + 1) * (pmaxy - pminy + 1) > 60;
    var plazaBand = bigPlaza && (pmaxx - pminx) > 4 && (pmaxy - pminy) > 4;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== "P") continue;
      var ox6 = x * T, oy6 = y * T;
      var half = T * 0.5;
      for (var sy = 0; sy < 2; sy++) for (var sx = 0; sx < 2; sx++) {
        var sh = 0.96 + h(x * 2 + sx, y * 2 + sy, 5) * 0.08;
        var rr = Math.floor(parseInt(plazaBase.substr(1, 2), 16) * sh);
        var gg = Math.floor(parseInt(plazaBase.substr(3, 2), 16) * sh);
        var bb = Math.floor(parseInt(plazaBase.substr(5, 2), 16) * sh);
        g.fillStyle = "rgb(" + rr + "," + gg + "," + bb + ")";
        g.fillRect(ox6 + sx * half, oy6 + sy * half, half - 1, half - 1);
        g.strokeStyle = "rgba(0,0,0,0.10)"; g.lineWidth = 1;
        g.strokeRect(ox6 + sx * half + 0.5, oy6 + sy * half + 0.5, half - 1, half - 1);
      }
    }
    if (plazaBand) {
      g.fillStyle = "rgba(120,110,90,0.06)";
      var bandW = T * 1.5;
      var midx = (pminx + pmaxx) / 2 * T, midy = (pminy + pmaxy) / 2 * T;
      g.beginPath();
      g.moveTo(midx - bandW, midy - bandW);
      g.lineTo(midx + bandW, midy + bandW);
      g.lineTo(midx + bandW + bandW * 0.5, midy + bandW + bandW * 0.5);
      g.lineTo(midx - bandW + bandW * 0.5, midy - bandW + bandW * 0.5);
      g.fill();
    }

    // ---- 8. GARDENS 'G' ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== "G") continue;
      var ox7 = x * T, oy7 = y * T;
      g.fillStyle = grassCol; g.fillRect(ox7, oy7, T, T);
      var gr = [[110, 160, 80], [90, 140, 70], [130, 180, 90]];
      var batch = [[], [], []];
      for (i = 0; i < 60; i++) {
        var bx = ox7 + h(x, y, i * 2) * T, by = oy7 + h(x, y, i * 2 + 1) * T;
        var col = h(x, y, i + 300) * 3 | 0;
        batch[col].push([bx, by]);
      }
      for (i = 0; i < 3; i++) {
        g.fillStyle = "rgb(" + gr[i][0] + "," + gr[i][1] + "," + gr[i][2] + ")";
        g.beginPath();
        for (k = 0; k < batch[i].length; k++) g.rect(batch[i][k][0], batch[i][k][1], 1, 1);
        g.fill();
      }
      // gravel edge
      var ew = T * 0.15;
      if (tile(x - 1, y) === "P" || tile(x - 1, y) === ".") { g.fillStyle = "#cdbf9c"; g.fillRect(ox7, oy7, ew, T); }
      if (tile(x + 1, y) === "P" || tile(x + 1, y) === ".") { g.fillStyle = "#cdbf9c"; g.fillRect(ox7 + T - ew, oy7, ew, T); }
      if (tile(x, y - 1) === "P" || tile(x, y - 1) === ".") { g.fillStyle = "#cdbf9c"; g.fillRect(ox7, oy7, T, ew); }
      if (tile(x, y + 1) === "P" || tile(x, y + 1) === ".") { g.fillStyle = "#cdbf9c"; g.fillRect(ox7, oy7 + T - ew, T, ew); }
    }

    // ---- 9. WATER SHORELINE ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== "W") continue;
      var ox8 = x * T, oy8 = y * T, sw = T * 0.12;
      if (tile(x, y - 1) !== "W" && tile(x, y - 1) !== "#") { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8, oy8, T, sw); }
      if (tile(x, y + 1) !== "W" && tile(x, y + 1) !== "#") { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8, oy8 + T - sw, T, sw); }
      if (tile(x - 1, y) !== "W" && tile(x - 1, y) !== "#") { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8, oy8, sw, T); }
      if (tile(x + 1, y) !== "W" && tile(x + 1, y) !== "#") { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8 + T - sw, oy8, sw, T); }
    }

    // ---- 10. AMBIENT OCCLUSION ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var c = tile(x, y);
      if (c === "#" || c === "S" || c === "W") continue;
      var ox9 = x * T, oy9 = y * T;
      // shadow side: N or W neighbour is building
      var strong = isB(tile(x, y - 1)) || isB(tile(x - 1, y));
      var w = T * (strong ? 0.6 : 0.45), a = strong ? 0.28 : 0.22;
      if (isB(tile(x, y - 1))) {
        var grd = g.createLinearGradient(0, oy9, 0, oy9 + w);
        grd.addColorStop(0, "rgba(0,0,0," + a + ")"); grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd; g.fillRect(ox9, oy9, T, w);
      }
      if (isB(tile(x - 1, y))) {
        var grd2 = g.createLinearGradient(ox9, 0, ox9 + w, 0);
        grd2.addColorStop(0, "rgba(0,0,0," + a + ")"); grd2.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd2; g.fillRect(ox9, oy9, w, T);
      }
      if (isB(tile(x, y + 1))) {
        var grd3 = g.createLinearGradient(0, oy9 + T, 0, oy9 + T - w);
        grd3.addColorStop(0, "rgba(0,0,0,0.18)"); grd3.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd3; g.fillRect(ox9, oy9 + T - w, T, w);
      }
      if (isB(tile(x + 1, y))) {
        var grd4 = g.createLinearGradient(ox9 + T, 0, ox9 + T - w, 0);
        grd4.addColorStop(0, "rgba(0,0,0,0.18)"); grd4.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd4; g.fillRect(ox9 + T - w, oy9, w, T);
      }
    }
  }

  return { paint: paint };
})();
if (typeof module !== "undefined" && module.exports) module.exports = STREETS;
