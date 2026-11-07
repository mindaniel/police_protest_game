/* dispatch.js (DeepSeek) */
/* dispatch.js (DeepSeek) - advisory version */
(function () {
  var calls = [];
  var byId = {};
  var lastTick = -1;
  var panelBlink = {};
  var MAXQ = 5;

  function reset() {
    calls = []; byId = {}; lastTick = -1; panelBlink = {};
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
    /* the player approves every send, so squads holding a spot are suggested too;
       only a squad on a police line or kettle is left alone */
    return o.order === "line" || o.order === "kettle" || !!o.holdLine;
  }
  function squadPos(s) {
    var g = G(), n = 0, x = 0, y = 0, i;
    var offs = g.officers || [];
    for (i = 0; i < offs.length; i++) if (offs[i].squad === s) { x += offs[i].x; y += offs[i].y; n++; }
    if (n) return { x: x / n, y: y / n };
    var vs = g.vehicles || [];
    for (i = 0; i < vs.length; i++) if (vs[i].squad === s) return { x: vs[i].x, y: vs[i].y };
    return null;
  }
  function loadout(s) {
    if (Police.getLoadout) return Police.getLoadout(G(), s);
    return "none";
  }
  function arresting(type) { return UNITTYPES.canArrest(type); }
  function fits(kind, type, call) {
    if (kind === "fire") return type === "fireengine" || type === "watertruck";
    if (kind === "medical") return type === "ambulance";
    if (kind === "owner_hurt") return type === "ambulance" || arresting(type);
    if (kind === "violence") {
      if (call && call.hurt) return type === "ambulance" || arresting(type);
      return arresting(type);
    }
    if (kind === "shop_attack" || kind === "shop_looted" || kind === "owner_call" || kind === "crime") return arresting(type);
    if (kind === "barricade") return type === "barriertruck" || type === "truck";
    if (kind === "angry") return type === "van" || type === "car";
    return false;
  }
  function isMed(type) { return type === "ambulance"; }
  function needCount(call) {
    var k = call.kind;
    if ((k === "violence" || k === "shop_looted") && (call.crowd || call.big)) return 2;
    if (k === "owner_hurt") return 2;
    return 1;
  }
  function freeSquads() {
    var g = G(), n = CONFIG.squadCount, out = [];
    for (var s = 0; s < n; s++) {
      if (isBusy(s)) continue;
      if (g.dispatch && g.dispatch[s]) continue;
      out.push(s);
    }
    return out;
  }
  function onCall(s) { var g = G(); return !!(g.dispatch && g.dispatch[s]); }
  function makeCall(a) {
    return { id: a.id, kind: a.kind, label: a.label, x: a.x, y: a.y, at: now(), units: [],
      hurt: a.kind === "owner_hurt", crowd: false, big: false, suggest: -1, suggestAge: -1 };
  }
  function findCall(id) {
    for (var i = 0; i < calls.length; i++) if (calls[i].id === id) return calls[i];
    return null;
  }
  function dropCall(call) {
    var g = G();
    var idx = calls.indexOf(call);
    if (idx >= 0) calls.splice(idx, 1);
    if (byId[call.id]) delete byId[call.id];
    if (call.ids) for (var di = 0; di < call.ids.length; di++) delete byId[call.ids[di]];
    delete panelBlink[call.id];
    for (var i = 0; i < call.units.length; i++) {
      var s = call.units[i];
      if (g.dispatch) delete g.dispatch[s];
      var ret = g.dispatchReturn && g.dispatchReturn[s];
      if (ret && Police.moveSquad) { try { Police.moveSquad(g, s, ret.x, ret.y, true); } catch (e) {} }
      if (g.dispatchReturn) delete g.dispatchReturn[s];
    }
    call.units = [];
    if (call.units.length === 0 && call.firstUnitAt == null) DISPATCH.stats.missed++;
  }
  function containsMarchOrCrowd(area) {
    if (!area) return false;
    var g = G();
    var n = Crowd.neighbors(G(), { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 }, 8);
    return n.length >= 30;
  }
  function sendSquad(s, call) {
    var g = G();
    var prev = g.orders && g.orders[s];
    if (prev) g.dispatchReturn[s] = { x: prev.targetX, y: prev.targetY };
    g.dispatch[s] = call.id;
    call.units.push(s);
    if (call.firstUnitAt == null) {
      var p = squadPos(s);
      if (p) {
        var dx = p.x - call.x, dy = p.y - call.y;
        if (dx * dx + dy * dy <= 9) call.firstUnitAt = now();
      }
    }
    var area = g.orders && g.orders[s] && g.orders[s].area;
    if (area && containsMarchOrCrowd(area)) DISPATCH.stats.pulled++;
    var tag = UNITTYPES.tag ? UNITTYPES.tag(g, s) : ("SQUAD " + s);
    if (UI && UI.say) UI.say("Radio: " + tag + " en route to " + call.label);
    var sent = false;
    if (TRANSPORT && TRANSPORT.travel) { try { sent = TRANSPORT.travel(g, s, call.x, call.y); } catch (e) {} }
    if (!sent && Police.moveSquad) { try { Police.moveSquad(g, s, call.x, call.y, true); } catch (e) {} }
    if (call.firstUnitAt == null) call.firstUnitAt = now();
  }
  function recomputeSuggestions() {
    var g = G();
    var free = freeSquads();
    for (var k = 0; k < calls.length; k++) {
      var c = calls[k];
      c.suggest = -1;
      if (c.units.length >= needCount(c)) continue;
      var best = -1, bestD = Infinity;
      for (var fi = 0; fi < free.length; fi++) {
        var fs = free[fi];
        if (onCall(fs)) continue;
        var lt = loadout(fs);
        if (!fits(c.kind, lt, c)) continue;
        if (c.kind === "owner_hurt" && c.units.length === 1 && c.units[0] != null) {
          if (isMed(loadout(c.units[0])) && isMed(lt)) continue;
        }
        var pos = squadPos(fs);
        if (!pos) continue;
        var dd = (pos.x - c.x) * (pos.x - c.x) + (pos.y - c.y) * (pos.y - c.y);
        /* small crime: fast light units first, crowd-control trucks only when nothing else is near */
        if (c.kind === "crime" && (lt === "watertruck" || lt === "barriertruck" || lt === "truck")) dd = dd * 9 + 400;
        else if (c.kind === "crime" && (lt === "car" || lt === "motorbike")) dd *= 0.6;
        if (dd < bestD) { bestD = dd; best = fs; }
      }
      c.suggest = best;
    }
  }
  function tick() {
    var g = G();
    if (!g) return;
    var t = now();
    if (!g.dispatch) g.dispatch = {};
    if (!g.dispatchReturn) g.dispatchReturn = {};
    if (!DISPATCH.stats) DISPATCH.stats = { calls: 0, handled: 0, missed: 0, responseSum: 0, responseN: 0, pulled: 0 };

    var list = ALERTS.list();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.kind === "squad" || a.kind === "crowd") continue;
      if (!byId[a.id]) {
        /* protest trouble (shops, violence, owners) close to an open call joins it: one call per area */
        if (a.kind !== "crime" && a.kind !== "fire") {
          var host = null;
          for (var h = 0; h < calls.length && !host; h++) {
            var hc = calls[h];
            if (hc.kind === "crime" || hc.kind === "fire") continue;
            if ((hc.x - a.x) * (hc.x - a.x) + (hc.y - a.y) * (hc.y - a.y) < 144) host = hc;
          }
          if (host) {
            byId[a.id] = host;
            host.extra = (host.extra || 0) + 1;
            if (a.kind === "violence" || a.kind === "owner_hurt") { host.kind = a.kind; host.hurt = host.hurt || a.kind === "owner_hurt"; }
            host.ids = host.ids || [host.id];
            host.ids.push(a.id);
            continue;
          }
        }
        var c = makeCall(a);
        calls.push(c);
        byId[a.id] = c;
        panelBlink[a.id] = t;
        DISPATCH.stats.calls++;
      }
    }
    for (var j = calls.length - 1; j >= 0; j--) {
      var call = calls[j];
      var al = alertExists(call.id);
      if (call.ids) for (var q = 0; q < call.ids.length; q++) {
        var al2 = alertExists(call.ids[q]);
        if (al2 && (!al || (al2.last || 0) > (al.last || 0))) al = al2;
      }
      if (!al) { dropCall(call); continue; }
      if (al.last != null && t - al.last > 60) { dropCall(call); continue; }
      if (t - call.at > 60 && call.units.length === 0) { dropCall(call); continue; }
      if (call.units.length > 0) {
        var allClose = true;
        for (var u = 0; u < call.units.length; u++) {
          var sp = squadPos(call.units[u]);
          if (!sp) { allClose = false; break; }
          var dx = sp.x - call.x, dy = sp.y - call.y;
          if (dx * dx + dy * dy > 9) { allClose = false; break; }
        }
        if (allClose) {
          if (!call._standAt) call._standAt = t;
          if (t - call._standAt >= 15) {
            if (call.units.length > 0) DISPATCH.stats.handled++;
            dropCall(call);
            continue;
          }
        } else { call._standAt = 0; }
        if (call.firstUnitAt != null && !call._counted) {
          call._counted = true;
          DISPATCH.stats.responseSum += (call.firstUnitAt - call.at);
          DISPATCH.stats.responseN++;
        }
      }
    }
    if (!DISPATCH.enabled) return;
    streetPickup();
    recomputeSuggestions();
    if (DISPATCH.autoMinor) {
      for (var k = 0; k < calls.length; k++) {
        var cc = calls[k];
        if (cc.kind !== "crime" && cc.kind !== "owner_call") continue;
        if (cc.units.length >= needCount(cc)) continue;
        if (cc.suggest >= 0) sendSquad(cc.suggest, cc);
      }
    }
  }
  /* a free squad on patrol (or standing idle) that meets a street call takes it itself */
  function streetPickup() {
    var g = G(), offs = g.officers || [], vs = g.vehicles || [], k, i, s, o;
    for (k = 0; k < calls.length; k++) {
      var c = calls[k];
      if (c.kind !== "crime" && c.kind !== "medical" && c.kind !== "fire") continue;
      if (c.units.length >= needCount(c)) continue;
      var pts = [{ x: c.x, y: c.y }];
      if (c.kind === "crime" && typeof CRIME !== "undefined" && CRIME.list) {   /* or runs into the suspect */
        var L = CRIME.list();
        for (i = 0; i < L.length; i++) {
          if ((L[i].x - c.x) * (L[i].x - c.x) + (L[i].y - c.y) * (L[i].y - c.y) > 4) continue;
          for (var j = 0; j < L[i].culprits.length; j++) if (!L[i].culprits[j].caught) pts.push(L[i].culprits[j]);
        }
      }
      var found = -1;
      for (i = 0; i < offs.length + vs.length && found < 0; i++) {
        o = i < offs.length ? offs[i] : vs[i - offs.length];
        s = o.squad;
        if (s == null || onCall(s) || isBusy(s)) continue;
        var ord = g.orders && g.orders[s];
        if (ord && ord.order && ord.order !== "patrol") continue;   /* only patrols and idle squads */
        if (!fits(c.kind, loadout(s), c)) continue;
        for (var p = 0; p < pts.length; p++) {
          var dx = o.x - pts[p].x, dy = o.y - pts[p].y;
          if (dx * dx + dy * dy <= 25) { found = s; break; }
        }
      }
      if (found < 0) continue;
      sendSquad(found, c);
      var tag = UNITTYPES.tag ? UNITTYPES.tag(g, found) : ("SQUAD " + found);
      if (UI && UI.say) UI.say("Radio: " + tag + " on patrol spotted it - taking " + c.label);
    }
  }
  function fmtAge(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
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
          ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = "#ff3333";
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        continue;
      }
      ctx.save();
      ctx.strokeStyle = "rgba(0,120,255,0.55)"; ctx.lineWidth = 1;
      if (ctx.setLineDash) ctx.setLineDash([3, 4]);
      for (var u = 0; u < c.units.length; u++) {
        var sp = squadPos(c.units[u]);
        if (!sp) continue;
        var sp2 = Art.project(sp.x, sp.y, 0);
        if (!sp2) continue;
        ctx.beginPath(); ctx.moveTo(sp2.x, sp2.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#ff5555"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    /* the call list itself is drawn by ALERTS (one list for alerts and calls) */
  }
  function drawPanel(ctx, g, t) {
    var W = ctx.canvas.width;
    var w = 340, x = W - w - 10, y = 40;
    var rowH = 20;
    var pending = calls.slice(0, MAXQ);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(10,14,22,0.82)";
    ctx.fillRect(x, y, w, 22 + rowH * Math.max(1, pending.length) + 22);
    ctx.strokeStyle = "rgba(90,160,220,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 22 + rowH * Math.max(1, pending.length) + 22 - 1);
    ctx.fillStyle = "#9fd0ff";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("RADIO", x + 8, y + 11);
    for (var i = 0; i < pending.length; i++) {
      var c = pending[i];
      var ry = y + 22 + i * rowH;
      if (i === 0) {
        ctx.fillStyle = "rgba(60,110,180,0.5)";
        ctx.fillRect(x + 4, ry, w - 8, rowH);
      }
      var blink = panelBlink[c.id] != null && (t - panelBlink[c.id]) < 2;
      if (blink && Math.floor(t * 3) % 2 === 0) {
        ctx.fillStyle = "rgba(255,220,80,0.25)";
        ctx.fillRect(x + 4, ry, w - 8, rowH);
      }
      ctx.fillStyle = blink ? "#ffe680" : "#e8f2ff";
      var sugStr = "no unit";
      var sugCol = "#888";
      if (c.suggest >= 0) {
        sugStr = "> " + (UNITTYPES.tag ? UNITTYPES.tag(g, c.suggest) : ("S" + c.suggest)) + (i === 0 ? " [Enter]" : "");
        sugCol = "#8fff9f";
      }
      /* short place name: the label text after "Kind: " or "Kind - ", cut to fit before the unit */
      var lbl = String(c.label || c.kind).replace(/\s*\(\d+\)$/, "");
      var cut = lbl.search(/: | - /);
      var kindStr = c.kind === "crime" && cut > 0 ? lbl.slice(0, cut).toLowerCase() : c.kind.replace(/_/g, " ");
      var place = cut >= 0 ? lbl.slice(cut + 2) : "";
      if (c.extra) kindStr = "trouble x" + (c.extra + 1);
      var line = fmtAge(t - c.at) + " " + kindStr + (place ? ", " + place : "");
      var room = w - 16 - ctx.measureText(sugStr).width - 10;
      if (ctx.measureText(line).width > room) {
        while (line.length > 4 && ctx.measureText(line + "..").width > room) line = line.slice(0, -1);
        line += "..";
      }
      ctx.fillText(line, x + 8, ry + rowH / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = sugCol;
      ctx.fillText(sugStr, x + w - 8, ry + rowH / 2);
      ctx.textAlign = "left";
    }
    var fy = y + 22 + Math.max(1, pending.length) * rowH + 4;
    ctx.fillStyle = "#7799bb";
    ctx.fillText("Enter send  Bksp skip  click row: send selected", x + 8, fy + 6);
    ctx.restore();
  }
  function list() { return calls.slice(); }
  /* alert-list helpers: one card per call */
  function callFor(alertId) { return byId[alertId] || null; }
  function sendTo(g, alertId, s) {
    var c = byId[alertId];
    if (!c) return "none";
    if (s == null || s < 0) s = c.suggest;
    if (s == null || s < 0) return "nounit";
    if (!fits(c.kind, loadout(s), c)) return "wrong";
    if (onCall(s)) return "busy";
    sendSquad(s, c);
    return "ok";
  }
  function dismiss(alertId) { var c = byId[alertId]; if (c) dropCall(c); }
  function approve(G) {
    var pending = calls.slice(0, MAXQ);
    if (!pending.length) return false;
    var c = pending[0];
    if (c.suggest < 0) { if (UI && UI.say) UI.say("Radio: no unit available"); return false; }
    sendSquad(c.suggest, c);
    return true;
  }
  function skip(G) {
    var pending = calls.slice(0, MAXQ);
    if (pending.length < 2) return false;
    var c = pending[0];
    var idx = calls.indexOf(c);
    if (idx >= 0) { calls.splice(idx, 1); calls.push(c); }
    return true;
  }
  function assign(G, s) {
    var pending = calls.slice(0, MAXQ);
    if (!pending.length) return false;
    if (s < 0 || s >= CONFIG.squadCount) return false;
    if (onCall(s)) return false;
    var c = pending[0];
    if (!fits(c.kind, loadout(s), c)) { if (UI && UI.say) UI.say("Radio: wrong unit type"); return false; }
    sendSquad(s, c);
    return true;
  }
  function click() { return false; }

  function score() {
    var s = DISPATCH.stats || { handled: 0, missed: 0, responseSum: 0, responseN: 0, pulled: 0 };
    return {
      handled: s.handled,
      missed: s.missed,
      avgResponse: s.responseN > 0 ? (s.responseSum / s.responseN) : 0,
      pulled: s.pulled
    };
  }
  window.DISPATCH = {
    enabled: true,
    autoMinor: false,
    stats: { calls: 0, handled: 0, missed: 0, responseSum: 0, responseN: 0, pulled: 0 },
    toggle: function () { this.enabled = !this.enabled; return this.enabled; },
    reset: reset,
    list: list,
    draw: draw,
    update: function () { if (window.DISPATCH.enabled) window.DISPATCH.tick(); },
    tick: function () {
      var t = now();
      if (Math.floor(t) !== Math.floor(lastTick)) { lastTick = t; tick(); }
    },
    approve: approve,
    skip: skip,
    assign: assign,
    click: click,
    callFor: callFor,
    sendTo: sendTo,
    dismiss: dismiss,
    score: score
  };
})();
