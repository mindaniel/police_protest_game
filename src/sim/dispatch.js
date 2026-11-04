/* dispatch.js (DeepSeek) */
(function () {
  var calls = [];
  var byId = {};
  var lastTick = -1;

  function reset() {
    calls = [];
    byId = {};
    lastTick = -1;
  }

  function G() { return window.G; }

  function now() {
    var g = G();
    return g && typeof g.time === "number" ? g.time : 0;
  }

  function alertExists(id) {
    var a = ALERTS.list();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }

  function isBusy(s) {
    var g = G();
    var o = g.orders && g.orders[s];
    if (!o) return false;
    var ord = o.order;
    return ord !== "auto" && ord !== "patrol";
  }

  function squadPos(s) {
    var g = G();
    var n = 0, x = 0, y = 0, i;
    var offs = g.officers || [];
    for (i = 0; i < offs.length; i++) {
      if (offs[i].squad === s) { x += offs[i].x; y += offs[i].y; n++; }
    }
    if (n) return { x: x / n, y: y / n };
    var vs = g.vehicles || [];
    for (i = 0; i < vs.length; i++) {
      if (vs[i].squad === s) return { x: vs[i].x, y: vs[i].y };
    }
    return null;
  }

  function loadout(s) {
    if (Police.getLoadout) return Police.getLoadout(G(), s);
    return "none";
  }

  function arresting(type) {
    return UNITTYPES.canArrest(type);
  }

  function fits(kind, type, call) {
    if (kind === "fire") return type === "fireengine" || type === "watertruck";
    if (kind === "owner_hurt") return type === "ambulance" || arresting(type);
    if (kind === "violence") {
      if (call && call.hurt) return type === "ambulance" || arresting(type);
      return arresting(type);
    }
    if (kind === "shop_attack" || kind === "shop_looted" || kind === "owner_call") return arresting(type);
    if (kind === "barricade") return type === "barriertruck" || type === "truck";
    if (kind === "angry") return type === "van" || type === "car";
    return false;
  }

  function isFire(type) { return type === "fireengine" || type === "watertruck"; }
  function isMed(type) { return type === "ambulance"; }

  function needCount(call) {
    var k = call.kind;
    if (k === "violence" || k === "shop_looted") {
      if (call.crowd || call.big) return 2;
    }
    if (k === "owner_hurt") return 2;
    return 1;
  }

  function freeSquads() {
    var g = G();
    var n = CONFIG.squadCount;
    var out = [];
    for (var s = 0; s < n; s++) {
      if (isBusy(s)) continue;
      if (g.dispatch && g.dispatch[s]) continue;
      out.push(s);
    }
    return out;
  }

  function onCall(s) {
    var g = G();
    return !!(g.dispatch && g.dispatch[s]);
  }

  function assignedCount(call) {
    return call.units.length;
  }

  function makeCall(a) {
    return { id: a.id, kind: a.kind, label: a.label, x: a.x, y: a.y, at: now(), units: [], hurt: a.kind === "owner_hurt", crowd: false, big: false };
  }

  function findCall(id) {
    for (var i = 0; i < calls.length; i++) if (calls[i].id === id) return calls[i];
    return null;
  }

  function dropCall(call, reason) {
    var g = G();
    var idx = calls.indexOf(call);
    if (idx >= 0) calls.splice(idx, 1);
    if (byId[call.id]) delete byId[call.id];
    for (var i = 0; i < call.units.length; i++) {
      var s = call.units[i];
      if (g.dispatch) delete g.dispatch[s];
      var ret = g.dispatchReturn && g.dispatchReturn[s];
      if (ret && Police.moveSquad) {
        try { Police.moveSquad(g, s, ret.x, ret.y, true); } catch (e) {}
      }
      if (g.dispatchReturn) delete g.dispatchReturn[s];
    }
    call.units = [];
  }

  function tick() {
    var g = G();
    if (!g) return;
    var t = now();

    if (!g.dispatch) g.dispatch = {};
    if (!g.dispatchReturn) g.dispatchReturn = {};

    var list = ALERTS.list();
    var seen = {};

    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.kind === "squad" || a.kind === "crowd") continue;
      seen[a.id] = true;
      if (!byId[a.id]) {
        var c = makeCall(a);
        if (a.kind === "violence" && g.crowdNear) { try { if (g.crowdNear(a.x, a.y)) c.crowd = true; } catch (e) {} }
        calls.push(c);
        byId[a.id] = c;
      }
    }

    for (var j = calls.length - 1; j >= 0; j--) {
      var call = calls[j];
      var al = alertExists(call.id);
      if (!al) { dropCall(call, "gone"); continue; }
      if (al.last != null && t - al.last > 60) { dropCall(call, "old"); continue; }
      if (t - call.at > 60 && call.units.length === 0) { dropCall(call, "timeout"); continue; }

      if (call.units.length > 0) {
        var allClose = true;
        for (var u = 0; u < call.units.length; u++) {
          var s = call.units[u];
          var p = squadPos(s);
          if (!p) { allClose = false; break; }
          var dx = p.x - call.x, dy = p.y - call.y;
          if (dx * dx + dy * dy > 9) { allClose = false; break; }
        }
        if (allClose) {
          var standKey = "d_stand_" + call.id;
          if (!call._standAt) call._standAt = t;
          if (t - call._standAt >= 15) { dropCall(call, "handled"); continue; }
        } else {
          call._standAt = 0;
        }
      }
    }

    if (!DISPATCH.enabled) return;

    var free = freeSquads();
    var halfForce = Math.max(1, Math.floor(CONFIG.squadCount / 2));
    var busyCount = 0;
    for (var s = 0; s < CONFIG.squadCount; s++) if (onCall(s)) busyCount++;

    for (var k = 0; k < calls.length; k++) {
      var c = calls[k];
      var need = needCount(c);
      if (c.units.length >= need) continue;
      if (busyCount >= halfForce) break;

      var best = -1, bestD = Infinity;
      for (var fi = 0; fi < free.length; fi++) {
        var fs = free[fi];
        if (onCall(fs)) continue;
        var lt = loadout(fs);
        if (!fits(c.kind, lt, c)) continue;
        if (c.kind === "owner_hurt" && c.units.length === 0) {
        } else if (c.kind === "owner_hurt" && c.units.length === 1) {
          if (c.units[0] && isMed(loadout(c.units[0])) && isMed(lt)) continue;
        }
        var pos = squadPos(fs);
        if (!pos) continue;
        var dd = (pos.x - c.x) * (pos.x - c.x) + (pos.y - c.y) * (pos.y - c.y);
        if (dd < bestD) { bestD = dd; best = fs; }
      }
      if (best < 0) continue;

      var prev = g.orders && g.orders[best];
      if (prev) g.dispatchReturn[best] = { x: prev.targetX, y: prev.targetY };
      g.dispatch[best] = c.id;
      c.units.push(best);
      busyCount++;

      var tag = UNITTYPES.tag ? UNITTYPES.tag(g, best) : ("SQUAD " + best);
      var kindLabel = c.kind.replace(/_/g, " ");
      if (UI && UI.say) UI.say("Control: " + tag + " respond to " + kindLabel);

      var sent = false;
      if (TRANSPORT && TRANSPORT.travel) {
        try { sent = TRANSPORT.travel(g, best, c.x, c.y); } catch (e) { sent = false; }
      }
      if (!sent && Police.moveSquad) {
        try { Police.moveSquad(g, best, c.x, c.y, true); } catch (e) {}
      }

      var idx = free.indexOf(best);
      if (idx >= 0) free.splice(idx, 1);
    }
  }

  function draw(ctx, g) {
    if (!ctx || !g) return;
    var t = now();
    for (var i = 0; i < calls.length; i++) {
      var c = calls[i];
      var p = Art.project(c.x, c.y, 0);
      if (!p) continue;
      if (c.units.length === 0) {
        if (Math.floor(t * 2) % 2 === 0) {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#ff3333";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        continue;
      }
      ctx.save();
      ctx.strokeStyle = "rgba(0,120,255,0.55)";
      ctx.lineWidth = 1;
      if (ctx.setLineDash) ctx.setLineDash([3, 4]);
      for (var u = 0; u < c.units.length; u++) {
        var sp = squadPos(c.units[u]);
        if (!sp) continue;
        var sp2 = Art.project(sp.x, sp.y, 0);
        if (!sp2) continue;
        ctx.beginPath();
        ctx.moveTo(sp2.x, sp2.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#ff5555";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function list() {
    return calls.slice();
  }

  window.DISPATCH = {
    enabled: true,
    toggle: function () { this.enabled = !this.enabled; return this.enabled; },
    reset: reset,
    list: list,
    draw: draw,
    update: function () { if (window.DISPATCH.enabled) window.DISPATCH.tick(); },
    tick: function () {
      var t = now();
      if (Math.floor(t) !== Math.floor(lastTick)) {
        lastTick = t;
        tick();
      }
    }
  };
})();
