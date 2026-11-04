var UNITTYPES = (function () {
  var defs = {};
  function register(def) { defs[def.id] = def; return def; }
  function get(id) { return defs[id] || defs.none || null; }
  function list() { var a = [], k; for (k in defs) if (defs.hasOwnProperty(k)) a.push(defs[k]); a.sort(function (x, y) { return x.order - y.order; }); return a; }
  function ids() { return list().map(function (d) { return d.id; }); }
  function byKey(k) { var a = list(), i; for (i = 0; i < a.length; i++) if (a[i].key === k) return a[i]; return get("none"); }
  function vehicle(id) { var d = get(id); return d && d.vehicle ? d.vehicle : null; }
  function canArrest(id) { var d = get(id); return !!(d && d.canArrest); }
  /* on-map tag: type + number within that type ("VAN 2"), so it matches the type keys
   * instead of a global squad number the player has to count */
  function tag(G, s) {
    if (typeof Police === "undefined" || !Police.getLoadout) return String(s + 1);
    var lo = Police.getLoadout(G, s), d = get(lo), n = 0, i;
    for (i = 0; i <= s; i++) if (Police.getLoadout(G, i) === lo) n++;
    var word = d.label || ({ none: "FOOT", motorbike: "BIKE", mounted: "HORSE" }[d.id]) || d.short.toUpperCase();
    return word + " " + n;
  }
  return { tag: tag, register: register, get: get, list: list, ids: ids, byKey: byKey, vehicle: vehicle, canArrest: canArrest };
})();
