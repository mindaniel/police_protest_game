/* traffic.js - civilian car traffic (DeepSeek) */
var TRAFFIC = (function(){
  "use strict";

  var COLORS = ["#9b5a4f","#4f6f93","#d2ccbc","#6d8a5f","#3d4246","#b88a3a","#7a4f8f"];
  var CRUISE = { major: 3.6, minor: 3.0, service: 2.2 };
  var ACCEL = 3.0, BRAKE = 8.0;
  var MAXCARS_DEFAULT = 60;

  var cars = [];
  var people = [];
  var maxCars = MAXCARS_DEFAULT;
  var graph = null;
  var graphKey = null;
  var msSamples = [];
  var msSum = 0, msCount = 0;
  var lastAccidentT = 0;
  var nextAccidentT = 0;
  var honkCooldownT = 0;
  var idCounter = 1;
  var laneOccupancy = [];
  var occupTimer = 0;
  var lastNow = 0;
  var frameAccum = 0;

  function now(){ return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  function rand(a,b){ return a + Math.random()*(b-a); }

  function roadTypeRank(c){ return c === "major" ? 0 : c === "minor" ? 1 : 2; }

  // ---------- graph build ----------
  function buildGraph(){
    graph = { nodes: [], lanes: [], lanesByNode: [], nodeKeyMap: {} };
    if (!MAP || !MAP.roads || !MAP.roads.length) { graph = null; return; }

    var nodes = graph.nodes;
    var lanes = [];

    function nodeKey(x,y){
      var kx = Math.round(x*10)/10, ky = Math.round(y*10)/10;
      return kx + ":" + ky;
    }

    var ngrid = {};   // 1-tile cells -> nodes, so snapping is not a scan of every node (big maps)
    function addNode(x,y){
      var n = { x:x, y:y, idx:nodes.length };
      nodes.push(n);
      var k = Math.floor(x) + "," + Math.floor(y);
      (ngrid[k] || (ngrid[k] = [])).push(n);
      return n;
    }

    function snapNode(x,y){
      var best = null, bestD = 0.8, cx = Math.floor(x), cy = Math.floor(y);
      for (var oy=-1; oy<=1; oy++) for (var ox=-1; ox<=1; ox++){
        var L = ngrid[(cx+ox) + "," + (cy+oy)];
        if (!L) continue;
        for (var i=0;i<L.length;i++){
          var n = L[i];
          var dx = n.x-x, dy = n.y-y;
          var d = Math.sqrt(dx*dx+dy*dy);
          if (d < bestD || (d === bestD && best && n.idx < best.idx)){ bestD = d; best = n; }
        }
      }
      if (best) return best;
      return addNode(x,y);
    }

    // Gather road endpoints first (so interior snap works)
    var roadVerts = []; // each = {road, pts:[{x,y}], twoWay, offset, type}
    for (var ri=0; ri<MAP.roads.length; ri++){
      var r = MAP.roads[ri];
      if (!r.p || r.p.length < 4) continue;
      var pts = [];
      for (var j=0;j<r.p.length;j+=2) pts.push({x:r.p[j], y:r.p[j+1]});
      var twoWay = !r.o;
      var off = twoWay ? Math.max(0.3, Math.min(1.1, (r.w||4)*0.2)) : 0;
      roadVerts.push({ road:r, pts:pts, twoWay:twoWay, offset:off, type:r.c||"minor", w:r.w||4 });
    }

    // For each road, detect T-junctions: any other road's endpoint that lies near this road's interior segment.
    // Build split points per road (indices into pts).
    var splits = [];
    for (var i=0;i<roadVerts.length;i++) splits.push([]);
    // endpoints in 8-tile cells: each segment only checks endpoints near it (was every road x every road)
    var EC = 8, egrid = {};
    for (var b0=0;b0<roadVerts.length;b0++){
      var rbs = roadVerts[b0], ends = [rbs.pts[0], rbs.pts[rbs.pts.length-1]];
      for (var e0=0;e0<2;e0++){
        var ek = Math.floor(ends[e0].x/EC) + "," + Math.floor(ends[e0].y/EC);
        (egrid[ek] || (egrid[ek] = [])).push(b0, ends[e0]);
      }
    }
    for (var a=0;a<roadVerts.length;a++){
      var ra = roadVerts[a];
      for (var s=0; s<ra.pts.length-1; s++){
        var q0 = ra.pts[s], q1 = ra.pts[s+1];
        var gx0 = Math.floor((Math.min(q0.x,q1.x)-1)/EC), gx1 = Math.floor((Math.max(q0.x,q1.x)+1)/EC);
        var gy0 = Math.floor((Math.min(q0.y,q1.y)-1)/EC), gy1 = Math.floor((Math.max(q0.y,q1.y)+1)/EC);
        for (var gy=gy0; gy<=gy1; gy++) for (var gx=gx0; gx<=gx1; gx++){
          var EL = egrid[gx + "," + gy];
          if (!EL) continue;
          for (var ei=0; ei<EL.length; ei+=2){
            if (EL[ei] === a) continue;
            var ep = EL[ei+1];
            var p0 = ra.pts[s], p1 = ra.pts[s+1];
            var dx = p1.x-p0.x, dy = p1.y-p0.y;
            var len2 = dx*dx+dy*dy;
            if (len2 < 1e-6) continue;
            var t = ((ep.x-p0.x)*dx + (ep.y-p0.y)*dy)/len2;
            if (t <= 0.02 || t >= 0.98) continue;
            var px = p0.x + t*dx, py = p0.y + t*dy;
            var ddx = px-ep.x, ddy = py-ep.y;
            if (ddx*ddx+ddy*ddy <= 1.0){ // within 1 tile
              splits[a].push({ seg:s, t:t, x:px, y:py });
            }
          }
        }
      }
    }

    // Build per-road vertex list, inserting split points
    var roadNodeLists = []; // per road: array of node indices for each vertex in order
    for (var i2=0;i2<roadVerts.length;i2++){
      var rv = roadVerts[i2];
      var nodeList = [];
      var sp = splits[i2];
      // sort splits by seg then t
      sp.sort(function(x,y){ return x.seg - y.seg || x.t - y.t; });
      var spIdx = 0;
      for (var v=0; v<rv.pts.length; v++){
        var pt = rv.pts[v];
        // insert any splits that fall before this vertex on previous segment
        if (v > 0){
          while (spIdx < sp.length && sp[spIdx].seg === v-1){
            var spn = snapNode(sp[spIdx].x, sp[spIdx].y);
            nodeList.push(spn.idx);
            spIdx++;
          }
        }
        // skip interior split vertices that got inserted; but we insert only split points here, not original vertices
        var isSplit = false;
        // if this vertex was also a split point from another road, it's fine to snap
        var n = snapNode(pt.x, pt.y);
        nodeList.push(n.idx);
      }
      roadNodeLists.push(nodeList);
    }

    // lanesByNode
    graph.lanesByNode = [];
    for (var i3=0;i3<nodes.length;i3++) graph.lanesByNode.push([]);

    // Build lanes
    for (var ri2=0;ri2<roadVerts.length;ri2++){
      var rv2 = roadVerts[ri2];
      var nl = roadNodeLists[ri2];
      if (nl.length < 2) continue;
      // forward direction (drawn)
      buildLanePair(nl, rv2, true);
      if (rv2.twoWay) buildLanePair(nl, rv2, false);
    }

    function buildLanePair(nodeIdxs, rv, forward){
      var pts = [];
      var cum = [0];
      var nodeSeq = forward ? nodeIdxs : nodeIdxs.slice().reverse();
      for (var k=0;k<nodeSeq.length;k++){
        var n = nodes[nodeSeq[k]];
        pts.push({x:n.x, y:n.y});
      }
      // apply right offset
      var off = rv.offset;
      var total = 0;
      var offPts = [];
      for (var k2=0;k2<pts.length;k2++){
        var p = pts[k2];
        var dirx = 0, diry = 0;
        if (k2 < pts.length-1){ dirx = pts[k2+1].x-p.x; diry = pts[k2+1].y-p.y; }
        else { dirx = p.x-pts[k2-1].x; diry = p.y-pts[k2-1].y; }
        var dl = Math.sqrt(dirx*dirx+diry*diry) || 1;
        dirx/=dl; diry/=dl;
        // right of travel = (diry, -dirx) in screen coords (y down)
        var rx = diry, ry = -dirx;
        offPts.push({ x: p.x + rx*off, y: p.y + ry*off });
      }
      // cumulative
      cum = [0];
      for (var k3=1;k3<offPts.length;k3++){
        var dx = offPts[k3].x - offPts[k3-1].x;
        var dy = offPts[k3].y - offPts[k3-1].y;
        cum.push(cum[k3-1] + Math.sqrt(dx*dx+dy*dy));
      }
      var lane = {
        id: lanes.length,
        nodeA: forward ? nodeIdxs[0] : nodeIdxs[nodeIdxs.length-1],
        nodeB: forward ? nodeIdxs[nodeIdxs.length-1] : nodeIdxs[0],
        pts: offPts,
        cum: cum,
        len: cum[cum.length-1],
        type: rv.type,
        twoWay: rv.twoWay,
        cars: []
      };
      if (lane.len < 0.5) return;
      lanes.push(lane);
      graph.lanesByNode[lane.nodeA].push(lane);
    }

    graph.lanes = lanes;
    graph.lanesByNode = graph.lanesByNode;

    // lane occupancy arrays
    laneOccupancy = [];
    for (var li=0; li<lanes.length; li++) laneOccupancy.push([]);
    cars.length = 0;
    people.length = 0;
  }

  // ---------- lane helpers ----------
  function lanePointAt(lane, s){
    var cum = lane.cum, pts = lane.pts;
    if (s <= 0) return { x: pts[0].x, y: pts[0].y, ang: Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x) };
    if (s >= lane.len){
      var p = pts[pts.length-1], q = pts[pts.length-2];
      return { x: p.x, y: p.y, ang: Math.atan2(p.y-q.y, p.x-q.x) };
    }
    // binary search
    var lo = 0, hi = cum.length-1;
    while (lo < hi-1){
      var mid = (lo+hi)>>1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    var segLen = cum[hi]-cum[lo];
    var t = segLen > 1e-6 ? (s-cum[lo])/segLen : 0;
    var a = pts[lo], b = pts[hi];
    return {
      x: a.x + (b.x-a.x)*t,
      y: a.y + (b.y-a.y)*t,
      ang: Math.atan2(b.y-a.y, b.x-a.x)
    };
  }

  function pickNextLane(lane, carsAtEnd){
    var nb = graph.lanesByNode[lane.nodeB];
    if (!nb || !nb.length) return lane; // loop if dead end
    var candidates = [];
    for (var i=0;i<nb.length;i++){
      var l = nb[i];
      if (l === lane) continue; // avoid immediate u-turn
      // also avoid opposite lane of same road if possible
      candidates.push(l);
    }
    if (!candidates.length){
      // allow u-turn
      for (var j=0;j<nb.length;j++) candidates.push(nb[j]);
    }
    if (!candidates.length) return lane;
    // prefer not the exact opposite
    var pick = candidates[(Math.random()*candidates.length)|0];
    return pick;
  }

  function removeCar(car){
    var idx = cars.indexOf(car);
    if (idx >= 0) cars.splice(idx, 1);
    if (car.lane){
      var arr = laneOccupancy[car.lane.id];
      if (arr){
        var j = arr.indexOf(car);
        if (j >= 0) arr.splice(j,1);
      }
    }
  }

  function spawnCar(){
    if (!graph || !graph.lanes.length) return null;
    // prefer major/minor
    var tries = 8;
    for (var t=0;t<tries;t++){
      var lane = graph.lanes[(Math.random()*graph.lanes.length)|0];
      if (lane.type === "service" && Math.random() < 0.5) continue;
      if (lane.len < 3) continue;
      var s = rand(1, Math.max(1, lane.len-1));
      // check no car too close
      var arr = laneOccupancy[lane.id];
      var ok = true;
      for (var i=0;i<arr.length;i++){
        if (Math.abs(arr[i].s - s) < 2.5){ ok = false; break; }
      }
      if (!ok) continue;
      var p = lanePointAt(lane, s);
      if (p.x < 1 || p.y < 1 || p.x >= MAP.width - 1 || p.y >= MAP.height - 1) continue;   /* on the map only */
      var car = {
        x: p.x, y: p.y, ang: p.ang,
        col: COLORS[(Math.random()*COLORS.length)|0],
        state: "ok", lane: lane, s: s, v: 0,
        targetLane: null, targetS: 0,
        blockedT: 0, clearT: 0, honked: false,
        turnAround: false,
        stuckT: 0,
        obstacleTimer: (Math.random()*0.5)|0,
        pplTimer: 0,
        hasPpl: false,
        crashT: 0,
        policeNearT: 0,
        id: idCounter++
      };
      cars.push(car);
      arr.push(car);
      return car;
    }
    return null;
  }

  function addPerson(x, y, state, col){
    var p = { x:x, y:y, id:idCounter++, col: col || COLORS[(Math.random()*COLORS.length)|0], state: state || "walk", life: 25, tx:0, ty:0, stuckT:0 };
    // pick initial target
    pickWalkTarget(p, null);
    people.push(p);
    return p;
  }

  function pickWalkTarget(p, from){
    // walk in random direction on walkable tiles
    var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (var i=0;i<6;i++){
      var d = dirs[(Math.random()*dirs.length)|0];
      var dx = d[0], dy = d[1];
      var tx = p.x + dx*rand(3,8);
      var ty = p.y + dy*rand(3,8);
      if (isWalkable(Math.floor(tx), Math.floor(ty))){
        p.tx = tx; p.ty = ty;
        return;
      }
    }
    p.tx = p.x + rand(-3,3);
    p.ty = p.y + rand(-3,3);
  }

  function isWalkable(tx, ty){
    if (!MAP || tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) return false;
    var ch = MAP.rows[ty] ? MAP.rows[ty].charAt(tx) : "";
    if (ch === "#" || ch === "" || ch === undefined) return false;
    return true;
  }

  function isRoad(tx, ty){
    if (!MAP || tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) return false;
    var ch = MAP.rows[ty] ? MAP.rows[ty].charAt(tx) : "";
    return ch === "." || ch === "," || ch === "-";
  }

  function isTileBlocked(tx, ty, G){
    var key = tx + "," + ty;
    if (G.blocked && G.blocked.has(key)) return true;
    if (G.fireBlocked && G.fireBlocked.has(key)) return true;
    return false;
  }

  // ---------- per-frame ----------
  function reset(G){
    cars.length = 0;
    people.length = 0;
    graph = null;
    graphKey = null;
    msSamples = []; msSum = 0; msCount = 0;
    laneOccupancy = [];
    lastAccidentT = 0;
    nextAccidentT = 0;
    honkCooldownT = 0;
  }

  function setMax(n){
    maxCars = Math.max(0, n|0);
  }

  function list(){ return cars; }
  function peopleList(){ return people; }

  function carAt(x, y, r){
    var best = null, bestD = r*r;
    for (var i=0;i<cars.length;i++){
      var c = cars[i];
      var dx = c.x-x, dy = c.y-y;
      var d = dx*dx+dy*dy;
      if (d <= bestD){ bestD = d; best = c; }
    }
    return best;
  }

  function stats(){
    return {
      cars: cars.length,
      lanes: graph ? graph.lanes.length : 0,
      nodes: graph ? graph.nodes.length : 0,
      ms: msCount ? msSum/msCount : 0
    };
  }

  // occupancy rebuild
  function rebuildOccupancy(){
    for (var i=0;i<laneOccupancy.length;i++) laneOccupancy[i].length = 0;
    for (var j=0;j<cars.length;j++){
      var c = cars[j];
      if (c.lane && laneOccupancy[c.lane.id]) laneOccupancy[c.lane.id].push(c);
    }
    for (var k=0;k<laneOccupancy.length;k++){
      laneOccupancy[k].sort(function(a,b){ return a.s - b.s; });
    }
  }

  function findAheadOnLane(car){
    var arr = laneOccupancy[car.lane.id];
    if (!arr) return null;
    // find car ahead with s > car.s
    var best = null, bestS = Infinity;
    for (var i=0;i<arr.length;i++){
      var o = arr[i];
      if (o === car) continue;
      if (o.s > car.s && o.s < bestS){ bestS = o.s; best = o; }
    }
    return best;
  }

  var nbBuf = [];
  function checkObstacle(car, G, px, py){
    var tx = Math.floor(px), ty = Math.floor(py);
    if (isTileBlocked(tx, ty, G)) return true;
    if (!isRoad(tx, ty) && !isWalkable(tx, ty)) return true;
    // police vehicles
    if (G.vehicles){
      for (var i=0;i<G.vehicles.length;i++){
        var v = G.vehicles[i];
        var dx = v.x-px, dy = v.y-py;
        if (dx*dx+dy*dy < 1.6*1.6) return true;
      }
    }
    // crowd
    if (Crowd && Crowd.neighbors){
      var nb = Crowd.neighbors(G, px, py, 1.2, nbBuf);
      if (nb && nb.length >= 2) return true;
    }
    return false;
  }

  function update(G, dt){
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;
    var t0 = now();

    // check graph
    var key = MAP ? (MAP.width + "x" + MAP.height + ":" + (MAP.roads ? MAP.roads.length : 0)) : "none";
    if (key !== graphKey){
      graphKey = key;
      buildGraph();
      lastAccidentT = G.time || 0;
      nextAccidentT = (G.time||0) + rand(90,180);
    }

    if (!graph || !graph.lanes.length){
      graph = null;
      // update people only (they may still walk)
      updatePeople(G, dt);
      var t1e = now();
      frameAccum += (t1e-t0);
      return;
    }

    // spawn / cull
    var target = maxCars;
    if (cars.length < target){
      var toSpawn = Math.min(4, target - cars.length);
      for (var sp=0; sp<toSpawn; sp++) spawnCar();
    } else if (cars.length > target + 2){
      // remove oldest ones far away
      var removeCount = cars.length - target;
      for (var rc=0; rc<removeCount; rc++){
        if (cars.length === 0) break;
        removeCar(cars[0]);
      }
    }

    // rebuild occupancy every 0.25s
    occupTimer += dt;
    if (occupTimer >= 0.25){
      occupTimer = 0;
      rebuildOccupancy();
    }

    // honk cooldown
    if (honkCooldownT > 0) honkCooldownT -= dt;

    // accident scheduling
    if (G.time !== undefined){
      if (nextAccidentT < lastAccidentT) nextAccidentT = G.time + rand(90,180);
      if (G.time >= nextAccidentT){
        nextAccidentT = G.time + rand(90,180);
        tryAccident(G);
      }
    }

    // update each car
    for (var i=0;i<cars.length;i++){
      var car = cars[i];
      updateCar(car, G, dt, i);
    }
    /* roads run past the map edge: cars that drive off leave (new ones spawn);
       abandoned cars are towed after 2 minutes so they do not pile up */
    for (var ri = cars.length - 1; ri >= 0; ri--){
      var rcar = cars[ri];
      if (rcar.x < 0 || rcar.y < 0 || rcar.x >= MAP.width || rcar.y >= MAP.height ||
          (rcar.state === "abandoned" && rcar.stuckT > 120)) removeCar(rcar);
    }

    // update people
    updatePeople(G, dt);

    // crashed cars: check police presence to clear
    updateCrashes(G, dt);

    var t1 = now();
    frameAccum += (t1-t0);
  }

  function updateCar(car, G, dt, idx){
    if (car.state === "crashed") return;   /* timed in updateCrashes */
    if (car.state === "abandoned"){
      car.stuckT += dt;
      return;
    }

    var lane = car.lane;
    if (!lane) return;

    // determine target lane & distance to end
    var distToEnd = lane.len - car.s;
    var targetLane = car.targetLane;
    if (!targetLane && distToEnd < 3){
      targetLane = pickNextLane(lane);
      car.targetLane = targetLane;
      car.targetS = 0;
    }

    /* gridlock breaker: standing 20 s with nothing real in front (no crowd, barrier, police)
       -> drive through the queue for 4 s */
    if (car.v < 0.05 && car.blockedT < 1) car.idleT = (car.idleT || 0) + dt; else car.idleT = 0;
    if (car.idleT > 20) { car.idleT = 0; car.ghostT = 4; }
    if (car.ghostT > 0) car.ghostT -= dt;
    var ghost = car.ghostT > 0;

    // car ahead on same lane
    var ahead = ghost ? null : findAheadOnLane(car);
    var followGap = 1.6;
    var desiredV = CRUISE[lane.type] || 3.0;

    if (ahead){
      var gap = ahead.s - car.s;
      if (gap < followGap + 0.5){
        desiredV = 0;
      } else if (gap < followGap + 2){
        desiredV = Math.min(desiredV, (gap - followGap) * 1.5);
      }
    }

    // check next lane entry
    if (targetLane && distToEnd < 2.5 && !ghost){
      var nextArr = laneOccupancy[targetLane.id];
      if (nextArr){
        for (var j=0;j<nextArr.length;j++){
          var o = nextArr[j];
          if (o.s < 2.0 && o.state !== "ok"){ desiredV = 0; break; }
          if (o.s < 1.0 && o.state === "ok"){ desiredV = Math.min(desiredV, 1.0); }
        }
      }
    }

    // obstacle check, staggered
    car.obstacleTimer += dt;
    if (car.obstacleTimer >= 0.5){
      car.obstacleTimer = 0;
      var aheadS = car.s + 1.5;
      var pt;
      if (aheadS <= lane.len){
        pt = lanePointAt(lane, aheadS);
      } else if (car.targetLane){
        pt = lanePointAt(car.targetLane, aheadS - lane.len);
      } else {
        pt = lanePointAt(lane, lane.len - 0.1);
      }
      var blocked = checkObstacle(car, G, pt.x, pt.y);
      car.hasPpl = false;
      if (blocked){
        car.blockedT += 0.5;
        car.clearT = 0;
        if (car.blockedT > 1.0){
          desiredV = 0;
        }
      } else {
        car.clearT += 0.5;
        car.blockedT = Math.max(0, car.blockedT - 0.25);
      }
    }

    // handle stopped state
    if (car.state === "stopped" || desiredV < 0.1){
      if (car.blockedT > 12 && !car.turnAround){
        if (Math.random() < 0.4){
          // driver gets out
          car.state = "abandoned";
          var d = addPerson(car.x, car.y, "walk", car.col);
          // walk away from blockage
          var fx = -Math.sin(car.ang), fy = Math.cos(car.ang); // perpendicular
          if (Math.random() < 0.5){ fx = -fx; fy = -fy; }
          d.tx = car.x + fx*rand(4,8);
          d.ty = car.y + fy*rand(4,8);
          d.life = 25;
          car.stuckT = 0;
          car.v = 0;
          return;
        } else {
          // honk
          if (honkCooldownT <= 0 && UI && UI.say){
            UI.say("Drivers honk at the blocked street");
            honkCooldownT = 30;
          }
          car.blockedT = 0;
        }
      }
      if (car.blockedT > 40 && lane.twoWay){
        car.turnAround = true;
        car.blockedT = 0;
        // pick opposite lane: find lane with reversed nodes
        var opp = findOppositeLane(lane);
        if (opp){
          car.lane = opp;
          car.s = opp.len - Math.min(car.s, opp.len);
          car.targetLane = null;
          car.state = "ok";
          var p = lanePointAt(opp, car.s);
          car.x = p.x; car.y = p.y; car.ang = p.ang;
        }
      }
      if (desiredV < 0.1){
        car.state = "stopped";
        car.v = Math.max(0, car.v - BRAKE*dt);
        if (car.v <= 0.01) car.v = 0;
        // still move forward with v
      }
    }

    // accelerate / brake toward desired
    if (desiredV > car.v){
      car.v = Math.min(desiredV, car.v + ACCEL*dt);
    } else if (desiredV < car.v){
      car.v = Math.max(desiredV, car.v - BRAKE*dt);
    }

    if (car.v > 0.01){
      car.state = "ok";
    }

    car.s += car.v * dt;

    // advance lane
    if (car.s >= lane.len){
      var nextL = car.targetLane || pickNextLane(lane);
      if (nextL && nextL !== lane){
        var over = car.s - lane.len;
        car.lane = nextL;
        car.s = Math.min(over, nextL.len);
        car.targetLane = null;
        // remove from old lane occupancy
        var oldArr = laneOccupancy[lane.id];
        if (oldArr){
          var oi = oldArr.indexOf(car);
          if (oi >= 0) oldArr.splice(oi,1);
        }
        // add to new
        var newArr = laneOccupancy[nextL.id];
        if (newArr) newArr.push(car);
      } else {
        car.s = lane.len - 0.01;
        car.v = 0;
      }
    }

    // position and angle
    var pt2 = lanePointAt(car.lane, car.s);
    car.x = pt2.x; car.y = pt2.y;
    // smooth angle
    var targetAng = pt2.ang;
    var da = targetAng - car.ang;
    while (da > Math.PI) da -= Math.PI*2;
    while (da < -Math.PI) da += Math.PI*2;
    car.ang += da * Math.min(1, dt*8);
  }

  function findOppositeLane(lane){
    if (!graph) return null;
    var lanes = graph.lanes;
    for (var i=0;i<lanes.length;i++){
      var l = lanes[i];
      if (l.nodeA === lane.nodeB && l.nodeB === lane.nodeA && l.len === lane.len){
        return l;
      }
    }
    return null;
  }

  function updatePeople(G, dt){
    for (var i=people.length-1; i>=0; i--){
      var p = people[i];
      if (p.state === "argue"){
        // stay, maybe face a partner
        p.life -= dt;
        if (p.life <= 0 && p.life > -900) p.life = 999999; // never remove argue by life alone (removed by accident clear)
        continue;
      }
      p.life -= dt;
      if (p.life <= 0){
        people.splice(i,1);
        continue;
      }
      // walk toward target
      var dx = p.tx - p.x, dy = p.ty - p.y;
      var dist = Math.sqrt(dx*dx+dy*dy);
      if (dist < 0.3){
        pickWalkTarget(p, null);
        continue;
      }
      var spd = 1.1;
      var nx = p.x + (dx/dist)*spd*dt;
      var ny = p.y + (dy/dist)*spd*dt;
      var tx = Math.floor(nx), ty = Math.floor(ny);
      if (isWalkable(tx, ty)){
        p.x = nx; p.y = ny;
      } else {
        // pick new target
        pickWalkTarget(p, null);
      }
    }
  }

  function tryAccident(G){
    // pick a moving car near a junction (approach = within 3 tiles of lane end)
    var candidates = [];
    for (var i=0;i<cars.length;i++){
      var c = cars[i];
      if (c.state !== "ok" || c.v < 0.5) continue;
      if (c.lane.len - c.s < 4) candidates.push(c);
    }
    if (!candidates.length) return;
    var car = candidates[(Math.random()*candidates.length)|0];
    // nearest car within 3 tiles
    var other = null, bestD = 3*3;
    for (var j=0;j<cars.length;j++){
      var o = cars[j];
      if (o === car) continue;
      var dx = o.x-car.x, dy = o.y-car.y;
      var d = dx*dx+dy*dy;
      if (d < bestD){ bestD = d; other = o; }
    }
    car.state = "crashed";
    car.v = 0;
    car.crashT = 0;
    car.policeNearT = 0;
    if (other){
      other.state = "crashed";
      other.v = 0;
      other.isMain = false;   /* one accident = one call and one score */
      other.crashT = 0;
      other.policeNearT = 0;
    }
    // drivers get out and argue
    var count = other ? (1 + ((Math.random()*2)|0)) : 1;
    for (var k=0;k<count;k++){
      var src = (k===0 || !other) ? car : other;
      var ang = Math.random()*Math.PI*2;
      var px = src.x + Math.cos(ang)*1.2;
      var py = src.y + Math.sin(ang)*1.2;
      var pp = addPerson(px, py, "argue", src.col);
      pp.life = 999999;
    }
    if (ALERTS && ALERTS.push){
      ALERTS.push("accident", "Traffic accident - street", car.x, car.y, "#f4b942", G);
      if (Math.random() < 0.3){
        ALERTS.push("medical", "Person hurt in crash - street", car.x, car.y, "#ff6b6b", G);
      }
    }
  }

  function updateCrashes(G, dt){
    var officers = G.officers || [];
    for (var i=cars.length-1; i>=0; i--){
      var car = cars[i];
      if (car.state !== "crashed") continue;
      car.crashT += dt;
      /* keep the radio call alive while the wreck is there (alerts expire otherwise) */
      car.alertT = (car.alertT || 0) + dt;
      if (car.alertT >= 10 && car.isMain !== false && ALERTS && ALERTS.push) {
        car.alertT = 0;
        ALERTS.push("accident", "Traffic accident - street", car.x, car.y, "#f4b942", G);
      }
      // check police presence
      var found = false;
      for (var j=0;j<officers.length;j++){
        var o = officers[j];
        var dx = o.x-car.x, dy = o.y-car.y;
        if (dx*dx+dy*dy < 2*2){ found = true; break; }
      }
      if (found){
        car.policeNearT += dt;
        if (car.policeNearT >= 6){
          // clear
          car.state = "abandoned";
          car.stuckT = 0;
          // clear argue people near this car
          for (var k=people.length-1;k>=0;k--){
            var p = people[k];
            if (p.state === "argue"){
              var pdx = p.x-car.x, pdy = p.y-car.y;
              if (pdx*pdx+pdy*pdy < 4){
                people[k].state = "walk";
                people[k].life = 15;
                pickWalkTarget(people[k], null);
              }
            }
          }
          for (var oc = 0; oc < cars.length; oc++) {   /* the other wreck goes too */
            var w = cars[oc];
            if (w.state === "crashed" && (w.x - car.x) * (w.x - car.x) + (w.y - car.y) * (w.y - car.y) < 16) { w.state = "abandoned"; w.stuckT = 0; }
          }
          if (UI && UI.say) UI.say("Accident cleared");
          if (G.stats && car.isMain !== false) G.stats.accidentsCleared = (G.stats.accidentsCleared||0) + 1;
        }
      } else {
        car.policeNearT = Math.max(0, car.policeNearT - dt);
      }
      if (car.crashT > 180){
        // missed
        car.state = "abandoned";
        car.stuckT = 0;
        if (G.stats && car.isMain !== false) G.stats.accidentsMissed = (G.stats.accidentsMissed||0) + 1;
        // argue people walk off
        for (var m=people.length-1;m>=0;m--){
          var pp = people[m];
          if (pp.state === "argue"){
            var ax = pp.x-car.x, ay = pp.y-car.y;
            if (ax*ax+ay*ay < 9){
              pp.state = "walk";
              pp.life = 10;
              pickWalkTarget(pp, null);
            }
          }
        }
      }
    }

    // abandoned cars: remove after 10s for crashed ones
    for (var n=cars.length-1; n>=0; n--){
      var c = cars[n];
      if (c.state === "abandoned"){
        c.stuckT += dt;
        if (c.stuckT > 10){
          removeCar(c);
        }
      }
    }
  }

  // ---------- draw ----------
  function draw(ctx, G){
    if (!Art || !Art.project || !Art.camera) return;
    if (Art.camera.zoom <= 1) return;
    ctx.save();
    for (var i=0;i<cars.length;i++){
      var c = cars[i];
      if (c.state === "crashed"){
        var pt = Art.project(c.x, c.y, 0);
        if (!pt) continue;
        ctx.fillStyle = "#f4b942";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("!", pt.x, pt.y - 12);
      }
    }
    ctx.restore();
  }

  function updateMS(){
    var ms = frameAccum;
    frameAccum = 0;
    msSamples.push(ms);
    msSum += ms;
    msCount++;
    if (msSamples.length > 60){
      msSum -= msSamples.shift();
      msCount--;
    }
  }

  // wrap update to measure ms
  var rawUpdate = update;
  update = function(G, dt){
    rawUpdate(G, dt);
    updateMS();
  };

  return {
    update: update,
    reset: reset,
    setMax: setMax,
    list: list,
    people: peopleList,
    carAt: carAt,
    stats: stats,
    draw: draw
  };
})();
