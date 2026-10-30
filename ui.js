/* ui.js - title screen, planning phase, HUD, pause overlay and debrief.
 * Reads state and calls existing Police functions only. No new game rules.
 * No window/document access at load time (safe under node).
 */
var UI = {
  screen: "title",      // "title" | "planning" | "playing" | "over"
  selected: 0,
  mode: null,           // null | "barrier" | "loudspeaker" | "water"
  msg: "",
  msgUntil: 0,
  hover: null,
  Game: null
};

UI.say = function (text) {
  UI.msg = text;
  UI.msgUntil = Date.now() + 2200;
};

UI.toTile = function (e) {
  var c = UI.Game.canvas;
  var r = c.getBoundingClientRect();
  var ts = CONFIG.tileSize;
  var px = (e.clientX - r.left) / r.width * (MAP.width * ts);
  var py = (e.clientY - r.top) / r.height * (MAP.height * ts);
  if (typeof Art !== "undefined" && Art.screenToTile) {
    var p = Art.screenToTile(px, py);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }
  return { x: Math.floor(px / ts), y: Math.floor(py / ts) };
};

/* Ground-plane drawing in tile-pixel units; falls back to flat when art.js is absent. */
function uiGround(ctx, on) {
  if (typeof Art === "undefined" || !Art.groundBegin) return;
  if (on) Art.groundBegin(ctx); else Art.groundEnd(ctx);
}
function uiAt(tx, ty) {
  if (typeof Art !== "undefined" && Art.project) return Art.project(tx, ty, 0);
  return { x: tx * CONFIG.tileSize, y: ty * CONFIG.tileSize };
}
function uiLabel(ctx, text, tx, ty, col, font) {
  var p = uiAt(tx, ty);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  var w = ctx.measureText(text).width + 10;
  ctx.fillStyle = "rgba(20,26,38,0.78)";
  ctx.fillRect(p.x - w / 2, p.y - 9, w, 18);
  ctx.fillStyle = col;
  ctx.fillText(text, p.x, p.y);
}

function uiSelectKey(k) {
  var n = parseInt(k, 10);
  if (n >= 1 && n <= CONFIG.squadCount) { UI.selected = n - 1; return true; }
  return false;
}

UI.init = function (g, game) {
  UI.Game = game;

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (UI.screen === "title") {
      if (e.code === "Enter") { UI.screen = "planning"; e.preventDefault(); }
      return;
    }
    if (UI.screen === "over") {
      if (k === "r" || k === "R") restartGame();
      return;
    }
    if (UI.screen === "planning") {
      if (e.code === "Enter") { UI.screen = "playing"; UI.mode = null; e.preventDefault(); }
      else if (uiSelectKey(k)) { /* squad selected */ }
      else if (k === "v" || k === "V") { uiCycleLoadout(); }
      else if (k === "b" || k === "B") { UI.mode = "barrier"; }
      else if ((k === "n" || k === "N") && typeof CityGen !== "undefined") { restartGame(true); UI.say("New random city"); }
      else if (k === "Escape") { UI.mode = null; }
      return;
    }
    // playing
    if (e.code === "Space") { UI.Game.paused = !UI.Game.paused; e.preventDefault(); return; }
    if (k === "t" || k === "T") { UI.Game.speed = UI.Game.speed === 1 ? 2 : 1; return; }
    if (UI.Game.paused) return;
    if (uiSelectKey(k)) { /* squad selected */ }
    else if (k === "s" || k === "S") { Police.toggleStance(G, UI.selected); }
    else if (k === "b" || k === "B") { UI.mode = "barrier"; }
    else if (k === "l" || k === "L") { UI.mode = "loudspeaker"; }
    else if (k === "w" || k === "W") { UI.mode = "water"; }
    else if (k === "a" || k === "A") { UI.mode = "arrest"; }
    else if (k === "f" || k === "F") {
      var sr = Police.shove(G, UI.selected);
      if (sr === "cooldown") UI.say("Squad " + (UI.selected + 1) + " needs a moment before shoving again");
      else if (sr === "none") UI.say("No free officers in that squad");
    }
    else if (k === "Escape") { UI.mode = null; }
  });

  var cv = game.canvas;
  cv.addEventListener("mousemove", function (e) {
    UI.hover = UI.toTile(e);
    if (!UI._press) cv.style.cursor = (UI.screen !== "title" && UI.pickSquad(e) >= 0) ? "pointer" : (UI.mode ? "crosshair" : "default");
  });
  cv.addEventListener("mouseleave", function () {
    UI.hover = null;
  });

  /* Left button: click = select / command, hold and drag = pan the map. */
  cv.addEventListener("mousedown", function (e) {
    if (e.button === 0) {
      UI._press = { x: e.clientX, y: e.clientY, drag: false };
    } else if (e.button === 2) {
      e.preventDefault();
      uiRightClick(e);
    }
  });
  window.addEventListener("mousemove", function (e) {
    var p = UI._press;
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.drag && dx * dx + dy * dy > 36) p.drag = true;
    if (p.drag && typeof Art !== "undefined" && Art.panBy) {
      var r = cv.getBoundingClientRect(), ts = CONFIG.tileSize;
      Art.panBy(-dx / r.width * MAP.width * ts, -dy / r.height * MAP.height * ts);
      p.x = e.clientX; p.y = e.clientY;
      cv.style.cursor = "grabbing";
    }
  });
  window.addEventListener("mouseup", function (e) {
    if (e.button !== 0 || !UI._press) return;
    var wasDrag = UI._press.drag;
    UI._press = null;
    cv.style.cursor = "default";
    if (!wasDrag && e.target === cv) uiLeftClick(e);
  });
};

/* Logical canvas pixels (map-sized, before devicePixelRatio). */
UI.toLogical = function (e) {
  var r = UI.Game.canvas.getBoundingClientRect(), ts = CONFIG.tileSize;
  return { x: (e.clientX - r.left) / r.width * (MAP.width * ts), y: (e.clientY - r.top) / r.height * (MAP.height * ts) };
};

/* Nearest thing under the cursor, measured on screen where it is drawn. */
function uiScreenDist(lp, x, y, z) {
  var p = (typeof Art !== "undefined" && Art.project) ? Art.project(x, y, z) : { x: x * CONFIG.tileSize, y: y * CONFIG.tileSize };
  var dx = p.x - lp.x, dy = p.y - lp.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function uiScale() {
  return (typeof Art !== "undefined" && Art.camera) ? Art.camera.S : 1;
}
UI.pickSquad = function (e) {
  var lp = UI.toLogical(e), s = uiScale(), best = -1, bestD = Math.max(9, 13 * s), i, d;
  for (i = 0; i < G.officers.length; i++) {
    d = uiScreenDist(lp, G.officers[i].x, G.officers[i].y, 0.45);
    if (d < bestD) { bestD = d; best = G.officers[i].squad; }
  }
  for (i = 0; i < G.vehicles.length; i++) {
    d = uiScreenDist(lp, G.vehicles[i].x, G.vehicles[i].y, 0.4) * 0.7;
    if (d < bestD) { bestD = d; best = G.vehicles[i].squad; }
  }
  return best;
};
UI.pickAgent = function (e) {
  var lp = UI.toLogical(e), s = uiScale(), best = null, bestD = Math.max(8, 10 * s);
  for (var i = 0; i < G.agents.length; i++) {
    var a = G.agents[i];
    if (!a.active) continue;
    var d = uiScreenDist(lp, a.x, a.y, 0.4);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
};

function uiBarrier(t) {
  if (!Police.hasBarrierTruck(G, UI.selected)) UI.say("Selected squad has no barrier truck");
  else if (!Police.placeBarrier(G, t.x, t.y, UI.selected)) UI.say("Barrier stock empty or tile blocked");
}
function uiWater(t) {
  var r = Police.waterCannon(G, t.x + 0.5, t.y + 0.5, UI.selected);
  if (r === "none") UI.say("Selected squad has no water truck");
  else if (r === "cooldown") UI.say("Water cannon reloading");
  else if (r === "range") UI.say("Target out of range of the water truck");
}
function uiLoud(t) {
  if (!Police.hasCar(G, UI.selected)) UI.say("Selected squad has no car");
  else if (!Police.loudspeaker(G, t.x, t.y, UI.selected)) UI.say("Loudspeaker cooling down");
}
function uiArrest(e) {
  var ag = UI.pickAgent(e);
  if (!ag) { UI.say("Click right on a person to arrest them"); return; }
  if (Police.orderArrest(G, UI.selected, ag)) UI.say("Squad " + (UI.selected + 1) + " moving in to arrest (a peaceful protester = wrong arrest)");
}

function uiLeftClick(e) {
  if (UI.screen === "title" || UI.screen === "over") return;
  var t = UI.toTile(e);
  if (UI.screen === "planning") {
    var sq0 = UI.mode ? -1 : UI.pickSquad(e);
    if (sq0 >= 0) { UI.selected = sq0; return; }
    if (UI.mode === "barrier") { uiBarrier(t); UI.mode = null; }
    else if (!Police.deploySquad(G, UI.selected, t.x + 0.5, t.y + 0.5)) {
      UI.say("Place squads on street tiles (green), away from the crowd entry");
    }
    return;
  }
  if (UI.Game.paused) return;
  if (!UI.mode) {
    var sq = UI.pickSquad(e);
    if (sq >= 0) { UI.selected = sq; return; }
  }
  if (UI.mode === "barrier") uiBarrier(t);
  else if (UI.mode === "loudspeaker") uiLoud(t);
  else if (UI.mode === "water") uiWater(t);
  else if (UI.mode === "arrest") uiArrest(e);
  else if (!Police.isWalkable(G, t.x, t.y)) UI.say("Squad cannot go there");
  else Police.moveSquad(G, UI.selected, t.x + 0.5, t.y + 0.5, !!e.shiftKey);
  UI.mode = null;
}

/* Right click = the selected squad's tool: water truck sprays, car uses the
 * loudspeaker, barrier truck drops a barrier; a squad without a vehicle
 * arrests the person clicked, or sprints there. */
function uiRightClick(e) {
  if (UI.screen === "planning") {
    if (Police.hasBarrierTruck(G, UI.selected)) uiBarrier(UI.toTile(e));
    else UI.say("Right-click places barriers when the squad has a barrier truck");
    return;
  }
  if (UI.screen !== "playing" || UI.Game.paused) return;
  if (UI.mode) { UI.mode = null; return; }
  var t = UI.toTile(e), lo = Police.getLoadout(G, UI.selected);
  if (lo === "watertruck") uiWater(t);
  else if (lo === "car") uiLoud(t);
  else if (lo === "barriertruck") uiBarrier(t);
  else if (UI.pickAgent(e)) uiArrest(e);
  else if (Police.isWalkable(G, t.x, t.y)) Police.moveSquad(G, UI.selected, t.x + 0.5, t.y + 0.5, true);
}

/* Called once per frame before simulating. */
UI.tick = function (g) {
  if (UI.screen === "playing" && g.over) UI.screen = "over";
};

function uiMmss(sec) {
  sec = Math.max(0, Math.ceil(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function uiOverlay(ctx, title, lines, footer) {
  var w = MAP.width * CONFIG.tileSize, h = MAP.height * CONFIG.tileSize;
  ctx.fillStyle = "rgba(8,10,16,0.88)";
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px Consolas, monospace";
  ctx.fillText(title, w / 2, 50);
  ctx.font = "14px Consolas, monospace";
  var y = 105;
  for (var i = 0; i < lines.length; i++) {
    ctx.fillStyle = lines[i].charAt(0) === "#" ? "#9fe0a0" : "#d7dde8";
    ctx.fillText(lines[i].replace(/^#/, ""), w / 2, y);
    y += 22;
  }
  ctx.fillStyle = "#ffd866";
  ctx.font = "bold 16px Consolas, monospace";
  ctx.fillText(footer, w / 2, y + 20);
}

var UI_CONTROLS = [
  "Left click a squad (or 1 - 6) : select it",
  "Left click the street : send the selected squad there (Shift = run)",
  "Hold left button and drag : move the map",
  "Right click : squad tool - water truck sprays, car loudspeaker,",
  "   barrier truck drops a barrier, foot squad arrests the person clicked",
  "A then click a person : arrest them      F : shove the crowd back",
  "V : cycle the selected squad's loadout",
  "S : toggle calm / firm stance",
  "B then click : place barrier (needs a barrier truck)",
  "L then click : loudspeaker (needs a car)",
  "W then click : water cannon (needs the water truck)",
  "Esc : cancel B / L / W / A",
  "Space : pause     T : speed 1x / 2x     N (planning) : new random city",
  "Wheel / + - : zoom   Arrows / middle-drag : pan   0 : reset view",
  "H : low buildings (see behind blocks)"
];

function uiSquadDesc(g, s) {
  var n = 0, i, txt;
  for (i = 0; i < g.officers.length; i++) if (g.officers[i].squad === s) n++;
  txt = n + " officers";
  for (i = 0; i < g.vehicles.length; i++) {
    if (g.vehicles[i].squad === s) {
      txt += " + " + (g.vehicles[i].type === "car" ? "police car"
        : (g.vehicles[i].type === "barriertruck" ? "barrier truck" : "water truck"));
    }
  }
  return txt;
}

function uiTruck(g) {
  for (var i = 0; i < g.vehicles.length; i++) {
    if (g.vehicles[i].type === "watertruck") return g.vehicles[i];
  }
  return null;
}

function uiLoadoutNames() {
  var defs = CONFIG.loadouts || {}, names = [];
  for (var name in defs) {
    if (Object.prototype.hasOwnProperty.call(defs, name)) names.push(name);
  }
  return names;
}

function uiBudgetUsed(g) {
  var defs = CONFIG.loadouts || {}, total = 0;
  if (!g.squadLoadouts) return 0;
  for (var i = 0; i < g.squadLoadouts.length; i++) {
    var def = defs[g.squadLoadouts[i]];
    total += def ? (def.cost || 0) : 0;
  }
  return total;
}

function uiCycleLoadout() {
  var names = uiLoadoutNames();
  if (!names.length) return;
  var current = Police.getLoadout(G, UI.selected);
  var start = names.indexOf(current);
  for (var step = 1; step <= names.length; step++) {
    var name = names[(start + step) % names.length];
    if (Police.setLoadout(G, UI.selected, name)) {
      UI.say("Squad " + (UI.selected + 1) + " loadout: " + name);
      return;
    }
  }
  UI.say("No loadout fits the budget");
}

function uiSquadStamina(g, s) {
  var min = -1;
  for (var i = 0; i < g.officers.length; i++) {
    var o = g.officers[i];
    if (o.squad !== s) continue;
    var v = (typeof o.stamina === "number") ? o.stamina : 100;
    if (min < 0 || v < min) min = v;
  }
  return min < 0 ? 100 : Math.round(min);
}

function uiLoadoutPanel(ctx, g) {
  var lineH = 14;
  var x = 6, y = 28, w = 168;
  var rows = g.squadLoadouts ? g.squadLoadouts.length : 0;
  var h = 20 + rows * lineH;
  ctx.save();
  ctx.fillStyle = "rgba(8,10,16,0.72)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#3a4a60";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 10px Consolas, monospace";
  ctx.fillStyle = "#9fe0a0";
  ctx.fillText("Budget used " + uiBudgetUsed(g) + " / " + (CONFIG.loadoutBudget || 10), x + 6, y + 4);
  ctx.font = "10px Consolas, monospace";
  for (var i = 0; i < rows; i++) {
    var ty = y + 4 + (i + 1) * lineH;
    var selected = (i === UI.selected);
    if (selected) {
      ctx.fillStyle = "rgba(255,216,102,0.18)";
      ctx.fillRect(x + 2, ty - 2, w - 4, lineH);
    }
    ctx.fillStyle = selected ? "#ffd866" : "#d7dde8";
    var st = uiSquadStamina(g, i);
    ctx.fillText("S" + (i + 1) + " " + g.squadLoadouts[i] + "  stam " + st + (selected ? "  <" : ""), x + 8, ty);
  }
  ctx.restore();
}

function uiPlanningLayer(ctx, g) {
  var ts = CONFIG.tileSize, x, y;
  var zones = CONFIG.spawnZones || [MAP.crowdSpawn];
  var bs = CONFIG.blockSites || [], bi, zi, cs;
  uiGround(ctx, true);
  if (UI.mode !== "barrier") {
    ctx.fillStyle = "rgba(60,190,100,0.22)";
    for (y = 0; y < MAP.height; y++) {
      for (x = 0; x < MAP.width; x++) {
        if (Police.canDeploy(g, x, y)) ctx.fillRect(x * ts, y * ts, ts, ts);
      }
    }
  }
  ctx.lineWidth = 2;
  for (zi = 0; zi < zones.length; zi++) {
    cs = zones[zi];
    ctx.fillStyle = "rgba(230,57,70,0.18)";
    ctx.fillRect(cs.x * ts, cs.y * ts, cs.w * ts, cs.h * ts);
    ctx.strokeStyle = "#e63946";
    ctx.strokeRect(cs.x * ts + 1, cs.y * ts + 1, cs.w * ts - 2, cs.h * ts - 2);
  }
  var rz = CONFIG.rallyZones || [], ri, rt;
  ctx.fillStyle = "rgba(240,140,0,0.16)";
  for (ri = 0; ri < rz.length; ri++) {
    if (rz[ri].plaza) continue;
    for (rt = 0; rt < rz[ri].tiles.length; rt++) ctx.fillRect(rz[ri].tiles[rt].x * ts, rz[ri].tiles[rt].y * ts, ts, ts);
  }
  ctx.strokeStyle = "#f08c00";
  ctx.setLineDash([4, 3]);
  for (bi = 0; bi < bs.length; bi++) {
    ctx.strokeRect(bs[bi].x * ts + 1, bs[bi].y * ts + 1, bs[bi].w * ts - 2, bs[bi].h * ts - 2);
  }
  ctx.setLineDash([]);
  if (UI.hover) {
    var ok = (UI.mode === "barrier")
      ? Police.isWalkable(g, UI.hover.x, UI.hover.y)
      : Police.canDeploy(g, UI.hover.x, UI.hover.y);
    ctx.strokeStyle = ok ? "#1fae4b" : "#e03131";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(UI.hover.x * ts + 1, UI.hover.y * ts + 1, ts - 2, ts - 2);
  }
  uiGround(ctx, false);
  for (zi = 0; zi < zones.length; zi++) {
    cs = zones[zi];
    uiLabel(ctx, "CROWD ENTERS: " + (cs.name || "HERE"), cs.x + cs.w / 2, cs.y + cs.h / 2,
      "#ff8a80", "bold 11px Consolas, monospace");
  }
  uiLabel(ctx, "PLAZA - the crowd's goal", MAP.plazaCenter.x + 0.5, MAP.plazaCenter.y + 0.5,
    "#ffffff", "bold 11px Consolas, monospace");
  for (ri = 0; ri < rz.length; ri++) {
    if (rz[ri].plaza) continue;
    uiLabel(ctx, rz[ri].name + " - crowd gathers", rz[ri].x + 0.5, rz[ri].y + 0.5, "#ffb74d", "bold 10px Consolas, monospace");
  }
  for (bi = 0; bi < bs.length; bi++) {
    uiLabel(ctx, "BLOCKADE", bs[bi].x + bs[bi].w / 2, bs[bi].y + bs[bi].h / 2,
      "#ffb74d", "bold 10px Consolas, monospace");
  }
  uiLoadoutPanel(ctx, g);
}

UI.draw = function (ctx, g) {
  var ts = CONFIG.tileSize, w = MAP.width * ts, h = MAP.height * ts, i;

  if (UI.screen === "title") {
    uiOverlay(ctx, "Police vs Protestors", [
      "Protesters pour out of houses and side streets and occupy the city.",
      "Hidden rioters and looters hit the shopping streets. Find and arrest them.",
      "Wrong arrests anger the crowd. Packed streets slow your squads down.",
      "The match lasts " + (CONFIG.matchSeconds / 60) + " minutes.",
      "",
      "#HOW IT WORKS",
      "1. PLANNING: place your squads on the streets, add barriers.",
      "2. Press Enter in planning to start the match.",
      "3. During the match, command squads and use your tools.",
      "",
      "#CONTROLS"
    ].concat(UI_CONTROLS), "Press Enter to go to planning");
    return;
  }

  if (UI.screen === "planning") uiPlanningLayer(ctx, g);

  // Selected squad ring + move target marker
  var first = null;
  uiGround(ctx, true);
  ctx.strokeStyle = "#ffc107";
  ctx.lineWidth = 2;
  for (i = 0; i < g.officers.length; i++) {
    var o = g.officers[i];
    if (o.squad !== UI.selected) continue;
    if (!first) first = o;
    ctx.beginPath();
    ctx.arc(o.x * ts, o.y * ts, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (first && first.arrestTarget && first.arrestTarget.active) {
    ctx.strokeStyle = "#e03131";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(first.arrestTarget.x * ts, first.arrestTarget.y * ts, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#ffc107";
  }
  if (first) {
    var mx = first.homeX * ts, my = first.homeY * ts;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(mx - 7, my); ctx.lineTo(mx + 7, my);
    ctx.moveTo(mx, my - 7); ctx.lineTo(mx, my + 7);
    ctx.stroke();
  }
  if (UI.screen === "playing" && UI.hover) {
    ctx.strokeStyle = UI.mode ? "#e8590c" : "rgba(40,60,90,0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(UI.hover.x * ts + 1, UI.hover.y * ts + 1, ts - 2, ts - 2);
  }
  uiGround(ctx, false);

  // Top bar
  var top;
  if (UI.screen === "planning") {
    top = "PLANNING - the match has not started, time is frozen" +
      (MAP.seed !== undefined ? "   City #" + MAP.seed + "  (N = new random city)" : "");
  } else {
    var mood = (typeof Crowd !== "undefined") ? Crowd.averageMood(g) : 0;
    var onStreet = 0;
    for (i = 0; i < g.agents.length; i++) if (g.agents[i].active) onStreet++;
    top = "Time " + uiMmss(CONFIG.matchSeconds - g.time) +
      "  Crowd " + onStreet +
      "  Mood " + mood.toFixed(0) +
      "  Arrested " + g.stats.rioterArrested + "/" + (g.rioterTotal || CONFIG.rioterCount) +
      "  Wrong " + g.stats.wrongArrests +
      "  Shops hit " + g.stats.shopsDamaged + "/" + g.shops.length;
  }
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, w, 24);
  ctx.font = "13px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#9fe0a0";
  ctx.fillText(top, 8, 12);

  // Bottom bar
  var stance = first ? first.stance : "-";
  var left = Police.barrierStock(g, UI.selected);
  var bot;
  if (UI.screen === "planning") {
    bot = "Squad " + (UI.selected + 1) + " (" + Police.getLoadout(g, UI.selected) + "): " + uiSquadDesc(g, UI.selected) +
      "  | click squad = select | click green street = place | V loadout | right-click/B barrier (" + left + " left) | N new city | Enter START" +
      (UI.mode ? "  [click to place: " + UI.mode.toUpperCase() + "]" : "");
  } else {
    var loud = Math.max(0, g.loudspeakerReadyAt - g.time);
    var truck = uiTruck(g);
    var water = "";
    if (truck) {
      var wl = Math.max(0, truck.readyAt - g.time);
      water = "  Water " + (wl > 0 ? wl.toFixed(0) + "s" : "READY");
    }
    bot = "Squad " + (UI.selected + 1) + " (" + stance + ", " + uiSquadDesc(g, UI.selected) + ")" +
      "  Barriers left " + left +
      "  Loudspeaker " + (loud > 0 ? loud.toFixed(0) + "s" : "READY") + water +
      "  " + UI.Game.speed + "x" +
      "  | right-click = tool  A arrest  F shove" +
      (UI.mode ? "  [click: " + UI.mode.toUpperCase() + "]" : "");
  }
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, h - 24, w, 24);
  ctx.fillStyle = "#d7dde8";
  ctx.fillText(bot, 8, h - 12);

  if (Date.now() < UI.msgUntil) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff8a80";
    ctx.fillText(UI.msg, w / 2, h - 40);
  }

  if (UI.Game.paused && UI.screen === "playing") {
    uiOverlay(ctx, "PAUSED", UI_CONTROLS, "Press Space to resume");
  }

  if (UI.screen === "over") {
    var s = g.stats;
    uiOverlay(ctx, "Debrief", [
      "Match ended: " + g.endReason,
      "",
      "Rioters arrested: " + s.rioterArrested + " / " + (g.rioterTotal || CONFIG.rioterCount),
      "Wrong arrests: " + s.wrongArrests,
      "Shops damaged: " + s.shopsDamaged + " / " + g.shops.length,
      "Peak mood: " + s.peakMood.toFixed(0)
    ], "Press R to replay this city");
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = UI;
