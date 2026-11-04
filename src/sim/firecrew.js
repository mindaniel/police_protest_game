var FIRECREW = (function () {
  var REISSUE = 10, RANGE = 200, SPRAY = 3, DPS = 0.25, TRUCK = 5, TRUCK_DPS = 0.1667, BOARD_T = 6;
  var target = {}, arrived = {}, sprayed = {};

  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

  function activeFire(G) {
    return (typeof FX !== "undefined" && FX.listFires) ? FX.listFires(G) : [];
  }

  function findVehicle(G, s) {
    var i, v;
    if (!G.vehicles) return null;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (v.squad === s && v.type === "fireengine") return v;
    }
    return null;
  }

  function findCrew(G, s) {
    var out = [], i, o;
    if (!G.officers) return out;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      if (o.squad === s) out.push(o);
    }
    return out;
  }

  function isFireSquad(G, s) {
    if (typeof Police === "undefined" || !Police.getLoadout) return false;
    return Police.getLoadout(G, s) === "fireengine";
  }

  function hasOrder(G, s) {
    return !!(G.orders && G.orders[s] !== undefined && G.orders[s] !== null);
  }

  function orderTime(G, s) {
    var o = G.orders ? G.orders[s] : null;
    if (o === undefined || o === null) return -Infinity;
    return (typeof o === "object" && o.t !== undefined) ? o.t : -Infinity;
  }

  function manualOrder(G, s) {
    var o = G.orders ? G.orders[s] : null;
    if (o === undefined || o === null) return false;
    var kind = (typeof o === "string") ? o : (o.order || o.type);
    if (kind === "hold" || kind === "patrol") return false;
    return true;
  }

  function freshManual(G, s) {
    if (!manualOrder(G, s)) return false;
    var t = orderTime(G, s);
    if (t === -Infinity) return false;
    return (G.time - t) < REISSUE;
  }

  function nearest(G, x, y, fires) {
    var best = null, bd = Infinity, i, d;
    for (i = 0; i < fires.length; i++) {
      d = dist2(x, y, fires[i].x, fires[i].y);
      if (d < bd) { bd = d; best = fires[i]; }
    }
    return best;
  }

  function issueMove(G, s, x, y) {
    if (typeof Police !== "undefined" && Police.moveSquad) {
      Police.moveSquad(G, s, x, y, true);
    }
  }

  function setTarget(G, s, fire, cx, cy) {
    var key = fire.tx + "," + fire.ty;
    if (target[s] === key) return;
    if (dist2(cx, cy, fire.x, fire.y) > RANGE * RANGE) return;
    target[s] = key;
    issueMove(G, s, fire.x, fire.y);
  }

  function clearTarget(s) { target[s] = null; }

  function suppressWatertrucks(G, dt, fires) {
    var i, j, v, f;
    if (!G.vehicles || !fires.length) return;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (v.type !== "watertruck") continue;
      for (j = fires.length - 1; j >= 0; j--) {
        f = fires[j];
        if (dist2(v.x, v.y, f.x, f.y) <= TRUCK * TRUCK) {
          if (FX.extinguish) FX.extinguish(G, f, TRUCK_DPS * dt);
        }
      }
    }
  }

  function markNoArrest(crew) {
    var j;
    for (j = 0; j < crew.length; j++) crew[j].noArrest = true;
  }

  function planMovement(G, s, crew, v, fires) {
    var cx = crew[0].x, cy = crew[0].y;
    if (freshManual(G, s)) { clearTarget(s); return; }
    if (!fires.length) { clearTarget(s); return; }
    var nf = nearest(G, cx, cy, fires);
    if (!nf) return;
    var key = nf.tx + "," + nf.ty;
    if (target[s] !== key) setTarget(G, s, nf, cx, cy);
    else if (dist2(cx, cy, nf.x, nf.y) > SPRAY * SPRAY) issueMove(G, s, nf.x, nf.y);
  }

  function sprayFires(G, dt, s, crew, fires) {
    var j, f, cx = crew[0].x, cy = crew[0].y;
    for (j = fires.length - 1; j >= 0; j--) {
      f = fires[j];
      if (dist2(cx, cy, f.x, f.y) > SPRAY * SPRAY) continue;
      var near = 0, k;
      for (k = 0; k < crew.length; k++) {
        if (dist2(crew[k].x, crew[k].y, f.x, f.y) <= SPRAY * SPRAY) near++;
      }
      if (!near) continue;
      if (FX.extinguish) FX.extinguish(G, f, DPS * dt * near);
      var fk = s + ":" + f.tx + "," + f.ty;
      if (!arrived[fk] && G.log) { arrived[fk] = true; G.log("Fire crew arrived at the fire"); }
      calmCrowd(G, dt, f);
      if (G.fxSpray === undefined) G.fxSpray = {};
      G.fxSpray[fk] = { tx: f.tx, ty: f.ty, s: s, crew: crew.slice(0) };
    }
  }

  function calmCrowd(G, dt, f) {
    if (typeof Crowd === "undefined" || !Crowd.neighbors) return;
    var ppl = Crowd.neighbors(G, f.x, f.y, 4.1), p, o;
    for (p = 0; p < ppl.length; p++) {
      o = ppl[p];
      if (!o.active) continue;
      if (o.mood !== undefined) o.mood = Math.min(100, Math.max(0, o.mood - 2 * dt));
      if (o.anger !== undefined) o.anger = Math.max(0, o.anger - 2 * dt);
    }
  }

  function cleanupSpray(G, fires) {
    if (!G.fxSpray) return;
    var live = {}, i, keys, k, sp;
    for (i = 0; i < fires.length; i++) live[fires[i].tx + "," + fires[i].ty] = true;
    keys = Object.keys(G.fxSpray);
    for (i = 0; i < keys.length; i++) {
      sp = G.fxSpray[keys[i]];
      if (!live[sp.tx + "," + sp.ty]) delete G.fxSpray[keys[i]];
    }
  }

  function logOut(G, fires) {
    if (!G.log || fires.length !== 0) return;
    var ak = Object.keys(arrived), i;
    for (i = 0; i < ak.length; i++) {
      if (!sprayed[ak[i]]) { sprayed[ak[i]] = true; G.log("Fire is out"); }
    }
  }

  function update(G, dt) {
    if (dt > 0.05) dt = 0.05;
    var fires = activeFire(G), i, s, crew, v, squads;
    suppressWatertrucks(G, dt, fires);
    squads = [];   /* squad indices that have officers */
    for (i = 0; i < G.officers.length; i++) if (squads.indexOf(G.officers[i].squad) < 0) squads.push(G.officers[i].squad);
    for (i = 0; i < squads.length; i++) {
      s = squads[i];
      if (!isFireSquad(G, s)) continue;
      crew = findCrew(G, s);
      if (!crew.length) continue;
      markNoArrest(crew);
      v = findVehicle(G, s);
      planMovement(G, s, crew, v, fires);
      if (fires.length) sprayFires(G, dt, s, crew, fires);
    }
    cleanupSpray(G, fires);
    logOut(G, fires);
  }

  function P(x, y, z) {
    if (typeof Art !== "undefined" && Art.project) return Art.project(x, y, z);
    return { x: x * 20, y: y * 20 - z * 20 };
  }
  function S() { return (typeof Art !== "undefined" && Art.camera) ? Art.camera.S : 10; }

  function drawArc(ctx, s, from, fire, col) {
    if (!from || !fire) return;
    var a = P(from.x, from.y, 0.4), b = P(fire.x, fire.y, 0.2), j;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.5 * s); ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 6 * s, b.x, b.y); ctx.stroke();
    ctx.globalAlpha = 1;
    var dx = b.x - a.x, dy = b.y - a.y;
    for (j = 1; j <= 4; j++) {
      var t = j / 5, px = a.x + dx * t, py = a.y + dy * t - Math.sin(t * Math.PI) * 6 * s;
      ctx.fillStyle = "#d8ecff"; ctx.beginPath();
      ctx.arc(px, py, Math.max(0.6, 0.35 * s), 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw(ctx, G) {
    var fires = activeFire(G);
    if (!fires.length) return;
    var s = S(), fireMap = {}, i, j, v, f, sp, keys;
    for (i = 0; i < fires.length; i++) fireMap[fires[i].tx + "," + fires[i].ty] = fires[i];
    if (G.vehicles) {
      for (i = 0; i < G.vehicles.length; i++) {
        v = G.vehicles[i];
        if (v.type !== "watertruck") continue;
        for (j = 0; j < fires.length; j++) {
          f = fires[j];
          if (dist2(v.x, v.y, f.x, f.y) <= TRUCK * TRUCK) drawArc(ctx, s, v, f, "#b0d8ff");
        }
      }
    }
    if (G.fxSpray) {
      keys = Object.keys(G.fxSpray);
      for (i = 0; i < keys.length; i++) {
        sp = G.fxSpray[keys[i]];
        f = fireMap[sp.tx + "," + sp.ty];
        if (!f) continue;
        for (j = 0; j < sp.crew.length; j++) {
          if (dist2(sp.crew[j].x, sp.crew[j].y, f.x, f.y) <= SPRAY * SPRAY) {
            drawArc(ctx, s, sp.crew[j], f, "#cfe8ff");
          }
        }
      }
    }
  }

  return { update: update, draw: draw };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FIRECREW;
