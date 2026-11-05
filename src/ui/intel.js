/* intel.js (DeepSeek) */
var INTEL = (function () {
  var lastForecast = null;
  var lastBarrierCount = -1;
  var lastForecastTime = -100000;
  var prevRouteLen = -1;
  var flashUntil = 0;
  var toastUntil = 0;
  var toastMsg = "";
  var nowMs = 0;

  function now() {
    if (typeof performance !== "undefined" && performance.now) return performance.now();
    return Date.now();
  }

  function routeLength(route) {
    if (!route || route.length < 2) return 0;
    var d = 0;
    for (var i = 1; i < route.length; i++) {
      var dx = route[i].x - route[i - 1].x;
      var dy = route[i].y - route[i - 1].y;
      d += Math.sqrt(dx * dx + dy * dy);
    }
    return d;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function activeCrowd(G) {
    var total = 0, riot = 0;
    var arr = (G && G.agents) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].active) {
        total++;
        if (arr[i].role === "rioter") riot++;
      }
    }
    return { total: total, rioters: riot };
  }

  function shopsOnRoute(G, route) {
    var shops = (G && G.shops) || [];
    var out = [];
    if (!route || route.length === 0) return out;
    for (var s = 0; s < shops.length; s++) {
      var shop = shops[s];
      if (!shop) continue;
      var near = false;
      for (var r = 0; r < route.length; r++) {
        var dx = route[r].x - shop.x;
        var dy = route[r].y - shop.y;
        if (dx * dx + dy * dy <= 9) { near = true; break; }
      }
      if (near) out.push(shop);
    }
    return out;
  }

  function recompute(G) {
    var f = null;
    if (typeof MARCHES !== "undefined" && MARCHES.forecast) {
      try { f = MARCHES.forecast(G); } catch (e) { f = null; }
    }
    var newLen = routeLength(f && f.route);
    if (prevRouteLen >= 0 && Math.abs(newLen - prevRouteLen) > 0.001) {
      flashUntil = now() + 1000;
      toastUntil = now() + 2000;
      toastMsg = "March re-routed";
    }
    prevRouteLen = newLen;
    lastForecast = f;
    lastForecastTime = now();
    lastBarrierCount = (G && G.barriers) ? G.barriers.length : 0;
    return f;
  }

  function update(G) {
    nowMs = now();
    if (typeof UI !== "undefined" && UI.screen !== "planning") return;
    if (!G) return;
    var bcount = (G.barriers) ? G.barriers.length : 0;
    var need = (lastForecast === null) ||
      (bcount !== lastBarrierCount) ||
      (nowMs - lastForecastTime >= 1000);
    if (need) recompute(G);
  }

  function drawArrow(ctx, x, y, angle, size) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - 0.4), y - size * Math.sin(angle - 0.4));
    ctx.lineTo(x - size * Math.cos(angle + 0.4), y - size * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  function drawPin(ctx, sx, sy, label, color) {
    ctx.save();
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var w = ctx.measureText(label).width + 10;
    var h = 16;
    ctx.fillStyle = "rgba(20,20,26,0.9)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(sx - w / 2, sy - h / 2, w, h, 3); }
    else { ctx.rect(sx - w / 2, sy - h / 2, w, h); }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, sx, sy);
    ctx.restore();
  }

  function draw(ctx, G) {
    if (typeof UI !== "undefined" && UI.screen !== "planning") return;
    if (!G || typeof Art === "undefined") return;
    var f = lastForecast;
    if (!f && lastForecast === null) f = recompute(G);
    nowMs = now();

    ctx.save();

    if (f && f.route && f.route.length > 1) {
      var flash = nowMs < flashUntil;
      var alpha = flash ? (0.35 + 0.35 * Math.abs(Math.sin(nowMs / 80))) : 0.5;
      var route = f.route;
      var pts = [];
      for (var i = 0; i < route.length; i++) {
        pts.push(Art.project(route[i].x, route[i].y, 0));
      }

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,150,40," + alpha + ")";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var p = 1; p < pts.length; p++) ctx.lineTo(pts[p].x, pts[p].y);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,180,70," + Math.min(1, alpha + 0.3) + ")";
      var accum = 0, step = 8;
      for (var q = 1; q < pts.length; q++) {
        var a = pts[q - 1], b = pts[q];
        var dx = b.x - a.x, dy = b.y - a.y;
        var segLen = Math.sqrt(dx * dx + dy * dy);
        if (segLen < 0.0001) continue;
        var ang = Math.atan2(dy, dx);
        while (accum + segLen >= step) {
          var t = (step - accum) / segLen;
          var ax = a.x + dx * t;
          var ay = a.y + dy * t;
          drawArrow(ctx, ax, ay, ang, 7);
          step += 8;
        }
        accum += segLen;
        step = step - 0;
        if (accum > step) { step = Math.floor(accum / 8 + 1) * 8; }
      }

      var startName = (f.start && f.start.name) || "start";
      var goalName = (f.end && (f.end.name || (f.end.type === "gov" ? "government building" : "target"))) || "target";
      drawPin(ctx, pts[0].x, pts[0].y - 18, "GATHER", "#7fd4ff");
      drawPin(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y - 18, "GOAL: " + goalName, "#ffb84d");

      var risky = shopsOnRoute(G, route);
      ctx.strokeStyle = "rgba(230,60,60,0.95)";
      ctx.lineWidth = 1.8;
      for (var k = 0; k < risky.length; k++) {
        var sp = Art.project(risky[k].x, risky[k].y, 0);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();

    if (nowMs < toastUntil) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var tw = ctx.measureText(toastMsg).width + 24;
      ctx.fillStyle = "rgba(40,30,10,0.85)";
      ctx.strokeStyle = "rgba(255,180,70,0.9)";
      ctx.lineWidth = 1.5;
      var tx = (ctx.canvas.width / 2) - tw / 2;
      var ty = 90;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(tx, ty, tw, 26, 5); }
      else { ctx.rect(tx, ty, tw, 26); }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd27f";
      ctx.fillText(toastMsg, ctx.canvas.width / 2, ty + 13);
      ctx.restore();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    var cw = ctx.canvas.width;
    var cardW = 420;
    var pad = 10;
    var lines = [];
    var crowd = activeCrowd(G);
    var calm = 90;
    if (typeof CONFIG !== "undefined" && typeof CONFIG.calmStartSeconds === "number") {
      calm = CONFIG.calmStartSeconds;
    }

    if (f) {
      var L = Math.round(routeLength(f.route) * 5);
      var gname = (f.end && (f.end.name || (f.end.type === "gov" ? "government building" : "target"))) || "target";
      var sname = (f.start && f.start.name) || "start";
      lines.push("Expected crowd: " + crowd.total + (crowd.rioters ? " (rioters about " + crowd.rioters + ")" : " (rioters hidden among them)"));
      lines.push("Gathers at: " + sname);
      lines.push("Goal: " + gname + " (" + L + " m march)");
      lines.push("Starts in about 1:30 - trouble expected after " + fmtTime(calm));
      lines.push("Shops on route: " + shopsOnRoute(G, f.route).length);
    } else {
      lines.push(G._marchLock ? "Route to " + ((G._marchLock.end && G._marchLock.end.name) || "the goal") + " fully blocked: the crowd will pick another target, angrier" : "No march expected - small gatherings only");
      lines.push("Expected crowd: " + crowd.total + " (rioters about " + crowd.rioters + ")");
    }
    lines.push("Barriers (B / right-click) close a road: the march re-routes.");
    lines.push("Blocking it completely raises anger.");

    ctx.font = "13px monospace";
    var maxW = 0;
    for (var li = 0; li < lines.length; li++) {
      var w = ctx.measureText(lines[li]).width;
      if (w > maxW) maxW = w;
    }
    cardW = Math.min(cw - 40, Math.max(420, maxW + pad * 2 + 40));

    var cardH = pad * 2 + 20 + lines.length * 18;
    var cx = (cw - cardW) / 2;
    var cy = 8;

    ctx.fillStyle = "rgba(12,14,20,0.82)";
    ctx.strokeStyle = "rgba(255,180,70,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(cx, cy, cardW, cardH, 6); }
    else { ctx.rect(cx, cy, cardW, cardH); }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffd27f";
    ctx.font = "bold 15px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("INTEL BRIEFING", cx + pad, cy + pad);

    ctx.fillStyle = "#e8e8ee";
    ctx.font = "13px monospace";
    var ly = cy + pad + 24;
    for (var lj = 0; lj < lines.length; lj++) {
      ctx.fillText(lines[lj], cx + pad, ly);
      ly += 18;
    }

    ctx.restore();
  }

  function reset() {
    lastForecast = null;
    lastBarrierCount = -1;
    lastForecastTime = -100000;
    prevRouteLen = -1;
    flashUntil = 0;
    toastUntil = 0;
    toastMsg = "";
    nowMs = 0;
  }

  return { update: update, draw: draw, reset: reset };
})();
