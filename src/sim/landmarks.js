var LANDMARKS = (function () {
  // ---- deterministic PRNG ----
  function mkRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function walk(c) { return c === '.' || c === 'a' || c === 'P' || c === 'G'; }
  function isSolid(x, y) {
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
    return MAP.rows[y].charAt(x) === '#';
  }
  function isWalk(x, y) {
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
    return walk(MAP.rows[y].charAt(x));
  }

  // grow solid rect from top-left
  function growRect(x0, y0, maxW, maxH) {
    if (!isSolid(x0, y0)) return null;
    var w = 0, h = 0, i, j;
    while (w < maxW && isSolid(x0 + w, y0)) w++;
    if (w < 4) return null;
    h = 1;
    while (h < maxH) {
      var ok = true;
      for (i = 0; i < w; i++) if (!isSolid(x0 + i, y0 + h)) { ok = false; break; }
      if (!ok) break;
      h++;
    }
    if (h < 4) return null;
    return { x: x0, y: y0, w: w, h: h };
  }

  function rectTouchesPlaza(r, plaza) {
    var cx = plaza.x, cy = plaza.y, rr = plaza.r + 6;
    var x, y;
    for (y = r.y; y < r.y + r.h; y++) {
      for (x = r.x; x < r.x + r.w; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > rr * rr) continue;
        // walkable tile within 2 of edge?
        var ex, ey;
        for (ey = y - 2; ey <= y + 2; ey++) {
          for (ex = x - 2; ex <= x + 2; ex++) {
            if (ex >= r.x && ex < r.x + r.w && ey >= r.y && ey < r.y + r.h) continue;
            if (isWalk(ex, ey)) return true;
          }
        }
      }
    }
    return false;
  }

  function rectsOverlap(a, b, pad) {
    return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x ||
             a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
  }

  function findWalk2x2(cx, cy, rng) {
    var best = null, bestD = 1e9, dx, dy;
    for (dy = -3; dy <= 3; dy++) {
      for (dx = -3; dx <= 3; dx++) {
        var x = cx + dx, y = cy + dy;
        if (isWalk(x, y) && isWalk(x + 1, y) && isWalk(x, y + 1) && isWalk(x + 1, y + 1)) {
          var d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { x: x, y: y }; }
        }
      }
    }
    return best;
  }

  function autoPlace(G, plaza) {
    if (!MAP) return;
    if (MAP.sites && MAP.sites.length) return;
    var rng = mkRng(MAP.width * 131 + MAP.height);
    var out = [];
    var taken = [];

    if (plaza) {
      // statue
      var st = findWalk2x2(Math.round(plaza.x), Math.round(plaza.y), rng);
      if (st) {
        var stLm = { type: 'statue', name: 'Statue of the Republic', x: st.x, y: st.y, w: 2, h: 2 };
        out.push(stLm); taken.push(stLm);
      }
      // gov
      var bestGov = null, bestGovArea = 0, x, y;
      for (y = 0; y < MAP.height; y += 2) {
        for (x = 0; x < MAP.width; x += 2) {
          if (!isSolid(x, y)) continue;
          var rr = growRect(x, y, 12, 9);
          if (!rr) continue;
          if (!rectTouchesPlaza(rr, plaza)) continue;
          var area = rr.w * rr.h;
          if (area > bestGovArea) { bestGovArea = area; bestGov = rr; }
        }
      }
      if (bestGov) {
        var govLm = { type: 'gov', name: 'City Hall', x: bestGov.x, y: bestGov.y, w: bestGov.w, h: bestGov.h };
        out.push(govLm); taken.push(govLm);
      }
    }

    // churches / theatre / column
    function tryFind(maxW, maxH, minDist) {
      var candidates = [], i;
      var tries = 0;
      for (var yy = 0; yy < MAP.height && tries < 4000; yy += 2) {
        for (var xx = 0; xx < MAP.width && tries < 4000; xx += 2) {
          tries++;
          if (!isSolid(xx, yy)) continue;
          var r2 = growRect(xx, yy, maxW, maxH);
          if (!r2) continue;
          var ok = true;
          for (i = 0; i < taken.length; i++) {
            if (rectsOverlap(r2, taken[i], minDist)) { ok = false; break; }
          }
          if (ok) candidates.push(r2);
        }
      }
      if (!candidates.length) return null;
      return candidates[Math.floor(rng() * candidates.length)];
    }

    var nChurch = 1 + (rng() < 0.6 ? 1 : 0);
    var churchNames = ['St Anne\'s Church', 'Cathedral of St Mark'];
    var ci;
    for (ci = 0; ci < nChurch; ci++) {
      var cr = tryFind(10, 8, 18);
      if (cr) {
        var clm = { type: 'church', name: churchNames[ci], x: cr.x, y: cr.y, w: cr.w, h: cr.h };
        out.push(clm); taken.push(clm);
      }
    }
    if (rng() < 0.75) {
      var tr = tryFind(10, 8, 18);
      if (tr) {
        var tlm = { type: 'theatre', name: 'Grand Theatre', x: tr.x, y: tr.y, w: tr.w, h: tr.h };
        out.push(tlm); taken.push(tlm);
      }
    }
    // column
    if (rng() < 0.7) {
      var cands = [], yy2, xx2, ddx, ddy;
      for (yy2 = 2; yy2 < MAP.height - 2; yy2 += 2) {
        for (xx2 = 2; xx2 < MAP.width - 2; xx2 += 2) {
          if (!isWalk(xx2, yy2)) continue;
          var allWalk = true;
          for (ddy = -2; ddy <= 2 && allWalk; ddy++) {
            for (ddx = -2; ddx <= 2; ddx++) {
              if (!isWalk(xx2 + ddx, yy2 + ddy)) { allWalk = false; break; }
            }
          }
          if (!allWalk) continue;
          var okc = true;
          for (var k = 0; k < taken.length; k++) {
            var t2 = taken[k];
            var ccx = t2.x + t2.w / 2, ccy = t2.y + t2.h / 2;
            var dxc = xx2 - ccx, dyc = yy2 - ccy;
            if (dxc * dxc + dyc * dyc < 18 * 18) { okc = false; break; }
          }
          if (okc) cands.push({ x: xx2, y: yy2 });
        }
      }
      if (cands.length) {
        var pick = cands[Math.floor(rng() * cands.length)];
        var coLm = { type: 'column', name: 'Victory Column', x: pick.x, y: pick.y, w: 1, h: 1 };
        out.push(coLm); taken.push(coLm);
      }
    }

    MAP.sites = out;
  }

  function frontsFor(lm) {
    var out = [], x, y;
    if (lm.type === 'statue' || lm.type === 'column') {
      var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
      for (y = Math.floor(cy - 2.5); y <= Math.ceil(cy + 2.5); y++) {
        for (x = Math.floor(cx - 2.5); x <= Math.ceil(cx + 2.5); x++) {
          if (isWalk(x, y)) out.push({ x: x, y: y });
        }
      }
    } else {
      var i;
      for (i = 0; i < lm.w; i++) {
        if (isWalk(lm.x + i, lm.y - 1)) out.push({ x: lm.x + i, y: lm.y - 1 });
        if (isWalk(lm.x + i, lm.y + lm.h)) out.push({ x: lm.x + i, y: lm.y + lm.h });
      }
      for (i = 0; i < lm.h; i++) {
        if (isWalk(lm.x - 1, lm.y + i)) out.push({ x: lm.x - 1, y: lm.y + i });
        if (isWalk(lm.x + lm.w, lm.y + i)) out.push({ x: lm.x + lm.w, y: lm.y + i });
      }
    }
    if (out.length > 12) {
      var f = [], j;
      for (j = 0; j < out.length; j += 2) f.push(out[j]);
      out = f;
    }
    return out;
  }

  function init(G) {
    G._landmarks = [];
    if (!MAP || !MAP.sites) return;
    var i;
    for (i = 0; i < MAP.sites.length; i++) {
      var lm = MAP.sites[i];
      var fs = frontsFor(lm);
      if (!fs.length) continue;
      G._landmarks.push({ lm: lm, hp: 100, stage: 0, fronts: fs, attackers: 0, fireT: 0 });
    }
  }

  function isOfficerNear(G, x, y, r) {
    var i, o;
    var r2 = r * r;
    for (i = 0; i < G.officers.length; i++) {
      o = G.officers[i];
      var dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  function nearestFront(L, x, y) {
    var best = null, bestD = 1e9, i;
    for (i = 0; i < L.fronts.length; i++) {
      var f = L.fronts[i];
      var dx = f.x + 0.5 - x, dy = f.y + 0.5 - y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  var TYPE_W = { gov: 3, church: 2, statue: 2, column: 2, theatre: 1 };

  function rioterTick(G, r, dt) {
    if (r.state === 'attackLandmark') {
      var L = G._landmarks[r._lmi];
      if (!L || L.hp <= 0) {
        r.state = 'march'; r._flow = null; return false;
      }
      var f = r._lmf;
      var dx = f.x + 0.5 - r.x, dy = f.y + 0.5 - r.y;
      if (dx * dx + dy * dy <= 2.25) {
        var lm = L.lm;
        var rate;
        if (lm.type === 'gov' || lm.type === 'church' || lm.type === 'theatre') rate = 100 / 40;
        else rate = 100 / 25;
        L.hp -= rate * dt;
        if (L.hp < 0) L.hp = 0;
        if (G.time + 6 > r.violentUntil) r.violentUntil = G.time + 6;
        if (G.time + 0.3 > r.revealedUntil) r.revealedUntil = G.time + 0.3;
        // give up roll
        var now = G.time;
        if (!r._giveUpT || now >= r._giveUpT) {
          r._giveUpT = now + 1;
          if (isOfficerNear(G, r.x, r.y, 3)) {
            if (Math.random() < 0.4) {
              r.state = 'flee'; r._fleeUntil = G.time + 8; r._flow = null;
              return false;
            }
          }
        }
        return true;
      }
      r._flow = Crowd.fieldTo(G, f.x, f.y);
      return true;
    }
    if (r.state === 'march') {
      var now2 = G.time;
      if (!r._lmRoll || now2 >= r._lmRoll) {
        r._lmRoll = now2 + 1;
        var chance = 0.06;
        if (typeof NIGHT !== 'undefined' && NIGHT.boldness) {
          chance *= NIGHT.boldness(G);
        }
        if (Math.random() < chance) {
          // pick landmark
          var best = null, bestW = 0, i;
          for (i = 0; i < G._landmarks.length; i++) {
            var LL = G._landmarks[i];
            if (LL.hp <= 0) continue;
            var lm2 = LL.lm;
            var cx = lm2.x + lm2.w / 2, cy = lm2.y + lm2.h / 2;
            var ddx = cx - r.x, ddy = cy - r.y;
            var dist = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dist > 30) continue;
            var w = (TYPE_W[lm2.type] || 1) / (1 + dist / 10);
            var tot = w;
            if (tot > bestW) { bestW = tot; best = LL; }
          }
          if (best) {
            var ff = nearestFront(best, r.x, r.y);
            if (ff) {
              r.state = 'attackLandmark';
              r._lmi = G._landmarks.indexOf(best);
              r._lmf = { x: ff.x, y: ff.y };
              r._flow = Crowd.fieldTo(G, ff.x, ff.y);
              r._targetShop = null;
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  function update(G, dt) {
    if (!G._landmarks) return;
    var i, j, L;
    // reset attackers
    for (i = 0; i < G._landmarks.length; i++) G._landmarks[i].attackers = 0;
    // count
    for (i = 0; i < G._landmarks.length; i++) {
      L = G._landmarks[i];
      if (L.hp <= 0) continue;
      var cnt = 0;
      for (j = 0; j < L.fronts.length; j++) {
        var f = L.fronts[j];
        var nb = Crowd.neighbors(G, f.x + 0.5, f.y + 0.5, 1.5);
        var k;
        for (k = 0; k < nb.length; k++) {
          var a = nb[k];
          if (a.role === 'rioter' && a.state === 'attackLandmark' && G._landmarks[a._lmi] === L) cnt++;
        }
      }
      L.attackers = cnt;
    }
    // stages + effects
    for (i = 0; i < G._landmarks.length; i++) {
      L = G._landmarks[i];
      var lm = L.lm;
      var stage;
      if (L.hp <= 0) stage = 4;
      else if (L.hp < 25) stage = 3;
      else if (L.hp < 50) stage = 2;
      else if (L.hp < 75) stage = 1;
      else stage = 0;
      if (stage !== L.stage) {
        // log
        if (stage === 1) G.log('Graffiti sprayed on ' + lm.name);
        else if (stage === 2) G.log(lm.type === 'statue' || lm.type === 'column' ? lm.name + ' is covered in paint' : lm.name + ' is being smashed up');
        else if (stage === 3) G.log(lm.name + ' is on fire!');
        else if (stage === 4) G.log(lm.name + ' has been wrecked');
        if (stage > L.stage) {
          G.stats.landmarkDamage = (G.stats.landmarkDamage || 0) + 1;
          if (typeof Art !== 'undefined' && Art.invalidate) Art.invalidate();
          var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
          var nb2 = Crowd.neighbors(G, cx, cy, 8);
          var q;
          for (q = 0; q < nb2.length; q++) {
            var ag = nb2[q];
            ag.mood = Math.min(100, ag.mood + 6);
          }
        }
        L.stage = stage;
      }
      // fire smoke
      if (L.hp > 0 && L.hp < 25 && typeof FX !== 'undefined' && FX.smokeAt) {
        L.fireT += dt;
        if (L.fireT >= 0.7) {
          L.fireT -= 0.7;
          var fx = lm.x + Math.floor(Math.random() * lm.w);
          var fy = lm.y + Math.floor(Math.random() * lm.h);
          FX.smokeAt(G, fx + 0.5, fy + 0.5);
        }
      }
      // soothe peaceful near attackers
      if (L.attackers > 0) {
        var cx2 = lm.x + lm.w / 2, cy2 = lm.y + lm.h / 2;
        var nb3 = Crowd.neighbors(G, cx2, cy2, 6);
        var p;
        for (p = 0; p < nb3.length; p++) {
          var ag2 = nb3[p];
          if (ag2.role === 'peaceful') ag2.mood = Math.min(100, ag2.mood + 1 * dt);
        }
      }
    }
  }

  function list(G) { return G._landmarks || []; }

  function nearest(G, x, y, maxDist) {
    if (!G._landmarks) return null;
    var best = null, bestD = maxDist != null ? maxDist * maxDist : 1e18, i;
    for (i = 0; i < G._landmarks.length; i++) {
      var lm = G._landmarks[i].lm;
      var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
      var dx = cx - x, dy = cy - y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = G._landmarks[i]; }
    }
    return best;
  }

  function rallyPoints() {
    var out = [];
    if (!MAP || !MAP.sites) return out;
    var i;
    for (i = 0; i < MAP.sites.length; i++) {
      var lm = MAP.sites[i];
      var cx = lm.x + lm.w / 2, cy = lm.y + lm.h / 2;
      // sample walkable tiles within 4, score by open space
      var best = null, bestScore = -1;
      var y, x;
      for (y = Math.floor(cy - 4); y <= Math.ceil(cy + 4); y++) {
        for (x = Math.floor(cx - 4); x <= Math.ceil(cx + 4); x++) {
          if (!isWalk(x, y)) continue;
          var open = 0, ex, ey;
          for (ey = y - 3; ey <= y + 3; ey++)
            for (ex = x - 3; ex <= x + 3; ex++)
              if (isWalk(ex, ey)) open++;
          var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          var score = open - d * 0.5;
          if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
        }
      }
      if (best) out.push({ x: best.x, y: best.y, name: lm.name, type: lm.type });
    }
    return out;
  }

  function summary(G) {
    var s = { total: 0, damaged: 0, wrecked: 0 };
    if (!G._landmarks) return s;
    var i;
    for (i = 0; i < G._landmarks.length; i++) {
      var L = G._landmarks[i];
      s.total++;
      if (L.stage >= 1 && L.hp > 0) s.damaged++;
      if (L.hp <= 0) s.wrecked++;
    }
    return s;
  }

  // ---- drawing ----

  /* drawing lives in landmarks_art.js */
  function draw(ctx, G) { if (typeof LANDMARKS_ART !== "undefined") LANDMARKS_ART.draw(ctx, G, list(G)); }

  return { autoPlace: autoPlace, init: init, rioterTick: rioterTick, update: update, draw: draw, list: list, nearest: nearest, rallyPoints: rallyPoints, summary: summary };
})();
if (typeof module !== "undefined" && module.exports) module.exports = LANDMARKS;
