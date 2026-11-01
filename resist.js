var RESIST = (function () {
  "use strict";

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function isRioter(a) {
    return a && a.role === "rioter";
  }

  function enabled() {
    return (typeof CONFIG !== "undefined") && CONFIG.rioterResist;
  }

  function countFriends(G, r) {
    var n = 0;
    var near = [];
    try {
      near = (typeof Crowd !== "undefined" && Crowd.neighbors) ? Crowd.neighbors(G, r.x, r.y, 3) : [];
    } catch (e) {
      near = [];
    }
    var i, a;
    for (i = 0; i < near.length; i++) {
      a = near[i];
      if (!a || a === r || !a.active) continue;
      if (a.role === "rioter") n++;
      else if (a.role === "peaceful" && a.mood >= 70) n++;
    }
    return n;
  }

  function nearestOfficerDist(G, r) {
    var best = Infinity;
    var officers = G.officers || [];
    var i, o, dx, dy, d2;
    for (i = 0; i < officers.length; i++) {
      o = officers[i];
      if (!o) continue;
      dx = o.x - r.x;
      dy = o.y - r.y;
      d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    if (best === Infinity) return Infinity;
    return Math.sqrt(best);
  }

  function makeFlee(G, r) {
    r.state = "flee";
    r._fleeUntil = G.time + CONFIG.fleeSeconds;
    r._flow = G.flow;
    r._targetShop = null;
  }

  function update(G, dt) {
    if (!enabled()) return;
    if (!G || !G.agents) return;
    var agents = G.agents;
    var i, r;
    for (i = 0; i < agents.length; i++) {
      r = agents[i];
      if (!r || !r.active || r.role !== "rioter") continue;

      if (typeof r._bold !== "number") r._bold = Math.random();

      if (typeof r._friendsAt !== "number" || (G.time - r._friendsAt) >= 0.5) {
        r._friends = countFriends(G, r);
        r._friendsAt = G.time;
      }

      var od = nearestOfficerDist(G, r);

      if (od <= 4.5 && r.state !== "flee") {
        if (typeof r._resistNext !== "number" || G.time >= r._resistNext) {
          r._resistNext = G.time + 2;
          var friends = typeof r._friends === "number" ? r._friends : 0;
          var flee = false;
          if (friends <= 1) {
            flee = Math.random() < 0.9;
          } else if (friends >= 4) {
            flee = r._bold < 0.1;
          } else {
            flee = r._bold < 0.5;
          }
          if (flee) {
            makeFlee(G, r);
            r._standing = false;
          } else {
            r._standing = true;
            r._standUntil = G.time + 3;
          }
        }
      }

      if (r._standing && typeof r._standUntil === "number" && G.time < r._standUntil) {
        if (od <= 2) {
          var rev = G.time + 1;
          if (typeof r.revealedUntil !== "number" || r.revealedUntil < rev) {
            r.revealedUntil = rev;
          }
        }
      } else if (r._standing && typeof r._standUntil === "number" && G.time >= r._standUntil) {
        r._standing = false;
      }
    }
  }

  function arrestRate(G, target, squadIndex, squad) {
    if (!enabled()) return 1;
    if (!isRioter(target)) return 1;
    var helpers = (typeof target._friends === "number") ? target._friends : countFriends(G, target);
    target._friends = helpers;
    var officers = 0;
    var sq = squad || [];
    var i, o, dx, dy;
    for (i = 0; i < sq.length; i++) {
      o = sq[i];
      if (!o) continue;
      dx = o.x - target.x;
      dy = o.y - target.y;
      if (dx * dx + dy * dy <= 2.5 * 2.5) officers++;
    }
    if (officers === 0) return 1;
    var rate = officers / (officers + helpers * 0.8);
    if (helpers === 0) rate = 1;
    return clamp(rate, 0.15, 1);
  }

  function breakFree(G, target, squadIndex, squad, dt) {
    if (!enabled()) return false;
    if (!isRioter(target)) return false;
    var helpers = (typeof target._friends === "number") ? target._friends : countFriends(G, target);
    target._friends = helpers;
    var sq = squad || [];
    var officers = 0;
    var i, o, dx, dy;
    for (i = 0; i < sq.length; i++) {
      o = sq[i];
      if (!o) continue;
      dx = o.x - target.x;
      dy = o.y - target.y;
      if (dx * dx + dy * dy <= 2.5 * 2.5) officers++;
    }
    if (helpers < officers + 2) return false;
    var chancePerSec = 0.25 * (helpers - officers - 1) / 4;
    if (chancePerSec > 0.6) chancePerSec = 0.6;
    if (chancePerSec <= 0) return false;
    var p = chancePerSec * dt;
    if (Math.random() >= p) return false;

    for (i = 0; i < sq.length; i++) {
      o = sq[i];
      if (!o) continue;
      dx = o.x - target.x;
      dy = o.y - target.y;
      if (dx * dx + dy * dy <= 3 * 3) {
        var st = G.time + 1.2;
        if (typeof o.stunUntil !== "number" || o.stunUntil < st) o.stunUntil = st;
      }
    }

    makeFlee(G, target);
    target._standing = false;
    target.revealedUntil = G.time + 6;

    var near = [];
    try {
      near = (typeof Crowd !== "undefined" && Crowd.neighbors) ? Crowd.neighbors(G, target.x, target.y, 3) : [];
    } catch (e) {
      near = [];
    }
    var k, a;
    for (k = 0; k < near.length; k++) {
      a = near[k];
      if (!a || !a.active) continue;
      if (a.role === "rioter" || a.role === "peaceful") {
        a.mood = Math.min(100, (a.mood || 0) + 5);
      }
    }

    var msg = "The crowd pulled a rioter free from squad " + (squadIndex + 1);
    if (typeof G.log === "function") G.log(msg);
    if (typeof UI !== "undefined" && UI && UI.say) UI.say(msg);
    return true;
  }

  function hint(G, agent) {
    if (!enabled()) return null;
    if (!isRioter(agent)) return null;
    if (typeof agent.revealedUntil !== "number" || agent.revealedUntil < G.time) return null;
    var friends = (typeof agent._friends === "number") ? agent._friends : 0;
    if (friends <= 1) return "alone - will run";
    if (friends >= 4) return "crowd - will resist";
    return "with friends - may resist";
  }

  function draw(ctx, G, ts) {
    if (!enabled()) return;
    if (!G || !G.agents || !ctx) return;
    var agents = G.agents;
    var officers = G.officers || [];
    var i, r, j, o, dx, dy;
    for (i = 0; i < agents.length; i++) {
      r = agents[i];
      if (!r || !r.active || r.role !== "rioter") continue;
      if (!r._standing) continue;
      if (typeof r._standUntil === "number" && G.time >= r._standUntil) continue;
      var nearOfficer = false;
      for (j = 0; j < officers.length; j++) {
        o = officers[j];
        if (!o) continue;
        dx = o.x - r.x;
        dy = o.y - r.y;
        if (dx * dx + dy * dy <= 2 * 2) { nearOfficer = true; break; }
      }
      if (!nearOfficer) continue;
      var px = r.x * ts;
      var py = r.y * ts;
      ctx.save();
      ctx.fillStyle = "#ff9900";
      ctx.font = "bold " + Math.max(8, Math.floor(ts * 0.5)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", px, py - ts * 0.35);
      ctx.restore();
    }
  }

  return {
    update: update,
    arrestRate: arrestRate,
    breakFree: breakFree,
    hint: hint,
    draw: draw
  };
})();
