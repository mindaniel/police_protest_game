var MARCHES = (function () {
  var marches = [];
  var nextId = 0;
  var lastSchedule = -1;
  var initDone = false;

  function hash(n) {
    var x = (n * 2654435761) % 4294967296;
    x = (x ^ (x >>> 13)) * 1597334677 % 4294967296;
    return (x >>> 0) / 4294967296;
  }

  function init(G) {
    marches = [];
    nextId = 0;
    lastSchedule = -1;
    initDone = true;
  }

  function getWalkable(G, x, y) {
    if (!MAP) return false;
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
    var c = MAP.rows[y].charAt(x);
    return c === '.' || c === 'a' || c === 'P' || c === 'G';
  }

  function bfsRoute(G, sx, sy, ex, ey) {
    if (!MAP) return null;
    var W = MAP.width, H = MAP.height;
    if (!getWalkable(G, sx, sy) || !getWalkable(G, ex, ey)) return null;
    var blocked = G.blocked || {};
    var parents = new Int32Array(W * H);
    for (var i = 0; i < parents.length; i++) parents[i] = -1;
    var startIdx = sy * W + sx;
    var endIdx = ey * W + ex;
    if (startIdx === endIdx) return [{ x: sx, y: sy }];
    parents[startIdx] = startIdx;
    var q = [startIdx];
    var head = 0;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < q.length) {
      var cur = q[head++];
      if (cur === endIdx) break;
      var cx = cur % W, cy = (cur - cx) / W;
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = ny * W + nx;
        if (parents[ni] !== -1) continue;
        if ((blocked.has ? blocked.has(nx + "," + ny) : blocked[nx + "," + ny])) continue;
        if (!getWalkable(G, nx, ny)) continue;
        parents[ni] = cur;
        q.push(ni);
      }
    }
    if (parents[endIdx] === -1) return null;
    var path = [];
    var c = endIdx;
    while (c !== startIdx) {
      var px = c % W, py = (c - px) / W;
      path.push({ x: px, y: py });
      c = parents[c];
    }
    path.push({ x: sx, y: sy });
    path.reverse();
    return path;
  }

  function simplify(path) {
    if (!path || path.length < 2) return path || [];
    var out = [path[0]];
    var acc = 0;
    for (var i = 1; i < path.length; i++) {
      acc++;
      if (acc >= 6 || i === path.length - 1) {
        out.push(path[i]);
        acc = 0;
      }
    }
    return out;
  }

  function countAgentsNear(G, x, y, r) {
    var n = 0;
    var agents = G.agents || [];
    var r2 = r * r;
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (!a.active || a.role !== "peaceful") continue;
      var dx = a.x - x, dy = a.y - y;
      if (dx * dx + dy * dy <= r2) n++;
    }
    return n;
  }

  function pickRoute(G, start, end) {
    var path = bfsRoute(G, start.x, start.y, end.x, end.y);
    if (!path) return null;
    return simplify(path);
  }

  function planMarch(G) {
    if (typeof LANDMARKS === "undefined" || !LANDMARKS.rallyPoints) return null;
    var points = LANDMARKS.rallyPoints();
    if (!points || points.length < 2) return null;
    var bestStart = null, bestCount = -1;
    for (var i = 0; i < points.length; i++) {
      var c = countAgentsNear(G, points[i].x, points[i].y, 8);
      if (c > bestCount) { bestCount = c; bestStart = points[i]; }
    }
    if (!bestStart || bestCount < 1) return null;
    var candidates = [];
    for (var j = 0; j < points.length; j++) {
      var p = points[j];
      if (p === bestStart) continue;
      var dx = p.x - bestStart.x, dy = p.y - bestStart.y;
      if (dx * dx + dy * dy >= 625) candidates.push(p);
    }
    if (!candidates.length) {
      for (var k = 0; k < points.length; k++) {
        if (points[k] !== bestStart) candidates.push(points[k]);
      }
    }
    candidates.sort(function (a, b) {
      var ag = a.type === "gov" ? 0 : 1, bg = b.type === "gov" ? 0 : 1;
      if (ag !== bg) return ag - bg;
      var ad = (a.x - bestStart.x) * (a.x - bestStart.x) + (a.y - bestStart.y) * (a.y - bestStart.y);
      var bd = (b.x - bestStart.x) * (b.x - bestStart.x) + (b.y - bestStart.y) * (b.y - bestStart.y);
      return bd - ad;
    });
    for (var m = 0; m < candidates.length; m++) {
      var route = pickRoute(G, bestStart, candidates[m]);
      if (route && route.length >= 2) {
        return { start: bestStart, end: candidates[m], route: route };
      }
    }
    return null;
  }

  function routeBlocked(G, route, wi) {
    var blocked = G.blocked || {};
    if (!blocked) return false;
    for (var s = wi; s < Math.min(wi + 3, route.length - 1); s++) {
      var a = route[s], b = route[s + 1];
      var steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (var t = 1; t < steps; t++) {
        var tx = a.x + Math.round((b.x - a.x) * t / steps);
        var ty = a.y + Math.round((b.y - a.y) * t / steps);
        if ((blocked.has ? blocked.has(tx + "," + ty) : blocked[tx + "," + ty])) return { x: tx, y: ty };
      }
    }
    return null;
  }

  function getMembers(G, m) {
    var out = [];
    var agents = G.agents || [];
    for (var i = 0; i < agents.length; i++) {
      if (agents[i]._march === m.id && agents[i].active) out.push(agents[i]);
    }
    return out;
  }

  function centreOf(members) {
    if (!members.length) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < members.length; i++) { sx += members[i].x; sy += members[i].y; }
    return { x: sx / members.length, y: sy / members.length };
  }

  function releaseMember(G, a) {
    a._march = null;
    a._flow = null;
    a._zone = -1;
    if (typeof Crowd !== "undefined" && Crowd.assignZone) {
      Crowd.assignZone(G, a);
    } else {
      a._zone = -1;
    }
  }

  function releaseAll(G, m) {
    var members = getMembers(G, m);
    for (var i = 0; i < members.length; i++) releaseMember(G, members[i]);
  }

  function scheduleNext(G, idx) {
    if (idx >= 4) return Infinity;
    var h = hash(MAP.width * 7919 + idx * 104729);
    return 150 + Math.floor(h * 90);
  }

  function update(G, dt) {
    if (!initDone) init(G);
    if (typeof MAP === "undefined" || !MAP) return;
    var matchSeconds = (typeof CONFIG !== "undefined" && CONFIG.matchSeconds) || 900;

    // Schedule
    var hasActive = false;
    for (var i = 0; i < marches.length; i++) {
      var ph = marches[i].phase;
      if (ph === "announced" || ph === "forming" || ph === "marching" || ph === "stuck") hasActive = true;
    }
    if (!hasActive && G.time >= 90 && G.time < matchSeconds - 120) {
      var count = G.stats && G.stats.marches ? G.stats.marches : 0;
      var nextAt = lastSchedule < 0 ? 90 : lastSchedule + scheduleNext(G, count);
      if (lastSchedule < 0) lastSchedule = 90;
      if (G.time >= nextAt && count < 4) {
        var plan = planMarch(G);
        if (plan) {
          var m = {
            id: nextId++,
            phase: "announced",
            start: plan.start,
            end: plan.end,
            route: plan.route,
            wi: 0,
            t: 60,
            stuckT: 0,
            centre: null,
            lastBlockCheck: 0,
            arrivedRelease: 0
          };
          marches.push(m);
          lastSchedule = G.time;
          G.stats = G.stats || {};
          G.stats.marches = (G.stats.marches || 0) + 1;
          G.stats.marchEscortSeconds = G.stats.marchEscortSeconds || 0;
          G.log("March announced: " + plan.start.name + " -> " + plan.end.name + " in 60 s");
        }
      }
    }

    for (var mi = 0; mi < marches.length; mi++) {
      var m = marches[mi];
      var members = getMembers(G, m);

      if (m.phase === "announced") {
        m.t -= dt;
        if (m.t <= 0) {
          m.phase = "forming";
          m.t = 20;
        }
        continue;
      }

      if (m.phase === "forming") {
        m.t -= dt;
        var agents = G.agents || [];
        var joined = members.length;
        for (var ai = 0; ai < agents.length && joined < 120; ai++) {
          var a = agents[ai];
          if (!a.active || a.role !== "peaceful" || a._march != null) continue;
          if (a.mood < 25) continue;
          var dx = a.x - m.start.x, dy = a.y - m.start.y;
          if (dx * dx + dy * dy > 196) continue;
          a._march = m.id;
          a._zone = -1;
          a._flow = (typeof Crowd !== "undefined" && Crowd.fieldTo) ? Crowd.fieldTo(G, m.start.x, m.start.y) : null;
          joined++;
        }
        if (m.t <= 0) {
          m.phase = "marching";
          m.t = 0;
          m.wi = 0;
        }
        continue;
      }

      if (m.phase === "marching" || m.phase === "stuck") {
        var mem = getMembers(G, m);
        m.centre = centreOf(mem);

        // Escort check
        var officers = G.officers || [];
        var escorts = 0;
        if (m.centre) {
          for (var oi = 0; oi < officers.length; oi++) {
            var o = officers[oi];
            var odx = o.x - m.centre.x, ody = o.y - m.centre.y;
            if (odx * odx + ody * ody <= 36) escorts++;
          }
        }
        if (escorts >= 4 && m.centre) {
          G.stats.marchEscortSeconds = (G.stats.marchEscortSeconds || 0) + dt;
        }

        // Mood changes
        var routeBlk = m.phase === "marching" ? routeBlocked(G, m.route, m.wi) : true;
        for (var mi2 = 0; mi2 < mem.length; mi2++) {
          var mm = mem[mi2];
          if (m.phase === "stuck") {
            mm.mood = Math.min(100, mm.mood + 3 * dt);
          } else if (routeBlk) {
            mm.mood = Math.min(100, mm.mood + 3 * dt);
          } else if (escorts >= 4) {
            mm.mood = Math.max(0, mm.mood - 0.4 * dt);
          } else {
            mm.mood = Math.min(100, mm.mood + 0.3 * dt);
          }
        }

        if (m.phase === "stuck") {
          m.stuckT += dt;
          m.t = 60 - m.stuckT;
          // Try to unblock
          if (m.centre) {
            var newRoute = pickRoute(G, Math.round(m.centre.x), Math.round(m.centre.y), m.end.x, m.end.y);
            if (newRoute) {
              m.route = newRoute;
              m.wi = 0;
              m.phase = "marching";
              m.stuckT = 0;
              m.t = 0;
              G.log("March re-routed through " + m.end.name);
            }
          }
          if (m.stuckT >= 60) {
            m.phase = "broken";
            G.stats.marchesBroken = (G.stats.marchesBroken || 0) + 1;
            G.log("The march broke up at " + (m.centre ? ("tile " + Math.round(m.centre.x) + "," + Math.round(m.centre.y)) : "the street"));
            var broke = getMembers(G, m);
            for (var bi = 0; bi < broke.length; bi++) {
              var b = broke[bi];
              if (b.mood > 70) {
                b.role = "rioter";
                b.state = "march";
                b._march = null;
                b._flow = null;
                b._zone = -1;
                G.rioterTotal = (G.rioterTotal || 0) + 1;
              } else {
                releaseMember(G, b);
              }
            }
          }
          continue;
        }

        // Marching: advance waypoints
        m.lastBlockCheck += dt;
        if (m.lastBlockCheck >= 2) {
          m.lastBlockCheck = 0;
          if (routeBlk) {
            m.phase = "stuck";
            m.stuckT = 0;
            m.t = 60;
            if (m.centre) {
              G.log("The march is blocked at tile " + Math.round(routeBlk.x) + "," + Math.round(routeBlk.y));
            }
            continue;
          }
        }

        if (m.wi >= m.route.length - 1) {
          // Arrived
          m.phase = "arrived";
          m.arrivedRelease = 30;
          G.stats.marchesArrived = (G.stats.marchesArrived || 0) + 1;
          G.log("The march reached " + m.end.name);
          var arrived = getMembers(G, m);
          for (var ri = 0; ri < arrived.length; ri++) {
            arrived[ri].mood = Math.max(0, arrived[ri].mood - 10);
            arrived[ri]._flow = (typeof Crowd !== "undefined" && Crowd.fieldTo) ? Crowd.fieldTo(G, m.end.x, m.end.y) : null;
          }
          continue;
        }

        // Update member flows
        var wp = m.route[m.wi];
        var field = (typeof Crowd !== "undefined" && Crowd.fieldTo) ? Crowd.fieldTo(G, wp.x, wp.y) : null;
        var near = 0;
        for (var fi = 0; fi < mem.length; fi++) {
          var fm = mem[fi];
          fm._flow = field;
          var fdx = fm.x - wp.x, fdy = fm.y - wp.y;
          if (fdx * fdx + fdy * fdy <= 16) near++;
        }
        var wpTime = m.t + dt;
        m.t = wpTime;
        if (mem.length > 0 && near / mem.length >= 0.4) {
          m.wi++;
          m.t = 0;
        } else if (m.t >= 25) {
          m.wi++;
          m.t = 0;
        }
        continue;
      }

      if (m.phase === "arrived") {
        m.arrivedRelease -= dt;
        m.t = Math.max(0, m.arrivedRelease);
        if (m.arrivedRelease <= 0) {
          releaseAll(G, m);
          m.phase = "done";
        }
        continue;
      }
    }
  }

  function list(G) {
    var out = [];
    for (var i = 0; i < marches.length; i++) {
      var m = marches[i];
      out.push({
        phase: m.phase,
        start: { x: m.start.x, y: m.start.y, name: m.start.name },
        end: { x: m.end.x, y: m.end.y, name: m.end.name },
        route: m.route,
        wi: m.wi,
        members: getMembers(G, m).length,
        centre: m.centre,
        t: m.t
      });
    }
    return out;
  }

  function draw(ctx, G) {
    if (typeof Art === "undefined" || !Art.project) return;
    var tilePx = Art.project(1, 0, 0).x - Art.project(0, 0, 0).x;
    if (!tilePx || tilePx <= 0) return;
    var lw = Math.max(2, 0.25 * tilePx);

    for (var i = 0; i < marches.length; i++) {
      var m = marches[i];
      if (m.phase === "done" || m.phase === "broken") continue;
      ctx.save();

      if (m.phase === "announced" || m.phase === "forming") {
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = "#ff9f1c";
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (var j = 0; j < m.route.length; j++) {
          var p = Art.project(m.route[j].x + 0.5, m.route[j].y + 0.5, 0);
          if (j === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // Arrowheads
        for (var a = 2; a < m.route.length; a += 3) {
          var pa = Art.project(m.route[a - 1].x + 0.5, m.route[a - 1].y + 0.5, 0);
          var pb = Art.project(m.route[a].x + 0.5, m.route[a].y + 0.5, 0);
          var ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
          ctx.fillStyle = "#ff9f1c";
          ctx.beginPath();
          ctx.moveTo(pb.x, pb.y);
          ctx.lineTo(pb.x - Math.cos(ang - 0.5) * tilePx * 0.4, pb.y - Math.sin(ang - 0.5) * tilePx * 0.4);
          ctx.lineTo(pb.x - Math.cos(ang + 0.5) * tilePx * 0.4, pb.y - Math.sin(ang + 0.5) * tilePx * 0.4);
          ctx.closePath();
          ctx.fill();
        }
        // Flag at start
        var sp = Art.project(m.start.x + 0.5, m.start.y + 0.5, 0);
        ctx.fillStyle = "#ff9f1c";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, tilePx * 0.35, 0, Math.PI * 2);
        ctx.fill();
        var label = m.phase === "forming" ? "FORMING" : "MARCH in " + formatTime(m.t);
        ctx.font = "bold " + Math.max(10, tilePx * 0.42) + "px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        var tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(255,159,28,0.85)";
        ctx.fillRect(sp.x - 4, sp.y - tilePx * 0.7 - 2, tw + 12, tilePx * 0.5 + 4);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, sp.x + 2, sp.y - tilePx * 0.45);
        // End ring
        var ep = Art.project(m.end.x + 0.5, m.end.y + 0.5, 0);
        ctx.strokeStyle = "#ff9f1c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, tilePx * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold " + Math.max(9, tilePx * 0.35) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ff9f1c";
        ctx.fillText(m.end.name, ep.x, ep.y - tilePx * 0.8);
      } else if (m.phase === "marching" || m.phase === "stuck" || m.phase === "arrived") {
        // Remaining route
        ctx.strokeStyle = "rgba(255,159,28,0.6)";
        ctx.lineWidth = lw;
        ctx.beginPath();
        var startJ = Math.min(m.wi, m.route.length - 1);
        for (var k = startJ; k < m.route.length; k++) {
          var q = Art.project(m.route[k].x + 0.5, m.route[k].y + 0.5, 0);
          if (k === startJ) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        // Passed part faded
        if (startJ > 0) {
          ctx.strokeStyle = "rgba(255,159,28,0.2)";
          ctx.beginPath();
          for (var k2 = 0; k2 <= startJ; k2++) {
            var q2 = Art.project(m.route[k2].x + 0.5, m.route[k2].y + 0.5, 0);
            if (k2 === 0) ctx.moveTo(q2.x, q2.y);
            else ctx.lineTo(q2.x, q2.y);
          }
          ctx.stroke();
        }
        var memCount = getMembers(G, m).length;
        var c = m.centre || { x: m.start.x, y: m.start.y };
        var cp = Art.project(c.x + 0.5, c.y + 0.5, 0);
        var lbl = m.phase === "stuck" ? "MARCH BLOCKED" : "MARCH -> " + m.end.name + " (" + memCount + ")";
        var fontSz = Math.max(11, tilePx * 0.45);
        ctx.font = "bold " + fontSz + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        var w = ctx.measureText(lbl).width;
        var bx = cp.x - w / 2 - 6;
        var by = cp.y - tilePx * 1.2 - fontSz - 4;
        ctx.fillStyle = m.phase === "stuck" ? "rgba(200,30,30,0.9)" : "rgba(255,159,28,0.9)";
        roundRect(ctx, bx, by, w + 12, fontSz + 8, 4);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(lbl, cp.x, by + (fontSz + 8) / 2);
        if (m.phase === "stuck") {
          var pulse = 0.5 + 0.5 * Math.sin(G.time * 6);
          ctx.strokeStyle = "rgba(255,40,40," + (0.4 + 0.5 * pulse) + ")";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, tilePx * (1.5 + pulse * 0.5), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.setLineDash([]);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function formatTime(s) {
    s = Math.max(0, Math.floor(s));
    var mm = Math.floor(s / 60);
    var ss = s % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }

  return { init: init, update: update, draw: draw, list: list };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MARCHES;
