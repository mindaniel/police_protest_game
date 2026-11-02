var STREETS = (function () {
  function h(x, y, i) {
    var n = (x * 374761393 + y * 668265263 + i * 1442695040888963407) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  function rgba(r, g, b, a) {
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function paint(g, W, H, GT, tile, style) {
    var T = GT, i, x, y, px, py, n, k;
    var isGrid = style !== "paris";
    var legacyRoadBase = isGrid ? "#c4c8ce" : "#cfc8bb";
    var paveCol = isGrid ? "#eceef1" : "#ece6da";
    var cobBase = isGrid ? "#7b7770" : "#9a8e7a";
    var plazaBase = isGrid ? "#c9c6bf" : "#e3d8c2";
    var grassCol = isGrid ? "#6e9a52" : "#7da15e";
    var hasRoadData = typeof MAP !== "undefined" &&
      MAP && Object.prototype.toString.call(MAP.roads) === "[object Array]";

    function isB(c) {
      return c === "#" || c === "S";
    }

    function isRoad(c) {
      return c === ".";
    }

    function roadAt(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
      return tile(tx, ty) === ".";
    }

    function pointSegmentDistance(px0, py0, ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t0;
      if (len2 <= 0.000001) {
        dx = px0 - ax;
        dy = py0 - ay;
        return Math.sqrt(dx * dx + dy * dy);
      }
      t0 = ((px0 - ax) * dx + (py0 - ay) * dy) / len2;
      t0 = Math.max(0, Math.min(1, t0));
      dx = px0 - (ax + t0 * (bx - ax));
      dy = py0 - (ay + t0 * (by - ay));
      return Math.sqrt(dx * dx + dy * dy);
    }

    function nearestRoad(tx, ty) {
      var roads = MAP.roads || [];
      var best = null, bestD = Infinity, ri, road, pts, j;
      var ax, ay, bx, by, dx, dy, len2, t0, qx, qy, dist;
      for (ri = 0; ri < roads.length; ri++) {
        road = roads[ri];
        pts = road.p || [];
        for (j = 0; j + 3 < pts.length; j += 2) {
          ax = pts[j];
          ay = pts[j + 1];
          bx = pts[j + 2];
          by = pts[j + 3];
          dx = bx - ax;
          dy = by - ay;
          len2 = dx * dx + dy * dy;
          if (len2 <= 0.000001) continue;
          t0 = ((tx - ax) * dx + (ty - ay) * dy) / len2;
          t0 = Math.max(0, Math.min(1, t0));
          qx = ax + t0 * dx;
          qy = ay + t0 * dy;
          dist = (tx - qx) * (tx - qx) + (ty - qy) * (ty - qy);
          if (dist < bestD) {
            bestD = dist;
            best = {
              road: road,
              ax: ax,
              ay: ay,
              bx: bx,
              by: by,
              x: qx,
              y: qy,
              dx: dx,
              dy: dy,
              dist: Math.sqrt(dist)
            };
          }
        }
      }
      return best;
    }

    function inJunction(px0, py0, junctions) {
      var j;
      for (j = 0; j < junctions.length; j++) {
        var q = junctions[j];
        var dx = px0 - q.x, dy = py0 - q.y;
        if (dx * dx + dy * dy < q.r * q.r) return true;
      }
      return false;
    }

    function buildJunctions() {
      var roads = MAP.roads || [];
      var junctions = [];
      var i0, j0, a, b, pa, pb, ia, ib, ax, ay, bx, by;
      var limit, dx, dy, d2, duplicate, q;
      for (i0 = 0; i0 < roads.length; i0++) {
        a = roads[i0];
        pa = a.p || [];
        for (ia = 0; ia + 1 < pa.length; ia += 2) {
          ax = pa[ia];
          ay = pa[ia + 1];
          for (j0 = i0; j0 < roads.length; j0++) {
            b = roads[j0];
            pb = b.p || [];
            for (ib = (j0 === i0 ? ia + 2 : 0); ib + 1 < pb.length; ib += 2) {
              bx = pb[ib];
              by = pb[ib + 1];
              limit = ((a.w || 1) + (b.w || 1)) * 0.25;
              dx = ax - bx;
              dy = ay - by;
              d2 = dx * dx + dy * dy;
              if (d2 > limit * limit) continue;
              duplicate = false;
              for (q = 0; q < junctions.length; q++) {
                dx = junctions[q].x - (ax + bx) * 0.5;
                dy = junctions[q].y - (ay + by) * 0.5;
                if (dx * dx + dy * dy < 0.04) {
                  duplicate = true;
                  break;
                }
              }
              if (!duplicate) {
                junctions.push({
                  x: (ax + bx) * 0.5,
                  y: (ay + by) * 0.5,
                  r: Math.max(a.w || 1, b.w || 1) * 0.5
                });
              }
            }
          }
        }
      }
      return junctions;
    }

    function drawRoadLine(road, ax, ay, bx, by, junctions, drawFn) {
      var dx = bx - ax, dy = by - ay;
      var len = Math.sqrt(dx * dx + dy * dy);
      var step, d, px0, py0, nx, ny;
      if (len < 0.0001) return;
      step = Math.max(0.12, Math.min(0.25, (road.w || 1) / 10));
      for (d = 0; d <= len; d += step) {
        px0 = ax + dx * d / len;
        py0 = ay + dy * d / len;
        if (inJunction(px0, py0, junctions)) continue;
        nx = -dy / len;
        ny = dx / len;
        drawFn(px0, py0, nx, ny, dx / len, dy / len, d, len);
      }
    }

    function roadColour(road) {
      if (road.c === "major") return "#5d6168";
      if (road.c === "minor") return "#6a6e75";
      return "#777b80";
    }

    function drawRoadMarkings(junctions) {
      var roads = MAP.roads || [];
      var ri, road, pts, j, ax, ay, bx, by, dx, dy, len;
      var lanes, laneWidth, offset, side, dash, period, d, px0, py0;
      var nx, ny, ux, uy, gap, markW, start, end, stripe;
      var white = "rgba(255,255,255,0.88)";

      for (ri = 0; ri < roads.length; ri++) {
        road = roads[ri];
        if (road.c === "service") continue;
        pts = road.p || [];
        lanes = Math.max(1, parseInt(road.l, 10) || 1);
        laneWidth = (road.w || 1) / lanes;
        markW = Math.max(0.035, Math.min(0.09, laneWidth * 0.055));
        dash = Math.max(0.25, laneWidth * 0.55);
        gap = Math.max(0.18, laneWidth * 0.45);
        period = dash + gap;

        for (j = 0; j + 3 < pts.length; j += 2) {
          ax = pts[j];
          ay = pts[j + 1];
          bx = pts[j + 2];
          by = pts[j + 3];
          dx = bx - ax;
          dy = by - ay;
          len = Math.sqrt(dx * dx + dy * dy);
          if (len < 0.0001) continue;
          ux = dx / len;
          uy = dy / len;
          nx = -uy;
          ny = ux;

          if (!road.o && lanes <= 2) {
            start = 0;
            end = len;
            drawRoadLine(road, ax, ay, bx, by, junctions, function (cx, cy, cnx, cny, cux, cuy, dist, segLen) {
              var along = dist;
              if (road.c === "major") {
                g.fillStyle = white;
                g.fillRect(cx * T - markW * T * 0.5, cy * T - markW * T * 0.5, markW * T, markW * T);
              } else {
                if ((along % period) < dash) {
                  g.fillStyle = white;
                  g.fillRect(cx * T - markW * T * 0.5, cy * T - markW * T * 0.5, markW * T, markW * T);
                }
              }
            });
          }

          if (lanes > 2 || road.o) {
            var dividerCount = road.o ? lanes - 1 : lanes - 1;
            for (side = 1; side <= dividerCount; side++) {
              offset = (side - lanes / 2) * laneWidth;
              if (!road.o && lanes === 2) continue;
              drawRoadLine(road, ax, ay, bx, by, junctions, function (cx, cy, cnx, cny, cux, cuy, dist, segLen) {
                if ((dist % period) < dash) {
                  g.fillStyle = white;
                  g.fillRect((cx + cnx * offset) * T - markW * T * 0.5,
                    (cy + cny * offset) * T - markW * T * 0.5,
                    markW * T, markW * T);
                }
              });
            }
          }

          if (road.o) {
            for (d = 4; d < len; d += 8) {
              px0 = ax + ux * d;
              py0 = ay + uy * d;
              if (inJunction(px0, py0, junctions)) continue;
              g.save();
              g.translate(px0 * T, py0 * T);
              g.rotate(Math.atan2(uy, ux));
              g.fillStyle = white;
              g.beginPath();
              g.moveTo(T * 0.32, 0);
              g.lineTo(-T * 0.22, -T * 0.16);
              g.lineTo(-T * 0.08, 0);
              g.lineTo(-T * 0.22, T * 0.16);
              g.closePath();
              g.fill();
              g.restore();
            }
          }
        }
      }
    }

    function drawZebras() {
      var crossings = MAP.crossings || [];
      var roads = MAP.roads || [];
      var ci, crossing, tx, ty, nearest, road, width, ux, uy, nx, ny;
      var stripes, stripeGap, stripeWidth, i0, centre, offset, halfWidth;
      var ax, ay, bx, by, len, dist, px0, py0, j;
      for (ci = 0; ci < crossings.length; ci++) {
        crossing = crossings[ci];
        tx = crossing[0];
        ty = crossing[1];
        if (!roadAt(Math.floor(tx), Math.floor(ty))) continue;

        nearest = nearestRoad(tx, ty);
        if (!nearest) continue;
        road = nearest.road;
        ax = nearest.ax;
        ay = nearest.ay;
        bx = nearest.bx;
        by = nearest.by;
        len = Math.sqrt(nearest.dx * nearest.dx + nearest.dy * nearest.dy);
        if (len < 0.0001) continue;

        ux = nearest.dx / len;
        uy = nearest.dy / len;
        nx = -uy;
        ny = ux;
        width = Math.max(1.5, road.w || 1);
        stripes = 6;
        stripeGap = 0.13;
        stripeWidth = 0.13;
        halfWidth = width * 0.5;

        for (i0 = 0; i0 < stripes; i0++) {
          offset = (i0 - (stripes - 1) / 2) * (stripeWidth + stripeGap);
          centre = tx * T + ux * offset * T;
          py0 = ty * T + uy * offset * T;
          g.strokeStyle = "rgba(255,255,255,0.95)";
          g.lineWidth = Math.max(1, T * 0.13);
          g.beginPath();
          g.moveTo(centre - nx * halfWidth * T, py0 - ny * halfWidth * T);
          g.lineTo(centre + nx * halfWidth * T, py0 + ny * halfWidth * T);
          g.stroke();
        }
      }
    }

    // ---- 1. ROAD SURFACE ----
    var spkA = [], spkB = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;

      var ox = x * T, oy = y * T;
      var base = legacyRoadBase;
      var roadInfo = null;

      if (hasRoadData) {
        roadInfo = nearestRoad(x + 0.5, y + 0.5);
        if (roadInfo) base = roadColour(roadInfo.road);
      }

      g.fillStyle = base;
      g.fillRect(ox, oy, T, T);

      var cnt = 25 + (h(x, y, 1) * 15 | 0);
      for (i = 0; i < cnt; i++) {
        var sx = ox + (h(x, y, i * 3) * T | 0);
        var sy = oy + (h(x, y, i * 3 + 1) * T | 0);
        var lite = h(x, y, i * 3 + 2) > 0.5;
        var a = 0.05 + h(x, y, i + 50) * 0.08;
        if (lite) spkA.push([sx, sy, a]);
        else spkB.push([sx, sy, a]);
      }
    }

    g.fillStyle = "rgba(255,255,255,0.10)";
    g.beginPath();
    for (i = 0; i < spkA.length; i++) g.rect(spkA[i][0], spkA[i][1], 1, 1);
    g.fill();
    g.fillStyle = "rgba(20,20,25,0.10)";
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
      if (hasRoadData) {
        if (y === 0) sides.push(0);
        if (y === H - 1) sides.push(1);
        if (x === 0) sides.push(2);
        if (x === W - 1) sides.push(3);
      }

      var ox2 = x * T, oy2 = y * T;
      for (i = 0; i < sides.length; i++) {
        var s = sides[i];
        var stripW = paveW;
        if (hasRoadData) {
          var info = nearestRoad(x + 0.5, y + 0.5);
          var rw = info && info.road ? info.road.w || 1 : 2;
          stripW = T * (rw >= 4 ? 0.32 : Math.min(0.32, 0.24));
        }

        g.fillStyle = paveCol;
        var rx, ry, rw2, rh, kx, ky, kw, kh;
        if (s === 0) {
          rx = ox2; ry = oy2; rw2 = T; rh = stripW;
          kx = ox2; ky = oy2 + stripW; kw = T; kh = 1;
        } else if (s === 1) {
          rx = ox2; ry = oy2 + T - stripW; rw2 = T; rh = stripW;
          kx = ox2; ky = oy2 + T - stripW; kw = T; kh = 1;
        } else if (s === 2) {
          rx = ox2; ry = oy2; rw2 = stripW; rh = T;
          kx = ox2 + stripW; ky = oy2; kw = 1; kh = T;
        } else {
          rx = ox2 + T - stripW; ry = oy2; rw2 = stripW; rh = T;
          kx = ox2 + T - stripW; ky = oy2; kw = 1; kh = T;
        }

        g.fillRect(rx, ry, rw2, rh);
        g.strokeStyle = "rgba(0,0,0,0.12)";
        g.lineWidth = 1;
        g.beginPath();
        if (s < 2) {
          for (k = 0.5; k < 1; k += 0.5) {
            g.moveTo(ox2 + k * T, ry);
            g.lineTo(ox2 + k * T, ry + rh);
          }
        } else {
          for (k = 0.5; k < 1; k += 0.5) {
            g.moveTo(rx, oy2 + k * T);
            g.lineTo(rx + rw2, oy2 + k * T);
          }
        }
        g.stroke();

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

      if (!sides.length) {
        var corners = [[-1, -1, 0, 0], [1, -1, T, 0], [-1, 1, 0, T], [1, 1, T, T]];
        for (i = 0; i < 4; i++) {
          var c = corners[i];
          if (isB(tile(x + c[0], y + c[1]))) {
            g.fillStyle = paveCol;
            g.beginPath();
            var cx2 = ox2 + c[2], cy2 = oy2 + c[3];
            var a0 = c[0] < 0 ? (c[1] < 0 ? 0 : 1.5 * Math.PI) :
              (c[1] < 0 ? 0.5 * Math.PI : Math.PI);
            g.moveTo(cx2, cy2);
            g.arc(cx2, cy2, paveW, a0, a0 + 0.5 * Math.PI);
            g.closePath();
            g.fill();
          }
        }
      }
    }

    // ---- 3. ROAD MARKINGS AND JUNCTION CLEARING ----
    if (hasRoadData) {
      var junctions = buildJunctions();
      drawRoadMarkings(junctions);
      drawZebras();
    } else {
      // Preserve the legacy road-marking appearance for maps without road metadata.
      var runs = {};
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        if (tile(x, y) !== ".") continue;
        var hl = 1, hr = 1, vu = 1, vd = 1;
        while (tile(x - hl, y) === ".") hl++;
        while (tile(x + hr, y) === ".") hr++;
        while (tile(x, y - vu) === ".") vu++;
        while (tile(x, y + vd) === ".") vd++;
        runs[x + "," + y] = {
          h: hl + hr - 1, v: vu + vd - 1,
          hl: hl - 1, hr: hr - 1, vu: vu - 1, vd: vd - 1
        };
      }

      var whiteLegacy = "rgba(255,255,255,1)";
      var edgeLegacy = "rgba(255,255,255,0.9)";
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        if (tile(x, y) !== ".") continue;
        var r = runs[x + "," + y];
        var isJuncH = r.hl >= 2 && r.hr >= 2 && r.v >= 3;
        var isJuncV = r.vu >= 2 && r.vd >= 2 && r.h >= 3;
        if (isJuncH || isJuncV) continue;

        var ox3 = x * T, oy3 = y * T;
        if (r.h >= 2 && r.v <= 2) {
          if (r.h === 2) {
            if (tile(x, y - 1) !== ".") {
              g.fillStyle = whiteLegacy;
              for (var dx = 0; dx < T; dx += T * 0.8) {
                g.fillRect(ox3 + dx, oy3 - T * 0.03, T * 0.45, T * 0.06);
              }
            }
          } else {
            var mid = Math.floor(r.h / 2);
            if (r.hl - 1 === mid - 1) {
              g.fillStyle = whiteLegacy;
              for (var dx2 = 0; dx2 < T; dx2 += T * 0.8) {
                g.fillRect(ox3 + dx2, oy3 + T * 0.47, T * 0.45, T * 0.06);
              }
            }
            if (r.vu > 0 && tile(x, y - 1) !== ".") {
              g.fillStyle = edgeLegacy;
              g.fillRect(ox3, oy3 + T * 0.15, T, T * 0.04);
            }
            if (tile(x, y + 1) !== ".") {
              g.fillStyle = edgeLegacy;
              g.fillRect(ox3, oy3 + T * 0.81, T, T * 0.04);
            }
          }
        }
        if (r.v >= 2 && r.h <= 2) {
          if (r.v === 2) {
            if (tile(x - 1, y) !== ".") {
              g.fillStyle = whiteLegacy;
              for (var dy = 0; dy < T; dy += T * 0.8) {
                g.fillRect(ox3 - T * 0.03, oy3 + dy, T * 0.06, T * 0.45);
              }
            }
          } else {
            var mid2 = Math.floor(r.v / 2);
            if (r.vu === mid2 - 1) {
              g.fillStyle = whiteLegacy;
              for (var dy2 = 0; dy2 < T; dy2 += T * 0.8) {
                g.fillRect(ox3 + T * 0.47, oy3 + dy2, T * 0.06, T * 0.45);
              }
            }
            if (tile(x - 1, y) !== ".") {
              g.fillStyle = edgeLegacy;
              g.fillRect(ox3 + T * 0.15, oy3, T * 0.04, T);
            }
            if (tile(x + 1, y) !== ".") {
              g.fillStyle = edgeLegacy;
              g.fillRect(ox3 + T * 0.81, oy3, T * 0.04, T);
            }
          }
        }
      }
    }

    // ---- 4. STREET FURNITURE ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== ".") continue;
      var ox4 = x * T, oy4 = y * T;
      var nearPave = isB(tile(x - 1, y)) || isB(tile(x + 1, y)) ||
        isB(tile(x, y - 1)) || isB(tile(x, y + 1));
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
          for (var db = 0; db < 3; db++) {
            g.fillRect(dxp + 1 + db * (T * 0.25 - 2) / 3, dyp + 1, 1, T * 0.1 - 2);
          }
        }
      } else if (h(x, y, 7) < 1 / 90) {
        var mhx = ox4 + T * 0.5, mhy = oy4 + T * 0.5, mr = T * 0.16;
        g.fillStyle = "#8d9096";
        g.beginPath(); g.arc(mhx, mhy, mr, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(200,200,200,0.4)"; g.lineWidth = 1;
        g.beginPath(); g.arc(mhx, mhy, mr - 1, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.beginPath();
        g.moveTo(mhx - mr * 0.5, mhy); g.lineTo(mhx + mr * 0.5, mhy);
        g.moveTo(mhx, mhy - mr * 0.5); g.lineTo(mhx, mhy + mr * 0.5);
        g.stroke();
      }
    }

    // ---- 5. LANES 'a' ----
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

    // ---- 6. PLAZA 'P' ----
    var plazaCount = 0, pminx = W, pmaxx = 0, pminy = H, pmaxy = 0;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) === "P") {
        plazaCount++;
        if (x < pminx) pminx = x;
        if (x > pmaxx) pmaxx = x;
        if (y < pminy) pminy = y;
        if (y > pmaxy) pmaxy = y;
      }
    }

    var bigPlaza = plazaCount > 60 &&
      (pmaxx - pminx + 1) * (pmaxy - pminy + 1) > 60;
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
      var midx = (pminx + pmaxx) / 2 * T;
      var midy = (pminy + pmaxy) / 2 * T;
      g.beginPath();
      g.moveTo(midx - bandW, midy - bandW);
      g.lineTo(midx + bandW, midy + bandW);
      g.lineTo(midx + bandW + bandW * 0.5, midy + bandW + bandW * 0.5);
      g.lineTo(midx - bandW + bandW * 0.5, midy - bandW + bandW * 0.5);
      g.fill();
    }

    // ---- 7. GARDENS 'G' ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== "G") continue;
      var ox7 = x * T, oy7 = y * T;
      g.fillStyle = grassCol; g.fillRect(ox7, oy7, T, T);
      var gr = [[110, 160, 80], [90, 140, 70], [130, 180, 90]];
      var batch = [[], [], []];
      for (i = 0; i < 60; i++) {
        var bx = ox7 + h(x, y, i * 2) * T;
        var by = oy7 + h(x, y, i * 2 + 1) * T;
        var col = h(x, y, i + 300) * 3 | 0;
        batch[col].push([bx, by]);
      }
      for (i = 0; i < 3; i++) {
        g.fillStyle = "rgb(" + gr[i][0] + "," + gr[i][1] + "," + gr[i][2] + ")";
        g.beginPath();
        for (k = 0; k < batch[i].length; k++) {
          g.rect(batch[i][k][0], batch[i][k][1], 1, 1);
        }
        g.fill();
      }
      var ew = T * 0.15;
      if (tile(x - 1, y) === "P" || tile(x - 1, y) === ".") {
        g.fillStyle = "#cdbf9c"; g.fillRect(ox7, oy7, ew, T);
      }
      if (tile(x + 1, y) === "P" || tile(x + 1, y) === ".") {
        g.fillStyle = "#cdbf9c"; g.fillRect(ox7 + T - ew, oy7, ew, T);
      }
      if (tile(x, y - 1) === "P" || tile(x, y - 1) === ".") {
        g.fillStyle = "#cdbf9c"; g.fillRect(ox7, oy7, T, ew);
      }
      if (tile(x, y + 1) === "P" || tile(x, y + 1) === ".") {
        g.fillStyle = "#cdbf9c"; g.fillRect(ox7, oy7 + T - ew, T, ew);
      }
    }

    // ---- 8. WATER SHORELINE ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (tile(x, y) !== "W") continue;
      var ox8 = x * T, oy8 = y * T, sw = T * 0.12;
      if (tile(x, y - 1) !== "W" && tile(x, y - 1) !== "#") {
        g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8, oy8, T, sw);
      }
      if (tile(x, y + 1) !== "W" && tile(x, y + 1) !== "#") {
        g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8, oy8 + T - sw, T, sw);
      }
      if (tile(x - 1, y) !== "W" && tile(x - 1, y) !== "#") {
        g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8, oy8, sw, T);
      }
      if (tile(x + 1, y) !== "W" && tile(x + 1, y) !== "#") {
        g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox8 + T - sw, oy8, sw, T);
      }
    }

    // ---- 9. AMBIENT OCCLUSION ----
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var c = tile(x, y);
      if (c === "#" || c === "S" || c === "W") continue;
      var ox9 = x * T, oy9 = y * T;
      var strong = isB(tile(x, y - 1)) || isB(tile(x - 1, y));
      var shadeW = T * (strong ? 0.6 : 0.45);
      var shadeA = strong ? 0.28 : 0.22;

      if (isB(tile(x, y - 1))) {
        var grd = g.createLinearGradient(0, oy9, 0, oy9 + shadeW);
        grd.addColorStop(0, "rgba(0,0,0," + shadeA + ")");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd; g.fillRect(ox9, oy9, T, shadeW);
      }
      if (isB(tile(x - 1, y))) {
        var grd2 = g.createLinearGradient(ox9, 0, ox9 + shadeW, 0);
        grd2.addColorStop(0, "rgba(0,0,0," + shadeA + ")");
        grd2.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd2; g.fillRect(ox9, oy9, shadeW, T);
      }
      if (isB(tile(x, y + 1))) {
        var grd3 = g.createLinearGradient(0, oy9 + T, 0, oy9 + T - shadeW);
        grd3.addColorStop(0, "rgba(0,0,0,0.18)");
        grd3.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd3; g.fillRect(ox9, oy9 + T - shadeW, T, shadeW);
      }
      if (isB(tile(x + 1, y))) {
        var grd4 = g.createLinearGradient(ox9 + T, 0, ox9 + T - shadeW, 0);
        grd4.addColorStop(0, "rgba(0,0,0,0.18)");
        grd4.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd4; g.fillRect(ox9 + T - shadeW, oy9, shadeW, T);
      }
    }
  }

  return { paint: paint };
})();

if (typeof module !== "undefined" && module.exports) module.exports = STREETS;
