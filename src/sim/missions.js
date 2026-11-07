/* missions.js - short side missions during the match (DeepSeek) */
(function (global) {
  'use strict';

  var order = [];
  var orderIdx = 0;
  var cur = null;
  var lastEnd = -1;
  var nextAt = null;
  var banner = null; // {text, color, until}
  var ringleader = null;
  var wrapped = false;
  var origArrest = null;

  function hashSeed() {
    var w = (global.MAP && global.MAP.width) || 0;
    var h = 0, s = String(w);
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    h = h < 0 ? -h : h;
    var types = ['Ringleader', 'Protect', 'Fire', 'ClearRoad'];
    order = [];
    var idx = h % 4;
    for (var k = 0; k < 24; k++) { order.push(types[(idx + k * 3) % 4]); }
  }

  function walkableTile(G, tx, ty) {
    if (!global.MAP || tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) return false;
    return Police.isWalkable(G, tx, ty);
  }

  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function startMission(G, type) {
    var m = null;
    if (type === 'Ringleader') m = makeRingleader(G);
    else if (type === 'Protect') m = makeProtect(G);
    else if (type === 'Fire') m = makeFire(G);
    else if (type === 'ClearRoad') m = makeClearRoad(G);
    if (!m) return false;
    cur = m;
    ringleader = m._agent || null;
    if (global.ALERTS) ALERTS.push('mission', 'MISSION: ' + m.title, m.x, m.y, '#3b82f6', G);
    if (global.G && G.log) G.log('Mission started: ' + m.title);
    return true;
  }

  function makeRingleader(G) {
    var agents = G.agents || [];
    var best = null, bestCount = -1;
    var i, j, a;
    for (i = 0; i < agents.length; i++) {
      a = agents[i];
      if (!a.active || a.arrested || a.role !== 'rioter') continue;
      var c = 0;
      for (j = 0; j < agents.length; j++) {
        var b = agents[j];
        if (b.active && !b.arrested && b.role === 'rioter' && dist2(a.x, a.y, b.x, b.y) < 36) c++;
      }
      if (c > bestCount) { bestCount = c; best = a; }
    }
    if (!best) return null;
    best._ringleader = true;
    /* hidden: police only get a rough tip (search circle); officers must get close to
       identify him, and a dense crowd hides him - split the crowd to find him */
    var m = {
      type: 'Ringleader', title: 'Find and arrest the ringleader',
      x: best.x, y: best.y, r: 11, t0: G.time, limit: 300,
      progress: 0, state: 'active', _agent: best, idT: 0, revealed: 0, tipAt: G.time
    };
    ringTip(m, best);
    return m;
  }
  /* new tip: circle around his real position, centre off by up to 0.6 r */
  function ringTip(m, a) {
    var ang = Math.random() * Math.PI * 2, off = Math.random() * m.r * 0.6;
    m.x = a.x + Math.cos(ang) * off; m.y = a.y + Math.sin(ang) * off;
  }

  function makeProtect(G) {
    var sites = (global.MAP && MAP.sites) || [];
    if (!sites.length) return null;
    var agents = G.agents || [];
    var best = null, bestNear = -1;
    for (var i = 0; i < sites.length; i++) {
      var s = sites[i];
      var cx = s.x + (s.w || 0) / 2, cy = s.y + (s.h || 0) / 2;
      var n = 0;
      for (var j = 0; j < agents.length; j++) {
        var a = agents[j];
        if (a.active && !a.arrested && a.role === 'rioter' && dist2(a.x, a.y, cx, cy) < 36) n++;
      }
      if (n > bestNear) { bestNear = n; best = { s: s, cx: cx, cy: cy }; }
    }
    if (!best) return null;
    return {
      type: 'Protect', title: 'Protect ' + (best.s.name || 'landmark'),
      x: best.cx, y: best.cy, r: 6, t0: G.time, limit: 120,
      progress: 0, state: 'active', _overT: 0
    };
  }

  function makeFire(G) {
    var shops = G.shops || [];
    if (!shops.length) return null;
    var sh = shops[Math.floor(shops.length / 2)];
    var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    for (var i = 0; i < dirs.length; i++) {
      var tx = Math.floor(sh.x) + dirs[i][0], ty = Math.floor(sh.y) + dirs[i][1];
      if (walkableTile(G, tx, ty)) {
        if (global.FX && FX.addFire) FX.addFire(G, tx, ty);
        return {
          type: 'Fire', title: 'Fire near ' + (sh.name || 'shop'),
          x: tx + 0.5, y: ty + 0.5, r: 4, t0: G.time, limit: 90,
          progress: 0, state: 'active'
        };
      }
    }
    return null;
  }

  function makeClearRoad(G) {
    var agents = G.agents || [];
    var best = null, bestN = -1;
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (!a.active || a.arrested) continue;
      var tx = Math.floor(a.x), ty = Math.floor(a.y);
      var n = 0;
      for (var j = 0; j < agents.length; j++) {
        var b = agents[j];
        if (b.active && !b.arrested && dist2(a.x, a.y, b.x, b.y) < 16) n++;
      }
      if (n > bestN && walkableTile(G, tx, ty)) { bestN = n; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
    if (!best) return null;
    return {
      type: 'ClearRoad', title: 'Clear the road',
      x: best.x, y: best.y, r: 4, t0: G.time, limit: 90,
      progress: 0, state: 'active', _clearT: 0
    };
  }

  function finish(G, ok) {
    if (!cur) return;
    cur.state = ok ? 'done' : 'failed';
    if (G.stats) {
      if (ok) G.stats.missionsDone = (G.stats.missionsDone || 0) + 1;
      else G.stats.missionsFailed = (G.stats.missionsFailed || 0) + 1;
    }
    var reward = cur.type === 'Ringleader' ? 3 : 2;
    if (ok && G._reinforce) {
      G._reinforce.points = Math.min(12, (G._reinforce.points || 0) + reward);
    }
    var col = ok ? '#22c55e' : '#ef4444';
    banner = { text: ok ? ('DONE +' + reward + ' pts') : 'FAILED', color: col, until: G.time + 3 };
    if (G.log) G.log(ok ? ('Mission complete: ' + cur.title) : ('Mission failed: ' + cur.title));
    if (ringleader) { ringleader._ringleader = false; ringleader = null; }
    lastEnd = G.time;
    cur._endAt = G.time;
    cur = cur; // keep for banner? we clear below after delay
    cur._finished = true;
    setTimeout(function () {}, 0);
  }

  function updateActive(G, dt) {
    var m = cur;
    var agents = G.agents || [];
    var i, a;
    if (m.type === 'Ringleader') {
      var t = m._agent;
      if (!t || t.arrested || !t.active) { finish(G, true); return; }
      t._ringleader = true;
      if (t._identifiedUntil > G.time && !(G.time < m.revealed)) m.revealed = t._identifiedUntil;   /* found in a kettle check */
      if (G.time < m.revealed) {   /* identified: officers can see him */
        t.revealedUntil = G.time + 1;
        m.x = t.x; m.y = t.y; m.r = 2;
      } else {
        if (m.r === 2) m.r = 6;
        if (G.time - m.tipAt >= 30) {   /* fresh intel every 30 s, a little tighter each time */
          m.tipAt = G.time; m.r = Math.max(6, m.r - 1.5);
          ringTip(m, t);
          if (global.UI && UI.say) UI.say('Intel: the ringleader is still in the crowd inside the blue circle');
        }
        /* an officer close by spots him; packed crowd around him makes it slow */
        var offs = G.officers || [], close = false, oi;
        for (oi = 0; oi < offs.length && !close; oi++) if (dist2(offs[oi].x, offs[oi].y, t.x, t.y) < 6.25) close = true;
        if (close) {
          var dense = 0;
          for (i = 0; i < agents.length; i++) {
            a = agents[i];
            if (a.active && !a.arrested && a !== t && dist2(a.x, a.y, t.x, t.y) < 9) dense++;
          }
          m.idT += dt * (dense < 8 ? 1 : dense < 16 ? 0.35 : 0.08);
          if (m.idT >= 2) {
            m.idT = 0; m.revealed = G.time + 25;
            if (global.UI && UI.say) UI.say('Ringleader identified! Arrest him now (25 s before he blends in again)');
          }
        } else m.idT = Math.max(0, m.idT - dt * 0.5);
      }
      m.progress = Math.min(1, (G.time - m.t0) / m.limit);
      if (G.time - m.t0 >= m.limit) finish(G, false);
    } else if (m.type === 'Protect') {
      var near = 0;
      for (i = 0; i < agents.length; i++) {
        a = agents[i];
        if (a.active && !a.arrested && a.role === 'rioter' && dist2(a.x, a.y, m.x, m.y) < 36) near++;
      }
      if (near >= 6) m._overT = (m._overT || 0) + dt;
      else m._overT = Math.max(0, (m._overT || 0) - dt * 2);
      m.progress = Math.min(1, (G.time - m.t0) / m.limit);
      if (m._overT >= 10) { finish(G, false); return; }
      if (G.time - m.t0 >= m.limit) finish(G, true);
    } else if (m.type === 'Fire') {
      var fires = (global.FX && FX.listFires) ? FX.listFires() : [];
      var any = false;
      for (i = 0; i < fires.length; i++) {
        if (dist2(fires[i].x, fires[i].y, m.x, m.y) < 1) { any = true; break; }
      }
      m.progress = Math.min(1, (G.time - m.t0) / m.limit);
      if (!any) { finish(G, true); return; }
      if (G.time - m.t0 >= m.limit) finish(G, false);
    } else if (m.type === 'ClearRoad') {
      var n2 = 0;
      for (i = 0; i < agents.length; i++) {
        a = agents[i];
        if (a.active && !a.arrested && dist2(a.x, a.y, m.x, m.y) < 9) n2++;
      }
      if (n2 < 3) m._clearT = (m._clearT || 0) + dt;
      else m._clearT = 0;
      m.progress = Math.min(1, (G.time - m.t0) / m.limit);
      if (m._clearT >= 10) { finish(G, true); return; }
      if (G.time - m.t0 >= m.limit) finish(G, false);
    }
  }

  function wrapArrest() {
    if (wrapped) return;
    wrapped = true;
    if (global.Crowd && typeof Crowd.arrest === 'function') {
      origArrest = Crowd.arrest;
      Crowd.arrest = function (G, a) {
        var wasRing = !!(a && a._ringleader);
        origArrest.call(Crowd, G, a);
        if (wasRing && cur && cur.type === 'Ringleader' && cur.state === 'active') {
          finish(G, true);
        }
      };
    }
  }

  function MISSIONS_reset() {
    cur = null; ringleader = null; banner = null; lastEnd = -1; nextAt = null;
    orderIdx = 0; hashSeed();
  }

  function MISSIONS_current() { return cur && cur.state === 'active' ? cur : null; }

  function MISSIONS_update(G, dt) {
    wrapArrest();
    if (nextAt === null) {
      nextAt = (CONFIG.calmStartSeconds || 0) + 30;
    }
    if (banner && G.time > banner.until) banner = null;
    if (cur && cur._finished && G.time - cur._endAt > 0.5) { cur = null; }
    if (cur && cur.state === 'active') {
      updateActive(G, dt);
    } else if (!cur && G.time >= nextAt && !banner) {
      for (var tries = 0; tries < 4; tries++) {
        var type = order[orderIdx % order.length];
        orderIdx++;
        if (startMission(G, type)) return;
      }
      nextAt = G.time + 60;
    }
    if (!cur && lastEnd > 0 && G.time >= nextAt) {
      // schedule handled above
    }
    if (!cur && lastEnd > 0 && lastEnd !== nextAt - 0) {
      // deterministic gap 60-90 based on orderIdx
      var gap = 60 + (orderIdx * 7) % 31;
      if (nextAt < lastEnd + gap) nextAt = lastEnd + gap;
    }
  }

  function MISSIONS_draw(ctx, G) {
    if (!cur && !banner) return;
    var cx, cy, px, py, rs;
    if (cur) {
      var c1 = global.Art ? Art.project(cur.x, cur.y, 0) : { x: cur.x, y: cur.y };
      var c2 = global.Art ? Art.project(cur.x + cur.r, cur.y, 0) : { x: cur.x + cur.r, y: cur.y };
      cx = c1.x; cy = c1.y; rs = Math.abs(c2.x - cx) || cur.r;
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, rs, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (cur.type === 'Ringleader' && ringleader && ringleader.active && !ringleader.arrested && G.time < cur.revealed) {   /* star only once identified */
        var p = global.Art ? Art.project(ringleader.x, ringleader.y, 0) : { x: ringleader.x, y: ringleader.y };
        ctx.save();
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u2605', p.x, p.y - 16);
        ctx.strokeText('\u2605', p.x, p.y - 16);
        ctx.restore();
      }
    }
    var W = MAP.width * CONFIG.tileSize;   /* logical screen width (the UI draws in these units) */
    if (cur && cur.state === 'active') {
      var left = Math.max(0, cur.limit - (G.time - cur.t0));
      var mm = Math.floor(left / 60), ss = Math.floor(left % 60);
      var label = 'MISSION: ' + cur.title + '  ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
      var prog = Math.max(0, Math.min(1, 1 - left / cur.limit));
      var bw = Math.min(420, W - 40);
      var bx = (W - bw) / 2, by = 30;   /* below the top status bar */
      ctx.save();
      ctx.fillStyle = 'rgba(15,23,42,0.75)';
      ctx.fillRect(bx, by, bw, 34);
      ctx.strokeStyle = '#3b82f6';
      ctx.strokeRect(bx, by, bw, 34);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, W / 2, by + 15);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(bx + 6, by + 22, bw - 12, 6);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(bx + 6, by + 22, (bw - 12) * prog, 6);
      ctx.restore();
    }
    if (banner) {
      ctx.save();
      ctx.fillStyle = banner.color;
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(banner.text, W / 2, 92);
      ctx.restore();
    }
  }

  global.MISSIONS = {
    update: MISSIONS_update,
    current: MISSIONS_current,
    draw: MISSIONS_draw,
    reset: MISSIONS_reset
  };
})(typeof window !== 'undefined' ? window : this);
