// force.js - Force builder panel for "Police vs Protestors"
var FORCE = (function () {
  var TYPES = [
    { id: "none", name: "Foot squad", cost: 2, officers: 4, desc: "4 officers on foot" },
    { id: "car", name: "Sedan", cost: 3, officers: 4, desc: "fast, 4 officers, 2 arrest seats" },
    { id: "van", name: "Police van", cost: 4, officers: 6, desc: "6 officers, 5 arrest seats" },
    { id: "truck", name: "Riot truck", cost: 5, officers: 8, desc: "8 officers, 8 arrest seats, slow" },
    { id: "watertruck", name: "Water cannon", cost: 5, officers: 4, desc: "water cannon truck + 4 officers" },
    { id: "barriertruck", name: "Barrier truck", cost: 4, officers: 4, desc: "carries 3 street barriers + 4 officers" },
    { id: "motorbike", name: "Motorbikes", cost: 3, officers: 2, desc: "2 very fast riders" },
    { id: "mounted", name: "Mounted unit", cost: 4, officers: 4, desc: "4 horses, push crowds, scared by fire/gas" },
    { id: "liaison", name: "Liaison team", cost: 2, officers: 3, desc: "talk people calm, never arrest" },
    { id: "ambulance", name: "Ambulance", cost: 2, officers: 2, desc: "2 medics calm angry people nearby" }
  ];
  var LOADOUT_ORDER = ["car", "van", "truck", "watertruck", "barriertruck", "ambulance", "motorbike", "mounted", "liaison", "none"];
  var DEFAULTS = { car: 1, watertruck: 1, barriertruck: 1, motorbike: 1, none: 2 };
  var STORE_KEY = "ppg_force";

  var counts = {};
  var isPanelOpen = true;
  var sel = 0;
  var applyCb = null;
  var startCb = null;
  var layout = null; // cached layout
  var layoutKey = "";

  function cfgNum(name, def) {
    var C = (typeof window !== "undefined" && window.CONFIG) ? window.CONFIG : (typeof CONFIG !== "undefined" ? CONFIG : null);
    if (C && typeof C[name] === "number") return C[name];
    return def;
  }
  function budgetVal() { return cfgNum("forceBudget", 22); }
  function maxSquadsVal() { return cfgNum("maxPlanSquads", 10); }

  function typeById(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return null;
  }
  function totalCost() {
    var t = 0;
    for (var i = 0; i < TYPES.length; i++) t += TYPES[i].cost * (counts[TYPES[i].id] || 0);
    return t;
  }
  function totalSquads() {
    var t = 0;
    for (var i = 0; i < TYPES.length; i++) t += counts[TYPES[i].id] || 0;
    return t;
  }
  function totalOfficers() {
    var t = 0;
    for (var i = 0; i < TYPES.length; i++) t += TYPES[i].officers * (counts[TYPES[i].id] || 0);
    return t;
  }

  function save() {
    try {
      var o = {};
      for (var i = 0; i < TYPES.length; i++) if (counts[TYPES[i].id]) o[TYPES[i].id] = counts[TYPES[i].id];
      window.localStorage.setItem(STORE_KEY, JSON.stringify(o));
    } catch (e) {}
  }
  function loadSaved() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      var c = {};
      for (var i = 0; i < TYPES.length; i++) {
        var v = o[TYPES[i].id];
        c[TYPES[i].id] = (typeof v === "number" && v > 0) ? Math.floor(v) : 0;
      }
      return c;
    } catch (e) { return null; }
  }

  function setCountsSilent(c) {
    counts = c;
    invalidate();
  }
  function applyDefaults() {
    var c = {};
    for (var i = 0; i < TYPES.length; i++) c[TYPES[i].id] = DEFAULTS[TYPES[i].id] || 0;
    setCountsSilent(c);
  }
  function applyCountsClamped(c) {
    // enforce budget and max squads; if over, use defaults
    setCountsSilent(c);
    if (totalCost() > budgetVal() || totalSquads() > maxSquadsVal() || totalSquads() < 1) {
      applyDefaults();
    }
  }

  function init() {
    var s = loadSaved();
    if (s) applyCountsClamped(s);
    else applyDefaults();
  }

  function invalidate() { layout = null; layoutKey = ""; }

  function notify() { if (applyCb) applyCb(loadouts()); }

  function canInc(id) {
    var t = typeById(id); if (!t) return false;
    if (totalSquads() + 1 > maxSquadsVal()) return false;
    if (totalCost() + t.cost > budgetVal()) return false;
    return true;
  }
  function canDec(id) {
    if ((counts[id] || 0) <= 0) return false;
    if (totalSquads() - 1 < 1) return false;
    return true;
  }

  function inc(id) {
    if (!canInc(id)) return false;
    counts[id] = (counts[id] || 0) + 1;
    save(); invalidate(); notify(); return true;
  }
  function dec(id) {
    if (!canDec(id)) return false;
    counts[id] = (counts[id] || 0) - 1;
    save(); invalidate(); notify(); return true;
  }
  function setCount(id, n) {
    var t = typeById(id); if (!t) return false;
    n = Math.floor(n);
    if (isNaN(n) || n < 0) return false;
    var cur = counts[id] || 0;
    if (n === cur) return false;
    // simulate
    var delta = n - cur;
    var newSquads = totalSquads() + delta;
    var newCost = totalCost() + delta * t.cost;
    if (newSquads < 1 || newSquads > maxSquadsVal()) return false;
    if (newCost > budgetVal()) return false;
    counts[id] = n;
    save(); invalidate(); notify(); return true;
  }

  function loadouts() {
    var out = [];
    for (var i = 0; i < LOADOUT_ORDER.length; i++) {
      var id = LOADOUT_ORDER[i];
      var n = counts[id] || 0;
      for (var j = 0; j < n; j++) out.push(id);
    }
    return out;
  }

  function reset() {
    applyDefaults();
    save(); invalidate(); notify();
  }

  function onApply(fn) { applyCb = fn; }
  function onStart(fn) { startCb = fn; }

  function isOpen() { return isPanelOpen; }
  function open() { isPanelOpen = true; invalidate(); }
  function toggle() { isPanelOpen = !isPanelOpen; invalidate(); return isPanelOpen; }

  // ---- Layout & drawing helpers ----
  var sprCache = {};
  var VEH_LEN = { car: 54, van: 66, truck: 90, watertruck: 80, barriertruck: 80, ambulance: 64 };

  function cssK(w) {
    var k = 1;
    try {
      var c = document.getElementById("game");
      if (c && c.style && c.style.width) {
        var pw = parseFloat(c.style.width);
        if (pw > 0) k = w / pw;
      }
    } catch (e) {}
    return k || 1;
  }

  function rrect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = Math.max(0, w / 2);
    if (h < 2 * r) r = Math.max(0, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function buildLayout(w, h) {
    var k = cssK(w);
    var pw = Math.round(w * 0.78);
    var pad = 14 * k, gap = 10 * k, titleH = 28 * k;
    var cols = 5, nrows = 2;
    var cardW = (pw - pad * 2 - gap * (cols - 1)) / cols;
    var picH = Math.round(cardW * 0.55);
    var cardH = picH + 92 * k;
    var gridH = cardH * nrows + gap;
    var barH = 12 * k, startH = 36 * k;
    var ph = pad + titleH + gap + gridH + gap + (barH + 26 * k + startH) + pad;
    var px = Math.round((w - pw) / 2);
    var py = Math.round((h - ph) / 2);
    if (py < 8 * k) py = 8 * k;
    var cards = [], gy = py + pad + titleH + gap;
    for (var i = 0; i < TYPES.length; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      var x = px + pad + c * (cardW + gap);
      var y = gy + r * (cardH + gap);
      var ccy = y + cardH - 17 * k;
      cards.push({
        x: x, y: y, w: cardW, h: cardH,
        pic: { x: x + 6 * k, y: y + 6 * k, w: cardW - 12 * k, h: picH },
        minus: { x: x + 8 * k, y: ccy - 11 * k, w: 22 * k, h: 22 * k },
        plus: { x: x + cardW - 30 * k, y: ccy - 11 * k, w: 22 * k, h: 22 * k }
      });
    }
    var fy = gy + gridH + gap;
    return {
      k: k, px: px, py: py, pw: pw, ph: ph, pad: pad, titleH: titleH,
      cards: cards,
      hideR: { x: px + pw - pad - 150 * k, y: py + pad + (titleH - 22 * k) / 2, w: 150 * k, h: 22 * k },
      barR: { x: px + pad, y: fy, w: pw - pad * 2, h: barH },
      startR: { x: px + pad, y: fy + barH + 26 * k, w: pw - pad * 2, h: startH },
      tab: { x: 8 * k, y: 30 * k, w: 100 * k, h: 24 * k }
    };
  }

  function wrap2(ctx, txt, maxW) {
    var words = String(txt).split(" "), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (!cur || ctx.measureText(t).width <= maxW) cur = t;
      else {
        lines.push(cur); cur = words[i];
        if (lines.length >= 2) break;
      }
    }
    if (lines.length < 2 && cur) lines.push(cur);
    return lines;
  }

  // ---- pictures ----
  function drawFallback(ctx, cx, cy, b) {
    var w = b.w * 0.7, h = b.h * 0.4;
    ctx.fillStyle = "#2b4a8a";
    rrect(ctx, cx - w / 2, cy - h / 2, w, h, h * 0.22); ctx.fill();
    ctx.fillStyle = "#101418";
    ctx.beginPath(); ctx.arc(cx - w * 0.28, cy + h / 2, h * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + w * 0.28, cy + h / 2, h * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  function drawVeh(ctx, id, cx, cy, b) {
    var len = VEH_LEN[id] || 60;
    var sc = Math.min(b.w * 0.55 / len, b.h * 1.1 / len);   /* rotated sprites need room */
    var ok = false;
    if (typeof VEHICLES !== "undefined" && VEHICLES && VEHICLES.sprite) {
      try {
        var ck = id + "|" + Math.round(sc * 1000);
        var sp = sprCache[ck];
        if (!sp) {
          var ai = VEHICLES.angleIndex ? VEHICLES.angleIndex(-0.45) : 0;
          sp = VEHICLES.sprite(id, ai, sc, false);
          sprCache[ck] = sp;
        }
        if (sp && sp.c) { ctx.drawImage(sp.c, cx - sp.ax, cy - sp.ay); ok = true; }
      } catch (e) { ok = false; }
    }
    if (!ok) drawFallback(ctx, cx, cy, b);
  }

  function drawFoot(ctx, cx, cy, b) {
    var s = Math.min(b.w, b.h) * 0.3;
    for (var i = 0; i < 4; i++) {
      var x = cx + (i % 2 ? s * 0.62 : -s * 0.62);
      var y = cy + (i < 2 ? -s * 0.46 : s * 0.46);
      ctx.fillStyle = "#1e3a8a";
      ctx.beginPath(); ctx.arc(x, y + s * 0.3, s * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f0c8a0";
      ctx.beginPath(); ctx.arc(x, y - s * 0.16, s * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1e3a8a";
      ctx.beginPath(); ctx.arc(x, y - s * 0.2, s * 0.23, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath(); ctx.moveTo(x - s * 0.2, y - s * 0.22); ctx.lineTo(x + s * 0.2, y - s * 0.22); ctx.stroke();
    }
  }

  function drawBikes(ctx, cx, cy, b) {
    var s = Math.min(b.w, b.h) * 0.4;
    for (var i = 0; i < 2; i++) {
      var x = cx + (i ? s * 0.55 : -s * 0.55);
      ctx.fillStyle = "#101418";
      ctx.beginPath(); ctx.arc(x - s * 0.48, cy + s * 0.42, s * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.48, cy + s * 0.42, s * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1e3a8a";
      rrect(ctx, x - s * 0.55, cy + s * 0.06, s * 1.1, s * 0.32, s * 0.15); ctx.fill();
      ctx.fillStyle = "#2b52b8";
      rrect(ctx, x - s * 0.16, cy - s * 0.5, s * 0.32, s * 0.56, s * 0.14); ctx.fill();
      ctx.fillStyle = "#f0c8a0";
      ctx.beginPath(); ctx.arc(x, cy - s * 0.6, s * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(x, cy - s * 0.64, s * 0.17, Math.PI, 0); ctx.fill();
    }
  }

  function drawHorses(ctx, cx, cy, b) {
    var s = Math.min(b.w, b.h) * 0.42;
    for (var i = 0; i < 2; i++) {
      var x = cx + (i ? s * 0.55 : -s * 0.55);
      ctx.fillStyle = "#6b4423";
      rrect(ctx, x - s * 0.55, cy + s * 0.02, s * 1.1, s * 0.42, s * 0.2); ctx.fill();
      ctx.strokeStyle = "#54331a"; ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, cy + s * 0.38); ctx.lineTo(x - s * 0.48, cy + s * 0.7);
      ctx.moveTo(x + s * 0.38, cy + s * 0.38); ctx.lineTo(x + s * 0.48, cy + s * 0.7);
      ctx.stroke();
      ctx.fillStyle = "#6b4423";
      ctx.beginPath();
      ctx.moveTo(x + s * 0.42, cy + s * 0.1); ctx.lineTo(x + s * 0.74, cy - s * 0.24);
      ctx.lineTo(x + s * 0.82, cy - s * 0.14); ctx.lineTo(x + s * 0.55, cy + s * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1e3a8a";
      rrect(ctx, x - s * 0.15, cy - s * 0.46, s * 0.3, s * 0.5, s * 0.12); ctx.fill();
      ctx.fillStyle = "#f0c8a0";
      ctx.beginPath(); ctx.arc(x, cy - s * 0.56, s * 0.15, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawLiaison(ctx, cx, cy, b) {
    var s = Math.min(b.w, b.h) * 0.4;
    for (var i = 0; i < 3; i++) {
      var x = cx + (i - 1) * s * 0.62;
      var y = cy + (i === 1 ? -s * 0.1 : s * 0.08);
      ctx.fillStyle = "#2f6f9e";
      rrect(ctx, x - s * 0.19, y - s * 0.08, s * 0.38, s * 0.6, s * 0.12); ctx.fill();
      ctx.fillStyle = "#7fd4ff";
      rrect(ctx, x - s * 0.22, y - s * 0.02, s * 0.44, s * 0.32, s * 0.08); ctx.fill();
      ctx.fillStyle = "#f0c8a0";
      ctx.beginPath(); ctx.arc(x, y - s * 0.28, s * 0.18, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPic(ctx, tp, b) {
    ctx.save();
    rrect(ctx, b.x, b.y, b.w, b.h, 4 * (b.w / Math.max(1, b.w)));
    ctx.beginPath();
    rrect(ctx, b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.1);
    ctx.clip();
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (tp.id === "none") drawFoot(ctx, cx, cy, b);
    else if (tp.id === "motorbike") drawBikes(ctx, cx, cy, b);
    else if (tp.id === "mounted") drawHorses(ctx, cx, cy, b);
    else if (tp.id === "liaison") drawLiaison(ctx, cx, cy, b);
    else drawVeh(ctx, tp.id, cx, cy, b);
    ctx.restore();
  }

  function drawBtn(ctx, b, label, enabled, k) {
    ctx.fillStyle = enabled ? "#24324a" : "#161d29";
    rrect(ctx, b.x, b.y, b.w, b.h, b.h / 2); ctx.fill();
    ctx.strokeStyle = enabled ? "#4a5f80" : "#222c3c";
    ctx.lineWidth = 1 * k; ctx.stroke();
    ctx.fillStyle = enabled ? "#e8eef6" : "#55627a";
    ctx.font = "bold " + Math.round(b.h * 0.62) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function draw(ctx, w, h) {
    var key = w + "x" + h;
    if (!layout || layoutKey !== key) { layout = buildLayout(w, h); layoutKey = key; }
    var L = layout, k = L.k;
    ctx.save();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    if (!isPanelOpen) {
      var t = L.tab;
      ctx.fillStyle = "rgba(8,10,16,0.9)";
      rrect(ctx, t.x, t.y, t.w, t.h, 5 * k); ctx.fill();
      ctx.strokeStyle = "#3a4a60"; ctx.lineWidth = 1 * k; ctx.stroke();
      ctx.fillStyle = "#9fe0a0";
      ctx.font = "bold " + (12 * k) + "px sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("Force (V)", t.x + 10 * k, t.y + t.h / 2);
      ctx.restore();
      return;
    }

    // panel
    ctx.fillStyle = "rgba(8,10,16,0.92)";
    rrect(ctx, L.px, L.py, L.pw, L.ph, 8 * k); ctx.fill();
    ctx.strokeStyle = "#3a4a60"; ctx.lineWidth = 1 * k; ctx.stroke();

    // title
    ctx.fillStyle = "#e8eef6";
    ctx.font = "bold " + (17 * k) + "px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("PLAN YOUR FORCE", L.px + L.pad, L.py + L.pad + L.titleH / 2);

    // place on map
    var hb = L.hideR;
    ctx.fillStyle = "#24324a";
    rrect(ctx, hb.x, hb.y, hb.w, hb.h, 5 * k); ctx.fill();
    ctx.strokeStyle = "#3a4a60"; ctx.lineWidth = 1 * k; ctx.stroke();
    ctx.fillStyle = "#9fe0a0";
    ctx.font = "bold " + (11 * k) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Place on map (V)", hb.x + hb.w / 2, hb.y + hb.h / 2 + 1);

    // cards
    for (var i = 0; i < TYPES.length; i++) {
      var tp = TYPES[i], cd = L.cards[i];
      ctx.fillStyle = "#141a24";
      rrect(ctx, cd.x, cd.y, cd.w, cd.h, 6 * k); ctx.fill();
      ctx.strokeStyle = (i === sel) ? "#f0c040" : "#2a3646";
      ctx.lineWidth = (i === sel ? 2 : 1) * k; ctx.stroke();

      drawPic(ctx, tp, cd.pic);

      var tx = cd.x + 8 * k, tw = cd.w - 16 * k;
      var ty = cd.pic.y + cd.pic.h + 4 * k;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#e8eef6";
      ctx.font = "bold " + (12 * k) + "px sans-serif";
      ctx.fillText(tp.name, tx, ty + 11 * k);
      ctx.fillStyle = "#f0c040";
      ctx.font = (11 * k) + "px sans-serif";
      ctx.fillText(tp.cost + " pts", tx, ty + 23 * k);
      ctx.fillStyle = "#9aa6b6";
      ctx.font = (9.5 * k) + "px sans-serif";
      var lines = wrap2(ctx, tp.desc, tw);
      for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], tx, ty + (34 + j * 11) * k);

      drawBtn(ctx, cd.minus, "-", canDec(tp.id), k);
      drawBtn(ctx, cd.plus, "+", canInc(tp.id), k);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold " + (18 * k) + "px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(counts[tp.id] || 0), cd.x + cd.w / 2, cd.minus.y + cd.minus.h / 2);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }

    // footer
    var used = totalCost(), bud = budgetVal();
    var frac = bud > 0 ? Math.min(1, used / bud) : 0;
    var br = L.barR;
    ctx.fillStyle = "#1a2233";
    rrect(ctx, br.x, br.y, br.w, br.h, br.h / 2); ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = (frac >= 0.999) ? "#e05252" : (frac > 0.85 ? "#e8933a" : "#3fbf7f");
      rrect(ctx, br.x, br.y, Math.max(br.h, br.w * frac), br.h, br.h / 2); ctx.fill();
    }
    ctx.fillStyle = "#e8eef6";
    ctx.font = "bold " + (12 * k) + "px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("Budget used " + used + " / " + bud +
      "     Squads " + totalSquads() + " / " + maxSquadsVal() +
      "     Officers " + totalOfficers(), br.x, br.y + br.h + 14 * k);

    var sb = L.startR;
    ctx.fillStyle = "#2fbf71";
    rrect(ctx, sb.x, sb.y, sb.w, sb.h, 7 * k); ctx.fill();
    ctx.fillStyle = "#08120c";
    ctx.font = "bold " + (15 * k) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("START MATCH  (Enter)", sb.x + sb.w / 2, sb.y + sb.h / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  function inRect(x, y, r) { return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  function click(x, y) {
    var L = layout;
    if (!L) {
      var c = null;
      try { c = document.getElementById("game"); } catch (e) {}
      if (c && c.width && c.height) { L = layout = buildLayout(c.width, c.height); layoutKey = c.width + "x" + c.height; }
    }
    if (!L) return false;

    if (!isPanelOpen) {
      if (inRect(x, y, L.tab)) { open(); return true; }
      return false;
    }
    if (x < L.px || x > L.px + L.pw || y < L.py || y > L.py + L.ph) return false;

    if (inRect(x, y, L.hideR)) { isPanelOpen = false; invalidate(); return true; }
    if (inRect(x, y, L.startR)) { if (startCb) startCb(); return true; }
    for (var i = 0; i < L.cards.length; i++) {
      var cd = L.cards[i];
      if (inRect(x, y, cd.minus)) { sel = i; dec(TYPES[i].id); return true; }
      if (inRect(x, y, cd.plus)) { sel = i; inc(TYPES[i].id); return true; }
      if (inRect(x, y, cd)) { sel = i; return true; }
    }
    return true;
  }

  function key(kname) {
    var n = TYPES.length;
    if (!isPanelOpen) {
      if (kname === "Tab") { open(); return true; }
      return false;
    }
    if (kname === "ArrowLeft") { sel = (sel + n - 1) % n; return true; }
    if (kname === "ArrowRight") { sel = (sel + 1) % n; return true; }
    if (kname === "ArrowUp") { sel = (sel + n - 5) % n; return true; }
    if (kname === "ArrowDown") { sel = (sel + 5) % n; return true; }
    if (kname === "+" || kname === "=") { inc(TYPES[sel].id); return true; }
    if (kname === "-") { dec(TYPES[sel].id); return true; }
    if (kname === "Enter") { if (startCb) startCb(); return true; }
    if (kname === "Escape" || kname === "v" || kname === "V") { isPanelOpen = false; invalidate(); return true; }
    return false;
  }

  // public API
  init();

  return {
    types: function () { return TYPES; },
    counts: function () {
      var o = {};
      for (var i = 0; i < TYPES.length; i++) o[TYPES[i].id] = counts[TYPES[i].id] || 0;
      return o;
    },
    setCount: setCount,
    inc: inc,
    dec: dec,
    cost: totalCost,
    budget: budgetVal,
    squads: totalSquads,
    loadouts: loadouts,
    reset: reset,
    draw: draw,
    click: click,
    key: key,
    open: open,
    isOpen: isOpen,
    toggle: toggle,
    onApply: onApply,
    onStart: onStart
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FORCE;
