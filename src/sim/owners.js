/* owners.js - shop owners call for help, then step out to confront looters (DeepSeek) */
var OWNERS = (function () {
  var owners = [];
  var shopState = {}; // id -> {called, callTime, lastAttack, outTime}
  var nextId = 1;

  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function nearestWalkable(G, sx, sy) {
    var best = null, bd = 1e9;
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        var nx = sx + dx, ny = sy + dy;
        if (!Police.isWalkable(G, nx, ny)) continue;
        var d = dist2(nx, ny, sx, sy);
        if (d < bd) { bd = d; best = { x: nx, y: ny }; }
      }
    }
    return best ? { x: best.x + 0.5, y: best.y + 0.5 } : { x: sx + 0.5, y: sy + 0.5 };
  }

  function attackersOf(G, shop) {
    var out = [];
    for (var i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (a.active && a.state === "attackShop" && a._targetShop === shop) out.push(a);
    }
    return out;
  }

  function officerNear(G, x, y, r) {
    var r2 = r * r;
    for (var i = 0; i < G.officers.length; i++) {
      var o = G.officers[i];
      if (dist2(o.x, o.y, x, y) <= r2) return true;
    }
    return false;
  }

  function ambulanceNear(G, x, y, r) {
    var r2 = r * r;
    if (!G.vehicles) return false;
    for (var i = 0; i < G.vehicles.length; i++) {
      var v = G.vehicles[i];
      if (v.type === "ambulance" && dist2(v.x, v.y, x, y) <= r2) return true;
    }
    return false;
  }

  function ownersOfShop(shop) {
    var out = [];
    for (var i = 0; i < owners.length; i++) if (owners[i].shopId === shop.id) out.push(owners[i]);
    return out;
  }

  function spawnOwners(G, shop, count) {
    var spot = nearestWalkable(G, shop.x, shop.y);
    for (var i = 0; i < count; i++) {
      var ox = spot.x + (Math.random() - 0.5) * 0.6;
      var oy = spot.y + (Math.random() - 0.5) * 0.6;
      owners.push({
        id: nextId++, shopId: shop.id, x: ox, y: oy, homeX: spot.x, homeY: spot.y,
        hurt: false, arguing: true, outTime: G.time, phase: Math.random() * 6.28
      });
    }
    G.stats.ownersOut = (G.stats.ownersOut || 0) + count;
  }

  function helpOwner(G, o, shop) {
    o.helped = true;
    G.stats.ownersHelped = (G.stats.ownersHelped || 0) + 1;
    G.log("Owner helped: " + shop.name);
  }

  function update(G, dt) {
    if (!G.shops) return;
    var i, j;
    for (i = 0; i < G.shops.length; i++) {
      var shop = G.shops[i];
      var st = shopState[shop.id];
      var att = attackersOf(G, shop);
      var hasAtt = att.length > 0;
      var shopOwners = ownersOfShop(shop);
      if (!hasAtt && !shopOwners.length && !st) continue;

      if (!st) st = shopState[shop.id] = { called: false, callTime: 0, lastAttack: 0, outTime: 0 };

      if (hasAtt) {
        st.lastAttack = G.time;
        if (!st.called) {
          st.called = true;
          st.callTime = G.time;
          var label = "Owner calls for help: " + shop.name;
          ALERTS.push("owner_call", label, shop.x, shop.y, "#ffcc44", G);
          G.log(label);
        }
      }

      // call unanswered -> owners step out
      if (st.called && !shopOwners.length && hasAtt &&
          (G.time - st.callTime) >= 20 && !officerNear(G, shop.x, shop.y, 6)) {
        if (!st.outTime || (G.time - st.outTime) > 30) {
          st.outTime = G.time;
          spawnOwners(G, shop, 1 + (Math.random() * 3 | 0));
        }
      }

      // per-owner behaviour
      shopOwners = ownersOfShop(shop);
      for (j = 0; j < shopOwners.length; j++) {
        var o = shopOwners[j];
        o.phase += dt;
        if (o.hurt) {
          if (officerNear(G, o.x, o.y, 2) || ambulanceNear(G, o.x, o.y, 3)) helpOwner(G, o, shop);
        } else {
          // hurt chance per second
          if (hasAtt) {
            var near = 0;
            for (var k = 0; k < att.length; k++) if (dist2(att[k].x, att[k].y, o.x, o.y) <= 36) near++;
            if (near > 0 && Math.random() < 0.12 * dt * near) {
              o.hurt = true;
              o.arguing = false;
              G.stats.ownersHurt = (G.stats.ownersHurt || 0) + 1;
              ALERTS.push("owner_hurt", "Shop owner hurt: " + shop.name, o.x, o.y, "#ff4444", G);
              G.log("Shop owner hurt: " + shop.name);
              for (var m = 0; m < G.agents.length; m++) {
                var a = G.agents[m];
                if (a.active && dist2(a.x, a.y, o.x, o.y) <= 36) a.mood = (a.mood || 0) + 8;
              }
            }
          }
          // head back inside
          if (officerNear(G, shop.x, shop.y, 4) ||
              (!hasAtt && (G.time - st.lastAttack) >= 10 && st.lastAttack > 0)) {
            o.leaving = true;
          }
        }
      }

      // remove owners that left / were helped
      for (j = owners.length - 1; j >= 0; j--) {
        var oo = owners[j];
        if (oo.shopId !== shop.id) continue;
        if (oo.hurt) continue;
        if (oo.leaving) {
          oo.homeX = shop.x; oo.homeY = shop.y;
          var dx = shop.x - oo.x, dy = shop.y - oo.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 1;
          oo.x += (dx / d) * dt * 1.5;
          oo.y += (dy / d) * dt * 1.5;
          if (d < 0.3) owners.splice(j, 1);
        }
      }
      for (j = owners.length - 1; j >= 0; j--) {
        if (owners[j].helped) owners.splice(j, 1);
      }

      // cleanup state if quiet
      if (!hasAtt && !ownersOfShop(shop).length && (G.time - st.lastAttack) > 30) {
        delete shopState[shop.id];
      }
    }
  }

  function breakFactor(G, shop) {
    var list = ownersOfShop(shop);
    for (var i = 0; i < list.length; i++) if (!list[i].hurt && !list[i].leaving) return 0.6;
    return 1;
  }

  /* Zoom levels (Art.detail): far = marker icons only, mid = small person + small icon,
   * near = real-size person only (icons would cover the street). */
  function draw(ctx, G) {
    if (!Art || !Art.camera || !Art.detail) return;
    var lvl = Art.detail();
    for (var i = 0; i < owners.length; i++) {
      var o = owners[i];
      var p = Art.project(o.x, o.y, 0), q = Art.project(o.x + 1, o.y, 0);
      var pt = Math.abs(q.x - p.x) || 8;   /* screen units per tile */
      if (p.x < -20 || p.y < -20 || p.x > ctx.canvas.width + 20 || p.y > ctx.canvas.height + 20) continue;
      if (lvl !== "far" && !o.hurt && Art.drawPerson && Art.drawPerson(ctx, o.x, o.y, 9000 + i, o.arguing ? "#5577cc" : "#99bbee", 0)) {
        /* real sprite drawn */
      } else if (lvl !== "far") {   /* the person, real size (~0.4 tiles) */
        var r = pt * 0.14;
        if (o.hurt) {
          ctx.fillStyle = "#5577cc";
          ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.8, r * 0.8, 0.4, 0, 6.283); ctx.fill();
          ctx.fillStyle = "#eee";
          ctx.beginPath(); ctx.arc(p.x + r * 1.5, p.y + r * 0.6, r * 0.6, 0, 6.283); ctx.fill();
        } else {
          ctx.fillStyle = o.arguing ? "#5577cc" : "#99bbee";
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill();
          ctx.fillStyle = "#eee";
          ctx.beginPath(); ctx.arc(p.x, p.y - r * 0.2, r * 0.55, 0, 6.283); ctx.fill();
        }
      }
      if (lvl === "near") continue;
      /* marker: fixed small size so it never covers the street */
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = o.hurt ? "#e33" : "#ffcc00";
      ctx.fillText(o.hurt ? "+" : "!", p.x, p.y - Math.max(6, pt * 0.3));
    }
  }


  function reset() {
    owners = [];
    shopState = {};
    nextId = 1;
  }

  return { update: update, draw: draw, reset: reset, breakFactor: breakFactor,
           list: function () { return owners; } };
})();
