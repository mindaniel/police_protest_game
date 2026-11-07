/* chase.js - squads on a crime call (or patrolling nearby) run after the suspects they see,
 * instead of standing at the spot where the crime was reported. Checked twice a second. */
var CHASE = (function () {
  var tick = 0, SEE = 10, SEE_CALL = 14, LOSE = 18;

  function squadPos(G, s) {
    var x = 0, y = 0, n = 0, i, o;
    for (i = 0; i < G.officers.length; i++) { o = G.officers[i]; if (o.squad === s && !o.escorting) { x += o.x; y += o.y; n++; } }
    if (n) return { x: x / n, y: y / n, foot: true };
    for (i = 0; i < G.vehicles.length; i++) if (G.vehicles[i].squad === s) return { x: G.vehicles[i].x, y: G.vehicles[i].y, foot: false };
    return null;
  }
  function free(G, s) {
    var o = G.orders && G.orders[s];
    if (o && (o.order === "line" || o.order === "kettle" || o.holdLine)) return false;
    if (G.dispatch && G.dispatch[s]) return true;
    return !o || !o.order || o.order === "patrol";
  }

  function update(G, dt) {
    if (typeof CRIME === "undefined" || !CRIME.list) return;
    tick += dt;
    if (tick < 0.5) return;
    tick = 0;
    if (!G._chase) G._chase = {};
    var L = CRIME.list(), s, i, j, n = CONFIG.squadCount;
    for (s = 0; s < n; s++) {
      var ch = G._chase[s];
      if (!UNITTYPES.canArrest(Police.getLoadout(G, s)) || !free(G, s)) { if (ch) delete G._chase[s]; continue; }
      var p = squadPos(G, s);
      if (!p) continue;
      var range = (G.dispatch && G.dispatch[s]) ? SEE_CALL : SEE;
      if (ch) range = LOSE;   /* already chasing: keep him until he is far away */
      var best = null, bd = range * range;
      for (i = 0; i < L.length; i++) for (j = 0; j < L[i].culprits.length; j++) {
        var c = L[i].culprits[j];
        if (c.caught) continue;
        var dx = c.x - p.x, dy = c.y - p.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) {
        if (ch) {
          delete G._chase[s];
          var left = false;   /* only "lost" when a suspect is still out there */
          for (i = 0; i < L.length && !left; i++) for (j = 0; j < L[i].culprits.length; j++) if (!L[i].culprits[j].caught) left = true;
          if (left && UI && UI.say) UI.say("Radio: " + UNITTYPES.tag(G, s) + " lost the suspect");
        }
        continue;
      }
      if (!ch) {
        G._chase[s] = { t: G.time };
        if (UI && UI.say) UI.say("Radio: " + UNITTYPES.tag(G, s) + " sees a suspect - giving chase");
      }
      G._chase[s].until = G.time + 2;
      var aboard = typeof TRANSPORT !== "undefined" && TRANSPORT.isAboard && TRANSPORT.isAboard(G, s);
      if (aboard && bd < 36) TRANSPORT.toggle(G, s);   /* close: jump out and run */
      else Police.moveSquad(G, s, best.x, best.y, true);
    }
  }
  function chasing(G, s) { return !!(G._chase && G._chase[s] && G._chase[s].until > G.time); }
  function reset(G) { tick = 0; if (G) G._chase = {}; }
  return { update: update, chasing: chasing, reset: reset };
})();
