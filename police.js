/* police.js - police squads, stances, tools, observation, arrests.
 * Exposes a global Police object. All coordinates are in tile units.
 * Hooks into crowd.js through G.officers, Crowd.arrest, Crowd.loudspeaker,
 * Crowd.neighbors, Crowd.rebuildFlow. Owns agent.suspicion.
 */
var Police = (function () {
  "use strict";

  /* Local solid test (mirrors crowd.js idea but does not depend on its export). */
  function tkey(x, y) { return x + "," + y; }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < MAP.width && y < MAP.height;
  }
  function isSolid(G, x, y) {
    if (!inBounds(x, y)) return true;
    var ch = MAP.rows[y].charAt(x);
    if (ch === "#" || ch === "S") return true;
    if (G.blocked && G.blocked.has(tkey(x, y))) return true;
    return false;
  }

  /* Choose a sensible spawn: road tile just west of the plaza on the boulevard.
   * MAP rows[18..19] are the main boulevard; x=25, y=19 is '.' (road) and
   * adjacent to the plaza at x=27. */
  var SPAWN = { x: 25, y: 19 };

  /* Move an officer one step toward (tx, ty) at given speed, avoiding solids. */
  function stepToward(G, off, dt) {
    var dx = off.tx - off.x;
    var dy = off.ty - off.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.05) { off.x = off.tx; off.y = off.ty; return; }
    var step = off.speed * dt;
    if (step > d) step = d;
    var ux = dx / d, uy = dy / d;
    var nx = off.x + ux * step;
    var ny = off.y + uy * step;
    var txi = Math.floor(nx), tyi = Math.floor(ny);
    if (!isSolid(G, txi, tyi)) {
      off.x = nx; off.y = ny;
      return;
    }
    /* Try axis-aligned moves. */
    var nx2 = off.x + ux * step, ny2 = off.y;
    if (!isSolid(G, Math.floor(nx2), Math.floor(ny2))) { off.x = nx2; return; }
    var nx3 = off.x, ny3 = off.y + uy * step;
    if (!isSolid(G, Math.floor(nx3), Math.floor(ny3))) { off.y = ny3; return; }
  }

  function init(G) {
    G.officers = [];
    G.barriers = [];
    G.loudspeakerReadyAt = 0;
    G.over = false;
    G.endReason = "";
    var id = 1;
    for (var s = 0; s < CONFIG.squadCount; s++) {
      for (var k = 0; k < CONFIG.officersPerSquad; k++) {
        G.officers.push({
          id: id++,
          squad: s,
          x: SPAWN.x + (k * 0.4),
          y: SPAWN.y + (s * 0.5),
          stance: "calm",
          tx: SPAWN.x,
          ty: SPAWN.y,
          speed: CONFIG.officerSpeed,
          busy: false,
          arrestTarget: null,
          arrestHold: 0
        });
      }
    }
  }

  function update(G, dt) {
    if (G.over) return;
    if (G.time >= CONFIG.matchSeconds) {
      G.over = true;
      G.endReason = "time";
      return;
    }

    /* Observation / suspicion. */
    var obsR = CONFIG.observeRadiusTiles;
    var seen = {}; /* agentId -> true if any officer saw it this tick */
    var i, j;
    for (i = 0; i < G.officers.length; i++) {
      var off = G.officers[i];
      stepToward(G, off, dt);
      var nb = Crowd.neighbors(G, off.x, off.y, obsR);
      for (j = 0; j < nb.length; j++) {
        var a = nb[j];
        if (!a.active) continue;
        seen[a.id] = true;
        var rise = 0;
        if (a.hasTool || a.revealedUntil > G.time) rise = 15;
        else if (a.state === "agitated" || a.mood >= 70) rise = 3;
        if (rise > 0) a.suspicion = Math.min(100, a.suspicion + rise * dt);
      }
    }
    /* Decay for unseen agents. */
    for (i = 0; i < G.agents.length; i++) {
      var a2 = G.agents[i];
      if (!a2.active) continue;
      if (!seen[a2.id]) a2.suspicion = Math.max(0, a2.suspicion - 2 * dt);
    }

    /* Arrest logic per squad. */
    for (var s = 0; s < CONFIG.squadCount; s++) {
      var squad = [];
      for (i = 0; i < G.officers.length; i++) {
        if (G.officers[i].squad === s) squad.push(G.officers[i]);
      }
      var leader = squad[0];
      if (!leader) continue;

      /* If currently arresting, advance the hold timer. */
      if (leader.arrestTarget) {
        var tgt = leader.arrestTarget;
        if (!tgt.active || tgt.suspicion < CONFIG.suspicionThreshold) {
          /* cancel */
          leader.arrestTarget = null;
          leader.arrestHold = 0;
          for (j = 0; j < squad.length; j++) squad[j].busy = false;
        } else {
          var ddx = tgt.x - leader.x, ddy = tgt.y - leader.y;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd > obsR) {
            leader.arrestTarget = null;
            leader.arrestHold = 0;
            for (j = 0; j < squad.length; j++) squad[j].busy = false;
          } else if (dd < 1.0) {
            leader.arrestHold += dt;
            for (j = 0; j < squad.length; j++) squad[j].busy = true;
            if (leader.arrestHold >= CONFIG.arrestSeconds) {
              Crowd.arrest(G, tgt);
              leader.arrestTarget = null;
              leader.arrestHold = 0;
              for (j = 0; j < squad.length; j++) squad[j].busy = false;
            }
          } else {
            /* Walk two officers toward target. */
            if (squad[0]) { squad[0].tx = tgt.x; squad[0].ty = tgt.y; }
            if (squad[1]) { squad[1].tx = tgt.x; squad[1].ty = tgt.y; }
          }
        }
        continue;
      }

      /* Pick a target: highest-suspicion active agent within observe range of leader. */
      var best = null, bestS = CONFIG.suspicionThreshold;
      var nb2 = Crowd.neighbors(G, leader.x, leader.y, obsR);
      for (j = 0; j < nb2.length; j++) {
        var b = nb2[j];
        if (!b.active) continue;
        if (b.suspicion >= bestS) { bestS = b.suspicion; best = b; }
      }
      if (best) {
        leader.arrestTarget = best;
        leader.arrestHold = 0;
      }
    }
  }

  function draw(ctx, G) {
    var ts = CONFIG.tileSize;
    var i;
    /* Barriers. */
    for (i = 0; i < G.barriers.length; i++) {
      var b = G.barriers[i];
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(b.x * ts, b.y * ts, ts, ts);
      ctx.strokeStyle = "#ffcc33";
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x * ts + 0.5, b.y * ts + 0.5, ts - 1, ts - 1);
    }
    /* Officers. */
    for (i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      var px = o.x * ts, py = o.y * ts;
      ctx.fillStyle = (o.stance === "firm") ? "#e06030" : "#3060c0";
      ctx.fillRect(px - 3, py - 3, 6, 6);
      if (o.busy) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /* ----- Commands (future UI calls these) ----- */
  function moveSquad(G, squadIndex, x, y) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) {
        G.officers[i].tx = x;
        G.officers[i].ty = y;
      }
    }
  }

  function setStance(G, squadIndex, stance) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) G.officers[i].stance = stance;
    }
  }

  function toggleStance(G, squadIndex) {
    for (var i = 0; i < G.officers.length; i++) {
      if (G.officers[i].squad === squadIndex) {
        G.officers[i].stance = (G.officers[i].stance === "firm") ? "calm" : "firm";
      }
    }
  }

  function loudspeaker(G, x, y) {
    if (G.time < G.loudspeakerReadyAt) return false;
    Crowd.loudspeaker(G, x, y, CONFIG.loudspeakerRadius, CONFIG.loudspeakerStrength);
    G.loudspeakerReadyAt = G.time + CONFIG.loudspeakerCooldown;
    G.log("Loudspeaker used");
    return true;
  }

  function placeBarrier(G, x, y) {
    if (!inBounds(x, y)) return false;
    if (isSolid(G, x, y)) return false;
    if (G.barriers.length >= CONFIG.barrierCount) return false;
    G.blocked.add(tkey(x, y));
    G.barriers.push({ x: x, y: y });
    Crowd.rebuildFlow(G);
    G.log("Barrier placed at " + x + "," + y);
    return true;
  }

  return {
    init: init,
    update: update,
    draw: draw,
    moveSquad: moveSquad,
    setStance: setStance,
    toggleStance: toggleStance,
    loudspeaker: loudspeaker,
    placeBarrier: placeBarrier
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Police;
}
