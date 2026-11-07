/* crime.js (DeepSeek) */
/* crime.js (DeepSeek) */
var CRIME = (function () {
  var nextId = 1;
  var incidents = [];
  var spawnTimer = 30;
  var tickTimer = 0;
  var alertTimer = 0;

  /* ---- helpers ------------------------------------------------------- */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist2(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

  function ensureStats(G) {
    if (!G.stats) G.stats = {};
    if (typeof G.stats.crimeSolved !== "number") G.stats.crimeSolved = 0;
    if (typeof G.stats.crimeMissed !== "number") G.stats.crimeMissed = 0;
    if (typeof G.stats.victimsSaved !== "number") G.stats.victimsSaved = 0;
    if (typeof G.stats.victimsLost !== "number") G.stats.victimsLost = 0;
  }

  function crowdNearby(G, x, y) {
    if (typeof Crowd !== "undefined" && Crowd.neighbors) {
      return Crowd.neighbors(G, x, y, 10).length >= 20;
    }
    return false;
  }

  function walkable(G, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0) return false;
    var w = (G && G.mapW) || 64, h = (G && G.mapH) || 64;
    if (x >= w || y >= h) return false;
    if (typeof Police !== "undefined" && Police.isWalkable) {
      return !!Police.isWalkable(G, x, y);
    }
    return true;
  }

  function inBounds(G, x, y) {
    var w = (G && G.mapW) || 64, h = (G && G.mapH) || 64;
    return x >= 0 && y >= 0 && x < w && y < h;
  }

  function parkedList(G) {
    if (G && G.parked && typeof G.parked.list === "function") return G.parked.list();
    if (typeof PARKED !== "undefined" && PARKED.list) return PARKED.list();
    return [];
  }

  function getLoadout(G, squad) {
    if (typeof Police !== "undefined" && Police.getLoadout) {
      return Police.getLoadout(G, squad);
    }
    return null;
  }

  function canArrestLoadout(loadout) {
    if (typeof UNITTYPES !== "undefined" && UNITTYPES.canArrest) {
      return !!UNITTYPES.canArrest(loadout);
    }
    return true;
  }

  function isAmbulanceLoadout(loadout) {
    if (typeof loadout === "string") return loadout === "ambulance";
    if (loadout && typeof loadout === "object") {
      return loadout.type === "ambulance" || loadout.id === "ambulance" ||
             loadout.name === "ambulance";
    }
    return false;
  }

  function pushAlert(G, kind, label, x, y, color) {
    if (typeof ALERTS !== "undefined" && ALERTS.push) {
      ALERTS.push(kind, label, x, y, color, G);
    }
  }

  function say(msg) {
    if (typeof UI !== "undefined" && UI.say) UI.say(msg);
  }

  function streetName(G, x, y, shopName) {
    if (shopName) return shopName;
    return "street";
  }

  /* Officers within radius (linear over officers, not crowd). */
  function officersWithin(G, x, y, r) {
    var out = [];
    var r2 = r * r;
    var os = (G && G.officers) || [];
    for (var i = 0; i < os.length; i++) {
      var o = os[i];
      if (o && dist2(o.x, o.y, x, y) <= r2) out.push(o);
    }
    return out;
  }

  function arrestOfficerNear(G, x, y, r) {
    var os = officersWithin(G, x, y, r);
    for (var i = 0; i < os.length; i++) {
      if (canArrestLoadout(getLoadout(G, os[i].squad))) return os[i];
    }
    return null;
  }

  /* Walkable step toward a preferred direction; pick a fresh direction at
     junctions / blocked tiles. Never reverse into the tile we came from. */
  function stepFlee(G, c, dt, speed) {
    var moved = false;
    if (c.dirT > 0) c.dirT -= dt;
    else c.dirT = 0;

    if (!c.dx && !c.dy) pickDir(G, c, -1, -1);

    if (c.dirT <= 0) {
      /* reached a junction-ish point: consider a turn */
      c.dirT = rand(0.6, 1.6);
      if (Math.random() < 0.5) pickDir(G, c, c.pdx, c.pdy);
    }

    var nx = c.x + c.dx * speed * dt;
    var ny = c.y + c.dy * speed * dt;

    if (walkable(G, nx, ny)) {
      c.x = nx; c.y = ny; moved = true;
    } else if (walkable(G, c.x + c.dx * speed * dt, c.y)) {
      c.x += c.dx * speed * dt; moved = true; pickDir(G, c, c.pdx, c.pdy);
    } else if (walkable(G, c.x, c.y + c.dy * speed * dt)) {
      c.y += c.dy * speed * dt; moved = true; pickDir(G, c, c.pdx, c.pdy);
    } else {
      pickDir(G, c, -1, -1);
    }

    /* occasional re-aim, keeps paths from looking robotic */
    c.wanderT = (c.wanderT || 0) - dt;
    if (c.wanderT <= 0) {
      c.wanderT = rand(1.2, 2.6);
      if (Math.random() < 0.35) pickDir(G, c, c.pdx, c.pdy);
    }
    return moved;
  }

  var DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]
  ];

  function pickDir(G, c, avoidDx, avoidDy) {
    var opts = [];
    for (var i = 0; i < DIRS.length; i++) {
      var dx = DIRS[i][0], dy = DIRS[i][1];
      if (avoidDx === dx && avoidDy === dy) continue; /* no bouncing back */
      if (walkable(G, c.x + dx, c.y + dy)) opts.push([dx, dy]);
    }
    if (!opts.length) {
      /* fully boxed in: allow reverse */
      for (var j = 0; j < DIRS.length; j++) {
        if (walkable(G, c.x + DIRS[j][0], c.y + DIRS[j][1])) opts.push(DIRS[j]);
      }
    }
    if (!opts.length) { c.dx = 0; c.dy = 0; return; }
    var pick = opts[Math.floor(Math.random() * opts.length)];
    c.pdx = c.dx; c.pdy = c.dy;
    c.dx = pick[0]; c.dy = pick[1];
  }

  /* ---- spawning ------------------------------------------------------ */

  function pickCulpritSpot(G, spot) {
    var tries = 10;
    for (var i = 0; i < tries; i++) {
      var ox = spot.x + Math.round(rand(-1, 1));
      var oy = spot.y + Math.round(rand(-1, 1));
      if (walkable(G, ox, oy)) return { x: ox, y: oy };
    }
    /* spot inside a shop or building: nearest street tile, else culprits can never run */
    for (var r = 1; r <= 4; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (walkable(G, spot.x + dx, spot.y + dy)) return { x: spot.x + dx + 0.5, y: spot.y + dy + 0.5 };
    }
    return { x: spot.x, y: spot.y };
  }

  function makeCulprit(G, spot, speed) {
    var sp = pickCulpritSpot(G, spot);
    var c = {
      x: sp.x, y: sp.y,
      dx: 0, dy: 0, pdx: -1, pdy: -1,
      dirT: rand(0.4, 1.2),
      wanderT: rand(1, 2),
      speed: speed || 2.2,
      fleeT: 0,
      caught: false,
      held: 0 /* used by shop robbery 3s delay */
    };
    return c;
  }

  function trySpawn(G) {
    if (incidents.length >= 4) return;

    var roll = Math.random() * 10; /* weights: 3+2+1+1+2+1 = 10 */
    var kind;
    if (roll < 3) kind = "bag snatch";
    else if (roll < 5) kind = "shop robbery";
    else if (roll < 6) kind = "car arson";
    else if (roll < 7) kind = "stabbing";
    else if (roll < 9) kind = "assault";
    else if (roll < 10) kind = "street fight";
    else kind = "burglar alarm";

    /* pick a clear-ish anchor away from crowds */
    var anchor = null;
    for (var i = 0; i < 12; i++) {
      var tx = Math.floor(rand(0, (G && G.mapW) || 64));
      var ty = Math.floor(rand(0, (G && G.mapH) || 64));
      if (!walkable(G, tx, ty)) continue;
      if (crowdNearby(G, tx, ty)) continue;
      anchor = { x: tx, y: ty };
      break;
    }
    if (!anchor) return;

    var shops = (G && G.shops) || [];
    var shopName = null;
    var spot = { x: anchor.x, y: anchor.y };
    var victims = [];
    var fire = false;
    var culprits = [];
    var label;
    var incType = kind;

    /* nearest shop helper */
    function nearestShop(from) {
      var best = null, bd = 1e9;
      for (var s = 0; s < shops.length; s++) {
        var d = dist2(shops[s].x, shops[s].y, from.x, from.y);
        if (d < bd) { bd = d; best = shops[s]; }
      }
      return best;
    }

    if (kind === "bag snatch") {
      if (crowdNearby(G, anchor.x, anchor.y)) return; /* want a lone victim */
      victims.push({ x: spot.x, y: spot.y, down: false, label: "bag snatch" });
      var c1 = makeCulprit(G, spot, 2.2);
      culprits.push(c1);
      label = "Bag snatch - " + streetName(G, spot.x, spot.y, shopName);
      incType = "bag snatch";

    } else if (kind === "shop robbery") {
      var sh = nearestShop(anchor);
      if (!sh) return;
      for (var oi = 0; oi < incidents.length; oi++) {   /* one robbery per shop at a time */
        if (!incidents[oi].resolved && Math.abs(incidents[oi].x - sh.x) + Math.abs(incidents[oi].y - sh.y) < 4) return;
      }
      spot = { x: sh.x, y: sh.y };
      shopName = sh.name;
      var a = makeCulprit(G, spot, 2.2);
      var b = makeCulprit(G, spot, 2.2);
      a.held = 3; b.held = 3;
      a.dx = 1; a.dy = 0; b.dx = -1; b.dy = 0; /* different directions later */
      culprits.push(a); culprits.push(b);
      label = "Shop robbery - " + streetName(G, spot.x, spot.y, shopName);
      incType = "shop robbery";

    } else if (kind === "car arson") {
      var cars = parkedList(G);
      var car = null;
      if (cars.length) {
        var bc = null, bcd = 1e9;
        for (var ci = 0; ci < cars.length; ci++) {
          var cd = dist2(cars[ci].x, cars[ci].y, anchor.x, anchor.y);
          if (cd < bcd) { bcd = cd; bc = cars[ci]; }
        }
        car = bc;
      }
      if (!car) return;
      spot = { x: car.x, y: car.y };
      var arson = makeCulprit(G, spot, 1.2);
      arson.arson = true;
      culprits.push(arson);
      fire = true;
      label = "Car on fire - " + streetName(G, spot.x, spot.y, shopName);
      incType = "car arson";

    } else if (kind === "stabbing" || kind === "assault") {
      if (crowdNearby(G, anchor.x, anchor.y)) return;
      victims.push({ x: spot.x, y: spot.y, down: true, label: kind });
      var perp = makeCulprit(G, spot, 2.2);
      culprits.push(perp);
      label = (kind === "stabbing" ? "Stabbing" : "Assault") + " - " + streetName(G, spot.x, spot.y, shopName);
      incType = kind;

    } else if (kind === "street fight") {
      var f1 = makeCulprit(G, spot, 1.0);
      var f2 = makeCulprit(G, spot, 1.0);
      culprits.push(f1); culprits.push(f2);
      label = "Street fight - " + streetName(G, spot.x, spot.y, shopName);
      incType = "street fight";

    } else { /* burglar alarm */
      var sh2 = nearestShop(anchor);
      if (sh2) { spot = { x: sh2.x, y: sh2.y }; shopName = sh2.name; }
      label = "Burglar alarm - " + streetName(G, spot.x, spot.y, shopName);
      incType = "burglar alarm";
    }

    var deadlineMap = { "stabbing": 150, "assault": 210 };   /* big city maps: an ambulance across town needs ~90 s */
    var dLine = deadlineMap[kind] || rand(90, 150);

    var inc = {
      id: nextId++,
      type: incType,
      label: label,
      x: spot.x,
      y: spot.y,
      deadline: G.time + dLine,
      culprits: culprits,
      victims: victims,
      fire: fire,
      falseAlarm: (kind === "burglar alarm") ? (Math.random() < 0.4) : false,
      resolved: false,
      medTimer: 0
    };
    incidents.push(inc);

    /* alert bursts at spawn */
    if (kind === "car arson") {
      if (typeof FX !== "undefined" && FX.addFire && inBounds(G, Math.floor(spot.x), Math.floor(spot.y))) {
        FX.addFire(G, Math.floor(spot.x), Math.floor(spot.y));
      }
      pushAlert(G, "fire", "Car on fire - street", spot.x, spot.y, "#ff9a3c");
      pushAlert(G, "crime", "Arson suspect - street", spot.x, spot.y, "#c78bff");
    } else if (kind === "stabbing" || kind === "assault") {
      pushAlert(G, "medical", "Person down - street", spot.x, spot.y, "#ff6b6b");
      pushAlert(G, "crime", "Assault suspect - street", spot.x, spot.y, "#c78bff");
    } else if (kind !== "burglar alarm") {
      pushAlert(G, "crime", label, spot.x, spot.y, "#c78bff");
    } else {
      pushAlert(G, "crime", label, spot.x, spot.y, "#c78bff");
    }
    alertTimer = 0;
  }

  /* ---- per-incident logic ------------------------------------------- */

  function fleeSpeed(c) {
    /* slow to walk (0.9) after 20s of fleeing, to blend in */
    return c.fleeT > 20 ? 0.9 : (c.speed || 2.2);
  }

  function updateIncident(G, inc, dt) {
    if (inc.resolved) return;

    /* burglar alarm: no culprits */
    if (inc.type === "burglar alarm" && inc.culprits.length === 0) {
      var near = officersWithin(G, inc.x, inc.y, 3);
      if (near.length) {
        inc.resolved = true;
        if (inc.falseAlarm) say("False alarm: " + inc.label);
        else { ensureStats(G); G.stats.crimeSolved++; say("Crime solved: " + inc.label); }
        return;
      }
      if (G.time >= inc.deadline) {
        inc.resolved = true;
        say("Cold case: " + inc.label);
      }
      return;
    }

    /* victims: medics need ambulance within 1.5 for 4s total */
    for (var v = 0; v < inc.victims.length; v++) {
      var vic = inc.victims[v];
      if (!vic.down) continue;
      if (vic.handled) continue;

      var helped = false;
      var os = officersWithin(G, vic.x, vic.y, 1.5);
      for (var oi = 0; oi < os.length; oi++) {
        if (isAmbulanceLoadout(getLoadout(G, os[oi].squad))) { helped = true; break; }
      }
      if (helped) inc.medTimer += dt;
      else if (inc.medTimer > 0) inc.medTimer = Math.max(0, inc.medTimer - dt * 0.5);

      if (inc.medTimer >= 4) {
        vic.handled = true;
        say("Medics took the victim to hospital");
        ensureStats(G);
        G.stats.victimsSaved++;
      } else if (G.time >= inc.deadline) {
        vic.handled = true;
        vic.lost = true;
        say("Victim died before help came (" + inc.label + ")");
        ensureStats(G);
        G.stats.victimsLost++;
      }
    }

    /* culprits */
    for (var i = 0; i < inc.culprits.length; i++) {
      var c = inc.culprits[i];
      if (c.caught) continue;

      /* arrest check */
      if (arrestOfficerNear(G, c.x, c.y, 1)) {
        c.caught = true;
        continue;
      }

      /* shop robbery hold inside shop for 3s, then split */
      if (inc.type === "shop robbery" && c.held > 0) {
        c.held -= dt;
        if (c.held <= 0) {
          c.dirT = 0.2;
          pickDir(G, c, -1, -1);
          if (i === 0) { c.dx = 1; c.dy = 0; }
          else { c.dx = -1; c.dy = 0; }
          if (!walkable(G, c.x + c.dx, c.y + c.dy)) pickDir(G, c, -1, -1);
          c.fleeT = 0.01;
        }
        continue;
      }

      /* street fight: shuffle, then bolt when police near 4 */
      if (inc.type === "street fight" && c.fleeT <= 0) {
        var near4 = officersWithin(G, c.x, c.y, 4);
        if (near4.length) {
          c.fleeT = 0.5;
          c.dirT = 0.2;
          pickDir(G, c, -1, -1);
        } else {
          c.x += (Math.random() - 0.5) * 0.6 * dt;
          c.y += (Math.random() - 0.5) * 0.6 * dt;
          if (!walkable(G, c.x, c.y)) { c.x = c.ox; c.y = c.oy; }
          continue;
        }
      }

      /* bag snatch / robbery / arson / assault / stabbing: flee immediately */
      if (inc.type === "bag snatch" || inc.type === "shop robbery" ||
          inc.type === "car arson" || inc.type === "stabbing" ||
          inc.type === "assault" || inc.type === "street fight") {
        c.fleeT += dt;
        var sp = fleeSpeed(c);
        stepFlee(G, c, dt, sp);
      }
    }

    /* resolution: all culprits caught (or none exist) AND victims handled */
    var culpritsDone = true;
    for (var j = 0; j < inc.culprits.length; j++) {
      if (!inc.culprits[j].caught) { culpritsDone = false; break; }
    }
    var victimsDone = true;
    for (var k = 0; k < inc.victims.length; k++) {
      if (inc.victims[k].down && !inc.victims[k].handled) { victimsDone = false; break; }
    }

    if (G.time >= inc.deadline) {
      /* deadline: escaped / missed */
      var missed = false;
      for (var m = 0; m < inc.culprits.length; m++) {
        if (!inc.culprits[m].caught) { inc.culprits[m].escaped = true; missed = true; }
      }
      for (var n = 0; n < inc.victims.length; n++) {
        if (inc.victims[n].down && !inc.victims[n].handled) {
          inc.victims[n].handled = true; inc.victims[n].lost = true;
          say("Victim died before help came (" + inc.label + ")");
          ensureStats(G); G.stats.victimsLost++;
          missed = true;
        }
      }
      inc.resolved = true;
      if (missed || !culpritsDone) {
        ensureStats(G);
        G.stats.crimeMissed++;
        say("Crime missed: " + inc.label);
      } else {
        ensureStats(G);
        G.stats.crimeSolved++;
        say("Crime solved: " + inc.label);
      }
      return;
    }

    if (culpritsDone && victimsDone) {
      inc.resolved = true;
      ensureStats(G);
      G.stats.crimeSolved++;
      say("Crime solved: " + inc.label);
    }
  }

  /* ---- drawing ------------------------------------------------------- */

  function draw(ctx, G) {
    if (typeof Art === "undefined" || !Art.project) return;
    var zoom = (Art.camera && Art.camera.zoom) || 1;
    var pt = Math.abs(Art.project(1, 0, 0).x - Art.project(0, 0, 0).x) || 1;

    for (var i = 0; i < incidents.length; i++) {
      var inc = incidents[i];
      if (inc.resolved) continue;
      var p = Art.project(inc.x, inc.y, 0);

      /* incident marker */
      if (zoom > 1.2) {
        ctx.fillStyle = "#c78bff";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("!", p.x, p.y - 12);
      } else {
        ctx.fillStyle = "#c78bff";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 6);
        ctx.lineTo(p.x + 6, p.y);
        ctx.lineTo(p.x, p.y + 6);
        ctx.lineTo(p.x - 6, p.y);
        ctx.closePath();
        ctx.fill();
      }

      if (zoom > 2) {
        var remain = Math.max(0, Math.round(inc.deadline - G.time));
        ctx.fillStyle = "#ffffff";
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.fillText(remain + "s", p.x + 8, p.y + 4);
      }

      /* down victims: red "+" at any zoom, body when zoom > 1.2 */
      for (var v = 0; v < inc.victims.length; v++) {
        var vic = inc.victims[v];
        if (!vic.down) continue;
        var vp = Art.project(vic.x, vic.y, 0);

        if (zoom > 1.2) {
          var bw = Math.max(3, pt * 0.5);
          var bh = Math.max(2, pt * 0.18);
          ctx.save();
          ctx.translate(vp.x, vp.y);
          ctx.fillStyle = "#2b2433";
          ctx.beginPath();
          ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0.5, 0, Math.PI * 2);
          ctx.fill();
          var hr = Math.max(1.5, pt * 0.08);
          ctx.beginPath();
          ctx.arc(bw * 0.28, -bh * 0.18, hr, 0, Math.PI * 2);
          ctx.fillStyle = "#3a3142";
          ctx.fill();
          ctx.restore();
        }

        /* red cross marker at any zoom */
        var cs = Math.max(2, pt * 0.12);
        ctx.strokeStyle = "#ff6b6b";
        ctx.lineWidth = Math.max(1, pt * 0.05);
        ctx.beginPath();
        ctx.moveTo(vp.x - cs, vp.y - cs * 1.8);
        ctx.lineTo(vp.x + cs, vp.y - cs * 1.8);
        ctx.moveTo(vp.x, vp.y - cs * 2.8);
        ctx.lineTo(vp.x, vp.y - cs * 0.8);
        ctx.stroke();
      }
    }
  }

  /* ---- main loop ----------------------------------------------------- */

  function update(G, dt) {
    if (typeof G.time !== "number") G.time = 0;
    ensureStats(G);

    if (G.time > 20) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = rand(30, 70);
        trySpawn(G);
      }
    }

    alertTimer += dt;
    if (alertTimer >= 10) {
      alertTimer = 0;
      for (var i = 0; i < incidents.length; i++) {
        var inc = incidents[i];
        if (inc.resolved) continue;
        if (inc.type === "car arson") {
          pushAlert(G, "fire", "Car on fire - street", inc.x, inc.y, "#ff9a3c");
          pushAlert(G, "crime", "Arson suspect - street", inc.x, inc.y, "#c78bff");
        } else if (inc.type === "stabbing" || inc.type === "assault") {
          var anyDown = false;
          for (var q = 0; q < inc.victims.length; q++) {
            if (inc.victims[q].down && !inc.victims[q].handled) { anyDown = true; break; }
          }
          if (anyDown) pushAlert(G, "medical", "Person down - street", inc.x, inc.y, "#ff6b6b");
          pushAlert(G, "crime", "Assault suspect - street", inc.x, inc.y, "#c78bff");
        } else if (inc.culprits.length > 0) {
          var anyOpen = false;
          for (var r = 0; r < inc.culprits.length; r++) {
            if (!inc.culprits[r].caught) { anyOpen = true; break; }
          }
          if (anyOpen) pushAlert(G, "crime", inc.label, inc.x, inc.y, "#c78bff");
        } else if (inc.type === "burglar alarm") {
          pushAlert(G, "crime", inc.label, inc.x, inc.y, "#c78bff");
        }
      }
    }

    tickTimer += dt;
    if (tickTimer >= 0.25) {
      tickTimer = 0;
      for (var j = 0; j < incidents.length; j++) {
        if (!incidents[j].resolved) updateIncident(G, incidents[j], 0.25);
      }
      var open = [];
      for (var k = 0; k < incidents.length; k++) {
        if (!incidents[k].resolved) open.push(incidents[k]);
      }
      incidents = open;
    }
  }

  function reset(G) {
    incidents = [];
    nextId = 1;
    spawnTimer = 30;
    tickTimer = 0;
    alertTimer = 0;
    if (G) ensureStats(G);
  }

  function list() {
    var out = [];
    for (var i = 0; i < incidents.length; i++) {
      var inc = incidents[i];
      if (inc.resolved) continue;
      var cl = [];
      for (var c = 0; c < inc.culprits.length; c++) {
        cl.push({
          x: inc.culprits[c].x,
          y: inc.culprits[c].y,
          caught: inc.culprits[c].caught,
          fleeT: inc.culprits[c].fleeT || 0
        });
      }
      var vl = [];
      for (var v = 0; v < inc.victims.length; v++) {
        vl.push({
          x: inc.victims[v].x,
          y: inc.victims[v].y,
          down: inc.victims[v].down !== false
        });
      }
      out.push({
        id: inc.id,
        type: inc.type,
        label: inc.label,
        x: inc.x,
        y: inc.y,
        deadline: inc.deadline,
        culprits: cl,
        victims: vl,
        fire: !!inc.fire
      });
    }
    return out;
  }

  return { update: update, draw: draw, reset: reset, list: list };
})();
