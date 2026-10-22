/* game.js - tuning config, main loop, canvas setup and map rendering.
 * Step 1 scaffold: only draws the static map. Crowd/police/UI come later.
 */
"use strict";

/* ---------------------------------------------------------------
 * CONFIG: all tuning numbers live here so they are easy to tweak.
 * --------------------------------------------------------------- */
var CONFIG = {
  // Scenario
  crowdSize: 150,        // number of crowd agents
  rioterCount: 8,        // hidden violent rioters inside the crowd
  matchSeconds: 300,     // live phase length (5 minutes)
  tileSize: 16,          // pixels per tile on the canvas

  // Reserved for later steps (crowd mood, police, tools)
  squadCount: 3,
  officersPerSquad: 4,
  barrierCount: 4,
  loudspeakerCooldown: 20,   // seconds
  arrestSeconds: 2,          // seconds to complete an arrest
  suspicionThreshold: 50,    // minimum suspicion to allow an arrest
  observeRadiusTiles: 5,     // police observation radius
  revealSeconds: 10,         // how long a spotted rioter stays revealed

  // ---- crowd tuning (step 2) ----
  agentRadius: 0.3,          // tiles
  agentSpeedMin: 2.0,        // tiles per second
  agentSpeedMax: 2.5,
  wanderSpeed: 0.45,         // plaza milling speed
  hashCell: 2,               // spatial hash bucket size in tiles
  sepRadius: 0.8,            // agent-agent separation radius
  sepStrength: 1.2,          // separation push strength

  moodSpreadRadius: 1.5,     // neighbours influencing mood
  moodSpreadRate: 0.5,       // fraction pulled toward higher neighbour avg per second
  moodDensityThreshold: 6,   // neighbours within 1 tile before density anger
  moodDensityRise: 1.2,      // mood per second over threshold
  moodBlockedRise: 5.0,      // mood per second with no path to plaza
  moodOfficerFirmRadius: 3,  // tiles
  moodOfficerFirmRise: 6,    // mood per second inside firm radius
  moodOfficerCalmRadius: 1.5,
  moodOfficerCalmRise: 2,
  moodBrokenShopRadius: 8,   // tiles
  moodBrokenShopRise: 3.0,   // mood per second near a broken shop
  moodDecayBase: 2.0,        // mood lost per second
  moodDecayOpenBonus: 1.5,   // extra loss when few neighbours
  moodDecayPathBonus: 0.5,   // extra loss when a path to the plaza exists
  moodBaseline: 22,          // natural protest tension: decay pulls toward this, not 0
  moodBaselineRecover: 0.8,  // mood per second climbing back to the baseline

  agitMood: 70,              // becomes agitated at/above this
  calmMood: 60,              // calms back below this (hysteresis)
  agitSpeedMul: 0.75,
  agitJitter: 1.2,

  radicalMood: 90,           // peaceful agent radicalizes above this...
  radicalSeconds: 5,         // ...for this long...
  radicalChance: 0.1,        // ...with this chance per second

  breakSeconds: 4,           // seconds to smash one shop
  rioterShopSeekRadius: 10,  // tiles: rioters start hunting shops within this
  fleeSeconds: 8,            // seconds a rioter hides after a break
  throwRange: 6,             // tiles to throw at police
  throwChance: 0.2,          // per second
  throwMoodSpike: 8,
  shopBreakMoodSpike: 10,
    wrongArrestMoodSpike: 20,
    officerSpeed: 2.2,
    loudspeakerRadius: 6,
    loudspeakerStrength: 25
};

/* ---------------------------------------------------------------
 * Colours used when drawing tiles (no external assets).
 * --------------------------------------------------------------- */
var TILE_COLORS = {
  ".": "#2b2f38",  // road
  "#": "#3a3f4b",  // building
  "S": "#c08a2e",  // shop
  "P": "#5a6472",  // plaza (lighter than road)
  "G": "#2f5138",  // park
  "a": "#242830"   // narrow alley
};

/* ---------------------------------------------------------------
 * G: the shared mutable game state. All positions are in TILE units
 * (floats); the renderer multiplies by CONFIG.tileSize.
 * makeG() returns a fresh state so tests can run clean scenarios.
 * --------------------------------------------------------------- */
function makeG() {
  var g = {
    agents: [],
    shops: [],
    blocked: new Set(),      // "x,y" tile keys that are extra-solid (barriers, van)
    officers: [],            // filled by police.js in step 3
    time: 0,                 // seconds of simulated time
    stats: {
      shopsDamaged: 0,
      rioterArrested: 0,
      wrongArrests: 0,
      peakMood: 0,
      moodSum: 0,
      moodSamples: 0
    },
    logMessages: [],
    flow: null,              // BFS distance field toward the plaza
    flowVersion: 0,          // bumped on every rebuildFlow
    log: function (msg) {
      this.logMessages.push({ t: this.time, msg: msg });
      while (this.logMessages.length > 50) this.logMessages.shift();
    }
  };
  for (var i = 0; i < MAP.shops.length; i++) {
    var s = MAP.shops[i];
    g.shops.push({ id: s.id, name: s.name, x: s.x, y: s.y, hp: 100, broken: false });
  }
  return g;
}

var G = makeG();

var Game = {
  canvas: null,
  ctx: null,
  lastTime: 0,
  running: false,
  paused: false,
  speed: 1
};

/* Size the canvas to the map in device pixels, CSS scales it to the window. */
function sizeCanvas() {
  var ts = CONFIG.tileSize;
  Game.canvas.width = MAP.width * ts;
  Game.canvas.height = MAP.height * ts;
  // Crisp pixel look
  Game.ctx.imageSmoothingEnabled = false;
}

/* Draw one full frame of the static map. */
function drawMap() {
  var ctx = Game.ctx;
  var ts = CONFIG.tileSize;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, Game.canvas.width, Game.canvas.height);

  for (var y = 0; y < MAP.height; y++) {
    var row = MAP.rows[y];
    for (var x = 0; x < MAP.width; x++) {
      var ch = row.charAt(x);
      ctx.fillStyle = TILE_COLORS[ch] || "#ff00ff"; // magenta = unknown tile
      ctx.fillRect(x * ts, y * ts, ts, ts);
    }
  }

  // Plaza outline so the destination square reads clearly
  ctx.strokeStyle = "#8fa2bb";
  ctx.lineWidth = 1;
  var pc = MAP.plazaCenter;
  ctx.strokeRect(pc.x * ts - 7 * ts + 0.5, pc.y * ts - 7 * ts + 0.5, 15 * ts, 15 * ts);

  // Shops: distinct colour + name label on top
  ctx.font = "8px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (var i = 0; i < MAP.shops.length; i++) {
    var s = MAP.shops[i];
    ctx.fillStyle = "#e8b34a";
    ctx.fillRect(s.x * ts, s.y * ts, ts, ts);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(s.name, s.x * ts + ts / 2, s.y * ts + ts / 2);
  }
}

/* Small debug line: time, live agents, average mood, shops broken. */
function drawDebug(ctx) {
  var active = 0;
  for (var i = 0; i < G.agents.length; i++) if (G.agents[i].active) active++;
  var mood = (typeof Crowd !== "undefined") ? Crowd.averageMood(G) : 0;
  var txt = "t=" + G.time.toFixed(1) + "s  agents=" + active +
            "  mood=" + mood.toFixed(1) +
            "  shops=" + G.stats.shopsDamaged +
            "  " + Game.speed + "x" + (Game.paused ? "  PAUSED" : "") +
            "   [Space pause, T speed]";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  var w = ctx.measureText(txt).width;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(6, 6, w + 12, 18);
  ctx.fillStyle = "#9fe0a0";
  ctx.fillText(txt, 12, 10);
}

/* Main loop: simulate, then draw map -> crowd -> debug. */
function frame(now) {
  if (!Game.running) return;
  var dt = (now - Game.lastTime) / 1000;
  Game.lastTime = now;
  if (dt > 0.25) dt = 0.25;   // clamp after tab switches

  if (!Game.paused) {
    var step = Math.min(dt, 0.05);
    for (var i = 0; i < Game.speed; i++) {
      Crowd.update(G, step);
      if (typeof Police !== "undefined") Police.update(G, step);
    }
  }

  drawMap();
  Crowd.draw(Game.ctx, G);
  if (typeof Police !== "undefined") Police.draw(Game.ctx, G);
  drawDebug(Game.ctx);

  requestAnimationFrame(frame);
}

function initGame() {
  Game.canvas = document.getElementById("game");
  Game.ctx = Game.canvas.getContext("2d");
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);

  Crowd.init(G);
  Crowd.rebuildFlow(G);
  if (typeof Police !== "undefined") Police.init(G);

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space") {
      Game.paused = !Game.paused;
      e.preventDefault();
    } else if (e.key === "t" || e.key === "T") {
      Game.speed = Game.speed === 1 ? 2 : 1;
    }
  });

  Game.running = true;
  Game.lastTime = performance.now();
  requestAnimationFrame(frame);
}

/* Browser-only boot. Guarded so node can load this file for tests. */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("load", initGame);
}
