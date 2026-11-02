var METERS = (function () {
  var active = null; // {s, tool, id, x, y}
  var splashT = 0;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function findVehicle(G, s) {
    if (!G || !G.vehicles) return null;
    var i, v;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (v && v.squad === s) {
        if (v.type === "watertruck") return v;
        if (v.type === "car" || v.type === "van" || v.type === "truck") return v;
      }
    }
    return null;
  }
  function toolOf(v) { return v.type === "watertruck" ? "water" : "loudspeaker"; }
  function byId(G, id) {
    if (!G || !G.vehicles) return null;
    var i;
    for (i = 0; i < G.vehicles.length; i++) {
      if (G.vehicles[i] && G.vehicles[i].id === id) return G.vehicles[i];
    }
    return null;
  }
  function init(v) {
    if (typeof v.meter !== "number") { v.meter = 100; v.meterIdle = 999; }
  }
  function stopActive(G) {
    if (active) {
      var v = byId(G, active.id);
      if (v) { init(v); v.meterIdle = 0; }
      active = null;
    }
  }

  function start(G, s, x, y) {
    if (!G) return "none";
    var v = findVehicle(G, s);
    if (!v) return "none";
    init(v);
    if (v.meter < 10) {
      if (G.log) G.log(toolOf(v) === "water" ? "Water tank empty - refilling" : "Loudspeaker battery empty - refilling");
      return "empty";
    }
    if (active && active.id !== v.id) stopActive(G);
    active = { s: s, tool: toolOf(v), id: v.id, x: x, y: y };
    v.meterIdle = 0;
    if (active.tool === "water") {
      if (typeof MEDIA !== "undefined" && MEDIA && MEDIA.report) MEDIA.report(G, "water", x, y);
      splashT = 0;
    }
    return "ok";
  }
  function aim(G, x, y) { if (active) { active.x = x; active.y = y; } }
  function stop(G) { stopActive(G); }
  function using(G) {
    if (!active) return null;
    if (!byId(G, active.id)) { active = null; return null; }
    return { s: active.s, tool: active.tool };
  }

  function update(G, dt) {
    var i, v, vv, tool, eff, dx, dy, d, r, tx, ty;
    if (!G || !G.vehicles) { active = null; return; }
    // refill all
    for (i = 0; i < G.vehicles.length; i++) {
      vv = G.vehicles[i];
      if (!vv) continue;
      if (vv.type !== "watertruck" && vv.type !== "car" && vv.type !== "van" && vv.type !== "truck") continue;
      init(vv);
      if (active && active.id === vv.id) continue;
      vv.meterIdle += dt;
      var startT = vv.type === "watertruck" ? 2 : 1.5;
      if (vv.meterIdle >= startT && vv.meter < 100) {
        vv.meter = Math.min(100, vv.meter + (vv.type === "watertruck" ? 5 : 6) * dt);
      }
    }
    if (!active) return;
    v = byId(G, active.id);
    if (!v) { active = null; return; }
    init(v);
    tool = active.tool;
    // drain
    if (tool === "water") {
      v.meter -= 14 * dt;
      if (v.meter <= 0) { v.meter = 0; if (G.log) G.log("Water tank empty"); v.meterIdle = 0; active = null; return; }
      // clamp aim
      dx = active.x - v.x; dy = active.y - v.y;
      d = Math.sqrt(dx * dx + dy * dy);
      r = CONFIG.waterRange;
      if (d > r && d > 0.0001) { tx = v.x + dx / d * r; ty = v.y + dy / d * r; }
      else { tx = active.x; ty = active.y; }
      G.waterFx = { x: tx, y: ty, fromX: v.x, fromY: v.y, until: G.time + 0.15 };
      eff = (G._wm || 0) + dt;
      // apply every 0.25s
      if (eff >= 0.25) {
        eff -= 0.25;
        Crowd.loudspeaker(G, tx, ty, CONFIG.waterRadius, CONFIG.waterStrength * 0.3);
        Crowd.push(G, tx, ty, CONFIG.waterRadius, CONFIG.waterPushStrength, v.x, v.y);
      }
      G._wm = eff;
      splashT += dt;
      if (splashT >= 0.5) {
        splashT = 0;
        if (typeof FX !== "undefined" && FX && FX.water) FX.water(G, tx, ty, CONFIG.waterRadius);
      }
    } else {
      v.meter -= 10 * dt;
      if (v.meter <= 0) { v.meter = 0; if (G.log) G.log("Loudspeaker battery flat"); v.meterIdle = 0; active = null; return; }
      Crowd.loudspeaker(G, v.x, v.y, CONFIG.loudspeakerRadius, CONFIG.loudspeakerStrength * 0.35 * dt);
    }
  }

  function level(G, s) {
    var v = findVehicle(G, s);
    if (!v) return null;
    init(v);
    return {
      tool: toolOf(v),
      value: v.meter,
      active: !!(active && active.id === v.id),
      refilling: !(active && active.id === v.id) && v.meter < 100 && v.meterIdle >= (v.type === "watertruck" ? 2 : 1.5)
    };
  }

  function draw(ctx, G) {
    if (!G || !G.vehicles || typeof Art === "undefined") return;
    var i, v, tool, S, p, w, h, x, y, frac, alpha, t, rr;
    S = Art.camera.S;
    for (i = 0; i < G.vehicles.length; i++) {
      v = G.vehicles[i];
      if (!v) continue;
      tool = (v.type === "watertruck") ? "water" : ((v.type === "car" || v.type === "van" || v.type === "truck") ? "loudspeaker" : null);
      if (!tool) continue;
      init(v);
      var isActive = !!(active && active.id === v.id);
      if (v.meter >= 100 && !isActive) continue;
      p = Art.project(v.x, v.y, 1.6);
      w = Math.max(26, 26 * S);
      h = Math.max(4, 4 * S);
      x = p.x - w / 2;
      y = p.y - 18 * S - h;
      ctx.fillStyle = "rgba(10,12,18,0.75)";
      ctx.fillRect(x, y, w, h);
      frac = clamp(v.meter / 100, 0, 1);
      if (isActive) { t = 0.75 + 0.25 * Math.sin(G.time * 10); } else { t = 1; }
      ctx.globalAlpha = t;
      ctx.fillStyle = tool === "water" ? "#4aa3ff" : "#ffb020";
      ctx.fillRect(x, y, w * frac, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(220,230,255,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (isActive && tool === "loudspeaker") {
        var maxR = CONFIG.loudspeakerRadius * 32 * S;
        for (var k = 0; k < 2; k++) {
          var phase = ((G.time / 1.2) + k * 0.5) % 1;
          rr = phase * maxR;
          ctx.globalAlpha = 0.35 * (1 - phase);
          ctx.strokeStyle = "rgba(255,176,32,1)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawHud(ctx, G, s, x, y, w) {
    var lv = level(G, s);
    if (!lv) return 0;
    var H = 18, barH = 14, label = lv.tool === "water" ? "WATER" : "LOUDSPEAKER";
    var hint = lv.tool === "water" ? "hold right-click / W" : "hold right-click / L";
    ctx.font = "bold 11px Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x, y + H / 2);
    var lw = ctx.measureText(label).width;
    var bx = x + lw + 8;
    var bw = w - (bx - x) - ctx.measureText(hint).width - 16;
    if (bw < 40) bw = 40;
    ctx.fillStyle = "rgba(10,12,18,0.75)";
    ctx.fillRect(bx, y + (H - barH) / 2, bw, barH);
    ctx.fillStyle = lv.tool === "water" ? "#4aa3ff" : "#ffb020";
    ctx.fillRect(bx, y + (H - barH) / 2, bw * clamp(lv.value / 100, 0, 1), barH);
    ctx.strokeStyle = "rgba(220,230,255,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + (H - barH) / 2 + 0.5, bw - 1, barH - 1);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(Math.round(lv.value) + "%", bx + bw / 2, y + H / 2);
    ctx.textAlign = "left";
    var hx = bx + bw + 8;
    if (lv.refilling) {
      ctx.fillStyle = "#999";
      ctx.fillText("refilling...", hx, y + H / 2);
    } else {
      ctx.fillStyle = "#ccc";
      ctx.fillText(hint, hx, y + H / 2);
    }
    return H;
  }

  return { start: start, aim: aim, stop: stop, update: update, using: using, level: level, draw: draw, drawHud: drawHud };
})();
if (typeof module !== "undefined" && module.exports) module.exports = METERS;
