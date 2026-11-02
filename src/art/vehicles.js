var VEHICLES = (function () {
  var TAU = Math.PI * 2;
  var SIZES = {
    car: { len: 54, wid: 26 },
    van: { len: 66, wid: 29 },
    truck: { len: 90, wid: 34 },
    watertruck: { len: 80, wid: 32 },
    barriertruck: { len: 80, wid: 32 },
    ambulance: { len: 64, wid: 29 }
  };
  var baseCache = {};
  var baseCacheK = null;
  var spriteCache = {};
  var spriteK = [];

  function rnd(ctx, x, y, w, h, r) {
    var p = ctx;
    p.beginPath();
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r);
    p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h);
    p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r);
    p.quadraticCurveTo(x, y, x + r, y);
    p.closePath();
  }

  function grid(ctx, x, y, w, h, col, step) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.35;
    var i;
    for (i = x; i < x + w; i += step) {
      ctx.beginPath(); ctx.moveTo(i, y); ctx.lineTo(i, y + h); ctx.stroke();
    }
    for (i = y; i < y + h; i += step) {
      ctx.beginPath(); ctx.moveTo(x, i); ctx.lineTo(x + w, i); ctx.stroke();
    }
    ctx.restore();
  }

  function battenburg(ctx, x, y, w, h) {
    var cols = 2, rows = 1, cw = w / 6, ch = h;
    var i, j;
    for (i = 0; i < 6; i++) {
      for (j = 0; j < rows; j++) {
        ctx.fillStyle = ((i + j) % 2 === 0) ? "#1a3a8a" : "#f2c200";
        ctx.fillRect(x + i * cw, y + j * ch, cw, ch);
      }
    }
  }

  function drawWheels(ctx, L, W) {
    var wl = 8, ww = 4.5;
    var axles = [L * 0.18, L * 0.82];
    var i;
    ctx.fillStyle = "#151515";
    for (i = 0; i < axles.length; i++) {
      rnd(ctx, axles[i] - wl / 2, -W / 2 - 0.5, wl, ww, 1); ctx.fill();
      rnd(ctx, axles[i] - wl / 2, W / 2 - ww + 0.5, wl, ww, 1); ctx.fill();
    }
    ctx.fillStyle = "#2a2a2a";
    for (i = 0; i < axles.length; i++) {
      rnd(ctx, axles[i] - wl / 2 + 1, -W / 2 + 0.5, wl - 2, ww - 1, 0.5); ctx.fill();
      rnd(ctx, axles[i] - wl / 2 + 1, W / 2 - ww + 1.5, wl - 2, ww - 1, 0.5); ctx.fill();
    }
  }

  function drawMirrors(ctx, L, W) {
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(L * 0.62, -W / 2 - 3, 3, 2.5);
    ctx.fillRect(L * 0.62, W / 2 + 0.5, 3, 2.5);
  }

  function drawGlass(ctx, x, y, w, h) {
    rnd(ctx, x, y, w, h, 1.2);
    ctx.fillStyle = "#20262e";
    ctx.fill();
    ctx.strokeStyle = "#4a5560";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(180,210,235,0.35)";
    ctx.fillRect(x + w * 0.15, y + h * 0.2, w * 0.35, h * 0.35);
  }

  function drawLights(ctx, L, W, off) {
    ctx.fillStyle = off ? "#7a1010" : "#ff2020";
    ctx.fillRect(L * 0.02, -W / 2 + 2, 4, 5);
    ctx.fillRect(L * 0.02, W / 2 - 7, 4, 5);
    ctx.fillStyle = off ? "#10107a" : "#2040ff";
    ctx.fillRect(L * 0.02, -W / 2 + 8, 4, 5);
    ctx.fillRect(L * 0.02, W / 2 - 13, 4, 5);
    ctx.fillStyle = "#f8f0c0";
    ctx.fillRect(L - 5, -W / 2 + 2, 3, 5);
    ctx.fillRect(L - 5, W / 2 - 7, 3, 5);
    ctx.fillStyle = "#c02020";
    ctx.fillRect(-1, -W / 2 + 2, 2, 5);
    ctx.fillRect(-1, W / 2 - 7, 2, 5);
  }

  function drawLightBar(ctx, x, y, w, h, lightsOn) {
    rnd(ctx, x, y, w, h, 1);
    ctx.fillStyle = "#222";
    ctx.fill();
    ctx.fillStyle = lightsOn ? "#ff3030" : "#2030ff";
    ctx.fillRect(x + 0.5, y + 0.5, w / 2 - 0.5, h - 1);
    ctx.fillStyle = lightsOn ? "#2030ff" : "#ff3030";
    ctx.fillRect(x + w / 2, y + 0.5, w / 2 - 0.5, h - 1);
  }

  function drawBody(ctx, L, W, colTop, colSide) {
    rnd(ctx, -L / 2, -W / 2 + 3, L, W, 5);
    ctx.fillStyle = colSide;
    ctx.fill();
    rnd(ctx, -L / 2, -W / 2, L, W, 5);
    ctx.fillStyle = colTop;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  function drawCar(ctx, L, W, lightsOn) {
    drawBody(ctx, L, W, "#f2f2f2", "#c8c8c8");
    ctx.fillStyle = "#111";
    ctx.fillRect(-L / 2 + 4, -W / 2 + 4, L * 0.55, W - 8);
    battenburg(ctx, -L * 0.05, -W / 2 + 1, L * 0.45, 4);
    battenburg(ctx, -L * 0.05, W / 2 - 5, L * 0.45, 4);
    drawGlass(ctx, -L * 0.35, -W / 2 + 4, L * 0.22, W - 8);
    drawGlass(ctx, L * 0.15, -W / 2 + 4, L * 0.12, W - 8);
    ctx.fillStyle = "#20262e";
    ctx.fillRect(-L * 0.30, -W / 2 + 5, 3, 4);
    ctx.fillRect(-L * 0.30, W / 2 - 9, 3, 4);
    drawMirrors(ctx, L, W);
    drawLightBar(ctx, -L * 0.02, -W / 2 + 2, 8, W - 4, lightsOn);
    ctx.fillStyle = "#000";
    ctx.font = "bold " + (W * 0.55).toFixed(1) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("12", L * 0.12, 0);
    drawWheels(ctx, L, W);
    drawLights(ctx, L, W, lightsOn);
  }

  function drawVan(ctx, L, W, lightsOn) {
    drawBody(ctx, L, W, "#f2f2f2", "#c8c8c8");
    battenburg(ctx, -L * 0.05, -W / 2 + 1, L * 0.5, 4);
    battenburg(ctx, -L * 0.05, W / 2 - 5, L * 0.5, 4);
    drawGlass(ctx, L * 0.22, -W / 2 + 4, L * 0.12, W - 8);
    drawGlass(ctx, -L * 0.05, -W / 2 + 3, L * 0.18, 4);
    drawGlass(ctx, -L * 0.05, W / 2 - 7, L * 0.18, 4);
    drawMirrors(ctx, L, W);
    drawLightBar(ctx, L * 0.05, -W / 2 + 2, 9, W - 4, lightsOn);
    rnd(ctx, -L * 0.28, -W * 0.18, 10, W * 0.36, 1.5);
    ctx.fillStyle = "#bbb";
    ctx.fill();
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = "#1a3a8a";
    ctx.font = "bold " + (W * 0.32).toFixed(1) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("POLICE", L * 0.02, 0);
    drawWheels(ctx, L, W);
    drawLights(ctx, L, W, lightsOn);
  }

  function drawTruck(ctx, L, W, lightsOn) {
    drawBody(ctx, L, W, "#2a3450", "#1a2236");
    ctx.fillStyle = "#3a4458";
    ctx.fillRect(-L * 0.4, -W / 2 + 4, L * 0.78, W - 8);
    ctx.fillStyle = "#4a5568";
    var i;
    for (i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(-L * 0.35 + i * L * 0.14, -W / 2 + 6, 0.7, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-L * 0.35 + i * L * 0.14, W / 2 - 6, 0.7, 0, TAU);
      ctx.fill();
    }
    drawGlass(ctx, L * 0.25, -W / 2 + 4, L * 0.12, W - 8);
    grid(ctx, L * 0.25, -W / 2 + 4, L * 0.12, W - 8, "#0a0a0a", 1.5);
    drawGlass(ctx, -L * 0.02, -W / 2 + 4, L * 0.1, 4);
    drawGlass(ctx, -L * 0.02, W / 2 - 8, L * 0.1, 4);
    drawMirrors(ctx, L, W);
    drawLightBar(ctx, L * 0.05, -W / 2 + 2, 9, W - 4, lightsOn);
    ctx.fillStyle = "#555";
    ctx.fillRect(L * 0.4, -W / 2 + 3, 3, W - 6);
    drawWheels(ctx, L, W);
    drawLights(ctx, L, W, lightsOn);
  }

  function drawWater(ctx, L, W, lightsOn) {
    drawBody(ctx, L, W, "#4a6aa0", "#2a4a80");
    ctx.fillStyle = "#e8e8f0";
    ctx.fillRect(-L / 2 + 4, -W / 2 + 3, L * 0.5, W - 6);
    rnd(ctx, -L * 0.42, -W * 0.32, L * 0.4, W * 0.64, 4);
    ctx.fillStyle = "#c0c8d8";
    ctx.fill();
    ctx.strokeStyle = "#7080a0";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    drawGlass(ctx, L * 0.22, -W / 2 + 4, L * 0.12, W - 8);
    drawMirrors(ctx, L, W);
    drawLightBar(ctx, L * 0.02, -W / 2 + 2, 8, W - 4, lightsOn);
    ctx.beginPath();
    ctx.arc(L * 0.12, 0, 5, 0, TAU);
    ctx.fillStyle = "#8a9ab0";
    ctx.fill();
    ctx.strokeStyle = "#303840";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#303840";
    ctx.fillRect(L * 0.16, -1, 8, 2);
    drawWheels(ctx, L, W);
    drawLights(ctx, L, W, lightsOn);
  }

  function drawBarrier(ctx, L, W, lightsOn) {
    drawBody(ctx, L, W, "#f2f2f2", "#c8c8c8");
    ctx.fillStyle = "#ddd";
    ctx.fillRect(-L * 0.45, -W / 2 + 3, L * 0.6, W - 6);
    var i, j;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 4; j++) {
        ctx.fillStyle = ((i + j) % 2 === 0) ? "#e8c020" : "#c02020";
        ctx.fillRect(-L * 0.42 + j * L * 0.13, -W / 2 + 5 + i * (W - 10) / 3, L * 0.13, (W - 10) / 3);
      }
    }
    drawGlass(ctx, L * 0.22, -W / 2 + 4, L * 0.12, W - 8);
    drawMirrors(ctx, L, W);
    drawLightBar(ctx, L * 0.02, -W / 2 + 2, 8, W - 4, lightsOn);
    drawWheels(ctx, L, W);
    drawLights(ctx, L, W, lightsOn);
  }

  function drawAmbulance(ctx, L, W, lightsOn) {
    drawBody(ctx, L, W, "#f0f4e8", "#c8d0b8");
    battenburg(ctx, -L * 0.02, -W / 2 + 1, L * 0.48, 4);
    battenburg(ctx, -L * 0.02, W / 2 - 5, L * 0.48, 4);
    drawGlass(ctx, L * 0.22, -W / 2 + 4, L * 0.12, W - 8);
    drawMirrors(ctx, L, W);
    drawLightBar(ctx, L * 0.05, -W / 2 + 2, 8, W - 4, lightsOn);
    ctx.fillStyle = "#c02020";
    ctx.fillRect(-L * 0.22, -1.5, 8, 3);
    ctx.fillRect(-L * 0.22 + 2.5, -4, 3, 8);
    ctx.fillStyle = "#4a8a3a";
    ctx.font = "bold " + (W * 0.28).toFixed(1) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AMB", -L * 0.32, 0);
    drawWheels(ctx, L, W);
    drawLights(ctx, L, W, lightsOn);
  }

  function buildBase(type, k, lightsOn) {
    var s = SIZES[type];
    var pad = 10;
    var cw = Math.ceil((s.len + pad * 2) * k);
    var ch = Math.ceil((s.wid + pad * 2) * k);
    var c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext("2d");
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(k, k);
    if (type === "car") drawCar(ctx, s.len, s.wid, lightsOn);
    else if (type === "van") drawVan(ctx, s.len, s.wid, lightsOn);
    else if (type === "truck") drawTruck(ctx, s.len, s.wid, lightsOn);
    else if (type === "watertruck") drawWater(ctx, s.len, s.wid, lightsOn);
    else if (type === "barriertruck") drawBarrier(ctx, s.len, s.wid, lightsOn);
    else drawAmbulance(ctx, s.len, s.wid, lightsOn);
    return c;
  }

  function getBase(type, k, lightsOn) {
    var key = type + "|" + lightsOn;
    if (!baseCache[key] || baseCacheK !== k) {
      baseCache = {};
      baseCacheK = k;
    }
    if (!baseCache[key]) baseCache[key] = buildBase(type, k, lightsOn);
    return baseCache[key];
  }

  function angleIndex(ang) {
    var a = ang / TAU;
    a = a - Math.floor(a);
    return Math.round(a * 32) % 32;
  }

  function size(type) {
    var s = SIZES[type];
    return { len: s.len, wid: s.wid };
  }

  function sprite(type, angleIndexVal, k, lightsOn) {
    k = Math.round(k * 100) / 100;
    var idx = ((angleIndexVal % 32) + 32) % 32;
    var lo = lightsOn ? 1 : 0;
    if (spriteK.indexOf(k) < 0) {
      if (spriteK.length >= 2) {
        spriteK = [k];
        spriteCache = {};
      } else {
        spriteK.push(k);
      }
    }
    var key = type + "|" + idx + "|" + k + "|" + lo;
    if (spriteCache[key]) return spriteCache[key];

    var base = getBase(type, k, lo);
    /* room for any heading: the rotated vehicle needs its diagonal */
    var cw = Math.ceil(Math.sqrt(base.width * base.width + base.height * base.height) + 14 * k);
    var ch = cw;
    var c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext("2d");
    var cx = cw / 2, cy = ch / 2;
    var ang = idx * TAU / 32;
    var s = SIZES[type];

    // soft shadow: outline shifted down-right, blurred
    ctx.save();
    ctx.translate(cx + 3 * k, cy + 3 * k);
    ctx.rotate(ang);
    ctx.scale(k, k);
    rnd(ctx, -s.len / 2, -s.wid / 2, s.len, s.wid, 5);
    ctx.restore();
    var i;
    for (i = 0; i < 3; i++) {
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.translate(cx + 3 * k + (i - 1) * 0.8, cy + 3 * k + (i - 1) * 0.8);
      ctx.rotate(ang);
      ctx.scale(k, k);
      rnd(ctx, -s.len / 2, -s.wid / 2, s.len, s.wid, 5);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    ctx.restore();

    var res = { c: c, ax: cx, ay: cy };
    spriteCache[key] = res;
    return res;
  }

  return { sprite: sprite, angleIndex: angleIndex, size: size };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VEHICLES;
