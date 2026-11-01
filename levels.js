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
    /* bigger maps (districts) get more people, rioters and police: square root of the area, at most 2.2x */
    var big = (typeof MAP !== "undefined" && MAP.width) ? Math.min(2.2, Math.max(1, Math.sqrt(MAP.width * MAP.height / 6400))) : 1;
    CONFIG.crowdSize = Math.min(1500, Math.round(lv.crowdSize * big));   /* the crowd sim slows down past ~1500 */
    CONFIG.rioterCount = Math.round(CONFIG.rioterCount * big);
    CONFIG.forceBudget = Math.round(lv.forceBudget * big);
    CONFIG.maxPlanSquads = Math.min(20, Math.round(10 * big));   /* more squads to plan on a district */
    CONFIG.maxSquads = CONFIG.maxPlanSquads + 4;                 /* room for reinforcements */
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

  // Set font at px and shrink it until text fits maxWidth (measureText is already scaled by the hook)
  function fitPx(ctx, text, weight, px, maxWidth, minPx) {
    var p = px;
    var prefix = weight ? weight + " " : "";
    while (p > minPx) {
      ctx.font = prefix + p + "px Consolas, monospace";
      if (ctx.measureText(text).width <= maxWidth) break;
      p -= 1;
    }
    ctx.font = prefix + p + "px Consolas, monospace";
    return p;
  }

  function textScale() {
    var k = (typeof Game !== "undefined" && Game.textScale) ? Game.textScale() : 1;
    return (k > 0) ? k : 1;
  }

  function drawPicker(ctx, w, h, y) {
    ctx.save();

    var k = textScale();
    var gap = 16;
    var cardW = Math.min((w - 80) / 4 - gap, 300 * k);
    var pad = 10 * k;
    var textW = cardW - pad * 2;
    var lineGap = 6 * k;
    var namePxBase = 18;
    var peoplePxBase = 14;
    var blurbPxBase = 12;

    var cards = [];
    var maxCardH = 0;

    for (var i = 0; i < list.length; i++) {
      var lv = list[i];

      var namePx = fitPx(ctx, lv.name, "bold", namePxBase, textW, 10);
      var peopleText = lv.crowdSize + " people, " + lv.rioterMin + "-" + lv.rioterMax + " rioters?";
      var peoplePx = fitPx(ctx, peopleText, "", peoplePxBase, textW, 9);

      ctx.font = blurbPxBase + "px Consolas, monospace";
      var blurbLines = wrapText(ctx, lv.blurb, textW, 8);
      var blurbPx = [];
      var blurbH = 0;
      for (var j = 0; j < blurbLines.length; j++) {
        var bp = fitPx(ctx, blurbLines[j], "", blurbPxBase, textW, 8);
        blurbPx.push(bp);
        blurbH += bp * k * 1.25;
      }

      var blockH = 6 * k;
      var cardH = pad + namePx * k + lineGap + peoplePx * k + lineGap + blurbH + lineGap + blockH + pad;
      if (cardH > maxCardH) maxCardH = cardH;

      cards.push({
        lv: lv,
        namePx: namePx,
        peoplePx: peoplePx,
        peopleText: peopleText,
        blurbLines: blurbLines,
        blurbPx: blurbPx
      });
    }

    var aboveText = "Choose a difficulty, then press Enter";
    var abovePx = fitPx(ctx, aboveText, "", 14, w - 40, 9);
    var aboveH = abovePx * k;
    var hintGap = 16 * k;
    var cardsY = y + aboveH + hintGap;

    var belowText = "Left / Right or 1-4: choose difficulty";
    var belowPx = fitPx(ctx, belowText, "", 14, w - 40, 9);
    var belowH = belowPx * k;
    var belowY = cardsY + maxCardH + hintGap * 0.75;

    // Keep the picker inside the canvas when possible
    if (belowY + belowH > h - 8) {
      var minCardsY = y + aboveH + 4;
      var want = h - 8 - belowH - hintGap * 0.75 - maxCardH;
      if (want > minCardsY) cardsY = want;
      belowY = cardsY + maxCardH + hintGap * 0.75;
    }

    // Hint above the cards
    ctx.fillStyle = "#ffd866";
    ctx.font = abovePx + "px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(aboveText, w / 2, y);

    var totalW = cardW * 4 + gap * 3;
    var startX = Math.floor((w - totalW) / 2);
    cardRects = [];

    var barColors = ["#6fcf73", "#ffd866", "#f4a261", "#e63946"];

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var lv = c.lv;
      var cx = startX + i * (cardW + gap);
      var cy = cardsY;
      var selected = (i === currentIndex);

      // Card background
      roundRect(ctx, cx, cy, cardW, maxCardH, 8);
      ctx.fillStyle = selected ? "rgba(40,50,70,0.95)" : "rgba(16,20,30,0.9)";
      ctx.fill();
      ctx.lineWidth = selected ? 3 : 1;
      ctx.strokeStyle = selected ? "#ffd866" : "#3a4a60";
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      // Name
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold " + c.namePx + "px Consolas, monospace";
      var ty = cy + pad;
      ctx.fillText(lv.name, cx + pad, ty);
      ty += c.namePx * k + lineGap;

      // People / rioters line (each level shows its own crowdSize, like LEVELS.label())
      ctx.fillStyle = "#c9d1dc";
      ctx.font = c.peoplePx + "px Consolas, monospace";
      ctx.fillText(c.peopleText, cx + pad, ty);
      ty += c.peoplePx * k + lineGap;

      // Blurb wrapped, with each line shrunk if still too wide
      ctx.fillStyle = "#9aa6b5";
      for (var j = 0; j < c.blurbLines.length; j++) {
        ctx.font = c.blurbPx[j] + "px Consolas, monospace";
        ctx.fillText(c.blurbLines[j], cx + pad, ty);
        ty += c.blurbPx[j] * k * 1.25;
      }

      // Strength bar (4 blocks, filled up to i+1)
      var blockW = 10 * k;
      var blockH = 6 * k;
      var blockGap = 4 * k;
      var barY = cy + maxCardH - pad - blockH;
      var barX = cx + pad;
      for (var b = 0; b < 4; b++) {
        var bx = barX + b * (blockW + blockGap);
        ctx.beginPath();
        ctx.fillStyle = (b < i + 1) ? barColors[b] : "#2a3444";
        ctx.rect(bx, barY, blockW, blockH);
        ctx.fill();
      }

      cardRects.push({ x: cx, y: cy, w: cardW, h: maxCardH, id: lv.id });
    }

    // Hint below the cards
    ctx.fillStyle = "#d7dde8";
    ctx.font = belowPx + "px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(belowText, w / 2, belowY);

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
