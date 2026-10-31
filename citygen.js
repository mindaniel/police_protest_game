/* citygen.js - random city generator (browser only).
 * Builds a city-like street grid by recursive block splitting: wide avenues,
 * side streets that end in T-junctions, 1-tile alleys (some dead ends), a
 * plaza, a park and shopping strips. Writes MAP + the map-specific CONFIG
 * keys. Tests never load this file and keep using the fixed map in map.js.
 * CONFIG is read only inside apply() (game.js loads after this file).
 */
var CityGen = (function () {
  "use strict";

  var W = 0, H = 0, g = null, R = Math.random;

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
  function ri(a, b) { return a + Math.floor(R() * (b - a + 1)); }
  function get(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? "#" : g[y * W + x]; }
  function set(x, y, c) { if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = c; }
  function fill(x0, y0, w, h, c) {
    for (var y = y0; y < y0 + h; y++) for (var x = x0; x < x0 + w; x++) set(x, y, c);
  }
  function walk(c) { return c === "." || c === "P" || c === "G" || c === "a"; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(R() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function d2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  /* ---------- streets: recursive block splitting ---------- */
  var leaves;
  function split(x, y, w, h, depth) {
    var maxB = 13;
    if (w <= maxB && h <= maxB) { leaves.push({ x: x, y: y, w: w, h: h }); return; }
    var vert = w > h;
    if (w > maxB && h > maxB && Math.abs(w - h) < 5) vert = R() < 0.5;
    var sw = depth === 0 ? 3 : (depth === 1 ? (R() < 0.6 ? 3 : 2) : 2);
    var len = vert ? w : h;
    var lo = Math.max(5, Math.floor(len * 0.3)), hi = Math.min(len - 5 - sw, Math.ceil(len * 0.7) - sw);
    if (hi < lo) { leaves.push({ x: x, y: y, w: w, h: h }); return; }
    var p = ri(lo, hi);
    if (vert) {
      fill(x + p, y, sw, h, ".");
      split(x, y, p, h, depth + 1);
      split(x + p + sw, y, w - p - sw, h, depth + 1);
    } else {
      fill(x, y + p, w, sw, ".");
      split(x, y, w, p, depth + 1);
      split(x, y + p + sw, w, h - p - sw, depth + 1);
    }
  }

  /* Alleys inside a block: through-passages or dead ends, 1 tile wide. */
  function cutAlleys(b) {
    if (b.w >= 8 && R() < 0.6) {
      var ax = b.x + ri(3, b.w - 4);
      if (R() < 0.6) fill(ax, b.y, 1, b.h, "a");
      else if (R() < 0.5) fill(ax, b.y, 1, ri(2, b.h - 2), "a");
      else { var l = ri(2, b.h - 2); fill(ax, b.y + b.h - l, 1, l, "a"); }
    }
    if (b.h >= 8 && R() < 0.5) {
      var ay = b.y + ri(3, b.h - 4);
      if (R() < 0.5) fill(b.x, ay, b.w, 1, "a");
      else if (R() < 0.5) fill(b.x, ay, ri(2, b.w - 2), 1, "a");
      else { var l2 = ri(2, b.w - 2); fill(b.x + b.w - l2, ay, l2, 1, "a"); }
    }
  }

  /* Building tiles on a block's rim that face a road, walking round the rim. */
  function rimFacingRoad(b) {
    var out = [], x, y;
    for (x = b.x; x < b.x + b.w; x++) { if (get(x, b.y - 1) === ".") out.push({ x: x, y: b.y, ox: x, oy: b.y - 1, h: 1 }); }
    for (y = b.y; y < b.y + b.h; y++) { if (get(b.x + b.w, y) === ".") out.push({ x: b.x + b.w - 1, y: y, ox: b.x + b.w, oy: y, h: 0 }); }
    for (x = b.x + b.w - 1; x >= b.x; x--) { if (get(x, b.y + b.h) === ".") out.push({ x: x, y: b.y + b.h - 1, ox: x, oy: b.y + b.h, h: 1 }); }
    for (y = b.y + b.h - 1; y >= b.y; y--) { if (get(b.x - 1, y) === ".") out.push({ x: b.x, y: y, ox: b.x - 1, oy: y, h: 0 }); }
    return out;
  }

  /* Turn walkable pockets the plaza cannot reach (stray alley stubs) into buildings. */
  function fillUnreachable(from) {
    var seen = new Uint8Array(W * H), q = [from.y * W + from.x], h = 0, i;
    seen[q[0]] = 1;
    while (h < q.length) {
      var idx = q[h++], x = idx % W, y = (idx - x) / W;
      var nb = [idx - 1, idx + 1, idx - W, idx + W], ok = [x > 0, x < W - 1, y > 0, y < H - 1];
      for (i = 0; i < 4; i++) {
        if (ok[i] && !seen[nb[i]] && walk(g[nb[i]])) { seen[nb[i]] = 1; q.push(nb[i]); }
      }
    }
    for (i = 0; i < W * H; i++) if (!seen[i] && walk(g[i])) g[i] = "#";
  }

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

  var SHOP_NAMES = ["Pharmacy", "Phone Shop", "Bakery", "Jeweller", "Electronics", "Cafe", "Bank",
    "Supermarket", "Shoe Store", "Bookshop", "Fashion", "Hardware", "Opticians", "Sports", "Toys", "Kiosk"];
  var STREET_NAMES = ["Market St", "High St", "King St", "Mill Rd", "Bridge St", "Station Rd", "Church St", "Park Ln"];

  function generate(seed, w, h) {
    W = w; H = h; R = mulberry(seed);
    g = new Array(W * H);
    for (var i = 0; i < W * H; i++) g[i] = "#";
    leaves = [];
    split(0, 0, W, H, 0);

    var cx = W / 2, cy = H / 2, b, k;
    /* plaza: the biggest-enough block nearest the centre */
    var plaza = null, best = Infinity;
    for (i = 0; i < leaves.length; i++) {
      b = leaves[i];
      if (b.w < 9 || b.h < 8 || b.x < 3 || b.y < 3 || b.x + b.w > W - 3 || b.y + b.h > H - 3) continue;
      var dd = d2({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, { x: cx, y: cy });
      if (dd < best) { best = dd; plaza = b; }
    }
    if (!plaza) plaza = leaves[0];
    plaza.kind = "plaza";
    var pc = { x: plaza.x + Math.floor(plaza.w / 2), y: plaza.y + Math.floor(plaza.h / 2) };

    /* park: a large block far from the plaza; one small open square */
    var byFar = leaves.filter(function (q) { return !q.kind && q.w * q.h >= 56; })
      .sort(function (p, q) { return d2(q, pc) - d2(p, pc); });
    if (byFar.length) byFar[ri(0, Math.min(2, byFar.length - 1))].kind = "park";
    var mids = shuffle(leaves.filter(function (q) { return !q.kind && q.w >= 6 && q.h >= 6 && q.w * q.h <= 70; }));
    if (mids.length) mids[0].kind = "square";

    for (i = 0; i < leaves.length; i++) {
      b = leaves[i];
      if (b.kind === "plaza") fill(b.x, b.y, b.w, b.h, "P");
      else if (b.kind === "park") fill(b.x, b.y, b.w, b.h, "G");
      else if (b.kind === "square") fill(b.x, b.y, b.w, b.h, ".");
      else cutAlleys(b);
    }
    fillUnreachable(pc);

    /* shopping strips: a few blocks spread around the city */
    var shopBlocks = shuffle(leaves.filter(function (q) { return !q.kind && q.w * q.h >= 30; }));
    shopBlocks = spacedPick(shopBlocks, 4, 16, [pc], 7);
    var shops = [], sid = 1, names = shuffle(SHOP_NAMES.slice()), streets = shuffle(STREET_NAMES.slice());
    for (k = 0; k < shopBlocks.length; k++) {
      var rim = rimFacingRoad(shopBlocks[k]), placed = 0, skip = ri(0, 2);
      for (i = skip; i + 1 < rim.length && placed < 5; i++) {
        var t1 = rim[i], t2 = rim[i + 1];
        if (get(t1.x, t1.y) !== "#" || get(t2.x, t2.y) !== "#") continue;
        if (Math.abs(t1.x - t2.x) + Math.abs(t1.y - t2.y) !== 1) continue;
        set(t1.x, t1.y, "S"); set(t2.x, t2.y, "S");
        var tl = { x: Math.min(t1.x, t2.x), y: Math.min(t1.y, t2.y) };
        shops.push({ id: sid, name: names[(sid - 1) % names.length] + ", " + streets[k % streets.length], x: tl.x, y: tl.y });
        sid++; placed++;
        i += 2;   /* leave a gap between shop fronts */
      }
      shopBlocks[k].street = streets[k % streets.length];
    }

    /* doors: road/alley tiles in front of houses, spread out */
    var doorC = [];
    for (i = 0; i < leaves.length; i++) {
      b = leaves[i];
      if (b.kind) continue;
      var rr = rimFacingRoad(b);
      for (k = 0; k < rr.length; k++) if (get(rr[k].x, rr[k].y) === "#") doorC.push({ x: rr[k].ox, y: rr[k].oy, hx: rr[k].x, hy: rr[k].y });
    }
    return finish(pc, Math.max(plaza.w, plaza.h), shops, shopBlocks, doorC);
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
    }
    junc.sort(function (p, q) { return q.o - p.o; });
    var zoneAvoid = [pc];
    for (i = 0; i < zones.length; i++) zoneAvoid.push({ x: zones[i].x + zones[i].w / 2, y: zones[i].y + zones[i].h / 2 });
    var rc = spacedPick(junc, 5, 15, zoneAvoid, 9);
    var rally = [{ x: pc.x, y: pc.y, r: plazaR, name: "PLAZA", plaza: true }];
    for (i = 0; i < rc.length; i++) rally.push({ x: rc[i].x, y: rc[i].y, r: 5, name: "PROTEST " + String.fromCharCode(65 + i) });
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
    var centers = spacedPick(stage, 6, 4, sAvoid, 7);
    if (centers.length < 6) centers = centers.concat(spacedPick(stage, 6 - centers.length, 3, centers, 3));
    for (i = 0; i < centers.length; i++) centers[i] = { x: centers[i].x + 0.5, y: centers[i].y + 0.5 };

    var rows = [];
    for (y = 0; y < H; y++) rows.push(g.slice(y * W, y * W + W).join(""));
    return {
      rows: rows, shops: shops, plazaCenter: pc, spawnZones: zones, doors: doors,
      rallyZones: rally, squadCenters: centers, shopBlocks: shopBlocks
    };
  }

  /* Replace the fixed map with a generated one and set the city-mode tuning. */
  function apply(seed) {
    var m = generate(seed, MAP.width, MAP.height);
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
    if (typeof LEVELS !== "undefined") { LEVELS.apply(); CONFIG._levelId = LEVELS.current().id; }
    return m;
  }

  return { generate: generate, apply: apply };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = CityGen;
}
