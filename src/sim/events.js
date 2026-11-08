/* Protest events: on a big map only a few protest areas are live at a time.
 * Each event opens one area of CONFIG.rallyZones, releases a batch of held-back protesters near it,
 * may turn into a riot, and ends after a while (its people walk off and are removed out of view).
 * Events nobody watches (no camera, no police near) are frozen: their people do not move.
 * Heavy work runs once per second. Hooks: crowd.js skips zones with .off and agents with ._frozen. */
var EVENTS = (function () {
  var BIG = 400000, MAXEV = 3, GAP = 25, REUSE = 120, NEAR_DOOR = 25, WATCH_R = 40, MARGIN = 15;

  function zones() { return (typeof CONFIG !== "undefined" && CONFIG.rallyZones) || []; }

  function hold(a) {
    a._evHeld = true; a._ev = -1; a._frozen = false;
    a.active = false; a.pending = true; a.spawnAt = Infinity;
    a._zone = -1; a._flow = null; a._leaving = false; a.left = false;
  }

  function setup(G) {
    var zs = zones(), i, a;
    for (i = 0; i < zs.length; i++) zs[i].off = true;
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if ((a.role === "peaceful" || a.role === "rioter") && (a.pending || (a.active && G.time < 1))) hold(a);
    }
    G._zoneLoad = [];
    var sp = MAP.crowdSpawn || { x: 0, y: 0, w: 1, h: 1 };
    return { events: [], nextId: 1, lastStart: -1e9, used: {}, acc: 1, exit: null,
             ex: Math.floor(sp.x + sp.w / 2), ey: Math.floor(sp.y + sp.h / 2), want: 2 };
  }

  function doorsNear(x, y) {
    var d = MAP.doors || [], out = [], r2 = NEAR_DOOR * NEAR_DOOR;
    for (var i = 0; i < d.length; i++) {
      var dx = d[i].x - x, dy = d[i].y - y;
      if (dx * dx + dy * dy < r2) out.push(d[i]);
    }
    return out;
  }

  /* put up to n held agents of one role near (x, y), arriving within `spread` seconds */
  function release(G, role, n, x, y, spread, id) {
    var doors = doorsNear(x, y), got = 0;
    for (var i = 0; i < G.agents.length && got < n; i++) {
      var a = G.agents[i];
      if (!a._evHeld || a.role !== role) continue;
      var d = doors.length ? doors[Math.floor(Math.random() * doors.length)] : { x: Math.floor(x), y: Math.floor(y) };
      a.x = d.x + 0.25 + Math.random() * 0.5;
      a.y = d.y + 0.25 + Math.random() * 0.5;
      a.spawnAt = G.time + Math.random() * spread;
      a._evHeld = false; a._ev = id; a.mood = a.mood || 20;
      got++;
    }
    return got;
  }

  function startEvent(G, st) {
    var zs = zones(), free = [], i;
    for (i = 0; i < zs.length; i++) {
      if (!zs[i].off) continue;
      if (st.used[i] !== undefined && G.time - st.used[i] < REUSE) continue;
      free.push(i);
    }
    if (!free.length) return;
    var zi = free[Math.floor(Math.random() * free.length)], z = zs[zi];
    var ev = { id: st.nextId++, zone: zi, x: z.x, y: z.y, start: G.time, dur: 240 + Math.random() * 240,
               riot: false, frozen: false, n: 0 };
    z.off = false;
    ev.n = release(G, "peaceful", 60 + Math.floor(Math.random() * 81), z.x, z.y, 40, ev.id);
    if (!ev.n) { z.off = true; return; }
    st.events.push(ev);
    st.lastStart = G.time;
    st.used[zi] = G.time;
    if (G.log) G.log("A protest is gathering");
  }

  function endEvent(G, st, ev) {
    zones()[ev.zone].off = true;
    if (!st.exit && typeof Crowd !== "undefined") st.exit = Crowd.fieldTo(G, st.ex, st.ey);
    for (var i = 0; i < G.agents.length; i++) {
      var a = G.agents[i];
      if (a._ev !== ev.id) continue;
      a._frozen = false;
      if (a.pending && !a.active) { hold(a); continue; }   /* had not arrived yet */
      if (!a.active || a.arrested || a.escorting || (a._march !== null && a._march !== undefined)) continue;
      if (a.role === "peaceful" && st.exit) Crowd.sendAway(G, a, st.exit);
      a._evGone = true;
    }
  }

  function watched(G, ev) {
    var cam = (typeof Art !== "undefined") ? Art.camera : null, i, o, dx, dy, r2 = WATCH_R * WATCH_R;
    if (cam && typeof cam.cx === "number") {
      var z = cam.zoom > 0 ? cam.zoom : 1;
      if (Math.abs(ev.x - cam.cx) <= 20 / z + MARGIN && Math.abs(ev.y - cam.cy) <= 13 / z + MARGIN) return true;
    }
    var lists = [G.officers || [], G.vehicles || []];
    for (var l = 0; l < 2; l++) for (i = 0; i < lists[l].length; i++) {
      o = lists[l][i]; dx = o.x - ev.x; dy = o.y - ev.y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  function inView(x, y) {
    var cam = (typeof Art !== "undefined") ? Art.camera : null;
    if (!cam || typeof cam.cx !== "number") return false;
    var z = cam.zoom > 0 ? cam.zoom : 1;
    return Math.abs(x - cam.cx) <= 20 / z + 4 && Math.abs(y - cam.cy) <= 13 / z + 4;
  }

  function tick(G, st) {
    var evs = st.events, i, e, a, byId = {}, alive = {}, mood = {};
    for (e = 0; e < evs.length; e++) {
      evs[e].frozen = !watched(G, evs[e]);
      byId[evs[e].id] = evs[e]; alive[evs[e].id] = 0; mood[evs[e].id] = 0;
    }
    for (i = 0; i < G.agents.length; i++) {
      a = G.agents[i];
      if (a.left && !a.arrested && !a._evHeld) { hold(a); continue; }   /* gone home: can come back in a later event */
      if (a._evGone) {   /* ended event: removed once out of sight */
        if (!a.active) { a._evGone = false; continue; }
        if (!a.arrested && !a.escorting && !inView(a.x, a.y)) { Crowd.removeAgent(G, a); a._evGone = false; }
        continue;
      }
      var ev = a._ev > 0 ? byId[a._ev] : null;
      if (!ev) { a._frozen = false; continue; }
      if (a.active && !a.arrested) { alive[ev.id]++; mood[ev.id] += a.mood || 0; }
      a._frozen = ev.frozen && a.active && a.role !== "rioter" && !a.arrested && !a.escorting && !a._leaving &&
                  (a._march === null || a._march === undefined);
    }
    for (e = evs.length - 1; e >= 0; e--) {
      var v = evs[e], n = alive[v.id], avg = n ? mood[v.id] / n : 0;
      if (!v.riot && n && Math.random() < 0.004 + (avg > 60 ? 0.01 : 0)) {
        v.riot = release(G, "rioter", 4, v.x, v.y, 10, v.id) > 0;
        if (v.riot && G.log) G.log("Trouble is starting at a protest");
      }
      if (G.time > v.start + v.dur || (G.time > v.start + 60 && n < 15)) { endEvent(G, st, v); evs.splice(e, 1); }
    }
    if (G.time > 90) st.want = MAXEV;
    if (evs.length < st.want && G.time - st.lastStart >= GAP) startEvent(G, st);
  }

  var lastG = null;
  function update(G, dt) {
    lastG = G;
    if (!G.agents || !zones().length || MAP.width * MAP.height < BIG) return;   /* small maps keep every area live */
    var st = G._ev;
    if (!st) st = G._ev = setup(G);
    st.acc += dt;
    if (st.acc < 1) return;
    st.acc = 0;
    tick(G, st);
  }

  function active() {
    var out = [], G = lastG;
    if (!G || !G._ev) return out;
    for (var i = 0; i < G._ev.events.length; i++) {
      var v = G._ev.events[i];
      out.push({ zone: v.zone, x: v.x, y: v.y, start: v.start, dur: v.dur, frozen: v.frozen, riot: v.riot });
    }
    return out;
  }

  return { update: update, active: active };
})();
