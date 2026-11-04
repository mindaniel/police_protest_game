var SQUADPLAN = (function () {
  var hidden = false;
  var scroll = 0;
  var hit = []; // hit boxes for this frame
  var rowRects = [];
  var listTop = 0;
  var listBottom = 0;
  var maxScroll = 0;

  // last drawn panel rect + time (for click/wheel consistency)
  var lastRect = null;
  var lastDrawTime = 0;

  try {
    var s = localStorage.getItem("ppg_squadplan");
    if (s === "1") hidden = true;
  } catch (e) {}

  function k() {
    return (typeof Game !== "undefined" && Game && typeof Game.textScale === "function") ? Game.textScale() : 1;
  }

  function fontFor(px, scale) {
    return Math.round(px * scale) + "px Consolas, monospace";
  }

  var UNITS = {
    none: "Foot squad",
    car: "Sedan",
    van: "Police van",
    truck: "Riot truck",
    watertruck: "Water cannon",
    barriertruck: "Barrier truck",
    motorbike: "Motorbikes",
    mounted: "Mounted unit",
    liaison: "Liaison team",
    ambulance: "Ambulance",
    fireengine: "Fire engine"
  };

  var ORDERS_LIST = ["hold", "guard", "patrol", "auto"];
  var ORDER_SHORT = { hold: "H", guard: "G", patrol: "P", auto: "A" };
  var ORDER_COL = { hold: "#9aa5b5", guard: "#4a7fd0", patrol: "#2a9d8f", auto: "#b07ce8" };

  function setHidden(v) {
    hidden = v;
    try { localStorage.setItem("ppg_squadplan", v ? "1" : "0"); } catch (e) {}
  }

  function getOrder(G, i) {
    try {
      if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.get === "function") {
        var o = ORDERS.get(G, i);
        if (o && o.order) return o.order;
        if (typeof o === "string") return o;
      }
    } catch (e) {}
    return "hold";
  }

  function getAreaInfo(G, i) {
    try {
      if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.get === "function") {
        var o = ORDERS.get(G, i);
        if (o && o.area) return o.area;
      }
    } catch (e) {}
    return null;
  }

  function applyOrder(G, i, name) {
    try {
      if (typeof ORDERS === "undefined" || !ORDERS) return;
      if (typeof ORDERS.setOrder === "function") ORDERS.setOrder(G, i, name);
      else if (typeof ORDERS.set === "function") ORDERS.set(G, i, name);
    } catch (e) {}
  }

  function getLoadout(G, i) {
    try {
      if (typeof Police !== "undefined" && Police && typeof Police.getLoadout === "function") {
        return Police.getLoadout(G, i);
      }
    } catch (e) {}
    return "none";
  }

  function unitName(t) {
    return UNITS[t] || "Foot squad";
  }

  function squadCount(G) {
    var n = 0;
    try {
      if (typeof CONFIG !== "undefined" && CONFIG && typeof CONFIG.squadCount === "number") n = CONFIG.squadCount;
    } catch (e) {}
    if (!n) n = 8;
    return n;
  }

  function getSelected() {
    try {
      if (typeof UI !== "undefined" && UI && typeof UI.selected === "number") return UI.selected;
    } catch (e) {}
    return -1;
  }

  function setSelected(i) {
    try {
      if (typeof UI !== "undefined" && UI) UI.selected = i;
    } catch (e) {}
  }

  function say(msg) {
    try {
      if (typeof UI !== "undefined" && UI && typeof UI.say === "function") UI.say(msg);
    } catch (e) {}
  }

  function rr(ctx, x, y, w, h, r) {
    if (r <= 0) { ctx.beginPath(); ctx.rect(x, y, w, h); return; }
    var m = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + m, y);
    ctx.lineTo(x + w - m, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + m);
    ctx.lineTo(x + w, y + h - m);
    ctx.quadraticCurveTo(x + w, y + h, x + w - m, y + h);
    ctx.lineTo(x + m, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - m);
    ctx.lineTo(x, y + m);
    ctx.quadraticCurveTo(x, y, x + m, y);
    ctx.closePath();
  }

  function box(px, py, pw, ph, onClick) {
    hit.push({ x: px, y: py, w: pw, h: ph, onClick: onClick });
  }

  function pointIn(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // wrap a string to fit maxW, return array of lines
  function wrapText(ctx, text, maxW) {
    var words = text.split(" ");
    var lines = [];
    var cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function areaLabel(G, i) {
    var a = getAreaInfo(G, i);
    if (!a) return "auto";
    var w = Math.abs(a.x1 - a.x0) + 1;
    var h = Math.abs(a.y1 - a.y0) + 1;
    return w + "x" + h;
  }

  // ---- draw ----

  function drawHidden(ctx, w, h) {
    var scale = k();
    ctx.save();
    ctx.font = fontFor(12, scale);
    ctx.textBaseline = "middle";
    var label = "Squad orders \u25B8";
    var tw = ctx.measureText(label).width;
    var padX = 10 * scale;
    var bw = tw + padX * 2;
    var bh = 26 * scale;
    var bx = 10;
    var by = 34;
    ctx.fillStyle = "rgba(14,18,28,0.9)";
    ctx.strokeStyle = "#3a4a60";
    ctx.lineWidth = 1;
    rr(ctx, bx, by, bw, bh, 5 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e6e6e6";
    ctx.textAlign = "center";
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
    lastRect = { x: bx, y: by, w: bw, h: bh };
    lastDrawTime = Date.now();
    box(bx, by, bw, bh, function () { setHidden(false); });
  }

  function mapSize(G) {
    var w = 0, h = 0;
    try {
      if (typeof MAP !== "undefined" && MAP) {
        w = MAP.w || MAP.width || 0;
        h = MAP.h || MAP.height || 0;
      }
    } catch (e) {}
    if ((!w || !h) && G && G.map) {
      var m = G.map;
      w = m.w || m.width || m.cols || 0;
      h = m.h || m.height || m.rows || 0;
      if ((!w || !h) && m.length) {
        h = m.length;
        if (m[0]) w = m[0].length || 0;
      }
    }
    if (!w) w = 128;
    if (!h) h = 128;
    return { w: w, h: h };
  }

  function sectors(G) {
    var d = mapSize(G), out = [];
    var xs = [0, Math.floor(d.w / 3), Math.floor(d.w * 2 / 3), d.w - 1];
    var ys = [0, Math.floor(d.h / 3), Math.floor(d.h * 2 / 3), d.h - 1];
    var ids = ["NW", "N", "NE", "W", "CENTRE", "E", "SW", "S", "SE"];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var x0 = xs[c], x1 = xs[c + 1], y0 = ys[r], y1 = ys[r + 1];
        if (x1 < x0) x1 = x0;
        if (y1 < y0) y1 = y0;
        out.push({ id: ids[r * 3 + c], name: ids[r * 3 + c], x0: x0, y0: y0, x1: x1, y1: y1 });
      }
    }
    return out;
  }

  function sectorAt(G, tx, ty) {
    var secs = sectors(G);
    for (var i = 0; i < secs.length; i++) {
      var s = secs[i];
      if (tx >= s.x0 && tx <= s.x1 && ty >= s.y0 && ty <= s.y1) return s;
    }
    return null;
  }

  function isRioter(a) {
    return !!(a && (a.rioter || a.isRioter || a.type === "rioter" || a.kind === "rioter" || a.role === "rioter"));
  }

  function threatFor(G) {
    var secs = sectors(G), out = [], i;
    for (i = 0; i < secs.length; i++) out.push(0);
    if (!G) return out;

    function addAt(x, y, w) {
      var sec = sectorAt(G, Math.floor(x), Math.floor(y));
      if (!sec) return;
      for (var q = 0; q < secs.length; q++) {
        if (secs[q].id === sec.id) { out[q] += w; break; }
      }
    }

    // Protest gathering points (weight 40 + expected crowd size)
    try {
      if (typeof MARCHES !== "undefined" && MARCHES && typeof MARCHES.list === "function") {
        var ms = MARCHES.list(G) || [];
        for (i = 0; i < ms.length; i++) {
          var mm = ms[i];
          if (!mm) continue;
          if (mm.start) addAt(mm.start.x, mm.start.y, 40 + (typeof mm.members === "number" ? mm.members : 0));
          if (mm.end) addAt(mm.end.x, mm.end.y, 40 + (typeof mm.members === "number" ? mm.members : 0));
          if (mm.centre) addAt(mm.centre.x, mm.centre.y, 25);
        }
      }
    } catch (e) {}

    try {
      if (typeof LANDMARKS !== "undefined" && LANDMARKS && typeof LANDMARKS.rallyPoints === "function") {
        var pts = LANDMARKS.rallyPoints() || [];
        for (i = 0; i < pts.length; i++) {
          var p = pts[i];
          if (p && typeof p.x === "number" && typeof p.y === "number") {
            addAt(p.x, p.y, 40 + (typeof p.size === "number" ? p.size : (typeof p.crowd === "number" ? p.crowd : 0)));
          }
        }
      }
    } catch (e) {}

    // Crowd goal / plaza (weight 30)
    try {
      var goal = null;
      if (typeof CROWD !== "undefined" && CROWD && CROWD.goal) goal = CROWD.goal;
      else if (typeof Crowd !== "undefined" && Crowd && Crowd.goal) goal = Crowd.goal;
      else if (G && G.crowdGoal) goal = G.crowdGoal;
      else if (G && G.goal) goal = G.goal;
      else if (typeof LANDMARKS !== "undefined" && LANDMARKS && typeof LANDMARKS.plaza === "function") goal = LANDMARKS.plaza();
      if (goal && typeof goal.x === "number" && typeof goal.y === "number") addAt(goal.x, goal.y, 30);
    } catch (e) {}

    // Shops / landmarks the crowd may target
    try {
      var targets = null;
      if (typeof LANDMARKS !== "undefined" && LANDMARKS) {
        if (typeof LANDMARKS.shops === "function") targets = LANDMARKS.shops();
        else if (typeof LANDMARKS.targets === "function") targets = LANDMARKS.targets();
        else if (typeof LANDMARKS.all === "function") targets = LANDMARKS.all();
        else if (LANDMARKS.shops) targets = LANDMARKS.shops;
        else if (LANDMARKS.list) targets = LANDMARKS.list;
      }
      if (!targets && G) targets = G.shops || G.landmarks;
      if (targets && targets.length) {
        for (i = 0; i < targets.length; i++) {
          var t = targets[i];
          if (t && typeof t.x === "number" && typeof t.y === "number") addAt(t.x, t.y, 20);
        }
      }
    } catch (e) {}

    if (!G.agents) return out;
    for (i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (!a || !a.active) continue;
      var sec = sectorAt(G, Math.floor(a.x), Math.floor(a.y));
      if (!sec) continue;
      for (var k = 0; k < secs.length; k++) {
        if (secs[k].id === sec.id) { out[k] += isRioter(a) ? 3 : 1; break; }
      }
    }
    return out;
  }

  function tintColor(t, maxT) {
    var r = maxT > 0 ? t / maxT : 0;
    if (r < 0.34) return "#2a9d4a";
    if (r < 0.67) return "#e0a030";
    return "#c0392b";
  }

  function sectorOfSquad(G, i) {
    if (G && G._squadSector && typeof G._squadSector[i] === "string") return G._squadSector[i];
    var a = getAreaInfo(G, i);
    if (a) {
      var secs = sectors(G);
      for (var k = 0; k < secs.length; k++) {
        var s = secs[k], x0 = s.x0 + 1, y0 = s.y0 + 1, x1 = s.x1 - 1, y1 = s.y1 - 1;
        if (x1 < x0) x1 = x0;
        if (y1 < y0) y1 = y0;
        if (a.x0 === x0 && a.y0 === y0 && a.x1 === x1 && a.y1 === y1) return s.id;
      }
    }
    var ord = getOrder(G, i);
    if (ord === "guard" || ord === "hold") {
      try {
        if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.get === "function") {
          var o = ORDERS.get(G, i), d = mapSize(G);
          if (o && Math.abs(o.postX - d.w / 2) < 4 && Math.abs(o.postY - d.h / 2) < 4) return "R";
        }
      } catch (e) {}
    }
    return null;
  }

  function assignSector(G, i, sec, silent) {
    if (!G || typeof ORDERS === "undefined" || !ORDERS) return;
    if (!G._squadSector) G._squadSector = [];
    if (!sec) {
      var d = mapSize(G);
      var cx = d.w / 2, cy = d.h / 2;
      try {
        if (typeof ORDERS.set === "function") ORDERS.set(G, i, "guard", cx, cy);
        else if (typeof ORDERS.setOrder === "function") ORDERS.setOrder(G, i, "guard");
      } catch (e) {}
      G._squadSector[i] = "R";
      setSelected(i);
      if (!silent) say("Squad " + (i + 1) + " \u2192 RESERVE (map centre)");
      return;
    }
    var x0 = sec.x0 + 1, y0 = sec.y0 + 1, x1 = sec.x1 - 1, y1 = sec.y1 - 1;
    if (x1 < x0) x1 = x0;
    if (y1 < y0) y1 = y0;
    try {
      if (typeof ORDERS.setArea === "function") ORDERS.setArea(G, i, x0, y0, x1, y1);
    } catch (e) {}
    G._squadSector[i] = sec.id;
    setSelected(i);
    if (!silent) say("Squad " + (i + 1) + " \u2192 " + sec.name);
  }

  function autoAssign(G) {
    var n = squadCount(G), secs = sectors(G), th = threatFor(G);
    var fast = [], heavy = [], support = [], foot = [], i;
    for (i = 0; i < n; i++) {
      var lt = getLoadout(G, i);
      if (lt === "car" || lt === "motorbike") fast.push(i);
      else if (lt === "truck" || lt === "van" || lt === "watertruck" || lt === "barriertruck" || lt === "mounted") heavy.push(i);
      else if (lt === "liaison" || lt === "ambulance") support.push(i);
      else foot.push(i);
    }
    for (i = 0; i < fast.length; i++) assignSector(G, fast[i], null, true);

    var busiest = null, bt = -1;
    for (i = 0; i < secs.length; i++) if (th[i] > bt) { bt = th[i]; busiest = secs[i]; }
    for (i = 0; i < support.length; i++) assignSector(G, support[i], busiest, true);

    var order = [];
    for (i = 0; i < secs.length; i++) order.push(i);
    order.sort(function (a, b) { return th[b] - th[a]; });
    var withThreat = [];
    for (i = 0; i < order.length; i++) if (th[order[i]] > 0) withThreat.push(order[i]);

    for (i = 0; i < heavy.length; i++) {
      var target = withThreat.length ? withThreat[i % withThreat.length] : order[0];
      assignSector(G, heavy[i], secs[target], true);
    }

    var counts = {};
    if (G._squadSector) {
      for (i = 0; i < G._squadSector.length; i++) {
        var id = G._squadSector[i];
        if (id && id !== "R") counts[id] = (counts[id] || 0) + 1;
      }
    }
    var pool = withThreat.length ? withThreat : order;
    for (i = 0; i < foot.length; i++) {
      var best = -1, bscore = 1e9;
      for (var p = 0; p < pool.length; p++) {
        var si = pool[p], cnt = counts[secs[si].id] || 0;
        var score = cnt / (th[si] + 0.5);
        if (score < bscore) { bscore = score; best = si; }
      }
      if (best >= 0) {
        assignSector(G, foot[i], secs[best], true);
        counts[secs[best].id] = (counts[secs[best].id] || 0) + 1;
      }
    }
    var assigned = 0;
    if (G._squadSector) {
      for (i = 0; i < G._squadSector.length; i++) if (G._squadSector[i] && G._squadSector[i] !== "R") assigned++;
    }
    say("Auto-assign: " + assigned + " squads to sectors, " + fast.length + " fast in reserve" + (busiest && bt > 0 ? ", liaison/ambulance to " + busiest.name : ""));
  }

  function drawSectors(ctx, G) {
    if (!ctx || typeof Art === "undefined") return;
    var secs = sectors(G), th = threatFor(G), maxT = 0, i;
    for (i = 0; i < th.length; i++) if (th[i] > maxT) maxT = th[i];
    ctx.save();
    for (i = 0; i < secs.length; i++) {
      var s = secs[i];
      var p0 = Art.project(s.x0, s.y0, 0);
      var p1 = Art.project(s.x1 + 1, s.y1 + 1, 0);
      var x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      var w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
      var col = tintColor(th[i], maxT);

      // threat tint 18%
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;

      // dark outline underneath for contrast
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);

      // clear white line 2px, 35% alpha
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.globalAlpha = 1;

      // sector name — readable 14px
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var cx2 = x + w / 2, cy2 = y + h / 2;
      var tw = ctx.measureText(s.name).width;
      ctx.fillRect(cx2 - tw / 2 - 5, cy2 - 10, tw + 10, 20);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s.name, cx2, cy2 + 1);
    }
    ctx.restore();
  }

  function draw(ctx, w, h, G) {
    hit = [];
    rowRects = [];
    if (!ctx) return;
    var scale = k();
    var baseFont = 13;
    if (hidden) { drawHidden(ctx, w, h); return; }

    var panelX = 10, panelY = 34;
    var panelW = 340 * scale;
    var pad = 10 * scale;
    var maxPanelH = (h - 40) - panelY;
    var headH = 26 * scale;
    var footRowH = 22 * scale;
    var footGap = 4 * scale;
    var footerBlockH = footRowH * 2 + footGap;

    ctx.save();
    ctx.font = fontFor(baseFont - 2, scale);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    var sub = "Click a sector cell to patrol it; R = reserve at the centre.";
    var subLines = wrapText(ctx, sub, panelW - pad * 2);
    if (!subLines.length) subLines = [sub];
    var subLineH = (baseFont - 2) * scale + 4 * scale;
    var subBlockH = subLines.length * subLineH;

    var gridCell = 9 * scale;
    var gridGap = 1 * scale;
    var gridW = gridCell * 3 + gridGap * 2;
    var gridH = gridW;
    var rW = 18 * scale;
    var rowH = Math.max(22 * scale, gridH + 8 * scale);
    var count = squadCount(G);

    var contentH = headH + 4 * scale + subBlockH + 4 * scale + count * rowH + 4 * scale + footerBlockH + pad * 2;
    var panelH = Math.min(maxPanelH, Math.max(120 * scale, contentH));
    if (panelH < 120 * scale) panelH = 120 * scale;

    ctx.fillStyle = "rgba(14,18,28,0.9)";
    ctx.strokeStyle = "#3a4a60";
    ctx.lineWidth = 1;
    rr(ctx, panelX, panelY, panelW, panelH, 7 * scale);
    ctx.fill();
    ctx.stroke();

    ctx.font = fontFor(baseFont + 1, scale);
    ctx.textAlign = "left";
    ctx.fillStyle = "#e6e6e6";
    ctx.fillText("SQUAD ORDERS", panelX + pad, panelY + headH / 2 + 1);

    ctx.font = fontFor(11, scale);
    var hideLabel = "hide";
    var hideW = Math.max(34 * scale, ctx.measureText(hideLabel).width + 14 * scale);
    var hideH = 18 * scale;
    var hideX = panelX + panelW - pad - hideW;
    var hideY = panelY + (headH - hideH) / 2;
    ctx.fillStyle = "rgba(58,74,96,0.6)";
    ctx.strokeStyle = "#3a4a60";
    rr(ctx, hideX, hideY, hideW, hideH, 4 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#9aa4b2";
    ctx.textAlign = "center";
    ctx.fillText(hideLabel, hideX + hideW / 2, hideY + hideH / 2 + 1);
    box(hideX, hideY, hideW, hideH, function () { setHidden(true); });

    var y = panelY + headH + 4 * scale;
    ctx.font = fontFor(baseFont - 2, scale);
    ctx.textAlign = "left";
    ctx.fillStyle = "#9aa4b2";
    for (var si = 0; si < subLines.length; si++) {
      ctx.fillText(subLines[si], panelX + pad, y + subLineH / 2 + 1);
      y += subLineH;
    }
    y += 4 * scale;

    var footerTop = panelY + panelH - pad - footerBlockH;
    listTop = y;
    listBottom = footerTop - 4 * scale;
    var totalH = count * rowH;
    maxScroll = Math.max(0, totalH - (listBottom - listTop));
    if (scroll > maxScroll) scroll = maxScroll;
    if (scroll < 0) scroll = 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX + 2, listTop, panelW - 4 - 8 * scale, Math.max(0, listBottom - listTop));
    ctx.clip();

    var selected = getSelected();
    var secs = sectors(G);
    var th = threatFor(G);
    var maxT = 0;
    for (var ti = 0; ti < th.length; ti++) if (th[ti] > maxT) maxT = th[ti];
    var rowYStart = listTop - scroll;

    for (var i = 0; i < count; i++) {
      var ry = rowYStart + i * rowH;
      if (ry + rowH < listTop - 1 || ry > listBottom + 1) continue;
      var rx = panelX + 6 * scale;
      var rw = panelW - 12 * scale - 8 * scale;
      var isSel = (i === selected);
      var chosen = sectorOfSquad(G, i);

      if (isSel) {
        ctx.fillStyle = "rgba(244,211,94,0.10)";
        ctx.fillRect(rx, ry, rw, rowH);
      }

      rowRects.push({ x: rx, y: ry, w: rw, h: rowH });
      (function (idx, rx2, ry2, rw2, rowH2) {
        box(rx2, ry2, rw2, rowH2, function () {
          setSelected(idx);
          say("Squad " + (idx + 1) + " selected");
        });
      })(i, rx, ry, rw, rowH);

      ctx.textAlign = "left";
      ctx.font = fontFor(baseFont - 1, scale);
      var labelX = rx + 6 * scale;
      var label = (i + 1) + ". " + unitName(getLoadout(G, i));
      var labelMaxW = rw - 12 * scale - gridW - 4 * scale - rW - 6 * scale;
      if (labelMaxW < 30 * scale) labelMaxW = 30 * scale;
      if (ctx.measureText(label).width > labelMaxW) {
        var cl = label;
        while (cl.length > 3 && ctx.measureText(cl + "\u2026").width > labelMaxW) cl = cl.substring(0, cl.length - 1);
        label = cl + "\u2026";
      }
      ctx.fillStyle = isSel ? "#f4d35e" : "#e6e6e6";
      ctx.fillText(label, labelX, ry + rowH / 2 + 1);

      var rBtnX = rx + rw - 4 * scale - rW;
      var rBtnY = ry + (rowH - gridH) / 2;
      var rActive = (chosen === "R");
      ctx.fillStyle = rActive ? "#4a7fd0" : "rgba(58,74,96,0.45)";
      ctx.strokeStyle = rActive ? "#4a7fd0" : "#3a4a60";
      rr(ctx, rBtnX, rBtnY, rW, gridH, 3 * scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rActive ? "#0e121c" : "#e6e6e6";
      ctx.textAlign = "center";
      ctx.font = fontFor(baseFont - 5, scale);
      ctx.fillText("R", rBtnX + rW / 2, rBtnY + gridH / 2 + 1);
      (function (idx) {
        box(rBtnX, rBtnY, rW, gridH, function () { assignSector(G, idx, null); });
      })(i);

      var gridX = rBtnX - 4 * scale - gridW;
      var gridY = ry + (rowH - gridH) / 2;
      for (var c = 0; c < 9; c++) {
        var gx = gridX + (c % 3) * (gridCell + gridGap);
        var gy = gridY + Math.floor(c / 3) * (gridCell + gridGap);
        var s = secs[c];
        var activeCell = (chosen === s.id);
        var col = tintColor(th[c], maxT);
        ctx.globalAlpha = activeCell ? 0.8 : 0.4;
        ctx.fillStyle = col;
        ctx.fillRect(gx, gy, gridCell, gridCell);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = activeCell ? "#f4d35e" : "#3a4a60";
        ctx.lineWidth = activeCell ? 2 : 1;
        ctx.strokeRect(gx + 0.5, gy + 0.5, gridCell - 1, gridCell - 1);
        (function (idx, sec) {
          box(gx, gy, gridCell, gridCell, function () { assignSector(G, idx, sec); });
        })(i, s);
      }

      if (isSel) {
        ctx.strokeStyle = "#f4d35e";
        ctx.lineWidth = 1.5;
        rr(ctx, rx + 0.5, ry + 0.5, rw - 1, rowH - 1, 3 * scale);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    ctx.restore();

    if (maxScroll > 0) {
      var sbX = panelX + panelW - 6 * scale;
      var sbW = 3 * scale;
      var trackY = listTop;
      var trackH = listBottom - listTop;
      ctx.fillStyle = "rgba(58,74,96,0.4)";
      rr(ctx, sbX, trackY, sbW, trackH, sbW / 2);
      ctx.fill();
      var thumbH = Math.max(16 * scale, trackH * (trackH / totalH));
      var thumbY = trackY + (scroll / maxScroll) * (trackH - thumbH);
      ctx.fillStyle = "#3a4a60";
      rr(ctx, sbX, thumbY, sbW, thumbH, sbW / 2);
      ctx.fill();
    }

    ctx.font = fontFor(baseFont - 2, scale);
    var row1 = ["All hold", "Vehicles patrol", "All auto"];
    var row2 = ["Split city", "AUTO-ASSIGN"];

    function drawFootRow(labels, fy) {
      var widths = [];
      var totalW = 0;
      for (var f = 0; f < labels.length; f++) {
        var fw = ctx.measureText(labels[f]).width + 14 * scale;
        widths.push(fw);
        totalW += fw;
      }
      var fgap = labels.length > 1 ? Math.max(4 * scale, (panelW - pad * 2 - totalW) / (labels.length - 1)) : 0;
      var fx = panelX + pad;
      for (var g = 0; g < labels.length; g++) {
        drawFootButton(labels[g], fx, fy, widths[g], footRowH);
        fx += widths[g] + fgap;
      }
    }

    function drawFootButton(nm, fx2, fy2, fw2, fh2) {
      ctx.fillStyle = "rgba(58,74,96,0.5)";
      ctx.strokeStyle = "#3a4a60";
      rr(ctx, fx2, fy2, fw2, fh2, 4 * scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e6e6e6";
      ctx.textAlign = "center";
      ctx.fillText(nm, fx2 + fw2 / 2, fy2 + fh2 / 2 + 1);
      box(fx2, fy2, fw2, fh2, function () {
        var n = squadCount(G), i2, lt;
        if (nm === "All hold") {
          for (i2 = 0; i2 < n; i2++) applyOrder(G, i2, "hold");
        } else if (nm === "All auto") {
          for (i2 = 0; i2 < n; i2++) applyOrder(G, i2, "auto");
        } else if (nm === "Vehicles patrol") {
          for (i2 = 0; i2 < n; i2++) {
            lt = getLoadout(G, i2);
            if (lt === "car" || lt === "motorbike" || lt === "van") applyOrder(G, i2, "patrol");
          }
        } else if (nm === "Split city") {
          for (i2 = 0; i2 < n; i2++) {
            if (getOrder(G, i2) === "patrol") {
              try {
                if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.clearArea === "function") ORDERS.clearArea(G, i2);
              } catch (e) {}
            }
          }
          try {
            if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.autoDivide === "function") ORDERS.autoDivide(G);
          } catch (e) {}
          say("City split into patrol areas");
        } else if (nm === "AUTO-ASSIGN") {
          autoAssign(G);
        }
      });
    }

    drawFootRow(row1, footerTop);
    drawFootRow(row2, footerTop + footRowH + footGap);
    ctx.restore();

    lastRect = { x: panelX, y: panelY, w: panelW, h: panelH };
    lastDrawTime = Date.now();
  }

  function rectValid() {
    if (!lastRect) return false;
    if (Date.now() - lastDrawTime > 500) return false;
    return true;
  }

  // ---- click ----
  var lastShift = false;

  function click(x, y, G, shift) {
    lastShift = !!shift;
    if (!rectValid()) return false;
    // must be inside the actual drawn panel rect
    if (!pointIn(lastRect, x, y)) return false;

    // handle hit boxes (hidden tab included)
    for (var i = hit.length - 1; i >= 0; i--) {
      if (pointIn(hit[i], x, y)) {
        try { hit[i].onClick(); } catch (e) {}
        return true;
      }
    }
    // swallow clicks inside panel area even if not on a hitbox
    return true;
  }

  // ---- wheel ----

  function wheel(dy, x, y) {
    if (hidden) return false;
    if (!rectValid()) return false;
    if (!pointIn(lastRect, x, y)) return false;
    if (maxScroll > 0) {
      scroll += dy * 18 * k();
      if (scroll > maxScroll) scroll = maxScroll;
      if (scroll < 0) scroll = 0;
    }
    return true;
  }

  function toggle() {
    setHidden(!hidden);
  }

  function isHidden() {
    return hidden;
  }

  return {
    draw: draw,
    click: click,
    wheel: wheel,
    toggle: toggle,
    isHidden: isHidden,
    sectors: sectors,
    sectorAt: sectorAt,
    drawSectors: drawSectors
  };
})();
