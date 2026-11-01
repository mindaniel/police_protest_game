/* citygen.js - loads a real neighbourhood (maps/*.js, REALMAPS) into MAP
 * (browser only): entrances, doors, protest areas and police staging. Writes
 * MAP + the map-specific CONFIG keys. Tests never load this file and keep using the fixed map in map.js.
 * CONFIG is read only inside apply() (game.js loads after this file).
 */
var CityGen = (function () {
  "use strict";

  var W = 0, H = 0, g = null, R = Math.random, pendingSites = null;

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
  function get(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? "#" : g[y * W + x]; }
  function set(x, y, c) { if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = c; }
  function walk(c) { return c === "." || c === "P" || c === "G" || c === "a"; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(R() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function d2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  /* Number of walkable tiles in the 5x5 window: high at junctions and squares. */
  function openness(x, y) {
    var n = 0;
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) if (walk(get(x + dx, y + dy))) n++;
    return n;
  }

  /* Walkable tiles within BFS distance r of (cx,cy), ignoring alleys and the park. */
  function area(cx, cy, r) {
    var seen = {}, q = [{ x: cx, y: cy, d: 0 }], out = [], h = 0;
    seen[cx + "," + cy] = true;
    while (h < q.length) {
      var c = q[h++];
      out.push({ x: c.x, y: c.y });
      if (c.d >= r) continue;
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var nx = c.x + nb[i][0], ny = c.y + nb[i][1], k = nx + "," + ny, ch = get(nx, ny);
        if (seen[k] || !(ch === "." || ch === "P")) continue;
        seen[k] = true;
        q.push({ x: nx, y: ny, d: c.d + 1 });
      }
    }
    return out;
  }

  /* Farthest-point style pick: candidates sorted by score, kept if spaced. */
  function spacedPick(cands, n, minD, avoid, avoidD) {
    var out = [], i, j, ok;
    for (i = 0; i < cands.length && out.length < n; i++) {
      ok = true;
      for (j = 0; j < out.length && ok; j++) if (d2(cands[i], out[j]) < minD * minD) ok = false;
      for (j = 0; avoid && j < avoid.length && ok; j++) if (d2(cands[i], avoid[j]) < avoidD * avoidD) ok = false;
      if (ok) out.push(cands[i]);
    }
    return out;
  }

  /* Shared second half: entrances, doors, protest areas and police staging
   * for a finished grid g (W x H). doorC = candidate doors {x, y, hx, hy}. */
  function finish(pc, plazaR, shops, shopBlocks, doorC) {
    var i, k;
    /* crowd entrances: road runs on the map edge */
    var runs = [], x, y, s0;
    function edgeRuns(len, at, side) {
      s0 = -1;
      for (var t = 0; t <= len; t++) {
        var c = t < len ? at(t) : "#";
        if (c === "." && s0 < 0) s0 = t;
        if (c !== "." && s0 >= 0) { runs.push({ side: side, a: s0, n: t - s0 }); s0 = -1; }
      }
    }
    edgeRuns(H, function (t) { return get(0, t); }, "WEST");
    edgeRuns(H, function (t) { return get(W - 1, t); }, "EAST");
    edgeRuns(W, function (t) { return get(t, 0); }, "NORTH");
    edgeRuns(W, function (t) { return get(t, H - 1); }, "SOUTH");
    runs.sort(function (p, q) { return q.n - p.n; });
    runs = runs.slice(0, 5);
    var zones = [];
    for (i = 0; i < runs.length; i++) {
      var r = runs[i], z;
      if (r.side === "WEST") z = { x: 0, y: r.a, w: 3, h: r.n };
      else if (r.side === "EAST") z = { x: W - 3, y: r.a, w: 3, h: r.n };
      else if (r.side === "NORTH") z = { x: r.a, y: 0, w: r.n, h: 3 };
      else z = { x: r.a, y: H - 3, w: r.n, h: 3 };
      z.share = 1 / runs.length;
      z.name = r.side;
      zones.push(z);
    }

    var doors = spacedPick(shuffle(doorC), 90, 3, null, 0);

    /* protest areas: the plaza plus open junctions spread across the city */
    var junc = [];
    for (y = 2; y < H - 2; y++) for (x = 2; x < W - 2; x++) {
      if (get(x, y) !== ".") continue;
      var o = openness(x, y);
      if (o >= 15) junc.push({ x: x, y: y, o: o + R() * 3 });
      else if (o >= 11) junc.push({ x: x, y: y, o: o - 20 });   /* street spots, used when many areas are needed */
    }
    junc.sort(function (p, q) { return q.o - p.o; });
    var zoneAvoid = [pc];
    for (i = 0; i < zones.length; i++) zoneAvoid.push({ x: zones[i].x + zones[i].w / 2, y: zones[i].y + zones[i].h / 2 });
    /* bigger crowds spread over more protest areas (many streets fill up, not just a few) */
    var crowdN = (typeof LEVELS !== "undefined") ? LEVELS.current().crowdSize : 320;
    var want = Math.max(5, Math.min(15, Math.round(crowdN / 75)));
    var rc = spacedPick(junc, want, want > 8 ? 10 : 15, zoneAvoid, 9);
    if (rc.length < want) rc = rc.concat(spacedPick(junc, want - rc.length, 7, rc.concat(zoneAvoid), 7));
    /* landmarks (city hall, churches, statues...): the first protest areas gather in front of them */
    var siteList = pendingSites || [];
    pendingSites = null;
    if (typeof LANDMARKS !== "undefined") {
      /* LANDMARKS reads MAP: point it at the map being built for a moment */
      var keepM = [MAP.rows, MAP.width, MAP.height, MAP.sites], rows0 = [];
      for (y = 0; y < H; y++) rows0.push(g.slice(y * W, y * W + W).join(""));
      MAP.rows = rows0; MAP.width = W; MAP.height = H; MAP.sites = siteList.slice();
      if (!MAP.sites.length) LANDMARKS.autoPlace(null, { x: pc.x, y: pc.y, r: plazaR });
      var lp = LANDMARKS.rallyPoints();
      siteList = MAP.sites;
      MAP.rows = keepM[0]; MAP.width = keepM[1]; MAP.height = keepM[2]; MAP.sites = keepM[3];
      for (i = 0, k = 0; i < lp.length && k < rc.length; i++) {
        if (lp[i].type === "statue" && Math.abs(lp[i].x - pc.x) + Math.abs(lp[i].y - pc.y) < plazaR + 2) continue;   /* already the plaza */
        rc[k++] = { x: lp[i].x, y: lp[i].y, lm: lp[i].name };
      }
    }
    var rally = [{ x: pc.x, y: pc.y, r: plazaR, name: "PLAZA", plaza: true }];
    for (i = 0; i < rc.length; i++) rally.push({ x: rc[i].x, y: rc[i].y, r: want > 8 ? 6 : 5, name: "PROTEST " + String.fromCharCode(65 + i) + (rc[i].lm ? " - " + rc[i].lm : "") });
    for (i = 0; i < rally.length; i++) rally[i].tiles = area(rally[i].x, rally[i].y, rally[i].r);

    /* police staging: wide road tiles away from entrances and protest areas */
    var stage = [];
    for (y = 3; y < H - 3; y++) for (x = 3; x < W - 3; x++) {
      if (get(x, y) !== "." || get(x - 1, y) !== "." || get(x - 2, y) !== "." || get(x + 1, y) !== ".") continue;
      if (openness(x, y) < 12) continue;
      stage.push({ x: x, y: y, s: Math.abs(Math.sqrt(d2({ x: x, y: y }, pc)) - 18) + R() * 6 });
    }
    stage.sort(function (p, q) { return p.s - q.s; });
    var sAvoid = zoneAvoid.slice(1).concat(rc);
    /* up to 12 staging points: the planned force can have more than 6 squads */
    var centers = spacedPick(stage, 12, 4, sAvoid, 7);
    if (centers.length < 12) centers = centers.concat(spacedPick(stage, 12 - centers.length, 3, centers, 3));
    if (centers.length < 12) centers = centers.concat(spacedPick(stage, 12 - centers.length, 2, centers, 2));
    for (i = 0; i < centers.length; i++) centers[i] = { x: centers[i].x + 0.5, y: centers[i].y + 0.5 };

    var rows = [];
    for (y = 0; y < H; y++) rows.push(g.slice(y * W, y * W + W).join(""));
    return {
      rows: rows, sites: siteList, shops: shops, plazaCenter: pc, spawnZones: zones, doors: doors,
      rallyZones: rally, squadCenters: centers, shopBlocks: shopBlocks
    };
  }

  /* A real neighbourhood baked from OpenStreetMap (maps/*.js, REALMAPS). */
  function generateReal(seed, w, h) {
    var rm = REALMAPS[mapIdx], i, x, y;
    W = w; H = h; R = mulberry(seed ^ 0x27d4eb2f);
    g = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) g.push((rm.rows[y] || "").charAt(x) || "#");
    var doorC = [], dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      if (get(x, y) !== "#") continue;
      for (i = 0; i < 4; i++) {
        var ox = x + dirs[i][0], oy = y + dirs[i][1], c = get(ox, oy);
        if (c === "." || c === "a") { doorC.push({ x: ox, y: oy, hx: x, hy: y }); break; }
      }
    }
    var shops = [];
    for (i = 0; i < rm.shops.length; i++) shops.push({ id: rm.shops[i].id, name: rm.shops[i].name, x: rm.shops[i].x, y: rm.shops[i].y });
    pendingSites = rm.sites || [];
    var m = finish({ x: rm.plaza.x, y: rm.plaza.y }, rm.plaza.r, shops, [], doorC);
    /* Paris neighbourhoods get the Paris look */
    m.style = rm.id.indexOf("paris") === 0 ? "paris" : "real";
    m.decor = rm.decor; m.landmarks = []; m.river = null;
    m.realName = rm.name; m.attribution = rm.attribution;
    return m;
  }

  /* Which real map is played (REALMAPS index), saved between launches. */
  var mapIdx = 0;
  function maps() { return typeof REALMAPS !== "undefined" ? REALMAPS : []; }
  function setMap(id) {
    var l = maps();
    for (var i = 0; i < l.length; i++) if (l[i].id === id || i === id) mapIdx = i;
    try { localStorage.setItem("ppg_map", l[mapIdx].id); } catch (e1) { /* storage blocked */ }
    return l[mapIdx];
  }
  function nextMap(d) { var n = maps().length; return setMap((mapIdx + (d || 1) + n) % n); }
  function currentMap() { return maps()[mapIdx]; }
  try { var sm = localStorage.getItem("ppg_map"); if (sm) for (var mi = 0; mi < maps().length; mi++) if (maps()[mi].id === sm) mapIdx = mi; } catch (e0) { /* storage blocked */ }

  /* Replace the fixed map with a generated one and set the city-mode tuning. */
  function apply(seed) {
    var rm = currentMap();
    MAP.width = rm.w || 100; MAP.height = rm.h || 64;   /* real maps keep the size they were baked at */
    CONFIG.tileSize = 1600 / MAP.width;
    var m = generateReal(seed, MAP.width, MAP.height);
    MAP.realName = m.realName || null;
    MAP.attribution = m.attribution || null;
    MAP.style = m.style || "grid";
    MAP.decor = m.decor || null;
    MAP.landmarks = m.landmarks || null;
    MAP.sites = m.sites || [];
    MAP.river = m.river || null;
    MAP.seed = seed;
    MAP.rows = m.rows;
    MAP.shops = m.shops;
    MAP.plazaCenter = m.plazaCenter;
    MAP.doors = m.doors;
    MAP.crowdSpawn = m.spawnZones[0] || MAP.crowdSpawn;
    CONFIG.spawnZones = m.spawnZones;
    CONFIG.blockSites = [];
    CONFIG.rallyZones = m.rallyZones;
    CONFIG.squadCenters = m.squadCenters;
    CONFIG.deployMinX = 0;
    CONFIG.crowdSize = 320;
    CONFIG.rioterCount = 12;
    CONFIG.spawnTrickleSeconds = 110;   /* the crowd keeps arriving for this long */
    CONFIG.spawnAtStart = 0.3;          /* fraction already on the streets at the start */
    CONFIG.doorSpawnShare = 0.65;       /* the rest come in from the map edges */
    CONFIG.zoneSwitchChance = 0.35;     /* chance to march to another area when the stay ends */
    CONFIG.lootJoinChance = 0.25;       /* angry bystanders join in when a shop is smashed */
    CONFIG.crowdBlocksPolice = true;
    CONFIG.vehiclesBlock = true;        /* vehicles are solid; parked ones cut narrow streets */
    CONFIG.shopDefense = true;          /* glass grades, roller shutters, police deterrence */
    CONFIG.shopBreakSeconds = 15;       /* one rioter on plain open glass */
    CONFIG.nightCycle = true;           /* dusk falls partway through the match */
    CONFIG.agentSpeedMin = 1.0;         /* calmer walking in the city (tests keep the defaults) */
    CONFIG.agentSpeedMax = 1.25;
    CONFIG.wanderSpeed = 0.3;
    if (typeof LEVELS !== "undefined") { LEVELS.apply(); CONFIG._levelId = LEVELS.current().id; }
    if (typeof SETTINGS !== "undefined") SETTINGS.apply();   /* saved driving / day-night choices */
    if (typeof REINFORCE !== "undefined") REINFORCE.placeStation();   /* police station building */
    return m;
  }

  return { generateReal: generateReal, apply: apply, maps: maps, setMap: setMap, nextMap: nextMap, currentMap: currentMap };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = CityGen;
}
