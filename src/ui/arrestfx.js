/* arrestfx.js (DeepSeek) */
var ARRESTFX = (function () {
  var DASH = [3, 4], NODASH = [];
  var lastLoads = [], popups = [], flash = {};

  function reset() {
    lastLoads.length = 0;
    popups.length = 0;
    flash = {};
  }

  function icon(ctx, x, y, station) {
    ctx.fillStyle = "#dfe6ec";
    if (station) {
      ctx.fillRect(x - 3, y - 5, 6, 6);
      ctx.strokeStyle = "#dfe6ec";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 3, y - 5);
      ctx.lineTo(x + 3, y - 10);
      ctx.stroke();
      ctx.fillStyle = "#ff6a30";
      ctx.fillRect(x + 3, y - 10, 4, 2.5);
    } else {
      ctx.fillRect(x - 4.5, y - 2.5, 9, 3.5);
      ctx.fillRect(x - 3, y + 1, 2, 2);
      ctx.fillRect(x + 1, y + 1, 2, 2);
    }
  }

  function draw(ctx, G) {
    if (!ctx || !G || typeof Art === "undefined" || !Art.project) return;
    var z = (Art.camera && Art.camera.zoom) || 1;
    var det = G.detainees || [], veh = G.vehicles || [];
    var i, d, v, o, p, q, s, a, n, seats, k, tx, ty;

    ctx.save();
    ctx.lineCap = "round";

    for (i = 0; i < det.length; i++) {
      d = det[i];
      if (!d) continue;
      s = Art.project(d.x, d.y, 0.1);

      if (d.pickup) {
        a = 0.55 + 0.35 * Math.sin(G.time * 5);
        ctx.strokeStyle = "rgba(255,214,110," + a.toFixed(2) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7 + 2.5 * Math.sin(G.time * 5), 0, 6.283);
        ctx.stroke();
      }

      if (d.state === "walk") {
        if (d.officer) {
          o = d.officer;
          p = Art.project(o.x, o.y, 0.9);
          q = Art.project(d.x, d.y, 0.9);
          ctx.strokeStyle = "rgba(18,18,24,0.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }

        p = Art.project(d.x, d.y, 0.45);
        q = Art.project(d.x, d.y, 0.88);
        tx = q.x; ty = q.y;
        if (d.officer) {
          o = Art.project(d.officer.x, d.officer.y, 0.88);
          tx = q.x + (o.x - q.x) * 0.35;
          ty = q.y + (o.y - q.y) * 0.35;
        }
        ctx.strokeStyle = "#20242c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = "#c8b39a";
        ctx.beginPath();
        ctx.arc(tx, ty - 1.5, 2, 0, 6.283);
        ctx.fill();

        p = Art.project(d.x, d.y, 0.55);
        ctx.strokeStyle = "#cfd6dd";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x - 1.6, p.y, 1.4, 0, 6.283);
        ctx.moveTo(p.x + 3, p.y);
        ctx.arc(p.x + 1.6, p.y, 1.4, 0, 6.283);
        ctx.stroke();

        if (d.car) {
          q = Art.project(d.x, d.y, 0.5);
          p = Art.project(d.car.x, d.car.y, 0.35);
          ctx.strokeStyle = d.wrong ? "rgba(255,96,48,0.95)" : "rgba(255,255,255,0.8)";
          ctx.lineWidth = 1;
          if (ctx.setLineDash) ctx.setLineDash(DASH);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          if (ctx.setLineDash) ctx.setLineDash(NODASH);
          icon(ctx, p.x, p.y, !!d.car.station);
        }
      }
    }

    for (i = 0; i < veh.length; i++) {
      v = veh[i];
      if (!v) continue;
      n = v.load | 0;
      a = lastLoads[i];
      if (typeof a === "number" && n !== a) {
        if (n > a) {
          popups.push({ x: v.x, y: v.y, t: G.time, txt: "+1 in custody", col: "#ffffff" });
          flash[i] = G.time + 0.35;
        } else {
          popups.push({ x: v.x, y: v.y, t: G.time, txt: "-" + (a - n) + " delivered", col: "#7dff9a" });
        }
      }
      lastLoads[i] = n;

      if (flash[i] && G.time < flash[i]) {
        p = Art.project(v.x, v.y, 0.55);
        ctx.globalAlpha = Math.max(0, (flash[i] - G.time) / 0.35);
        ctx.fillStyle = "#ffe9a8";
        ctx.fillRect(p.x - 6, p.y - 4, 12, 5);
        ctx.globalAlpha = 1;
      }

      if (z > 1.5 && typeof TRANSPORT !== "undefined" && TRANSPORT.seats) {
        s = TRANSPORT.seats(v.type) || {};
        seats = s.arrest | 0;
        if (seats > 0) {
          p = Art.project(v.x, v.y, 1.6);
          for (k = 0; k < seats; k++) {
            ctx.fillStyle = k < n ? "#ffb347" : "rgba(255,255,255,0.25)";
            ctx.fillRect(p.x - (seats * 5 - 2) / 2 + k * 5, p.y - 3, 4, 4);
          }
        }
      }
    }
    lastLoads.length = veh.length;

    ctx.textAlign = "center";
    ctx.font = "10px monospace";
    for (i = popups.length - 1; i >= 0; i--) {
      p = popups[i];
      a = 1 - (G.time - p.t) / 2;
      if (a <= 0) { popups.splice(i, 1); continue; }
      q = Art.project(p.x, p.y, 1.2 + (G.time - p.t) * 0.8);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col;
      ctx.fillText(p.txt, q.x, q.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return { draw: draw, reset: reset };
})();
