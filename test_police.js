/* test_police.js - headless police simulation test */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function loadWorld() {
  var sandbox = { console: console, performance: { now: function () { return 0; } } };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  ["map.js", "game.js", "crowd.js", "police.js"].forEach(function (f) {
    var code = fs.readFileSync(path.join(__dirname, f), "utf8");
    vm.runInContext(code, sandbox, { filename: f });
  });
  return sandbox;
}

var world = loadWorld();
var MAP = world.MAP;
var CONFIG = world.CONFIG;
var Crowd = world.Crowd;
var Police = world.Police;

console.log("map: " + MAP.width + "x" + MAP.height + " tiles");
console.log("CONFIG.crowdSize=" + CONFIG.crowdSize + " CONFIG.rioterCount=" + CONFIG.rioterCount);
console.log("");

/* --- A. Direct command tests --- */
var G1 = world.makeG();
Crowd.init(G1);
Crowd.rebuildFlow(G1);
Police.init(G1);

console.log("=== Direct Command Tests ===");

// 1. placeBarrier on solid tile ('#' at 0,0)
var res1 = Police.placeBarrier(G1, 0, 0, 2);
console.log("1. placeBarrier on solid tile: " + (res1 === false ? "PASS" : "FAIL"));

// 2. placeBarrier on road tile up to the selected squad's truck stock
var roadX = 4, roadY = 31;
var placed = 0;
var stock2 = CONFIG.barriersPerTruck;
for (var i = 0; i < stock2 + 1; i++) {
  if (Police.placeBarrier(G1, roadX + i, roadY, 2)) {
    placed++;
  }
}
var extraBarrier = Police.placeBarrier(G1, roadX + stock2 + 1, roadY, 2);
console.log("2. placeBarrier up to truck stock (" + stock2 + "): " + (placed === stock2 && extraBarrier === false ? "PASS" : "FAIL"));

// 3. loudspeaker cooldown
var res3a = Police.loudspeaker(G1, 30, 20, 0);
var res3b = Police.loudspeaker(G1, 30, 20, 0);
G1.time += CONFIG.loudspeakerCooldown + 1;
var res3c = Police.loudspeaker(G1, 30, 20, 0);
console.log("3. loudspeaker cooldown: " + (res3a === true && res3b === false && res3c === true ? "PASS" : "FAIL"));

// 4. G.officers.length matches the default loadouts (motorbike squads have 2)
var expectedOfficers = 0;
for (var li = 0; li < G1.squadLoadouts.length; li++) {
  expectedOfficers += (G1.squadLoadouts[li] === "motorbike") ? 2 : CONFIG.officersPerSquad;
}
console.log("4. G.officers.length == " + expectedOfficers + " (matches loadouts): " + (G1.officers.length === expectedOfficers ? "PASS" : "FAIL"));

// 5. homeX/homeY set by moveSquad
var G5 = world.makeG();
Crowd.init(G5);
Crowd.rebuildFlow(G5);
Police.init(G5);
Police.moveSquad(G5, 0, 33, 19);
var homeXOk = true, homeYOk = true;
for (var i = 0; i < G5.officers.length; i++) {
  if (G5.officers[i].squad === 0) {
    if (G5.officers[i].homeX !== 33) homeXOk = false;
    if (G5.officers[i].homeY !== 19) homeYOk = false;
  }
}
console.log("5. moveSquad sets homeX/homeY: " + (homeXOk && homeYOk ? "PASS" : "FAIL"));

console.log("");

/* --- B. Autopilot scenario (120 s) --- */
var G2 = world.makeG();
Crowd.init(G2);
Crowd.rebuildFlow(G2);
Police.init(G2);

// Place 2 barriers at start on road tiles away from plaza
Police.placeBarrier(G2, 5, 19, 2);
Police.placeBarrier(G2, 6, 19, 2);

// Move squads toward plaza (plaza center is 33, 19)
for (var s = 0; s < CONFIG.squadCount; s++) {
  Police.moveSquad(G2, s, 33, 19);
}

var dt = 1 / 30;
var steps = Math.round(120 / dt);
var moods = {};
var maxSuspicion = 0;

moods[0] = Crowd.averageMood(G2);

for (var i = 1; i <= steps; i++) {
  Crowd.update(G2, dt);
  Police.update(G2, dt);
  
  var tNow = Math.round(i * dt);
  if ((tNow === 60 || tNow === 120) && moods[tNow] === undefined) {
    moods[tNow] = Crowd.averageMood(G2);
  }
  
  for (var j = 0; j < G2.agents.length; j++) {
    if (G2.agents[j].active && G2.agents[j].suspicion > maxSuspicion) {
      maxSuspicion = G2.agents[j].suspicion;
    }
  }
  
  if (G2.time >= G2.loudspeakerReadyAt) {
    Police.loudspeaker(G2, 33, 19);
  }
}

console.log("=== Autopilot Scenario (120 s) ===");
console.log("officers created: " + G2.officers.length);
console.log("rioters arrested: " + G2.stats.rioterArrested);
console.log("wrong arrests: " + G2.stats.wrongArrests);
console.log("shops broken: " + G2.stats.shopsDamaged + "/" + G2.shops.length);
console.log("barriers placed: " + G2.barriers.length);
console.log("average mood @0s: " + moods[0].toFixed(2));
console.log("average mood @60s: " + (moods[60] !== undefined ? moods[60].toFixed(2) : "n/a"));
console.log("average mood @120s: " + (moods[120] !== undefined ? moods[120].toFixed(2) : "n/a"));
console.log("max suspicion seen: " + maxSuspicion.toFixed(2));
console.log("G.over: " + G2.over);
console.log("");

/* --- C. Match end test (310 s) --- */
var G3 = world.makeG();
Crowd.init(G3);
Crowd.rebuildFlow(G3);
Police.init(G3);

var dt3 = 1 / 10;
var steps3 = Math.round(310 / dt3);
for (var i = 1; i <= steps3; i++) {
  Crowd.update(G3, dt3);
  Police.update(G3, dt3);
}

console.log("=== Match End Test (310 s) ===");
console.log("G.over: " + G3.over);
console.log("G.endReason: " + G3.endReason);

/* --- B. Planning / formation / vehicle tests --- */
var G6 = world.makeG();
Crowd.init(G6);
Crowd.rebuildFlow(G6);
Police.init(G6);
console.log("");
console.log("=== Planning, Formation and Vehicle Tests ===");
var seenPos = {}, distinct = 0;
G6.officers.forEach(function (o) {
  var pk = o.x.toFixed(2) + "," + o.y.toFixed(2);
  if (!seenPos[pk]) { seenPos[pk] = 1; distinct++; }
});
console.log("6. officers start at distinct positions: " + (distinct === G6.officers.length ? "PASS" : "FAIL"));
console.log("7. vehicles created (car, watertruck, barriertruck): " + (G6.vehicles.length === 3 && G6.vehicles[0].type === "car" && G6.vehicles[1].type === "watertruck" && G6.vehicles[2].type === "barriertruck" ? "PASS" : "FAIL"));
console.log("8. canDeploy rejects building and crowd entry, accepts street: " + (!Police.canDeploy(G6, 5, 5) && !Police.canDeploy(G6, 2, 31) && Police.canDeploy(G6, 12, 31) ? "PASS" : "FAIL"));
var okDep = Police.deploySquad(G6, 0, 12.5, 31.5);
var badDep = Police.deploySquad(G6, 0, 5.5, 5.5);
var o0 = G6.officers[0];
console.log("9. deploySquad moves squad and its car: " + (okDep === true && badDep === false && o0.homeX === 12.5 && Math.abs(o0.x - 12.5) < 1 && Math.abs(G6.vehicles[0].tx - 12.5) < 0.001 ? "PASS" : "FAIL"));
Police.deploySquad(G6, 1, 14.5, 31.5);
var wFar = Police.waterCannon(G6, 55, 31, 1);
var wOk = Police.waterCannon(G6, 14.5, 31.5, 1);
var wCd = Police.waterCannon(G6, 14.5, 31.5, 1);
console.log("10. waterCannon range/ok/cooldown (" + wFar + "," + wOk + "," + wCd + "): " + (wFar === "range" && wOk === "ok" && wCd === "cooldown" ? "PASS" : "FAIL"));


/* --- C. Barriers do not block police --- */
var G7 = world.makeG();
Crowd.init(G7);
Crowd.rebuildFlow(G7);
Police.init(G7);
console.log("");
console.log("=== Barrier vs Police Test ===");
var placedB = Police.placeBarrier(G7, 20, 31, 2);
var walkB = Police.isWalkable(G7, 20, 31);
var crowdBlockedB = G7.blocked.has("20,31");
Police.moveSquad(G7, 2, 20.5, 31.5);
for (var q = 0; q < 200; q++) { G7.time += 0.05; Police.update(G7, 0.05); }
var o7 = G7.officers[8];
console.log("11. barrier placed, tile still blocked for crowd, walkable for police: " + (placedB === true && crowdBlockedB === true && walkB === true ? "PASS" : "FAIL"));
console.log("12. squad 3 can walk onto the barrier tile (officer at " + o7.x.toFixed(2) + "," + o7.y.toFixed(2) + "): " + (Math.abs(o7.x - 20.5) < 1.2 && Math.abs(o7.y - 31.5) < 1.2 ? "PASS" : "FAIL"));


/* --- D. Several crowd entrances --- */
var G8 = world.makeG();
Crowd.init(G8);
console.log("");
console.log("=== Crowd Entrance Tests ===");
var zcount = CONFIG.spawnZones.map(function () { return 0; });
var solidAgents = 0, outside = 0;
G8.agents.forEach(function (a) {
  var ax = Math.floor(a.x), ay = Math.floor(a.y);
  var ch = MAP.rows[ay].charAt(ax);
  if (ch === "#" || ch === "S") solidAgents++;
  var inZ = -1;
  CONFIG.spawnZones.forEach(function (z, zi) {
    if (ax >= z.x && ax < z.x + z.w && ay >= z.y && ay < z.y + z.h) inZ = zi;
  });
  if (inZ < 0) outside++; else zcount[inZ]++;
});
console.log("agents per zone: " + zcount.join(", "));
console.log("13. all " + G8.agents.length + " agents inside a zone, none on solid tiles: " + (outside === 0 && solidAgents === 0 && G8.agents.length === CONFIG.crowdSize ? "PASS" : "FAIL"));
console.log("14. every zone has at least 20 agents: " + (Math.min.apply(null, zcount) >= 20 ? "PASS" : "FAIL"));
var G9 = world.makeG();
Crowd.init(G9); Crowd.rebuildFlow(G9); Police.init(G9);
console.log("15. canDeploy rejects tiles next to entrances, still accepts mid street: " + (!Police.canDeploy(G9, 19, 1) && !Police.canDeploy(G9, 97, 31) && !Police.canDeploy(G9, 71, 61) && Police.canDeploy(G9, 24, 31) ? "PASS" : "FAIL"));
var reach = 0;
G9.agents.forEach(function (a) {
  var f = G9.flow[Math.floor(a.y) * MAP.width + Math.floor(a.x)];
  if (f !== undefined && f >= 0 && f < 9999) reach++;
});
console.log("16. every agent starts on a tile with a path to the plaza (" + reach + "/" + G9.agents.length + "): " + (reach === G9.agents.length ? "PASS" : "FAIL"));


/* --- E. Street blockades --- */
console.log("");
console.log("=== Blockade Tests ===");
var G10 = world.makeG();
Crowd.init(G10); Crowd.rebuildFlow(G10); Police.init(G10);
var peacefulN = G10.agents.filter(function (a) { return a.role === "peaceful"; }).length;
var assignedN = G10.agents.filter(function (a) { return a.role === "peaceful" && a._site >= 0; }).length;
var siteOk = CONFIG.blockSites.every(function (s) {
  var n = 0;
  for (var y = s.y; y < s.y + s.h; y++) for (var x = s.x; x < s.x + s.w; x++) {
    var ch = MAP.rows[y].charAt(x);
    if (ch !== "#" && ch !== "S") n++;
  }
  return n === s.w * s.h;
});
console.log("17. all blockade sites are fully on walkable tiles: " + (siteOk ? "PASS" : "FAIL"));
console.log("18. most peaceful agents assigned a site (" + assignedN + "/" + peacefulN + "): " + (assignedN >= peacefulN * 0.55 && assignedN <= peacefulN * 0.95 ? "PASS" : "FAIL"));
for (var t19 = 0; t19 < 1800; t19++) { G10.time += 0.05; Crowd.update(G10, 0.05); }
var atSite = 0, peacefulAlive = 0, perSite = CONFIG.blockSites.map(function () { return 0; });
G10.agents.forEach(function (a) {
  if (!a.active || a.role !== "peaceful") return;
  peacefulAlive++;
  CONFIG.blockSites.forEach(function (s, si) {
    var dx = Math.max(s.x - a.x, 0, a.x - (s.x + s.w)), dy = Math.max(s.y - a.y, 0, a.y - (s.y + s.h));
    if (Math.sqrt(dx * dx + dy * dy) <= 4) { atSite++; perSite[si]++; }
  });
});
console.log("agents within 4 tiles of each site after 90 s: " + perSite.join(", "));
console.log("19. at least 45% of peaceful agents stand at a site after 90 s (" + atSite + "/" + peacefulAlive + "): " + (atSite >= peacefulAlive * 0.45 ? "PASS" : "FAIL"));
var s0 = CONFIG.blockSites[0];
for (var by = s0.y; by < s0.y + s0.h; by++) for (var bx = s0.x; bx < s0.x + s0.w; bx++) G10.blocked.add(bx + "," + by);
Crowd.rebuildFlow(G10);
for (var t20 = 0; t20 < 20; t20++) { G10.time += 0.05; Crowd.update(G10, 0.05); }
var stuckOn0 = G10.agents.filter(function (a) { return a.active && a.role === "peaceful" && a._site === 0; }).length;
console.log("20. after site 0 is walled off nobody keeps it as target (" + stuckOn0 + " left): " + (stuckOn0 === 0 ? "PASS" : "FAIL"));


/* --- F. Broken-shop mood ceiling --- */
console.log("");
console.log("=== Mood Ceiling Test ===");
var G11 = world.makeG();
Crowd.init(G11); Crowd.rebuildFlow(G11); Police.init(G11);
for (var t21 = 0; t21 < 3000; t21++) { G11.time += 0.05; Crowd.update(G11, 0.05); Police.update(G11, 0.05); }
var rioters21 = G11.agents.filter(function (a) { return a.active && a.role === "rioter"; }).length;
var peaceful21 = G11.agents.filter(function (a) { return a.active && a.role === "peaceful"; });
var hi21 = peaceful21.filter(function (a) { return a.mood >= CONFIG.radicalMood; }).length;
console.log("rioters at 150 s: " + rioters21 + ", peaceful with mood>=90: " + hi21 + ", average mood: " + Crowd.averageMood(G11).toFixed(1));
console.log("21. fewer than 30 rioters at 150 s (was 53 before the cap): " + (rioters21 < 30 ? "PASS" : "FAIL"));
var capOk = (CONFIG.moodBrokenShopCap === 66);
console.log("22. moodBrokenShopCap is 66: " + (capOk ? "PASS" : "FAIL"));


/* --- G. Arrest anger tests --- */
console.log("");
console.log("=== Arrest Anger Tests ===");

/* Fresh world with no officers and every spawned agent switched off, so the
 * only crowd members are the ones a test adds itself. */
function angerWorld() {
  var G = world.makeG();
  Crowd.init(G);
  Crowd.rebuildFlow(G);
  Police.init(G);
  G.officers = [];
  G._angers = [];
  for (var i = 0; i < G.agents.length; i++) G.agents[i].active = false;
  return G;
}

/* Hand-placed crowd member: speed 0 and no blockade site, so it stays put. */
function angerAgent(G, role, x, y, mood) {
  var a = {
    id: G.agents.length, x: x, y: y, vx: 0, vy: 0,
    mood: mood, role: role, suspicion: 0, revealedUntil: 0,
    arrested: false, active: true, hasTool: false, state: "march",
    speed: 0, _flow: null, _targetShop: null, _wanderT: 0, _wanderA: 0,
    _highMoodTime: 0, _blocked: false, _fleeUntil: 0, _throwCd: 0, _site: -1
  };
  G.agents.push(a);
  return a;
}

function angerRun(G, seconds, dt) {
  dt = dt || 0.05;
  var n = Math.round(seconds / dt);
  for (var i = 0; i < n; i++) Crowd.update(G, dt);
}

/* 23. a normal arrest angers peaceful agents inside 6 tiles but spares agents
 *     farther away, and the anger alone never pushes them past arrestAngerCap. */
var G23 = angerWorld();
var R23 = angerAgent(G23, "rioter", 25.5, 31.5, 30);
var near23 = angerAgent(G23, "peaceful", 20.5, 31.5, 30);   /* 5 tiles away */
var far23 = angerAgent(G23, "peaceful", 18.5, 31.5, 30);    /* 7 tiles away */
Crowd.update(G23, 0);                                       /* refresh the hash for the new agents */
Crowd.arrest(G23, R23);
angerRun(G23, 5);
var nearRose = (near23.mood > 30 + 5);
var nearCapped = (near23.mood <= CONFIG.arrestAngerCap + 0.001);
var farFlat = (far23.mood <= 30 + 0.001);
console.log("near (5 tiles) mood 30 -> " + near23.mood.toFixed(1) + ", far (7 tiles) mood 30 -> " + far23.mood.toFixed(1) + ", cap " + CONFIG.arrestAngerCap);
console.log("23. normal arrest angers agents within 6 tiles, capped at " + CONFIG.arrestAngerCap + ", far agents untouched: " + (nearRose && nearCapped && farFlat ? "PASS" : "FAIL"));

/* 24. a wrong arrest angers nearby agents faster and higher than a normal one
 *     in the same setup, and stays at or below wrongArrestAngerCap. */
function angerScenario(wrong) {
  var G = angerWorld();
  var target = angerAgent(G, wrong ? "peaceful" : "rioter", 25.5, 18.5, 30);
  var witness = angerAgent(G, "peaceful", 21.5, 18.5, 30);  /* 4 tiles away */
  Crowd.update(G, 0);
  Crowd.arrest(G, target);
  angerRun(G, 3);
  return witness.mood;
}
var normal24 = angerScenario(false);
var wrong24 = angerScenario(true);
console.log("witness mood after 3 s - normal arrest: " + normal24.toFixed(1) + ", wrong arrest: " + wrong24.toFixed(1) + ", cap " + CONFIG.wrongArrestAngerCap);
console.log("24. wrong arrest angers faster and higher, capped at " + CONFIG.wrongArrestAngerCap + ": " + (wrong24 > normal24 + 5 && wrong24 <= CONFIG.wrongArrestAngerCap + 0.001 ? "PASS" : "FAIL"));

/* 25. the anger event expires after arrestAngerSeconds, the mood push stops,
 *     and stale events are pruned the next time an arrest is recorded. */
var G25 = angerWorld();
var R25 = angerAgent(G25, "rioter", 25.5, 18.5, 30);
var A25 = angerAgent(G25, "peaceful", 21.5, 18.5, 30);
Crowd.update(G25, 0);
Crowd.arrest(G25, R25);
var ev25 = G25._angers[0];
var evOk = (G25._angers.length === 1 && !!ev25 &&
            Math.abs(ev25.until - (G25.time + CONFIG.arrestAngerSeconds)) < 0.001 &&
            ev25.wrong === false);
var start25 = A25.mood;
angerRun(G25, 2);
var rose25 = (A25.mood > start25 + 2);
var peak25 = A25.mood;
angerRun(G25, 15);                                          /* now past the 15 s lifetime */
var expired25 = (ev25.until <= G25.time);
var before25 = A25.mood;
angerRun(G25, 2);
var stopped25 = (A25.mood <= before25 + 0.001);
angerAgent(G25, "rioter", 21.5, 20.5, 30);
Crowd.update(G25, 0);
Crowd.arrest(G25, G25.agents[G25.agents.length - 1]);        /* prune + record a new event */
var stale25 = G25._angers.filter(function (e) { return e.until <= G25.time; }).length;
console.log("event until t=" + ev25.until.toFixed(2) + ", mood 30 -> " + peak25.toFixed(1) + " after 2 s -> " + before25.toFixed(1) + " after " + G25.time.toFixed(1) + " s, after expiry " + A25.mood.toFixed(1) + ", stale events left: " + stale25);
console.log("25. arrest anger expires after " + CONFIG.arrestAngerSeconds + " s, stops pushing mood and is pruned: " + (evOk && rose25 && expired25 && stopped25 && stale25 === 0 ? "PASS" : "FAIL"));


/* --- H. Six squads, loadouts, per-squad tools and speeds --- */
console.log("");
console.log("=== Loadout and Squad Tests ===");

/* 26. six squads exist, the officer count matches the default loadouts, every
 *     officer starts on a walkable tile and no two share a position. */
var G26 = world.makeG();
Crowd.init(G26); Crowd.rebuildFlow(G26); Police.init(G26);
var squads26 = {};
G26.officers.forEach(function (o) { squads26[o.squad] = true; });
var squadCount26 = Object.keys(squads26).length;
var expected26 = 0;
G26.squadLoadouts.forEach(function (name) { expected26 += (name === "motorbike") ? 2 : CONFIG.officersPerSquad; });
var walk26 = true, unique26 = true, seen26 = {};
G26.officers.forEach(function (o) {
  var pk = o.x.toFixed(3) + "," + o.y.toFixed(3);
  if (seen26[pk]) unique26 = false;
  seen26[pk] = true;
  if (!Police.isWalkable(G26, Math.floor(o.x), Math.floor(o.y))) walk26 = false;
});
console.log("26. " + squadCount26 + " squads, " + G26.officers.length + " officers (expected " + expected26 + "), all on walkable tiles, no shared positions: " +
  (squadCount26 === 6 && CONFIG.squadCount === 6 && G26.officers.length === expected26 && G26.officers.length <= 24 && walk26 && unique26 ? "PASS" : "FAIL"));

/* 27. setLoadout refuses a loadout that would exceed the budget and accepts
 *     one that fits. */
var G27 = world.makeG();
Crowd.init(G27); Crowd.rebuildFlow(G27); Police.init(G27);
var over27 = Police.setLoadout(G27, 4, "watertruck");
Police.setLoadout(G27, 0, "none");
var within27 = Police.setLoadout(G27, 4, "car");
console.log("27. setLoadout refuses over budget (" + over27 + ") and accepts within budget (" + within27 + "): " +
  (over27 === false && within27 === true ? "PASS" : "FAIL"));

/* 28. barrier placement needs the selected squad's barrier truck and eats into
 *     that truck's stock. */
var G28 = world.makeG();
Crowd.init(G28); Crowd.rebuildFlow(G28); Police.init(G28);
var noTruck28 = Police.placeBarrier(G28, 20, 18, 4);
var before28 = Police.barrierStock(G28, 2);
var withTruck28 = Police.placeBarrier(G28, 21, 18, 2);
var after28 = Police.barrierStock(G28, 2);
console.log("28. barrier refused without a barrier truck, accepted with one, stock " + before28 + " -> " + after28 + ": " +
  (noTruck28 === false && withTruck28 === true && before28 === CONFIG.barriersPerTruck && after28 === before28 - 1 ? "PASS" : "FAIL"));

/* 29. the water cannon needs the selected squad's own water truck. */
var G29 = world.makeG();
Crowd.init(G29); Crowd.rebuildFlow(G29); Police.init(G29);
var noTruck29 = Police.waterCannon(G29, 20, 18, 0);
Police.deploySquad(G29, 1, 20.5, 18.5);
var withTruck29 = Police.waterCannon(G29, 20.5, 19.5, 1);
console.log("29. water cannon refused without a truck (" + noTruck29 + "), works with one (" + withTruck29 + "): " +
  (noTruck29 === "none" && withTruck29 === "ok" ? "PASS" : "FAIL"));

/* 30. a motorbike squad covers more ground than a foot squad in 5 simulated
 *     seconds. */
var G30 = world.makeG();
Crowd.init(G30); Crowd.rebuildFlow(G30); Police.init(G30);
for (var a30 = 0; a30 < G30.agents.length; a30++) G30.agents[a30].active = false;
G30.officers.forEach(function (o) {
  o.x = 10 + o.ox; o.y = 31.5 + o.oy;
  o.homeX = 10; o.homeY = 31.5;
  o.tx = 30; o.ty = 31.5;
});
for (var t30 = 0; t30 < 100; t30++) {
  G30.time += 0.05;
  Police.update(G30, 0.05);
}
var moto30 = null, foot30 = null;
G30.officers.forEach(function (o) {
  if (o.squad === 3 && !moto30) moto30 = o;
  if (o.squad === 0 && !foot30) foot30 = o;
});
var motoDist30 = moto30 ? Math.abs(moto30.x - 10) : 0;
var footDist30 = foot30 ? Math.abs(foot30.x - 10) : 0;
console.log("30. motorbike squad moved " + motoDist30.toFixed(2) + " tiles vs foot " + footDist30.toFixed(2) + " in 5 s: " +
  (motoDist30 > footDist30 + 1 ? "PASS" : "FAIL"));

/* 31. suspicion comes from visible violence only: a recently violent rioter
 *     inside the observation radius gains suspicion, a merely agitated
 *     high-mood peaceful agent gains none, over 5 simulated seconds. */
var G31 = world.makeG();
Crowd.init(G31); Crowd.rebuildFlow(G31); Police.init(G31);
for (var i31 = 0; i31 < G31.agents.length; i31++) G31.agents[i31].active = false;
var off31 = G31.officers[0];
var ri31 = angerAgent(G31, "rioter", off31.x + 1, off31.y, 30);
ri31.violentUntil = 5;
var pe31 = angerAgent(G31, "peaceful", off31.x - 1, off31.y, 90);
pe31.state = "agitated";
Crowd.update(G31, 0);
for (var t31 = 0; t31 < 100; t31++) {
  G31.time += 0.05;
  Police.update(G31, 0.05);
}
console.log("31. violent rioter suspicion " + ri31.suspicion.toFixed(1) + ", agitated peaceful suspicion " + pe31.suspicion.toFixed(1) + ": " +
  (ri31.suspicion > 20 && pe31.suspicion < 1 ? "PASS" : "FAIL"));

/* 32. stamina-limited running: a rioter in attackShop loses stamina over 5 s
 *     and covers more ground than a calm walker; an agent with 0 stamina
 *     moves at walk speed; walking agents regenerate stamina. */
var G32 = world.makeG();
Crowd.init(G32); Crowd.rebuildFlow(G32); Police.init(G32);
for (var i32 = 0; i32 < G32.agents.length; i32++) G32.agents[i32].active = false;
function runnerAgent(role, state, x, y, speed, stamina, exhausted) {
  var a = angerAgent(G32, role, x, y, 30);
  a.state = state; a.speed = speed; a.stamina = stamina; a._exhausted = !!exhausted;
  a._flow = G32.flow;
  return a;
}
/* rioter hunting a shop far to the east along the boulevard */
var run32 = runnerAgent("rioter", "attackShop", 12.5, 31.5, 1.2, 100, false);
run32._targetShop = { x: 39, y: 11, hp: 100, broken: false };
run32._flow = G32.flow;
/* calm walker covering the same stretch */
var walk32 = runnerAgent("peaceful", "march", 12.5, 31.5, 1.2, 100, false);
var startRun32 = run32.x, startWalk32 = walk32.x, startStam32 = run32.stamina;
var dt32 = 0.05, steps32 = Math.round(5 / dt32);
for (var t32 = 0; t32 < steps32; t32++) {
  G32.time += dt32;
  Crowd.update(G32, dt32);
  if (t32 === 20) { run32.state = "attackShop"; run32._flow = G32.flow; }
}
var runDist32 = Math.abs(run32.x - startRun32) + Math.abs(run32.y - 31.5) * 0;
var walkDist32 = Math.abs(walk32.x - startWalk32);
var lostStamina32 = run32.stamina < startStam32;
/* exhausted agent: stamina 0, must move at walk speed */
var G32b = world.makeG();
Crowd.init(G32b); Crowd.rebuildFlow(G32b); Police.init(G32b);
for (var i32b = 0; i32b < G32b.agents.length; i32b++) G32b.agents[i32b].active = false;
var ex32 = angerAgent(G32b, "rioter", 12.5, 31.5, 30);
ex32.state = "attackShop"; ex32.speed = 1.35; ex32.stamina = 0; ex32._exhausted = true;
ex32._targetShop = { x: 39, y: 11, hp: 100, broken: false };
ex32._flow = G32b.flow;
var exStart32 = ex32.x;
for (var t32b = 0; t32b < 20; t32b++) { G32b.time += dt32; Crowd.update(G32b, dt32); ex32.state = "attackShop"; ex32._targetShop = { x: 39, y: 11, hp: 100, broken: false }; ex32._flow = G32b.flow; }
var exSpeed32 = Math.abs(ex32.x - exStart32) / (20 * dt32);
/* regen: a walking agent with low stamina recovers */
var regen32 = angerAgent(G32b, "peaceful", 50.5, 23.5, 30);
regen32.state = "march"; regen32.stamina = 40; regen32._exhausted = true;
var beforeRegen32 = regen32.stamina;
for (var t32c = 0; t32c < 20; t32c++) { G32b.time += dt32; Crowd.update(G32b, dt32); }
var regenOk32 = regen32.stamina > beforeRegen32;
console.log("32. attackShop rioter moved " + runDist32.toFixed(2) + " vs walker " + walkDist32.toFixed(2) + " in 5 s, stamina " + startStam32 + " -> " + run32.stamina.toFixed(1) + "; exhausted speed " + exSpeed32.toFixed(2) + " t/s (walk max " + CONFIG.agentSpeedMax + "); regen " + beforeRegen32 + " -> " + regen32.stamina.toFixed(1) + ": " +
  (runDist32 > walkDist32 + 0.5 && lostStamina32 && exSpeed32 <= CONFIG.agentSpeedMax + 0.05 && exSpeed32 > 0 && regenOk32 ? "PASS" : "FAIL"));

/* 33. officer stamina: a run-flagged foot squad covers more ground than a
 *     walking one over 5 s and loses stamina; once exhausted it returns to
 *     baseSpeed; a motorbike squad keeps full stamina and its own speed. */
function squadFoot(G, s) { return G.officers.filter(function (o) { return o.squad === s; }); }
function runSquad(G, s, x, y, runFlag, seconds) {
  Police.moveSquad(G, s, x, y, runFlag);
  var steps = Math.round(seconds / 0.05);
  for (var t = 0; t < steps; t++) { G.time += 0.05; Police.update(G, 0.05); }
}
var G33 = world.makeG();
Crowd.init(G33); Crowd.rebuildFlow(G33); Police.init(G33);
for (var i33 = 0; i33 < G33.agents.length; i33++) G33.agents[i33].active = false;
var foot33 = squadFoot(G33, 4);
var startX33 = foot33[0].x;
runSquad(G33, 4, 45.5, 31.5, true, 5);
var runDist33 = Math.abs(foot33[0].x - startX33);
var stam33 = foot33[0].stamina;
var G33b = world.makeG();
Crowd.init(G33b); Crowd.rebuildFlow(G33b); Police.init(G33b);
for (var i33b = 0; i33b < G33b.agents.length; i33b++) G33b.agents[i33b].active = false;
var foot33b = squadFoot(G33b, 4);
var startX33b = foot33b[0].x;
runSquad(G33b, 4, 45.5, 31.5, false, 5);
var walkDist33 = Math.abs(foot33b[0].x - startX33b);
/* exhausted squad: drop stamina to 0, it must fall back to baseSpeed */
var G33c = world.makeG();
Crowd.init(G33c); Crowd.rebuildFlow(G33c); Police.init(G33c);
for (var i33c = 0; i33c < G33c.agents.length; i33c++) G33c.agents[i33c].active = false;
var foot33c = squadFoot(G33c, 4);
for (var k33 = 0; k33 < foot33c.length; k33++) { foot33c[k33].stamina = 0; foot33c[k33]._exhausted = true; }
Police.moveSquad(G33c, 4, 45.5, 31.5, true);
var exStart33 = foot33c[0].x;
for (var t33 = 0; t33 < 20; t33++) { G33c.time += 0.05; Police.update(G33c, 0.05); }
var exSpeed33 = Math.abs(foot33c[0].x - exStart33) / (20 * 0.05);
/* motorbike squad (4) must ignore stamina and keep motorbikeSpeed */
var G33d = world.makeG();
Crowd.init(G33d); Crowd.rebuildFlow(G33d); Police.init(G33d);
for (var i33d = 0; i33d < G33d.agents.length; i33d++) G33d.agents[i33d].active = false;
var bike33 = squadFoot(G33d, 3);
var bikeStam33 = bike33[0].stamina;
Police.moveSquad(G33d, 3, 45.5, 31.5, true);
for (var t33b = 0; t33b < 20; t33b++) { G33d.time += 0.05; Police.update(G33d, 0.05); }
var bikeStamAfter33 = bike33[0].stamina;
var bikeSpeed33 = bike33[0].baseSpeed;
console.log("33. run squad moved " + runDist33.toFixed(2) + " vs walk " + walkDist33.toFixed(2) + " in 5 s, stamina " + stam33.toFixed(1) + "; exhausted speed " + exSpeed33.toFixed(2) + " t/s (base " + CONFIG.officerSpeed + "); motorbike stam " + bikeStam33 + " -> " + bikeStamAfter33 + " baseSpeed " + bikeSpeed33 + ": " +
  (runDist33 > walkDist33 + 0.5 && stam33 < 100 && exSpeed33 <= CONFIG.officerSpeed + 0.15 && exSpeed33 > 0 && bikeStamAfter33 === 100 && bikeSpeed33 === CONFIG.motorbikeSpeed ? "PASS" : "FAIL"));

console.log("");
console.log("=== Water Cannon Push Test ===");
var G34 = world.makeG();
Crowd.init(G34); Crowd.rebuildFlow(G34); Police.init(G34);
for (var i34 = 0; i34 < G34.agents.length; i34++) G34.agents[i34].active = false;
var truckX34 = 40.5, truckY34 = 31.5, impactX34 = 36.5, impactY34 = 31.5;
var start34 = [];
for (var k34 = 0; k34 < 10; k34++) {
  var a34 = G34.agents[k34];
  a34.active = true;
  a34.x = 35.5 + 0.5 * (k34 % 5);
  a34.y = (k34 < 5) ? 30.5 : 31.5;
  a34.mood = 30; a34.speed = 0; a34._site = -1;
  start34.push({ x: a34.x, y: a34.y });
}
Crowd.update(G34, 0);
Crowd.push(G34, impactX34, impactY34, CONFIG.waterRadius, CONFIG.waterPushStrength, truckX34, truckY34);
for (var t34 = 0; t34 < 30; t34++) { Crowd.update(G34, 0.05); }
var moved34 = 0, onSolid34 = 0, farther34 = 0;
for (var j34 = 0; j34 < 10; j34++) {
  var ag34 = G34.agents[j34], s34 = start34[j34];
  var d34 = Math.sqrt(Math.pow(ag34.x - s34.x, 2) + Math.pow(ag34.y - s34.y, 2));
  var d0 = Math.sqrt(Math.pow(s34.x - truckX34, 2) + Math.pow(s34.y - truckY34, 2));
  var d1 = Math.sqrt(Math.pow(ag34.x - truckX34, 2) + Math.pow(ag34.y - truckY34, 2));
  var ch34 = MAP.rows[Math.floor(ag34.y)].charAt(Math.floor(ag34.x));
  if (d34 > 2) moved34++;
  if (d1 > d0) farther34++;
  if (ch34 === "#" || ch34 === "S") onSolid34++;
  console.log("  agent " + j34 + ": " + s34.x.toFixed(2) + "," + s34.y.toFixed(2) + " -> " + ag34.x.toFixed(2) + "," + ag34.y.toFixed(2) + " moved " + d34.toFixed(2) + " farther " + (d1 > d0));
}
console.log("34. " + moved34 + "/10 agents moved >2 tiles, " + farther34 + "/10 farther from truck, " + onSolid34 + " on solid tiles: " +
  (moved34 >= 9 && farther34 === 10 && onSolid34 === 0 ? "PASS" : "FAIL"));


console.log("");
console.log("=== Police Line Test ===");
/* 35. a protester walking past a foot officer is slowed (firm more than calm)
 *     and one pressed up against an officer is pushed back. */
function lineRun(stance, ox, oy, ax, ay, speed, seconds) {
  var G = world.makeG();
  Crowd.init(G); Crowd.rebuildFlow(G);
  for (var i = 0; i < G.agents.length; i++) G.agents[i].active = false;
  G.officers = [];
  if (stance) G.officers.push({ x: ox, y: oy, tx: ox, ty: oy, squad: 0, stance: stance, baseSpeed: CONFIG.officerSpeed, stamina: 100 });
  var a = angerAgent(G, "peaceful", ax, ay, 20);
  a.speed = speed;
  var sx = a.x, sy = a.y;
  var steps = Math.round(seconds / 0.05);
  for (var t = 0; t < steps; t++) { G.time += 0.05; Crowd.update(G, 0.05); }
  return { d: Math.sqrt((a.x - sx) * (a.x - sx) + (a.y - sy) * (a.y - sy)), a: a };
}
var free35 = lineRun(null, 0, 0, 40.5, 31.5, 1.3, 0.5).d;
var calm35 = lineRun("calm", 40.5, 30.5, 40.5, 31.5, 1.3, 0.5).d;
var firm35 = lineRun("firm", 40.5, 30.5, 40.5, 31.5, 1.3, 0.5).d;
var push35 = lineRun("firm", 40.5, 31.5, 40.8, 31.5, 0, 0.5).a;
var pushD35 = Math.sqrt(Math.pow(push35.x - 40.5, 2) + Math.pow(push35.y - 31.5, 2));
console.log("35. moved free " + free35.toFixed(2) + " calm " + calm35.toFixed(2) + " firm " + firm35.toFixed(2) + " in 0.5 s; pressed agent 0.30 -> " + pushD35.toFixed(2) + " from officer: " +
  (calm35 < free35 * 0.75 && firm35 < calm35 && pushD35 > 0.45 ? "PASS" : "FAIL"));
