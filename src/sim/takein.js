/* takein.js - after a street job the squad takes its person in: a squad with a vehicle that
 * caught a suspect boards and drives him to the police station; an ambulance crew that
 * treated a victim boards and drives the patient to the hospital. Checked once a second. */
var TAKEIN = (function () {
  var tick = 0;

  /* s: squad index, kind: "station" | "hospital" */
  function add(G, s, kind) {
    if (s == null || s < 0 || typeof TRANSPORT === "undefined" || !TRANSPORT.vehicleOf || !TRANSPORT.vehicleOf(G, s)) return false;
    if (!G._takeIn) G._takeIn = {};
    var q = G._takeIn[s];
    if (q) { q.n++; return true; }
    G._takeIn[s] = { kind: kind, t: G.time, n: 1, boarded: false };
    return true;
  }

  function update(G, dt) {
    tick += dt;
    if (tick < 1 || !G._takeIn) return;
    tick = 0;
    for (var k in G._takeIn) {
      var s = +k, q = G._takeIn[k], v = TRANSPORT.vehicleOf(G, s);
      if (!v || G.time - q.t > 90) { delete G._takeIn[k]; continue; }   /* gave up (no vehicle / blocked) */
      if (typeof POV !== "undefined" && POV.controlled() === s) continue;   /* the player drives it there */
      if (v.run === "station" || v.run === "unload") { delete G._takeIn[k]; continue; }
      if (typeof CHASE !== "undefined" && CHASE.chasing(G, s)) continue;      /* another suspect first */
      if (TRANSPORT.isAboard(G, s)) {
        if (TRANSPORT.deliver(G, s, q.kind, q.n)) {
          var tag = UNITTYPES.tag ? UNITTYPES.tag(G, s) : "Squad " + (s + 1);
          if (UI && UI.say) UI.say("Radio: " + tag + (q.kind === "hospital" ? " driving the patient to hospital" : " taking the suspect to the station"));
        }
        delete G._takeIn[k];
      } else if (!q.boarded && !(TRANSPORT.isBoarding && TRANSPORT.isBoarding(G, s))) {
        q.boarded = true;
        TRANSPORT.toggle(G, s);   /* everyone back in the vehicle */
      }
    }
  }
  function reset(G) { tick = 0; if (G) G._takeIn = {}; }
  return { add: add, update: update, reset: reset };
})();
