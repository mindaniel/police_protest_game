var SQUADCAM = (function () {
  var hidden = false;
  var seenSquad = -1;
  var base = null, baseRef = null;
  var px = 3;              // offscreen px per tile for the cached map image
  var lastGeom = null;
  var closeBtn = null;

  // Panel geometry in CSS px, converted to logical canvas px in draw().
  var CSS_W = 280, CSS_H = 180;

  function tileColor(ch) {
    if (ch === '#') return '#2b2b2b';   // buildings: dark grey
    if (ch === 'S') return '#2b2b2b';
    if (ch === '.') return '#c9ccd0';   // street: light grey
    if (ch === 'a') return '#a7aaae';   // lanes: mid grey
    if (ch === 'P') return '#e0d8c8';   // plaza: beige
    if (ch === 'G') return '#6fa05a';   // grass: green
    if (ch === 'T') return '#6fa05a';
    if (ch === 'W') return '#4f86c6';   // water: blue
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

  // Centre of a squad (officers + vehicles); null if the squad has nothing.
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
    var i, o, cx = 0, cy = 0, n = 0;
    var ord = g.orders && g.orders[s];
    if (ord && (ord.order === "guard" || ord.order === "push")) return true;
    for (i = 0; i < g.officers.length; i++) {
      o = g.officers[i];
      if (o.squad !== s) continue;
      if (o.busy || o.arrestTarget) return true;
      cx += o.x; cy += o.y; n++;
    }
    for (i = 0; i < g.vehicles.length; i++) {
      if (g.vehicles[i].squad !== s) continue;
      cx += g.vehicles[i].x; cy += g.vehicles[i].y; n++;
    }
    if (n > 0) {
      cx /= n; cy /= n;
      for (i = 0; i < g.agents.length; i++) {
        var a = g.agents[i];
        if (!a.active || a.role !== "rioter") continue;
        if ((a.revealedUntil || 0) > g.time) {
          var dx = a.x - cx, dy = a.y - cy;
          if (dx * dx + dy * dy <= 36) return true;
        }
      }
    }
    return false;
  }

  function squadName(g, s) {
    var lo = (typeof Police !== "undefined" && Police.getLoadout) ? Police.getLoadout(g, s) : "";
    var n = (lo === "none" || !lo) ? "Foot"
      : (lo === "mounted") ? "Mounted"
      : (lo === "motorbike") ? "Motorbike"
      : (lo === "car") ? "Car"
      : (lo === "watertruck") ? "Water"
      : (lo === "barriertruck") ? "Barrier"
      : (lo === "liaison") ? "Liaison"
      : (lo === "van") ? "Van"
      : (lo === "truck") ? "Truck"
      : (lo ? (lo.charAt(0).toUpperCase() + lo.slice(1)) : "Foot");
    return "S" + (s + 1) + " " + n;
  }

  function staminaOf(g, s) {
    var min = -1, i, o, v;
    for (i = 0; i < g.officers.length; i++) {
      o = g.officers[i];
      if (o.squad !== s) continue;
      v = (typeof o.stamina === "number") ? o.stamina : 100;
      if (min < 0 || v < min) min = v;
    }
    return min < 0 ? 100 : Math.round(min);
  }

  function arresting(g, s) {
    for (var i = 0; i < g.officers.length; i++) {
      var o = g.officers[i];
      if (o.squad === s && o.arrestTarget && o.arrestTarget.active) return true;
    }
    return false;
  }

  // Squad colour: same idea as the rest of the game (distinct hue per squad id).
  function squadColour(s) {
    var hues = [45, 200, 145, 15, 275, 325, 85, 170, 240, 300];
    return "hsl(" + hues[s % hues.length] + ",75%,58%)";
  }

  function geom(canvas) {
    var lw = (typeof MAP !== "undefined" && MAP.width && CONFIG && CONFIG.tileSize) ? MAP.width * CONFIG.tileSize : 1;
    var cw = canvas ? parseFloat(canvas.style.width) : 0;
    var k = (cw > 0 && isFinite(cw)) ? lw / cw : 1;   // logical px per CSS px
    if (!(k > 0)) k = 1;
    var w = CSS_W * k, h = CSS_H * k;
    return {
      k: k,
      w: w,
      h: h,
      x: lw - w - 12 * k,
      y: (typeof MAP !== "undefined" ? MAP.height * CONFIG.tileSize : 0) - h - 34 * k
    };
  }

  function draw(ctx, g) {
    if (typeof MAP === "undefined" || !MAP || !MAP.rows) return;
    if (typeof UI === "undefined" || (UI.screen !== "planning" && UI.screen !== "playing")) return;
    if (hidden) return;

    var s = UI.selected;
    if (seenSquad !== s) { hidden = false; seenSquad = s; }
    if (hidden) return;

    buildBase();
    if (!base) return;

    var gm = geom(UI.Game ? UI.Game.canvas : null);
    lastGeom = gm;
    var center = squadCentre(g, s);
    if (!center) { closeBtn = null; return; }

    // World view in tiles (26 x 17 tiles).
    var viewW = 26, viewH = 17;
    var cx = center.x, cy = center.y;
    var x0 = cx - viewW / 2, y0 = cy - viewH / 2;

    ctx.save();

    // Frame (rounded dark).
    var r = 8 * gm.k;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(gm.x, gm.y, gm.w, gm.h, r);
    else ctx.rect(gm.x, gm.y, gm.w, gm.h);
    ctx.fillStyle = "rgba(10,13,20,0.92)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, 2 * gm.k);
    ctx.strokeStyle = "#3a4a60";
    ctx.stroke();

    // Clip to inset interior.
    var pad = 4 * gm.k;
    var headH = 22 * gm.k;
    var ix = gm.x + pad, iy = gm.y + headH, iw = gm.w - pad * 2, ih = gm.h - headH - pad;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();

    // Fill any out-of-map area first.
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(ix, iy, iw, ih);

    // Draw the cached map slice.
    var sx = x0 * px, sy = y0 * px, sw = viewW * px, sh = viewH * px;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, sx, sy, sw, sh, ix, iy, iw, ih);
    ctx.imageSmoothingEnabled = true;

    // World-to-inset transform.
    var wpt = iw / viewW; // inset px per tile
    function tX(tx) { return ix + (tx - x0) * wpt; }
    function tY(ty) { return iy + (ty - y0) * wpt; }

    // Bounds test helper: is (tx,ty) inside the visible view?
    function inView(tx, ty) {
      return tx >= x0 - 1 && tx <= x0 + viewW + 1 && ty >= y0 - 1 && ty <= y0 + viewH + 1;
    }

    // Patrol area / move target of the selected squad.
    if (typeof ORDERS !== "undefined" && ORDERS.get) {
      var ord = ORDERS.get(G, s);
      if (ord) {
        if (ord.area) {
          var a = ord.area;
          var ax1 = Math.min(a.x0, a.x1), ay1 = Math.min(a.y0, a.y1);
          var ax2 = Math.max(a.x0, a.x1), ay2 = Math.max(a.y0, a.y1);
          ctx.save();
          ctx.setLineDash([3 * gm.k, 3 * gm.k]);
          ctx.strokeStyle = "rgba(42,157,143,0.9)";
          ctx.lineWidth = Math.max(1, gm.k);
          ctx.strokeRect(tX(ax1), tY(ay1), (ax2 - ax1) * wpt, (ay2 - ay1) * wpt);
          ctx.restore();
        }
        if (ord.target) {
          var tg = ord.target;
          ctx.beginPath();
          ctx.arc(tX(tg.x), tY(tg.y), 3 * gm.k, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,193,7,0.95)";
          ctx.lineWidth = Math.max(1, 1.5 * gm.k);
          ctx.stroke();
        }
      }
    }

    // Agents (people) as small dots.
    var dot = Math.max(1.2, 1.6 * gm.k);
    var i, a, tx, ty;
    for (i = 0; i < g.agents.length; i++) {
      a = g.agents[i];
      if (!a.active) continue;
      if (!inView(a.x, a.y)) continue;
      tx = tX(a.x); ty = tY(a.y);
      var col;
      if (a.role === "rioter") {
        if ((a.revealedUntil || 0) > g.time) col = "#e03131";
        else if (a.angry) col = "#e03131";
        else if (a.braced) col = "#e8590c";
        else col = "#3a86c8";
      } else {
        col = (a.mood !== undefined && a.mood < 30) ? "#e8590c" : "#3a86c8";
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(tx, ty, dot, 0, Math.PI * 2);
      ctx.fill();
    }

    // Officers as coloured dots; selected squad's are bigger.
    var odot = Math.max(1.4, 1.8 * gm.k);
    var odotBig = Math.max(2, 2.6 * gm.k);
    for (i = 0; i < g.officers.length; i++) {
      var o = g.officers[i];
      if (!inView(o.x, o.y)) continue;
      tx = tX(o.x); ty = tY(o.y);
      ctx.fillStyle = squadColour(o.squad);
      ctx.beginPath();
      ctx.arc(tx, ty, o.squad === s ? odotBig : odot, 0, Math.PI * 2);
      ctx.fill();
    }

    // Vehicles as small boxes.
    var vw = Math.max(3, 4 * gm.k), vh = Math.max(2.5, 3 * gm.k);
    for (i = 0; i < g.vehicles.length; i++) {
      var v = g.vehicles[i];
      if (!inView(v.x, v.y)) continue;
      tx = tX(v.x); ty = tY(v.y);
      ctx.fillStyle = squadColour(v.squad);
      ctx.fillRect(tx - vw / 2, ty - vh / 2, vw, vh);
      if (v.squad === s) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = Math.max(1, gm.k * 0.8);
        ctx.strokeRect(tx - vw / 2, ty - vh / 2, vw, vh);
      }
    }

    ctx.restore(); // un-clip

    // Header: "S3 Mounted - PATROL - free"
    var headY = gm.y + 3 * gm.k;
    var fnt = Math.round(11 * gm.k);
    ctx.font = "bold " + fnt + "px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#dfe6ef";
    var order = "AUTO";
    if (typeof ORDERS !== "undefined" && ORDERS.get) order = (ORDERS.get(G, s).order || "auto").toUpperCase();
    var busy = squadBusy(g, s) ? "busy" : "free";
    var head = squadName(g, s) + " - " + order + " - " + busy;

    // Stamina bar (right aligned) + "arresting" tag.
    var barW = 46 * gm.k, barH = 7 * gm.k;
    var barX = gm.x + gm.w - pad - barW;
    var barY = gm.y + (headH - barH) / 2 - 1 * gm.k;
    var stam = staminaOf(g, s);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = stam > 50 ? "#2a9d8f" : (stam > 20 ? "#e8a33d" : "#e03131");
    ctx.fillRect(barX, barY, barW * Math.max(0, Math.min(1, stam / 100)), barH);
    ctx.strokeStyle = "#5a6f92";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);

    var tagX = barX - 6 * gm.k;
    if (arresting(g, s)) {
      ctx.font = "bold " + fnt + "px Consolas, monospace";
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffd866";
      ctx.fillText("arresting", tagX, headY);
      tagX -= ctx.measureText("arresting").width + 8 * gm.k;
    }
    ctx.font = "bold " + fnt + "px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#dfe6ef";
    var maxHead = tagX - (gm.x + 6 * gm.k);
    var hw = ctx.measureText(head).width;
    if (hw > maxHead && maxHead > 0) {
      ctx.save();
      ctx.translate(gm.x + 6 * gm.k, headY);
      ctx.scale(maxHead / hw, 1);
      ctx.fillText(head, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(head, gm.x + 6 * gm.k, headY);
    }

    // Close button (small x) in the top-right of the frame.
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

    // Close button?
    if (closeBtn) {
      var dx = x - closeBtn.x, dy = y - closeBtn.y;
      if (dx * dx + dy * dy <= closeBtn.r * closeBtn.r) {
        hidden = true;
        return true;
      }
    }

    // Otherwise: centre the main camera on the selected squad.
    if (typeof Art !== "undefined" && Art.centerOn && typeof G !== "undefined") {
      var c = squadCentre(G, UI.selected);
      if (c) { Art.centerOn(c.x, c.y); return true; }
    }
    return true;
  }

  return { draw: draw, click: click };
})();
