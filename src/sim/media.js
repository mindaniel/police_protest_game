var MEDIA = (function () {
  var CREW_SPACING = 0.5;
  var RETARGET_SEC = 6;
  var WALK_SPEED = 1.4;
  var KEEP_MIN = 3;
  var KEEP_MAX = 5;
  var FILM_SEC = 4;
  var CONE_LEN = 6;
  var CONE_HALF = Math.PI / 6;
  var _lastG = null;
  var _bfsSeen = null;
  var _bfsQueue = null;
  var _bfsDist = null;
  var _bfsCap = 0;
  var _reportedForming = false;
  var _reportedFormingG = null;

  function C_(G) { return (typeof CONFIG !== "undefined") ? CONFIG : (G && G.config) || {}; }

  function key(G, k, d) {
    var c = C_(G);
    var v = c[k];
    return (v === undefined || v === null) ? d : v;
  }

  function tileAt(G, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) return "#";
    var row = MAP.rows[ty];
    if (!row) return "#";
    return row.charAt(tx);
  }

  function isWalk(G, tx, ty) {
    var t = tileAt(G, tx, ty);
    return t !== "#" && t !== "S";
  }

  function ensureBfs(G) {
    var w = MAP.width, h = MAP.height;
    var n = w * h;
    if (_bfsCap < n) {
      _bfsSeen = new Int16Array(n);
      _bfsQueue = new Int32Array(n);
      _bfsDist = new Int32Array(n);
      _bfsCap = n;
    }
  }

  function bfsFrom(G, tx, ty, stamp) {
    ensureBfs(G);
    var w = MAP.width, h = MAP.height;
    var n = w * h;
    var seen = _bfsSeen, q = _bfsQueue, dist = _bfsDist;
    for (var i = 0; i < n; i++) dist[i] = -1;
    if (!isWalk(G, tx, ty)) {
      // find nearest walkable
      var found = false;
      for (var r = 1; r <= 4 && !found; r++) {
        for (var dy = -r; dy <= r && !found; dy++) {
          for (var dx = -r; dx <= r && !found; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            if (isWalk(G, tx + dx, ty + dy)) { tx += dx; ty += dy; found = true; }
          }
        }
      }
      if (!found) return;
    }
    var head = 0, tail = 0;
    var start = ty * w + tx;
    dist[start] = 0;
    q[tail++] = start;
    var dirs = [-1, 0, 1, 0, 0, -1, 0, 1];
    while (head < tail) {
      var cur = q[head++];
      var cx = cur % w, cy = (cur / w) | 0;
      var cd = dist[cur];
      for (var k = 0; k < 4; k++) {
        var nx = cx + dirs[k * 2], ny = cy + dirs[k * 2 + 1];
        if (!isWalk(G, nx, ny)) continue;
        var ni = ny * w + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = cd + 1;
        q[tail++] = ni;
      }
    }
  }

  function randStreetNearEdge(G, edge) {
    var w = MAP.width, h = MAP.height;
    var tries = 400;
    var mx, my, minx, miny, maxx, maxy;
    for (var i = 0; i < tries; i++) {
      if (edge === 0) { mx = (Math.random() * w) | 0; my = 2 + ((Math.random() * 4) | 0); }
      else if (edge === 1) { mx = w - 3 - ((Math.random() * 4) | 0); my = (Math.random() * h) | 0; }
      else if (edge === 2) { mx = (Math.random() * w) | 0; my = h - 3 - ((Math.random() * 4) | 0); }
      else { mx = 2 + ((Math.random() * 4) | 0); my = (Math.random() * h) | 0; }
      if (isWalk(G, mx, my)) return { x: mx + 0.5, y: my + 0.5, tx: mx, ty: my };
    }
    // fallback: scan
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (isWalk(G, x, y)) return { x: x + 0.5, y: y + 0.5, tx: x, ty: y };
    return null;
  }

  function init(G) {
    _lastG = G;
    _reportedForming = false;
    _reportedFormingG = G;
    var C = C_(G);
    G.stats = G.stats || {};
    if (G.stats.mediaScore === undefined) G.stats.mediaScore = 100;
    if (G.stats.mediaIncidents === undefined) G.stats.mediaIncidents = 0;

    var crews = [];
    var nCrews = C.mediaCrews || 2;
    for (var i = 0; i < nCrews; i++) {
      var edge = i % 4;
      var spawn = randStreetNearEdge(G, edge);
      if (!spawn) continue;
      var crew = {
        rep: { x: spawn.x, y: spawn.y },
        cam: { x: spawn.x + CREW_SPACING, y: spawn.y },
        tx: spawn.tx, ty: spawn.ty,
        _flow: null,
        _flowTarget: null,
        retargetT: 0,
        filmT: 0,
        filmX: 0, filmY: 0
      };
      // separate reporter and camera
      var ok = true;
      if (Crowd && Crowd.collides && Crowd.collides(G, crew.rep.x, crew.rep.y)) {
        crew.rep.x += 0.3;
        crew.cam.x += 0.3;
      }
      crews.push(crew);
    }
    G.mediaCrews = crews;
    G._mediaLatest = null;

    // Black bloc
    var blocSize = C.blackBlocSize || 6;
    if (blocSize > 0) {
      var rioters = [];
      for (var a = 0; a < G.agents.length; a++) {
        var ag = G.agents[a];
        if (ag.role === "rioter") rioters.push(ag);
      }
      rioters.sort(function (p, q) { return p.id - q.id; });
      var mark = Math.min(blocSize, rioters.length);
      for (var m = 0; m < mark; m++) rioters[m].bloc = true;
    }
  }

  function ensureInit(G) {
    if (_lastG !== G) init(G);
  }

  function pickTarget(G, crew) {
    var C = C_(G);
    var latest = G._mediaLatest;
    var now = G.time;
    if (latest && (now - latest.t) < 20) {
      return { x: latest.x, y: latest.y };
    }
    // angriest group
    var active = [];
    for (var i = 0; i < G.agents.length; i++) {
      if (G.agents[i].active) active.push(G.agents[i]);
    }
    if (active.length > 0 && Crowd && Crowd.neighbors) {
      var best = null, bestMood = -1e9;
      var samples = Math.min(40, active.length);
      for (var s = 0; s < samples; s++) {
        var ag = active[(Math.random() * active.length) | 0];
        var nb = Crowd.neighbors(G, ag.x, ag.y, 4);
        if (!nb || nb.length === 0) continue;
        var sum = 0, cnt = 0;
        for (var k = 0; k < nb.length; k++) {
          var other = nb[k];
          if (!other || !other.active) continue;
          sum += other.mood || 0;
          cnt++;
        }
        if (cnt > 0) {
          var avg = sum / cnt;
          if (avg > bestMood) { bestMood = avg; best = ag; }
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    // random street tile
    var w = MAP.width, h = MAP.height;
    for (var t = 0; t < 200; t++) {
      var tx = (Math.random() * w) | 0;
      var ty = (Math.random() * h) | 0;
      if (isWalk(G, tx, ty)) return { x: tx + 0.5, y: ty + 0.5 };
    }
    return { x: crew.rep.x, y: crew.rep.y };
  }

  function retarget(G, crew) {
    var tgt = pickTarget(G, crew);
    crew.tx = tgt.x;
    crew.ty = tgt.y;
    // BFS from target tile
    var tx = Math.floor(tgt.x), ty = Math.floor(tgt.y);
    bfsFrom(G, tx, ty, 0);
    var n = MAP.width * MAP.height;
    if (!crew._dist || crew._dist.length !== n) crew._dist = new Int32Array(n);
    crew._dist.set(_bfsDist.subarray(0, n));
    crew._flow = crew._dist;
    crew._flowTarget = { tx: tx, ty: ty };
  }

  function stepTowardFlow(G, ent, crew) {
    var flow = crew._flow;
    if (!flow) return;
    var w = MAP.width, h = MAP.height;
    var cx = Math.floor(ent.x), cy = Math.floor(ent.y);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    var cur = flow[cy * w + cx];
    if (cur <= 0) return;
    var best = cur, bx = cx, by = cy;
    var dirs = [-1, 0, 1, 0, 0, -1, 0, 1];
    for (var k = 0; k < 4; k++) {
      var nx = cx + dirs[k * 2], ny = cy + dirs[k * 2 + 1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      var d = flow[ny * w + nx];
      if (d >= 0 && d < best) { best = d; bx = nx; by = ny; }
    }
    if (bx === cx && by === cy) return;
    var tgtx = bx + 0.5, tgty = by + 0.5;
    var dx = tgtx - ent.x, dy = tgty - ent.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return;
    var move = WALK_SPEED * (crew._dt || 0.016);
    if (move > len) move = len;
    var nxp = ent.x + (dx / len) * move;
    var nyp = ent.y + (dy / len) * move;
    if (Crowd && Crowd.collides && Crowd.collides(G, nxp, nyp)) {
      if (!Crowd.collides(G, nxp, ent.y)) { ent.x = nxp; }
      else if (!Crowd.collides(G, ent.x, nyp)) { ent.y = nyp; }
    } else {
      ent.x = nxp; ent.y = nyp;
    }
  }

  function updateCrew(G, crew, dt) {
    crew._dt = dt;
    crew.retargetT -= dt;
    if (crew.retargetT <= 0 || !crew._flow) {
      retarget(G, crew);
      crew.retargetT = RETARGET_SEC;
    }
    // Keep distance from target: if too close, push back
    var dxT = crew.rep.x - crew.tx;
    var dyT = crew.rep.y - crew.ty;
    var distT = Math.sqrt(dxT * dxT + dyT * dyT);
    if (distT < KEEP_MIN && distT > 1e-6) {
      var push = (KEEP_MIN - distT);
      var pxn = crew.rep.x + (dxT / distT) * push * dt * WALK_SPEED;
      var pyn = crew.rep.y + (dyT / distT) * push * dt * WALK_SPEED;
      if (!Crowd.collides(G, pxn, pyn)) { crew.rep.x = pxn; crew.rep.y = pyn; }
      var cxn = crew.cam.x + (dxT / distT) * push * dt * WALK_SPEED;
      var cyn = crew.cam.y + (dyT / distT) * push * dt * WALK_SPEED;
      if (!Crowd.collides(G, cxn, cyn)) { crew.cam.x = cxn; crew.cam.y = cyn; }
    } else if (distT > KEEP_MAX) {
      stepTowardFlow(G, crew.rep, crew);
    }

    // Camera follows reporter at 0.5 tiles
    var cdx = crew.cam.x - crew.rep.x;
    var cdy = crew.cam.y - crew.rep.y;
    var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
    if (cdist > CREW_SPACING + 0.01) {
      var want = CREW_SPACING;
      var ncx = crew.rep.x + (cdx / cdist) * want;
      var ncy = crew.rep.y + (cdy / cdist) * want;
      if (!Crowd.collides(G, ncx, ncy)) { crew.cam.x = ncx; crew.cam.y = ncy; }
    }

    if (crew.filmT > 0) crew.filmT -= dt;
  }

  function report(G, kind, x, y) {
    ensureInit(G);
    G._mediaLatest = { kind: kind, x: x, y: y, t: G.time };
    var C = C_(G);
    var range = (C.mediaRange !== undefined) ? C.mediaRange : 9;
    var crews = G.mediaCrews || [];
    var filmed = false;
    for (var i = 0; i < crews.length; i++) {
      var cr = crews[i];
      var dx = cr.rep.x - x, dy = cr.rep.y - y;
      if (dx * dx + dy * dy <= range * range) { filmed = true; break; }
    }
    if (!filmed) return;

    var moodRise = 0;
    var text = null;
    var correctArrest = false;
    if (kind === "wrongArrest") { moodRise = 4; text = "police arrest a peaceful protester"; }
    else if (kind === "water") { moodRise = 3; text = "water cannon on protesters"; }
    else if (kind === "gas") { moodRise = 3; text = "tear gas fired into the crowd"; }
    else if (kind === "shove") { moodRise = 1.5; text = "police shove protesters"; }
    else if (kind === "arrest") { correctArrest = true; }
    else if (kind === "barrierHit") { }

    if (correctArrest) {
      G.log("On camera: rioter arrested");
      var sc = G.stats.mediaScore === undefined ? 100 : G.stats.mediaScore;
      sc = Math.min(100, sc + 2);
      G.stats.mediaScore = sc;
    } else if (text) {
      for (var a = 0; a < G.agents.length; a++) {
        var ag = G.agents[a];
        if (ag.active) ag.mood = Math.min(100, (ag.mood || 0) + moodRise);
      }
      if (moodRise > 0) {
        if (G.stats.mediaIncidents === undefined) G.stats.mediaIncidents = 0;
        G.stats.mediaIncidents += 1;
        var s = G.stats.mediaScore === undefined ? 100 : G.stats.mediaScore;
        s = Math.max(0, s - moodRise * 3);
        G.stats.mediaScore = s;
      }
      G.log("On camera: " + text);
    }

    // Set filming
    for (var j = 0; j < crews.length; j++) {
      var c2 = crews[j];
      var ddx = c2.rep.x - x, ddy = c2.rep.y - y;
      if (ddx * ddx + ddy * ddy <= range * range) {
        c2.filmT = FILM_SEC;
        c2.filmX = x;
        c2.filmY = y;
      }
    }
  }

  function updateBloc(G, dt) {
    var C = C_(G);
    var dressSec = (C.blocDressSeconds !== undefined) ? C.blocDressSeconds : 45;
    if (G.time >= dressSec && !_reportedForming && _reportedFormingG === G) {
      _reportedForming = true;
      G.log("A black bloc group is forming");
    }
    if (G.time >= dressSec) {
      for (var i = 0; i < G.agents.length; i++) {
        if (G.agents[i].bloc) G.agents[i].blocDressed = true;
      }
    }

    var blocActive = [];
    for (var b = 0; b < G.agents.length; b++) {
      var ag = G.agents[b];
      if (ag.bloc && ag.active) blocActive.push(ag);
    }
    if (blocActive.length === 0) return;

    // Shared target propagation
    for (var i2 = 0; i2 < blocActive.length; i2++) {
      var src = blocActive[i2];
      if (src.state === "attackShop" && src._targetShop) {
        for (var j = 0; j < blocActive.length; j++) {
          if (i2 === j) continue;
          var oth = blocActive[j];
          if (oth.state !== "march") continue;
          var ddx = oth.x - src.x, ddy = oth.y - src.y;
          if (ddx * ddx + ddy * ddy <= 64) {
            oth.state = "attackShop";
            oth._targetShop = src._targetShop;
            oth._flow = null;
          }
        }
      }
    }

    // Cohesion
    for (var m = 0; m < blocActive.length; m++) {
      var mem = blocActive[m];
      if (mem.state === "flee") continue;
      var sx = 0, sy = 0, cnt = 0;
      for (var n = 0; n < blocActive.length; n++) {
        var o = blocActive[n];
        var ox = o.x - mem.x, oy = o.y - mem.y;
        if (ox * ox + oy * oy <= 64) { sx += o.x; sy += o.y; cnt++; }
      }
      if (cnt === 0) continue;
      var cx = sx / cnt, cy = sy / cnt;
      var dx = cx - mem.x, dy = cy - mem.y;
      var dlen = Math.sqrt(dx * dx + dy * dy);
      if (dlen <= 1.5 || dlen < 1e-6) continue;
      var step = 0.6 * dt;
      if (step > dlen) step = dlen;
      var nx = mem.x + (dx / dlen) * step;
      var ny = mem.y + (dy / dlen) * step;
      if (Crowd && Crowd.collides && Crowd.collides(G, nx, ny)) {
        if (!Crowd.collides(G, nx, mem.y)) mem.x = nx;
        else if (!Crowd.collides(G, mem.x, ny)) mem.y = ny;
      } else {
        mem.x = nx; mem.y = ny;
      }
    }
  }

  function update(G, dt) {
    ensureInit(G);
    if (dt > 0.05) dt = 0.05;
    var crews = G.mediaCrews || [];
    for (var i = 0; i < crews.length; i++) updateCrew(G, crews[i], dt);
    updateBloc(G, dt);
  }

  /* Capsule body standing on (x, y) plus a head, sized like the crowd's people. */
  function drawPerson(ctx, x, y, S, bodyColor) {
    var r = 2.9 * S, h = 8.6 * S;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(x, y - r, r, 0, Math.PI);
    ctx.lineTo(x - r, y - h + r);
    ctx.arc(x, y - h + r, r, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f1d3b5";
    ctx.beginPath();
    ctx.arc(x, y - h - 1.8 * S, 2.3 * S, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCrew(ctx, G, crew, S, now) {
    var A = (typeof Art !== "undefined") ? Art : null;
    if (!A || !A.project) return;
    var p1 = A.project(crew.rep.x, crew.rep.y, 0);
    var p2 = A.project(crew.cam.x, crew.cam.y, 0);

    // Cone
    if (crew.filmT > 0) {
      var camHead = A.project(crew.cam.x, crew.cam.y, 0);
      var spot = A.project(crew.filmX, crew.filmY, 0);
      var dx = spot.x - camHead.x, dy = spot.y - camHead.y;
      var ang = Math.atan2(dy, dx);
      var lenPx = CONE_LEN * 32 * S;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#fff2a8";
      ctx.beginPath();
      ctx.moveTo(camHead.x, camHead.y);
      ctx.arc(camHead.x, camHead.y, lenPx, ang - CONE_HALF, ang + CONE_HALF);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Reporter
    drawPerson(ctx, p1.x, p1.y, S, "#7ec8f2");
    // PRESS tag
    if (S >= 0.8) {
      ctx.fillStyle = "#ffffff";
      ctx.font = (3 * S) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PRESS", p1.x, p1.y - 13 * S);
      ctx.textAlign = "start";
    }
    // Camera operator
    drawPerson(ctx, p2.x, p2.y, S, "#333a44");
    // Camera box on shoulder
    var camY = p2.y - 12 * S;
    ctx.fillStyle = "#111111";
    ctx.fillRect(p2.x - 2 * S, camY - 3 * S, 4 * S, 3 * S);
    // Red blink at 2 Hz
    if (Math.floor(now * 2) % 2 === 0) {
      ctx.fillStyle = "#ff2222";
      ctx.fillRect(p2.x + 1.5 * S, camY - 2.5 * S, 1.2 * S, 1.2 * S);
    }

    // TV badge above pair
    var mx = (p1.x + p2.x) / 2;
    var my = Math.min(p1.y, p2.y) - 20 * S;
    ctx.fillStyle = "#222";
    ctx.fillRect(mx - 4 * S, my - 4 * S, 8 * S, 6 * S);
    ctx.fillStyle = "#8fd3ff";
    ctx.fillRect(mx - 3 * S, my - 3 * S, 6 * S, 4 * S);
    ctx.fillStyle = "#222";
    ctx.fillRect(mx - 1 * S, my - 5 * S, 2 * S, 1 * S);
  }

  function draw(ctx, G) {
    ensureInit(G);
    var A = (typeof Art !== "undefined") ? Art : null;
    if (!A || !A.camera) return;
    var S = A.camera.S;
    var now = G.time;
    var crews = G.mediaCrews || [];
    for (var i = 0; i < crews.length; i++) drawCrew(ctx, G, crews[i], S, now);
  }

  return {
    init: init,
    update: update,
    draw: draw,
    report: report
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MEDIA;
