var ORDERFX = (function () {
  var inited = false, entries = {}, now = 0;
  var PALETTE = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

  /* squads are numbers (0-based); boarded officers leave G.officers, so fall back to the vehicle */
  function squadColor(G, s) {
    return PALETTE[(+s || 0) % PALETTE.length];
  }

  function squadId(G, s) { return (+s || 0) + 1; }

  function centreOf(G, s) {
    var x = 0, y = 0, n = 0, i, o, list = (G && G.officers) || [], vs = (G && G.vehicles) || [];
    for (i = 0; i < list.length; i++) {
      o = list[i];
      if (o && o.squad === s && !o.escorting) { x += o.x; y += o.y; n++; }
    }
    if (n) return { x: x / n, y: y / n };
    for (i = 0; i < vs.length; i++) if (vs[i] && vs[i].squad === s) return { x: vs[i].x, y: vs[i].y };
    return null;
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

  /* called only for player orders (uiSquadGo); one marker per squad */
  function note(G, s, x, y, kind) {
    if (typeof s !== "number") return;
    entries["s" + s] = { squad: s, G: G, tx: x, ty: y, t0: now, kind: kind || "walk", arrivedAt: -1 };
  }

  function init() { inited = true; }

  function update(G, dt) {
    if (typeof dt !== "number" || dt < 0) dt = 0;
    now += dt;
    for (var k in entries) {
      if (!entries.hasOwnProperty(k)) continue;
      var e = entries[k];
      var c = centreOf(e.G, e.squad);
      if (!c) { delete entries[k]; continue; }
      if (e.arrivedAt < 0) {
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
      if (!e) continue;
      var col = squadColor(G, e.squad);
      var tp = project(e.tx, e.ty);
      var c = centreOf(G, e.squad);
      if (!c) continue;
      var sp = project(c.x, c.y);
      var isSel = sel === e.squad;
      var age = t - e.t0;

      if (e.arrivedAt < 0) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 5);
        ctx.globalAlpha = 0.55 + 0.35 * pulse;
        ctx.strokeStyle = col;
        ctx.lineWidth = isSel ? 3 : 2;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 10 + 6 * pulse, 0, Math.PI * 2);
        ctx.stroke();

        if (isSel) {   /* route line only for the selected squad */
          ctx.globalAlpha = 0.8;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          ctx.lineTo(tp.x, tp.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

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
