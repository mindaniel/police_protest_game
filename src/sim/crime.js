/* crime.js (DeepSeek) */
var CRIME = (function () {
  var nextId = 1;
  var incidents = [];
  var spawnTimer = 30;
  var tickTimer = 0;
  var alertTimer = 0;

  var TYPES = [
    { t: "shoplifting", label: "Shoplifting" },
    { t: "car break-in", label: "Car break-in" },
    { t: "bag snatch", label: "Bag snatch" },
    { t: "burglar alarm", label: "Burglar alarm" },
    { t: "street fight", label: "Street fight" }
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  function ensureStats(G) {
    if (!G.stats) G.stats = {};
    if (typeof G.stats.crimeSolved !== "number") G.stats.crimeSolved = 0;
    if (typeof G.stats.crimeMissed !== "number") G.stats.crimeMissed = 0;
  }

  function crowdNearby(G, x, y) {
    return CRIME_CrowdSafe(G, x, y);
  }

  function CRIME_CrowdSafe(G, x, y) {
    if (typeof Crowd !== "undefined" && Crowd.neighbors) {
      return Crowd.neighbors(G, x, y, 10).length >= 20;
    }
    return false;
  }

  function walkable(G, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;   /* off-map candidates */
    return typeof Police !== "undefined" && Police.isWalkable ? Police.isWalkable(G, x, y) : true;
  }

  function parkedList(G) {
    if (G.parked && typeof G.parked.list === "function") return G.parked.list();
    if (typeof PARKED !== "undefined" && PARKED.list) return PARKED.list();
    return [];
  }

  function nameAt(G, x, y, shopName) {
    if (shopName) return shopName;
    return "street";
  }

  function trySpawn(G) {
    if (incidents.length >= 4) return;
    var tries = 12;
    var cand = null;
    for (var i = 0; i < tries; i++) {
      var tx = Math.floor(rand(0, (G.mapW || 64)));
      var ty = Math.floor(rand(0, (G.mapH || 64)));
      if (!walkable(G, tx, ty)) continue;
      if (crowdNearby(G, tx, ty)) continue;
      cand = { x: tx, y: ty };
      break;
    }
    if (!cand) return;

    var typePick = TYPES[Math.floor(Math.random() * TYPES.length)];
    var spot = { x: cand.x, y: cand.y };
    var shopName = null;
    var shops = G.shops || [];

    if (typePick.t === "shoplifting" || typePick.t === "burglar alarm") {
      if (shops.length) {
        var best = null, bd = 1e9;
        for (var s = 0; s < shops.length; s++) {
          var d = dist(shops[s].x, shops[s].y, cand.x, cand.y);
          if (d < bd && !crowdNearby(G, shops[s].x, shops[s].y)) { bd = d; best = shops[s]; }
        }
        if (best) { spot = { x: best.x, y: best.y }; shopName = best.name; }
        else if (typePick.t === "shoplifting") { typePick = TYPES[1]; }
        else { typePick = TYPES[2]; }
      } else {
        typePick = TYPES[2];
      }
    }

    if (typePick.t === "car break-in") {
      var cars = parkedList(G);
      if (cars.length) {
        var bc = null, bcd = 1e9;
        for (var c = 0; c < cars.length; c++) {
          var cd = dist(cars[c].x, cars[c].y, spot.x, spot.y);
          if (cd < bcd) { bcd = cd; bc = cars[c]; }
        }
        if (bc) spot = { x: bc.x, y: bc.y };
      } else {
        typePick = TYPES[2];
      }
    }

    var label = typePick.label + " - " + nameAt(G, spot.x, spot.y, shopName);
    var culprits = [];
    var numC = (typePick.t === "street fight") ? 2 : 1;
    if (typePick.t === "burglar alarm") numC = 0;

    for (var k = 0; k < numC; k++) {
      var ox = spot.x + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 0 : 1);
      var oy = spot.y + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 0 : 1);
      if (!walkable(G, ox, oy)) { ox = spot.x; oy = spot.y; }
      culprits.push({ x: ox, y: oy, ox: ox, oy: oy, fleeT: 0, vx: 0, vy: 0, caught: false });
    }

    var inc = {
      id: nextId++,
      type: typePick.t,
      label: label,
      x: spot.x,
      y: spot.y,
      deadline: G.time + rand(90, 150),
      culprits: culprits,
      falseAlarm: (typePick.t === "burglar alarm") ? (Math.random() < 0.4) : false,
      resolved: false
    };
    incidents.push(inc);
    pushAlert(G, inc);
    alertTimer = 0;
  }

  function pushAlert(G, inc) {
    if (typeof ALERTS !== "undefined" && ALERTS.push) {
      ALERTS.push("crime", inc.label, inc.x, inc.y, "#c78bff", G);
    }
  }

  function officersNear(G, x, y, r) {
    var out = [];
    var os = G.officers || [];
    for (var i = 0; i < os.length; i++) {
      if (dist(os[i].x, os[i].y, x, y) <= r) out.push(os[i]);
    }
    return out;
  }

  function updateIncident(G, inc, dt) {
    if (inc.resolved) return;

    if (inc.type === "burglar alarm" && inc.culprits.length === 0) {
      var near = officersNear(G, inc.x, inc.y, 3);
      if (near.length) {
        inc.resolved = true;
        if (inc.falseAlarm) {
          if (typeof UI !== "undefined" && UI.say) UI.say("False alarm: " + inc.label);
        } else {
          ensureStats(G);
          G.stats.crimeSolved = (G.stats.crimeSolved || 0) + 1;
          if (typeof UI !== "undefined" && UI.say) UI.say("Crime solved: " + inc.label);
        }
        return;
      }
      if (G.time >= inc.deadline) {
        inc.resolved = true;
        if (typeof UI !== "undefined" && UI.say) UI.say("Cold case: " + inc.label);
      }
      return;
    }

    var allCaught = inc.culprits.length > 0;
    for (var i = 0; i < inc.culprits.length; i++) {
      var c = inc.culprits[i];
      if (c.caught) continue;
      allCaught = false;

      var near1 = officersNear(G, c.x, c.y, 1);
      if (near1.length) {
        c.caught = true;
        allCaught = false;
        continue;
      }

      var near4 = officersNear(G, c.x, c.y, 4);
      if (near4.length && c.fleeT <= 0) {
        c.fleeT = 8;
        var off = near4[0];
        var dx = c.x - off.x, dy = c.y - off.y;
        var m = Math.sqrt(dx * dx + dy * dy) || 1;
        c.vx = dx / m;
        c.vy = dy / m;
      }

      if (c.fleeT > 0) {
        c.fleeT -= dt;
        var nx = c.x + c.vx * 1.6 * dt;
        var ny = c.y + c.vy * 1.6 * dt;
        if (walkable(G, nx, ny)) { c.x = nx; c.y = ny; }
        else { c.vx = -c.vx; c.vy = -c.vy; }
      }
    }

    var allDone = true;
    for (var j = 0; j < inc.culprits.length; j++) {
      if (!inc.culprits[j].caught) allDone = false;
    }
    if (allDone && inc.culprits.length > 0) {
      inc.resolved = true;
      ensureStats(G);
      G.stats.crimeSolved = (G.stats.crimeSolved || 0) + 1;
      if (typeof UI !== "undefined" && UI.say) UI.say("Crime solved: " + inc.label);
      return;
    }

    if (G.time >= inc.deadline) {
      inc.resolved = true;
      ensureStats(G);
      G.stats.crimeMissed = (G.stats.crimeMissed || 0) + 1;
      if (typeof UI !== "undefined" && UI.say) UI.say("Crime missed: " + inc.label);
    }
  }

  function draw(ctx, G) {
    if (typeof Art === "undefined") return;
    var zoom = (Art.camera && Art.camera.zoom) || 1;
    var pt = Math.abs(Art.project(1, 0, 0).x - Art.project(0, 0, 0).x) || 1;
    for (var i = 0; i < incidents.length; i++) {
      var inc = incidents[i];
      if (inc.resolved) continue;
      var p = Art.project(inc.x, inc.y, 0);

      if (zoom > 1.2) {
        for (var c = 0; c < inc.culprits.length; c++) {
          var cu = inc.culprits[c];
          if (cu.caught) continue;
          var cp = Art.project(cu.x, cu.y, 0);
          var r = Math.max(2, pt * 0.14);
          ctx.fillStyle = "#2a2030";
          ctx.beginPath();
          ctx.arc(cp.x, cp.y - r, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#3d2f45";
          ctx.beginPath();
          ctx.arc(cp.x, cp.y - r * 1.6, r * 0.75, Math.PI, 0);
          ctx.fill();
        }
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
    }
  }

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
        if (!incidents[i].resolved) pushAlert(G, incidents[i]);
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
        cl.push({ x: inc.culprits[c].x, y: inc.culprits[c].y, caught: inc.culprits[c].caught });
      }
      out.push({
        id: inc.id, type: inc.type, label: inc.label,
        x: inc.x, y: inc.y, deadline: inc.deadline, culprits: cl
      });
    }
    return out;
  }

  return { update: update, draw: draw, reset: reset, list: list };
})();
