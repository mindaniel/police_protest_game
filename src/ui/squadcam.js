var SQUADCAM = (function () {
  var hidden = false;
  var seenSquad = -1;
  var base = null, baseRef = null;
  var px = 3;              // offscreen px per tile for the cached map image
  var lastGeom = null;
  var closeBtn = null;
  var easeX = null, easeY = null, easeSquad = -1;

  var CSS_W = 280, CSS_H = 180;
  var PANEL_W = 96;        // side strip width in CSS px

  function tileColor(ch) {
    if (ch === '#') return '#2b2b2b';
    if (ch === 'S') return '#2b2b2b';
    if (ch === '.') return '#c9ccd0';
    if (ch === 'a') return '#a7aaae';
    if (ch === 'P') return '#e0d8c8';
    if (ch === 'G') return '#6fa05a';
    if (ch === 'T') return '#6fa05a';
    if (ch === 'W') return '#4f86c6';
    return null;
  }

  function buildBase() {
    if (typeof MAP === "undefined" || !MAP || !MAP.rows) return;
    if (baseRef === MAP.rows && base) return;
    var c = document.createElement("canvas");
    c.width = MAP.width * px;
    c.height = MAP.height * px;
    var b = c.getContext("2d");
    b.fillStyle = "#1a1a1a";
    b.fillRect(0, 0, c.width, c.height);
    var x, y, ch, col;
    for (y = 0; y < MAP.height; y++) {
      var row = MAP.rows[y];
      for (x = 0; x < MAP.width; x++) {
        ch = row.charAt(x);
        col = tileColor(ch);
        if (!col) continue;
        b.fillStyle = col;
        b.fillRect(x * px, y * px, px, px);
      }
    }
    base = c;
    baseRef = MAP.rows;
  }

  function squadCentre(g, s) {
    var cx = 0, cy = 0, n = 0, i;
    for (i = 0; i < g.officers.length; i++) {
      if (g.officers[i].squad === s) { cx += g.officers[i].x; cy += g.officers[i].y; n++; }
    }
    for (i = 0; i < g.vehicles.length; i++) {
      if (g.vehicles[i].squad === s) { cx += g.vehicles[i].x; cy += g.vehicles[i].y; n++; }
    }
    if (!n) return null;
    return { x: cx / n, y: cy / n };
  }

  function squadBusy(g, s) {
    var i, o;
    var ord = g.orders && g.orders[s];
    if (ord && (ord.order === "guard" || ord.order === "push")) return true;
    for (i = 0; i < g.officers.length; i++) {
      o = g.officers[i];
      if (o.squad !== s) continue;
      if (o.busy || o.arrestTarget) return true;
    }
    return false;
  }

  function typeName(lo) {
    if (!lo || lo === "none") return "Foot";
    if (lo === "mounted") return "Mounted";
    if (lo === "motorbike") return "Motorbike";
    if (lo === "car") return "Car";
    if (lo === "watertruck") return "Water";
    if (lo === "barriertruck") return "Barrier";
    if (lo === "liaison") return "Liaison";
    if (lo === "van") return "Van";
    if (lo === "truck") return "Truck";
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  }

  function loadoutOf(g, s) {
    if (typeof Police !== "undefined" && Police.getLoadout) return Police.getLoadout(g, s);
    return "";
  }

  function squadColour(s) {
    var hues = [45, 200, 145, 15, 275, 325, 85, 170, 240, 300];
    return "hsl(" + hues[s % hues.length] + ",75%,58%)";
  }

  function vehicleDims(type) {
    if (type === "car") return { w: 1.7, h: 0.8 };
    if (type === "van") return { w: 2.1, h: 0.9 };
    if (type === "truck" || type === "watertruck" || type === "barriertruck") return { w: 2.6, h: 1.0 };
    if (type === "ambulance") return { w: 2.0, h: 0.9 };
    if (type === "motorbike") return { w: 1.0, h: 0.5 };
    return { w: 2.0, h: 0.9 };
  }

  function vehicleColour(type, squad) {
    if (type === "watertruck") return "#4f86c6";
    if (type === "barriertruck") return "#b08a3e";
    if (type === "ambulance") return "#d9d9d9";
    return squadColour(squad);
  }

  function geom(canvas) {
    var lw = (typeof MAP !== "undefined" && MAP.width && CONFIG && CONFIG.tileSize) ? MAP.width * CONFIG.tileSize : 1;
    var cw = canvas ? parseFloat(canvas.style.width) : 0;
    var k = (cw > 0 && isFinite(cw)) ? lw / cw : 1;
    if (!(k > 0)) k = 1;
    var w = CSS_W * k, h = CSS_H * k;
    return {
      k: k, w: w, h: h,
      x: lw - w - 12 * k,
      y: (typeof MAP !== "undefined" && CONFIG ? MAP.height * CONFIG.tileSize : 0) - h - 34 * k
    };
  }

  function drawFigure(ctx, x, y, busy, k) {
    var rad = Math.max(1.5, 2.2 * k);
    // body
    ctx.fillStyle = "#2f7fd1";
    ctx.fillRect(x - rad * 0.6, y, rad * 1.2, rad * 2);
    // head
    ctx.beginPath();
    ctx.arc(x, y - rad * 0.6, rad * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = "#4a9be8";
    ctx.fill();
    if (busy) {
      ctx.beginPath();
      ctx.arc(x, y + rad * 0.6, rad * 2.2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(1, 0.9 * k);
      ctx.stroke();
    }
  }

  function draw(ctx, g) {
    if (typeof MAP === "undefined" || !MAP || !MAP.rows) return;
    if (typeof UI === "undefined" || (UI.screen !== "planning" && UI.screen !== "playing")) return;
    if (hidden) return;

    var s = UI.selected;
    if (seenSquad !== s) { hidden = false; seenSquad = s; easeX = null; easeY = null; easeSquad = -1; }
    if (hidden) return;

    buildBase();
    if (!base) return;

    var gm = geom(UI.Game ? UI.Game.canvas : null);
    lastGeom = gm;
    var center = squadCentre(g, s);
    if (!center) { closeBtn = null; return; }

    // Smooth follow.
    if (easeSquad !== s || easeX === null) { easeX = center.x; easeY = center.y; easeSquad = s; }
    easeX += (center.x - easeX) * 0.18;
    easeY += (center.y - easeY) * 0.18;

    var viewW = 24, viewH = 16;
    var cx = easeX, cy = easeY;
    var x0 = cx - viewW / 2, y0 = cy - viewH / 2;

    ctx.save();
    var r = 8 * gm.k;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(gm.x, gm.y, gm.w, gm.h, r);
    else ctx.rect(gm.x, gm.y, gm.w, gm.h);
    ctx.fillStyle = "rgba(10,13,20,0.92)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, 2 * gm.k);
    ctx.strokeStyle = "#3a4a60";
    ctx.stroke();

    var pad = 4 * gm.k;
    var headH = 20 * gm.k;
    var ix = gm.x + pad, iy = gm.y + headH, iw = gm.w - pad * 2, ih = gm.h - headH - pad;

    // Split into map area + side strip.
    var stripW = Math.max(60 * gm.k, PANEL_W * gm.k);
    var mapW = Math.max(1, iw - stripW - pad);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, mapW, ih);
    ctx.clip();

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(ix, iy, mapW, ih);

    var sx = x0 * px, sy = y0 * px, sw = viewW * px, sh = viewH * px;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, sx, sy, sw, sh, ix, iy, mapW, ih);
    ctx.imageSmoothingEnabled = true;

    var wpt = mapW / viewW;
    function tX(tx) { return ix + (tx - x0) * wpt; }
    function tY(ty) { return iy + (ty - y0) * wpt; }
    function inView(tx, ty) {
      return tx >= x0 - 1 && tx <= x0 + viewW + 1 && ty >= y0 - 1 && ty <= y0 + viewH + 1;
    }

    // Orders: area / target.
    var ord = null;
    if (typeof ORDERS !== "undefined" && ORDERS.get) ord = ORDERS.get(G, s);
    else if (g.orders && g.orders[s]) ord = g.orders[s];
    if (ord) {
      if (ord.area) {
        var a = ord.area;
        var ax1 = Math.min(a.x0, a.x1), ay1 = Math.min(a.y0, a.y1);
        var ax2 = Math.max(a.x0, a.x1), ay2 = Math.max(a.y0, a.y1);
        ctx.save();
        ctx.setLineDash([3 * gm.k, 3 * gm.k]);
        ctx.strokeStyle = "rgba(42,157,143,0.95)";
        ctx.lineWidth = Math.max(1, gm.k);
        ctx.strokeRect(tX(ax1), tY(ay1), (ax2 - ax1) * wpt, (ay2 - ay1) * wpt);
        ctx.restore();
      }
      var tgx = (typeof ord.targetX === "number") ? ord.targetX : (ord.target ? ord.target.x : null);
      var tgy = (typeof ord.targetY === "number") ? ord.targetY : (ord.target ? ord.target.y : null);
      if (tgx !== null && tgy !== null && typeof tgx === "number") {
        ctx.beginPath();
        ctx.arc(tX(tgx), tY(tgy), 3 * gm.k, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,193,7,0.95)";
        ctx.lineWidth = Math.max(1, 1.5 * gm.k);
        ctx.stroke();
      }
    }

    // Agents: rioters red, peaceful grey.
    var dot = Math.max(1.2, 1.5 * gm.k);
    var i, a, tx, ty, col;
    for (i = 0; i < g.agents.length; i++) {
      a = g.agents[i];
      if (!a.active) continue;
      if (!inView(a.x, a.y)) continue;
      tx = tX(a.x); ty = tY(a.y);
      if (a.role === "rioter") col = "#e03131";
      else col = "#9aa0a6";
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(tx, ty, dot, 0, Math.PI * 2);
      ctx.fill();
    }

    // Other squads faint blue.
    for (i = 0; i < g.officers.length; i++) {
      var o = g.officers[i];
      if (o.squad === s) continue;
      if (!inView(o.x, o.y)) continue;
      ctx.fillStyle = "rgba(120,170,230,0.55)";
      ctx.beginPath();
      ctx.arc(tX(o.x), tY(o.y), Math.max(1.2, 1.6 * gm.k), 0, Math.PI * 2);
      ctx.fill();
    }

    // Vehicles (rotated rounded rects at real size).
    function drawVehicle(v) {
      var d = vehicleDims(v.type);
      var ang = (typeof v.angle === "number") ? v.angle
        : (typeof v.dir === "number") ? v.dir
        : (typeof v.heading === "number") ? v.heading : 0;
      var wv = d.w * wpt, hv = d.h * wpt;
      var vx = tX(v.x), vy = tY(v.y);
      ctx.save();
      ctx.translate(vx, vy);
      ctx.rotate(ang);
      var rad = Math.min(wv, hv) * 0.28;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-wv / 2, -hv / 2, wv, hv, rad);
      else ctx.rect(-wv / 2, -hv / 2, wv, hv);
      ctx.fillStyle = vehicleColour(v.type, v.squad);
      ctx.globalAlpha = v.squad === s ? 1 : 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (v.squad === s) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = Math.max(1, 0.8 * gm.k);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (i = 0; i < g.vehicles.length; i++) {
      var v = g.vehicles[i];
      if (!inView(v.x, v.y)) continue;
      drawVehicle(v);
    }

    // Selected squad officers: figures, rings, arrest lines.
    for (i = 0; i < g.officers.length; i++) {
      var off = g.officers[i];
      if (off.squad !== s) continue;
      if (!inView(off.x, off.y)) continue;
      tx = tX(off.x); ty = tY(off.y);
      if (off.arrestTarget && off.arrestTarget.active) {
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tX(off.arrestTarget.x), tY(off.arrestTarget.y));
        ctx.strokeStyle = "rgba(255,216,102,0.9)";
        ctx.lineWidth = Math.max(1, 0.9 * gm.k);
        ctx.stroke();
      }
      drawFigure(ctx, tx, ty, !!(off.busy || off.arrestTarget), gm.k);
    }

    ctx.restore(); // un-clip map

    // ---- Side strip ----
    var sxStrip = ix + mapW + pad * 0.75;
    var stripX = sxStrip, stripY = iy, stripW2 = iw - (stripX - ix);

    ctx.fillStyle = "rgba(20,26,38,0.95)";
    ctx.fillRect(stripX, stripY, stripW2, ih);
    ctx.strokeStyle = "#2c3a4d";
    ctx.lineWidth = 1;
    ctx.strokeRect(stripX + 0.5, stripY + 0.5, stripW2 - 1, ih - 1);

    var lo = loadoutOf(g, s);
    var fnt = Math.round(9 * gm.k);
    var fntB = Math.round(10 * gm.k);
    var txl = stripX + 4 * gm.k;
    var ty2 = stripY + 4 * gm.k;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    ctx.font = "bold " + fntB + "px Consolas, monospace";
    ctx.fillStyle = "#dfe6ef";
    ctx.fillText("S" + (s + 1), txl, ty2);
    ty2 += fntB + 2 * gm.k;

    ctx.font = fnt + "px Consolas, monospace";
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(typeName(lo), txl, ty2);
    ty2 += fnt + 3 * gm.k;

    var orderName = ord ? (ord.order || "auto").toUpperCase() : "AUTO";
    ctx.fillStyle = "#b8c4d4";
    ctx.fillText(orderName, txl, ty2);
    ty2 += fnt + 3 * gm.k;

    var isBusy = squadBusy(g, s);
    var badgeCol = isBusy ? "#c0392b" : "#2a9d8f";
    var badgeW = stripW2 - 8 * gm.k, badgeH = fnt + 3 * gm.k;
    ctx.fillStyle = badgeCol;
    ctx.fillRect(txl, ty2, badgeW, badgeH);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + fnt + "px Consolas, monospace";
    ctx.fillText(isBusy ? "BUSY" : "FREE", txl + 2 * gm.k, ty2 + 1.5 * gm.k);
    ty2 += badgeH + 4 * gm.k;

    // Officers / stamina bars.
    ctx.font = fnt + "px Consolas, monospace";
    ctx.fillStyle = "#9fb3c8";
    var offCount = 0;
    for (i = 0; i < g.officers.length; i++) if (g.officers[i].squad === s) offCount++;
    ctx.fillText("Officers " + offCount, txl, ty2);
    ty2 += fnt + 2 * gm.k;

    var barW2 = badgeW, barH2 = Math.max(2, 3 * gm.k);
    for (i = 0; i < g.officers.length; i++) {
      var oo = g.officers[i];
      if (oo.squad !== s) continue;
      if (ty2 + barH2 > stripY + ih - 2 * gm.k) break;
      var st = (typeof oo.stamina === "number") ? oo.stamina : 100;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(txl, ty2, barW2, barH2);
      ctx.fillStyle = st < 30 ? "#e03131" : "#2a9d8f";
      ctx.fillRect(txl, ty2, barW2 * Math.max(0, Math.min(1, st / 100)), barH2);
      ty2 += barH2 + 1.5 * gm.k;
    }

    // Vehicle squad: seats used / arrest load.
    if (offCount === 0 || true) {
      var anyV = false;
      for (i = 0; i < g.vehicles.length; i++) {
        if (g.vehicles[i].squad !== s) continue;
        anyV = true;
        var vv = g.vehicles[i];
        var seats = null, arrest = null;
        if (typeof TRANSPORT !== "undefined" && TRANSPORT.seats) {
          try { seats = TRANSPORT.seats(vv.type); } catch (e) { seats = null; }
        }
        var crewN = (vv.crew && typeof vv.crew.length === "number") ? vv.crew.length : 0;
        var loadN = (typeof vv.load === "number") ? vv.load : 0;
        ty2 += 2 * gm.k;
        if (ty2 + fnt * 2 > stripY + ih - 2 * gm.k) break;
        ctx.fillStyle = "#9fb3c8";
        ctx.font = fnt + "px Consolas, monospace";
        var sTxt = "Seat " + crewN;
        if (seats && typeof seats.crew === "number") sTxt += "/" + seats.crew;
        ctx.fillText(sTxt, txl, ty2);
        ty2 += fnt + 1 * gm.k;
        var aTxt = "Load " + loadN;
        if (seats && typeof seats.arrest === "number") aTxt += "/" + seats.arrest;
        ctx.fillText(aTxt, txl, ty2);
        ty2 += fnt + 1 * gm.k;
        if (!anyV) break;
      }
    }

    // Header line.
    var headY = gm.y + 3 * gm.k;
    var hf = Math.round(11 * gm.k);
    ctx.font = "bold " + hf + "px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#dfe6ef";
    var head = "S" + (s + 1) + " " + typeName(lo);
    ctx.fillText(head, gm.x + 6 * gm.k, headY);

    // Close button.
    var cb = 9 * gm.k;
    closeBtn = { x: gm.x + gm.w - cb - 4 * gm.k, y: gm.y + 4 * gm.k, r: cb };
    ctx.strokeStyle = "#8a9bb0";
    ctx.lineWidth = Math.max(1, 1.6 * gm.k);
    ctx.beginPath();
    ctx.moveTo(closeBtn.x - cb * 0.5, closeBtn.y - cb * 0.5);
    ctx.lineTo(closeBtn.x + cb * 0.5, closeBtn.y + cb * 0.5);
    ctx.moveTo(closeBtn.x + cb * 0.5, closeBtn.y - cb * 0.5);
    ctx.lineTo(closeBtn.x - cb * 0.5, closeBtn.y + cb * 0.5);
    ctx.stroke();

    ctx.restore();
  }

  function click(x, y) {
    if (hidden) return false;
    if (typeof UI === "undefined" || (UI.screen !== "planning" && UI.screen !== "playing")) return false;
    if (!lastGeom) return false;
    var gm = lastGeom;
    if (x < gm.x || x > gm.x + gm.w || y < gm.y || y > gm.y + gm.h) return false;

    if (closeBtn) {
      var dx = x - closeBtn.x, dy = y - closeBtn.y;
      if (dx * dx + dy * dy <= closeBtn.r * closeBtn.r) {
        hidden = true;
        return true;
      }
    }

    if (typeof Art !== "undefined" && Art.centerOn && typeof G !== "undefined") {
      var c = squadCentre(G, UI.selected);
      if (c) { Art.centerOn(c.x, c.y); return true; }
    }
    return true;
  }

  return { draw: draw, click: click, centre: squadCentre };
})();
