var ParisGen = (function () {
  var W, H, grid, rnd, river, places, blvds, shops, landmarks, decor, plaza, keep;

  function mulberry(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function idx(x, y) { return y * W + x; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  function get(x, y) { return inb(x, y) ? grid[idx(x, y)] : '#'; }
  function set(x, y, c) { if (inb(x, y)) grid[idx(x, y)] = c; }
  function isWalk(c) { return c === '.' || c === 'a' || c === 'P' || c === 'G'; }
  function riverY(x) {
    return river.cy + river.amp * Math.sin((x / W) * Math.PI * 1.1 + river.phase);
  }

  // Draw a thick line by stepping and filling tiles whose center is within rad
  function drawLine(x0, y0, x1, y1, rad, ch, stopFn, mark) {
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    var steps = Math.ceil(len / 0.25);
    var r = Math.ceil(rad);
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var cx = x0 + dx * t, cy = y0 + dy * t;
      if (stopFn && stopFn(cx, cy)) break;
      var bx = Math.round(cx), by = Math.round(cy);
      for (var yy = by - r; yy <= by + r; yy++) {
        for (var xx = bx - r; xx <= bx + r; xx++) {
          if (!inb(xx, yy)) continue;
          var ddx = xx + 0.5 - cx, ddy = yy + 0.5 - cy;
          if (ddx * ddx + ddy * ddy <= rad * rad) {
            var c = grid[idx(xx, yy)];
            if (ch === '.' && (c === 'W' || c === 'P' || c === 'G')) continue;
            if (ch === 'a' && c !== '#') continue;
            set(xx, yy, ch);
            if (mark) keep[idx(xx, yy)] = 1;
          }
        }
      }
    }
  }

  function dist(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function buildRiver() {
    river = {
      cy: H * (0.55 + rnd() * 0.20),
      amp: 2.5 + rnd() * 3,
      phase: rnd() * Math.PI * 2,
      width: 4 + Math.floor(rnd() * 2)
    };
    var hasIsland = rnd() < 0;  // island arms need more work; off for now
    river.hasIsland = hasIsland;
    var islCX = W * (0.35 + rnd() * 0.3);
    var islHalfW = 11, islHalfH = 3;
    river.island = hasIsland ? { cx: islCX, halfW: islHalfW, halfH: islHalfH } : null;
    var hw = river.width / 2; // 1.5 -> 3 wide
    var x, y, cy, top, bot, dx, hh;
    for (x = 0; x < W; x++) {
      cy = riverY(x);
      top = Math.floor(cy - hw + 0.5);
      bot = top + river.width - 1;
      if (hasIsland) {
        dx = (x - islCX) / islHalfW;
        if (Math.abs(dx) < 1) {
          hh = islHalfH * Math.sqrt(1 - dx * dx);
          // upper arm 3 wide, island, lower arm 3 wide
          for (y = top; y <= bot; y++) if (inb(x, y)) set(x, y, 'W');
          var iTop = Math.floor(cy - hh + 0.5), iBot = iTop + 2 * Math.round(hh) - 1;
          // clear island band back to land later (do not write W inside it)
          for (y = Math.floor(cy - hh - 0.5); y <= Math.ceil(cy + hh); y++) {
            if (inb(x, y) && get(x, y) === 'W') set(x, y, '#');
          }
          for (y = iBot + 1; y <= iBot + 3; y++) if (inb(x, y)) set(x, y, 'W');
          continue;
        }
      }
      for (y = top; y <= bot; y++) if (inb(x, y)) set(x, y, 'W');
    }
    // 2-tile quay each side, marked keep
    for (x = 0; x < W; x++) {
      cy = riverY(x);
      top = Math.floor(cy - hw + 0.5);
      bot = top + river.width - 1;
      if (hasIsland) {
        dx = (x - islCX) / islHalfW;
        if (Math.abs(dx) < 1) {
          hh = islHalfH * Math.sqrt(1 - dx * dx);
          var iTop = Math.floor(cy - hh + 0.5), iBot = iTop + 2 * Math.round(hh) - 1;
          for (var q = 1; q <= 2; q++) {
            if (iTop - q >= 0 && get(x, iTop - q) !== 'W') { set(x, iTop - q, '.'); keep[(iTop - q) * W + x] = 1; }
            if (iBot + q < H && get(x, iBot + q) !== 'W') { set(x, iBot + q, '.'); keep[(iBot + q) * W + x] = 1; }
          }
          continue;
        }
      }
      for (var q2 = 1; q2 <= 2; q2++) {
        if (top - q2 >= 0 && get(x, top - q2) !== 'W') { set(x, top - q2, '.'); keep[(top - q2) * W + x] = 1; }
        if (bot + q2 < H && get(x, bot + q2) !== 'W') { set(x, bot + q2, '.'); keep[(bot + q2) * W + x] = 1; }
      }
    }
    // island ends: cap the two arms with quay so island is enclosed
    if (hasIsland) {
      for (x = Math.max(1, Math.floor(islCX - islHalfW - 2)); x <= Math.min(W - 2, Math.ceil(islCX + islHalfW + 2)); x++) {
        cy = riverY(x);
        for (y = Math.floor(cy - 6); y <= Math.ceil(cy + 6); y++) {
          if (inb(x, y) && (get(x, y) === '#' || get(x, y) === '.')) {
            var nearW = false;
            for (var yy = y - 1; yy <= y + 1 && !nearW; yy++)
              for (var xx = x - 1; xx <= x + 1 && !nearW; xx++)
                if (inb(xx, yy) && get(xx, yy) === 'W') nearW = true;
            if (nearW) { set(x, y, '.'); keep[y * W + x] = 1; }
          }
        }
      }
    }
  }

  function buildBridges() {
    var n = 3 + Math.floor(rnd() * 2);
    var margin = 6;
    var span = W - margin * 2;
    var xs = [];
    for (var i = 0; i < n; i++) {
      var tries = 0, bx;
      do {
        bx = margin + Math.floor(rnd() * span);
        tries++;
        var ok = true;
        for (var j = 0; j < xs.length; j++) {
          if (Math.abs(xs[j] - bx) < 18) { ok = false; break; }
        }
        if (ok) break;
      } while (tries < 100);
      xs.push(bx);
    }
    xs.sort(function (a, b) { return a - b; });
    var islandBridges = [];
    for (var k = 0; k < xs.length; k++) {
      var x0 = xs[k];
      // find top and bottom of water at this x
      var cy = riverY(x0);
      var hw = river.width / 2;
      var top = Math.floor(cy - hw) - 4;
      var bot = Math.ceil(cy + hw) + 4;
      for (var y = top; y <= bot; y++) {
        for (var dx = 0; dx < 3; dx++) {
          var xx = x0 + dx;
          if (!inb(xx, y)) continue;
          var c = get(xx, y);
          if (c === 'W' || c === '#') { set(xx, y, '.'); keep[idx(xx, y)] = 1; }
        }
      }
      if (river.hasIsland && Math.abs(x0 - river.island.cx) < river.island.halfW + 10) {
        islandBridges.push(x0);
      }
    }
  }

  function buildPlaces() {
    places = [];
    var n = W >= 90 ? 3 : 2;
    var attempts = 0;
    while (places.length < n && attempts < 200) {
      attempts++;
      var px = 10 + Math.floor(rnd() * (W - 20));
      var py = 10 + Math.floor(rnd() * (H * 0.35));
      // must be north of river
      if (py > riverY(px) - river.width / 2 - 8) continue;
      var ok = true;
      for (var i = 0; i < places.length; i++) {
        if (dist(px, py, places[i].x, places[i].y) < 30) { ok = false; break; }
      }
      if (!ok) continue;
      var r = 5 + Math.floor(rnd() * 3);
      places.push({ x: px, y: py, r: r, type: places.length === 0 ? 'arch' : 'column' });
    }
    for (var p = 0; p < places.length; p++) {
      var pl = places[p];
      for (var y = pl.y - pl.r; y <= pl.y + pl.r; y++) {
        for (var x = pl.x - pl.r; x <= pl.x + pl.r; x++) {
          if (dist(x, y, pl.x, pl.y) <= pl.r) set(x, y, 'P');
        }
      }
      if (pl.type === 'arch') {
        for (var yy = pl.y - 1; yy <= pl.y; yy++)
          for (var xx = pl.x - 1; xx <= pl.x + 1; xx++) set(xx, yy, '#');
        landmarks.push({ type: 'arch', x: pl.x - 1, y: pl.y - 1, w: 3, h: 2 });
      } else {
        set(pl.x, pl.y, '#');
        landmarks.push({ type: 'column', x: pl.x, y: pl.y, w: 1, h: 1 });
      }
    }
  }

  function buildBoulevards() {
    blvds = [];
    for (var i = 0; i < places.length; i++) {
      var pl = places[i];
      var n = 5 + Math.floor(rnd() * 3);
      var rot = rnd() * Math.PI * 2;
      for (var j = 0; j < n; j++) {
        var ang = rot + (j / n) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
        blvds.push({ x: pl.x, y: pl.y, ang: ang, from: i });
      }
    }
    // first: between places - add direct connections
    var between = [];
    for (var a = 0; a < places.length; a++) {
      for (var b = a + 1; b < places.length; b++) {
        between.push({ x0: places[a].x, y0: places[a].y, x1: places[b].x, y1: places[b].y, both: true });
      }
    }
    for (var k = 0; k < between.length; k++) {
      var bl = between[k];
      drawLine(bl.x0, bl.y0, bl.x1, bl.y1, 1.6, '.', null, true);
    }
    // other boulevards: radial to edge or until hitting a place
    for (var m = 0; m < blvds.length; m++) {
      var bv = blvds[m];
      var ex = bv.x, ey = bv.y;
      var step = 0.5;
      var dx = Math.cos(bv.ang) * step, dy = Math.sin(bv.ang) * step;
      var found = false;
      var targetX = bv.x, targetY = bv.y;
      for (var s = 0; s < 400; s++) {
        ex += dx; ey += dy;
        if (!inb(Math.round(ex), Math.round(ey))) break;
        // stop if hitting water
        if (get(Math.round(ex), Math.round(ey)) === 'W') { found = true; break; }
        // stop if reaching another place
        for (var p2 = 0; p2 < places.length; p2++) {
          if (p2 === bv.from) continue;
          var pl2 = places[p2];
          if (dist(ex, ey, pl2.x, pl2.y) < pl2.r + 1) { found = true; break; }
        }
        if (found) break;
        targetX = ex; targetY = ey;
      }
      if (found || (ex !== bv.x && ey !== bv.y)) {
        drawLine(bv.x, bv.y, targetX, targetY, 1.6, '.', function (cx, cy) {
          var c = get(Math.round(cx), Math.round(cy));
          return c === 'W';
        }, true);
      }
    }
  }

  function buildRues() {
    var cellW = 26, cellH = 22;
    for (var cy = 0; cy < H; cy += cellH) {
      for (var cx = 0; cx < W; cx += cellW) {
        var ang = rnd() < 0.5 ? 0 : (rnd() - 0.5) * 2 * (30 * Math.PI / 180);
        var cxm = cx + cellW / 2, cym = cy + cellH / 2;
        var spacing = 11 + Math.floor(rnd() * 5);
        for (var dir = 0; dir < 2; dir++) {
          var th = ang + dir * Math.PI / 2;
          var ux = Math.cos(th), uy = Math.sin(th);
          var vx = -uy, vy = ux;
          for (var off = -26; off <= 26; off += spacing) {
            var ox = cxm + vx * off, oy = cym + vy * off;
            var p0x = ox - ux * 26, p0y = oy - uy * 26;
            var p1x = ox + ux * 26, p1y = oy + uy * 26;
            // skip if >half the line's 3-wide band is already road (parallel overlap)
            var cnt = 0, steps = 40;
            for (var s = 0; s <= steps; s++) {
              var t = s / steps;
              var rx = Math.round(p0x + (p1x - p0x) * t), ry = Math.round(p0y + (p1y - p0y) * t);
              if (!inb(rx, ry)) continue;
              if (get(rx, ry) === '.' || get(rx, ry) === 'W') cnt++;
            }
            if (cnt > steps * 0.55) continue;
            drawRueSegment(p0x, p0y, p1x, p1y, cx, cy, cx + cellW, cy + cellH);
          }
        }
      }
    }
  }

  function drawRueSegment(x0, y0, x1, y1, minX, minY, maxX, maxY) {
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    var steps = Math.ceil(len / 0.25);
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var cx = x0 + dx * t, cy = y0 + dy * t;
      if (cx < minX || cx >= maxX || cy < minY || cy >= maxY) continue;
      var bx = Math.round(cx), by = Math.round(cy);
      for (var yy = by - 1; yy <= by + 1; yy++) {
        for (var xx = bx - 1; xx <= bx + 1; xx++) {
          if (!inb(xx, yy)) continue;
          if (xx < minX || xx >= maxX || yy < minY || yy >= maxY) continue;
          var ddx = xx + 0.5 - cx, ddy = yy + 0.5 - cy;
          if (ddx * ddx + ddy * ddy <= 0.75 * 0.75 + 0.25) {
            var c = get(xx, yy);
            if (c === 'W' || c === 'P' || c === 'G' || c === 'S') continue;
            set(xx, yy, '.');
          }
        }
      }
    }
  }

  function buildGardens() {
    // formal garden on north bank near quay
    var gx = 8 + Math.floor(rnd() * (W - 40));
    var gy = Math.floor(riverY(gx) - river.width / 2) - 14;
    if (gy < 3) gy = 3;
    var gw = 16, gh = 8;
    for (var y = gy; y < gy + gh; y++)
      for (var x = gx; x < gx + gw; x++)
        if (inb(x, y)) set(x, y, 'G');
    // fountains
    set(gx + 4, gy + 3, 'W'); set(gx + 5, gy + 3, 'W');
    set(gx + 4, gy + 4, 'W'); set(gx + 5, gy + 4, 'W');
    set(gx + 10, gy + 3, 'W'); set(gx + 11, gy + 3, 'W');
    set(gx + 10, gy + 4, 'W'); set(gx + 11, gy + 4, 'W');
    // cross paths
    for (var x2 = gx; x2 < gx + gw; x2++) { set(x2, gy + 3, 'P'); set(x2, gy + 4, 'P'); }
    for (var y2 = gy; y2 < gy + gh; y2++) { set(gx + 7, y2, 'P'); set(gx + 8, y2, 'P'); }
    // restore fountains
    set(gx + 4, gy + 3, 'W'); set(gx + 5, gy + 3, 'W');
    set(gx + 4, gy + 4, 'W'); set(gx + 5, gy + 4, 'W');
    set(gx + 10, gy + 3, 'W'); set(gx + 11, gy + 3, 'W');
    set(gx + 10, gy + 4, 'W'); set(gx + 11, gy + 4, 'W');

    // small park north
    var sx = 6 + Math.floor(rnd() * (W - 20));
    var sy = 4 + Math.floor(rnd() * (H * 0.3));
    var sw = 6 + Math.floor(rnd() * 4), sh = 6 + Math.floor(rnd() * 4);
    for (var y3 = sy; y3 < sy + sh; y3++)
      for (var x3 = sx; x3 < sx + sw; x3++)
        if (inb(x3, y3) && get(x3, y3) !== 'W') set(x3, y3, 'G');
    // small square south
    if (rnd() < 0.5) {
      var s2x = 6 + Math.floor(rnd() * (W - 20));
      var s2y = Math.floor(riverY(s2x) + river.width / 2) + 6;
      if (s2y + 6 < H) {
        for (var y4 = s2y; y4 < s2y + 6; y4++)
          for (var x4 = s2x; x4 < s2x + 6; x4++)
            if (inb(x4, y4) && get(x4, y4) !== 'W') set(x4, y4, 'G');
      }
    }
  }

  function buildMainSquare() {
    // pick largest place, or sometimes build rectangular square near river
    if (rnd() < 0.3) {
      var mx = 10 + Math.floor(rnd() * (W - 30));
      var my = Math.floor(riverY(mx) - river.width / 2) - 13;
      if (my < 2) my = 2;
      var mw = 14, mh = 10;
      for (var y = my; y < my + mh; y++)
        for (var x = mx; x < mx + mw; x++)
          if (inb(x, y)) set(x, y, 'P');
      set(mx + 7, my + 5, '#');
      landmarks.push({ type: 'obelisk', x: mx + 7, y: my + 5, w: 1, h: 1 });
      set(mx + 4, my + 4, 'W'); set(mx + 5, my + 4, 'W');
      set(mx + 4, my + 5, 'W'); set(mx + 5, my + 5, 'W');
      set(mx + 9, my + 4, 'W'); set(mx + 10, my + 4, 'W');
      set(mx + 9, my + 5, 'W'); set(mx + 10, my + 5, 'W');
      plaza = { x: mx + mw / 2, y: my + mh / 2, r: 7 };
      return;
    }
    var best = places[0];
    for (var i = 1; i < places.length; i++) {
      if (places[i].r > best.r) best = places[i];
    }
    plaza = { x: best.x, y: best.y, r: best.r };
  }

  function placeShops() {
    shops = [];
    var types = ["Boulangerie", "Pharmacie", "Cafe", "Brasserie", "Fromagerie", "Tabac",
      "Librairie", "Bijouterie", "Banque", "Fleuriste", "Electronique", "Opticien",
      "Patisserie", "Mode", "Epicerie", "Bistro"];
    var streets = ["Bd Haussmann", "Rue de Rivoli", "Bd Saint-Michel", "Rue du Bac",
      "Av de l'Opera", "Rue Montorgueil", "Bd Voltaire", "Rue de la Paix",
      "Quai des Orfevres", "Rue Oberkampf"];
    var target = 18 + Math.floor(rnd() * 5);
    var placed = 0;
    var attempts = 0;
    var usedStreets = {};
    while (placed < target && attempts < 5000) {
      attempts++;
      var x = 2 + Math.floor(rnd() * (W - 4));
      var y = 2 + Math.floor(rnd() * (H - 4));
      if (get(x, y) !== '#') continue;
      if (get(x + 1, y) !== '#') continue;
      // check facing road on one side
      var side = -1;
      if (get(x, y - 1) === '.') side = 0;
      else if (get(x, y + 1) === '.') side = 1;
      else if (get(x - 1, y) === '.') side = 2;
      else if (get(x + 2, y) === '.') side = 3;
      if (side < 0) continue;
      // check the other tile has road on same side too
      var other = side === 0 || side === 1 ? get(x + 1, y + (side === 0 ? -1 : 1)) :
        (side === 2 ? get(x - 1, y) : get(x + 2, y));
      if (other !== '.') continue;
      // gap check: don't put next to existing shops
      var near = false;
      for (var dy = -2; dy <= 2; dy++)
        for (var dx = -2; dx <= 2; dx++)
          if (get(x + dx, y + dy) === 'S') near = true;
      if (near) continue;
      var streetName;
      var tries2 = 0;
      do {
        streetName = streets[Math.floor(rnd() * streets.length)];
        tries2++;
      } while (usedStreets[streetName] && tries2 < 20);
      usedStreets[streetName] = true;
      var type = types[Math.floor(rnd() * types.length)];
      set(x, y, 'S'); set(x + 1, y, 'S');
      shops.push({ id: shops.length + 1, name: type + ', ' + streetName, x: x, y: y });
      placed++;
    }
  }

  function connectivityFix() {
    if (!plaza) return;
    var start = idx(Math.round(plaza.x), Math.round(plaza.y));
    if (start < 0 || start >= W * H || !isWalk(grid[start])) {
      // find any walkable
      start = -1;
      for (var i = 0; i < grid.length; i++) if (isWalk(grid[i])) { start = i; break; }
      if (start < 0) return;
    }
    var visited = new Uint8Array(W * H);
    var stack = [start];
    visited[start] = 1;
    while (stack.length) {
      var p = stack.pop();
      var px = p % W, py = (p / W) | 0;
      var nb = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
      for (var i = 0; i < 4; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (!inb(nx, ny)) continue;
        var ni = idx(nx, ny);
        if (visited[ni]) continue;
        if (isWalk(grid[ni])) { visited[ni] = 1; stack.push(ni); }
      }
    }
    for (var i2 = 0; i2 < grid.length; i2++) {
      if (isWalk(grid[i2]) && !visited[i2]) grid[i2] = '#';
    }
  }

  function cleanSlivers() {
    // (a) fill isolated road with building; two passes
    for (var pass = 0; pass < 2; pass++) {
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          if (get(x, y) !== '.') continue;
          if (keep[y * W + x]) continue;
          var hasB = false, nearPGW = false;
          for (var dy = -2; dy <= 2 && !hasB; dy++) {
            for (var dx = -2; dx <= 2 && !hasB; dx++) {
              var nx = x + dx, ny = y + dy;
              if (!inb(nx, ny)) continue;
              var c = get(nx, ny);
              if (c === '#' || c === 'S') hasB = true;
            }
          }
          for (var dy2 = -1; dy2 <= 1 && !nearPGW; dy2++) {
            for (var dx2 = -1; dx2 <= 1 && !nearPGW; dx2++) {
              var nx2 = x + dx2, ny2 = y + dy2;
              if (!inb(nx2, ny2)) continue;
              var c2 = get(nx2, ny2);
              if (c2 === 'P' || c2 === 'G' || c2 === 'W') nearPGW = true;
            }
          }
          if (!hasB && !nearPGW) set(x, y, '#');
        }
      }
    }
    // (b) remove small '#' pieces; grow if not touching keep
    var seen = new Uint8Array(W * H);
    var stack = [];
    for (var sy = 0; sy < H; sy++) {
      for (var sx = 0; sx < W; sx++) {
        var idx = sy * W + sx;
        if (seen[idx] || get(sx, sy) !== '#') continue;
        var cells = [];
        stack.length = 0; stack.push(sx, sy); seen[idx] = 1;
        var touchesKeep = false;
        while (stack.length) {
          var y2 = stack.pop(), x2 = stack.pop();
          cells.push(x2, y2);
          if (keep[y2 * W + x2]) touchesKeep = true;
          for (var dy3 = -1; dy3 <= 1; dy3++) for (var dx3 = -1; dx3 <= 1; dx3++) {
            if (!dx3 && !dy3) continue;
            var nx3 = x2 + dx3, ny3 = y2 + dy3;
            if (!inb(nx3, ny3)) continue;
            var ni = ny3 * W + nx3;
            if (!seen[ni] && get(nx3, ny3) === '#') { seen[ni] = 1; stack.push(nx3, ny3); }
          }
        }
        var n = cells.length / 2;
        if (n >= 4) continue;
        if (touchesKeep) {
          for (var k = 0; k < cells.length; k += 2) set(cells[k], cells[k + 1], '.');
        } else {
          // grow: add road tiles adjacent (not keep, not other specials)
          var need = 4 - n;
          for (var k2 = 0; k2 < cells.length && need > 0; k2 += 2) {
            var cx = cells[k2], cy = cells[k2 + 1];
            for (var dy4 = -1; dy4 <= 1 && need > 0; dy4++) for (var dx4 = -1; dx4 <= 1 && need > 0; dx4++) {
              if (!dx4 && !dy4) continue;
              var gx = cx + dx4, gy = cy + dy4;
              if (!inb(gx, gy)) continue;
              if (keep[gy * W + gx]) continue;
              var cg = get(gx, gy);
              if (cg === '.') { set(gx, gy, '#'); cells.push(gx, gy); need--; }
            }
          }
        }
      }
    }
  }

  function addLanes() {
    var seen = new Uint8Array(W * H);
    var stack = [];
    for (var sy = 0; sy < H; sy++) {
      for (var sx = 0; sx < W; sx++) {
        var idx = sy * W + sx;
        if (seen[idx] || get(sx, sy) !== '#') continue;
        // flood fill block of '#'
        var cells = [];
        stack.length = 0; stack.push(sx, sy); seen[idx] = 1;
        while (stack.length) {
          var y = stack.pop(), x = stack.pop();
          cells.push(x, y);
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nx = x + dx, ny = y + dy;
            if (!inb(nx, ny)) continue;
            var ni = ny * W + nx;
            if (!seen[ni] && get(nx, ny) === '#') { seen[ni] = 1; stack.push(nx, ny); }
          }
        }
        var n = cells.length / 2;
        if (n < 60) continue;
        if (rnd() >= 0.6) continue;
        // bbox
        var minX = W, maxX = 0, minY = H, maxY = 0;
        for (var k = 0; k < cells.length; k += 2) {
          var cx = cells[k], cy = cells[k + 1];
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        }
        var w = maxX - minX + 1, h = maxY - minY + 1;
        var horiz = w >= h;
        // find straight run through middle of longer direction
        var midA = horiz ? Math.floor((minY + maxY) / 2) : Math.floor((minX + maxX) / 2);
        var lo = horiz ? minX : minY, hi = horiz ? maxX : maxY;
        // try center rows near midA
        var bestRow = -1, bestLen = 0, bestFrom = 0, bestTo = 0;
        for (var off2 = 0; off2 <= 2; off2++) {
          for (var sg = -1; sg <= 1; sg += 2) {
            var row = midA + sg * off2;
            if (row < (horiz ? minY : minX) || row > (horiz ? maxY : maxX)) continue;
            var start = -1, runLen = 0, runFrom = 0, runTo = 0;
            for (var p = lo; p <= hi + 1; p++) {
              var ok = p <= hi && (horiz ? get(p, row) === '#' : get(row, p) === '#');
              if (ok) { if (start < 0) start = p; }
              else {
                if (start >= 0 && p - start > runLen) { runLen = p - start; runFrom = start; runTo = p - 1; }
                start = -1;
              }
            }
            if (runLen > bestLen) { bestLen = runLen; bestRow = row; bestFrom = runFrom; bestTo = runTo; }
          }
        }
        if (bestLen < 8) continue;
        // all the way through: extend to touch road both ends if adjacent; else half dead-end
        var reach = bestLen;
        var fromP = bestFrom, toP = bestTo;
        // full-through if a road touches either end
        var roadA = horiz ? (inb(fromP - 1, bestRow) && get(fromP - 1, bestRow) === '.') : (inb(bestRow, fromP - 1) && get(bestRow, fromP - 1) === '.');
        var roadB = horiz ? (inb(toP + 1, bestRow) && get(toP + 1, bestRow) === '.') : (inb(bestRow, toP + 1) && get(bestRow, toP + 1) === '.');
        if (!(roadA || roadB)) {
          // dead end: half length from one side
          reach = Math.floor(bestLen / 2);
          if (rnd() < 0.5) toP = fromP + reach - 1;
          else fromP = toP - reach + 1;
        }
        for (var q = fromP; q <= toP; q++) {
          if (horiz) set(q, bestRow, 'a'); else set(bestRow, q, 'a');
        }
      }
    }
  }

  function buildDecor() {
    decor = { trees: [], terraces: [], metro: [] };
    // trees along boulevards and quays - just sample road tiles near boulevard lines
    for (var b = 0; b < blvds.length; b++) {
      var bv = blvds[b];
      for (var s = 3; s < 200; s += 2) {
        var x = bv.x + Math.cos(bv.ang) * s;
        var y = bv.y + Math.sin(bv.ang) * s;
        var rx = Math.round(x), ry = Math.round(y);
        if (!inb(rx, ry)) break;
        if (get(rx, ry) === '.') {
          // outer edge: check perpendicular offset
          var ox = Math.round(x - Math.sin(bv.ang) * 1.5);
          var oy = Math.round(y + Math.cos(bv.ang) * 1.5);
          if (inb(ox, oy) && get(ox, oy) === '.' && rnd() < 0.5) {
            decor.trees.push({ x: ox, y: oy });
          }
        }
      }
    }
    // trees along quays
    for (var x = 2; x < W; x += 3) {
      var cy = riverY(x);
      var hw = river.width / 2;
      var ty = Math.round(cy - hw - 3);
      var by = Math.round(cy + hw + 3);
      if (inb(x, ty) && get(x, ty) === '.') decor.trees.push({ x: x, y: ty });
      if (inb(x, by) && get(x, by) === '.') decor.trees.push({ x: x, y: by });
    }
    // garden trees
    for (var y = 0; y < H; y++) {
      for (var x2 = 0; x2 < W; x2++) {
        if (get(x2, y) === 'G' && (x2 % 3 === 0) && (y % 3 === 0)) {
          decor.trees.push({ x: x2, y: y });
        }
      }
    }
    // terraces for cafes
    for (var i = 0; i < shops.length; i++) {
      var sh = shops[i];
      var tname = sh.name.split(',')[0];
      if (tname === 'Cafe' || tname === 'Brasserie' || tname === 'Bistro') {
        // find road in front
        var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (var d = 0; d < 4; d++) {
          var nx = sh.x + dirs[d][0], ny = sh.y + dirs[d][1];
          if (inb(nx, ny) && get(nx, ny) === '.') {
            for (var k = 1; k <= 3; k++) {
              var tx = nx + dirs[d][0] * (k - 1), ty2 = ny + dirs[d][1] * (k - 1);
              if (inb(tx, ty2) && get(tx, ty2) === '.') decor.terraces.push({ x: tx, y: ty2 });
            }
            break;
          }
        }
      }
    }
    // metro entrances near places
    for (var p = 0; p < places.length && decor.metro.length < 8; p++) {
      var pl = places[p];
      for (var attempts = 0; attempts < 20 && decor.metro.length < 8; attempts++) {
        var mx = pl.x + Math.floor((rnd() - 0.5) * pl.r * 3);
        var my = pl.y + Math.floor((rnd() - 0.5) * pl.r * 3);
        if (!inb(mx, my) || get(mx, my) !== '.') continue;
        // must be next to a building
        var hasB = false;
        if (get(mx - 1, my) === '#') hasB = true;
        if (get(mx + 1, my) === '#') hasB = true;
        if (get(mx, my - 1) === '#') hasB = true;
        if (get(mx, my + 1) === '#') hasB = true;
        if (!hasB) continue;
        var tooClose = false;
        for (var m = 0; m < decor.metro.length; m++) {
          if (dist(mx, my, decor.metro[m].x, decor.metro[m].y) < 8) { tooClose = true; break; }
        }
        if (!tooClose) decor.metro.push({ x: mx, y: my });
      }
    }
  }

  function layout(seed, width, height) {
    W = width; H = height;
    rnd = mulberry(seed);
    grid = new Array(W * H);
    for (var i = 0; i < grid.length; i++) grid[i] = '#';
    shops = []; landmarks = []; decor = { trees: [], terraces: [], metro: [] };
    places = []; blvds = []; plaza = null; keep = new Uint8Array(W * H);

    buildRiver();
    buildBridges();
    buildPlaces();
    buildBoulevards();
    buildRues();
    buildGardens();
    buildMainSquare();
    placeShops();
    cleanSlivers();
    addLanes();
    connectivityFix();
    buildDecor();

    // ensure edge has openings
    var edges = [[], [], [], []];
    for (var x = 0; x < W; x++) {
      if (get(x, 0) === '.') edges[0].push(x);
      if (get(x, H - 1) === '.') edges[2].push(x);
    }
    for (var y = 0; y < H; y++) {
      if (get(0, y) === '.') edges[3].push(y);
      if (get(W - 1, y) === '.') edges[1].push(y);
    }

    var riverPts = [];
    for (var xx = 0; xx < W; xx++) riverPts.push({ x: xx, y: riverY(xx) });

    return {
      grid: grid,
      plaza: plaza,
      shops: shops,
      landmarks: landmarks,
      decor: decor,
      river: riverPts
    };
  }

  return { layout: layout };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ParisGen;
