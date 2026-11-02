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
    ambulance: "Ambulance"
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

  function draw(ctx, w, h, G) {
    hit = [];
    rowRects = [];
    if (!ctx) return;
    var scale = k();
    var baseFont = 13;

    if (hidden) {
      drawHidden(ctx, w, h);
      return;
    }

    var panelX = 10;
    var panelY = 34;
    var panelW = 330 * scale;
    var pad = 10 * scale;
    var maxPanelH = (h - 40) - panelY;

    // Pre-measure header/footer/subtitle so we can compute natural height
    var headH = 26 * scale;
    var footerH = 24 * scale;

    ctx.save();
    ctx.font = fontFor(baseFont - 2, scale);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    var sub = "Bikes and sedans patrol their own area. 'area' = draw it.";
    var maxSubW = panelW - pad * 2;
    var subLines = wrapText(ctx, sub, maxSubW);
    if (subLines.length === 0) subLines = [sub];
    var subLineH = (baseFont - 2) * scale + 4 * scale;
    var subBlockH = subLines.length * subLineH;

    // Row height (matches row rendering below)
    var rowH = Math.max(20 * scale, baseFont * scale * 2);

    var count = squadCount(G);

    // Footer: two rows of buttons
    var footRowH = 22 * scale;
    var footGap = 4 * scale;
    var footerBlockH = footRowH * 2 + footGap;

    // Natural panel height: header + subtitle block + rows + footer + padding
    var contentH = headH + 4 * scale + subBlockH + 4 * scale + (count * rowH) + 4 * scale + footerBlockH + pad * 2;
    var panelH = Math.min(maxPanelH, Math.max(120 * scale, contentH));
    if (panelH < 120 * scale) panelH = 120 * scale;

    // panel background
    ctx.fillStyle = "rgba(14,18,28,0.9)";
    ctx.strokeStyle = "#3a4a60";
    ctx.lineWidth = 1;
    rr(ctx, panelX, panelY, panelW, panelH, 7 * scale);
    ctx.fill();
    ctx.stroke();

    // header
    ctx.font = fontFor(baseFont + 1, scale);
    ctx.textAlign = "left";
    ctx.fillStyle = "#e6e6e6";
    var headText = "SQUAD ORDERS";
    ctx.fillText(headText, panelX + pad, panelY + headH / 2 + 1);

    // hide button
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

    // subtitle line(s)
    ctx.font = fontFor(baseFont - 2, scale);
    ctx.textAlign = "left";
    ctx.fillStyle = "#9aa4b2";
    for (var si = 0; si < subLines.length; si++) {
      ctx.fillText(subLines[si], panelX + pad, y + (subLineH / 2) + 1);
      y += subLineH;
    }
    y += 4 * scale;

    // footer block sits at bottom
    var footerTop = panelY + panelH - pad - footerBlockH;

    // row area
    listTop = y;
    listBottom = footerTop - 4 * scale;

    var totalH = count * rowH;
    maxScroll = Math.max(0, totalH - (listBottom - listTop));
    if (scroll > maxScroll) scroll = maxScroll;
    if (scroll < 0) scroll = 0;

    // clip rows
    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX + 2, listTop, panelW - 4 - 8 * scale, Math.max(0, listBottom - listTop));
    ctx.clip();

    var selected = getSelected();
    var rowYStart = listTop - scroll;

    ctx.font = fontFor(baseFont - 1, scale);

    for (var i = 0; i < count; i++) {
      var ry = rowYStart + i * rowH;
      if (ry + rowH < listTop - 1 || ry > listBottom + 1) continue;

      var rx = panelX + 6 * scale;
      var rw = panelW - 12 * scale - 8 * scale;
      var isSel = (i === selected);
      var ord = getOrder(G, i);
      var lt = getLoadout(G, i);

      // row background
      if (isSel) {
        ctx.fillStyle = "rgba(244,211,94,0.10)";
        ctx.fillRect(rx, ry, rw, rowH);
      }

      // squad label
      ctx.textAlign = "left";
      var labelX = rx + 6 * scale;
      var label = (i + 1) + ". " + unitName(lt);
      ctx.fillStyle = isSel ? "#f4d35e" : "#e6e6e6";
      // reserve space: 4 order buttons (24 each) + 3 gaps + area/route button (40) + gap + area label (~34)
      var areaLabelW = 36 * scale;
      var actionW = 42 * scale;
      var labelMaxW = rw - 6 * scale - 4 * scale - (4 * 26 + 4) * scale - actionW - areaLabelW - 6 * scale;
      if (labelMaxW < 30 * scale) labelMaxW = 30 * scale;
      var lw = ctx.measureText(label).width;
      if (lw > labelMaxW) {
        var cl = label;
        while (cl.length > 3 && ctx.measureText(cl + "\u2026").width > labelMaxW) {
          cl = cl.substring(0, cl.length - 1);
        }
        label = cl + "\u2026";
      }
      ctx.fillText(label, labelX, ry + rowH / 2 + 1);

      // order buttons from right
      var btnH = Math.min(rowH - 6 * scale, 20 * scale);
      var btnW = 24 * scale;
      var gap = 3 * scale;
      var right = rx + rw - 4 * scale;
      var showArea = (ord === "patrol");
      var buttonsW = 4 * btnW + 3 * gap + (showArea ? actionW + gap + areaLabelW + gap : 0);
      var bx = right - buttonsW;
      var by = ry + (rowH - btnH) / 2;

      // area/route button (drawn first so order buttons align after)
      if (showArea) {
        var abx = right - actionW - areaLabelW - gap;
        var actionLabel = "area";
        ctx.font = fontFor(baseFont - 4, scale);
        ctx.fillStyle = "rgba(42,157,143,0.25)";
        ctx.strokeStyle = "#2a9d8f";
        rr(ctx, abx, by, actionW, btnH, 3 * scale);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e6e6e6";
        ctx.textAlign = "center";
        ctx.fillText(actionLabel, abx + actionW / 2, by + btnH / 2 + 1);

        // area size label to the right of button
        var albl = areaLabel(G, i);
        var albx = right - areaLabelW;
        ctx.font = fontFor(baseFont - 5, scale);
        ctx.fillStyle = "#7d8797";
        ctx.textAlign = "center";
        ctx.fillText(albl, albx + areaLabelW / 2, by + btnH / 2 + 1);
        ctx.font = fontFor(baseFont - 1, scale);

        (function (idx) {
          box(abx, by, actionW, btnH, function () {
            var shift = false;
            try {
              if (typeof UI !== "undefined" && UI && UI._shiftDown) shift = true;
            } catch (e) {}
            // click() forwards shift via lastShift; also honor UI._shiftDown
            shift = lastShift;
            if (shift) {
              try {
                if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.clearWaypoints === "function") {
                  ORDERS.clearWaypoints(G, idx);
                }
              } catch (e) {}
              setSelected(idx);
              try { if (typeof UI !== "undefined" && UI) UI.mode = "waypoint"; } catch (e) {}
              say("Click 2-6 patrol points for squad " + (idx + 1) + ", Esc when done");
            } else {
              setSelected(idx);
              try {
                if (typeof UI !== "undefined" && UI) {
                  UI.mode = "patrolArea";
                  UI._areaA = null;
                }
              } catch (e) {}
              say("Squad " + (idx + 1) + ": click two opposite corners of its patrol area (Esc cancels)");
            }
          });
        })(i);
      }

      for (var b = 0; b < ORDERS_LIST.length; b++) {
        var name = ORDERS_LIST[b];
        var bxx = bx + b * (btnW + gap);
        var active = (ord === name);
        ctx.fillStyle = active ? ORDER_COL[name] : "rgba(58,74,96,0.45)";
        ctx.strokeStyle = active ? ORDER_COL[name] : "#3a4a60";
        rr(ctx, bxx, by, btnW, btnH, 3 * scale);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = active ? "#0e121c" : "#e6e6e6";
        ctx.textAlign = "center";
        ctx.fillText(ORDER_SHORT[name], bxx + btnW / 2, by + btnH / 2 + 1);
        (function (idx, nm) {
          box(bxx, by, btnW, btnH, function () {
            applyOrder(G, idx, nm);
            setSelected(idx);
            say("Squad " + (idx + 1) + " selected");
          });
        })(i, name);
      }

      // selection border
      if (isSel) {
        ctx.strokeStyle = "#f4d35e";
        ctx.lineWidth = 1.5;
        rr(ctx, rx + 0.5, ry + 0.5, rw - 1, rowH - 1, 3 * scale);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      rowRects.push({ x: rx, y: ry, w: rw, h: rowH });
      (function (idx, rx2, ry2, rw2, rowH2) {
        box(rx2, ry2, rw2, rowH2, function () {
          setSelected(idx);
          say("Squad " + (idx + 1) + " selected");
        });
      })(i, rx, ry, rw, rowH);
    }
    ctx.restore();

    // scrollbar
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

    // footer buttons: two rows
    ctx.font = fontFor(baseFont - 2, scale);
    var row1 = ["All hold", "Vehicles patrol", "All auto"];
    var row2 = ["Split city"];

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
        var n = squadCount(G);
        if (nm === "All hold") {
          for (var i2 = 0; i2 < n; i2++) applyOrder(G, i2, "hold");
        } else if (nm === "All auto") {
          for (var i3 = 0; i3 < n; i3++) applyOrder(G, i3, "auto");
        } else if (nm === "Vehicles patrol") {
          for (var i4 = 0; i4 < n; i4++) {
            var lt = getLoadout(G, i4);
            if (lt === "car" || lt === "motorbike" || lt === "van") applyOrder(G, i4, "patrol");
          }
        } else if (nm === "Split city") {
          for (var i5 = 0; i5 < n; i5++) {
            if (getOrder(G, i5) === "patrol") {
              try {
                if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.clearArea === "function") {
                  ORDERS.clearArea(G, i5);
                }
              } catch (e) {}
            }
          }
          try {
            if (typeof ORDERS !== "undefined" && ORDERS && typeof ORDERS.autoDivide === "function") {
              ORDERS.autoDivide(G);
            }
          } catch (e) {}
          say("City split into patrol areas");
        }
      });
    }

    drawFootRow(row1, footerTop);
    drawFootRow(row2, footerTop + footRowH + footGap);

    ctx.restore();

    // record rect for click/wheel
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
    isHidden: isHidden
  };
})();
