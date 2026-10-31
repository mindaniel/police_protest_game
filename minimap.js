var MINIMAP = (function () {
  var hidden = false;
  var dragging = false;
  var base = null;
  var baseRef = null;
  var px = 2; // offscreen px per tile
  var api = {};

  function mapArea() {
    var LW = MAP.width * CONFIG.tileSize;
    var LH = MAP.height * CONFIG.tileSize;
    var pad = 12, bottom = 40;
    var w = Math.round(LW * 0.2);
    var h = Math.round(w * MAP.height / MAP.width);
    var maxH = Math.round(LH * 0.28);
    if (h > maxH) {
      h = maxH;
      w = Math.round(h * MAP.width / MAP.height);
    }
    return { x: LW - pad - w, y: LH - bottom - h, w: w, h: h };
  }

  function visible() {
    return api.forced || hidden === false && MAP.width * MAP.height > 9000 || hidden === false && api.forced;
  }

  function shouldShow() {
    if (hidden) return false;
    return api.forced || MAP.width * MAP.height > 9000;
  }

  function tileColor(ch) {
    if (ch === '#') return '#8c8a86';
    if (ch === 'S') return '#8c8a86';
    if (ch === '.') return '#cfd2d6';
    if (ch === 'a') return '#bfc2c6';
    if (ch === 'P') return '#e0d8c8';
    if (ch === 'G') return '#8fbf7a';
    if (ch === 'T') return '#8fbf7a';
    if (ch === 'W') return '#6fa6d6';
    return null;
  }

  function buildBase() {
    if (baseRef === MAP.rows && base) return;
    baseRef = MAP.rows;
    base = document.createElement('canvas');
    base.width = MAP.width * px;
    base.height = MAP.height * px;
    var c = base.getContext('2d');
    var y, x, ch, col, i;
    for (y = 0; y < MAP.height; y++) {
      var row = MAP.rows[y];
      for (x = 0; x < MAP.width; x++) {
        ch = row.charAt(x);
        col = tileColor(ch);
        if (col) {
          c.fillStyle = col;
          c.fillRect(x * px, y * px, px, px);
        }
      }
    }
    // darker edge on buildings next to roads
    c.fillStyle = '#6f6d69';
    for (y = 0; y < MAP.height; y++) {
      row = MAP.rows[y];
      for (x = 0; x < MAP.width; x++) {
        ch = row.charAt(x);
        if (ch !== '#' && ch !== 'S') continue;
        var nx, ny, nch;
        if (x > 0) {
          nch = row.charAt(x - 1);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px, y * px, 1, px); }
        }
        if (x < MAP.width - 1) {
          nch = row.charAt(x + 1);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px + px - 1, y * px, 1, px); }
        }
        if (y > 0) {
          nch = MAP.rows[y - 1].charAt(x);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px, y * px, px, 1); }
        }
        if (y < MAP.height - 1) {
          nch = MAP.rows[y + 1].charAt(x);
          if (nch === '.' || nch === 'a') { c.fillRect(x * px, y * px + px - 1, px, 1); }
        }
      }
    }
    // landmarks
    c.fillStyle = '#f2d17b';
    var sites = MAP.sites || [];
    for (i = 0; i < sites.length; i++) {
      var s = sites[i];
      c.fillRect(s.x * px, s.y * px, Math.max(2, s.w * px), Math.max(2, s.h * px));
    }
  }

  function toTile(area, lx, ly) {
    return {
      x: (lx - area.x) / area.w * MAP.width,
      y: (ly - area.y) / area.h * MAP.height
    };
  }

  function contains(lx, ly) {
    if (!shouldShow()) return false;
    var a = mapArea();
    return lx >= a.x && lx <= a.x + a.w && ly >= a.y && ly <= a.y + a.h;
  }

  function moveCamera(lx, ly) {
    var a = mapArea();
    var t = toTile(a, lx, ly);
    var cam = Art.camera;
    cam.cx = t.x;
    cam.cy = t.y;
  }

  function mouseDown(lx, ly) {
    if (!contains(lx, ly)) return false;
    dragging = true;
    moveCamera(lx, ly);
    return true;
  }

  function mouseMove(lx, ly) {
    if (!dragging) return;
    moveCamera(lx, ly);
  }

  function mouseUp() {
    dragging = false;
  }

  function toggle() {
    hidden = !hidden;
  }

  function draw(ctx, G) {
    if (!shouldShow()) return;
    buildBase();
    var a = mapArea();
    var t = CONFIG.tileSize;
    var LW = MAP.width * t;
    var LH = MAP.height * t;

    // shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // background image
    ctx.drawImage(base, a.x, a.y, a.w, a.h);
    ctx.restore();

    // clip for live layer
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();

    var sx = a.w / MAP.width;
    var sy = a.h / MAP.height;
    var i, o, path, col;

    // agents batched by colour
    if (G && G.agents) {
      var colours = { calm: '#4f8fe6', mid: '#f0a030', hot: '#e5483f', riot: '#b000ff' };
      var keys = ['calm', 'mid', 'hot', 'riot'];
      var k, ag, mood, key;
      for (k = 0; k < keys.length; k++) {
        key = keys[k];
        var any = false;
        ctx.beginPath();
        for (i = 0; i < G.agents.length; i++) {
          ag = G.agents[i];
          if (!ag.active) continue;
          if (ag.revealedUntil && ag.revealedUntil > (G.time || 0)) {
            if (key !== 'riot') continue;
          } else {
            mood = ag.mood || 0;
            var kk = mood < 40 ? 'calm' : (mood <= 70 ? 'mid' : 'hot');
            if (kk !== key) continue;
          }
          ctx.rect(a.x + ag.x * sx - 0.75, a.y + ag.y * sy - 0.75, 1.5, 1.5);
          any = true;
        }
        if (any) {
          ctx.fillStyle = colours[key];
          ctx.fill();
        }
      }
    }

    // officers and vehicles outline then fill
    var lists = [G && G.officers, G && G.vehicles];
    var li, ent;
    for (li = 0; li < 2; li++) {
      var arr = lists[li];
      if (!arr || !arr.length) continue;
      ctx.fillStyle = '#10206a';
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) {
        ent = arr[i];
        ctx.rect(a.x + ent.x * sx - 1, a.y + ent.y * sy - 1, 2, 2);
      }
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) {
        ent = arr[i];
        ctx.rect(a.x + ent.x * sx - 0.5, a.y + ent.y * sy - 0.5, 1, 1);
      }
      ctx.fill();
    }

    // fires pulse
    if (typeof FX !== 'undefined' && FX && typeof FX.list === 'function') {
      var fires = FX.list();
      var pulse = 0.5 + 0.5 * Math.sin((G && G.time ? G.time : Date.now() / 1000) * 6);
      var rad = 1.2 + pulse * 0.8;
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      for (i = 0; i < fires.length; i++) {
        var f = fires[i];
        ctx.moveTo(a.x + f.x * sx + rad, a.y + f.y * sy);
        ctx.arc(a.x + f.x * sx, a.y + f.y * sy, rad, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // broken shops
    if (G && G.shops) {
      ctx.fillStyle = '#7a1f1f';
      ctx.beginPath();
      var shopCount = 0;
      for (i = 0; i < G.shops.length; i++) {
        if (G.shops[i].broken) {
          ctx.rect(a.x + G.shops[i].x * sx - 1, a.y + G.shops[i].y * sy - 1, 2, 2);
          shopCount++;
        }
      }
      if (shopCount) ctx.fill();
    }

    // attacked landmarks pulsing ring
    if (typeof LANDMARKS !== 'undefined' && LANDMARKS && typeof LANDMARKS.list === 'function') {
      var lms = LANDMARKS.list(G);
      var tt = (G && G.time ? G.time : Date.now() / 1000);
      var rp = 0.5 + 0.5 * Math.sin(tt * 8);
      for (i = 0; i < lms.length; i++) {
        var lm = lms[i];
        if (!lm.attackers || lm.attackers <= 0) continue;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(229,72,63,' + (0.4 + 0.6 * rp).toFixed(2) + ')';
        ctx.lineWidth = 1.5;
        var lr = 3 + rp * 2;
        ctx.arc(a.x + (lm.x + (lm.w || 1) / 2) * sx, a.y + (lm.y + (lm.h || 1) / 2) * sy, lr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // view rectangle
    var tl = Art.screenToTile(0, 0);
    var br = Art.screenToTile(LW, LH);
    var vx = a.x + tl.x * sx;
    var vy = a.y + tl.y * sy;
    var vw = (br.x - tl.x) * sx;
    var vh = (br.y - tl.y) * sy;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(vx, vy, vw, vh);

    ctx.restore();

    // frame
    ctx.strokeStyle = 'rgba(10,14,22,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x + 1, a.y + 1, a.w - 2, a.h - 2);

    // title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('MAP', a.x + 4, a.y + 3);
  }

  api.draw = draw;
  api.mouseDown = mouseDown;
  api.mouseMove = mouseMove;
  api.mouseUp = mouseUp;
  api.contains = contains;
  api.toggle = toggle;
  api.forced = false;
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = MINIMAP;
