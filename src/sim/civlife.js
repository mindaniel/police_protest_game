/* civlife.js (DeepSeek) */
(function () {
  var CIVLIFE = window.CIVLIFE = window.CIVLIFE || {};
  CIVLIFE.list = [];
  CIVLIFE.grid = [];
  CIVLIFE.gridSize = 8;
  CIVLIFE.spawnTimer = 0;
  CIVLIFE.seedCounter = 0;

  var COLORS = ['#b07a5a', '#6b8e9e', '#9e7a6b', '#7a9e7a', '#9e9e6b', '#8e6b9e', '#6b9e8e', '#a88a8a'];
  var cellSize = 8;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function isWalk(G, x, y) {
    return typeof Police !== 'undefined' && Police.isWalkable && Police.isWalkable(G, x, y);
  }

  function tileChar(G, x, y) {
    if (!MAP || !MAP.rows) return '#';
    if (y < 0 || y >= MAP.height || x < 0 || x >= MAP.width) return '#';
    var row = MAP.rows[y];
    if (!row) return '#';
    return row[x] || '#';
  }

  function goodSpawnTile(G, x, y) {
    var c = tileChar(G, x, y);
    return (c === 'P' || c === 'G' || c === 'a');
  }

  function findSpawn(G) {
    for (var i = 0; i < 80; i++) {
      var x = Math.floor(Math.random() * (MAP ? MAP.width : 1));
      var y = Math.floor(Math.random() * (MAP ? MAP.height : 1));
      if (goodSpawnTile(G, x, y) && isWalk(G, x, y)) return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }

  function findTileOfType(G, type, fromX, fromY) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < 200; i++) {
      var x = Math.floor(Math.random() * (MAP ? MAP.width : 1));
      var y = Math.floor(Math.random() * (MAP ? MAP.height : 1));
      var c = tileChar(G, x, y);
      if (c === type && isWalk(G, x, y)) {
        var d = Math.abs(x - fromX) + Math.abs(y - fromY);
        if (d < bestD) { bestD = d; best = { x: x + 0.5, y: y + 0.5 }; }
      }
      if (best && bestD < 30) return best;
    }
    return best;
  }

  function shopDoor(G) {
    if (!G.shops || !G.shops.length) return null;
    var s = G.shops[Math.floor(Math.random() * G.shops.length)];
    if (s.broken) return null;
    return { x: s.x + 0.5, y: s.y + 0.5 };
  }

  function edgeTarget(G) {
    var side = Math.floor(Math.random() * 4);
    if (side === 0) return { x: 0.5, y: rnd(1, (MAP ? MAP.height : 2) - 1) };
    if (side === 1) return { x: (MAP ? MAP.width : 2) - 0.5, y: rnd(1, (MAP ? MAP.height : 2) - 1) };
    if (side === 2) return { x: rnd(1, (MAP ? MAP.width : 2) - 1), y: 0.5 };
    return { x: rnd(1, (MAP ? MAP.width : 2) - 1), y: (MAP ? MAP.height : 2) - 0.5 };
  }

  function makeCivilian(G) {
    var sp = findSpawn(G);
    if (!sp) return null;
    var c = {
      id: CIVLIFE.seedCounter++,
      x: sp.x, y: sp.y,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      speed: rnd(0.9, 1.3),
      state: 'idle',
      stateTimer: rnd(0.5, 2),
      gx: sp.x, gy: sp.y,
      hasBag: Math.random() < 0.4,
      hasPhone: false,
      faceX: 0, faceY: 0,
      fleeing: false,
      filmTimer: 0,
      lean: 0,
      offMap: false,
      checkTimer: Math.random() * 0.5
    };
    return c;
  }

  function pickGoal(G, c, state) {
    var g = null;
    if (state === 'shopping') {
      g = shopDoor(G);
      if (!g) g = findTileOfType(G, 'P', c.x, c.y);
    } else if (state === 'park') {
      g = findTileOfType(G, 'G', c.x, c.y);
    } else if (state === 'commute') {
      g = edgeTarget(G);
    } else if (state === 'chat') {
      g = findTileOfType(G, 'P', c.x, c.y);
    }
    if (!g) g = edgeTarget(G);
    return g;
  }

  function setNewRoutine(G, c) {
    var r = Math.random();
    if (r < 0.4) { c.state = 'shopping'; c.stateTimer = 0; }
    else if (r < 0.65) { c.state = 'park'; c.stateTimer = 0; }
    else if (r < 0.85) { c.state = 'commute'; c.stateTimer = 0; }
    else { c.state = 'chat'; c.stateTimer = 0; }
    var g = pickGoal(G, c, c.state);
    c.gx = g.x; c.gy = g.y;
    c.offMap = false;
  }

  function tryMove(G, c, nx, ny) {
    if (isWalk(G, Math.floor(nx), Math.floor(ny))) { c.x = nx; c.y = ny; return true; }
    if (isWalk(G, Math.floor(nx), Math.floor(c.y))) { c.x = nx; return true; }
    if (isWalk(G, Math.floor(c.x), Math.floor(ny))) { c.y = ny; return true; }
    return false;
  }

  function moveToward(G, c, tx, ty, speed, dt) {
    var dx = tx - c.x, dy = ty - c.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.08) return true;
    var step = speed * dt;
    if (step > d) step = d;
    var nx = c.x + (dx / d) * step;
    var ny = c.y + (dy / d) * step;
    if (!tryMove(G, c, nx, ny)) return false;
    c.faceX = dx; c.faceY = dy;
    return d < 0.15;
  }

  function rebuildGrid(G) {
    CIVLIFE.grid = [];
    var W = MAP ? Math.ceil(MAP.width / cellSize) : 0;
    var H = MAP ? Math.ceil(MAP.height / cellSize) : 0;
    for (var i = 0; i < W * H; i++) CIVLIFE.grid.push([]);
    for (var j = 0; j < CIVLIFE.list.length; j++) {
      var c = CIVLIFE.list[j];
      var cx = Math.floor(c.x / cellSize);
      var cy = Math.floor(c.y / cellSize);
      if (cx < 0) cx = 0; if (cy < 0) cy = 0;
      if (cx >= W) cx = W - 1; if (cy >= H) cy = H - 1;
      CIVLIFE.grid[cy * W + cx].push(c);
    }
  }

  function nearCells(cx, cy, r, W, H, out) {
    var x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        out.push(y * W + x);
      }
    }
    return out;
  }

  CIVLIFE.reset = function (G) {
    CIVLIFE.list = [];
    CIVLIFE.seedCounter = 0;
    CIVLIFE.spawnTimer = 0;
    var target = 120;
    for (var i = 0; i < target; i++) {
      var c = makeCivilian(G);
      if (c) { CIVLIFE.list.push(c); setNewRoutine(G, c); }
    }
    rebuildGrid(G);
  };

  CIVLIFE.spawn = function (G) {
    if (CIVLIFE.list.length >= 140) return;
    var c = makeCivilian(G);
    if (c) { CIVLIFE.list.push(c); setNewRoutine(G, c); }
  };

  function checkReactions(G, c, dt, W, H) {
    c.checkTimer -= dt;
    if (c.checkTimer > 0) return;
    c.checkTimer = 0.5;

    var cx = Math.floor(c.x / cellSize);
    var cy = Math.floor(c.y / cellSize);
    var cells = nearCells(cx, cy, 1, W, H, []);

    var crowdCount = 0;
    var hasViolence = false;
    var hasFire = false;
    var hasPolice = false;
    var nearestCrowdX = 0, nearestCrowdY = 0, nearestCrowdD = 1e9;

    for (var ci = 0; ci < cells.length; ci++) {
      var idx = cells[ci];
      var arr = CIVLIFE.grid[idx];
      if (!arr) continue;
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (o === c) continue;
        var dx = o.x - c.x, dy = o.y - c.y;
        if (dx * dx + dy * dy < 36) crowdCount++;
      }
    }

    if (G.agents && typeof Crowd !== 'undefined' && Crowd.neighbors) {
      var nbrs = Crowd.neighbors(G, c.x, c.y, 6);
      if (nbrs && nbrs.length) {
        for (var ni = 0; ni < nbrs.length; ni++) {
          var a = nbrs[ni];
          if (!a || !a.active) continue;
          crowdCount++;
          if (a.role === 'rioter' || (a.violentUntil && a.violentUntil > G.time)) {
            hasViolence = true;
            var d = (a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y);
            if (d < nearestCrowdD) { nearestCrowdD = d; nearestCrowdX = a.x; nearestCrowdY = a.y; }
          }
        }
      }
    }

    if (G.officers) {
      for (var oi = 0; oi < G.officers.length; oi++) {
        var off = G.officers[oi];
        if (!off) continue;
        var odx = off.x - c.x, ody = off.y - c.y;
        if (odx * odx + ody * ody < 4) hasPolice = true;
      }
    }

    if (typeof FX !== 'undefined' && FX.listFires && G) {
      var fires = FX.listFires(G);
      if (fires && fires.length) {
        for (var fi = 0; fi < fires.length; fi++) {
          var f = fires[fi];
          var fdx = f.x - c.x, fdy = f.y - c.y;
          if (fdx * fdx + fdy * fdy < 36) {
            hasFire = true;
            if (fdx * fdx + fdy * fdy < nearestCrowdD) { nearestCrowdD = fdx * fdx + fdy * fdy; nearestCrowdX = f.x; nearestCrowdY = f.y; }
          }
        }
      }
    }

    if (hasViolence || hasFire) {
      c.fleeing = true;
      c.state = 'flee';
      c.stateTimer = 0;
      c.hasPhone = false;
      var awayX = c.x - nearestCrowdX, awayY = c.y - nearestCrowdY;
      var ad = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
      var g = edgeTarget(G);
      c.gx = g.x; c.gy = g.y;
      c.faceX = awayX; c.faceY = awayY;
      return;
    }

    if (hasPolice && c.state !== 'flee') {
      c.state = 'stepaside';
      c.stateTimer = 1.2;
      var px = c.x + (Math.random() - 0.5) * 3;
      var py = c.y + (Math.random() - 0.5) * 3;
      c.gx = px; c.gy = py;
      return;
    }

    if (crowdCount >= 12 && !c.fleeing) {
      if (Math.random() < 0.3 && c.state !== 'film') {
        c.state = 'film';
        c.stateTimer = rnd(8, 15);
        c.hasPhone = true;
        c.faceX = nearestCrowdX - c.x; c.faceY = nearestCrowdY - c.y;
      }
    }
  }

  CIVLIFE.update = function (G, dt) {
    if (!G || !MAP) return;
    if (!CIVLIFE.list.length) { CIVLIFE.reset(G); return; }
    if (dt > 0.25) dt = 0.25;

    rebuildGrid(G);

    var W = Math.ceil(MAP.width / cellSize);
    var H = Math.ceil(MAP.height / cellSize);

    var calmEnd = (CONFIG && CONFIG.calmStartSeconds ? CONFIG.calmStartSeconds : 0) + 300;
    var latePhase = G.time > calmEnd;
    var spawnChance = latePhase ? 0.2 : 1;

    CIVLIFE.spawnTimer += dt;
    if (CIVLIFE.spawnTimer > 2) {
      CIVLIFE.spawnTimer = 0;
      if (Math.random() < spawnChance) CIVLIFE.spawn(G);
    }

    for (var i = CIVLIFE.list.length - 1; i >= 0; i--) {
      var c = CIVLIFE.list[i];
      c.lean = 0;

      checkReactions(G, c, dt, W, H);

      if (c.state === 'flee') {
        c.lean = 0.3;
        var arrived = moveToward(G, c, c.gx, c.gy, 2.6, dt);
        if (c.x < 0.5 || c.y < 0.5 || c.x > MAP.width - 0.5 || c.y > MAP.height - 0.5) {
          c.offMap = true;
        }
        if (arrived || c.offMap) {
          c.fleeing = false;
          var ns = findSpawn(G);
          if (ns) { c.x = ns.x; c.y = ns.y; c.offMap = false; setNewRoutine(G, c); }
          else { CIVLIFE.list.splice(i, 1); }
        }
        continue;
      }

      if (c.state === 'film') {
        c.stateTimer -= dt;
        c.faceX = c.faceX || 1; c.faceY = c.faceY || 0;
        if (c.stateTimer <= 0) {
          c.hasPhone = false;
          setNewRoutine(G, c);
        }
        continue;
      }

      if (c.state === 'stepaside') {
        c.stateTimer -= dt;
        moveToward(G, c, c.gx, c.gy, 2.0, dt);
        if (c.stateTimer <= 0) setNewRoutine(G, c);
        continue;
      }

      if (c.state === 'shopping') {
        if (c.stateTimer > 0) {
          c.stateTimer -= dt;
          c.faceX = c.faceX || 0; c.faceY = c.faceY || 1;
          if (c.stateTimer <= 0) setNewRoutine(G, c);
          continue;
        }
        var done = moveToward(G, c, c.gx, c.gy, c.speed, dt);
        if (done) { c.stateTimer = rnd(5, 20); c.hasBag = true; }
        continue;
      }

      if (c.state === 'park') {
        if (c.stateTimer > 0) {
          c.stateTimer -= dt;
          if (c.stateTimer <= 0) setNewRoutine(G, c);
          continue;
        }
        var dp = moveToward(G, c, c.gx, c.gy, c.speed, dt);
        if (dp) { c.stateTimer = rnd(3, 10); }
        continue;
      }

      if (c.state === 'chat') {
        if (c.stateTimer > 0) {
          c.stateTimer -= dt;
          if (c.stateTimer <= 0) setNewRoutine(G, c);
          continue;
        }
        var dc = moveToward(G, c, c.gx, c.gy, c.speed, dt);
        if (dc) { c.stateTimer = rnd(5, 15); }
        continue;
      }

      if (c.state === 'commute') {
        var dcm = moveToward(G, c, c.gx, c.gy, c.speed, dt);
        if (c.x < 0.5 || c.y < 0.5 || c.x > MAP.width - 0.5 || c.y > MAP.height - 0.5 || dcm) {
          var nsp = findSpawn(G);
          if (nsp) { c.x = nsp.x; c.y = nsp.y; setNewRoutine(G, c); }
          else { CIVLIFE.list.splice(i, 1); }
        }
        continue;
      }

      c.stateTimer -= dt;
      if (c.stateTimer <= 0) setNewRoutine(G, c);
    }
  };

  CIVLIFE.draw = function (ctx, G) {
    if (!Art || !Art.camera || Art.camera.zoom <= 1.2) return;
    if (!CIVLIFE.list.length || !MAP) return;

    var pt = Math.abs(Art.project(1, 0, 0).x - Art.project(0, 0, 0).x);
    var camX = Art.camera.x, camY = Art.camera.y;
    var zoom = Art.camera.zoom;
    var viewW = ctx.canvas.width / zoom;
    var viewH = ctx.canvas.height / zoom;
    var size = pt * 0.28;
    if (size < 0.6) size = 0.6;

    for (var i = 0; i < CIVLIFE.list.length; i++) {
      var c = CIVLIFE.list[i];
      var sx = c.x - camX, sy = c.y - camY;
      /* off-screen ones are cheap: 120 circles at most */

      var p = Art.project(c.x, c.y, 0);
      var s = p;
      if (!s) continue;

      var lean = c.lean || 0;
      var lx = lean * size * 0.8;
      var bodyY = s.y - size * 1.2;

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(s.x + lx, bodyY, size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e8d0b8';
      ctx.beginPath();
      ctx.arc(s.x + lx + lean * size * 0.3, bodyY - size * 1.15, size * 0.62, 0, Math.PI * 2);
      ctx.fill();

      if (c.hasBag) {
        ctx.fillStyle = '#5a4a3a';
        ctx.fillRect(s.x + lx + size * 0.4, bodyY, size * 0.5, size * 0.7);
      }
      if (c.hasPhone) {
        ctx.fillStyle = '#aef0ff';
        ctx.beginPath();
        ctx.arc(s.x + lx + size * 0.3, bodyY - size * 0.8, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  CIVLIFE.count = function () { return CIVLIFE.list.length; };
})();
