var DEBRIEF = (function () {
  var lastG = null;
  var samples = [];
  var lastSampleT = -1;
  var firstShopT = -1, firstArrestT = -1, firstWrongT = -1;

  function init(G) {
    samples = [];
    lastSampleT = -1;
    firstShopT = -1; firstArrestT = -1; firstWrongT = -1;
    lastG = G;
  }

  function num(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
  function s(G, k) { var v = G && G.stats ? G.stats[k] : 0; return num(v); }

  function rioterTotal(G) {
    if (G && typeof G.rioterTotal === "number") return G.rioterTotal;
    if (typeof CONFIG !== "undefined" && CONFIG && typeof CONFIG.rioterCount === "number") return CONFIG.rioterCount;
    return 0;
  }

  function avgMood(G) {
    var a = G.agents, i, n = 0, sum = 0;
    if (!a) return 0;
    for (i = 0; i < a.length; i++) {
      if (a[i] && a[i].active) { sum += num(a[i].mood); n++; }
    }
    return n ? (sum / n) : 0;
  }

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return (m < 10 ? "0" + m : "" + m) + ":" + (sec < 10 ? "0" + sec : "" + sec);
  }

  function update(G, dt) {
    if (!G) return;
    if (G !== lastG) init(G);
    var t = num(G.time);
    if (lastSampleT < 0) lastSampleT = 0;
    if (t - lastSampleT >= 5 - 1e-6) {
      lastSampleT = Math.floor(t / 5) * 5;
      var sample = {
        t: t,
        mood: avgMood(G),
        shops: s(G, "shopsDamaged"),
        arrests: s(G, "rioterArrested"),
        wrong: s(G, "wrongArrests"),
        media: (G.stats && typeof G.stats.mediaScore === "number") ? G.stats.mediaScore : 100
      };
      samples.push(sample);
      if (samples.length > 120) samples.shift();
    }
    // key moments
    var sd = s(G, "shopsDamaged"), ra = s(G, "rioterArrested"), wa = s(G, "wrongArrests");
    if (firstShopT < 0 && sd > 0) firstShopT = t;
    if (firstArrestT < 0 && ra > 0) firstArrestT = t;
    if (firstWrongT < 0 && wa > 0) firstWrongT = t;
  }

  function compute(G) {
    if (G && G._debriefReport) return G._debriefReport;
    G = G || {};
    var r = { score: 0, grade: "F", title: "", cats: [], moments: [], tips: [] };

    var rt = rioterTotal(G);
    var rioterArrested = s(G, "rioterArrested");
    var wrongArrests = s(G, "wrongArrests");
    var shopsDamaged = s(G, "shopsDamaged");
    var peakMood = s(G, "peakMood");
    var escorted = s(G, "escorted");
    var gasUsed = s(G, "gasUsed");
    var gassedPeaceful = s(G, "gassedPeaceful");
    var mediaScore = s(G, "mediaScore");
    var mediaIncidents = s(G, "mediaIncidents");
    var barricadesBuilt = s(G, "barricadesBuilt");
    var barricadesCleared = s(G, "barricadesCleared");
    var kettles = s(G, "kettles");
    var kettledPeople = s(G, "kettledPeople");
    var snatches = s(G, "snatches");
    var snatchFailed = s(G, "snatchFailed");
    var horsePanics = s(G, "horsePanics");
    var droneFlights = s(G, "droneFlights");
    var liaisonTalk = s(G, "liaisonTalkSeconds");
    var liaisonWithdrawals = s(G, "liaisonWithdrawals");
    var shopsTotal = (G.shops && G.shops.length) ? G.shops.length : 0;

    var ownersHurt = s(G, "ownersHurt");
    var fightInjuries = s(G, "fightInjuries");
    var fires = s(G, "fires");
    var crimeSolved = s(G, "crimeSolved");
    var crimeMissed = s(G, "crimeMissed");
    var marchesArrived = s(G, "marchesArrived");
    var marchesBroken = s(G, "marchesBroken");
    var dispersed = s(G, "dispersed");
    var landmarkDamage = s(G, "landmarkDamage");
    var waterUsed = s(G, "waterUsed");

    var cats = [];

    // Safety
    var safeLines = [];
    var safeScore = 25;
    var sd = 0;
    if (ownersHurt > 0) {
      var d0 = Math.min(10, 3 * ownersHurt);
      safeScore -= d0; sd += d0;
      safeLines.push("-" + d0 + ": " + ownersHurt + " shop owner" + (ownersHurt === 1 ? "" : "s") + " hurt");
    }
    if (fightInjuries > 0) {
      var d1 = Math.min(8, 2 * fightInjuries);
      safeScore -= d1; sd += d1;
      safeLines.push("-" + d1 + ": " + fightInjuries + " injur" + (fightInjuries === 1 ? "y" : "ies") + " in fights");
    }
    if (fires > 0) {
      var d2 = Math.min(8, 2 * fires);
      safeScore -= d2; sd += d2;
      safeLines.push("-" + d2 + ": " + fires + " fire" + (fires === 1 ? "" : "s") + " started");
    }
    if (peakMood > 70) {
      var d3 = Math.min(6, Math.round((peakMood - 70) / 5));
      safeScore -= d3; sd += d3;
      safeLines.push("-" + d3 + ": peak mood " + Math.round(peakMood) + " (dangerously high)");
    }
    if (crimeSolved > 0) {
      var b0 = Math.min(4, Math.round(crimeSolved / 2));
      safeScore += b0;
      safeLines.push("+" + b0 + ": " + crimeSolved + " crime" + (crimeSolved === 1 ? "" : "s") + " solved");
    }
    if (crimeMissed > 0) {
      var d4 = Math.min(6, crimeMissed);
      safeScore -= d4; sd += d4;
      safeLines.push("-" + d4 + ": " + crimeMissed + " crime" + (crimeMissed === 1 ? "" : "s") + " missed");
    }
    if (safeScore < 0) safeScore = 0;
    if (safeScore > 25) safeScore = 25;
    if (sd === 0 && safeLines.length === 0) safeLines.push("No one was hurt");
    cats.push({ name: "Safety", score: Math.round(safeScore), max: 25, lines: safeLines });

    // Right to protest
    var protLines = [];
    var protScore = 25;
    var pd = 0;
    if (marchesArrived > 0) {
      var b1 = Math.min(8, 4 * marchesArrived);
      protScore += b1;
      protLines.push("+" + b1 + ": " + marchesArrived + " march" + (marchesArrived === 1 ? "" : "es") + " reached their goal");
    }
    if (marchesBroken > 0) {
      var d5 = Math.min(12, 6 * marchesBroken);
      protScore -= d5; pd += d5;
      protLines.push("-" + d5 + ": " + marchesBroken + " march" + (marchesBroken === 1 ? "" : "es") + " broken up");
    }
    if (kettles > 0) {
      var d6 = Math.min(8, 2 * kettles);
      protScore -= d6; pd += d6;
      protLines.push("-" + d6 + ": " + kettles + " kettle" + (kettles === 1 ? "" : "s") + " (" + kettledPeople + " people held)");
    }
    if (wrongArrests > 0) {
      var d7 = Math.min(10, 4 * wrongArrests);
      protScore -= d7; pd += d7;
      protLines.push("-" + d7 + ": " + wrongArrests + " wrong arrest" + (wrongArrests === 1 ? "" : "s"));
    }
    if (dispersed > 0) {
      var d8 = Math.min(8, 2 * dispersed);
      protScore -= d8; pd += d8;
      protLines.push("-" + d8 + ": " + dispersed + " crowd" + (dispersed === 1 ? "" : "s") + " dispersed");
    }
    if (gassedPeaceful > 0) {
      var d9 = Math.min(8, 4 * gassedPeaceful);
      protScore -= d9; pd += d9;
      protLines.push("-" + d9 + ": " + gassedPeaceful + " peaceful protester" + (gassedPeaceful === 1 ? "" : "s") + " gassed");
    }
    if (protScore < 0) protScore = 0;
    if (protScore > 25) protScore = 25;
    if (pd === 0 && protLines.length === 0) protLines.push("Protests were left alone");
    cats.push({ name: "Right to protest", score: Math.round(protScore), max: 25, lines: protLines });

    // City
    var cityLines = [];
    var cityScore = 25;
    var cd = 0;
    if (shopsTotal > 0) {
      var d10 = Math.min(12, Math.round(12 * shopsDamaged / shopsTotal));
      cityScore -= d10; cd += d10;
      cityLines.push("-" + d10 + ": " + shopsDamaged + " of " + shopsTotal + " shops damaged");
    } else {
      cityLines.push("No shops in this city");
    }
    if (landmarkDamage > 0) {
      var d11 = Math.min(8, 4 * landmarkDamage);
      cityScore -= d11; cd += d11;
      cityLines.push("-" + d11 + ": landmark damage (" + landmarkDamage + ")");
    }
    var netBarricades = barricadesBuilt - barricadesCleared;
    if (netBarricades > 0) {
      var d12 = Math.min(6, netBarricades);
      cityScore -= d12; cd += d12;
      cityLines.push("-" + d12 + ": " + netBarricades + " barricade" + (netBarricades === 1 ? "" : "s") + " left standing");
    } else if (barricadesCleared > 0) {
      cityLines.push(barricadesCleared + " barricade" + (barricadesCleared === 1 ? "" : "s") + " cleared");
    }
    if (crimeMissed > 0) {
      var d13 = Math.min(6, crimeMissed);
      cityScore -= d13; cd += d13;
      cityLines.push("-" + d13 + ": " + crimeMissed + " crime" + (crimeMissed === 1 ? "" : "s") + " missed");
    }
    if (cityScore < 0) cityScore = 0;
    if (cityScore > 25) cityScore = 25;
    if (cd === 0) cityLines.push("City left in good order");
    cats.push({ name: "City", score: Math.round(cityScore), max: 25, lines: cityLines });

    // Force used
    var forceLines = [];
    var forceScore = 25;
    var fd = 0;
    if (gasUsed > 0) {
      var d14 = Math.min(10, 3 * gasUsed);
      forceScore -= d14; fd += d14;
      forceLines.push("-" + d14 + ": " + gasUsed + " gas grenade" + (gasUsed === 1 ? "" : "s") + " fired");
    }
    if (waterUsed > 0) {
      var d15 = Math.min(8, 4 * waterUsed);
      forceScore -= d15; fd += d15;
      forceLines.push("-" + d15 + ": water cannon used " + waterUsed + " time" + (waterUsed === 1 ? "" : "s"));
    }
    if (horsePanics > 0) {
      var d16 = Math.min(6, 3 * horsePanics);
      forceScore -= d16; fd += d16;
      forceLines.push("-" + d16 + ": " + horsePanics + " horse panic" + (horsePanics === 1 ? "" : "s"));
    }
    if (snatchFailed > 0) {
      var d17 = Math.min(6, 3 * snatchFailed);
      forceScore -= d17; fd += d17;
      forceLines.push("-" + d17 + ": " + snatchFailed + " failed snatch" + (snatchFailed === 1 ? "" : "es"));
    }
    if (mediaIncidents > 0) {
      var d18 = Math.min(6, 2 * mediaIncidents);
      forceScore -= d18; fd += d18;
      forceLines.push("-" + d18 + ": " + mediaIncidents + " incident" + (mediaIncidents === 1 ? "" : "s") + " caught on camera");
    }
    if (mediaScore < 0) {
      var d19 = Math.min(6, Math.round(-mediaScore / 10));
      forceScore -= d19; fd += d19;
      forceLines.push("-" + d19 + ": bad press (media score " + Math.round(mediaScore) + ")");
    }
    if (forceScore < 0) forceScore = 0;
    if (forceScore > 25) forceScore = 25;
    if (fd === 0) forceLines.push("Minimum force used");
    cats.push({ name: "Force used", score: Math.round(forceScore), max: 25, lines: forceLines });

    var total = 0, i;
    for (i = 0; i < cats.length; i++) total += cats[i].score;
    r.score = Math.max(0, Math.min(100, Math.round(total)));
    r.cats = cats;

    if (typeof DISPATCH !== "undefined" && DISPATCH.score) {
      var handled = DISPATCH.handled || 0;
      var missed = DISPATCH.missed || 0;
      var avgResponse = DISPATCH.avgResponse || 0;
      var pulled = DISPATCH.pulled || 0;
      r.cats.push({
        name: "Radio",
        score: handled,
        max: handled + missed,
        lines: [
          "Calls handled " + handled + ", missed " + missed,
          "Average response " + Math.round(avgResponse) + " s",
          "Squads pulled off a big crowd " + pulled
        ]
      });
    }

    var sc = r.score;
    if (sc >= 85) { r.grade = "A"; r.title = "Textbook public order policing"; }
    else if (sc >= 70) { r.grade = "B"; r.title = "A well-managed day"; }
    else if (sc >= 55) { r.grade = "C"; r.title = "Mixed results"; }
    else if (sc >= 40) { r.grade = "D"; r.title = "A difficult day for the force"; }
    else { r.grade = "F"; r.title = "Order was lost"; }

    // Moments
    var moments = [];
    if (firstShopT >= 0) moments.push(fmtTime(firstShopT) + " first shop damaged");
    if (firstArrestT >= 0) moments.push(fmtTime(firstArrestT) + " first arrest");
    if (firstWrongT >= 0) moments.push(fmtTime(firstWrongT) + " first wrong arrest");
    if (peakMood > 0) moments.push("Peak crowd mood " + Math.round(peakMood));
    r.moments = moments.slice(0, 5);

    // Tips based on weakest categories
    var tips = [];
    var order = [];
    for (i = 0; i < cats.length; i++) {
      if (cats[i].name === "Radio") continue;
      order.push({ idx: i, pct: cats[i].score / cats[i].max, name: cats[i].name });
    }
    order.sort(function (a, b) { return a.pct - b.pct; });
    var tipPool = {
      "Safety": ["Put medics near crowded areas before fights start",
                 "Solve crimes quickly to keep people safe"],
      "Right to protest": ["Escort the march along its route instead of blocking it",
                           "Kettle only when a group turns violent"],
      "City": ["Clear barricades before the day ends",
               "Guard shop clusters so rioters cannot damage them"],
      "Force used": ["Use gas only on violent groups, never on a peaceful crowd",
                     "Pull snatch squads back when a grab fails"]
    };
    for (i = 0; i < order.length && tips.length < 3; i++) {
      var pool = tipPool[order[i].name];
      if (pool) {
        for (var j = 0; j < pool.length && tips.length < 3; j++) tips.push(pool[j]);
      }
    }
    r.tips = tips.slice(0, 3);

    if (G) G._debriefReport = r;
    return r;
  }

  function bestKey(G) {
    var seed = "default";
    if (typeof MAP !== "undefined" && MAP && MAP.seed) seed = String(MAP.seed);
    var lv = (typeof LEVELS !== "undefined") ? LEVELS.current().id : "tense";
    return "ppg_best_" + seed + (lv === "tense" ? "" : "_" + lv);
  }

  function saveBest(G) {
    try {
      var rep = G && G._debriefReport ? G._debriefReport : compute(G);
      var key = bestKey(G);
      var prev = null;
      try { prev = localStorage.getItem(key); } catch (e) { prev = null; }
      var prevScore = -1;
      if (prev) {
        try { var p = JSON.parse(prev); if (p && typeof p.score === "number") prevScore = p.score; } catch (e2) {}
      }
      if (rep.score > prevScore) {
        try { localStorage.setItem(key, JSON.stringify({ score: rep.score, grade: rep.grade })); } catch (e3) {}
      }
    } catch (e) {}
  }

  function getBest(G) {
    try {
      var key = bestKey(G);
      var v = localStorage.getItem(key);
      if (!v) return null;
      var p = JSON.parse(v);
      if (p && typeof p.score === "number" && p.grade) return p;
      return null;
    } catch (e) { return null; }
  }

  // ---- drawing helpers ----
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrap(ctx, text, maxW, font) {
    ctx.font = font;
    var words = String(text).split(" "), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur); cur = words[i];
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function gradeColor(g) {
    if (g === "A") return "#3fbf5f";
    if (g === "B") return "#8bc34a";
    if (g === "C") return "#e8b422";
    if (g === "D") return "#f08a24";
    return "#e63946";
  }

  function shade(hex, pct) {
    // pct 0..1 lerp toward dark
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    var f = 0.45 + 0.55 * pct;
    r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function draw(ctx, G, w, h) {
    var rep = compute(G);
    // once per match: remember the best from before this match, then save
    if (G && !G._debriefSaved) { G._debriefSaved = true; G._debriefPrevBest = getBest(G); saveBest(G); }

    ctx.save();
    ctx.fillStyle = "rgba(8,10,16,0.88)";
    ctx.fillRect(0, 0, w, h);

    var margin = 16;
    var panelW = Math.min(760, w - margin * 2);
    var panelX = (w - panelW) / 2;
    var pad = 18;
    var innerW = panelW - pad * 2;
    var y = 0;
    var contentH = 0;
    var lineH = 16;
    var font14 = "14px Consolas, monospace";
    var font12 = "12px Consolas, monospace";
    var fontBold = "bold 28px Consolas, monospace";
    var fontGrade = "bold 44px Consolas, monospace";
    var fontSmall = "12px Consolas, monospace";
    var fontHead = "bold 13px Consolas, monospace";

    // pre-measure vertical height roughly to center panel
    var rows = rep.cats.length;
    var catHeight = 0;
    var i, j, lines;
    var catLayout = [];
    for (i = 0; i < rows; i++) {
      var c = rep.cats[i];
      var sub = [];
      for (j = 0; j < c.lines.length; j++) {
        var ls = wrap(ctx, c.lines[j], innerW - 10, font12);
        for (var k = 0; k < ls.length; k++) sub.push(ls[k]);
      }
      catLayout.push(sub);
      catHeight += 22 + 6 + sub.length * lineH + 8;
    }
    var chartH = samples.length >= 2 ? 100 : 0;
    var headerH = 96;
    var footerH = 40;
    var colH = 0;
    if (rep.moments.length || rep.tips.length) {
      // count wrapped lines so the panel is tall enough
      var twoCol = innerW >= 480, cw = twoCol ? (innerW - 20) / 2 : innerW, mc = 0, tc = 0;
      for (i = 0; i < rep.moments.length; i++) mc += wrap(ctx, rep.moments[i], cw, font12).length;
      for (i = 0; i < rep.tips.length; i++) tc += wrap(ctx, "\u2022 " + rep.tips[i], cw, font12).length;
      colH = twoCol ? 22 + Math.max(mc, tc) * lineH + 10 : 44 + (mc + tc) * lineH + 18;
    }
    contentH = headerH + catHeight + (chartH ? chartH + 20 : 0) + colH + footerH + pad * 2;
    var panelY = Math.max(8, (h - contentH) / 2);
    var panelH = Math.min(h - 16, contentH);

    ctx.fillStyle = "#141a24";
    roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.fill();
    ctx.strokeStyle = "#2b3546";
    ctx.lineWidth = 1;
    ctx.stroke();

    y = panelY + pad;
    var x = panelX + pad;
    var cx = x;

    // Header
    ctx.fillStyle = "#e8edf5";
    ctx.font = fontBold;
    ctx.textBaseline = "top";
    ctx.fillText("DEBRIEF", cx, y);
    y += 34;
    ctx.font = font12;
    ctx.fillStyle = "#8a95a6";
    var er = G && G.endReason ? "Match ended: " + G.endReason : "Match over";
    ctx.fillText(er, cx, y);
    y += 20;

    // Grade circle
    var gc = gradeColor(rep.grade);
    var cy = y + 26;
    ctx.beginPath();
    ctx.arc(cx + 26, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = gc;
    ctx.fill();
    ctx.fillStyle = "#0c1118";
    ctx.font = fontGrade;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(rep.grade, cx + 26, cy + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Score and title
    var sx = cx + 66;
    ctx.fillStyle = "#e8edf5";
    ctx.font = "bold 22px Consolas, monospace";
    ctx.fillText(rep.score + " / 100", sx, y + 4);
    ctx.fillStyle = "#aeb8c7";
    ctx.font = font14;
    var titleLines = wrap(ctx, rep.title, innerW - 66, font14);
    for (i = 0; i < titleLines.length && i < 2; i++) {
      ctx.fillText(titleLines[i], sx, y + 32 + i * 16);
    }
    y += 58;

    // Categories
    for (i = 0; i < rep.cats.length; i++) {
      var cat = rep.cats[i];
      var pct = cat.max > 0 ? cat.score / cat.max : 0;
      if (pct < 0) pct = 0; if (pct > 1) pct = 1;
      ctx.font = "bold 13px Consolas, monospace";
      ctx.fillStyle = "#cdd6e2";
      ctx.textAlign = "left";
      ctx.fillText(cat.name, cx, y);
      // score right
      ctx.textAlign = "right";
      ctx.fillStyle = "#aeb8c7";
      ctx.fillText(cat.score + " / " + cat.max, cx + innerW, y);
      ctx.textAlign = "left";
      y += 18;
      // bar
      var barH = 8, barW = innerW;
      ctx.fillStyle = "#222a37";
      roundRect(ctx, cx, y, barW, barH, 4); ctx.fill();
      ctx.fillStyle = shade(gc, pct);
      roundRect(ctx, cx, y, Math.max(2, barW * pct), barH, 4); ctx.fill();
      y += barH + 6;
      // lines
      ctx.font = font12;
      ctx.fillStyle = "#8a95a6";
      var sub = catLayout[i];
      for (j = 0; j < sub.length; j++) {
        ctx.fillText(sub[j], cx + 4, y);
        y += lineH;
      }
      y += 6;
    }

    // Chart
    if (chartH > 0) {
      drawChart(ctx, cx, y, innerW, chartH);
      y += chartH + 20;
    }

    // Key moments and advice columns
    if (rep.moments.length || rep.tips.length) {
      var narrow = innerW < 480;
      if (narrow) {
        ctx.font = fontHead;
        ctx.fillStyle = "#cdd6e2";
        ctx.fillText("KEY MOMENTS", cx, y); y += 18;
        ctx.font = font12;
        ctx.fillStyle = "#9aa5b5";
        for (i = 0; i < rep.moments.length; i++) {
          var ml = wrap(ctx, rep.moments[i], innerW, font12);
          for (j = 0; j < ml.length; j++) { ctx.fillText(ml[j], cx + 4, y); y += lineH; }
        }
        y += 8;
        ctx.font = fontHead;
        ctx.fillStyle = "#cdd6e2";
        ctx.fillText("ADVICE", cx, y); y += 18;
        ctx.font = font12;
        ctx.fillStyle = "#9aa5b5";
        for (i = 0; i < rep.tips.length; i++) {
          var tl = wrap(ctx, "\u2022 " + rep.tips[i], innerW, font12);
          for (j = 0; j < tl.length; j++) { ctx.fillText(tl[j], cx + 4, y); y += lineH; }
        }
      } else {
        var colW = (innerW - 20) / 2;
        var leftX = cx, rightX = cx + colW + 20;
        var yy = y;
        ctx.font = fontHead;
        ctx.fillStyle = "#cdd6e2";
        ctx.fillText("KEY MOMENTS", leftX, yy);
        ctx.fillText("ADVICE", rightX, yy);
        yy += 18;
        ctx.font = font12;
        ctx.fillStyle = "#9aa5b5";
        for (i = 0; i < rep.moments.length; i++) {
          var ml2 = wrap(ctx, rep.moments[i], colW, font12);
          for (j = 0; j < ml2.length; j++) { ctx.fillText(ml2[j], leftX + 4, yy); yy += lineH; }
        }
        var yy2 = y + 18;
        ctx.fillStyle = "#9aa5b5";
        for (i = 0; i < rep.tips.length; i++) {
          var tl2 = wrap(ctx, "\u2022 " + rep.tips[i], colW, font12);
          for (j = 0; j < tl2.length; j++) { ctx.fillText(tl2[j], rightX + 4, yy2); yy2 += lineH; }
        }
        y = Math.max(yy, yy2) + 10;
      }
    }

    // Footer
    y = panelY + panelH - footerH + 6;
    ctx.font = font14;
    ctx.fillStyle = "#ffd866";
    ctx.fillText("R replay this map   N next map   M main menu", cx, y);
    var best = G ? G._debriefPrevBest : null;
    ctx.font = font12;
    ctx.fillStyle = "#8a95a6";
    if (best && rep.score > best.score) ctx.fillText("New best on this city! (was " + best.grade + " " + best.score + ")", cx, y + 18);
    else if (best) ctx.fillText("Best on this city: " + best.grade + " (" + best.score + ")", cx, y + 18);

    ctx.restore();
  }

  function drawChart(ctx, x, y, w, h) {
    var padL = 34, padR = 8, padT = 6, padB = 18;
    var gw = w - padL - padR, gh = h - padT - padB;
    if (gw <= 4 || gh <= 4) return;
    // frame
    ctx.fillStyle = "#0f141d";
    roundRect(ctx, x, y, w, h, 6); ctx.fill();
    ctx.strokeStyle = "#222a37";
    ctx.lineWidth = 1;
    ctx.stroke();

    var n = samples.length;
    var t0 = samples[0].t, t1 = samples[n - 1].t;
    var span = Math.max(1e-6, t1 - t0);
    function tx(t) { return x + padL + gw * ((t - t0) / span); }
    function vy(v) { return y + padT + gh * (1 - Math.max(0, Math.min(100, v)) / 100); }

    // gridlines 0/50/100
    ctx.strokeStyle = "#1b2230";
    ctx.beginPath();
    for (var g = 0; g <= 2; g++) {
      var gy = y + padT + gh * (g / 2);
      ctx.moveTo(x + padL, gy); ctx.lineTo(x + padL + gw, gy);
    }
    ctx.stroke();
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "#5d6879";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText("100", x + padL - 4, y + padT);
    ctx.fillText("50", x + padL - 4, y + padT + gh / 2);
    ctx.fillText("0", x + padL - 4, y + padT + gh);
    ctx.textAlign = "left"; ctx.textBaseline = "top";

    // mood line
    ctx.strokeStyle = "#f4a261";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var px = tx(samples[i].t), py = vy(samples[i].mood);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // media line
    ctx.strokeStyle = "#4a7fd0";
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      px = tx(samples[i].t); py = vy(samples[i].media);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // shop damage ticks
    var lastShop = -1;
    ctx.fillStyle = "#e63946";
    for (i = 0; i < n; i++) {
      if (samples[i].shops > lastShop && lastShop >= 0) {
        var tickX = tx(samples[i].t);
        ctx.fillRect(tickX - 1, y + padT + gh - 4, 2, 4);
      }
      if (samples[i].shops > lastShop) lastShop = samples[i].shops;
    }

    // axis labels
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "#5d6879";
    ctx.fillText(fmtTime(t0), x + padL, y + h - padB + 4);
    ctx.textAlign = "right";
    ctx.fillText(fmtTime(t1), x + padL + gw, y + h - padB + 4);
    ctx.textAlign = "left";

    // legend
    ctx.fillStyle = "#f4a261";
    ctx.fillRect(x + padL + 4, y + 2, 8, 3);
    ctx.fillStyle = "#8a95a6";
    ctx.font = "10px Consolas, monospace";
    ctx.fillText("mood", x + padL + 16, y + 1);
    ctx.fillStyle = "#4a7fd0";
    ctx.fillRect(x + padL + 60, y + 2, 8, 3);
    ctx.fillStyle = "#8a95a6";
    ctx.fillText("media", x + padL + 72, y + 1);
    ctx.fillStyle = "#e63946";
    ctx.fillRect(x + padL + 120, y + 2, 3, 4);
    ctx.fillStyle = "#8a95a6";
    ctx.fillText("shops", x + padL + 128, y + 1);
  }

  return { init: init, update: update, compute: compute, draw: draw, saveBest: saveBest };
})();
if (typeof module !== "undefined" && module.exports) module.exports = DEBRIEF;
