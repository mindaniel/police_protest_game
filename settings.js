var SETTINGS = (function () {
  "use strict";

  var FONT = "Consolas, monospace";
  var TITLE_COL = "#9fe0a0";
  var TEXT_COL = "#e6e6e6";
  var DIM_COL = "#9aa4b2";
  var BTN_COL = "#2a3a55";
  var ACCENT_COL = "#2a9d8f";
  var BORDER_COL = "#3a4a60";
  var PANEL_COL = "rgba(14,18,28,0.97)";
  var ROW_HL = "rgba(58,74,96,0.55)";
  var KEY_COL = "#f4d35e";
  var WARN_COL = "#e8a24a";

  var _open = false;
  var _tab = "settings";
  var _sel = 0;
  var _guideScroll = 0;
  var _restartFlag = false;
  var _mapChanged = false;
  var _diffChanged = false;

  // saved prefs
  var _savedDriving = null;
  var _savedNight = null;
  try {
    var d = localStorage.getItem("ppg_driving");
    if (d === "on" || d === "off") _savedDriving = d;
    var n = localStorage.getItem("ppg_night");
    if (n === "on" || n === "off") _savedNight = n;
  } catch (e) { /* ignore */ }

  // layout cache for hit testing
  var _layout = null;
  var _guideMetrics = null;

  function has(g) { return typeof g !== "undefined" && g !== null; }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function rows() {
    var out = [];
    if (has(CityGen) && typeof CityGen.currentMap === "function") {
      out.push({
        id: "map",
        label: "Map",
        value: function () { return CityGen.currentMap().name; },
        change: function (dir) {
          if (typeof CityGen.nextMap === "function") {
            CityGen.nextMap(dir);
            _mapChanged = true;
            _restartFlag = true;
          }
        },
        hint: "Real neighbourhoods from OpenStreetMap"
      });
    }
    if (has(LEVELS) && typeof LEVELS.current === "function") {
      out.push({
        id: "diff",
        label: "Difficulty",
        value: function () { return LEVELS.current().name; },
        change: function (dir) {
          if (dir > 0 && typeof LEVELS.next === "function") LEVELS.next();
          else if (dir < 0 && typeof LEVELS.prev === "function") LEVELS.prev();
          _diffChanged = true;
          _restartFlag = true;
        },
        hint: function () { return (LEVELS.current() && LEVELS.current().blurb) || ""; }
      });
    }
    if (has(QUALITY) && typeof QUALITY.label === "function") {
      out.push({
        id: "quality",
        label: "Graphics quality",
        value: function () { return String(QUALITY.label()).replace(/^Graphics:\s*/, ""); },
        change: function () { if (typeof QUALITY.cycle === "function") QUALITY.cycle(); },
        hint: "Lower it if the game is slow"
      });
    }
    if (has(MINIMAP) && typeof MINIMAP.isHidden === "function") {
      out.push({
        id: "minimap",
        label: "Minimap",
        value: function () { return MINIMAP.isHidden() ? "Hidden" : "Shown"; },
        change: function () { if (typeof MINIMAP.toggle === "function") MINIMAP.toggle(); },
        hint: "Round radar when zoomed in (J)"
      });
    }
    if (has(HELP) && typeof HELP.state === "function") {
      out.push({
        id: "help",
        label: "Controls panel",
        value: function () { return cap(HELP.state()); },
        change: function () { if (typeof HELP.toggle === "function") HELP.toggle(); },
        hint: "Key list in the corner (? or F1)"
      });
    }
    if (has(CONFIG)) {
      out.push({
        id: "driving",
        label: "Realistic driving",
        value: function () { return CONFIG.realisticDriving !== false ? "On" : "Off"; },
        change: function () {
          CONFIG.realisticDriving = (CONFIG.realisticDriving === false);
          _savedDriving = CONFIG.realisticDriving ? "on" : "off";
          try { localStorage.setItem("ppg_driving", _savedDriving); } catch (e) { /* ignore */ }
        },
        hint: "Vehicles steer like cars"
      });
      out.push({
        id: "night",
        label: "Day / night",
        value: function () { return CONFIG.nightCycle !== false ? "Dusk falls" : "Always day"; },
        change: function () {
          CONFIG.nightCycle = (CONFIG.nightCycle === false);
          _savedNight = CONFIG.nightCycle ? "on" : "off";
          try { localStorage.setItem("ppg_night", _savedNight); } catch (e) { /* ignore */ }
        },
        hint: "Applies from the next match"
      });
    }
    return out;
  }

  // ---------------- guide content ----------------
  var GUIDE = [
    { t: "h", s: "THE GOAL" },
    { t: "p", s: "You command the police at a protest in a real city. Keep the peace: protect shops from looters, arrest rioters, and keep the crowd calm. Heavy-handed policing angers the crowd. The match ends when the timer runs out; you get a debrief and a grade." },
    { t: "h", s: "BEFORE THE MATCH (PLANNING)" },
    { t: "p", s: "Time is frozen. Pick your force in the force panel (V) with + and - per unit within the budget. Place squads on streets, set standing orders, place barriers, then press Enter to start." },

    { t: "h", s: "PLANNING KEYS" },
    { t: "s", s: "Squad" },
    { t: "k", k: "1-0, Tab / click", d: "select a squad" },
    { t: "k", k: "click a street", d: "place it (not on red)" },
    { t: "k", k: "V", d: "show / hide force panel" },
    { t: "k", k: "+ / - (panel)", d: "how many of each unit" },
    { t: "k", k: "O", d: "standing order" },
    { t: "k", k: "Y + clicks", d: "patrol route" },
    { t: "k", k: "Z + click", d: "trigger zone" },
    { t: "k", k: "Shift+Y / Shift+Z", d: "clear route / zone" },
    { t: "k", k: "order", d: "change order with O" },
    { t: "s", s: "Map" },
    { t: "k", k: "B + click", d: "place barrier" },
    { t: "k", k: "N", d: "next map" },
    { t: "k", k: "wheel / + -", d: "zoom" },
    { t: "k", k: "drag / arrows", d: "pan" },
    { t: "k", k: "H", d: "low buildings" },
    { t: "k", k: "J", d: "show / hide minimap" },
    { t: "s", s: "Go" },
    { t: "k", k: "Enter", d: "START the match" },

    { t: "h", s: "MATCH KEYS" },
    { t: "s", s: "Squad" },
    { t: "k", k: "1-0, Tab / click", d: "select" },
    { t: "k", k: "click street", d: "move (far: squad drives)" },
    { t: "k", k: "click vehicle", d: "select only the vehicle" },
    { t: "k", k: "A + click", d: "arrest" },
    { t: "k", k: "F", d: "shove crowd back" },
    { t: "k", k: "S", d: "calm / firm stance" },
    { t: "k", k: "E", d: "get in / out of the vehicle" },
    { t: "k", k: "U", d: "vehicle takes arrests to station" },
    { t: "k", k: "O", d: "standing order" },
    { t: "k", k: "Y / Z", d: "patrol route / trigger zone" },
    { t: "k", k: "order", d: "change order with O" },
    { t: "s", s: "Tools" },
    { t: "k", k: "G + click", d: "tear gas" },
    { t: "k", k: "K + click", d: "kettle (2 squads)" },
    { t: "k", k: "X + click", d: "snatch squad" },
    { t: "k", k: "P + click", d: "police line across a street" },
    { t: "k", k: "C + click", d: "checkpoint: stop and search" },
    { t: "k", k: "M (Shift+M exit)", d: "order the crowd to disperse" },
    { t: "k", k: "D + click", d: "drone" },
    { t: "k", k: "right click", d: "squad's own tool" },
    { t: "k", k: "hold L / right btn", d: "loudspeaker (bar drains)" },
    { t: "k", k: "hold W / right btn", d: "water cannon (aim with mouse)" },
    { t: "k", k: "B + click", d: "drop barrier" },
    { t: "k", k: "(auto)", d: "talks people calm, never arrests" },
    { t: "k", k: "click street", d: "horses push the crowd" },
    { t: "k", k: "(arrests)", d: "bikes hold suspects, a car picks up" },
    { t: "k", k: "R", d: "call reinforcements" },
    { t: "s", s: "All squads" },
    { t: "k", k: "Shift+H", d: "hold" },
    { t: "k", k: "Shift+G", d: "guard" },
    { t: "k", k: "Shift+R", d: "retreat" },
    { t: "k", k: "Shift+A", d: "auto" },
    { t: "s", s: "Game" },
    { t: "k", k: "Space", d: "pause" },
    { t: "k", k: "T", d: "speed 1x / 2x" },
    { t: "k", k: "Q", d: "graphics quality (Low = faster)" },
    { t: "k", k: "wheel / drag", d: "zoom / pan" },
    { t: "k", k: "Esc", d: "cancel click mode" },
    { t: "k", k: "J", d: "show / hide minimap" },

    { t: "h", s: "UNITS" },
    { t: "p", s: "Foot squad: riot officers, can arrest and shove." },
    { t: "p", s: "Police van / truck: carries a squad, drives far quickly; E to get in/out." },
    { t: "p", s: "Motorbike: fast scouts." },
    { t: "p", s: "Mounted police: horses push crowds." },
    { t: "p", s: "Water cannon: armoured vehicle, sprays the crowd." },
    { t: "p", s: "Liaison officers: talk to the crowd, calm it." },

    { t: "h", s: "TIPS" },
    { t: "p", s: "1. Guard shop streets early, before looting starts." },
    { t: "p", s: "2. Keep a reserve squad free to react." },
    { t: "p", s: "3. Use the calm stance near peaceful crowds; firm only when needed." },
    { t: "p", s: "4. Use vans for long moves across the city." },
    { t: "p", s: "5. Watch the minimap arrows for shops being looted." },
    { t: "p", s: "6. Do not surround a peaceful march; it angers the crowd." },
    { t: "p", s: "7. Arrest ringleaders, not the whole crowd." },
    { t: "p", s: "8. Place barriers on side streets to funnel the crowd." },

    { t: "h", s: "GLOBAL KEYS" },
    { t: "k", k: "Esc", d: "menu" },
    { t: "k", k: "? or F1", d: "controls panel" },
    { t: "k", k: "J", d: "minimap" },
    { t: "k", k: "Q", d: "graphics quality" },
    { t: "k", k: "Space", d: "pause" },
    { t: "k", k: "T", d: "speed" },
    { t: "k", k: "wheel", d: "zoom" },
    { t: "k", k: "drag", d: "pan" }
  ];

  function guideContentWidth(w) {
    return w - 60; // padding
  }

  function wrapText(ctx, text, maxW) {
    var words = text.split(/\s+/);
    var lines = [];
    var cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // builds a flat list of drawable lines with heights
  function buildGuideLines(ctx, innerW) {
    var out = [];
    var colW = innerW - 240 - 20;
    for (var i = 0; i < GUIDE.length; i++) {
      var it = GUIDE[i];
      if (it.t === "h") {
        out.push({ type: "h", text: it.s, h: 34, topGap: out.length ? 14 : 0 });
      } else if (it.t === "s") {
        out.push({ type: "s", text: it.s, h: 26, topGap: 8 });
      } else if (it.t === "k") {
        out.push({ type: "k", key: it.k, desc: it.d, h: 24, topGap: 0 });
      } else if (it.t === "p") {
        ctx.font = "15px " + FONT;
        var wrapped = wrapText(ctx, it.s, colW + 220);
        for (var j = 0; j < wrapped.length; j++) {
          out.push({ type: "p", text: wrapped[j], h: 22, topGap: j === 0 ? 6 : 0 });
        }
      }
    }
    return out;
  }

  // ---------------- drawing ----------------
  function draw(ctx, w, h) {
    if (!_open) return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, 0, w, h);

    var pw = Math.min(900, w - 40);
    var ph = h - 80;
    var px = (w - pw) / 2;
    var py = (h - ph) / 2;
    var pad = 24;

    // panel
    ctx.fillStyle = PANEL_COL;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = BORDER_COL;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    // title
    ctx.font = "bold 30px " + FONT;
    ctx.fillStyle = TITLE_COL;
    ctx.fillText("SETTINGS", px + pad, py + 42);

    // tabs
    var tabY = py + 74;
    var tabH = 38;
    var tabW = 150;
    var tab1 = { x: px + pad, y: tabY, w: tabW, h: tabH };
    var tab2 = { x: px + pad + tabW + 10, y: tabY, w: tabW, h: tabH };
    drawTab(ctx, tab1, "Settings", _tab === "settings");
    drawTab(ctx, tab2, "Guide", _tab === "guide");

    // close button bottom
    var btnW = 160, btnH = 40;
    var closeBtn = { x: px + pw - pad - btnW, y: py + ph - pad - btnH, w: btnW, h: btnH };
    drawButton(ctx, closeBtn, "Close (Esc)", false);

    var contentX = px + pad;
    var contentY = tabY + tabH + 18;
    var contentW = pw - pad * 2;
    var contentH = closeBtn.y - contentY - 14;

    _layout = {
      w: w, h: h, px: px, py: py, pw: pw, ph: ph,
      tab1: tab1, tab2: tab2, closeBtn: closeBtn,
      contentX: contentX, contentY: contentY, contentW: contentW, contentH: contentH,
      rows: [], guideArrows: null
    };

    if (_tab === "settings") drawSettings(ctx, contentX, contentY, contentW, contentH);
    else drawGuide(ctx, contentX, contentY, contentW, contentH);

    ctx.restore();
  }

  function drawTab(ctx, r, label, active) {
    ctx.fillStyle = active ? ACCENT_COL : BTN_COL;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active ? "#4fd0be" : BORDER_COL;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = active ? "#081018" : TEXT_COL;
    ctx.font = "bold 17px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = "left";
  }

  function drawButton(ctx, r, label, hot) {
    ctx.fillStyle = hot ? "#3a5070" : BTN_COL;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = BORDER_COL;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = TEXT_COL;
    ctx.font = "16px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = "left";
  }

  function drawSettings(ctx, x, y, w, h) {
    var list = rows();
    var rowH = 62;
    var yy = y;
    if (_sel >= list.length) _sel = Math.max(0, list.length - 1);
    if (_sel < 0) _sel = 0;

    for (var i = 0; i < list.length; i++) {
      if (yy + rowH > y + h) break;
      var r = list[i];
      var hl = (i === _sel);
      if (hl) {
        ctx.fillStyle = ROW_HL;
        ctx.fillRect(x, yy, w, rowH - 6);
      }

      // label
      ctx.font = "bold 18px " + FONT;
      ctx.fillStyle = TEXT_COL;
      ctx.textAlign = "left";
      ctx.fillText(r.label, x + 14, yy + 20);

      // value with arrows
      var valW = 60;
      var valText = "";
      try { valText = String(r.value()); } catch (e) { valText = "?"; }
      var arrowL = { x: x + w - 430, y: yy + 8, w: 34, h: 26 };
      var arrowR = { x: x + w - 46, y: yy + 8, w: 34, h: 26 };
      drawArrow(ctx, arrowL, "<");
      drawArrow(ctx, arrowR, ">");
      ctx.textAlign = "center";
      ctx.fillStyle = ACCENT_COL;
      ctx.font = "bold 18px " + FONT;
      var room = arrowR.x - arrowL.x - arrowL.w - 12, tw = ctx.measureText(valText).width;
      if (tw > room) ctx.font = "bold " + Math.max(10, Math.floor(18 * room / tw)) + "px " + FONT;   /* long map names shrink to fit */
      ctx.fillText(valText, (arrowL.x + arrowL.w + arrowR.x) / 2, yy + 21);
      ctx.textAlign = "left";

      // hint
      var hint = "";
      try { hint = (typeof r.hint === "function") ? r.hint() : r.hint; } catch (e) { hint = ""; }
      if (hint) {
        ctx.font = "14px " + FONT;
        ctx.fillStyle = DIM_COL;
        ctx.fillText(hint, x + 14, yy + 44);
      }

      _layout.rows.push({ row: r, x: x, y: yy, w: w, h: rowH, arrowL: arrowL, arrowR: arrowR });
      yy += rowH;
    }

    if (_mapChanged || _diffChanged) {
      ctx.font = "bold 15px " + FONT;
      ctx.fillStyle = WARN_COL;
      ctx.fillText("Map / difficulty changes start a fresh city.", x + 14, yy + 14);
    }
  }

  function drawArrow(ctx, r, label) {
    ctx.fillStyle = "#1f2c40";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = BORDER_COL;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = TEXT_COL;
    ctx.font = "bold 18px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = "left";
  }

  function drawGuide(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    if (!_guideMetrics) {
      _guideMetrics = { lines: buildGuideLines(ctx, w), totalH: 0 };
      var total = 0;
      for (var i = 0; i < _guideMetrics.lines.length; i++) total += _guideMetrics.lines[i].topGap + _guideMetrics.lines[i].h;
      _guideMetrics.totalH = total;
    }
    var lines = _guideMetrics.lines;
    var maxScroll = Math.max(0, _guideMetrics.totalH - h);
    if (_guideScroll > maxScroll) _guideScroll = maxScroll;
    if (_guideScroll < 0) _guideScroll = 0;

    var yy = y - _guideScroll;
    var colW = w - 240 - 20;
    for (var j = 0; j < lines.length; j++) {
      var L = lines[j];
      yy += L.topGap;
      if (yy + L.h >= y && yy <= y + h) {
        if (L.type === "h") {
          ctx.font = "bold 22px " + FONT;
          ctx.fillStyle = TITLE_COL;
          ctx.fillText(L.text, x, yy + L.h / 2);
          ctx.strokeStyle = "rgba(159,224,160,0.3)";
          ctx.beginPath();
          ctx.moveTo(x, yy + L.h - 4);
          ctx.lineTo(x + w - 20, yy + L.h - 4);
          ctx.stroke();
        } else if (L.type === "s") {
          ctx.font = "bold 18px " + FONT;
          ctx.fillStyle = ACCENT_COL;
          ctx.fillText(L.text, x, yy + L.h / 2);
        } else if (L.type === "k") {
          ctx.font = "bold 16px " + FONT;
          ctx.fillStyle = KEY_COL;
          ctx.fillText(L.key, x, yy + L.h / 2);
          ctx.font = "16px " + FONT;
          ctx.fillStyle = TEXT_COL;
          ctx.fillText(L.desc, x + 240, yy + L.h / 2);
        } else if (L.type === "p") {
          ctx.font = "15px " + FONT;
          ctx.fillStyle = TEXT_COL;
          ctx.fillText(L.text, x, yy + L.h / 2);
        }
      }
      yy += L.h;
    }
    ctx.restore();

    // scrollbar
    if (maxScroll > 0) {
      var sbW = 8;
      var sbX = x + w - sbW - 2;
      ctx.fillStyle = "rgba(58,74,96,0.5)";
      ctx.fillRect(sbX, y, sbW, h);
      var ratio = h / _guideMetrics.totalH;
      var thumbH = Math.max(30, h * ratio);
      var thumbY = y + (_guideScroll / maxScroll) * (h - thumbH);
      ctx.fillStyle = "#5a7a9a";
      ctx.fillRect(sbX, thumbY, sbW, thumbH);
    }
    _layout.guideScrollH = h;
    _layout.guideMaxScroll = maxScroll;
  }

  // ---------------- api ----------------
  function open(tab) {
    _open = true;
    _tab = (tab === "guide") ? "guide" : "settings";
    _sel = 0;
    _guideScroll = 0;
    _guideMetrics = null;
    _layout = null;
  }

  function close() {
    _open = false;
    _layout = null;
  }

  function isOpen() { return _open; }

  function click(px, py) {
    if (!_open) return false;
    if (!_layout) return true;

    // tabs
    if (hit(_layout.tab1, px, py)) { _tab = "settings"; _sel = 0; return true; }
    if (hit(_layout.tab2, px, py)) { _tab = "guide"; _guideMetrics = null; return true; }
    if (hit(_layout.closeBtn, px, py)) { close(); return true; }

    if (_tab === "settings") {
      var list = rows();
      for (var i = 0; i < _layout.rows.length; i++) {
        var R = _layout.rows[i];
        if (px >= R.x && px <= R.x + R.w && py >= R.y && py <= R.y + R.h) {
          _sel = i;
          var row = R.row;
          if (hit(R.arrowL, px, py)) { row.change(-1); return true; }
          if (hit(R.arrowR, px, py)) { row.change(1); return true; }
          // click value area to cycle forward
          if (px > R.arrowL.x + R.arrowL.w && px < R.arrowR.x) {
            row.change(1);
            return true;
          }
          return true;
        }
      }
    } else {
      // guide: click scrollbar
      if (_layout.guideMaxScroll > 0) {
        var sbX = _layout.contentX + _layout.contentW - 10;
        if (px >= sbX - 4 && px <= _layout.contentX + _layout.contentW) {
          var rel = (py - _layout.contentY) / _layout.contentH;
          _guideScroll = Math.max(0, Math.min(_layout.guideMaxScroll, rel * _layout.guideMaxScroll));
          return true;
        }
      }
    }
    return true;
  }

  function hit(r, x, y) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function key(k) {
    if (!_open) return false;

    if (k === "Escape") { close(); return true; }
    if (k === "Tab" || k === "g" || k === "G") {
      _tab = (_tab === "settings") ? "guide" : "settings";
      _guideMetrics = null;
      _sel = 0;
      return true;
    }

    if (_tab === "settings") {
      var list = rows();
      if (list.length === 0) return true;
      if (k === "ArrowUp") { _sel = (_sel - 1 + list.length) % list.length; return true; }
      if (k === "ArrowDown") { _sel = (_sel + 1) % list.length; return true; }
      if (k === "ArrowLeft") { list[_sel].change(-1); return true; }
      if (k === "ArrowRight" || k === "Enter") { list[_sel].change(1); return true; }
    } else {
      var step = 30;
      var page = (_layout && _layout.contentH) ? _layout.contentH - 40 : 400;
      if (k === "ArrowUp") { _guideScroll -= step; return true; }
      if (k === "ArrowDown") { _guideScroll += step; return true; }
      if (k === "PageUp") { _guideScroll -= page; return true; }
      if (k === "PageDown") { _guideScroll += page; return true; }
    }
    return true;
  }

  function wheel(dy) {
    if (!_open) return false;
    if (_tab === "guide") {
      _guideScroll += dy > 0 ? 50 : -50;
      return true;
    }
    return true;
  }

  function consumeRestart() {
    if (_restartFlag) {
      _restartFlag = false;
      _mapChanged = false;
      _diffChanged = false;
      return true;
    }
    return false;
  }

  function apply() {
    if (typeof CONFIG === "undefined" || !CONFIG) return;
    if (_savedDriving === "on") CONFIG.realisticDriving = true;
    else if (_savedDriving === "off") CONFIG.realisticDriving = false;
    if (_savedNight === "on") CONFIG.nightCycle = true;
    else if (_savedNight === "off") CONFIG.nightCycle = false;
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    draw: draw,
    click: click,
    key: key,
    wheel: wheel,
    consumeRestart: consumeRestart,
    apply: apply
  };
})();
