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
  squadCount: 6,
  officersPerSquad: 4,
  barrierCount: 4,
  barriersPerTruck: 3,       // stock carried by one barrier truck
  loadoutBudget: 10,         // total loadout cost across all squads
  loadouts: {
    none:         { cost: 0 },
    car:          { cost: 2 },
    watertruck:   { cost: 3 },
    barriertruck: { cost: 2 },
    motorbike:    { cost: 2 }
  },
  loudspeakerCooldown: 20,   // seconds
  arrestSeconds: 2,          // seconds to complete an arrest
  suspicionThreshold: 50,    // minimum suspicion to allow an arrest
  observeRadiusTiles: 5,     // police observation radius
  revealSeconds: 10,         // how long a spotted rioter stays revealed
  vanguardChance: 0.05,      // per-second chance a marching rioter heads for a shop early
  violentSeconds: 4,         // how long a violent act keeps a rioter visible to police

  // ---- crowd tuning (step 2) ----
  agentRadius: 0.3,          // tiles
  agentSpeedMin: 1.2,        // tiles per second
  agentSpeedMax: 1.5,
  runSpeedMin: 2.2,           // tiles/s while running
  runSpeedMax: 2.6,
  staminaDrain: 12,           // stamina per second while running
  staminaRegen: 8,            // stamina per second while walking
  staminaMinToRun: 30,        // must recover to this before running again
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
  moodBrokenShopCap: 66,     // broken shops alone can never push mood above this (stay below agitMood 70)
  arrestAngerSeconds: 15,    // how long an arrest keeps angering the crowd around it
  arrestAngerRadius: 6,      // tiles
  arrestAngerRise: 7,        // mood per second after a normal arrest (net of calming it must beat ~4/s decay)
  arrestAngerCap: 68,        // normal arrests alone never push mood past this (below agitMood 70)
  wrongArrestAngerRise: 12,  // mood per second after a wrong arrest
  wrongArrestAngerCap: 88,   // wrong arrests alone never push mood past this (below radicalMood 90)
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
  officerSpeed: 1.6,
  officerRunSpeed: 2.6,      // foot officer sprint speed
  officerStaminaDrain: 16,   // stamina per second while running
  officerStaminaRegen: 8,    // stamina per second while walking
  officerStaminaMinToRun: 30, // must recover to this before running again
  waterPushSeconds: 1.5,     // water cannon knock-back duration
  waterPushStrength: 5.0,    // knock-back speed (tiles/s)
  policeLineRadius: 1.4,     // tiles within which a foot officer slows the crowd
  policeLineSlowCalm: 0.5,   // speed multiplier near a calm officer
  policeLineSlowFirm: 0.3,   // speed multiplier near a firm officer
  loudspeakerRadius: 6,
  loudspeakerStrength: 25,
    // ---- vehicles and planning ----
    carSpeed: 4.5,
    truckSpeed: 3.0,
    motorbikeSpeed: 6.0,     // officers of a motorbike squad move this fast
    carObserveBonus: 2,      // extra observe radius (tiles) for a squad that has a car
    waterRange: 9,           // tiles from the truck
    waterRadius: 3,
    waterStrength: 40,
    waterCooldown: 25,       // seconds
    deployMinX: 8,           // squads may only be placed at x >= this (keeps clear of crowd entry)
    // ---- crowd entrances (rectangles in tiles; share = fraction of the crowd) ----
    spawnZones: [
      { x: 0,  y: 30, w: 4, h: 3, share: 0.4, name: "WEST" },
      { x: 96, y: 30, w: 4, h: 3, share: 0.2, name: "EAST" },
      { x: 18, y: 0,  w: 6, h: 3, share: 0.2, name: "NORTH STREET" },
      { x: 70, y: 60, w: 6, h: 3, share: 0.2, name: "SOUTH STREET" }
    ],
    // ---- street blockade sites (rectangles in tiles) ----
    plazaShare: 0.25,        // fraction of peaceful agents that simply head for the plaza
    blockSites: [
      { x: 8,  y: 30, w: 2, h: 2, name: "WEST BLVD" },
      { x: 88, y: 30, w: 2, h: 2, name: "EAST BLVD" },
      { x: 20, y: 10, w: 2, h: 2, name: "WEST AVE N" },
      { x: 20, y: 50, w: 2, h: 2, name: "WEST AVE S" },
      { x: 72, y: 8,  w: 2, h: 2, name: "EAST AVE N" },
      { x: 72, y: 45, w: 2, h: 2, name: "EAST AVE S" },
      { x: 30, y: 30, w: 2, h: 2, name: "MID BLVD" },
      { x: 60, y: 31, w: 2, h: 2, name: "ALLEY" }
    ]
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
    var shop = { id: s.id, name: s.name, x: s.x, y: s.y, hp: 100, broken: false, shutter: 0, shutterClosing: false };
    if (CONFIG.shopDefense) {
      var hr = ((s.id * 37 + 11) % 20) / 20;   /* deterministic per shop id */
      shop.glass = hr < 0.5 ? 0 : (hr < 0.85 ? 1 : 2);
    }
    g.shops.push(shop);
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
  var lw = MAP.width * ts, lh = MAP.height * ts;      // logical size, never changes
  var dpr = window.devicePixelRatio || 1;
  var scale = Math.min(window.innerWidth / lw, window.innerHeight / lh);
  if (!(scale > 0)) scale = 1;
  var cssW = Math.floor(lw * scale), cssH = Math.floor(lh * scale);
  Game.canvas.style.width = cssW + "px";
  Game.canvas.style.height = cssH + "px";
  Game.canvas.width = Math.max(1, Math.round(cssW * dpr));   // physical pixels
  Game.canvas.height = Math.max(1, Math.round(cssH * dpr));
  Game.renderScale = Game.canvas.width / lw;
  Game.ctx.imageSmoothingEnabled = true;
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

/* Main loop: simulate, then draw map -> crowd -> police -> UI. */
function frame(now) {
  if (!Game.running) return;
  var dt = (now - Game.lastTime) / 1000;
  Game.lastTime = now;
  if (dt > 0.25) dt = 0.25;   // clamp after tab switches

  var hasUI = (typeof UI !== "undefined");
  if (hasUI) UI.tick(G);

  if (!Game.paused && (!hasUI || UI.screen === "playing")) {
    var step = Math.min(dt, 0.05);
    for (var i = 0; i < Game.speed; i++) {
      Crowd.update(G, step);
      if (typeof Police !== "undefined") Police.update(G, step);
      if (typeof FX !== "undefined") FX.update(G, step);
    }
  }

  Game.ctx.setTransform(Game.renderScale || 1, 0, 0, Game.renderScale || 1, 0, 0);
  if (typeof Art !== "undefined") {
    Art.draw(Game.ctx, G);
  } else {
    drawMap();
    Crowd.draw(Game.ctx, G);
    if (typeof Police !== "undefined") Police.draw(Game.ctx, G);
  }
  if (hasUI) UI.draw(Game.ctx, G); else drawDebug(Game.ctx);

  requestAnimationFrame(frame);
}

/* Random city: ?seed=123 in the URL replays one city, otherwise a new one each launch. */
function citySeed() {
  var m = /[?&]seed=(\d+)/.exec(window.location.search || "");
  return m ? parseInt(m[1], 10) : Math.floor(Math.random() * 1e9);
}

/* newCity: true = generate another random city, false = replay the same one. */
function restartGame(newCity) {
  if (typeof CityGen !== "undefined") CityGen.apply(newCity ? Math.floor(Math.random() * 1e9) : MAP.seed);
  G = makeG();
  Crowd.init(G);
  Crowd.rebuildFlow(G);
  if (typeof Police !== "undefined") Police.init(G);
  if (typeof FX !== "undefined") FX.init(G);
  if (typeof Art !== "undefined") Art.init(G);
  Game.paused = false;
  Game.speed = 1;
  if (typeof UI !== "undefined") { UI.screen = "planning"; UI.mode = null; }
}

function initGame() {
  Game.canvas = document.getElementById("game");
  Game.ctx = Game.canvas.getContext("2d");
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);

  if (typeof CityGen !== "undefined") {
    CityGen.apply(citySeed());
    G = makeG();
  }
  Crowd.init(G);
  Crowd.rebuildFlow(G);
  if (typeof Police !== "undefined") Police.init(G);
  if (typeof FX !== "undefined") FX.init(G);
  if (typeof Art !== "undefined") Art.init(G);

  if (typeof UI !== "undefined") {
    UI.init(G, Game);
  } else {
    window.addEventListener("keydown", function (e) {
      if (e.code === "Space") {
        Game.paused = !Game.paused;
        e.preventDefault();
      } else if (e.key === "t" || e.key === "T") {
        Game.speed = Game.speed === 1 ? 2 : 1;
      }
    });
  }

  Game.running = true;
  Game.lastTime = performance.now();
  requestAnimationFrame(frame);
}

/* Browser-only boot. Guarded so node can load this file for tests. */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("load", initGame);
}
