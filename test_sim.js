/* test_sim.js - headless crowd simulation test (no canvas, no browser).
 * Loads map.js + game.js + crowd.js in a vm sandbox and runs three scenarios.
 * Run: node test_sim.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function loadWorld() {
  var sandbox = { console: console, performance: { now: function () { return 0; } } };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  ["map.js", "game.js", "crowd.js"].forEach(function (f) {
    var code = fs.readFileSync(path.join(__dirname, f), "utf8");
    vm.runInContext(code, sandbox, { filename: f });
  });
  return sandbox;
}

var MAPREF = null;

function countOnPlaza(G) {
  var n = 0;
  for (var i = 0; i < G.agents.length; i++) {
    var a = G.agents[i];
    if (!a.active) continue;
    var tx = Math.floor(a.x), ty = Math.floor(a.y);
    if (ty >= 0 && ty < MAPREF.height && tx >= 0 && tx < MAPREF.width &&
        MAPREF.rows[ty].charAt(tx) === "P") n++;
  }
  return n;
}

function runScenario(world, seconds, blockKeys, label, wantMoods) {
  var G = world.makeG();
  var Crowd = world.Crowd;
  Crowd.init(G);
  if (blockKeys && blockKeys.length) {
    blockKeys.forEach(function (k) { G.blocked.add(k); });
    Crowd.rebuildFlow(G);
  }

  var dt = 1 / 30;
  var steps = Math.round(seconds / dt);
  var revealedIds = {};
  var moods = {};
  var t0 = Date.now();

  moods[0] = Crowd.averageMood(G);
  for (var i = 1; i <= steps; i++) {
    Crowd.update(G, dt);
    for (var j = 0; j < G.agents.length; j++) {
      var a = G.agents[j];
      if (a.active && a.role === "rioter" && (a.revealedUntil > 0 || a.hasTool)) revealedIds[a.id] = true;
    }
    var tNow = Math.round(i * dt);
    if (wantMoods.indexOf(tNow) !== -1 && moods[tNow] === undefined) {
      moods[tNow] = Crowd.averageMood(G);
    }
  }
  var ms = Date.now() - t0;

  var active = 0, rioters = 0;
  for (var k = 0; k < G.agents.length; k++) {
    if (G.agents[k].active) active++;
    if (G.agents[k].role === "rioter") rioters++;
  }

  console.log("=== " + label + " (" + seconds + " s, dt=1/30, " + steps + " steps) ===");
  console.log("agents: " + G.agents.length + " total, " + active + " active, " + rioters + " rioters");
  wantMoods.forEach(function (m) {
    console.log("average mood @" + m + "s: " + (moods[m] === undefined ? "n/a" : moods[m].toFixed(2)));
  });
  console.log("agents on plaza tiles at end: " + countOnPlaza(G));
  console.log("shops broken: " + G.stats.shopsDamaged + "/" + G.shops.length);
  console.log("rioters revealed at least once: " + Object.keys(revealedIds).length);
  console.log("peak average mood: " + G.stats.peakMood.toFixed(2));
  console.log("sim wall time: " + ms + " ms");
  console.log("");
  return { G: G, moods: moods, ms: ms };
}

var world = loadWorld();
MAPREF = world.MAP;

console.log("map: " + MAPREF.width + "x" + MAPREF.height + " tiles");
console.log("CONFIG.crowdSize=" + world.CONFIG.crowdSize + " CONFIG.rioterCount=" + world.CONFIG.rioterCount);
console.log("");

/* Scenario 1: no player input, full 300 s. */
var s1 = runScenario(world, 300, null, "Scenario 1: no player input", [0, 60, 120, 300]);

/* Scenario 2: block the boulevard at x=14 (rows 31 and 32); crowd must detour. */
var s2 = runScenario(world, 120, ["14,31", "14,32"],
  "Scenario 2: boulevard blocked at x=14", [0, 60, 120]);

/* Scenario 3: seal every route (boulevard + the west cross street + west corridor). */
var seal = ["14,31", "14,32"];
for (var yy = 0; yy < MAPREF.height; yy++) { seal.push("20," + yy); seal.push("21," + yy); }
seal.push("6,31"); seal.push("6,32");
var s3 = runScenario(world, 60, seal, "Scenario 3: every route sealed", [0, 30, 60]);

console.log("=== comparison ===");
console.log("mood @60s  scenario1=" + s1.moods[60].toFixed(2) +
            "  scenario2=" + s2.moods[60].toFixed(2) +
            "  scenario3=" + s3.moods[60].toFixed(2));
console.log("scenario3 shops broken: " + s3.G.stats.shopsDamaged);
console.log("scenario3 rioters (radicalized included): " +
  s3.G.agents.filter(function (a) { return a.role === "rioter"; }).length);