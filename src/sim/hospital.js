/* hospital.js - one hospital per map: a named hospital site from the map data when there
 * is one, else a building by a road, well away from the police station. Ambulances bring
 * patients here (takein.js). G.hospital = { x, y (door on the road), bx, by (building), name } */
var HOSPITAL = (function () {
  function tile(x, y) { return (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) ? "#" : MAP.rows[y].charAt(x); }
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = n * 0x27d4eb2d; return (n ^ (n >>> 15)) >>> 0; }

  /* road tile next to a building tile near (cx, cy) */
  function doorNear(cx, cy, R) {
    var best = null, bd = 1e9, x, y, d;
    for (y = Math.max(1, cy - R); y < Math.min(MAP.height - 1, cy + R); y++)
      for (x = Math.max(1, cx - R); x < Math.min(MAP.width - 1, cx + R); x++) {
        if (tile(x, y) !== ".") continue;
        var b = tile(x, y - 1) === "#" ? [x, y - 1] : tile(x + 1, y) === "#" ? [x + 1, y] : tile(x - 1, y) === "#" ? [x - 1, y] : tile(x, y + 1) === "#" ? [x, y + 1] : null;
        if (!b) continue;
        d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bd) { bd = d; best = { x: x, y: y, bx: b[0], by: b[1] }; }
      }
    return best;
  }

  function init(G) {
    G.hospital = null;
    if (typeof MAP === "undefined" || !MAP.rows) return;
    var sites = MAP.sites || [], i, s, d = null, name = "Hospital";
    for (i = 0; i < sites.length && !d; i++) {
      s = sites[i];
      if (!/h[oô]pital|hospital|clinic|clinique|krankenhaus|hastane|b[eệ]nh vi[eệ]n/i.test(s.name || "")) continue;
      d = doorNear(Math.floor(s.x + (s.w || 0) / 2), Math.floor(s.y + (s.h || 0) / 2), 12);
      if (d) name = s.name;
    }
    if (!d) {   /* no hospital in the map data: a road-side building far from the station, not at the edge */
      var st = G.station || { x: MAP.width / 2, y: MAP.height / 2 }, bestS = -1e9, k;
      var seed = hash(MAP.width * 131 + MAP.height);
      for (k = 0; k < 600; k++) {
        var x = 6 + hash(seed + k * 2) % Math.max(1, MAP.width - 12), y = 6 + hash(seed + k * 2 + 1) % Math.max(1, MAP.height - 12);
        var c = doorNear(x, y, 2);
        if (!c) continue;
        var ds = Math.sqrt((c.x - st.x) * (c.x - st.x) + (c.y - st.y) * (c.y - st.y));
        var dc = Math.sqrt((c.x - MAP.width / 2) * (c.x - MAP.width / 2) + (c.y - MAP.height / 2) * (c.y - MAP.height / 2));
        var score = Math.min(ds, (MAP.width + MAP.height) * 0.3) - dc * 0.5;
        if (score > bestS) { bestS = score; d = c; }
      }
    }
    if (d) G.hospital = { x: d.x + 0.5, y: d.y + 0.5, bx: d.bx, by: d.by, name: name };
  }

  function draw(ctx, G) {
    var h = G && G.hospital;
    if (!h || typeof Art === "undefined") return;
    var S = (Art.camera && Art.camera.S) || 1;
    var c = Art.project(h.bx + 0.5, h.by + 0.5, 1.9);
    var w = Math.max(64, 64 * S), hh = Math.max(14, 14 * S);
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#d62839";
    ctx.lineWidth = 2;
    ctx.fillRect(c.x - w / 2, c.y - hh / 2, w, hh);
    ctx.strokeRect(c.x - w / 2, c.y - hh / 2, w, hh);
    var cs = hh * 0.62, cx = c.x - w / 2 + hh * 0.6;   /* red cross */
    ctx.fillStyle = "#d62839";
    ctx.fillRect(cx - cs / 2, c.y - cs / 6, cs, cs / 3);
    ctx.fillRect(cx - cs / 6, c.y - cs / 2, cs / 3, cs);
    ctx.font = "bold " + Math.max(9, 9 * S) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HOSPITAL", c.x + hh * 0.35, c.y + 0.5);
    ctx.restore();
  }

  return { init: init, draw: draw };
})();
