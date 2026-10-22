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
var res1 = Police.placeBarrier(G1, 0, 0);
console.log("1. placeBarrier on solid tile: " + (res1 === false ? "PASS" : "FAIL"));

// 2. placeBarrier on road tile up to limit
var roadX = 2, roadY = 19;
var placed = 0;
for (var i = 0; i < CONFIG.barrierCount + 1; i++) {
  if (Police.placeBarrier(G1, roadX + i, roadY)) {
    placed++;
  }
}
var extraBarrier = Police.placeBarrier(G1, roadX + CONFIG.barrierCount + 1, roadY);
console.log("2. placeBarrier up to limit (" + CONFIG.barrierCount + "): " + (placed === CONFIG.barrierCount && extraBarrier === false ? "PASS" : "FAIL"));

// 3. loudspeaker cooldown
var res3a = Police.loudspeaker(G1, 30, 20);
var res3b = Police.loudspeaker(G1, 30, 20);
G1.time += CONFIG.loudspeakerCooldown + 1;
var res3c = Police.loudspeaker(G1, 30, 20);
console.log("3. loudspeaker cooldown: " + (res3a === true && res3b === false && res3c === true ? "PASS" : "FAIL"));

// 4. G.officers.length
console.log("4. G.officers.length == " + (CONFIG.squadCount * CONFIG.officersPerSquad) + ": " + (G1.officers.length === CONFIG.squadCount * CONFIG.officersPerSquad ? "PASS" : "FAIL"));

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
Police.placeBarrier(G2, 5, 19);
Police.placeBarrier(G2, 6, 19);

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
