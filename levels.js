// levels.js - difficulty levels for Police vs Protestors
var LEVELS = (function () {
  var list = [
    {
      id: "calm", forceBudget: 26, matchSeconds: 600, name: "Calm march", crowdSize: 260, rioterCount: 6, rioterMin: 4, rioterMax: 9,
      loadoutBudget: 12, lootJoinChance: 0.15, vanguardChance: 0.03,
      spawnTrickleSeconds: 90, duskStart: 0.5,
      blurb: "A peaceful march with a few troublemakers."
    },
    {
      id: "tense", forceBudget: 22, matchSeconds: 720, name: "Tense rally", crowdSize: 520, rioterCount: 11, rioterMin: 7, rioterMax: 15,
      loadoutBudget: 10, lootJoinChance: 0.25, vanguardChance: 0.05,
      spawnTrickleSeconds: 110, duskStart: 0.45,
      blurb: "A big angry rally. Rioters hide in the crowd."
    },
    {
      id: "angry", forceBudget: 22, matchSeconds: 900, name: "Angry city", crowdSize: 780, rioterCount: 17, rioterMin: 12, rioterMax: 22,
      loadoutBudget: 10, lootJoinChance: 0.32, vanguardChance: 0.07,
      spawnTrickleSeconds: 130, duskStart: 0.4,
      blurb: "Huge crowds, looting spreads fast."
    },
    {
      id: "riot", forceBudget: 20, matchSeconds: 900, name: "Riot night", crowdSize: 1100, rioterCount: 25, rioterMin: 18, rioterMax: 32,
      loadoutBudget: 9, lootJoinChance: 0.40, vanguardChance: 0.09,
      spawnTrickleSeconds: 150, duskStart: 0,
      blurb: "The whole city is out. Starts at dusk."
    }
  ];

  var currentIndex = 1; // default "tense"
  var cardRects = [];

  // Restore saved choice
  try {
    var saved = window.localStorage.getItem("ppg_level");
    if (saved) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === saved) { currentIndex = i; break; }
      }
    }
  } catch (e) { /* ignore */ }

  function getList() { return list; }
  function getCurrent() { return list[currentIndex]; }

  function save() {
    try { window.localStorage.setItem("ppg_level", list[currentIndex].id); } catch (e) {}
  }

  function set(id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { currentIndex = i; save(); return; }
    }
  }

  function next() { currentIndex = (currentIndex + 1) % list.length; save(); }
  function prev() { currentIndex = (currentIndex - 1 + list.length) % list.length; save(); }

  function apply() {
    var lv = list[currentIndex];
    if (typeof CONFIG === "undefined" || !CONFIG) return;
    CONFIG.crowdSize = lv.crowdSize;
    /* a random number of hidden rioters each match; the player is not told how many */
    CONFIG.rioterCount = lv.rioterMin + Math.floor(Math.random() * (lv.rioterMax - lv.rioterMin + 1));
    CONFIG.loadoutBudget = lv.loadoutBudget;
    CONFIG.lootJoinChance = lv.lootJoinChance;
    CONFIG.vanguardChance = lv.vanguardChance;
    CONFIG.spawnTrickleSeconds = lv.spawnTrickleSeconds;
    CONFIG.duskStart = lv.duskStart;
    CONFIG.matchSeconds = lv.matchSeconds;
    CONFIG.forceBudget = lv.forceBudget;
  }

  function label() {
    var lv = list[currentIndex];
    return lv.name + " (" + lv.crowdSize + ", " + Math.round(lv.matchSeconds / 60) + " min)";
  }

  // Rounded rect path via arcTo
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Wrap words into at most maxLines lines
  function wrapText(ctx, text, maxWidth, maxLines) {
    var words = text.split(" ");
    var lines = [];
    var cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(test).width <= maxWidth || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = words[i];
        if (lines.length === maxLines - 1) {
          // last line: append remainder
          var rest = words.slice(i).join(" ");
          lines.push(rest);
          return lines;
        }
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawPicker(ctx, w, h, y) {
    ctx.save();
    var cardW = 220, cardH = 92, gap = 16;
    var totalW = cardW * 4 + gap * 3;
    var startX = Math.floor((w - totalW) / 2);
    cardRects = [];

    var barColors = ["#6fcf73", "#ffd866", "#f4a261", "#e63946"];

    for (var i = 0; i < list.length; i++) {
      var lv = list[i];
      var cx = startX + i * (cardW + gap);
      var cy = y;
      var selected = (i === currentIndex);

      // Card background
      roundRect(ctx, cx, cy, cardW, cardH, 8);
      ctx.fillStyle = selected ? "rgba(40,50,70,0.95)" : "rgba(16,20,30,0.9)";
      ctx.fill();
      ctx.lineWidth = selected ? 3 : 1;
      ctx.strokeStyle = selected ? "#ffd866" : "#3a4a60";
      ctx.stroke();

      // Name
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 18px Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(lv.name, cx + 10, cy + 8);

      // People / rioters line
      ctx.fillStyle = "#c9d1dc";
      ctx.font = "14px Consolas, monospace";
      ctx.fillText(lv.crowdSize + " people, " + lv.rioterMin + "-" + lv.rioterMax + " rioters?", cx + 10, cy + 30);

      // Blurb wrapped
      ctx.fillStyle = "#9aa6b5";
      ctx.font = "12px Consolas, monospace";
      var lines = wrapText(ctx, lv.blurb, cardW - 20, 2);
      for (var j = 0; j < lines.length; j++) {
        ctx.fillText(lines[j], cx + 10, cy + 48 + j * 14);
      }

      // Strength bar (4 blocks, filled up to i+1)
      var blockW = 10, blockH = 6, blockGap = 4;
      var barY = cy + cardH - 14;
      var barX = cx + 10;
      for (var k = 0; k < 4; k++) {
        var bx = barX + k * (blockW + blockGap);
        ctx.beginPath();
        if (k < i + 1) {
          ctx.fillStyle = barColors[k];
        } else {
          ctx.fillStyle = "#2a3444";
        }
        ctx.rect(bx, barY, blockW, blockH);
        ctx.fill();
      }

      cardRects.push({ x: cx, y: cy, w: cardW, h: cardH, id: lv.id });
    }

    // Hint text
    ctx.fillStyle = "#d7dde8";
    ctx.font = "14px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("Left / Right or 1-4: choose difficulty", w / 2, y + cardH + 10);

    ctx.restore();
  }

  function hit(x, y) {
    for (var i = 0; i < cardRects.length; i++) {
      var r = cardRects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return r.id;
      }
    }
    return null;
  }

  return {
    list: getList,
    current: getCurrent,
    set: set,
    next: next,
    prev: prev,
    apply: apply,
    drawPicker: drawPicker,
    hit: hit,
    label: label
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LEVELS;
