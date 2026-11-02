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

  function groupCentroid(G, r) {
    var sx = r.x, sy = r.y, n = 1;
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
      if (a.role === "rioter" || (a.role === "peaceful" && a.mood >= 70)) {
        sx += a.x;
        sy += a.y;
        n++;
      }
    }
    return { x: sx / n, y: sy / n };
  }

  function nearestOfficer(G, r) {
    var best = null;
    var bestD = Infinity;
    var officers = G.officers || [];
    var i, o, dx, dy, d2;
    for (i = 0; i < officers.length; i++) {
      o = officers[i];
      if (!o) continue;
      dx = o.x - r.x;
      dy = o.y - r.y;
      d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = o; }
    }
    if (!best) return { officer: null, dist: Infinity };
    return { officer: best, dist: Math.sqrt(bestD) };
  }

  function makeFlee(G, r) {
    r.state = "flee";
    r._fleeUntil = G.time + CONFIG.fleeSeconds;
    r._flow = G.flow;
    r._targetShop = null;
  }

  function beginBrace(G, r, cen) {
    if (!r.braced) {
      r._preBraceState = r.state;
    }
    r.state = "brace";
    r.braced = true;
    r._braceX = cen.x;
    r._braceY = cen.y;
    r._braceUntil = G.time + 6;
    var rev = G.time + 2;
    if (typeof r.revealedUntil !== "number" || r.revealedUntil < rev) {
      r.revealedUntil = rev;
    }
    r._standing = true;
  }

  function endBrace(r) {
    if (!r.braced) return;
    r.braced = false;
    r.state = (typeof r._preBraceState === "string") ? r._preBraceState : "walk";
    r._preBraceState = null;
    r._standing = false;
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
        var cen = groupCentroid(G, r);
        r._cx = cen.x;
        r._cy = cen.y;
        r._friendsAt = G.time;
      }

      var no = nearestOfficer(G, r);
      var od = no.dist;
      var friends = (typeof r._friends === "number") ? r._friends : 0;

      // --- BRACED handling ---
      if (r.braced) {
        if (G.time >= r._braceUntil || od > 12) {
          endBrace(r);
        } else {
          // refresh brace centroid and timer while police stay near
          if (typeof r._cx === "number" && typeof r._cy === "number") {
            r._braceX = r._cx;
            r._braceY = r._cy;
          }
          if (od <= 9) {
            r._braceUntil = G.time + 6;
          }
          // mood rises slowly toward 100 (never suspicion)
          if (typeof r.mood !== "number") r.mood = 0;
          if (r.mood < 100) r.mood = clamp(r.mood + 3 * dt, 0, 100);
          // visible
          var rev = G.time + 2;
          if (typeof r.revealedUntil !== "number" || r.revealedUntil < rev) {
            r.revealedUntil = rev;
          }
          // shove nearby officers (non-graphic)
          if (no.officer && od <= 1.6) {
            var o = no.officer;
            if (typeof o.stamina !== "number") o.stamina = 100;
            o.stamina = clamp(o.stamina - 4 * dt, 0, 100);
          }
        }
        continue;
      }

      // --- BIG group: prepare to fight back ---
      if (friends >= 6 && od <= 9) {
        beginBrace(G, r, { x: (typeof r._cx === "number" ? r._cx : r.x), y: (typeof r._cy === "number" ? r._cy : r.y) });
        continue;
      }

      // --- SMALL group: run away early ---
      if (friends <= 3 && od <= 7 && no.officer && r.state !== "flee") {
        makeFlee(G, r);
        r._fleeFromX = no.officer.x;
        r._fleeFromY = no.officer.y;
        r._standing = false;
        continue;
      }

      // --- MEDIUM / existing behaviour ---
      if (od <= 4.5 && r.state !== "flee") {
        if (typeof r._resistNext !== "number" || G.time >= r._resistNext) {
          r._resistNext = G.time + 2;
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
            if (no.officer) {
              r._fleeFromX = no.officer.x;
              r._fleeFromY = no.officer.y;
            }
            r._standing = false;
          } else {
            r._standing = true;
            r._standUntil = G.time + 3;
          }
        }
      }

      if (r._standing && typeof r._standUntil === "number" && G.time < r._standUntil) {
        if (od <= 2) {
          var rev2 = G.time + 1;
          if (typeof r.revealedUntil !== "number" || r.revealedUntil < rev2) {
            r.revealedUntil = rev2;
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
    if (target.braced) rate *= 0.5;
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
    if (target.braced) chancePerSec *= 2;
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

    if (target.braced) endBrace(target);
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

  function braceDir(a) {
    if (!a || !a.braced) return null;
    if (typeof a._braceX !== "number" || typeof a._braceY !== "number") return null;
    var dx = a._braceX - a.x;
    var dy = a._braceY - a.y;
    var d2 = dx * dx + dy * dy;
    if (d2 <= 0.8 * 0.8) return null;
    var d = Math.sqrt(d2);
    return { x: dx / d, y: dy / d };
  }

  function hint(G, agent) {
    if (!enabled()) return null;
    if (!isRioter(agent)) return null;
    if (typeof agent.revealedUntil !== "number" || agent.revealedUntil < G.time) return null;
    if (agent.braced) return "bracing - will fight back";
    var friends = (typeof agent._friends === "number") ? agent._friends : 0;
    if (friends <= 1) return "alone - will run";
    if (friends >= 6) return "big crowd - will brace";
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
      if (r.braced) {
        var px = r.x * ts;
        var py = r.y * ts;
        ctx.save();
        ctx.fillStyle = "#ffdd00";
        ctx.font = "bold " + Math.max(8, Math.floor(ts * 0.5)) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("!", px, py - ts * 0.35);
        ctx.restore();
        continue;
      }
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
      var px2 = r.x * ts;
      var py2 = r.y * ts;
      ctx.save();
      ctx.fillStyle = "#ff9900";
      ctx.font = "bold " + Math.max(8, Math.floor(ts * 0.5)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", px2, py2 - ts * 0.35);
      ctx.restore();
    }
  }

  return {
    update: update,
    arrestRate: arrestRate,
    breakFree: breakFree,
    braceDir: braceDir,
    hint: hint,
    draw: draw
  };
})();
