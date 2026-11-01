var HELP = (function () {
  var STORE_KEY = "ppg_help";
  var STATES = ["full", "compact", "hidden"];
  var stateIdx = 0;
  try {
    var sv = window.localStorage.getItem(STORE_KEY);
    if (sv && STATES.indexOf(sv) >= 0) stateIdx = STATES.indexOf(sv);
  } catch (e) {}

  var cache = null; // { sig, lines, layout }
  var rect = null;  // last drawn panel/tab, for clicks

  function state() { return STATES[stateIdx]; }

  function toggle() {
    stateIdx = (stateIdx + 1) % STATES.length;
    try { window.localStorage.setItem(STORE_KEY, STATES[stateIdx]); } catch (e) {}
    cache = null;
    return STATES[stateIdx];
  }

  // --- Content building ---
  function orderMeaning(o) {
    if (o === "hold") return "stays put";
    if (o === "guard") return "protects shops near its post";
    if (o === "patrol") return "walks its route";
    if (o === "push") return "advances to a line";
    if (o === "retreat") return "falls back to rally point";
    if (o === "auto") return "polices its area by itself";
    return "standing order";
  }

  function buildLines(info, compactOnly) {
    var lines = [];
    var pl = info.screen === "planning";

    function sec(title) { lines.push({ type: "section", text: title }); }
    function ln(key, desc, prio) {
      if (compactOnly && prio !== 1) return;
      lines.push({ type: "line", key: key, desc: desc, prio: prio });
    }

    if (info.mode !== null && info.mode !== undefined) {
      lines.push({ type: "mode", text: "Now: click to " + info.mode + "   (Esc cancels)" });
    }

    if (pl) {
      sec("Squad");
      ln("1-0, Tab / click", "select a squad", 1);
      ln("click a street", "place it (not on red)", 1);
      ln("V", "show / hide force panel", 1);
      ln("+ / - (panel)", "how many of each unit", 1);
      ln("O", "standing order", 1);
      ln("Y + clicks", "patrol route", 2);
      ln("Z + click", "trigger zone", 2);
      ln("Shift+Y / Shift+Z", "clear route / zone", 3);
      ln("order: " + info.order, orderMeaning(info.order), 2);
      sec("Map");
      ln("B + click", "place barrier", 2);
      ln("N", "next map", 2);
      ln("wheel / + -", "zoom", 3);
      ln("drag / arrows", "pan", 3);
      ln("H", "low buildings", 3);
      ln("J", "show / hide minimap", 3);
      sec("Go");
      ln("Enter", "START the match", 1);
    } else {
      sec("Squad");
      ln("1-0, Tab / click", "select", 1);
      ln("click street", "move (far: squad drives)", 1);
      ln("click vehicle", "select only the vehicle", 2);
      ln("A + click", "arrest", 1);
      ln("F", "shove crowd back", 1);
      ln("S", "calm / firm stance", 2);
      ln("E", "get in / out of the vehicle", 1);
      ln("U", "vehicle takes arrests to station", 2);
      ln("O", "standing order", 1);
      ln("Y / Z", "patrol route / trigger zone", 3);
      ln("order: " + info.order, orderMeaning(info.order), 2);
      sec("Tools");
      ln("G + click", "tear gas", 2);
      ln("K + click", "kettle (2 squads)", 2);
      ln("X + click", "snatch squad", 2);
      ln("P + click", "police line across a street", 1);
      ln("C + click", "checkpoint: stop and search", 2);
      ln("M (Shift+M exit)", "order the crowd to disperse", 1);
      ln("D + click", "drone", 2);
      ln("right click", "squad's own tool", 2);
      var lo = info.loadout;
      if (lo === "car" || lo === "van" || lo === "truck") ln("hold L / right btn", "loudspeaker (bar drains)", 1);
      else if (lo === "watertruck") ln("hold W / right btn", "water cannon (aim with mouse)", 1);
      else if (lo === "barriertruck") ln("B + click", "drop barrier", 1);
      else if (lo === "liaison") ln("(auto)", "talks people calm, never arrests", 1);
      else if (lo === "mounted") ln("click street", "horses push the crowd", 1);
      else if (lo === "motorbike") ln("(arrests)", "bikes hold suspects, a car picks up", 1);
      ln("R", "call reinforcements", 1);
      sec("All squads");
      ln("Shift+H", "hold", 2);
      ln("Shift+G", "guard", 2);
      ln("Shift+R", "retreat", 2);
      ln("Shift+A", "auto", 1);
      sec("Game");
      ln("Space", "pause", 1);
      ln("T", "speed 1x / 2x", 2);
      ln("Q", "graphics quality (Low = faster)", 2);
      ln("wheel / drag", "zoom / pan", 3);
      ln("Esc", "cancel click mode", 2);
      ln("J", "show / hide minimap", 3);
    }
    return pruneSections(lines);
  }

  // --- Layout measuring ---
  function makeFont(size) { return "bold " + size + "px Consolas, monospace"; }
  function makeFontReg(size) { return size + "px Consolas, monospace"; }

  function measure(ctx, lines, fontSize, padding, lineH) {
    ctx.save();
    var keyW = 0, descW = 0, i, it, w;
    ctx.font = makeFont(fontSize);
    for (i = 0; i < lines.length; i++) {
      it = lines[i];
      if (it.type === "line") {
        w = ctx.measureText(it.key).width;
        if (w > keyW) keyW = w;
      } else if (it.type === "section") {
        w = ctx.measureText(it.text).width;
        if (w > descW) descW = w;
      } else if (it.type === "mode") {
        w = ctx.measureText(it.text).width;
        if (w > descW) descW = w;
      }
    }
    ctx.font = makeFontReg(fontSize);
    for (i = 0; i < lines.length; i++) {
      it = lines[i];
      if (it.type === "line") {
        w = ctx.measureText(it.desc).width;
        if (w > descW) descW = w;
      }
    }
    ctx.restore();
    var keyCol = keyW + fontSize * 0.6; // gap
    var width = padding * 2 + keyCol + descW;
    var height = padding * 2 + (lines.length + 1) * lineH;  // +1 for the header
    return { fontSize: fontSize, padding: padding, lineH: lineH,
             keyCol: keyCol, width: width, height: height,
             keyW: keyW, descW: descW };
  }

  function computeLayout(ctx, lines, info) {
    var lw = info.canvas.width, lh = info.canvas.height;
    // canvas.width may be scaled by DPR in some setups; prefer CONFIG
    if (typeof CONFIG !== "undefined" && CONFIG && CONFIG.tileSize && typeof MAP !== "undefined" && MAP) {
      lw = MAP.width * CONFIG.tileSize;
      lh = MAP.height * CONFIG.tileSize;
    }
    var cssW = parseFloat(info.canvas.style.width);
    var cssScale = (cssW > 0 && isFinite(cssW)) ? cssW / lw : 1;
    if (!(cssScale > 0)) cssScale = 1;

    var targetLogical = 14 / cssScale;
    var minF = 11, maxF = 30;
    var fs = Math.max(minF, Math.min(maxF, targetLogical));
    var maxW = lw * 0.45, maxH = lh * 0.70;

    var workLines = lines;
    var layout = null;
    // Try shrinking, then dropping low priority
    for (var attempt = 0; attempt < 40; attempt++) {
      var padding = fs * 0.7;
      var lineH = fs * 1.35;
      layout = measure(ctx, workLines, fs, padding, lineH);
      layout.lw = lw; layout.lh = lh;
      if (layout.width <= maxW && layout.height <= maxH) break;
      if (fs > minF) {
        fs = Math.max(minF, fs - 1);
      } else {
        // drop lowest priority line
        var dropIdx = -1, worst = 0;
        for (var i = 0; i < workLines.length; i++) {
          var it = workLines[i];
          if (it.type === "line") {
            if (it.prio > worst) { worst = it.prio; dropIdx = i; }
          }
        }
        if (dropIdx < 0) break;
        var nw = workLines.slice(0, dropIdx).concat(workLines.slice(dropIdx + 1));
        // also drop now-empty sections
        workLines = pruneSections(nw);
      }
    }
    return { lines: workLines, layout: layout };
  }

  function pruneSections(lines) {
    var out = [], i, hasContent;
    for (i = 0; i < lines.length; i++) {
      var it = lines[i];
      if (it.type === "section") {
        hasContent = false;
        for (var j = i + 1; j < lines.length; j++) {
          if (lines[j].type === "section") break;
          hasContent = true;
          break;
        }
        if (hasContent) out.push(it);
      } else {
        out.push(it);
      }
    }
    return out;
  }

  function signature(info, st) {
    return [st, info.screen, info.mode, info.loadout, info.order,
            info.canvas.style.width, info.canvas.width, info.canvas.height].join("|");
  }

  function ensureCache(ctx, info) {
    var st = state();
    var sig = signature(info, st);
    if (cache && cache.sig === sig) return cache;
    var lines, layout = null;
    if (st === "hidden") {
      lines = [];
    } else {
      lines = buildLines(info, st === "compact");
      var res = computeLayout(ctx, lines, info);
      lines = res.lines;
      layout = res.layout;
    }
    cache = { sig: sig, lines: lines, layout: layout, state: st };
    return cache;
  }

  // --- Round rect path ---
  function roundRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ctx, info) {
    var c = ensureCache(ctx, info);
    var st = c.state;
    var lw = c.layout ? c.layout.lw : (MAP.width * CONFIG.tileSize);
    var lh = c.layout ? c.layout.lh : (MAP.height * CONFIG.tileSize);

    ctx.save();
    ctx.textBaseline = "alphabetic";

    if (st === "hidden") {
      var lw0 = MAP.width * CONFIG.tileSize, cw0 = parseFloat(info.canvas.style.width);
      var hfs = Math.max(11, Math.min(30, 14 / ((cw0 > 0 && isFinite(cw0)) ? cw0 / lw0 : 1)));
      // size for tab
      ctx.font = makeFont(hfs);
      var tabText = "? controls";
      var tw = ctx.measureText(tabText).width;
      var pad = hfs * 0.5;
      var bw = tw + pad * 2, bh = hfs * 1.5;
      var bx = lw - 8 - bw, by = 30;
      roundRect(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = "rgba(8,10,16,0.78)";
      ctx.fill();
      ctx.strokeStyle = "#3a4a60";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#ffd866";
      ctx.font = makeFont(hfs);
      ctx.textAlign = "left";
      ctx.fillText(tabText, bx + pad, by + bh / 2 + hfs * 0.35);
      rect = { x: bx, y: by, w: bw, h: bh };
      ctx.restore();
      return;
    }

    var L = c.layout;
    var fs = L.fontSize, padding = L.padding, lineH = L.lineH;
    var pw = L.width, ph = L.height;
    var px = lw - 8 - pw, py = 30;

    rect = { x: px, y: py, w: pw, h: lineH + padding * 2 };  // header row toggles
    roundRect(ctx, px, py, pw, ph, 6);
    ctx.fillStyle = "rgba(8,10,16,0.78)";
    ctx.fill();
    ctx.strokeStyle = "#3a4a60";
    ctx.lineWidth = 1;
    ctx.stroke();

    var cx = px + padding;
    var cy = py + padding + fs;

    // header
    ctx.font = makeFont(fs);
    ctx.fillStyle = "#9fe0a0";
    ctx.textAlign = "left";
    ctx.fillText("CONTROLS", cx, cy);
    var cw = ctx.measureText("CONTROLS").width;
    ctx.fillStyle = "#e3e8f0";
    ctx.fillText("   (? hide)", cx + cw, cy);
    cy += lineH;

    var keyRight = cx + L.keyCol - fs * 0.3;
    var descX = cx + L.keyCol;

    for (var i = 0; i < c.lines.length; i++) {
      var it = c.lines[i];
      if (it.type === "mode") {
        var mh = lineH;
        ctx.fillStyle = "rgba(232,89,12,0.35)";
        ctx.fillRect(px + 2, cy - fs * 1.05, pw - 4, mh);
        ctx.font = makeFont(fs);
        ctx.fillStyle = "#ffd866";
        ctx.textAlign = "left";
        ctx.fillText(it.text, cx, cy);
      } else if (it.type === "section") {
        ctx.font = makeFont(fs);
        ctx.fillStyle = "#9fe0a0";
        ctx.textAlign = "left";
        ctx.fillText(it.text, cx, cy);
      } else if (it.type === "line") {
        ctx.font = makeFont(fs);
        ctx.fillStyle = "#ffd866";
        ctx.textAlign = "right";
        ctx.fillText(it.key, keyRight, cy);
        ctx.font = makeFontReg(fs);
        ctx.fillStyle = "#e3e8f0";
        ctx.textAlign = "left";
        ctx.fillText(it.desc, descX, cy);
      }
      cy += lineH;
    }

    ctx.restore();
  }

  /* true when logical point (x, y) is on the tab or the panel header */
  function hit(x, y) {
    return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  return { draw: draw, toggle: toggle, state: state, hit: hit };
})();

if (typeof module !== "undefined" && module.exports) module.exports = HELP;
