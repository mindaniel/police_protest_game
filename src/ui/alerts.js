var ALERTS = (function () {
  var items = [];
  var nextId = 1;
  var scanAccum = 0;
  var hidden = false;
  var storageKey = "ppg_alerts";
  var flashStart = {};

  // state remembered between scans
  var prevShopHp = {};
  var prevShopBroken = {};
  var knownFires = {};
  var knownBarricades = {};
  var knownSquads = {};

  try {
    if (typeof localStorage !== "undefined") {
      var v = localStorage.getItem(storageKey);
      if (v === "hidden") hidden = true;
      else if (v === "shown") hidden = false;
    }
  } catch (e) {}

  function persist() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, hidden ? "hidden" : "shown");
      }
    } catch (e) {}
  }

  function now(G) {
    return (G && typeof G.time === "number") ? G.time : 0;
  }

  function tileSize(G) {
    if (typeof CONFIG !== "undefined" && CONFIG && CONFIG.tileSize) return CONFIG.tileSize;
    return 32;
  }

  function textScale() {
    if (typeof Game !== "undefined" && Game && typeof Game.textScale === "function") {
      var s = Game.textScale();
      if (typeof s === "number" && s > 0) return s;
    }
    return 1;
  }

  function importance(kind) {
    switch (kind) {
      case "violence": return 5;
      case "shop_attack": return 4;
      case "squad": return 4;
      case "shop_looted": return 3;
      case "fire": return 2;
      case "barricade": return 1;
      case "crowd": return 1;
      case "angry": return 1;
      default: return 1;
    }
  }

  function pushAlert(kind, label, x, y, color, G) {
    var t = now(G);
    // merge with existing same-kind alert within 6 tiles
    for (var i = 0; i < items.length; i++) {
      var a = items[i];
      if (a.kind === kind) {
        var dx = a.x - x, dy = a.y - y;
        if (dx * dx + dy * dy <= 36) {
          a.last = t;
          a.label = label;
          a.x = x;
          a.y = y;
          return a;
        }
      }
    }
    var alert = {
      id: nextId++,
      kind: kind,
      label: label,
      x: x,
      y: y,
      color: color,
      born: t,
      last: t
    };
    items.push(alert);
    flashStart[alert.id] = t;
    return alert;
  }

  function expiryOf(a) {
    return a.kind === "shop_looted" ? 30 : 20;
  }

  function prune(G) {
    var t = now(G);
    var keep = [];
    for (var i = 0; i < items.length; i++) {
      if (t - items[i].last <= expiryOf(items[i])) keep.push(items[i]);
    }
    items = keep;
  }

  // ---- detection helpers ----

  function detectShops(G) {
    var shops = G.shops || [];
    var t = now(G);
    for (var i = 0; i < shops.length; i++) {
      var s = shops[i];
      if (!s || s.id === undefined) continue;
      var id = s.id;
      var prev = prevShopHp[id];
      var hp = typeof s.hp === "number" ? s.hp : 100;
      var wasBroken = prevShopBroken[id] === true;

      if (!s.broken && prev !== undefined && hp < prev) {
        pushAlert("shop_attack", "Shop under attack: " + (s.name || "Shop"), s.x, s.y, "#ff3b30", G);
      }
      if (s.broken && !wasBroken && prev !== undefined) {
        pushAlert("shop_looted", "Shop looted: " + (s.name || "Shop"), s.x, s.y, "#8b0000", G);
      }
      prevShopHp[id] = hp;
      prevShopBroken[id] = !!s.broken;
    }
  }

  function detectFires(G) {
    if (typeof FX === "undefined" || !FX || typeof FX.list !== "function") return;
    var list;
    try { list = FX.list(); } catch (e) { return; }
    if (!list || !list.length) return;

    // group new fires within 4 tiles
    var groups = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || f.x === undefined || f.y === undefined) continue;
      var key = f.x + "," + f.y + "," + (f.born || 0);
      var isNew = !knownFires[key];
      knownFires[key] = true;
      if (!isNew) continue;

      var placed = false;
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var dx = grp.x - f.x, dy = grp.y - f.y;
        if (dx * dx + dy * dy <= 16) {
          grp.n++;
          grp.sx += f.x; grp.sy += f.y;
          grp.x = grp.sx / grp.n; grp.y = grp.sy / grp.n;
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push({ x: f.x, y: f.y, sx: f.x, sy: f.y, n: 1 });
      }
    }
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = groups[gi];
      // merge with existing fire alert within 4 tiles
      pushAlert("fire", grp.n > 1 ? "Fires (" + grp.n + ")" : "Fire", grp.x, grp.y, "#ff9500", G);
    }
  }

  function detectBarricades(G) {
    if (typeof BAR === "undefined" || !BAR || typeof BAR.list !== "function") return;
    var list;
    try { list = BAR.list(); } catch (e) { return; }
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || b.x === undefined || b.y === undefined) continue;
      var key = b.x + "," + b.y;
      if (knownBarricades[key]) continue;
      knownBarricades[key] = true;
      pushAlert("barricade", "Barricade going up", b.x, b.y, "#ff9500", G);
    }
  }

  function detectSquads(G) {
    var officers = G.officers || [];
    var t = now(G);
    var affected = {};
    for (var i = 0; i < officers.length; i++) {
      var o = officers[i];
      if (!o || o.x === undefined) continue;
      if (typeof o.stunUntil === "number" && o.stunUntil > t) {
        affected[o.squad] = true;
      }
    }
    for (var sq in affected) {
      if (!Object.prototype.hasOwnProperty.call(affected, sq)) continue;
      var was = knownSquads[sq];
      knownSquads[sq] = true;
      if (!was) {
        // find an officer of that squad to locate the alert
        var px = 0, py = 0, found = false;
        for (var j = 0; j < officers.length; j++) {
          var oo = officers[j];
          if (oo && oo.squad === sq) { px = oo.x; py = oo.y; found = true; break; }
        }
        if (found) {
          pushAlert("squad", "Squad " + sq + " knocked back", px, py, "#af52de", G);
        }
      }
    }
    // clear known squads that recovered, so they can re-alert later
    for (var k in knownSquads) {
      if (!Object.prototype.hasOwnProperty.call(knownSquads, k)) continue;
      if (!affected[k]) delete knownSquads[k];
    }
  }

  function detectCrowd(G) {
    var agents = G.agents || [];
    if (!agents.length) return;
    var cell = 6;
    var map = {};
    var i, a;
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (!a || !a.active) continue;
      if (a.x === undefined || a.y === undefined) continue;
      var cx = Math.floor(a.x / cell);
      var cy = Math.floor(a.y / cell);
      var key = cx + "," + cy;
      var c = map[key];
      if (!c) { c = map[key] = { cx: cx, cy: cy, count: 0, moodSum: 0, moodN: 0 }; }
      c.count++;
      if (typeof a.mood === "number") { c.moodSum += a.mood; c.moodN++; }
    }
    var threshold = Math.max(30, 45 * 1);
    var packed = {};
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (map[k].count >= threshold) packed[k] = map[k];
    }
    // merge neighbouring packed cells
    var visited = {};
    for (var pk in packed) {
      if (!Object.prototype.hasOwnProperty.call(packed, pk)) continue;
      if (visited[pk]) continue;
      // flood fill
      var queue = [pk];
      visited[pk] = true;
      var group = [];
      while (queue.length) {
        var cur = queue.pop();
        var cc = packed[cur];
        group.push(cc);
        var neighbors = [
          (cc.cx + 1) + "," + cc.cy,
          (cc.cx - 1) + "," + cc.cy,
          cc.cx + "," + (cc.cy + 1),
          cc.cx + "," + (cc.cy - 1)
        ];
        for (var n = 0; n < neighbors.length; n++) {
          var nk = neighbors[n];
          if (packed[nk] && !visited[nk]) {
            visited[nk] = true;
            queue.push(nk);
          }
        }
      }
      // aggregate
      var totalCount = 0, moodSum = 0, moodN = 0;
      var tcx = 0, tcy = 0;
      for (var gi = 0; gi < group.length; gi++) {
        totalCount += group[gi].count;
        moodSum += group[gi].moodSum;
        moodN += group[gi].moodN;
        tcx += group[gi].cx + 0.5;
        tcy += group[gi].cy + 0.5;
      }
      var ax = (tcx / group.length) * cell;
      var ay = (tcy / group.length) * cell;
      pushAlert("crowd", "Crowd packed (" + totalCount + " people)", ax, ay, "#ffcc00", G);
      if (moodN > 0 && (moodSum / moodN) >= 70) {
        pushAlert("angry", "Angry crowd (" + totalCount + " people)", ax, ay, "#ffcc00", G);
      }
    }
  }

  function detectViolence(G) {
    var agents = G.agents || [];
    var t = now(G);
    var violent = [];
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (!a || !a.active) continue;
      if (typeof a.violentUntil === "number" && a.violentUntil > t) {
        violent.push(a);
      }
    }
    // cluster violent agents within 5 tiles
    var used = {};
    for (var vi = 0; vi < violent.length; vi++) {
      if (used[vi]) continue;
      var grp = [vi];
      used[vi] = true;
      var changed = true;
      while (changed) {
        changed = false;
        for (var vj = 0; vj < violent.length; vj++) {
          if (used[vj]) continue;
          for (var gk = 0; gk < grp.length; gk++) {
            var p = violent[grp[gk]];
            var q = violent[vj];
            var dx = p.x - q.x, dy = p.y - q.y;
            if (dx * dx + dy * dy <= 25) {
              used[vj] = true;
              grp.push(vj);
              changed = true;
              break;
            }
          }
        }
      }
      if (grp.length >= 3) {
        var sx = 0, sy = 0;
        for (var g3 = 0; g3 < grp.length; g3++) {
          sx += violent[grp[g3]].x;
          sy += violent[grp[g3]].y;
        }
        pushAlert("violence", "Violence (" + grp.length + ")", sx / grp.length, sy / grp.length, "#ff3b30", G);
      }
    }
  }

  // ---- public API ----

  function update(G, dt) {
    if (!G) return;
    if (typeof dt !== "number" || isNaN(dt)) dt = 0;
    scanAccum += dt;
    if (scanAccum < 0.5) {
      // still prune occasionally
      prune(G);
      return;
    }
    scanAccum = 0;

    detectShops(G);
    detectFires(G);
    detectBarricades(G);
    detectSquads(G);
    detectCrowd(G);
    detectViolence(G);
    prune(G);
  }

  function visibleList() {
    // sort: importance desc, then last desc, then id desc
    var arr = items.slice();
    arr.sort(function (a, b) {
      var ia = importance(a.kind), ib = importance(b.kind);
      if (ia !== ib) return ib - ia;
      if (a.last !== b.last) return b.last - a.last;
      return b.id - a.id;
    });
    if (arr.length > 6) arr = arr.slice(0, 6);
    return arr;
  }

  function list() {
    return items.slice();
  }

  function toggle() {
    hidden = !hidden;
    persist();
  }

  function clear(G) {
    items = [];
    nextId = 1;
    scanAccum = 0;
    flashStart = {};
    prevShopHp = {};
    prevShopBroken = {};
    knownFires = {};
    knownBarricades = {};
    knownSquads = {};
  }

  // ---- layout ----

  function columnLayout(G) {
    var k = textScale();
    var w = 300 * k;
    var x = 12;
    var y = 130;
    return { x: x, y: y, w: w, k: k };
  }

  function cardLayout(idx, lay) {
    var k = lay.k;
    var pad = 6 * k;
    var h = 46 * k;
    var gap = 6 * k;
    var y = lay.y + 34 * k + idx * (h + gap);
    return { x: lay.x, y: y, w: lay.w, h: h, bar: 6 * k, pad: pad };
  }

  function headerLayout(lay) {
    var k = lay.k;
    return { x: lay.x, y: lay.y - 26 * k, w: lay.w, h: 22 * k, k: k };
  }

  function tabLayout(lay) {
    var k = lay.k;
    return { x: 2, y: lay.y, w: 90 * k, h: 24 * k, k: k };
  }

  // ---- drawing ----

  function draw(ctx, w, h, G) {
    if (!ctx) return;
    var lay = columnLayout(G);
    var k = lay.k;

    if (hidden) {
      drawTab(ctx, lay, k);
      return;
    }

    drawHeader(ctx, lay, k);

    var arr = visibleList();
    if (!arr.length) return;

    var t = now(G);

    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      var c = cardLayout(i, lay);

      // flash pulse for first 1s
      var alpha = 1;
      var fs = flashStart[a.id];
      if (typeof fs === "number") {
        var age = t - fs;
        if (age < 1) {
          alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(age * Math.PI * 4));
        }
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      // card background
      ctx.fillStyle = "rgba(12,14,18,0.82)";
      ctx.fillRect(c.x, c.y, c.w, c.h);

      // border
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = Math.max(1, Math.floor(k));
      ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);

      // colored bar
      ctx.fillStyle = a.color || "#ffffff";
      ctx.fillRect(c.x, c.y, c.bar, c.h);

      // label
      var fontPx = Math.round(13 * k);
      ctx.font = "bold " + fontPx + "px Consolas, monospace";
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      var labelText = a.label;
      var maxW = c.w - c.bar - c.pad * 2;
      var measured = ctx.measureText(labelText).width;
      if (measured > maxW) {
        // truncate with ellipsis
        var lo = 0, hi = labelText.length;
        while (lo < hi) {
          var mid = (lo + hi + 1) >> 1;
          if (ctx.measureText(labelText.substring(0, mid) + "…").width <= maxW) lo = mid;
          else hi = mid - 1;
        }
        labelText = labelText.substring(0, lo) + "…";
      }
      ctx.fillText(labelText, c.x + c.bar + c.pad, c.y + c.pad);

      // second line
      var secPx = Math.round(11 * k);
      ctx.font = secPx + "px Consolas, monospace";
      ctx.fillStyle = "rgba(200,200,210,0.75)";
      var agoSec = Math.max(0, Math.floor(t - a.last));
      var second = agoSec + " s ago  ·  click to view";
      ctx.fillText(second, c.x + c.bar + c.pad, c.y + c.pad + fontPx + 3 * k);

      ctx.restore();
    }
  }

  function drawHeader(ctx, lay, k) {
    var hd = headerLayout(lay);
    ctx.save();
    var fontPx = Math.round(13 * k);
    ctx.font = "bold " + fontPx + "px Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    var title = "ALERTS";
    var tw = ctx.measureText(title).width;
    var xBtn = hd.x + tw + 10 * k;
    var btnW = 16 * k, btnH = 16 * k;
    var btnY = hd.y + (hd.h - btnH) / 2;

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(title, hd.x, hd.y + hd.h / 2);

    // x button
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(1, Math.floor(k));
    ctx.strokeRect(xBtn, btnY, btnW, btnH);
    ctx.beginPath();
    ctx.moveTo(xBtn + 3 * k, btnY + 3 * k);
    ctx.lineTo(xBtn + btnW - 3 * k, btnY + btnH - 3 * k);
    ctx.moveTo(xBtn + btnW - 3 * k, btnY + 3 * k);
    ctx.lineTo(xBtn + 3 * k, btnY + btnH - 3 * k);
    ctx.stroke();

    ctx.restore();
  }

  function drawTab(ctx, lay, k) {
    var tb = tabLayout(lay);
    ctx.save();
    ctx.fillStyle = "rgba(12,14,18,0.82)";
    ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = Math.max(1, Math.floor(k));
    ctx.strokeRect(tb.x + 0.5, tb.y + 0.5, tb.w - 1, tb.h - 1);

    var fontPx = Math.round(12 * k);
    ctx.font = "bold " + fontPx + "px Consolas, monospace";
    ctx.fillStyle = "#ffcc00";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    var n = items.length;
    ctx.fillText("alerts (" + n + ")", tb.x + 8 * k, tb.y + tb.h / 2);
    ctx.restore();
  }

  // ---- input ----

  function centerOnAlert(a) {
    if (!a) return;
    if (typeof Art !== "undefined" && Art && typeof Art.centerOn === "function") {
      Art.centerOn(a.x, a.y, 2.2);
    }
    if (a.kind === "squad") {
      // label format "Squad N knocked back"
      var m = /Squad\s+(\S+)/.exec(a.label);
      if (m && typeof UI !== "undefined" && UI) {
        UI.selected = m[1];
      }
    }
  }

  function click(x, y, G) {
    var lay = columnLayout(G);
    var k = lay.k;

    if (hidden) {
      var tb = tabLayout(lay);
      if (x >= tb.x && x <= tb.x + tb.w && y >= tb.y && y <= tb.y + tb.h) {
        hidden = false;
        persist();
        return true;
      }
      return false;
    }

    // header x button
    var hd = headerLayout(lay);
    var title = "ALERTS";
    // approximate width
    var fontPx = Math.round(13 * k);
    var approxTitleW = title.length * fontPx * 0.6;
    var xBtnX = hd.x + approxTitleW + 10 * k;
    var btnW = 16 * k, btnH = 16 * k;
    var btnY = hd.y + (hd.h - btnH) / 2;
    if (x >= xBtnX && x <= xBtnX + btnW && y >= btnY && y <= btnY + btnH) {
      hidden = true;
      persist();
      return true;
    }

    var arr = visibleList();
    for (var i = 0; i < arr.length; i++) {
      var c = cardLayout(i, lay);
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        centerOnAlert(arr[i]);
        return true;
      }
    }

    // clicking anywhere in the column area should count as hit
    var colRight = lay.x + lay.w;
    var colBottom = lay.y + 34 * k + arr.length * (46 * k + 6 * k);
    if (x >= lay.x && x <= colRight && y >= lay.y - 26 * k && y <= Math.max(colBottom, lay.y + 40 * k)) {
      return true;
    }

    return false;
  }

  function key(k) {
    if (k === "Backspace") {
      var arr = visibleList();
      if (arr.length) {
        centerOnAlert(arr[0]);
        return true;
      }
      return false;
    }
    return false;
  }

  return {
    update: update,
    draw: draw,
    click: click,
    key: key,
    list: list,
    toggle: toggle,
    clear: clear
  };
})();
