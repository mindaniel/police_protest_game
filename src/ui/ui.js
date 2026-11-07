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

function uiSquadsOfType(g, loadout) {
  var i, s, seen = {}, list = [];
  function add(sq) {
    if (sq == null || seen[sq]) return;
    seen[sq] = true;
    list.push(sq);
  }
  /* every squad in the force list, spawned or not (planning adds squads before they exist) */
  for (s = 0; s < (CONFIG.squadCount || 0); s++) if (Police.getLoadout(g, s) === loadout) add(s);
  for (i = 0; i < g.officers.length; i++) {
    if (Police.getLoadout(g, g.officers[i].squad) === loadout) add(g.officers[i].squad);
  }
  for (i = 0; i < g.vehicles.length; i++) {
    if (Police.getLoadout(g, g.vehicles[i].squad) === loadout) add(g.vehicles[i].squad);
  }
  return list;
}

function uiSquadBusy(g, s) {
  var i, o, cx = 0, cy = 0, n = 0;
  var ord = g.orders && g.orders[s];
  if (ord && (ord.order === "guard" || ord.order === "push")) return true;
  for (i = 0; i < g.officers.length; i++) {
    o = g.officers[i];
    if (o.squad !== s) continue;
    if (o.busy || o.arrestTarget) return true;
    cx += o.x; cy += o.y; n++;
  }
  for (i = 0; i < g.vehicles.length; i++) {
    if (g.vehicles[i].squad !== s) continue;
    cx += g.vehicles[i].x; cy += g.vehicles[i].y; n++;
  }
  if (n > 0) {
    cx /= n; cy /= n;
    for (i = 0; i < g.agents.length; i++) {
      var a = g.agents[i];
      if (!a.active || a.role !== "rioter") continue;
      if ((a.revealedUntil || 0) > g.time) {
        var dx = a.x - cx, dy = a.y - cy;
        if (dx * dx + dy * dy <= 36) return true;
      }
    }
  }
  return false;
}

function uiSelectType(g, k) {
  /* keys come from each unit file (src/units/*.js) */
  var defs = UNITTYPES.list(), def = UNITTYPES.byKey(k);
  var types = defs.map(function (d) { return d.id; });
  var names = defs.map(function (d) { return d.short; });
  var idx = def.key === k ? types.indexOf(def.id) : -1;
  if (idx < 0 || idx >= types.length) return false;
  var loadout = types[idx];
  var list = uiSquadsOfType(g, loadout);
  if (list.length === 0) {
    UI.say("No " + names[idx] + " squad");
    return true;
  }
  var now = Date.now();
  var key = loadout;
  if (false) {   /* repeat presses no longer cycle: Q does that */
    UI._lastTypeCursor = (UI._lastTypeCursor + 1) % list.length;
  } else {
    UI._lastTypeCursor = 0;
  }
  UI._lastTypeKey = key;
  UI._lastTypeKeyTime = now;
  UI._lastTypeList = list;

  var target = null;
  if (UI._lastTypeCursor === 0) {
    /* first press: FREE squads first, then nearest to mouse tile / camera centre */
    var mx, my;
    if (UI.lastTile) { mx = UI.lastTile.x; my = UI.lastTile.y; }
    else if (typeof Art !== "undefined" && Art.camera) { mx = Art.camera.cx; my = Art.camera.cy; }
    else { mx = 0; my = 0; }
    var free = [], busy = [], i, sq;
    for (i = 0; i < list.length; i++) {
      sq = list[i];
      if (uiSquadBusy(g, sq)) busy.push(sq); else free.push(sq);
    }
    var pool = free.length ? free : busy;
    var best = null, bestD = Infinity;
    for (i = 0; i < pool.length; i++) {
      sq = pool[i];
      var sx = 0, sy = 0, c = 0, j;
      for (j = 0; j < g.officers.length; j++) {
        if (g.officers[j].squad === sq) { sx += g.officers[j].x; sy += g.officers[j].y; c++; }
      }
      for (j = 0; j < g.vehicles.length; j++) {
        if (g.vehicles[j].squad === sq) { sx += g.vehicles[j].x; sy += g.vehicles[j].y; c++; }
      }
      if (c) { sx /= c; sy /= c; }
      var d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
      if (d < bestD) { bestD = d; best = sq; }
    }
    target = best;
    UI._lastTypeCursor = 0;
  } else {
    target = list[UI._lastTypeCursor];
  }
  if (target == null) return true;

  UI.selected = target;
  UI.selVehicle = false;
  var busyTxt = uiSquadBusy(g, target) ? "busy" : "free";
  UI.say(UNITTYPES.tag(g, target) + " selected (" + busyTxt + (list.length > 1 ? ", " + list.length + " of this type, Q = next" : "") + ")");

  /* the camera stays put: the squad cam inset (squadcam.js) shows the squad */
  return true;
}

function uiSelectKey(k) {
  var n = parseInt(k, 10);
  if (k === "0") n = 10;   /* reinforcement squads 7-10 use keys 7, 8, 9, 0 */
  if (n >= 1 && n <= CONFIG.squadCount) { UI.selected = n - 1; UI.selVehicle = false; return true; }
  return false;
}

UI.init = function (g, game) {
  UI.Game = game;
  if (typeof ORDERFX !== "undefined") ORDERFX.init();   /* click markers for move orders */
  UI.titleMapIdx = 0;
  if (typeof CityGen !== "undefined" && CityGen.maps && CityGen.currentMap) {
    var ml = CityGen.maps(), cm = CityGen.currentMap(), mi;
    for (mi = 0; mi < ml.length; mi++) {
      if (ml[mi] === cm || (ml[mi] && cm && ml[mi].id === cm.id)) { UI.titleMapIdx = mi; break; }
    }
  }

  window.addEventListener("keydown", function (e) {
    g = (typeof G !== "undefined" && G) ? G : g;   /* restartGame makes a new G: never use a stale one */
    var k = e.key;
    if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) {   /* settings / guide screen takes all keys */
      SETTINGS.key(k);
      if (!SETTINGS.isOpen()) uiSettingsClosed();
      e.preventDefault(); return;
    }
    /* POV (pov.js): H takes control of the selected squad; while active it gets the keys first */
    if (typeof POV !== "undefined" && UI.screen === "playing") {
      if (POV.active()) { if (POV.keydown(e)) { e.preventDefault(); return; } }
      else if (k === "h" || k === "H") { POV.toggle(G); e.preventDefault(); return; }
    }
    if ((k === "?" || k === "F1") && typeof HELP !== "undefined" && UI.screen !== "title") {
      HELP.toggle(); e.preventDefault(); return;
    }
if ((k === "\\" || k === "F3") && typeof Art !== "undefined" && Art.toggleView) {
      var _vm = Art.toggleView();
      if (typeof UI !== "undefined" && UI.say) UI.say(_vm === "top" ? "View: Top-down" : "View: Tilted");
      e.preventDefault();
      return;
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
    if ((k === "q" || k === "Q") && (UI.screen === "planning" || UI.screen === "playing") && CONFIG.squadCount > 0) {
      /* Q: next squad of the same type as the selected one (number keys pick the type) */
      var qlo = Police.getLoadout(g, UI.selected), ql = uiSquadsOfType(g, qlo);
      if (ql.length) {
        var qi = (ql.indexOf(UI.selected) + 1) % ql.length;
        UI.selected = ql[qi]; UI.selVehicle = false;
        UI.say(UNITTYPES.tag(g, UI.selected) + " selected (" + (qi + 1) + " of " + ql.length + ", Q = next)");
      }
      return;
    }
    if (k === "Tab" && (UI.screen === "planning" || UI.screen === "playing") && CONFIG.squadCount > 0) {
      /* Tab / Shift+Tab: next / previous squad (big maps have more squads than number keys) */
      UI.selected = (UI.selected + (e.shiftKey ? CONFIG.squadCount - 1 : 1)) % CONFIG.squadCount;
      UI.selVehicle = false; UI.say("Squad " + (UI.selected + 1) + " selected");
      e.preventDefault(); return;
    }
    if (UI.screen === "title") {
      if ((k === "m" || k === "M") && typeof CityGen !== "undefined") uiTitleMove(e.shiftKey ? -1 : 1);
      if ((k === "ArrowRight" || k === "ArrowLeft") && typeof CityGen !== "undefined") {
        uiTitleMove(k === "ArrowRight" ? 1 : -1);
        e.preventDefault();
      }
      if (k >= "1" && k <= "4" && k.length === 1) uiTitleSetLevel(+k);
      if ((k === "s" || k === "S") && typeof SETTINGS !== "undefined") SETTINGS.open("settings");
      if (e.code === "Enter") { uiStartLevel(); e.preventDefault(); }
      return;
    }
    if (UI.screen === "over") {
      if (k === "r" || k === "R") restartGame();
      else if (k === "m" || k === "M") { UI.screen = "title"; }
      else if ((k === "n" || k === "N") && typeof CityGen !== "undefined") uiBusy(function () { restartGame(true); UI.say("Map: " + MAP.realName); });
      return;
    }
    if (UI.screen === "planning") {
      if (e.code === "Enter") { uiStartPlay(); e.preventDefault(); }
      else if (typeof FORCE !== "undefined" && FORCE.isOpen() && k !== "Tab" && FORCE.key(k)) { e.preventDefault(); }   /* planner cards */
      else if (uiOrderKey(e, k)) { /* standing orders */ }
      else if ((((k >= "0" && k <= "9") || k === "-") && k.length === 1) && !e.shiftKey && uiSelectType(g, k)) { /* type select */ }
      else if (uiSelectKey((e.code && /^Digit[0-9]$/.test(e.code) ? e.code.charAt(5) : k))) { /* squad selected (Shift+digit = squad N) */ }
      else if ((k === "v" || k === "V") && typeof FORCE !== "undefined") { FORCE.toggle(); }
      else if (k === "v" || k === "V") { uiCycleLoadout(); }
      else if (k === "b" || k === "B") { UI.mode = "barrier"; }
      else if ((k === "n" || k === "N") && typeof CityGen !== "undefined") uiBusy(function () { restartGame(true); UI.say("Map: " + MAP.realName); });
      else if (k === "Escape") { UI.mode = null; }
      return;
    }
    // playing
    if (e.code === "Space") { UI.Game.paused = !UI.Game.paused; e.preventDefault(); return; }
    /* alert cards are radio calls: Enter sends the suggested unit to the top one, Delete removes it */
    if (typeof ALERTS !== "undefined" && e.code === "Enter") { ALERTS.sendTop(g); e.preventDefault(); return; }
    if (typeof ALERTS !== "undefined" && e.code === "Delete") { ALERTS.dismissTop(g); e.preventDefault(); return; }
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
    if (typeof ALERTS !== "undefined" && ALERTS.key(k)) { e.preventDefault(); return; }   /* Backspace: newest alert */
    if (UI.Game.paused) return;
    if (uiOrderKey(e, k)) { /* standing orders */ }
    else if ((((k >= "0" && k <= "9") || k === "-") && k.length === 1) && !e.shiftKey && uiSelectType(g, k)) { /* squad by type */ }
    else if (uiSelectKey((e.code && /^Digit[0-9]$/.test(e.code) ? e.code.charAt(5) : k))) { /* squad selected (Shift+digit = squad N) */ }
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
    else if (k === "P" && e.shiftKey && typeof LINES !== "undefined") { UI.mode = "line"; UI.say("Click across a street: squad " + (UI.selected + 1) + " forms a police line there (max 7 tiles wide)"); }
    else if (k === "p" || k === "P") { UI.mode = "sectorPatrol"; UI.say("Click the map: squad " + (UI.selected + 1) + " patrols that ninth of the map (Shift+P = police line)"); }
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
    else if (k === "i" || k === "I") {   /* camera jumps to the selected squad and follows it */
      if (UI.follow === UI.selected) { UI.follow = null; UI.say("Camera free"); }
      else {
        var fc = SQUADCAM.centre(G, UI.selected);
        if (fc) { UI.follow = UI.selected; Art.centerOn(fc.x, fc.y, 3); UI.say("Camera follows squad " + (UI.selected + 1) + " (I or drag the map to stop)"); }
      }
    }
    else if ((k === "k" || k === "K") && typeof TACT !== "undefined") {
      if (TACT.kettleActive()) { TACT.release(G); UI.mode = null; }
      else { UI.mode = "kettle"; UI.say("Click the centre of the group to kettle (2 squads or 8+ officers within 16 tiles)"); }
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
    g = (typeof G !== "undefined" && G) ? G : g;   /* restartGame makes a new G: never use a stale one */
    var k = e.key;
    if (typeof POV !== "undefined" && POV.active() && POV.keyup(e)) { e.preventDefault(); return; }
    if ((k === "w" || k === "W" || k === "l" || k === "L") && typeof METERS !== "undefined") METERS.stop(G);
  });

  var cv = game.canvas;
  cv.addEventListener("mousemove", function (e) {
    g = (typeof G !== "undefined" && G) ? G : g;   /* restartGame makes a new G: never use a stale one */
    UI.lastTile = UI.toTile(e);
    UI.hover = UI.toTile(e);
    if (UI.screen === "title" && typeof uiTitleHover === "function") { var th = UI.toLogical(e); uiTitleHover(th.x, th.y); }
    if (!UI._press) cv.style.cursor = (UI.screen !== "title" && UI.pickSquad(e) >= 0) ? "pointer" : (UI.mode ? "crosshair" : "default");
  });
  cv.addEventListener("mouseleave", function () {
    UI.hover = null;
  });

  /* Left button: click = select / command, hold and drag = pan the map. */
  cv.addEventListener("mousedown", function (e) {
    g = (typeof G !== "undefined" && G) ? G : g;   /* restartGame makes a new G: never use a stale one */
    if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) return;   /* handled on mouseup */
    if (e.button === 0) {
      if (typeof MINIMAP !== "undefined" && (UI.screen === "planning" || UI.screen === "playing")) {
        var mml = UI.toLogical(e);
        if (MINIMAP.mouseDown(mml.x, mml.y)) { UI._mini = true; return; }   /* minimap: jump / drag the view */
      }
      if (typeof SQUADCAM !== "undefined" && (UI.screen === "planning" || UI.screen === "playing")) {
        var scl = UI.toLogical(e);
        if (SQUADCAM.click(scl.x, scl.y)) { UI._press = null; return; }   /* squad cam: recentre / hide */
      }
      UI._press = { x: e.clientX, y: e.clientY, drag: false };
      if (UI.mode === "patrolArea" && !UI._areaA && (UI.screen === "planning" || UI.screen === "playing")) { UI._areaA = UI.toTile(e); UI._areaFresh = true; UI._areaDrag = false; }   /* patrol area: first corner on press */
    } else if (e.button === 2) {
      e.preventDefault();
      uiRightClick(e);
    }
  });
  window.addEventListener("mousemove", function (e) {
    g = (typeof G !== "undefined" && G) ? G : g;   /* restartGame makes a new G: never use a stale one */
    if (UI.mode === "patrolArea" && e.target === cv) UI.hoverTile = UI.toTile(e);   /* patrol area preview */
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
    if (UI.mode === "patrolArea" && UI._areaA) { if (p.drag) UI._areaDrag = true; return; }   /* drawing the patrol rectangle, no pan */
    if (p.drag && typeof Art !== "undefined" && Art.panBy) {
      UI.follow = null;   /* dragging the map stops camera follow */
      var r = cv.getBoundingClientRect(), ts = CONFIG.tileSize;
      Art.panBy(-dx / r.width * MAP.width * ts, -dy / r.height * MAP.height * ts);
      p.x = e.clientX; p.y = e.clientY;
      cv.style.cursor = "grabbing";
    }
  });
  window.addEventListener("mouseup", function (e) {
    g = (typeof G !== "undefined" && G) ? G : g;   /* restartGame makes a new G: never use a stale one */
    if (e.button === 2 && typeof METERS !== "undefined") METERS.stop(G);
    if (UI._mini && e.button === 0) { UI._mini = false; MINIMAP.mouseUp(); return; }
    if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) {
      if (e.button === 0 && e.target === cv) { var sp = UI.toLogical(e); SETTINGS.click(sp.x, sp.y); if (!SETTINGS.isOpen()) uiSettingsClosed(); }
      UI._press = null; return;
    }
    if (e.button === 0 && UI._press && UI.mode === "patrolArea" && UI._areaDrag && UI._areaA && uiPatrolAreaRelease(e)) { UI._press = null; cv.style.cursor = "default"; return; }
    if (e.button !== 0 || !UI._press) return;
    var wasDrag = UI._press.drag;
    UI._press = null;
    cv.style.cursor = "default";
    if (!wasDrag && e.target === cv && (UI.screen === "planning" || UI.screen === "playing")) {
      var mp = UI.toLogical(e);
      if (uiMenuClick(mp.x, mp.y)) return;
      if (UI.screen === "planning" && typeof SQUADPLAN !== "undefined" && !(typeof FORCE !== "undefined" && FORCE.isOpen()) && SQUADPLAN.click(mp.x, mp.y, G, e.shiftKey)) return;
      if (UI.screen === "playing" && typeof ALERTS !== "undefined" && ALERTS.click(mp.x, mp.y, G)) return;
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
  if (typeof ORDERFX !== "undefined") ORDERFX.note(G, s, x, y);   /* click marker + route line */
  if (!UI._quietGo) UI.say(UNITTYPES.tag(G, s) + " moving to the marked spot");   /* confirmation; ride messages below may replace it */
  if (typeof TRANSPORT !== "undefined") {
    if (!UI.selVehicle) TRANSPORT.boardRest(G, s);   /* officers still on foot get in before the ride */
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
        var trip = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        var far = trip > (CONFIG.autoRideDistance || 12);
        /* ride when walking back to the car costs less than half the trip */
        var near = Math.sqrt((v.x - cx) * (v.x - cx) + (v.y - cy) * (v.y - cy)) < Math.max(6, trip * 0.5);
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
function uiLoadedMapIdx() {
  if (typeof CityGen === "undefined" || !CityGen.maps || !CityGen.currentMap) return 0;
  var list = CityGen.maps(), cur = CityGen.currentMap(), i;
  for (i = 0; i < list.length; i++) {
    if (list[i] === cur || (list[i] && cur && list[i].id === cur.id)) return i;
  }
  return 0;
}

function uiTitleMove(d) {
  if (typeof CityGen === "undefined" || !CityGen.maps) return;
  var list = CityGen.maps(), n = list.length;
  if (!n) return;
  var idx = (typeof UI.titleMapIdx === "number") ? UI.titleMapIdx : uiLoadedMapIdx();
  UI.titleMapIdx = ((idx + (d || 0)) % n + n) % n;
  return list[UI.titleMapIdx];
}

function uiTitleSetLevel(n) {
  if (typeof LEVELS === "undefined" || !LEVELS.list || !LEVELS.set) return false;
  var list = LEVELS.list();
  n = parseInt(n, 10);
  if (!(n >= 1 && n <= 4) || !list[n - 1]) return false;
  LEVELS.set(list[n - 1].id);
  return true;
}

function uiCommitChosenMap() {
  if (typeof CityGen === "undefined" || !CityGen.setMap) return false;
  if (typeof UI.titleMapIdx !== "number") UI.titleMapIdx = uiLoadedMapIdx();
  if (UI.titleMapIdx === uiLoadedMapIdx()) return false;
  CityGen.setMap(UI.titleMapIdx);
  restartGame(false);
  if (UI.screen === "title") UI.screen = "title";
  return true;
}

function uiStartPlay() {
  UI.screen = "playing"; UI.mode = null;
  if (typeof ORDERS !== "undefined") ORDERS.startPlay(G);
  if (typeof DEPLOY !== "undefined") DEPLOY.start(G);   /* squads leave the station for their planned posts */
  if (CONFIG.calmStartSeconds) UI.say("The crowd is gathering: about " + Math.round(CONFIG.calmStartSeconds) + " s before trouble starts. Get your squads in place.");
}

/* Spinner over the page while slow synchronous work (map build, restart) runs.
 * The CSS animation keeps turning even while the main thread is busy. */
function uiLoading(on) {
  var d = document.getElementById("loading");
  if (d) d.style.display = on ? "flex" : "none";
}
function uiBusy(fn) {
  uiLoading(true);
  requestAnimationFrame(function () {   /* let the spinner paint first */
    setTimeout(function () { try { fn(); } finally { uiLoading(false); } }, 0);
  });
}

/* Leave the title screen; rebuild the crowd when the difficulty changed. */
function uiStartLevel() {
  if (UI._starting) return;
  UI._starting = true;
  uiBusy(function () {
    UI._starting = false;
    if (UI.screen === "title") uiCommitChosenMap();
    if (UI.screen === "title" && typeof LEVELS !== "undefined") {   /* no difficulty choice: each match rolls one */
      var lvl = LEVELS.list();
      LEVELS.set(lvl[Math.floor(Math.random() * lvl.length)].id);
    }
    if (typeof LEVELS !== "undefined" && CONFIG._levelId !== LEVELS.current().id) restartGame(false);
    UI.screen = "planning";
  });
}

function uiLeftClick(e) {
  if (UI.screen === "playing" && typeof POV !== "undefined" && POV.active()) {   /* POV: click = arrest near the leader */
    var pt = UI.toTile(e);
    if (POV.click(G, pt.x + 0.5, pt.y + 0.5)) return;
  }
  if (UI.screen === "title") {
    var lp = UI.toLogical(e);
    if (typeof uiTitleClick === "function" && uiTitleClick(lp.x, lp.y)) return;
    if (typeof LEVELS !== "undefined") {
      var id = LEVELS.hit(lp.x, lp.y);
      if (id) { if (id === LEVELS.current().id) uiStartLevel(); else LEVELS.set(id); }
    }
    return;
  }
  if (UI.screen === "over") return;
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
    if (kr === "few") UI.say("Kettling needs 2 squads (or 8+ officers) within 16 tiles of the click - squads in vehicles jump out");
    else if (kr === "ok") UI.say("Squads encircling the group - once closed they check people one by one: rioters are exposed, others let out. K again to release");
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
  else if (UI.mode === "sectorPatrol" && typeof SQUADPLAN !== "undefined") {   /* P + click: patrol the 1/9 sector there */
    SQUADPLAN.assignSector(G, UI.selected, SQUADPLAN.sectorAt(G, t.x, t.y));
    UI.mode = null;
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
    if (k === "Y" || k === "y") {
      if (UI.mode === "patrolArea") { UI.mode = "waypoint"; UI._areaA = null; UI._areaDrag = false; UI.say("Patrol route mode: click 2-6 route points for squad " + (s + 1) + " (Esc when done)"); }
      else { UI.mode = "waypoint"; UI._areaA = null; UI._areaDrag = false; UI.say("Click patrol route points for squad " + (s + 1) + " (Esc when done, Shift+Y clears)"); }
      return true;
    }
    if (k === "Z" || k === "z") { ORDERS.clearTrigger(G, s); UI.say("Squad " + (s + 1) + " trigger zone removed"); return true; }
    return false;
  }
  if (k === "o" || k === "O") {
    var name = ORDERS.cycle(G, s);
    if (name === "push") { UI.mode = "pushTarget"; UI.say("Squad " + (s + 1) + " PUSH: click the line to push to"); }
    else if (name === "patrol") { UI.mode = "patrolArea"; UI._areaA = null; UI._areaDrag = false; UI.say("Squad " + (s + 1) + " PATROL: press Y and drag a rectangle, or click two opposite corners (Shift+Y for route points)"); }
    else UI.say("Squad " + (s + 1) + " order: " + name.toUpperCase());
    return true;
  }
  if (k === "y" || k === "Y") {
    UI.mode = "patrolArea";
    UI._areaA = null;
    UI._areaDrag = false;
    UI.say("Drag a rectangle for squad " + (s + 1) + "'s patrol area (or click two opposite corners; Esc cancels, Shift+Y = route points)");
    return true;
  }
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
  if (UI.mode === "patrolArea") {
    if (!UI._areaA || UI._areaFresh) {
      if (!UI._areaA) UI._areaA = { x: t.x, y: t.y };
      UI._areaFresh = false;
      UI.say("Now click the opposite corner (or drag)");
    } else {
      ORDERS.setArea(G, UI.selected, UI._areaA.x, UI._areaA.y, t.x, t.y);
      UI.mode = null;
      UI._areaA = null;
      UI._areaDrag = false;
      UI.say("Squad " + (UI.selected + 1) + " patrols this area");
    }
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
function uiPatrolAreaOverlay(ctx, g) {
  if (UI.mode !== "patrolArea" || !UI._areaA || !UI.hoverTile) return;
  var ts = CONFIG.tileSize;
  var ax = UI._areaA.x * ts, ay = UI._areaA.y * ts;
  var bx = UI.hoverTile.x * ts, by = UI.hoverTile.y * ts;
  var rx = Math.min(ax, bx), ry = Math.min(ay, by);
  var rw = Math.abs(bx - ax) + ts, rh = Math.abs(by - ay) + ts;
  ctx.save();
  ctx.fillStyle = "rgba(42,157,143,0.12)";
  ctx.fillRect(rx, ry, rw, rh);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#2a9d8f";
  ctx.lineWidth = 2;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  ctx.setLineDash([]);
  ctx.font = "bold 11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#2a9d8f";
  ctx.fillText("S" + (UI.selected + 1) + " patrol area", rx + 4, ry + 4);
  ctx.restore();
}
function uiPatrolAreaRelease(e) {
  if (UI.mode !== "patrolArea" || !UI._areaDrag || !UI._areaA) return false;
  var t = UI.toTile(e);
  UI._areaDrag = false;
  ORDERS.setArea(G, UI.selected, UI._areaA.x, UI._areaA.y, t.x, t.y);
  UI.mode = null;
  UI._areaA = null;
  UI.hoverTile = null;
  UI.say("Squad " + (UI.selected + 1) + " patrols this area");
  return true;
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
  if (typeof METERS !== "undefined" && (lo === "watertruck" || UNITTYPES.get(lo).loudspeaker)) {
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

  var k = (typeof Game !== "undefined" && Game.textScale) ? Game.textScale() : 1;
  if (!(k > 0)) k = 1;

  var titlePx = 30;
  var linePx = 14;
  var footerPx = 16;
  var titleY = 50;

  function layout(lp) {
    var yy = titleY + titlePx * k + 25 * k;
    var pos = [];
    for (var i = 0; i < lines.length; i++) {
      pos.push(yy);
      yy += lp * k * 1.35;
    }
    var fy = -1;
    if (footer) {
      fy = yy + 20 * k;
      yy = fy + footerPx * k * 1.35;
    }
    return { y: yy, pos: pos, footerY: fy };
  }

  var lp = linePx;
  var lay = layout(lp);
  var limit = h - 10;
  while (lay.y > limit && lp > 8) {
    lp -= 1;
    lay = layout(lp);
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold " + titlePx + "px Consolas, monospace";
  ctx.fillText(title, w / 2, titleY);

  if (lines.length) ctx.font = lp + "px Consolas, monospace";
  for (var i = 0; i < lines.length; i++) {
    ctx.fillStyle = String(lines[i] || "").charAt(0) === "#" ? "#9fe0a0" : "#d7dde8";
    ctx.fillText(String(lines[i] || "").replace(/^#/, ""), w / 2, lay.pos[i]);
  }

  if (footer) {
    ctx.fillStyle = "#ffd866";
    ctx.font = "bold " + footerPx + "px Consolas, monospace";
    ctx.fillText(footer, w / 2, lay.footerY);
  }

  if (typeof window !== "undefined") window.UI_OVERLAY_BOTTOM = lay.y;
  return lay.y;
}

var UI_CONTROLS = [
  "Left click a squad, or 1-0 by type (1 foot 2 sedan 3 van 4 truck 5 water 6 barrier 7 bikes 8 horses 9 medics 0 fire; Q = next of that type) : select it",
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
  "Y then drag a rectangle : patrol area   Shift+Y then clicks : patrol route",
  "Z then click : trigger zone (Shift+Z clears)",
  "Shift+H / G / R / A : every squad holds / guards / retreats / goes auto",
  "Space : pause     T : speed 1x / 2x     N (planning) : next map",
  "I : camera follows the selected squad (I again or drag to stop)",
  "Wheel / + - : zoom   Arrows / middle-drag : pan   0 : reset view",
  "H : take control of the selected squad (WASD move, E vehicle, Space shove, F arrest, Tab next, H/Esc back)",
  "Alerts: click a card or PgUp/PgDn to pick, Enter sends a unit, Delete removes it",
  "? or F1 : show / shrink / hide the controls panel (top right)",
  "Click the squad cam (bottom right) to jump to the squad.  Graphics and low buildings: S settings"
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
  if (UI.mode === "patrolArea" && UI._areaA && UI.hoverTile) {
    var ts = CONFIG.tileSize;
    var ax = UI._areaA.x * ts;
    var ay = UI._areaA.y * ts;
    var bx2 = UI.hoverTile.x * ts;
    var by2 = UI.hoverTile.y * ts;
    var rx2 = Math.min(ax, bx2);
    var ry2 = Math.min(ay, by2);
    var rw2 = Math.abs(bx2 - ax) + ts;
    var rh2 = Math.abs(by2 - ay) + ts;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#2a9d8f";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx2 + 0.5, ry2 + 0.5, rw2 - 1, rh2 - 1);
    ctx.restore();
  }
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
  if (!UI._drawn) { UI._drawn = true; uiLoading(false); }   /* first frame: hide the page-load spinner */
  if (UI.follow != null) {   /* I: keep the followed squad centred */
    var fc = UI.follow === UI.selected ? SQUADCAM.centre(g, UI.follow) : null;
    if (fc) Art.centerOn(fc.x, fc.y); else UI.follow = null;
  }
  uiDrawScreen(ctx, g);
  if (typeof SETTINGS !== "undefined" && SETTINGS.isOpen()) SETTINGS.draw(ctx, MAP.width * CONFIG.tileSize, MAP.height * CONFIG.tileSize);
};

/* ---------- New title screen ---------- */
var UI_TITLE = { bg: null, bw: 0, bh: 0, hover: -1, imgs: {}, ready: {} };

function uiTitleRound(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function uiTitleShadow(ctx, x, y, w, h, r, blur) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = Math.round(blur * 0.45);
  uiTitleRound(ctx, x, y, w, h, r);
  ctx.fillStyle = "rgba(0,0,0,0.001)";
  ctx.fill();
  ctx.restore();
}

function uiTitleBg(w, h) {
  var t = UI_TITLE;
  if (t.bg && t.bw === w && t.bh === h) return t.bg;
  var cv = (typeof document !== "undefined") ? document.createElement("canvas") : null;
  if (!cv) return null;
  cv.width = w; cv.height = h;
  var c = cv.getContext("2d");
  var g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#060a14"); g.addColorStop(0.45, "#0a1222");
  g.addColorStop(0.8, "#101a2c"); g.addColorStop(1, "#16202f");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  var seed = 20240517;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var i, n = 26;
  c.save();
  for (i = 0; i < n; i++) {
    var lx = rnd() * w, ly = h * (0.42 + rnd() * 0.5), lr = (18 + rnd() * 70) * (h / 768);
    var warm = rnd() > 0.55;
    var rg = c.createRadialGradient(lx, ly, 0, lx, ly, lr);
    var col = warm ? "255,190,110" : "120,170,255";
    rg.addColorStop(0, "rgba(" + col + ",0.16)");
    rg.addColorStop(1, "rgba(" + col + ",0)");
    c.fillStyle = rg;
    c.beginPath(); c.arc(lx, ly, lr, 0, Math.PI * 2); c.fill();
  }
  c.restore();
  /* skyline: two depth layers */
  var layers = [{ col: "#0e1626", base: 0.72, step: 26 * (h / 768), maxH: 130 * (h / 768) },
                { col: "#141d2d", base: 0.82, step: 34 * (h / 768), maxH: 90 * (h / 768) }];
  for (var L = 0; L < layers.length; L++) {
    var lyr = layers[L], x = -20;
    c.fillStyle = lyr.col;
    while (x < w + 20) {
      var bw = lyr.step * (0.7 + rnd() * 1.6), bh = lyr.maxH * (0.25 + rnd() * 0.75);
      var top = h * lyr.base - bh;
      c.fillRect(x, top, bw, h - top);
      if (rnd() > 0.55) c.fillRect(x + bw * 0.3, top - bh * 0.18, bw * 0.35, bh * 0.18);
      /* window dots */
      c.fillStyle = "rgba(255,206,140,0.55)";
      var wx, wy;
      for (wx = x + 4; wx < x + bw - 4; wx += 7 * (h / 768)) {
        for (wy = top + 6; wy < h - 8; wy += 9 * (h / 768)) {
          if (rnd() > 0.82) c.fillRect(wx, wy, 2 * (h / 768), 2.4 * (h / 768));
        }
      }
      c.fillStyle = lyr.col;
      x += bw + 2;
    }
  }
  /* soft vignette */
  var vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
  c.fillStyle = vg; c.fillRect(0, 0, w, h);
  t.bg = cv; t.bw = w; t.bh = h;
  return cv;
}

function uiTitleThumb(id) {
  var t = UI_TITLE;
  if (!t.imgs[id]) {
    if (typeof Image === "undefined") return null;
    var im = new Image();
    im.onload = function () { t.ready[id] = true; };
    im.onerror = function () { t.imgs[id] = null; };
    im.src = "maps/thumbs/" + id + ".png";
    t.imgs[id] = im;
  }
  var img = t.imgs[id];
  return (img && t.ready[id] && img.naturalWidth > 0) ? img : null;
}

var uiTitleScreen = function (ctx, g) {
  var ts = CONFIG.tileSize, w = MAP.width * ts, h = MAP.height * ts;
  var k = (typeof Game !== "undefined" && Game.textScale) ? Game.textScale() : 1;
  if (!(k > 0)) k = 1;
  var small = Math.min(k, 1.6);
  var accent = "#3d7dff", warm = "#ffc857";

  var bg = uiTitleBg(w, h);
  if (bg) ctx.drawImage(bg, 0, 0); else { ctx.fillStyle = "#0a1222"; ctx.fillRect(0, 0, w, h); }

  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  /* Title with subtle glow */
  var titlePx = Math.round(Math.min(w * 0.062, 66 * small));
  ctx.save();
  ctx.font = "bold " + titlePx + "px Consolas, monospace";
  ctx.shadowColor = "rgba(61,125,255,0.85)"; ctx.shadowBlur = titlePx * 0.55;
  ctx.fillStyle = "#eaf1ff";
  ctx.fillText("POLICE vs PROTESTORS", w / 2, h * 0.13);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#eaf1ff";
  ctx.fillText("POLICE vs PROTESTORS", w / 2, h * 0.13);
  ctx.restore();

  var subPx = Math.round(15 * small);
  ctx.font = subPx + "px Consolas, monospace";
  ctx.fillStyle = "#93a7c4";
  ctx.fillText("Hold the streets. Keep the peace. Watch the mood.", w / 2, h * 0.13 + titlePx * 0.78);

  /* Carousel layout */
  var maps = (typeof CityGen !== "undefined") ? CityGen.maps() : [];
  if (!maps.length) maps = [{ id: "city", name: (typeof MAP !== "undefined" ? (MAP.realName || "City") : "City") }];
  var idx = (typeof UI.titleMapIdx === "number") ? UI.titleMapIdx : 0;
  if (idx < 0 || idx >= maps.length) idx = 0;
  var cur = maps[idx], prev = maps[(idx - 1 + maps.length) % maps.length], next = maps[(idx + 1) % maps.length];

  var cardW = Math.min(w * 0.34, 480 * small), cardH = cardW * 300 / 480;
  var cardY = h * 0.26;
  var sideW = cardW * 0.62, sideH = cardH * 0.62;
  var sideY = cardY + (cardH - sideH) / 2;
  var sideOff = cardW * 0.72;
  var cx = w / 2;

  function drawCard(map, x, y, cw, ch, alpha, sel) {
    ctx.save();
    ctx.globalAlpha = alpha;
    var rr = Math.round(12 * small);
    uiTitleShadow(ctx, x, y, cw, ch, rr, sel ? 24 : 14);
    uiTitleRound(ctx, x, y, cw, ch, rr);
    ctx.fillStyle = "#0d1626"; ctx.fill();
    ctx.strokeStyle = sel ? accent : "#26364e";
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.stroke();
    uiTitleRound(ctx, x + 3, y + 3, cw - 6, ch - 6, rr - 2);
    ctx.clip();
    var img = uiTitleThumb(map.id);
    var ix = x + 3, iy = y + 3, iw = cw - 6, ih = ch - 6;
    if (img) {
      var s = Math.max(iw / img.naturalWidth, ih / img.naturalHeight);
      var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
    } else {
      var gr = ctx.createLinearGradient(ix, iy, ix, iy + ih);
      gr.addColorStop(0, "#17243a"); gr.addColorStop(1, "#0b1322");
      ctx.fillStyle = gr; ctx.fillRect(ix, iy, iw, ih);
      ctx.font = "bold " + Math.round(18 * small) + "px Consolas, monospace";
      ctx.fillStyle = "#cfe0f5"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      uiFitText(ctx, map.name || map.id, x + cw / 2, y + ch * 0.44, cw - 14);
      ctx.font = Math.round(11 * small) + "px Consolas, monospace";
      ctx.fillStyle = "#5d7597";
      ctx.fillText("no preview", x + cw / 2, y + ch * 0.44 + 24 * small);
    }
    /* name strip */
    ctx.fillStyle = "rgba(6,10,18,0.72)";
    ctx.fillRect(ix, y + ch - 3 - Math.round(30 * small), iw, Math.round(30 * small));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold " + Math.round(15 * small) + "px Consolas, monospace";
    ctx.fillStyle = sel ? "#ffffff" : "#c8d6ea";
    uiFitText(ctx, map.name || map.id, x + cw / 2, y + ch - 3 - Math.round(15 * small), cw - 14);
    ctx.restore();
  }

  drawCard(prev, cx - cardW / 2 - sideOff - sideW, sideY, sideW, sideH, 0.4, false);
  drawCard(next, cx + cardW / 2 + sideOff, sideY, sideW, sideH, 0.4, false);
  drawCard(cur, cx - cardW / 2, cardY, cardW, cardH, 1, true);

  /* Arrows */
  var aR = Math.round(22 * small), aY = cardY + cardH / 2;
  var aLx = cx - cardW / 2 - sideOff - sideW - aR * 1.8;
  var aRx = cx + cardW / 2 + sideOff + sideW + aR * 1.8;
  function arrow(x, dir, hover) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, aY, aR, 0, Math.PI * 2);
    ctx.fillStyle = hover ? "rgba(61,125,255,0.9)" : "rgba(22,32,50,0.9)";
    ctx.fill();
    ctx.strokeStyle = hover ? warm : "#3a4d6b"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "#eaf1ff"; ctx.lineWidth = Math.round(3 * small); ctx.lineCap = "round";
    ctx.beginPath();
    var s = aR * 0.42;
    ctx.moveTo(x + dir * s * 0.5, aY - s);
    ctx.lineTo(x - dir * s * 0.5, aY);
    ctx.lineTo(x + dir * s * 0.5, aY + s);
    ctx.stroke();
    ctx.restore();
  }
  arrow(aLx, 1, UI_TITLE.hover === 1);
  arrow(aRx, -1, UI_TITLE.hover === 2);

  /* Level buttons */
  var lvY = cardY + cardH + Math.round(34 * small);
  var list = [];   /* difficulty is random per match: no level buttons */
  var curId = (typeof LEVELS !== "undefined") ? LEVELS.current().id : null;
  var btnW = Math.min(w * 0.19, 210 * small), btnH = Math.round(52 * small), gap = Math.round(12 * small);
  var totW = list.length * btnW + (list.length - 1) * gap;
  var bx0 = (w - totW) / 2;
  UI_TITLE.levelRects = [];
  for (var i = 0; i < list.length; i++) {
    var lv = list[i], bx = bx0 + i * (btnW + gap), sel = (lv.id === curId);
    var rr2 = Math.round(10 * small);
    uiTitleShadow(ctx, bx, lvY, btnW, btnH, rr2, sel ? 16 : 8);
    uiTitleRound(ctx, bx, lvY, btnW, btnH, rr2);
    ctx.fillStyle = sel ? "rgba(61,125,255,0.92)" : (UI_TITLE.hover === 10 + i ? "#1d2c44" : "#121d30");
    ctx.fill();
    ctx.strokeStyle = sel ? warm : "#2c3f5c"; ctx.lineWidth = sel ? 2.5 : 1.2; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold " + Math.round(14 * small) + "px Consolas, monospace";
    ctx.fillStyle = sel ? "#ffffff" : "#c9d6e8";
    ctx.fillText(lv.name, bx + btnW / 2, lvY + btnH * 0.38);
    ctx.font = Math.round(10.5 * small) + "px Consolas, monospace";
    ctx.fillStyle = sel ? "#dce7ff" : "#7288a6";
    ctx.fillText(lv.crowdSize + " people", bx + btnW / 2, lvY + btnH * 0.72);
    UI_TITLE.levelRects.push({ x: bx, y: lvY, w: btnW, h: btnH, id: lv.id });
  }

  /* Start button */
  var stW = Math.min(w * 0.4, 440 * small), stH = Math.round(66 * small);
  var stX = (w - stW) / 2, stY = lvY + btnH + Math.round(26 * small);
  UI_TITLE.startRect = { x: stX, y: stY, w: stW, h: stH };
  var hov = UI_TITLE.hover === 3;
  var rr3 = Math.round(16 * small);
  ctx.save();
  ctx.shadowColor = "rgba(61,125,255,0.75)"; ctx.shadowBlur = hov ? 30 : 18;
  uiTitleRound(ctx, stX, stY, stW, stH, rr3);
  var sg = ctx.createLinearGradient(stX, stY, stX, stY + stH);
  sg.addColorStop(0, hov ? "#4f8bff" : "#2f6ae0"); sg.addColorStop(1, hov ? "#2f6ae0" : "#1e4bb0");
  ctx.fillStyle = sg; ctx.fill();
  ctx.restore();
  uiTitleRound(ctx, stX, stY, stW, stH, rr3);
  ctx.strokeStyle = warm; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold " + Math.round(24 * small) + "px Consolas, monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("START", w / 2, stY + stH * 0.42);
  ctx.font = Math.round(12 * small) + "px Consolas, monospace";
  ctx.fillStyle = "#cfe0ff";
  ctx.fillText("Enter", w / 2, stY + stH * 0.75);

  /* Footer */
  var fp = Math.round(11.5 * small);
  ctx.font = fp + "px Consolas, monospace";
  ctx.fillStyle = "#6c82a2"; ctx.textBaseline = "bottom";
  ctx.fillText("Left/Right  map     1-4  level     Enter  start     S  settings     H  help", w / 2, h - Math.round(14 * small));
};

var uiTitleClick = function (x, y) {
  var t = UI_TITLE;
  function inR(r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  /* arrows */
  var ts = CONFIG.tileSize, w = MAP.width * ts, h = MAP.height * ts;
  var k = (typeof Game !== "undefined" && Game.textScale) ? Game.textScale() : 1;
  if (!(k > 0)) k = 1;
  var small = Math.min(k, 1.6);
  var cardW = Math.min(w * 0.34, 480 * small), cardH = cardW * 300 / 480;
  var sideW = cardW * 0.62, sideOff = cardW * 0.72;
  var aR = Math.round(22 * small), aY = h * 0.26 + cardH / 2;
  var cx = w / 2;
  var aLx = cx - cardW / 2 - sideOff - sideW - aR * 1.8;
  var aRx = cx + cardW / 2 + sideOff + sideW + aR * 1.8;
  function near(x0, y0, r) { var dx = x - x0, dy = y - y0; return dx * dx + dy * dy <= r * r; }
  if (near(aLx, aY, aR * 1.3)) { if (typeof uiTitleMove === "function") uiTitleMove(-1); return true; }
  if (near(aRx, aY, aR * 1.3)) { if (typeof uiTitleMove === "function") uiTitleMove(1); return true; }
  /* level buttons */
  if (t.levelRects) {
    for (var i = 0; i < t.levelRects.length; i++) {
      if (inR(t.levelRects[i])) {
        if (typeof uiTitleSetLevel === "function") uiTitleSetLevel(i + 1);
        return true;
      }
    }
  }
  if (inR(t.startRect)) { uiStartLevel(); return true; }
  return false;
};

/* hover tracking for the title screen (called from UI.draw when screen==="title") */
function uiTitleHover(x, y) {
  var t = UI_TITLE;
  t.hover = -1;
  function inR(r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  if (t.startRect && inR(t.startRect)) { t.hover = 3; return; }
  if (t.levelRects) {
    for (var i = 0; i < t.levelRects.length; i++) {
      if (inR(t.levelRects[i])) { t.hover = 10 + i; return; }
    }
  }
}

function uiDrawScreen(ctx, g) {
  var ts = CONFIG.tileSize, w = MAP.width * ts, h = MAP.height * ts, i;

  if (UI.screen === "title") {
    if (typeof uiTitleScreen === "function") { uiTitleScreen(ctx, g); return; }
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
    ], typeof LEVELS !== "undefined" ? null : "Press Enter to go to planning");
    if (false) LEVELS.drawPicker(ctx, w, h, (typeof UI_OVERLAY_BOTTOM === "number" ? UI_OVERLAY_BOTTOM : 0) + 20);
    return;
  }

  if (UI.screen === "planning") uiPlanningLayer(ctx, g);

  // Selected squad highlight (screen-constant) + move target marker
  var first = null;
  uiGround(ctx, true);
  for (i = 0; i < g.officers.length; i++) {
    var o = g.officers[i];
    if (o.squad !== UI.selected) continue;
    if (!first) first = o;
  }
  uiGround(ctx, false);

  if (typeof Art !== "undefined" && Art.project) {
    ctx.save();
    if (Art.screenBegin) Art.screenBegin(ctx);
    /* flat yellow ellipse under each selected officer's feet */
    var j;
    for (j = 0; j < g.officers.length; j++) {
      var oo = g.officers[j];
      if (oo.squad !== UI.selected) continue;
      if (UI.selVehicle) continue;
      var sp = Art.project(oo.x, oo.y, 0);
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, 7, 3.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(20,26,38,0.7)";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,193,7,0.85)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    /* selected vehicle: screen-constant rounded-rect outline */
    for (j = 0; j < g.vehicles.length; j++) {
      var vv = g.vehicles[j];
      if (vv.squad !== UI.selected) continue;
      if (!UI.selVehicle) continue;
      var vp = Art.project(vv.x, vv.y, 0);
      var rw = 44, rh = 26, rr = 8;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(vp.x - rw / 2, vp.y - rh / 2, rw, rh, rr);
      } else {
        ctx.rect(vp.x - rw / 2, vp.y - rh / 2, rw, rh);
      }
      ctx.strokeStyle = "rgba(20,26,38,0.7)";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,193,7,0.85)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    /* red arrest-target circle, screen-constant radius 8 */
    if (first && first.arrestTarget && first.arrestTarget.active) {
      var ap = Art.project(first.arrestTarget.x, first.arrestTarget.y, 0);
      ctx.beginPath();
      ctx.arc(ap.x, ap.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(20,26,38,0.7)";
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = "#e03131";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (Art.screenEnd) Art.screenEnd(ctx);
    ctx.restore();
  }

  uiGround(ctx, true);
  if (first) {
    var mx = first.homeX * ts, my = first.homeY * ts;
    var zk = (typeof Art !== "undefined" && Art.camera && Art.camera.S) ? ts / (32 * Art.camera.S) : 1;   /* same size on screen at any zoom */
    ctx.strokeStyle = "#ffc107";
    ctx.lineWidth = 2.5 * zk;
    ctx.beginPath();
    ctx.moveTo(mx - 7 * zk, my); ctx.lineTo(mx + 7 * zk, my);
    ctx.moveTo(mx, my - 7 * zk); ctx.lineTo(mx, my + 7 * zk);
    ctx.stroke();
  }
  if (UI.screen === "playing" && UI.hover) {
    ctx.strokeStyle = UI.mode ? "#e8590c" : "rgba(40,60,90,0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(UI.hover.x * ts + 1, UI.hover.y * ts + 1, ts - 2, ts - 2);
  }
  if (UI.mode === "patrolArea" && UI.screen === "playing") uiPatrolAreaOverlay(ctx, g);
  if (UI.screen === "planning" && typeof SQUADPLAN !== "undefined" && SQUADPLAN.drawSectors && !(typeof FORCE !== "undefined" && FORCE.isOpen())) SQUADPLAN.drawSectors(ctx, g);   /* sector grid + threat tint */
  if (UI.screen === "planning" && typeof INTEL !== "undefined" && !(typeof FORCE !== "undefined" && FORCE.isOpen())) { INTEL.update(g); INTEL.draw(ctx, g); }   /* march forecast + briefing */
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
      (typeof QUALITY !== "undefined" ? "   " + QUALITY.label() : "");
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
  if (typeof NAVDEBUG !== "undefined" && UI.screen === "playing") NAVDEBUG.draw(ctx, g);
  if (typeof FIRECREW !== "undefined" && UI.screen === "playing") FIRECREW.draw(ctx, g);
  if (typeof HOLDLINE !== "undefined" && UI.screen === "playing") HOLDLINE.draw(ctx, g);
  if (typeof OWNERS !== "undefined" && UI.screen === "playing") OWNERS.draw(ctx, g);
  if (typeof MISSIONS !== "undefined" && UI.screen === "playing") MISSIONS.draw(ctx, g);
  if (typeof CIVLIFE !== "undefined" && UI.screen === "playing") CIVLIFE.draw(ctx, g);
  if (typeof CRIME !== "undefined" && UI.screen === "playing") CRIME.draw(ctx, g);
  if (typeof TRAFFIC !== "undefined" && UI.screen === "playing") TRAFFIC.draw(ctx, g);
  if (typeof FRONTLINE !== "undefined" && UI.screen === "playing") FRONTLINE.draw(ctx, g);
  if (typeof DISPATCH !== "undefined" && UI.screen === "playing") DISPATCH.draw(ctx, g);
  if (typeof ARRESTFX !== "undefined" && UI.screen === "playing") ARRESTFX.draw(ctx, g);
  if (typeof ORDERFX !== "undefined" && (UI.screen === "playing" || UI.screen === "planning")) ORDERFX.draw(ctx, g);
  if (typeof SQUADCAM !== "undefined" && (UI.screen === "planning" || UI.screen === "playing")) SQUADCAM.draw(ctx, g);
  if (typeof POV !== "undefined" && UI.screen === "playing" && POV.active()) POV.draw(ctx, g, w, h);

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

  if (UI.screen === "planning" && typeof SQUADPLAN !== "undefined" && !(typeof FORCE !== "undefined" && FORCE.isOpen())) SQUADPLAN.draw(ctx, w, h, g);
  if (UI.screen === "playing" && typeof ALERTS !== "undefined") ALERTS.draw(ctx, w, h, g);
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
