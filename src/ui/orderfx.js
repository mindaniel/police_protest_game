var ORDERFX = (function () {
  var inited = false, entries = {}, origMove = null, origDrive = null, now = 0;
  var PALETTE = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

  function squadColor(G, s) {
    try {
      if (typeof Art !== "undefined" && Art && typeof Art.squadColor === "function") {
        var c = Art.squadColor(s);
        if (c) return c;
      }
      if (G && typeof G.squadColor === "function") {
        var c2 = G.squadColor(s);
        if (c2) return c2;
      }
      if (s && s.color) return s.color;
      if (s && typeof s.idx === "number") return PALETTE[s.idx % PALETTE.length];
    } catch (e) {}
    return PALETTE[0];
  }

  function squadId(G, s) {
    if (!s) return "?";
    if (typeof s.num === "number") return s.num;
    if (typeof s.number === "number") return s.number;
    if (typeof s.id === "number") return s.id;
    if (typeof s.idx === "number") return s.idx + 1;
    if (Array.isArray(G && G.squads)) {
      var i = G.squads.indexOf(s);
      if (i >= 0) return i + 1;
    }
    return "?";
  }

  function centreOf(s) {
    var ox = 0, oy = 0, n = 0, vx = 0, vy = 0, vn = 0;
    var list = s && (s.officers || s.units || s.members);
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o) continue;
        ox += (typeof o.x === "number" ? o.x : 0);
        oy += (typeof o.y === "number" ? o.y : 0);
        n++;
      }
    }
    var v = s && (s.vehicle || s.car);
    if (v && typeof v.x === "number") { vx = v.x; vy = v.y; vn = 1; }
    if (!n && !vn) {
      if (s && typeof s.x === "number") return { x: s.x, y: s.y };
      return { x: 0, y: 0 };
    }
    var tx = ox + vx, ty = oy + vy, tn = n + vn;
    return { x: tx / tn, y: ty / tn };
  }

  function project(x, y) {
    try {
      if (typeof Art !== "undefined" && Art && typeof Art.project === "function") {
        var p = Art.project(x, y, 0);
        if (p && typeof p.x === "number") return p;
      }
    } catch (e) {}
    return { x: x, y: y };
  }

  function note(G, s, x, y, kind) {
    if (!s) return;
    var key = s.__orderfxKey;
    if (!key) {
      key = "s" + (++ORDERFX._n || (ORDERFX._n = 1));
      try { s.__orderfxKey = key; } catch (e) { key = "s" + Math.random(); }
    }
    entries[key] = {
      squad: s,
      tx: x, ty: y,
      t0: now,
      kind: kind || "walk",
      arrivedAt: -1
    };
  }

  function init() {
    if (inited) return;
    inited = true;
    ORDERFX._n = ORDERFX._n || 0;
    try {
      if (typeof Police !== "undefined" && Police && typeof Police.moveSquad === "function") {
        origMove = Police.moveSquad;
        Police.moveSquad = function (G, s, x, y, run) {
          note(G, s, x, y, "walk");
          return origMove.apply(this, arguments);
        };
      }
    } catch (e) {}
    try {
      if (typeof TRANSPORT !== "undefined" && TRANSPORT && typeof TRANSPORT.drive === "function") {
        origDrive = TRANSPORT.drive;
        TRANSPORT.drive = function (G, s, x, y) {
          note(G, s, x, y, "drive");
          return origDrive.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  function update(G, dt) {
    if (typeof dt !== "number" || dt < 0) dt = 0;
    now += dt;
    for (var k in entries) {
      if (!entries.hasOwnProperty(k)) continue;
      var e = entries[k];
      if (!e.squad) { delete entries[k]; continue; }
      if (e.arrivedAt < 0) {
        var c = centreOf(e.squad);
        var dx = c.x - e.tx, dy = c.y - e.ty;
        if ((dx * dx + dy * dy) <= 4) e.arrivedAt = now;
        else if (now - e.t0 > 60) e.arrivedAt = now;
      } else if (now - e.arrivedAt > 1) {
        delete entries[k];
      }
    }
  }

  function draw(ctx, G) {
    if (!ctx) return;
    var sel = null;
    try { if (typeof UI !== "undefined" && UI) sel = UI.selected; } catch (e) {}
    var t = now;
    ctx.save();
    for (var k in entries) {
      if (!entries.hasOwnProperty(k)) continue;
      var e = entries[k];
      if (!e || !e.squad) continue;
      var col = squadColor(G, e.squad);
      var tp = project(e.tx, e.ty);
      var c = centreOf(e.squad);
      var sp = project(c.x, c.y);
      var isSel = (sel === e.squad || (sel && sel.squad === e.squad));
      var age = t - e.t0;

      if (e.arrivedAt < 0) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 5);
        ctx.globalAlpha = 0.55 + 0.35 * pulse;
        ctx.strokeStyle = col;
        ctx.lineWidth = isSel ? 3 : 2;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 10 + 6 * pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = isSel ? 0.8 : 0.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (age < 0.6) {
          var rp = age / 0.6;
          ctx.globalAlpha = 1 - rp;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 6 + 28 * rp, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.globalAlpha = 0.95;
        ctx.fillStyle = col;
        ctx.fillRect(tp.x + 2, tp.y - 18, 2, 18);
        ctx.fillRect(tp.x + 4, tp.y - 18, 12, 9);
        ctx.fillStyle = "#fff";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(squadId(G, e.squad)), tp.x + 10, tp.y - 13);
      } else {
        var f = 1 - (t - e.arrivedAt);
        if (f < 0) f = 0;
        ctx.globalAlpha = f;
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tp.x - 6, tp.y);
        ctx.lineTo(tp.x - 1, tp.y + 5);
        ctx.lineTo(tp.x + 7, tp.y - 6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  return { init: init, update: update, draw: draw, note: note };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ORDERFX;
