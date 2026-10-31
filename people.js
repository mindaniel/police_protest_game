var PEOPLE = (function () {
  var TILE = 32, W = 9, H = 15;
  var SKINS = ["#f2d0b0", "#e8b48d", "#d29b6f", "#b57a4e", "#8d5a3a", "#5e3a24"];
  var HAIRS = ["#1c1410", "#3a2417", "#5c3a1e", "#8a6a3a", "#c9a869", "#9a9a9a"];
  var PANTS = ["#2f4b6e", "#1e2a3a", "#111", "#a08a5c", "#555", "#3b3b4a"];
  var TOPS = ["tshirt", "jacket", "hoodie"];
  var HATS = [null, null, null, "cap", "beanie"];
  var cache = {}, kHistory = [];

  function hash(n, s) {
    var h = (n * 2654435761 + (s || 0) * 40503) >>> 0;
    h ^= h >>> 13; h = (h * 1274126177) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  function pick(arr, h) { return arr[h % arr.length]; }
  function hx(h, i) { return hash(h, i); }

  function civSpec(id, moodColor) {
    var h = hash(id, 7);
    var spec = {
      kind: "civ",
      shirt: moodColor || "#8899aa",
      pants: pick(PANTS, hx(h, 1)),
      skin: pick(SKINS, hx(h, 2)),
      hair: pick(HAIRS, hx(h, 3)),
      hat: pick(HATS, hx(h, 4)),
      top: pick(TOPS, hx(h, 5)),
      backpack: (hx(h, 6) % 100) < 30,
      scarf: (hx(h, 7) % 100) < 15 ? pick(["#aa3333", "#336699", "#dddddd", "#333333"], hx(h, 8)) : null,
      sign: (hx(h, 9) % 100) < 8 ? pick(["placard", "flag"], hx(h, 10)) : null,
      signColor: pick(["#ffffff", "#ffee66", "#ff6644", "#66ccff", "#ffffff"], hx(h, 11))
    };
    return spec;
  }

  function darken(col, f) {
    var n = parseInt(col.slice(1), 16);
    var r = Math.max(0, Math.floor(((n >> 16) & 255) * f));
    var g = Math.max(0, Math.floor(((n >> 8) & 255) * f));
    var b = Math.max(0, Math.floor((n & 255) * f));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function lighten(col, f) {
    var n = parseInt(col.slice(1), 16);
    var r = Math.min(255, Math.floor(((n >> 16) & 255) * f + (f > 1 ? (f - 1) * 255 : 0)));
    var g = Math.min(255, Math.floor(((n >> 8) & 255) * f + (f > 1 ? (f - 1) * 255 : 0)));
    var b = Math.min(255, Math.floor((n & 255) * f + (f > 1 ? (f - 1) * 255 : 0)));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function keyOf(spec) {
    if (spec._key) return spec._key;
    var d = {
      kind: "civ", shirt: "#888", pants: "#333", skin: "#e8b48d",
      hair: "#3a2417", hat: null, top: "tshirt", backpack: false,
      scarf: null, sign: null, signColor: "#fff"
    };
    var k = "";
    for (var key in d) {
      if (d.hasOwnProperty(key)) {
        k += key + ":" + (spec[key] === undefined || spec[key] === null ? "" : spec[key]) + "|";
      }
    }
    spec._key = k;
    return k;
  }

  function rr(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2; if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Draws one figure in world units, origin at feet centre (0,0), up is -y.
  function drawFigure(ctx, spec, frame) {
    var stand = frame === 0;
    var walkT = stand ? 0 : (frame / 5) * Math.PI * 2;
    var swing = stand ? 0 : Math.sin(walkT) * 2.2;
    var bob = (frame === 2 || frame === 4) ? 0.5 : 0;

    // legs
    ctx.fillStyle = spec.pants;
    var lx = -2.4, rx2 = 0.4;
    rr(ctx, lx, -7 - bob + Math.abs(swing) * 0.15, 3.2, 7, 1.2); ctx.fill();
    rr(ctx, rx2, -7 - bob + Math.abs(swing) * 0.15, 3.2, 7, 1.2); ctx.fill();
    // shoes
    ctx.fillStyle = "#1a1a1a";
    rr(ctx, lx + (swing < 0 ? -swing * 0.3 : 0), -1.4 - bob, 3.2, 1.5, 0.7); ctx.fill();
    rr(ctx, rx2 + (swing > 0 ? swing * 0.3 : 0), -1.4 - bob, 3.2, 1.5, 0.7); ctx.fill();

    // torso
    var tTop = -13.5 - bob, tBot = -7 - bob;
    var tW = 7.4, tX = -3.7;
    ctx.fillStyle = spec.shirt;
    rr(ctx, tX, tTop, tW, tBot - tTop, 2); ctx.fill();
    // darker side
    ctx.fillStyle = "rgba(0,0,0,0.13)";
    rr(ctx, tX + tW * 0.55, tTop + 0.5, tW * 0.45, tBot - tTop - 1, 1.5); ctx.fill();
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    rr(ctx, tX + 0.4, tTop + 0.4, tW * 0.4, 3, 1.2); ctx.fill();

    if (spec.top === "jacket") {
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, tTop + 1); ctx.lineTo(0, tBot - 1); ctx.stroke();
    }
    if (spec.top === "hoodie" && spec.hat !== "hood") {
      ctx.fillStyle = darken(spec.shirt, 0.8);
      ctx.beginPath(); ctx.ellipse(0, tTop + 0.5, 3.4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }

    // officer/riot/medic/liaison accents
    if (spec.kind === "officer" || spec.kind === "liaison") {
      ctx.fillStyle = spec.kind === "liaison" ? "#33aaff" : "#e8d84a";
      if (spec.kind === "officer") {
        ctx.fillRect(-3.2, -11.2 - bob, 6.4, 0.9);
      } else {
        rr(ctx, tX + 0.6, tTop + 0.8, tW - 1.2, tBot - tTop - 1.6, 1.5);
        ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    if (spec.kind === "medic") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-0.7, -11.5 - bob, 1.4, 3.2);
      ctx.fillRect(-1.6, -10.6 - bob, 3.2, 1.4);
    }

    // arms
    var armSwing = stand ? 0 : -swing * 0.7;
    ctx.fillStyle = spec.shirt;
    rr(ctx, -5.2, -12.8 - bob + armSwing, 1.8, 5.5, 0.9); ctx.fill();
    rr(ctx, 3.4, -12.8 - bob - armSwing, 1.8, 5.5, 0.9); ctx.fill();
    ctx.fillStyle = spec.skin;
    ctx.beginPath(); ctx.arc(-4.3, -7.2 - bob + armSwing, 0.95, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4.3, -7.2 - bob - armSwing, 0.95, 0, Math.PI * 2); ctx.fill();

    // scarf
    if (spec.scarf) {
      ctx.fillStyle = spec.scarf;
      rr(ctx, -3.5, -14.2 - bob, 7, 1.1, 0.5); ctx.fill();
    }

    // backpack
    if (spec.backpack) {
      ctx.fillStyle = "#2a2a35";
      rr(ctx, 2.6, -13 - bob, 2, 4.5, 0.7); ctx.fill();
    }

    // head
    var hy = -15.2 - bob, hr = 2.35;
    ctx.fillStyle = spec.skin;
    ctx.beginPath(); ctx.arc(0, hy, hr, 0, Math.PI * 2); ctx.fill();

    // hair / hat
    var hat = spec.hat;
    if (hat === null) {
      ctx.fillStyle = spec.hair;
      ctx.beginPath();
      ctx.arc(0, hy - 0.3, hr, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
    } else if (hat === "hood") {
      ctx.fillStyle = darken(spec.shirt, 0.78);
      ctx.beginPath(); ctx.arc(0, hy, hr + 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = spec.skin;
      ctx.beginPath(); ctx.arc(0, hy + 0.15, hr - 0.4, 0, Math.PI * 2); ctx.fill();
    } else if (hat === "beanie") {
      ctx.fillStyle = spec.hair || "#3a2417";
      ctx.beginPath(); ctx.arc(0, hy - 0.2, hr + 0.25, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(-hr - 0.2, hy - 0.5, (hr + 0.2) * 2, 1);
    } else if (hat === "cap") {
      ctx.fillStyle = spec.kind === "officer" ? "#dfe4ea" : darken(spec.shirt, 0.7);
      ctx.beginPath(); ctx.arc(0, hy - 0.2, hr + 0.3, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(-hr - 0.4, hy - 0.6, (hr + 0.4) * 2, 0.9);
    } else if (hat === "helmet") {
      ctx.fillStyle = "#e0c020";
      ctx.beginPath(); ctx.arc(0, hy - 0.3, hr + 0.8, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(-1, hy - 1.2, 1, 0, Math.PI * 2); ctx.fill();
    } else if (hat === "riothelmet") {
      ctx.fillStyle = "#1c1c1c";
      ctx.beginPath(); ctx.arc(0, hy - 0.3, hr + 0.9, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillStyle = "#7fc8ff";
      ctx.fillRect(-hr - 0.4, hy - 0.4, (hr + 0.4) * 2, 0.9);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath(); ctx.arc(-1, hy - 1.5, 1.1, 0, Math.PI * 2); ctx.fill();
    }

    // sign
    if (spec.sign === "placard" || spec.sign === "flag") {
      var sx = 4.5, sy = -15 - bob;
      ctx.strokeStyle = "#5a4632"; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(sx, -8); ctx.lineTo(sx, sy - (spec.sign === "placard" ? 4 : 6)); ctx.stroke();
      if (spec.sign === "placard") {
        ctx.fillStyle = spec.signColor || "#fff";
        rr(ctx, sx - 4, sy - 9, 8, 5, 0.6); ctx.fill();
        ctx.strokeStyle = "#333"; ctx.lineWidth = 0.4;
        ctx.beginPath(); ctx.moveTo(sx - 3, sy - 7.5); ctx.lineTo(sx + 2, sy - 7.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx - 3, sy - 6); ctx.lineTo(sx + 1, sy - 6); ctx.stroke();
      } else {
        ctx.fillStyle = spec.signColor || "#fff";
        ctx.beginPath();
        ctx.moveTo(sx, sy - 11);
        ctx.quadraticCurveTo(sx + 5, sy - 10, sx + 7, sy - 12);
        ctx.lineTo(sx + 7, sy - 6.5);
        ctx.quadraticCurveTo(sx + 5, sy - 4.5, sx, sy - 5.5);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function sprite(spec, frame, k) {
    k = Math.round(k * 100) / 100;
    if (!spec._key) keyOf(spec);
    var key = spec._key + "#" + frame + "@" + k;
    var hit = cache[key];
    if (hit) return hit;

    var sign = spec.sign;
    var pad = 4, extraTop = 0;
    if (sign === "placard") extraTop = 5;
    if (sign === "flag") extraTop = 7;

    var wu = W + pad * 2;
    var hu = H + pad + 3 + extraTop;
    var cw = Math.ceil(wu * k), ch = Math.ceil(hu * k);
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    var ctx = c.getContext("2d");
    ctx.translate(cw / 2, ch - pad * k);
    ctx.scale(k, k);

    // silhouette outline
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(0, 0);
    ctx.scale(1, 1);
    // shadow first
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath(); ctx.ellipse(0, -0.3, 4.5, 1.75, 0, 0, Math.PI * 2); ctx.fill();

    // silhouette pass (draw figure slightly larger in dark)
    ctx.save();
    ctx.scale(1.08, 1.08);
    ctx.translate(0.2, 0.2);
    ctx.globalAlpha = 0.35;
    // temporarily replace colors with dark by drawing then overlay is complex;
    // simple: draw figure into offscreen then use as mask - too costly. Instead
    // draw a dark figure outline by drawing figure with all fills dark.
    drawDark(ctx, spec, frame);
    ctx.restore();

    drawFigure(ctx, spec, frame);

    // restore
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.restore();

    var ax = cw / 2;
    var ay = ch - pad * k;
    var res = { c: c, ax: ax, ay: ay };

    if (kHistory.indexOf(k) < 0) {
      kHistory.push(k);
      if (kHistory.length > 2) {
        var old = kHistory.shift();
        for (var kk in cache) {
          if (cache.hasOwnProperty(kk)) {
            var idx = kk.lastIndexOf("@");
            if (parseFloat(kk.slice(idx + 1)) === old) delete cache[kk];
          }
        }
      }
    }
    cache[key] = res;
    return res;
  }

  // dark silhouette version for outline
  function drawDark(ctx, spec, frame) {
    var old = {};
    var fields = ["shirt", "pants", "skin", "hair"];
    for (var i = 0; i < fields.length; i++) { old[fields[i]] = spec[fields[i]]; }
    spec.shirt = "#000"; spec.pants = "#000"; spec.skin = "#000"; spec.hair = "#000";
    var oldScarf = spec.scarf; spec.scarf = spec.scarf ? "#000" : null;
    var oldSign = spec.sign; spec.sign = null;
    var oldHat = spec.hat;
    drawFigure(ctx, spec, frame);
    spec.shirt = old.shirt; spec.pants = old.pants; spec.skin = old.skin; spec.hair = old.hair;
    spec.scarf = oldScarf; spec.sign = oldSign; spec.hat = oldHat;
  }

  function frameFor(id, speed, t) {
    if (speed < 0.15) return 0;
    var f = t * (4 + speed * 2) + id * 0.37;
    return 1 + (Math.floor(f % 5));
  }

  return { sprite: sprite, civSpec: civSpec, frameFor: frameFor };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PEOPLE;
