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
      if (!o || o.active === false) continue;
      dx = o.x - r.x;
      dy = o.y - r.y;
      d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = o; }
    }
    if (!best) return { officer: null, dist: Infinity };
    return { officer: best, dist: Math.sqrt(bestD) };
  }

  function countOfficersNear(squad, target, radius) {
    var sq = squad || [];
    var r2 = radius * radius;
    var n = 0, i, o, dx, dy;
    for (i = 0; i < sq.length; i++) {
      o = sq[i];
      if (!o) continue;
      dx = o.x - target.x;
      dy = o.y - target.y;
      if (dx * dx + dy * dy <= r2) n++;
    }
    return n;
  }

  function makeFlee(G, r) {
    r.state = "flee";
    r._fleeUntil = G.time + CONFIG.fleeSeconds;
    r._flow = G.flow;
    r._targetShop = null;
    r._fdT = -1;
    r._fdX = undefined;
    r._fdY = undefined;
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
    r._throwCd = G.time + 1.5 + Math.random() * 2.0;
    r._thrownUntil = 0;
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
    r._thrownUntil = 0;
    r._throwCd = 0;
  }

  /* Direction for a fleeing rioter: away from the nearest officer, favoring
   * open, walkable tiles and penalizing dead ends. Cached per 0.3 s. */
  function fleeDir(G, a) {
    if (!a || a.role !== "rioter" || a.state !== "flee") return null;
    if (typeof Crowd === "undefined" || !Crowd.collides) return null;

    if (typeof a._fdT === "number" && (G.time - a._fdT) < 0.3 && typeof a._fdX === "number") {
      return { x: a._fdX, y: a._fdY };
    }

    var offX, offY;
    if (typeof a._offX === "number" && typeof a._offAt === "number" && (G.time - a._offAt) <= 0.6) {
      offX = a._offX; offY = a._offY;
    } else {
      var no = nearestOfficer(G, a);
      if (no.officer) { offX = no.officer.x; offY = no.officer.y; }
      else { offX = a.x - 1; offY = a.y; }
    }
    var ax = a.x - offX, ay = a.y - offY;
    var alen = Math.sqrt(ax * ax + ay * ay) || 1;
    ax /= alen; ay /= alen;

    var agentR = (CONFIG.agentRadius || 0.25);
    var bestScore = -Infinity, bx = ax, by = ay;
    var sdx, sdy, dl, nx, ny, px2, py2, tx, ty, open, ci, ccx, ccy, dot, score;

    for (sdy = -1; sdy <= 1; sdy++) {
      for (sdx = -1; sdx <= 1; sdx++) {
        if (!sdx && !sdy) continue;
        dl = Math.sqrt(sdx * sdx + sdy * sdy);
        nx = sdx / dl; ny = sdy / dl;
        px2 = a.x + nx * 1.0;
        py2 = a.y + ny * 1.0;
        if (Crowd.collides(G, px2, py2, agentR)) continue;
        tx = Math.floor(px2); ty = Math.floor(py2);
        open = 0;
        for (ci = 0; ci < 4; ci++) {
          ccx = (tx + (ci === 0 ? 1 : ci === 1 ? -1 : 0)) + 0.5;
          ccy = (ty + (ci === 2 ? 1 : ci === 3 ? -1 : 0)) + 0.5;
          if (!Crowd.collides(G, ccx, ccy, 0.05)) open++;
        }
        dot = nx * ax + ny * ay;
        score = dot * 1.5 + Math.min(open, 3) * 0.2;
        if (open <= 1) score -= 1.0;
        if (dot < -0.3) score -= 2.0;
        if (score > bestScore) { bestScore = score; bx = nx; by = ny; }
      }
    }
    if (bestScore === -Infinity) { bx = ax; by = ay; }
    a._fdT = G.time; a._fdX = bx; a._fdY = by;
    return { x: bx, y: by };
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

      if (typeof r._offAt !== "number" || (G.time - r._offAt) >= 0.4) {
        var no0 = nearestOfficer(G, r);
        r._off = no0.officer;
        r._offDist = no0.dist;
        r._offX = no0.officer ? no0.officer.x : null;
        r._offY = no0.officer ? no0.officer.y : null;
        r._offAt = G.time;
      }
      var od = (typeof r._offDist === "number") ? r._offDist : Infinity;
      var friends = (typeof r._friends === "number") ? r._friends : 0;

      // --- FLEE: keep running while an officer is close, otherwise blend back ---
      if (r.state === "flee") {
        if (od <= 8) {
          r._fleeUntil = G.time + 0.8;
        }
        continue;
      }

      // --- BRACED handling ---
      if (r.braced) {
        if (G.time >= r._braceUntil || od > 12) {
          endBrace(r);
        } else {
          if (typeof r._cx === "number" && typeof r._cy === "number") {
            r._braceX = r._cx;
            r._braceY = r._cy;
          }
          if (od <= 9) {
            r._braceUntil = G.time + 6;
          }
          if (typeof r.mood !== "number") r.mood = 0;
          if (r.mood < 100) r.mood = clamp(r.mood + 3 * dt, 0, 100);
          var rev = G.time + 2;
          if (typeof r.revealedUntil !== "number" || r.revealedUntil < rev) {
            r.revealedUntil = rev;
          }

          // shove officers back out (non-graphic)
          if (od <= 1.6 && r._off && r._off.active !== false) {
            var o = r._off;
            var rcx = (typeof r._braceX === "number") ? r._braceX : r.x;
            var rcy = (typeof r._braceY === "number") ? r._braceY : r.y;
            var odx = o.x - rcx, ody = o.y - rcy;
            var od2 = odx * odx + ody * ody;
            if (od2 < 0.0001) { odx = 1; ody = 0; od2 = 1; }
            var odl = Math.sqrt(od2);
            var pushStep = 0.05;
            var pnx = o.x + (odx / odl) * pushStep;
            var pny = o.y + (ody / odl) * pushStep;
            var oR = (typeof o.radius === "number") ? o.radius : (CONFIG.agentRadius || 0.25);
            if (typeof Crowd !== "undefined" && Crowd.collides) {
              if (!Crowd.collides(G, pnx, o.y, oR)) o.x = pnx;
              if (!Crowd.collides(G, o.x, pny, oR)) o.y = pny;
            } else {
              o.x = pnx; o.y = pny;
            }
            if (typeof o.stamina !== "number") o.stamina = 100;
            o.stamina = clamp(o.stamina - 5 * dt, 0, 100);
          }

          // some braced rioters hurl objects at police within 5 tiles
          if (G.time >= (r._throwCd || 0)) {
            var target = null, bestD2 = 25, oi, of, tdx, tdy, td;
            for (oi = 0; oi < G.officers.length; oi++) {
              of = G.officers[oi];
              if (!of || of.active === false) continue;
              tdx = of.x - r.x; tdy = of.y - r.y;
              td = tdx * tdx + tdy * tdy;
              if (td < bestD2) { bestD2 = td; target = of; }
            }
            if (target) {
              r._throwCd = G.time + 2.5 + Math.random() * 2.5;
              if (Math.random() < 0.55) {
                var st = G.time + 0.7;
                if (typeof target.stunUntil !== "number" || target.stunUntil < st) target.stunUntil = st;
                if (typeof target.stamina === "number") target.stamina = clamp(target.stamina - 8, 0, 100);
                r._thrownUntil = G.time + 0.8;
                r.revealedUntil = Math.max(r.revealedUntil || 0, G.time + 2);
                r.violentUntil = Math.max(r.violentUntil || 0, G.time + 2);
                if (typeof FX !== "undefined" && FX.throwAt) FX.throwAt(G, r, target);
                if (typeof G._lastThrowLog !== "number" || (G.time - G._lastThrowLog) > 3) {
                  G._lastThrowLog = G.time;
                  if (typeof G.log === "function") G.log("Object thrown at police");
                }
              }
            }
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
      if (friends <= 3 && od <= 7 && r._off && r.state !== "flee") {
        makeFlee(G, r);
        r._fleeFromX = r._off.x;
        r._fleeFromY = r._off.y;
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
            if (r._off) {
              r._fleeFromX = r._off.x;
              r._fleeFromY = r._off.y;
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
    var officers = countOfficersNear(squad, target, 2.5);
    if (officers === 0) return 1;
    if (target.braced) {
      // only when the squad clearly outnumbers the nearby helpers
      if (officers < helpers + 2) return 0;
      return 0.35;
    }
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
    var officers = countOfficersNear(sq, target, 2.5);

    var p = 0;
    if (target.braced) {
      if (officers > helpers + 1) return false;
      var bcps = 0.5 + 0.15 * (helpers - officers);
      if (bcps > 0.9) bcps = 0.9;
      if (bcps < 0.15) bcps = 0.15;
      p = bcps * dt;
    } else {
      if (helpers < officers + 2) return false;
      var cps = 0.25 * (helpers - officers - 1) / 4;
      if (cps > 0.6) cps = 0.6;
      if (cps <= 0) return false;
      p = cps * dt;
    }
    if (Math.random() >= p) return false;

    var i, o, dx, dy;
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
    var i, j, r, o, dx, dy;

    // collect braced groups (dedupe by brace centroid)
    var groups = [];
    for (i = 0; i < agents.length; i++) {
      r = agents[i];
      if (!r || !r.active || r.role !== "rioter" || !r.braced) continue;
      var bx = (typeof r._braceX === "number") ? r._braceX : r.x;
      var by = (typeof r._braceY === "number") ? r._braceY : r.y;
      var found = -1;
      for (j = 0; j < groups.length; j++) {
        var gdx = groups[j].x - bx, gdy = groups[j].y - by;
        if (gdx * gdx + gdy * gdy <= 4) { found = j; break; }
      }
      if (found < 0) groups.push({ x: bx, y: by, n: 1 });
      else groups[found].n++;
    }

    if (groups.length) {
      ctx.save();
      ctx.strokeStyle = "#ff2020";
      ctx.lineWidth = 2;
      if (typeof ctx.setLineDash === "function") ctx.setLineDash([4, 3]);
      for (i = 0; i < groups.length; i++) {
        var grp = groups[i];
        var rad = (0.7 + 0.18 * Math.min(grp.n, 8)) * ts;
        ctx.beginPath();
        ctx.arc(grp.x * ts, grp.y * ts, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
      ctx.restore();
    }

    // short "!" over a thrower
    for (i = 0; i < agents.length; i++) {
      r = agents[i];
      if (!r || !r.active || r.role !== "rioter") continue;
      if (typeof r._thrownUntil !== "number" || r._thrownUntil <= G.time) continue;
      var tpx = r.x * ts;
      var tpy = r.y * ts;
      ctx.save();
      ctx.fillStyle = "#ffdd00";
      ctx.font = "bold " + Math.max(8, Math.floor(ts * 0.5)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", tpx, tpy - ts * 0.4);
      ctx.restore();
    }

    // existing marker for non-braced rioters who are standing up to police
    for (i = 0; i < agents.length; i++) {
      r = agents[i];
      if (!r || !r.active || r.role !== "rioter") continue;
      if (r.braced) continue;
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
    fleeDir: fleeDir,
    hint: hint,
    draw: draw
  };
})();

/* a shove may delay, never reverse, a squad moving to an order */
(function () {
  var oldUpdate = RESIST.update;
  RESIST.update = function (G, dt) {
    if (!G || !G.officers) { oldUpdate(G, dt); return; }
    var before = [], i, o;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o && typeof o.tx === "number" && typeof o.ty === "number") {
        before.push({ o: o, x: o.x, y: o.y });
      }
    }
    oldUpdate(G, dt);
    for (i = 0; i < before.length; i++) {
      o = before[i].o;
      if (!o) continue;
      var oldD = (before[i].x - o.tx) * (before[i].x - o.tx) + (before[i].y - o.ty) * (before[i].y - o.ty);
      var newD = (o.x - o.tx) * (o.x - o.tx) + (o.y - o.ty) * (o.y - o.ty);
      if (newD > oldD + 0.0001) { o.x = before[i].x; o.y = before[i].y; }
    }
  };
})();
