/* pov.js - take control of one squad, GTA style (DeepSeek) */
var POV = (function () {
  var on = false;
  var squad = -1;
  var keys = { up: false, down: false, left: false, right: false, shift: false };
  var moveAcc = 0;
  var MOVE_INTERVAL = 0.15;
  var lastLeaderX = 0, lastLeaderY = 0;
  var haveLast = false;
  var camX = 0, camY = 0;
  var camInit = false;

  function resetKeys() {
    keys.up = false; keys.down = false; keys.left = false; keys.right = false; keys.shift = false;
  }

  function anyDir() {
    return keys.up || keys.down || keys.left || keys.right;
  }

  function getLeader(G, s) {
    // returns {x, y} of squad's leader (officer or vehicle)
    var i, o;
    if (G && G.officers) {
      for (i = 0; i < G.officers.length; i++) {
        o = G.officers[i];
        if (o && o.squad === s) return o;
      }
    }
    if (G && G.vehicles) {
      for (i = 0; i < G.vehicles.length; i++) {
        o = G.vehicles[i];
        if (o && o.squad === s && o.crew && o.crew.length) return o;
        if (o && o.squad === s) return o;
      }
    }
    return null;
  }

  function isAboard(G, s) {
    try {
      if (typeof TRANSPORT !== "undefined" && TRANSPORT && typeof TRANSPORT.isAboard === "function") {
        return !!TRANSPORT.isAboard(G, s);
      }
    } catch (e) {}
    return false;
  }

  function toggle(G) {
    if (on) {
      on = false;
      squad = -1;
      resetKeys();
      camInit = false;
      haveLast = false;
      if (typeof UI !== "undefined" && UI) {
        UI.follow = null;
        if (typeof UI.say === "function") UI.say("Commander view");
      }
      return;
    }
    if (!G) return;
    var s = (typeof UI !== "undefined" && UI && typeof UI.selected === "number") ? UI.selected : 0;
    if (s < 0 || s >= (CONFIG.squadCount || 1)) s = 0;
    squad = s;
    on = true;
    if (typeof Art !== "undefined" && Art.camera && Art.camera.zoom < 5) Art.camera.zoom = 5;   /* close-up on entry */
    resetKeys();
    moveAcc = 0;
    camInit = false;
    haveLast = false;
    if (typeof UI !== "undefined" && UI) {
      UI.follow = null;
      if (typeof UI.say === "function") {
        var label = "SQUAD";
        try { label = UNITTYPES.tag(G, s); } catch (e) {}
        UI.say("POV: " + label);
      }
    }
  }

  function active() { return on; }
  function controlled() { return on ? squad : -1; }

  function keydown(e) {
    if (!on) return false;
    if (!e) return false;
    var k = e.key;
    var code = e.keyCode;
    var shift = !!(e.shiftKey);
    if (shift) keys.shift = true;
    if (k === "w" || k === "W" || k === "ArrowUp" || code === 38) { keys.up = true; return true; }
    if (k === "s" || k === "S" || k === "ArrowDown" || code === 40) { keys.down = true; return true; }
    if (k === "a" || k === "A" || k === "ArrowLeft" || code === 37) { keys.left = true; return true; }
    if (k === "d" || k === "D" || k === "ArrowRight" || code === 39) { keys.right = true; return true; }
    if (k === " " || code === 32) { return true; }
    if (k === "e" || k === "E" || code === 69) { return true; }
    if (k === "f" || k === "F" || code === 70) { return true; }
    if (k === "Tab" || code === 9 || k === "q" || k === "Q" || code === 81) { return true; }
    if (k === "h" || k === "H" || code === 72 || k === "Escape" || code === 27) { return true; }
    return false;
  }

  function keyup(e) {
    if (!on) return false;
    if (!e) return false;
    var k = e.key;
    var code = e.keyCode;
    if (k === "w" || k === "W" || k === "ArrowUp" || code === 38) { keys.up = false; return true; }
    if (k === "s" || k === "S" || k === "ArrowDown" || code === 40) { keys.down = false; return true; }
    if (k === "a" || k === "A" || k === "ArrowLeft" || code === 37) { keys.left = false; return true; }
    if (k === "d" || k === "D" || k === "ArrowRight" || code === 39) { keys.right = false; return true; }
    if (!e.shiftKey) keys.shift = false;
    return false;
  }

  function handleActionKeys(G) {
    // Edge-triggered actions are handled through the game's key handler via POV.keydown consuming
    // But since we only track held state, we expose a small side channel: POV.keydown triggers actions directly.
    // To keep the API contract we perform them here only once per press via a flag.
  }

  // Press actions: we detect transitions inside keydown by tracking last press state in closure
  var pressState = {};
  function doPressActions(G, k) {
    if (!on || !G) return;
    if (k === "space") {
      try { Police.shove(G, squad); } catch (e) {}
      return;
    }
    if (k === "e") {
      try {
        var r = TRANSPORT.toggle(G, squad);
        var label = "SQUAD";
        try { label = UNITTYPES.tag(G, squad); } catch (e2) {}
        if (r === "boarding") { if (typeof UI !== "undefined" && UI.say) UI.say(label + " boarding"); }
        else if (r === "dismount") { if (typeof UI !== "undefined" && UI.say) UI.say(label + " dismount"); }
        else if (r === "novehicle") { if (typeof UI !== "undefined" && UI.say) UI.say(label + " has no vehicle"); }
        else { if (typeof UI !== "undefined" && UI.say) UI.say(label + " in/out"); }
      } catch (e3) {}
      return;
    }
    if (k === "tab" || k === "q") {
      var n = (CONFIG && CONFIG.squadCount) ? CONFIG.squadCount : 1;
      if (n <= 0) n = 1;
      squad = (squad + 1) % n;
      resetKeys();
      moveAcc = 0;
      if (typeof UI !== "undefined" && UI) {
        UI.selected = squad;
        UI.follow = null;
        var label2 = "SQUAD";
        try { label2 = UNITTYPES.tag(G, squad); } catch (e4) {}
        if (UI.say) UI.say("POV: " + label2);
      }
      return;
    }
    if (k === "p" || k === "escape") {
      toggle(G);
      return;
    }
    if (k === "f") {
      tryArrest(G);
      return;
    }
  }

  function tryArrest(G) {
    var leader = getLeader(G, squad);
    if (!leader) return false;
    var canArrest = true;
    try {
      if (typeof Police.getLoadout === "function" && typeof UNITTYPES.canArrest === "function") {
        canArrest = !!UNITTYPES.canArrest(Police.getLoadout(G, squad));
      }
    } catch (e) {}
    if (!canArrest) {
      if (typeof UI !== "undefined" && UI.say) UI.say("Cannot arrest");
      return false;
    }
    var lx = leader.x, ly = leader.y;
    var r2 = 2.5 * 2.5;
    var best = null, bestScore = -1;
    var agents = (G && G.agents) ? G.agents : null;
    if (agents) {
      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];
        if (!a || !a.active || a.arrested) continue;
        var dx = a.x - lx, dy = a.y - ly;
        var d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        var mood = (typeof a.mood === "number") ? a.mood : 0;
        var pref = (mood > 60) ? 1000 : 0;
        if (a.role === "rioter") pref += 500;
        var score = pref - d2;
        if (score > bestScore) { bestScore = score; best = a; }
      }
    }
    if (!best) {
      if (typeof UI !== "undefined" && UI.say) UI.say("No target");
      return false;
    }
    try {
      Police.orderArrest(G, squad, best);
      if (typeof UI !== "undefined" && UI.say) UI.say("Arresting");
      return true;
    } catch (e2) {
      if (typeof UI !== "undefined" && UI.say) UI.say("Arrest failed");
      return false;
    }
  }

  // augment keydown/keyup to also fire actions once per press (state machine)
  var _kd = keydown;
  keydown = function (e) {
    if (!on) return false;
    var consumed = _kd(e);
    if (!consumed) return false;
    var id = null;
    var k = e.key, code = e.keyCode;
    if (k === " " || code === 32) id = "space";
    else if (k === "e" || k === "E" || code === 69) id = "e";
    else if (k === "f" || k === "F" || code === 70) id = "f";
    else if (k === "Tab" || code === 9) id = "tab";
    else if (k === "q" || k === "Q" || code === 81) id = "q";
    else if (k === "h" || k === "H" || code === 72) id = "p";
    else if (k === "Escape" || code === 27) id = "escape";
    if (id && !pressState[id]) {
      pressState[id] = true;
      // defer action to next update to have G available
      pendingAction = id;
    }
    return consumed;
  };

  var pendingAction = null;

  function update(G, dt) {
    if (!on) return;
    if (!G) return;
    if (pendingAction) {
      var a = pendingAction;
      pendingAction = null;
      pressState[a] = false; // reset for next press
      doPressActions(G, a);
      if (!on) return;   /* the action left POV */
    }

    var leader = getLeader(G, squad);
    if (!leader) {
      // maybe squad removed; leave POV
      if (typeof UI !== "undefined" && UI.say) UI.say("Squad unavailable");
      toggle(G);
      return;
    }

    var lx = leader.x, ly = leader.y;

    // Camera follow
    var zoom = Math.max(3, (Art && Art.camera && Art.camera.zoom) || 5);   /* wheel still zooms, never far out */
    if (!camInit) { camX = lx; camY = ly; camInit = true; }
    var k = Math.min(1, 8 * dt);
    camX += (lx - camX) * k;
    camY += (ly - camY) * k;
    if (typeof Art !== "undefined" && Art && typeof Art.centerOn === "function") {
      Art.centerOn(camX, camY, zoom);
    }

    // Movement
    var dx = 0, dy = 0;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    var hasDir = (dx !== 0 || dy !== 0);

    var aboard = isAboard(G, squad);

    if (hasDir) {
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { dx /= len; dy /= len; }
      if (typeof VIEW3D !== "undefined" && VIEW3D.active()) {   /* 3D: W = away from the camera, D = to its right */
        var yw = VIEW3D.yaw(), fx = Math.cos(yw), fz = Math.sin(yw), fwd = -dy, rgt = dx;
        dx = fx * fwd - fz * rgt; dy = fz * fwd + fx * rgt;
      }
      moveAcc += dt;
      if (moveAcc >= MOVE_INTERVAL) {
        moveAcc = 0;
        var look = aboard ? 4 : 2.5;
        var tx = lx + dx * look;
        var ty = ly + dy * look;
        try { Police.moveSquad(G, squad, tx, ty, !!keys.shift); } catch (e) {}
      }
      haveLast = true;
      lastLeaderX = lx;
      lastLeaderY = ly;
    } else {
      // when released, one moveSquad to current spot
      if (haveLast && moveAcc > 0) {
        try { Police.moveSquad(G, squad, lx, ly, false); } catch (e2) {}
        moveAcc = 0;
      } else if (haveLast) {
        // ensure holding: only issue once on release transition
        try { Police.moveSquad(G, squad, lx, ly, false); } catch (e3) {}
        haveLast = false;
        moveAcc = 0;
      }
    }

    // keep UI.selected in sync
    if (typeof UI !== "undefined" && UI) {
      UI.selected = squad;
      UI.follow = null;
    }
  }

  function click(G, worldX, worldY) {
    if (!on) return false;
    if (!G) return false;
    // check leader proximity not required for click; but clamp to arrest radius anyway via tryArrest
    // find nearest agent to click within arrest radius of leader; if none, do nothing handled
    var handled = tryArrest(G);
    return handled;
  }

  function draw(ctx, G, lw, lh) {
    if (!on) return;
    if (!ctx) return;
    var w = lw || ctx.canvas.width, h = lh || ctx.canvas.height;   /* logical size from ui.js */
    var leader = getLeader(G, squad);

    // HUD panel bottom-center
    var tag = "SQUAD";
    try { tag = UNITTYPES.tag(G, squad); } catch (e) {}
    var text = "POV: " + tag +
      "  [WASD] move  [Shift] run  [E] vehicle  [Space] shove  [F/click] arrest  [Tab/Q] next squad  [H/Esc] exit";

    ctx.save();
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var tw = ctx.measureText(text).width;
    var pad = 10;
    var bw = tw + pad * 2;
    var bh = 26;
    var bx = (w - bw) / 2;
    var by = h - bh - 44;   /* above the status bar */
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 6);
      ctx.fill();
    } else {
      ctx.fillRect(bx, by, bw, bh);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, w / 2, by + bh / 2 + 1);
    ctx.restore();

    if (!leader) return;

    // Circle marker under leader
    if (typeof Art !== "undefined" && Art && typeof Art.project === "function") {
      var p = Art.project(leader.x, leader.y, 0);
      if (p) {
        ctx.save();
        ctx.strokeStyle = "rgba(80,200,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y + 10, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Nearest uncaught suspect arrow
    var list = null;
    try { if (typeof CRIME !== "undefined" && CRIME && typeof CRIME.list === "function") list = CRIME.list(); } catch (e2) {}
    if (list && list.length && leader) {
      var best = null, bestD2 = 40 * 40;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !c.culprits) continue;
        for (var j = 0; j < c.culprits.length; j++) {
          var q = c.culprits[j];
          if (!q || q.caught) continue;
          var dx = q.x - leader.x, dy = q.y - leader.y;
          var d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; best = q; }
        }
      }
      if (best) {
        var pp = null;
        try { pp = Art.project(best.x, best.y, 0); } catch (e3) {}
        if (pp) {
          var cx = w / 2, cy = h / 2;
          var vx = pp.x - cx, vy = pp.y - cy;
          var len = Math.sqrt(vx * vx + vy * vy);
          var margin = 40;
          var edge = false;
          var ax = pp.x, ay = pp.y;
          if (len < 1) { ax = cx; ay = cy - 100; edge = true; }
          if (ax < margin || ax > w - margin || ay < margin || ay > h - margin) {
            edge = true;
            // clamp direction to screen edge
            var tmax = Infinity;
            if (vx > 0) tmax = Math.min(tmax, (w - margin - cx) / vx);
            if (vx < 0) tmax = Math.min(tmax, (margin - cx) / vx);
            if (vy > 0) tmax = Math.min(tmax, (h - margin - cy) / vy);
            if (vy < 0) tmax = Math.min(tmax, (margin - cy) / vy);
            if (!isFinite(tmax) || tmax < 0) { tmax = 0; }
            ax = cx + vx * tmax;
            ay = cy + vy * tmax;
          }
          if (edge) {
            var ang = Math.atan2(vy, vx);
            var distTiles = Math.sqrt(bestD2);
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(ang);
            ctx.fillStyle = "rgba(255,80,80,0.95)";
            ctx.beginPath();
            ctx.moveTo(14, 0);
            ctx.lineTo(-8, -9);
            ctx.lineTo(-8, 9);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.font = "bold 11px sans-serif";
            ctx.fillStyle = "#ffb3b3";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            var label = Math.round(distTiles) + "t";
            var lx2 = ax, ly2 = ay;
            if (ax < w / 2) lx2 = ax + 4; else lx2 = ax - 4;
            // place label slightly toward center
            var bx2 = ax - (ax - w / 2) * 0.12;
            var by2 = ay - (ay - h / 2) * 0.12;
            if (ax < 20) bx2 = ax + 18;
            if (ax > w - 20) bx2 = ax - 18;
            if (ay < 20) by2 = ay + 16;
            if (ay > h - 20) by2 = ay - 16;
            ctx.fillText(label, bx2, by2);
            ctx.restore();
          }
        }
      }
    }
  }

  return {
    toggle: toggle,
    active: active,
    update: update,
    keydown: keydown,
    keyup: keyup,
    click: click,
    draw: draw,
    controlled: controlled
  };
})();
