/* deploy.js - squads start at the police station and travel to their planned posts (DeepSeek) */
var DEPLOY = { queue: [], posts: [], centers: [], go: [], timer: 0.7, elapsed: 0, started: false };

DEPLOY._pos = function (G, s) {
  var x = 0, y = 0, n = 0, i, o, v;
  for (i = 0; i < G.officers.length; i++) { o = G.officers[i]; if (o.squad === s) { x += o.x; y += o.y; n++; } }
  for (i = 0; i < G.vehicles.length; i++) { v = G.vehicles[i]; if (v.squad === s) { x += v.x; y += v.y; n++; } }
  return n ? { x: x / n, y: y / n } : null;
};

DEPLOY._bfs = function (G, sx, sy) {
  var W = MAP.width, H = MAP.height, out = [], q = [], head = 0, seen = {}, i, dx, dy, nx, ny, k, r, found;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return out;
  if (!Police.isWalkable(G, sx, sy)) {
    found = false;
    for (r = 1; r <= 4 && !found; r++) {
      for (dy = -r; dy <= r && !found; dy++) for (dx = -r; dx <= r && !found; dx++) {
        nx = sx + dx; ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && Police.isWalkable(G, nx, ny)) { sx = nx; sy = ny; found = true; }
      }
    }
    if (!found) return out;
  }
  q.push([sx, sy]); seen[sy * W + sx] = 1;
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < q.length) {
    var cur = q[head++]; var cx = cur[0], cy = cur[1];
    out.push({ x: cx, y: cy, ch: MAP.rows[cy][cx] });
    for (i = 0; i < 4; i++) {
      nx = cx + dirs[i][0]; ny = cy + dirs[i][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      k = ny * W + nx;
      if (seen[k]) continue;
      if (!Police.isWalkable(G, nx, ny)) continue;
      seen[k] = 1; q.push([nx, ny]);
    }
  }
  return out;
};

DEPLOY._around = function (G, cx, cy, r) {
  var list = [], dx, dy, x, y;
  for (dy = -r; dy <= r; dy++) for (dx = -r; dx <= r; dx++) {
    x = cx + dx; y = cy + dy;
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) continue;
    if (!Police.isWalkable(G, x, y)) continue;
    list.push({ x: x, y: y, d: dx * dx + dy * dy });
  }
  list.sort(function (a, b) { return a.d - b.d; });
  return list;
};

DEPLOY.start = function (G) {
  DEPLOY.queue = []; DEPLOY.posts = []; DEPLOY.centers = []; DEPLOY.go = [];
  DEPLOY.timer = 0.7; DEPLOY.elapsed = 0;
  if (!G.station) { DEPLOY.started = false; return; }
  DEPLOY.started = true;
  var i, s, v, o, t, k, dx, dy, count = 0;
  for (i = 0; i < G.officers.length; i++) count = Math.max(count, G.officers[i].squad + 1);
  for (i = 0; i < G.vehicles.length; i++) count = Math.max(count, G.vehicles[i].squad + 1);
  if (typeof CONFIG !== 'undefined' && CONFIG && typeof CONFIG.squadCount === 'number') count = CONFIG.squadCount;
  for (s = 0; s < count; s++) {
    var ax = 0, ay = 0, an = 0;
    for (i = 0; i < G.officers.length; i++) { o = G.officers[i]; if (o.squad === s) { ax += o.x; ay += o.y; an++; } }
    for (i = 0; i < G.vehicles.length; i++) { v = G.vehicles[i]; if (v.squad === s) { ax += v.x; ay += v.y; an++; } }
    DEPLOY.posts[s] = an ? { x: ax / an, y: ay / an } : null;
  }
  var doorX = Math.floor(G.station.x), doorY = Math.floor(G.station.y);
  var tiles = DEPLOY._bfs(G, doorX, doorY), road = [], walk = [];
  for (i = 0; i < tiles.length; i++) { walk.push(tiles[i]); if (tiles[i].ch === '.') road.push(tiles[i]); }
  var base = tiles.length ? tiles[0] : { x: doorX, y: doorY };
  var used = {}, vehChosen = [], footChosen = [], vehSpot = [], vehBySquad = {}, footBySquad = {};
  function apart(a, list, d) {
    for (var j = 0; j < list.length; j++) { var b = list[j]; if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < d) return false; }
    return true;
  }
  function pickRoad() {
    var d, j, t;
    for (d = 3; d >= 1; d--) for (j = 0; j < road.length; j++) {
      t = road[j];
      if (used[t.x + ',' + t.y]) continue;
      if (apart(t, vehChosen, d)) { used[t.x + ',' + t.y] = 1; vehChosen.push(t); return t; }
    }
    for (j = 0; j < road.length; j++) { t = road[j]; if (!used[t.x + ',' + t.y]) { used[t.x + ',' + t.y] = 1; vehChosen.push(t); return t; } }
    return null;
  }
  function pickFoot() {
    var d, j, t;
    for (d = 2; d >= 1; d--) for (j = 0; j < walk.length; j++) {
      t = walk[j];
      if (used[t.x + ',' + t.y]) continue;
      if (apart(t, footChosen, d) && apart(t, vehChosen, 1)) { used[t.x + ',' + t.y] = 1; footChosen.push(t); return t; }
    }
    for (j = 0; j < walk.length; j++) { t = walk[j]; if (!used[t.x + ',' + t.y]) { used[t.x + ',' + t.y] = 1; footChosen.push(t); return t; } }
    return null;
  }
  for (i = 0; i < G.vehicles.length; i++) {
    v = G.vehicles[i];
    t = pickRoad() || base;
    vehSpot[i] = t;
    if (!vehBySquad[v.squad]) vehBySquad[v.squad] = t;
  }
  for (s = 0; s < count; s++) if (!vehBySquad[s]) { t = pickFoot(); footBySquad[s] = t || base; }
  for (i = 0; i < G.vehicles.length; i++) {
    v = G.vehicles[i]; t = vehSpot[i];
    v.x = t.x + 0.5; v.y = t.y + 0.5; v.tx = v.x; v.ty = v.y; v.dest = null; v.run = null;
    v.ang = Math.atan2(t.y - doorY, t.x - doorX);
    if (!isFinite(v.ang)) v.ang = 0;
  }
  for (s = 0; s < count; s++) {
    var c = vehBySquad[s] || footBySquad[s];
    if (!c) continue;
    DEPLOY.centers[s] = c;
    var need = 0;
    for (i = 0; i < G.officers.length; i++) if (G.officers[i].squad === s) need++;
    var spots = DEPLOY._around(G, c.x, c.y, 1);
    if (spots.length < need) spots = DEPLOY._around(G, c.x, c.y, 2);
    if (vehBySquad[s]) spots = spots.filter(function (p) { return p.x !== c.x || p.y !== c.y; });
    if (!spots.length) spots = [{ x: c.x, y: c.y }];
    var idx = 0;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i]; if (o.squad !== s) continue;
      t = spots[idx % spots.length]; idx++;
      o.x = t.x + 0.5; o.y = t.y + 0.5; o.tx = o.x; o.ty = o.y; o.homeX = o.x; o.homeY = o.y;
    }
  }
  for (s = 0; s < count; s++) {
    var p = DEPLOY.posts[s], cc = DEPLOY.centers[s];
    if (!p || !cc) continue;
    dx = p.x - cc.x; dy = p.y - cc.y;
    if (dx * dx + dy * dy > 9) { DEPLOY.go[s] = 1; DEPLOY.queue.push({ s: s, x: p.x, y: p.y }); }
  }
};

DEPLOY.update = function (G, dt) {
  if (!DEPLOY.started) return;
  if (DEPLOY.elapsed < 120) DEPLOY.elapsed += dt;
  if (DEPLOY.elapsed >= 120) { DEPLOY.queue.length = 0; return; }
  if (!DEPLOY.queue.length) return;
  DEPLOY.timer += dt;
  while (DEPLOY.timer >= 0.7 && DEPLOY.queue.length) {
    DEPLOY.timer -= 0.7;
    var it = DEPLOY.queue.shift();
    if (typeof uiSquadGo === 'function') uiSquadGo(it.s, it.x, it.y, false);
  }
};

DEPLOY.active = function (G) {
  if (!DEPLOY.started) return false;
  if (DEPLOY.elapsed >= 120) return false;
  if (DEPLOY.queue.length) return true;
  for (var s = 0; s < DEPLOY.posts.length; s++) {
    if (!DEPLOY.go[s]) continue;
    var p = DEPLOY.posts[s]; if (!p) continue;
    var pos = DEPLOY._pos(G, s); if (!pos) continue;
    var dx = p.x - pos.x, dy = p.y - pos.y;
    if (dx * dx + dy * dy > 9) return true;
  }
  return false;
};
