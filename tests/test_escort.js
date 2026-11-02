"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function loadWorld() {
  var sandbox = { console: console, performance: { now: function () { return 0; } } };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  ["map.js", "game.js", "crowd.js", "police.js"].forEach(function (f) {
    var code = fs.readFileSync(path.join(__dirname, "..", "src", f === "map.js" || f === "game.js" ? "core" : "sim", f), "utf8");
    vm.runInContext(code, sandbox, { filename: f });
  });
  return sandbox;
}

function freshWorld() {
  var world = loadWorld();
  var G = world.makeG();
  world.Crowd.init(G);
  world.Crowd.rebuildFlow(G);
  world.Police.init(G);
  return { world: world, G: G, MAP: world.MAP, CONFIG: world.CONFIG,
    Crowd: world.Crowd, Police: world.Police };
}

function check(number, description, fn) {
  if (typeof description === "function" && fn === undefined) {
    fn = description;
    var parts = String(number).split(" ");
    number = parts[0];
    description = parts.slice(1).join(" ");
  }
  try {
    if (fn()) console.log(number + " PASS " + description);
    else {
      console.log(number + " FAIL " + description);
      process.exitCode = 1;
    }
  } catch (err) {
    console.log(number + " FAIL " + description + " — " + (err && err.stack || err));
    process.exitCode = 1;
  }
}

function peacefulAgent(G) {
  for (var i = 0; i < G.agents.length; i++) {
    if (G.agents[i].active && G.agents[i].role !== "rioter") return G.agents[i];
  }
  throw new Error("No active peaceful agent was created");
}

function arrestAndStart(Crowd, Police, G, agent, squadIndex) {
  if (!Crowd.arrest(G, agent)) throw new Error("Crowd.arrest returned false");
  return Police.startEscort(G, agent, squadIndex);
}

function setSquadCentre(G, squadIndex, x, y) {
  for (var i = 0; i < G.officers.length; i++) {
    var officer = G.officers[i];
    if (officer.squad !== squadIndex) continue;
    officer.x = x + officer.ox;
    officer.y = y + officer.oy;
    officer.tx = x;
    officer.ty = y;
    officer.homeX = x;
    officer.homeY = y;
  }
  for (var j = 0; j < G.vehicles.length; j++) {
    var vehicle = G.vehicles[j];
    if (vehicle.squad !== squadIndex) continue;
    vehicle.x = x + vehicle.ox;
    vehicle.y = y + vehicle.oy;
    vehicle.tx = x;
    vehicle.ty = y;
  }
}

function simulateEscort(G, Police, seconds) {
  var steps = Math.ceil(seconds / 0.05);
  for (var i = 0; i < steps && G.detainees.length; i++) {
    G.time += 0.05;
    Police.update(G, 0.05);
  }
}

check("E1", "startEscort assigns a non-leader officer", function () {
  var w = freshWorld(), G = w.G, Police = w.Police, Crowd = w.Crowd;
  var leader = G.officers.filter(function (o) { return o.squad === 0; })[0];
  var agent = peacefulAgent(G);
  agent.x = leader.x + 0.15;
  agent.y = leader.y + 0.15;
  var d = arrestAndStart(Crowd, Police, G, agent, 0);
  return G.detainees.length === 1 && d.officer && d.officer !== leader;
});

check("E2 car is preferred over a closer water truck", function () {
  var w = freshWorld(), G = w.G, Police = w.Police, Crowd = w.Crowd;
  Police.deploySquad(G, 2, 20.5, 18.5);
  Police.deploySquad(G, 1, 21.5, 18.5);
  Police.deploySquad(G, 0, 30.5, 18.5);
  setSquadCentre(G, 2, 20.5, 18.5);
  setSquadCentre(G, 1, 21.5, 18.5);
  setSquadCentre(G, 0, 30.5, 18.5);
  var agent = peacefulAgent(G);
  agent.x = 20.6;
  agent.y = 18.5;
  var d = arrestAndStart(Crowd, Police, G, agent, 2);
  var truck = G.vehicles.filter(function (v) { return v.type === "watertruck"; })[0];
  return !!d.car && d.car.type === "car" && truck &&
    Math.sqrt(Math.pow(truck.x - d.x, 2) + Math.pow(truck.y - d.y, 2)) <
    Math.sqrt(Math.pow(d.car.x - d.x, 2) + Math.pow(d.car.y - d.y, 2));
});

check("E3 escort finishes and restores officer state", function () {
  var w = freshWorld(), G = w.G, Police = w.Police, Crowd = w.Crowd;
  setSquadCentre(G, 2, 17.5, 18.5);
  setSquadCentre(G, 0, 35.5, 18.5);
  var agent = peacefulAgent(G);
  agent.x = 17.7;
  agent.y = 18.5;
  var d = arrestAndStart(Crowd, Police, G, agent, 2);
  var officer = d.officer;
  simulateEscort(G, Police, 60);
  return G.detainees.length === 0 && G.stats.escorted === 1 &&
    !officer.busy && !officer.escorting && officer.speed === w.CONFIG.officerSpeed;
});

check("E4 detainee walks more than three tiles before loading", function () {
  var w = freshWorld(), G = w.G, Police = w.Police, Crowd = w.Crowd;
  setSquadCentre(G, 2, 17.5, 31.5);
  setSquadCentre(G, 0, 35.5, 31.5);
  var agent = peacefulAgent(G);
  agent.x = 17.7;
  agent.y = 31.5;
  var d = arrestAndStart(Crowd, Police, G, agent, 2);
  var startX = d.x, startY = d.y, walkDistance = 0, reachedLoading = false;
  for (var i = 0; i < 1200 && G.detainees.length; i++) {
    G.time += 0.05;
    Police.update(G, 0.05);
    if (d.state === "loading") {
      var dx = d.x - startX, dy = d.y - startY;
      walkDistance = Math.sqrt(dx * dx + dy * dy);
      reachedLoading = true;
      break;
    }
  }
  return reachedLoading && walkDistance > 3;
});

check("E5 Police.draw handles a visible detainee", function () {
  var w = freshWorld(), G = w.G, Police = w.Police, Crowd = w.Crowd;
  var agent = peacefulAgent(G);
  arrestAndStart(Crowd, Police, G, agent, 0);
  var ctx = new Proxy({}, {
    get: function (target, prop) {
      if (!(prop in target)) target[prop] = function () {};
      return target[prop];
    },
    set: function (target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
  Police.draw(ctx, G);
  return true;
});

check("E6 integration preserves arrest-to-escort accounting", function () {
  var w = freshWorld(), G = w.G, Police = w.Police, Crowd = w.Crowd;
  for (var i = 0; i < 2400; i++) {
    G.time += 0.05;
    Crowd.update(G, 0.05);
    Police.update(G, 0.05);
  }
  return G.stats.escorted + G.detainees.length ===
    G.stats.rioterArrested + G.stats.wrongArrests;
});