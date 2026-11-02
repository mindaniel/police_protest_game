/* check_map.js - node sanity check for map.js (no canvas needed).
 * Loads map.js in a vm sandbox, validates dimensions and shop placement,
 * then runs a BFS from the crowd spawn to the plaza over walkable tiles.
 * Run: node check_map.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var mapPath = path.join(__dirname, "..", "src", "core", "map.js");
var code = fs.readFileSync(mapPath, "utf8");
var sandbox = { console: console, module: undefined, exports: undefined };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "map.js" });

var MAP = sandbox.MAP;
var problems = [];

// 1) every row is the same length and equals MAP.width
var rowLens = {};
for (var y = 0; y < MAP.rows.length; y++) {
  var len = MAP.rows[y].length;
  rowLens[len] = (rowLens[len] || 0) + 1;
  if (len !== MAP.width) {
    problems.push("row " + y + " length " + len + " != width " + MAP.width);
  }
}
console.log("row count:", MAP.rows.length, "| declared height:", MAP.height);
console.log("row lengths (len:count):", JSON.stringify(rowLens));
if (MAP.rows.length !== MAP.height) {
  problems.push("row count " + MAP.rows.length + " != height " + MAP.height);
}

// 2) tile characters are all known
var known = ". #SPGa".split("");
var unknown = {};
for (var yy = 0; yy < MAP.rows.length; yy++) {
  for (var xx = 0; xx < MAP.rows[yy].length; xx++) {
    var ch = MAP.rows[yy].charAt(xx);
    if (known.indexOf(ch) === -1) unknown[ch] = (unknown[ch] || 0) + 1;
  }
}
if (Object.keys(unknown).length) {
  problems.push("unknown tile chars: " + JSON.stringify(unknown));
}

// 3) every shop sits on an 'S' tile
for (var i = 0; i < MAP.shops.length; i++) {
  var s = MAP.shops[i];
  var tile = (MAP.rows[s.y] || "").charAt(s.x);
  if (tile !== "S") {
    problems.push("shop " + s.name + " at (" + s.x + "," + s.y + ") is on '" + tile + "'");
  }
}
console.log("shops checked:", MAP.shops.length);

// 4) BFS from crowd spawn to the plaza over walkable tiles
var WALKABLE = ".PGa";           // solid: '#', 'S'
function walkable(x, y) {
  if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
  return WALKABLE.indexOf(MAP.rows[y].charAt(x)) !== -1;
}

var dist = new Array(MAP.width * MAP.height).fill(-1);
var queue = [];
var sp = MAP.crowdSpawn;
for (var sy = sp.y; sy < sp.y + sp.h; sy++) {
  for (var sx = sp.x; sx < sp.x + sp.w; sx++) {
    if (walkable(sx, sy)) {
      dist[sy * MAP.width + sx] = 0;
      queue.push(sx, sy);
    }
  }
}

var head = 0;
var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
while (head < queue.length) {
  var cx = queue[head++], cy = queue[head++];
  var cd = dist[cy * MAP.width + cx];
  for (var d = 0; d < 4; d++) {
    var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
    if (!walkable(nx, ny)) continue;
    var ni = ny * MAP.width + nx;
    if (dist[ni] !== -1) continue;
    dist[ni] = cd + 1;
    queue.push(nx, ny);
  }
}

var pc = MAP.plazaCenter;
var plazaDist = dist[pc.y * MAP.width + pc.x];
console.log("plaza reachable:", plazaDist !== -1);
console.log("BFS path length (tiles) spawn -> plaza:", plazaDist);

// count how many plaza tiles are reachable, as an extra check
var reachPlaza = 0, totalPlaza = 0;
for (var py = 0; py < MAP.height; py++) {
  for (var px = 0; px < MAP.width; px++) {
    if (MAP.rows[py].charAt(px) === "P") {
      totalPlaza++;
      if (dist[py * MAP.width + px] !== -1) reachPlaza++;
    }
  }
}
console.log("reachable plaza tiles:", reachPlaza + "/" + totalPlaza);

if (problems.length) {
  console.log("PROBLEMS:");
  problems.forEach(function (p) { console.log(" - " + p); });
  process.exit(1);
} else {
  console.log("MAP OK");
}