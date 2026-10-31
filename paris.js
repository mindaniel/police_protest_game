var ParisGen = (function () {
  var W, H, grid, rnd, river, places, blvds, shops, landmarks, decor, plaza;

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
    return river.cy + river.amp * Math.sin((x / W) * Math.PI * 2 + river.phase);
  }

  // Draw a thick line by stepping and filling tiles whose center is within rad
  function drawLine(x0, y0, x1, y1, rad, ch, stopFn) {
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
      amp: 4 + rnd() * 4,
      phase: rnd() * Math.PI * 2,
      width: 4 + Math.floor(rnd() * 2)
    };
    var hasIsland = rnd() < 0.5;
    river.hasIsland = hasIsland;
    var islCX = W * (0.35 + rnd() * 0.3);
    var islHalfW = 11, islHalfH = 3.5;
    river.island = hasIsland ? { cx: islCX, halfW: islHalfW, halfH: islHalfH } : null;
    for (var x = 0; x < W; x++) {
      var cy = riverY(x);
      var hw = river.width / 2;
      if (hasIsland) {
        var dx = (x - islCX) / islHalfW;
        if (Math.abs(dx) < 1) {
          var hh = islHalfH * Math.sqrt(1 - dx * dx);
          // two arms each 3 wide around island
          for (var y = Math.floor(cy - hw - hh - 3); y <= Math.ceil(cy + hw + hh + 3); y++) {
            if (!inb(x, y)) continue;
            var inIsl = Math.abs(y - cy) <= hh;
            if (!inIsl) set(x, y, 'W');
          }
          continue;
        }
      }
      for (var y2 = Math.floor(cy - hw); y2 <= Math.ceil(cy + hw); y2++) {
        set(x, y2, 'W');
      }
    }
    // quays: 2-tile road along both banks
    for (var x2 = 0; x2 < W; x2++) {
      var cy2 = riverY(x2);
      var hw2 = river.width / 2;
      var top = Math.floor(cy2 - hw2);
      var bot = Math.ceil(cy2 + hw2);
      if (hasIsland) {
        var dx2 = (x2 - islCX) / islHalfW;
        if (Math.abs(dx2) < 1) {
          var hh2 = islHalfH * Math.sqrt(1 - dx2 * dx2);
          top = Math.floor(cy2 - hw2 - hh2 - 3);
          bot = Math.ceil(cy2 + hw2 + hh2 + 3);
          // quay around island
          for (var yy = Math.floor(cy2 - hh2) - 1; yy <= Math.ceil(cy2 + hh2) + 1; yy++) {
            for (var xx = Math.floor(x2) - 1; xx <= Math.ceil(x2) + 1; xx++) {
              if (!inb(xx, yy)) continue;
              if (get(xx, yy) === '#' || get(xx, yy) === '.') set(xx, yy, '.');
            }
          }
        }
      }
      for (var q = 1; q <= 2; q++) {
        if (top - q >= 0 && get(x2, top - q) !== 'W') set(x2, top - q, '.');
        if (bot + q < H && get(x2, bot + q) !== 'W') set(x2, bot + q, '.');
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
          if (c === 'W' || c === '#') set(xx, y, '.');
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
      drawLine(bl.x0, bl.y0, bl.x1, bl.y1, 1.6, '.', null);
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
        });
      }
    }
  }

  function buildRues() {
    var cellW = 24, cellH = 20;
    for (var cy = 0; cy < H; cy += cellH) {
      for (var cx = 0; cx < W; cx += cellW) {
        var ang;
        if (rnd() < 0.5) ang = 0;
        else ang = (rnd() - 0.5) * 2 * (35 * Math.PI / 180);
        var cxm = cx + cellW / 2, cym = cy + cellH / 2;
        var spacing = 9 + Math.floor(rnd() * 6);
        // two directions
        for (var dir = 0; dir < 2; dir++) {
          var th = ang + dir * Math.PI / 2;
          var ux = Math.cos(th), uy = Math.sin(th);
          var vx = -uy, vy = ux;
          for (var off = -30; off <= 30; off += spacing) {
            var ox = cxm + vx * off, oy = cym + vy * off;
            var p0x = ox - ux * 30, p0y = oy - uy * 30;
            var p1x = ox + ux * 30, p1y = oy + uy * 30;
            drawRueSegment(p0x, p0y, p1x, p1y, cx, cy, cx + cellW, cy + cellH);
          }
        }
      }
    }
    // lanes through large blocks
    for (var y = 2; y < H - 2; y++) {
      for (var x = 2; x < W - 2; x++) {
        if (get(x, y) === '#' && get(x + 1, y) === '#' && get(x + 2, y) === '#' &&
            get(x, y + 1) === '#' && get(x + 1, y + 1) === '#' && get(x + 2, y + 1) === '#' &&
            get(x, y - 1) === '#' && get(x + 1, y - 1) === '#' && get(x + 2, y - 1) === '#' &&
            get(x, y + 2) === '#' && get(x + 1, y + 2) === '#' && get(x + 2, y + 2) === '#' &&
            get(x, y - 2) === '#' && get(x + 1, y - 2) === '#' && get(x + 2, y - 2) === '#') {
          if (rnd() < 0.6) {
            var len = 2 + Math.floor(rnd() * 4);
            for (var l = 0; l < len; l++) {
              if (inb(x + 1, y + l)) set(x + 1, y + l, 'a');
            }
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
          if (ddx * ddx + ddy * ddy <= 1.0) {
            var c = get(xx, yy);
            if (c === 'W' || c === 'P' || c === 'G') continue;
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
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        if (get(x, y) !== '#') continue;
        var l = get(x - 1, y), r = get(x + 1, y), u = get(x, y - 1), d = get(x, y + 1);
        if (isWalk(l) && isWalk(r) && !isWalk(u) && !isWalk(d)) set(x, y, '.');
        if (isWalk(u) && isWalk(d) && !isWalk(l) && !isWalk(r)) set(x, y, '.');
      }
    }
    // 2x2 blocks
    for (var y2 = 0; y2 < H - 1; y2++) {
      for (var x2 = 0; x2 < W - 1; x2++) {
        if (get(x2, y2) === '#' && get(x2 + 1, y2) === '#' &&
            get(x2, y2 + 1) === '#' && get(x2 + 1, y2 + 1) === '#') continue;
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
    places = []; blvds = []; plaza = null;

    buildRiver();
    buildBridges();
    buildPlaces();
    buildBoulevards();
    buildRues();
    buildGardens();
    buildMainSquare();
    placeShops();
    cleanSlivers();
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
