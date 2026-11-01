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
  if (k === "0") n = 10;   /* reinforcement squads 7-10 use keys 7, 8, 9, 0 */
  if (n >= 1 && n <= CONFIG.squadCount) { UI.selected = n - 1; UI.selVehicle = false; return true; }
  return false;
}

UI.init = function (g, game) {
  UI.Game = game;

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) {   /* settings / guide screen takes all keys */
      SETTINGS.key(k);
      if (!SETTINGS.isOpen()) uiSettingsClosed();
      e.preventDefault(); return;
    }
    if ((k === "?" || k === "F1") && typeof HELP !== "undefined" && UI.screen !== "title") {
      HELP.toggle(); e.preventDefault(); return;
    }
    if ((k === "j" || k === "J") && typeof MINIMAP !== "undefined" && (UI.screen === "planning" || UI.screen === "playing")) {
      MINIMAP.toggle(); e.preventDefault(); return;   /* show / hide the radar */
    }
    if (UI.menuOpen) {   /* in-game menu: Esc/Enter resume, S settings, R restart, M main menu */
      if (k === "Escape" || e.code === "Enter") uiMenuAction("resume");
      else if (k === "s" || k === "S") uiMenuAction("settings");
      else if (k === "r" || k === "R") uiMenuAction("restart");
      else if (k === "m" || k === "M") uiMenuAction("main");
      e.preventDefault();
      return;
    }
    if (k === "Escape" && !UI.mode && (UI.screen === "planning" || UI.screen === "playing") &&
        !(typeof REINFORCE !== "undefined" && REINFORCE.menuOpen())) { uiMenuAction("open"); return; }
    if ((k === "q" || k === "Q") && typeof QUALITY !== "undefined") {
      QUALITY.cycle(); UI.say(QUALITY.label()); return;
    }
    if (k === "Tab" && (UI.screen === "planning" || UI.screen === "playing") && CONFIG.squadCount > 0) {
      /* Tab / Shift+Tab: next / previous squad (big maps have more squads than number keys) */
      UI.selected = (UI.selected + (e.shiftKey ? CONFIG.squadCount - 1 : 1)) % CONFIG.squadCount;
      UI.selVehicle = false; UI.say("Squad " + (UI.selected + 1) + " selected");
      e.preventDefault(); return;
    }
    if (UI.screen === "title") {
      if (typeof LEVELS !== "undefined") {
        if (k === "ArrowRight") LEVELS.next();
        else if (k === "ArrowLeft") LEVELS.prev();
        else if (k >= "1" && k <= "4" && k.length === 1) LEVELS.set(LEVELS.list()[+k - 1].id);
      }
      if ((k === "m" || k === "M") && typeof CityGen !== "undefined") {
        UI.say("Map: " + CityGen.nextMap(e.shiftKey ? -1 : 1).name);
        restartGame(false);
        UI.screen = "title";
      }
      if ((k === "s" || k === "S") && typeof SETTINGS !== "undefined") SETTINGS.open("settings");
      if (e.code === "Enter") { uiStartLevel(); e.preventDefault(); }
      return;
    }
    if (UI.screen === "over") {
      if (k === "r" || k === "R") restartGame();
      else if (k === "m" || k === "M") { UI.screen = "title"; }
      else if ((k === "n" || k === "N") && typeof CityGen !== "undefined") { restartGame(true); UI.say("Map: " + MAP.realName); }
      return;
    }
    if (UI.screen === "planning") {
      if (e.code === "Enter") { uiStartPlay(); e.preventDefault(); }
      else if (typeof FORCE !== "undefined" && FORCE.isOpen() && k !== "Tab" && FORCE.key(k)) { e.preventDefault(); }   /* planner cards */
      else if (uiOrderKey(e, k)) { /* standing orders */ }
      else if (uiSelectKey(k)) { /* squad selected */ }
      else if ((k === "v" || k === "V") && typeof FORCE !== "undefined") { FORCE.toggle(); }
      else if (k === "v" || k === "V") { uiCycleLoadout(); }
      else if (k === "b" || k === "B") { UI.mode = "barrier"; }
      else if ((k === "n" || k === "N") && typeof CityGen !== "undefined") { restartGame(true); UI.say("Map: " + MAP.realName); }
      else if (k === "Escape") { UI.mode = null; }
      return;
    }
    // playing
    if (e.code === "Space") { UI.Game.paused = !UI.Game.paused; e.preventDefault(); return; }
    /* reinforcements menu: R opens, 1-4 picks, then click a destination */
    if (typeof REINFORCE !== "undefined" && !UI.Game.paused) {
      if (k === "r" || k === "R") { REINFORCE.toggleMenu(); return; }
      if (REINFORCE.menuOpen()) {
        if (k === "Escape") { REINFORCE.cancel(); return; }
        var rn = parseInt(k, 10);
        if (rn >= 1 && rn <= 4) {
          var cr = REINFORCE.choose(rn);
          UI.say(cr === "pick" ? "Click on the map where they should go" : (cr === "points" ? "Not enough reinforcement points" : "No more squads available"));
          return;
        }
      }
    }
    if (k === "t" || k === "T") { UI.Game.speed = UI.Game.speed === 1 ? 2 : 1; return; }
    if (UI.Game.paused) return;
    if (uiOrderKey(e, k)) { /* standing orders */ }
    else if (uiSelectKey(k)) { /* squad selected */ }
    else if (k === "s" || k === "S") { Police.toggleStance(G, UI.selected); }
    else if ((k === "m" || k === "M") && typeof DISPERSE !== "undefined") {
      if (e.shiftKey || !DISPERSE.exitOf(G)) { UI.mode = "exit"; UI.say("Click near the map edge where the crowd should leave"); }
      else {
        var dv = (typeof TRANSPORT !== "undefined") ? TRANSPORT.vehicleOf(G, UI.selected) : null;
        var dr = DISPERSE.order(G, UI.selected, dv ? dv.x : 0, dv ? dv.y : 0);
        UI.say(dr === "ok" ? "Dispersal ordered - calm people will leave by the exit" : (dr === "nocar" ? "Needs a squad with a car, van or truck (loudspeaker)"
          : (dr === "busy" ? "A dispersal order is already running" : "Set an exit first (Shift+M)")));
      }
    }
    else if ((k === "p" || k === "P") && typeof LINES !== "undefined") { UI.mode = "line"; UI.say("Click across a street: squad " + (UI.selected + 1) + " forms a police line there (max 7 tiles wide)"); }
    else if ((k === "c" || k === "C") && typeof LINES !== "undefined") { UI.mode = "checkpoint"; UI.say("Click a street: squad " + (UI.selected + 1) + " stops and searches people passing there"); }
    else if ((k === "e" || k === "E") && typeof TRANSPORT !== "undefined") {
      var tr = TRANSPORT.toggle(G, UI.selected);
      UI.say(tr === "novehicle" ? "Squad " + (UI.selected + 1) + " has no vehicle to ride in"
        : (tr === "boarding" ? "Squad " + (UI.selected + 1) + " getting in - click a destination to drive"
        : (tr === "dismount" ? "Squad " + (UI.selected + 1) + " gets out" : "Boarding cancelled")));
    }
    else if ((k === "u" || k === "U") && typeof TRANSPORT !== "undefined") {
      UI.say(TRANSPORT.sendToStation(G, UI.selected) ? "Taking the arrested people to the station" : "No arrested people in this vehicle");
    }
    else if (k === "b" || k === "B") { UI.mode = "barrier"; }
    else if ((k === "l" || k === "L" || k === "w" || k === "W") && typeof METERS !== "undefined") {
      if (!e.repeat && UI.hover) uiMeterStart(UI.hover);   /* hold the key to keep using it */
    }
    else if (k === "l" || k === "L") { UI.mode = "loudspeaker"; }
    else if (k === "w" || k === "W") { UI.mode = "water"; }
    else if ((k === "g" || k === "G") && typeof GAS !== "undefined") { UI.mode = "gas"; }
    else if ((k === "k" || k === "K") && typeof TACT !== "undefined") {
      if (TACT.kettleActive()) { TACT.release(G); UI.mode = null; }
      else { UI.mode = "kettle"; UI.say("Click the centre of the group to kettle (needs 2 squads with 3+ officers nearby)"); }
    }
    else if ((k === "d" || k === "D") && typeof UNITS !== "undefined") { UI.mode = "drone"; UI.say("Click where the drone should watch (spots violent people from above)"); }
    else if ((k === "x" || k === "X") && typeof TACT !== "undefined") { UI.mode = "snatch"; UI.say("Click a person: 2 officers dash in and grab them"); }
    else if (k === "a" || k === "A") { UI.mode = "arrest"; }
    else if (k === "f" || k === "F") {
      var sr = Police.shove(G, UI.selected);
      if (sr === "cooldown") UI.say("Squad " + (UI.selected + 1) + " needs a moment before shoving again");
      else if (sr === "none") UI.say("No free officers in that squad");
    }
    else if (k === "Escape") { UI.mode = null; }
  });

  /* releasing W / L stops the held water cannon / loudspeaker */
  window.addEventListener("keyup", function (e) {
    var k = e.key;
    if ((k === "w" || k === "W" || k === "l" || k === "L") && typeof METERS !== "undefined") METERS.stop(G);
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
    if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) return;   /* handled on mouseup */
    if (e.button === 0) {
      if (typeof MINIMAP !== "undefined" && (UI.screen === "planning" || UI.screen === "playing")) {
        var mml = UI.toLogical(e);
        if (MINIMAP.mouseDown(mml.x, mml.y)) { UI._mini = true; return; }   /* minimap: jump / drag the view */
      }
      UI._press = { x: e.clientX, y: e.clientY, drag: false };
    } else if (e.button === 2) {
      e.preventDefault();
      uiRightClick(e);
    }
  });
  window.addEventListener("mousemove", function (e) {
    if (UI._mini) { var mmv = UI.toLogical(e); MINIMAP.mouseMove(mmv.x, mmv.y); return; }
    if (typeof METERS !== "undefined" && METERS.using(G)) { var mt = UI.toTile(e); METERS.aim(G, mt.x + 0.5, mt.y + 0.5); }
    /* tear gas aiming: range circle and target cross */
    if (typeof TACT !== "undefined") {
      if (UI.mode === "kettle") { var kt = UI.toTile(e); TACT.preview = { mode: "kettle", x: kt.x + 0.5, y: kt.y + 0.5 }; }
      else if (UI.mode === "snatch") TACT.preview = { mode: "snatch", s: UI.selected };
      else TACT.preview = null;
    }
    if (typeof GAS !== "undefined") {
      if (UI.mode === "gas") { var gt = UI.toTile(e); GAS.preview = { s: UI.selected, x: gt.x + 0.5, y: gt.y + 0.5 }; }
      else GAS.preview = null;
    }
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
    if (e.button === 2 && typeof METERS !== "undefined") METERS.stop(G);
    if (UI._mini && e.button === 0) { UI._mini = false; MINIMAP.mouseUp(); return; }
    if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) {
      if (e.button === 0 && e.target === cv) { var sp = UI.toLogical(e); SETTINGS.click(sp.x, sp.y); if (!SETTINGS.isOpen()) uiSettingsClosed(); }
      UI._press = null; return;
    }
    if (e.button !== 0 || !UI._press) return;
    var wasDrag = UI._press.drag;
    UI._press = null;
    cv.style.cursor = "default";
    if (!wasDrag && e.target === cv && (UI.screen === "planning" || UI.screen === "playing")) {
      var mp = UI.toLogical(e);
      if (uiMenuClick(mp.x, mp.y)) return;
    }
    if (!wasDrag && e.target === cv) {
      var hp = UI.toLogical(e);
      if (typeof HELP !== "undefined" && UI.screen !== "title" && HELP.hit(hp.x, hp.y)) HELP.toggle();
      else uiLeftClick(e);
    }
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
  UI._pickVeh = false;
  for (i = 0; i < G.vehicles.length; i++) {
    d = uiScreenDist(lp, G.vehicles[i].x, G.vehicles[i].y, 0.4) * 0.7;
    if (d < bestD) { bestD = d; best = G.vehicles[i].squad; UI._pickVeh = true; }
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
function uiGas(t) {
  var r = GAS.launch(G, UI.selected, t.x + 0.5, t.y + 0.5);
  if (r === "none") UI.say("Squad " + (UI.selected + 1) + " has no tear gas left");
  else if (r === "cooldown") UI.say("Tear gas reloading");
  else if (r === "range") UI.say("Too far to throw tear gas from squad " + (UI.selected + 1));
  else {
    UI.say("Tear gas out: it angers everyone it hits, peaceful people too");
    if (typeof MEDIA !== "undefined") MEDIA.report(G, "gas", t.x + 0.5, t.y + 0.5);
  }
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

/* Send squad s to (x, y): drive alone if only its vehicle is selected, ride if the squad
 * is aboard, get in and drive when the trip is long, otherwise walk (the vehicle follows). */
function uiSquadGo(s, x, y, run) {
  if (typeof LINES !== "undefined") LINES.onManualMove(G, s);   /* a move order releases a line / checkpoint */
  if (typeof TRANSPORT !== "undefined") {
    if (TRANSPORT.drive(G, s, x, y)) return;
    if (UI.selVehicle && TRANSPORT.driveEmpty(G, s, x, y)) return;
    var v = TRANSPORT.vehicleOf(G, s);
    if (v && TRANSPORT.seats(v.type).crew > 0) {
      var n = 0, cx = 0, cy = 0;
      for (var i = 0; i < G.officers.length; i++) {
        var o = G.officers[i];
        if (o.squad === s && !o.escorting) { cx += o.x; cy += o.y; n++; }
      }
      if (n) {
        cx /= n; cy /= n;
        var far = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) > (CONFIG.autoRideDistance || 12);
        var near = Math.sqrt((v.x - cx) * (v.x - cx) + (v.y - cy) * (v.y - cy)) < 6;
        if (far && near && TRANSPORT.toggle(G, s) === "boarding") {
          TRANSPORT.drive(G, s, x, y);
          UI.say("Squad " + (s + 1) + " gets in and drives there");
          return;
        }
      }
    }
  }
  Police.moveSquad(G, s, x, y, run);
}

/* ---------- in-game menu ---------- */
var UI_MENU = { btn: null, items: [] };
function uiMenuAction(a) {
  if (a === "open") { UI.menuOpen = true; UI._menuWasPaused = UI.Game.paused; UI.Game.paused = true; return; }
  if (a === "settings") { if (typeof SETTINGS !== "undefined") SETTINGS.open("settings"); return; }   /* menu stays open behind it */
  UI.menuOpen = false;
  UI.Game.paused = !!UI._menuWasPaused && a === "resume";
  if (a === "restart") restartGame(false);
  else if (a === "main") { restartGame(false); UI.screen = "title"; }
}
function uiMenuClick(x, y) {
  function inR(r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  if (UI.menuOpen) {
    for (var i = 0; i < UI_MENU.items.length; i++) if (inR(UI_MENU.items[i])) { uiMenuAction(UI_MENU.items[i].a); return true; }
    return true;   /* clicks outside the panel do nothing while the menu is open */
  }
  if (inR(UI_MENU.btn)) { uiMenuAction("open"); return true; }
  return false;
}
function uiDrawMenu(ctx, w, h) {
  var k = (MAP.width * CONFIG.tileSize) / (parseFloat(UI.Game.canvas.style.width) || (MAP.width * CONFIG.tileSize));
  /* MENU button at the right end of the top bar */
  ctx.save();
  ctx.font = "bold " + Math.round(12 * k) + "px Consolas, monospace";
  var bw = Math.max(Math.round(60 * k), Math.ceil(ctx.measureText("MENU").width) + 16), bh = 20;
  UI_MENU.btn = { x: w - bw - 6, y: 2, w: bw, h: bh };
  ctx.fillStyle = "#2a3a55"; ctx.fillRect(UI_MENU.btn.x, 2, bw, bh);
  ctx.strokeStyle = "#5a6f92"; ctx.lineWidth = 1; ctx.strokeRect(UI_MENU.btn.x + 0.5, 2.5, bw - 1, bh - 1);
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("MENU", UI_MENU.btn.x + bw / 2, 12);
  if (UI.menuOpen) {
    ctx.fillStyle = "rgba(6,8,14,0.6)"; ctx.fillRect(0, 0, w, h);
    var pw = Math.round(320 * k), ih = Math.round(44 * k), gap = Math.round(10 * k);
    var ph = Math.round(60 * k) + 4 * (ih + gap), px = (w - pw) / 2, py = (h - ph) / 2;
    ctx.fillStyle = "rgba(14,18,28,0.96)"; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = "#3a4a60"; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = "#9fe0a0"; ctx.font = "bold " + Math.round(18 * k) + "px Consolas, monospace";
    ctx.fillText("PAUSED", w / 2, py + Math.round(28 * k));
    var labels = [["Resume  (Esc)", "resume", "#2a9d8f"], ["Settings & guide  (S)", "settings", "#2a3a55"], ["Restart this city  (R)", "restart", "#3a4a60"], ["Main menu  (M)", "main", "#7a3a3a"]];
    UI_MENU.items = [];
    ctx.font = "bold " + Math.round(14 * k) + "px Consolas, monospace";
    for (var i = 0; i < labels.length; i++) {
      var r = { x: px + gap * 2, y: py + Math.round(52 * k) + i * (ih + gap), w: pw - gap * 4, h: ih, a: labels[i][1] };
      UI_MENU.items.push(r);
      ctx.fillStyle = labels[i][2]; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#ffffff"; ctx.fillText(labels[i][0], r.x + r.w / 2, r.y + r.h / 2);
    }
  }
  ctx.restore();
}

/* Planning -> live play. */
function uiStartPlay() {
  UI.screen = "playing"; UI.mode = null;
  if (typeof ORDERS !== "undefined") ORDERS.startPlay(G);
}

/* Leave the title screen; rebuild the crowd when the difficulty changed. */
function uiStartLevel() {
  if (typeof LEVELS !== "undefined" && CONFIG._levelId !== LEVELS.current().id) restartGame(false);
  UI.screen = "planning";
}

function uiLeftClick(e) {
  if (UI.screen === "title" && typeof LEVELS !== "undefined") {
    var lp = UI.toLogical(e), id = LEVELS.hit(lp.x, lp.y);
    if (id) { if (id === LEVELS.current().id) uiStartLevel(); else LEVELS.set(id); }
    return;
  }
  if (UI.screen === "title" || UI.screen === "over") return;
  var t = UI.toTile(e);
  if (UI.screen === "playing" && typeof REINFORCE !== "undefined" && REINFORCE.pending()) {
    var ro = REINFORCE.order(G, t.x, t.y);
    UI.say(ro === "ok" ? "Reinforcements on the way" : (ro === "points" ? "Not enough reinforcement points"
      : (ro === "max" ? "No more squads can be called" : "They cannot go there - pick a street")));
    return;
  }
  if (UI.screen === "planning") {
    if (typeof FORCE !== "undefined") { var flp = UI.toLogical(e); if (FORCE.click(flp.x, flp.y)) return; }
    var sq0 = UI.mode ? -1 : UI.pickSquad(e);
    if (sq0 >= 0) { UI.selected = sq0; return; }
    if (uiOrderClick(t)) return;
    if (UI.mode === "barrier") { uiBarrier(t); UI.mode = null; }
    else if (!Police.deploySquad(G, UI.selected, t.x + 0.5, t.y + 0.5)) {
      UI.say("Place squads on street tiles (green), away from the crowd entry");
    }
    else if (typeof ORDERS !== "undefined") ORDERS.onManualMove(G, UI.selected, t.x + 0.5, t.y + 0.5);
    return;
  }
  if (UI.Game.paused) return;
  if (!UI.mode) {
    var sq = UI.pickSquad(e);
    if (sq >= 0) {
      /* clicking the vehicle selects only the vehicle; clicking an officer selects the squad */
      var aboard = typeof TRANSPORT !== "undefined" && (TRANSPORT.isAboard(G, sq) || TRANSPORT.isBoarding(G, sq));
      UI.selVehicle = UI._pickVeh && !aboard;
      UI.selected = sq;
      if (UI.selVehicle) UI.say("Squad " + (sq + 1) + " vehicle selected - click to drive it alone (click an officer to select the squad)");
      return;
    }
  }
  if (uiOrderClick(t)) return;
  if (UI.mode === "barrier") uiBarrier(t);
  else if (UI.mode === "loudspeaker") uiLoud(t);
  else if (UI.mode === "water") uiWater(t);
  else if (UI.mode === "gas") uiGas(t);
  else if (UI.mode === "drone") {
    var dr = UNITS.droneTo(G, t.x + 0.5, t.y + 0.5);
    if (dr === "cooldown") UI.say("Drone is recharging");
  }
  else if (UI.mode === "kettle") {
    var kr = TACT.kettle(G, t.x + 0.5, t.y + 0.5);
    if (kr === "few") UI.say("Kettling needs at least 2 squads with 3+ foot officers within reach");
    else if (kr === "ok") UI.say("Squads moving to encircle - mood inside will rise. K again to release");
  }
  else if (UI.mode === "snatch") {
    var sa = UI.pickAgent(e);
    if (!sa) UI.say("Click right on a person to snatch them");
    else {
      var sr2 = TACT.snatch(G, UI.selected, sa);
      if (sr2 === "none") UI.say("Squad " + (UI.selected + 1) + " needs 2 free foot officers for a snatch");
      else if (sr2 === "busy") UI.say("Squad " + (UI.selected + 1) + " already has a snatch running");
      else if (sr2 === "far") UI.say("Too far for a snatch from squad " + (UI.selected + 1));
      else UI.say("Snatch squad going in (a peaceful person = wrong arrest)");
    }
  }
  else if (UI.mode === "arrest") uiArrest(e);
  else if (UI.mode === "exit" && typeof DISPERSE !== "undefined") {
    DISPERSE.setExit(G, t.x, t.y);
    UI.say(DISPERSE.exitOf(G) ? "Exit set - press M with a car/van squad to order the crowd to disperse" : "No exit there - click nearer the map edge");
  }
  else if (UI.mode === "line" && typeof LINES !== "undefined") {
    var lr = LINES.formLine(G, UI.selected, t.x, t.y);
    UI.say(lr === "ok" ? "Squad " + (UI.selected + 1) + " moving into a police line" : (lr === "wide" ? "Too wide to seal - pick a narrower street"
      : (lr === "role" ? "This squad cannot form a line" : "Pick a street tile")));
  }
  else if (UI.mode === "checkpoint" && typeof LINES !== "undefined") {
    var cr2 = LINES.checkpoint(G, UI.selected, t.x, t.y);
    UI.say(cr2 === "ok" ? "Squad " + (UI.selected + 1) + " sets up a checkpoint" : (cr2 === "role" ? "This squad cannot run a checkpoint" : "Pick a street tile"));
  }
  else if (!Police.isWalkable(G, t.x, t.y)) UI.say("Squad cannot go there");
  else {
    uiSquadGo(UI.selected, t.x + 0.5, t.y + 0.5, !!e.shiftKey);
    if (typeof ORDERS !== "undefined") ORDERS.onManualMove(G, UI.selected, t.x + 0.5, t.y + 0.5);
  }
  UI.mode = null;
}

/* Standing orders (orders.js): O cycles the selected squad's order, Y adds
 * patrol points, Z sets its trigger zone, Shift+H/G/R/A orders every squad. */
function uiOrderKey(e, k) {
  if (typeof ORDERS === "undefined") return false;
  var s = UI.selected;
  if (e.shiftKey) {
    var all = { H: "hold", G: "guard", R: "retreat", A: "auto" }[k.toUpperCase()];
    if (all) { ORDERS.setAll(G, all); UI.say("All squads: " + all.toUpperCase()); return true; }
    if (k === "Y" || k === "y") { ORDERS.clearWaypoints(G, s); UI.say("Squad " + (s + 1) + " patrol route cleared"); return true; }
    if (k === "Z" || k === "z") { ORDERS.clearTrigger(G, s); UI.say("Squad " + (s + 1) + " trigger zone removed"); return true; }
    return false;
  }
  if (k === "o" || k === "O") {
    var name = ORDERS.cycle(G, s);
    if (name === "push") { UI.mode = "pushTarget"; UI.say("Squad " + (s + 1) + " PUSH: click the line to push to"); }
    else if (name === "patrol" && ORDERS.get(G, s).waypoints.length < 2) { UI.mode = "waypoint"; UI.say("Squad " + (s + 1) + " PATROL: click 2-6 route points, Esc when done"); }
    else UI.say("Squad " + (s + 1) + " order: " + name.toUpperCase());
    return true;
  }
  if (k === "y" || k === "Y") { UI.mode = "waypoint"; UI.say("Click patrol points for squad " + (s + 1) + " (Esc when done, Shift+Y clears)"); return true; }
  if (k === "z" || k === "Z") { UI.mode = "trigger"; UI.say("Click the centre of squad " + (s + 1) + "'s trigger zone: it responds to trouble there"); return true; }
  return false;
}
/* Returns true when the click was used by an order mode. */
function uiOrderClick(t) {
  if (typeof ORDERS === "undefined") return false;
  var s = UI.selected, x = t.x + 0.5, y = t.y + 0.5;
  if (UI.mode === "pushTarget") {
    if (!Police.isWalkable(G, t.x, t.y)) { UI.say("Pick a street tile to push to"); return true; }
    ORDERS.setTarget(G, s, x, y); UI.mode = null; UI.say("Squad " + (s + 1) + " pushing forward (firm, shoves when packed)");
    return true;
  }
  if (UI.mode === "waypoint") {
    if (!Police.isWalkable(G, t.x, t.y)) { UI.say("Patrol points must be on the street"); return true; }
    ORDERS.addWaypoint(G, s, x, y);
    var n = ORDERS.get(G, s).waypoints.length;
    if (n >= 2 && ORDERS.get(G, s).order !== "patrol") ORDERS.set(G, s, "patrol");
    UI.say("Patrol point " + n + " set" + (n < 2 ? " - add at least one more" : " (Esc when done)"));
    return true;
  }
  if (UI.mode === "trigger") {
    ORDERS.setTrigger(G, s, x, y, 6); UI.mode = null;
    UI.say("Squad " + (s + 1) + " will respond to shop attacks, violence or barricades in this zone");
    return true;
  }
  return false;
}
function uiOrderHud(g) {
  if (typeof ORDERS === "undefined") return "";
  var o = ORDERS.get(g, UI.selected);
  return "  Order " + o.order.toUpperCase() + (o.responding ? " (responding)" : "") + " [O]";
}

function uiDroneHud(g) {
  if (typeof UNITS === "undefined") return "";
  var d = UNITS.droneState(g);
  if (d.state === "ready") return "  Drone READY [D]";
  if (d.state === "hover" || d.state === "cooldown") return "  Drone " + Math.ceil(d.left) + "s";
  return "  Drone flying";
}
function uiGasHud(g) {
  if (typeof GAS === "undefined") return "";
  var n = GAS.stock(g, UI.selected), cd = GAS.cooldownLeft(g, UI.selected);
  return uiDroneHud(g) + "  Gas " + n + (n > 0 && cd > 0 ? " (" + cd.toFixed(0) + "s)" : "") + " [G]";
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
  if (typeof METERS !== "undefined" && (lo === "watertruck" || lo === "car" || lo === "van" || lo === "truck")) {
    uiMeterStart(t);   /* hold right button: spray / broadcast until released or empty */
  }
  else if (lo === "watertruck") uiWater(t);
  else if (lo === "car") uiLoud(t);
  else if (lo === "barriertruck") uiBarrier(t);
  else if (UI.pickAgent(e)) uiArrest(e);
  else if (Police.isWalkable(G, t.x, t.y)) {
    uiSquadGo(UI.selected, t.x + 0.5, t.y + 0.5, true);
    if (typeof ORDERS !== "undefined") ORDERS.onManualMove(G, UI.selected, t.x + 0.5, t.y + 0.5);
  }
}

/* Start the selected squad's held tool (water cannon or loudspeaker) at tile t. */
function uiMeterStart(t) {
  var r = METERS.start(G, UI.selected, t.x + 0.5, t.y + 0.5);
  if (r === "none") UI.say("Squad " + (UI.selected + 1) + " has no water cannon or loudspeaker");
  else if (r === "empty") UI.say("Empty - wait for the bar to refill");
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
  return y + 20;
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
  "O : cycle the squad's standing order (hold, guard, patrol, push, retreat, auto)",
  "Y then clicks : patrol route   Z then click : trigger zone (Shift+Y / Shift+Z clear)",
  "Shift+H / G / R / A : every squad holds / guards / retreats / goes auto",
  "Space : pause     T : speed 1x / 2x     N (planning) : next map",
  "Wheel / + - : zoom   Arrows / middle-drag : pan   0 : reset view",
  "H : low buildings (see behind blocks)",
  "? or F1 : show / shrink / hide the controls panel (top right)",
  "Q : graphics quality (Auto / High / Medium / Low) - use Low on a slow computer"
];

function uiSquadDesc(g, s) {
  var n = 0, i, txt;
  for (i = 0; i < g.officers.length; i++) if (g.officers[i].squad === s) n++;
  if (typeof TRANSPORT !== "undefined") n += TRANSPORT.crewCount(g, s);   /* riding officers */
  var lo = Police.getLoadout(g, s);
  txt = n + (lo === "mounted" ? " officers on horseback" : (lo === "liaison" ? " liaison officers (talk, never arrest)" : " officers"));
  for (i = 0; i < g.vehicles.length; i++) {
    if (g.vehicles[i].squad === s) {
      var vt = g.vehicles[i].type;
      txt += " + " + (vt === "car" ? "sedan" : (vt === "van" ? "van" : (vt === "truck" ? "riot truck"
        : (vt === "barriertruck" ? "barrier truck" : (vt === "ambulance" ? "ambulance" : "water truck")))));
      if (typeof TRANSPORT !== "undefined" && UI.screen === "playing") txt += " (" + TRANSPORT.status(g, s) + ")";
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
    /* roads keep their normal look; only street tiles where squads may NOT be placed get a faint red */
    ctx.fillStyle = "rgba(220,60,60,0.14)";
    for (y = 0; y < MAP.height; y++) {
      for (x = 0; x < MAP.width; x++) {
        if (Police.isWalkable(g, x, y) && !Police.canDeploy(g, x, y)) ctx.fillRect(x * ts, y * ts, ts, ts);
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
  ctx.fillStyle = "rgba(240,140,0,0.09)";
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
    ctx.fillStyle = ok ? "rgba(31,174,75,0.35)" : "rgba(224,49,49,0.35)";
    ctx.fillRect(UI.hover.x * ts, UI.hover.y * ts, ts, ts);
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
  if (typeof FORCE !== "undefined") FORCE.draw(ctx, MAP.width * CONFIG.tileSize, MAP.height * CONFIG.tileSize);
  else uiLoadoutPanel(ctx, g);
}

/* Big match clock in the top-left corner (sized for the screen, not the canvas). */
function uiClock(ctx, g) {
  var lw = MAP.width * CONFIG.tileSize, cw = parseFloat(UI.Game.canvas.style.width);
  var k = (cw > 0 && isFinite(cw)) ? lw / cw : 1;            /* logical px per CSS px */
  var left = Math.max(0, CONFIG.matchSeconds - g.time);
  var big = Math.round(26 * k), small = Math.round(11 * k), pad = Math.round(8 * k);
  var sub = "time left";
  if (typeof NIGHT !== "undefined" && CONFIG.nightCycle) {
    var t0 = (CONFIG.duskStart !== undefined ? CONFIG.duskStart : 0.4) * CONFIG.matchSeconds;
    if (g.time < t0) sub = "dusk in " + uiMmss(t0 - g.time);
    else sub = NIGHT.darkness(g) > 0.5 ? "night" : "dusk";
  }
  ctx.save();
  ctx.font = "bold " + big + "px Consolas, monospace";
  var txt = uiMmss(left), w = Math.max(ctx.measureText(txt).width, 0) + pad * 2;
  ctx.font = small + "px Consolas, monospace";
  w = Math.max(w, ctx.measureText(sub).width + pad * 2);
  var x = 8, y = 30, h = big + small + pad * 2;
  ctx.fillStyle = "rgba(8,10,16,0.78)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = left < 60 ? "#ff5d5d" : "#3a4a60";
  ctx.lineWidth = Math.max(1, k);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = "bold " + big + "px Consolas, monospace";
  ctx.fillStyle = left < 60 ? (Math.floor(g.time * 2) % 2 ? "#ff5d5d" : "#ffd0d0") : "#ffffff";
  ctx.fillText(txt, x + w / 2, y + pad * 0.6);
  ctx.font = small + "px Consolas, monospace";
  ctx.fillStyle = "#9fb0c4";
  ctx.fillText(sub, x + w / 2, y + pad * 0.6 + big + 2);
  ctx.restore();
}

/* Settings closed: a new map or difficulty rebuilds the city (title stays on the title). */
function uiSettingsClosed() {
  if (!SETTINGS.consumeRestart()) return;
  var scr = UI.screen;
  UI.menuOpen = false;
  restartGame(false);
  if (scr === "title") UI.screen = "title";
  UI.say("Map: " + MAP.realName + (typeof LEVELS !== "undefined" ? "   " + LEVELS.label() : ""));
}

/* One line of text squeezed to maxW (long status bars with big text sizes). */
function uiFitText(ctx, s, x, y, maxW) {
  var tw = ctx.measureText(s).width;
  if (tw > maxW) { ctx.save(); ctx.translate(x, y); ctx.scale(maxW / tw, 1); ctx.fillText(s, 0, 0); ctx.restore(); }
  else ctx.fillText(s, x, y);
}

UI.draw = function (ctx, g) {
  uiDrawScreen(ctx, g);
  if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) SETTINGS.draw(ctx, MAP.width * CONFIG.tileSize, MAP.height * CONFIG.tileSize);
};

function uiDrawScreen(ctx, g) {
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
      "The controls are shown in the top-right corner during the game (? hides them).",
      (MAP.realName ? "Map: " + MAP.realName + "   (M = next map)" : ""),
      "S = settings and full guide"
    ], typeof LEVELS !== "undefined" ? "Choose a difficulty, then press Enter" : "Press Enter to go to planning");
    if (typeof LEVELS !== "undefined") LEVELS.drawPicker(ctx, w, h, 105 + 12 * 22 + 60);
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
    if (UI.selVehicle) continue;   /* only the vehicle is selected */
    ctx.beginPath();
    ctx.arc(o.x * ts, o.y * ts, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (i = 0; i < g.vehicles.length; i++) {
    if (g.vehicles[i].squad !== UI.selected) continue;
    ctx.lineWidth = UI.selVehicle ? 3 : 1;
    ctx.beginPath();
    ctx.arc(g.vehicles[i].x * ts, g.vehicles[i].y * ts, UI.selVehicle ? 22 : 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
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
      (MAP.realName ? "   " + MAP.realName + " (" + MAP.attribution + ")  N = next map" : "") +
      (typeof LEVELS !== "undefined" ? "   " + LEVELS.label() : "");
  } else {
    var mood = (typeof Crowd !== "undefined") ? Crowd.averageMood(g) : 0;
    var onStreet = 0;
    for (i = 0; i < g.agents.length; i++) if (g.agents[i].active) onStreet++;
    top = "Time " + uiMmss(CONFIG.matchSeconds - g.time) +
      "  Crowd " + onStreet +
      "  Mood " + mood.toFixed(0) +
      "  Rioters arrested " + g.stats.rioterArrested +   /* the total stays hidden until the debrief */
      "  Wrong " + g.stats.wrongArrests +
      "  In custody " + (g.stats.delivered || 0) +
      "  Shops hit " + g.stats.shopsDamaged + "/" + g.shops.length +
      (typeof QUALITY !== "undefined" ? "   " + QUALITY.label() + " (Q)" : "");
  }
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, w, 24);
  ctx.font = "13px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#9fe0a0";
  uiFitText(ctx, top, 8, 12, w - 90);

  // Bottom bar
  var stance = first ? first.stance : "-";
  var left = Police.barrierStock(g, UI.selected);
  var bot;
  if (UI.screen === "planning") {
    bot = "Squad " + (UI.selected + 1) + " (" + Police.getLoadout(g, UI.selected) + "): " + uiSquadDesc(g, UI.selected) + uiOrderHud(g) +
      "  | click squad = select | click a street = place (red = not allowed) | " + (typeof FORCE !== "undefined" ? "V force panel" : "V loadout") + " | right-click/B barrier (" + left + " left) | N next map | Enter START" +
      (UI.mode ? "  [click to place: " + UI.mode.toUpperCase() + "]" : "");
  } else {
    bot = "Squad " + (UI.selected + 1) + " (" + stance + ", " + uiSquadDesc(g, UI.selected) + ")" +
      "  Barriers left " + left + uiGasHud(g) + uiOrderHud(g) +
      (typeof REINFORCE !== "undefined" ? "  " + REINFORCE.hud(g) : "") +
      "  " + UI.Game.speed + "x" +
      "  | right-click = tool  A arrest  F shove  G gas  K kettle  X snatch" +
      (UI.mode ? "  [click: " + UI.mode.toUpperCase() + "]" : "");
  }
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, h - 24, w, 24);
  ctx.fillStyle = "#d7dde8";
  uiFitText(ctx, bot, 8, h - 12, w - 16);

  if (Date.now() < UI.msgUntil) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff8a80";
    ctx.fillText(UI.msg, w / 2, h - 40);
  }

  if (UI.screen === "playing") uiClock(ctx, g);
  if (UI.screen === "playing" && typeof METERS !== "undefined") {
    /* the selected squad's water tank / loudspeaker battery, above the bottom bar */
    var mk = (MAP.width * CONFIG.tileSize) / (parseFloat(UI.Game.canvas.style.width) || (MAP.width * CONFIG.tileSize));
    ctx.save();
    ctx.translate(10, h - 24 - 24 * mk);
    ctx.scale(mk, mk);
    ctx.fillStyle = "rgba(8,10,16,0.7)";
    if (METERS.level(g, UI.selected)) ctx.fillRect(-4, -2, 470, 22);
    METERS.drawHud(ctx, g, UI.selected, 0, 0, 460);
    ctx.restore();
  }

  if (typeof MINIMAP !== "undefined" && (UI.screen === "planning" || UI.screen === "playing")) MINIMAP.draw(ctx, g);

  var forceOpen = UI.screen === "planning" && typeof FORCE !== "undefined" && FORCE.isOpen();   /* the planner covers the middle */
  if (typeof HELP !== "undefined" && !forceOpen && (UI.screen === "planning" || (UI.screen === "playing" && !UI.Game.paused))) {
    HELP.draw(ctx, {
      canvas: UI.Game.canvas, screen: UI.screen, mode: UI.mode || null, paused: false,
      loadout: Police.getLoadout(g, UI.selected),
      order: (typeof ORDERS !== "undefined") ? ORDERS.get(g, UI.selected).order : "hold"
    });
  }

  if (UI.screen === "playing" && typeof REINFORCE !== "undefined" && REINFORCE.menuOpen()) {
    /* scale the panel to the screen like the other overlays */
    var rk = (MAP.width * CONFIG.tileSize) / (parseFloat(UI.Game.canvas.style.width) || (MAP.width * CONFIG.tileSize));
    ctx.save();
    ctx.translate(w / 2, h - 24);
    ctx.scale(rk, rk);
    ctx.translate(-w / 2, -(h - 24));
    REINFORCE.drawPanel(ctx, g, w, h);
    ctx.restore();
  }

  if (UI.screen === "planning" || UI.screen === "playing") uiDrawMenu(ctx, w, h);

  if (UI.Game.paused && UI.screen === "playing" && !UI.menuOpen) {
    uiOverlay(ctx, "PAUSED", UI_CONTROLS, "Press Space to resume");
  }

  if (UI.screen === "over" && typeof DEBRIEF !== "undefined") DEBRIEF.draw(ctx, g, w, h);
  else if (UI.screen === "over") {
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
