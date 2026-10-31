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
    var pw = 330 * k;
    var px = 8 * k, py = 30 * k;
    var pad = 10 * k;
    var titleH = 20 * k;
    var rowH = 42 * k;
    var rowGap = 3 * k;
    var rowsTop = py + pad + titleH + 6 * k;
    var rows = [];
    var yy = rowsTop;
    for (var i = 0; i < TYPES.length; i++) {
      rows.push({
        y: yy,
        h: rowH,
        minus: { x: px + pw - pad - 18 * k - 34 * k - 18 * k, y: yy + rowH / 2 - 9 * k, w: 18 * k, h: 18 * k },
        plus: { x: px + pw - pad - 18 * k, y: yy + rowH / 2 - 9 * k, w: 18 * k, h: 18 * k }
      });
      yy += rowH + rowGap;
    }
    var footerY = yy + 4 * k;
    var footH = 70 * k;
    var btnY = footerY + footH;
    var btnH = 30 * k;
    var panelH = (btnY + btnH + pad) - py;
    var hideR = { x: px + pw - pad - 44 * k, y: py + pad - 2 * k, w: 46 * k, h: 16 * k };
    var startR = { x: px + pad, y: btnY, w: pw - pad * 2, h: btnH };
    return {
      k: k, pw: pw, px: px, py: py, pad: pad,
      rows: rows, footerY: footerY, footH: footH,
      btnY: btnY, btnH: btnH, panelH: panelH,
      hideR: hideR, startR: startR,
      tab: { x: px, y: py, w: 96 * k, h: 22 * k }
    };
  }

  function draw(ctx, w, h) {
    var key = w + "x" + h;
    if (!layout || layoutKey !== key) { layout = buildLayout(w, h); layoutKey = key; }
    var L = layout, k = L.k;

    if (!isPanelOpen) {
      // tab
      var t = L.tab;
      ctx.fillStyle = "rgba(8,10,16,0.88)";
      rrect(ctx, t.x, t.y, t.w, t.h, 5 * k); ctx.fill();
      ctx.strokeStyle = "#3a4a60"; ctx.lineWidth = 1 * k; ctx.stroke();
      ctx.fillStyle = "#9fe0a0";
      ctx.font = "bold " + (12 * k) + "px sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("PLAN FORCE", t.x + 8 * k, t.y + t.h / 2);
      return;
    }

    // panel bg
    ctx.fillStyle = "rgba(8,10,16,0.88)";
    rrect(ctx, L.px, L.py, L.pw, L.panelH, 6 * k); ctx.fill();
    ctx.strokeStyle = "#3a4a60"; ctx.lineWidth = 1 * k; ctx.stroke();

    // title
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#9fe0a0";
    ctx.font = "bold " + (15 * k) + "px sans-serif";
    ctx.fillText("PLAN YOUR FORCE", L.px + L.pad, L.py + L.pad + 8 * k);
    // hide
    ctx.fillStyle = "#8b98ab";
    ctx.font = (12 * k) + "px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("x hide", L.px + L.pw - L.pad, L.py + L.pad + 8 * k);
    ctx.textAlign = "left";

    // rows
    for (var i = 0; i < TYPES.length; i++) {
      var tp = TYPES[i], r = L.rows[i];
      if (i === sel) {
        ctx.fillStyle = "rgba(255,216,102,0.12)";
        rrect(ctx, L.px + 4 * k, r.y, L.pw - 8 * k, r.h, 4 * k); ctx.fill();
      }
      var textX = L.px + L.pad;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#e3e8f0";
      ctx.font = "bold " + (13 * k) + "px sans-serif";
      ctx.fillText(tp.name, textX, r.y + 15 * k);
      var nameW = ctx.measureText(tp.name).width;
      ctx.fillStyle = "#ffd866";
      ctx.font = (12 * k) + "px sans-serif";
      ctx.fillText(tp.cost + " pts", textX + nameW + 6 * k, r.y + 15 * k);
      ctx.fillStyle = "#8b98ab";
      ctx.font = (11 * k) + "px sans-serif";
      ctx.fillText(tp.desc, textX, r.y + 30 * k);

      // buttons
      var mb = r.minus, pb = r.plus;
      var canM = canDec(tp.id), canP = canInc(tp.id);
      drawBtn(ctx, mb, "-", canM, k);
      drawBtn(ctx, pb, "+", canP, k);
      // count
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold " + (13 * k) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(counts[tp.id] || 0), (mb.x + mb.w + pb.x) / 2, r.y + 24 * k);
      ctx.textAlign = "left";
    }

    // footer
    var fy = L.footerY;
    var used = totalCost(), bud = budgetVal();
    ctx.font = (12 * k) + "px sans-serif";
    ctx.fillStyle = (used === bud) ? "#ffd866" : "#9fe0a0";
    ctx.fillText("Budget used " + used + " / " + bud, L.px + L.pad, fy + 14 * k);
    ctx.fillStyle = "#e3e8f0";
    ctx.fillText("Squads " + totalSquads() + " / " + maxSquadsVal(), L.px + L.pad, fy + 30 * k);
    ctx.fillStyle = "#8b98ab";
    ctx.font = (11 * k) + "px sans-serif";
    ctx.fillText("Officers " + totalOfficers(), L.px + L.pad, fy + 46 * k);
    ctx.fillText("Click + / -   (V hides this panel)", L.px + L.pad, fy + 62 * k);

    // start button
    var sb = L.startR;
    ctx.fillStyle = "#2a9d8f";
    rrect(ctx, sb.x, sb.y, sb.w, sb.h, 5 * k); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + (14 * k) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("START MATCH  (Enter)", sb.x + sb.w / 2, sb.y + sb.h / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function drawBtn(ctx, b, label, enabled, k) {
    ctx.fillStyle = enabled ? "#24324a" : "#1a2233";
    rrect(ctx, b.x, b.y, b.w, b.h, 3 * k); ctx.fill();
    ctx.fillStyle = enabled ? "#e3e8f0" : "#55627a";
    ctx.font = "bold " + (13 * k) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function inRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  function click(x, y) {
    var L = layout;
    if (!L) {
      // rebuild at current canvas size if possible
      var c = null;
      try { c = document.getElementById("game"); } catch (e) {}
      if (c && c.width && c.height) { L = layout = buildLayout(c.width, c.height); layoutKey = c.width + "x" + c.height; }
    }
    if (!L) return false;

    if (!isPanelOpen) {
      if (inRect(x, y, L.tab)) { open(); return true; }
      return false;
    }
    // hit panel?
    if (x >= L.px && x <= L.px + L.pw && y >= L.py && y <= L.py + L.panelH) {
      if (inRect(x, y, L.hideR)) { isPanelOpen = false; invalidate(); return true; }
      for (var i = 0; i < TYPES.length; i++) {
        var r = L.rows[i];
        if (inRect(x, y, r.minus)) { sel = i; dec(TYPES[i].id); return true; }
        if (inRect(x, y, r.plus)) { sel = i; inc(TYPES[i].id); return true; }
      }
      if (inRect(x, y, L.startR)) { if (startCb) startCb(); return true; }
      return true;
    }
    return false;
  }

  function key(kname) {
    if (!isPanelOpen) {
      if (kname === "Tab") { open(); return true; }
      return false;
    }
    if (kname === "ArrowUp") { sel = (sel + TYPES.length - 1) % TYPES.length; return true; }
    if (kname === "ArrowDown") { sel = (sel + 1) % TYPES.length; return true; }
    if (kname === "ArrowLeft") { dec(TYPES[sel].id); return true; }
    if (kname === "ArrowRight") { inc(TYPES[sel].id); return true; }
    if (kname === "Enter") { if (startCb) startCb(); return true; }
    if (kname === "Escape") { isPanelOpen = false; invalidate(); return true; }
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
