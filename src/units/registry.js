var UNITTYPES = (function () {
  var defs = {};
  function register(def) { defs[def.id] = def; return def; }
  function get(id) { return defs[id] || defs.none || null; }
  function list() { var a = [], k; for (k in defs) if (defs.hasOwnProperty(k)) a.push(defs[k]); a.sort(function (x, y) { return x.order - y.order; }); return a; }
  function ids() { return list().map(function (d) { return d.id; }); }
  function byKey(k) { var a = list(), i; for (i = 0; i < a.length; i++) if (a[i].key === k) return a[i]; return get("none"); }
  function vehicle(id) { var d = get(id); return d && d.vehicle ? d.vehicle : null; }
  function canArrest(id) { var d = get(id); return !!(d && d.canArrest); }
  return { register: register, get: get, list: list, ids: ids, byKey: byKey, vehicle: vehicle, canArrest: canArrest };
})();
