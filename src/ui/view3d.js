/* view3d.js - 3D third-person street view, three.js r128 (DeepSeek) */
var VIEW3D = (function () {
  'use strict';

  var _on = false;
  var _inited = false;
  var _canvas = null;
  var _renderer = null;
  var _scene = null;
  var _camera = null;
  var _hud = null;
  var _msgDiv = null;
  var _yaw = 0;
  var _dist = 7;
  var _lastMouseT = 0;
  var _lastTarget = null;
  var _smoothPos = { x: 0, y: 0, z: 0 };
  var _smoothLook = { x: 0, y: 0, z: 0 };
  var _mapRef = null;
  var _mapRowsRef = null;
  var _mapStamp = null;

  // reusable math objects
  var _m4 = new THREE.Matrix4();
  var _col = new THREE.Color();
  var _obj3 = new THREE.Object3D();
  var _v3a = new THREE.Vector3();
  var _v3b = new THREE.Vector3();
  var _v3c = new THREE.Vector3();

  // static
  var _cityGroup = null;
  var _groundMesh = null;
  var _groundCanvas = null;
  var _groundCtx = null;
  var _groundTex = null;

  // dynamic
  var _crowdMesh = null;
  var _crowdHeadMesh = null;
  var _policeMesh = null;
  var _policeHeadMesh = null;
  var _vehicleBodyMesh = null;
  var _vehicleCabMesh = null;
  var _MAX_CROWD = 2500;
  var _MAX_POLICE = 400;
  var _MAX_VEH = 600;

  var _fogColor = 0xb9c7d6;
  var _skyColor = 0xdfe8f5;
  var _groundAmbColor = 0x6b6f5a;

  function _log() {}

  function _disposeObj3(o) {
    if (!o) return;
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) {
        for (var i = 0; i < o.material.length; i++) o.material[i].dispose();
      } else {
        o.material.dispose();
      }
    }
  }

  function _clearGroup(g) {
    if (!g) return;
    while (g.children.length) {
      var c = g.children.pop();
      _disposeObj3(c);
    }
  }

  // ---------- init ----------
  function _init() {
    if (_inited) return;
    _inited = true;

    _canvas = document.createElement('canvas');
    _canvas.style.position = 'fixed';
    _canvas.style.left = '0';
    _canvas.style.top = '0';
    _canvas.style.width = '100vw';
    _canvas.style.height = '100vh';
    _canvas.style.zIndex = '5';
    _canvas.style.display = 'none';
    _canvas.style.touchAction = 'none';
    document.body.appendChild(_canvas);

    try {
      _renderer = new THREE.WebGLRenderer({ canvas: _canvas, antialias: false });
    } catch (e) {
      _renderer = null;
      _log('no webgl');
      return;
    }
    _renderer.setPixelRatio(1);
    _renderer.setSize(window.innerWidth, window.innerHeight, false);
    _renderer.shadowMap.enabled = false;

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(_fogColor);
    _scene.fog = new THREE.Fog(_fogColor, 25, 90);

    _camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 200);

    var hemi = new THREE.HemisphereLight(_skyColor, _groundAmbColor, 0.9);
    _scene.add(hemi);
    var dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(-30, 60, 20);
    _scene.add(dir);

    _cityGroup = new THREE.Group();
    _scene.add(_cityGroup);

    // HUD
    _hud = document.createElement('div');
    _hud.style.position = 'fixed';
    _hud.style.bottom = '54px';
    _hud.style.left = '50%';
    _hud.style.transform = 'translateX(-50%)';
    _hud.style.zIndex = '6';
    _hud.style.fontFamily = 'monospace';
    _hud.style.fontSize = '13px';
    _hud.style.color = '#fff';
    _hud.style.background = 'rgba(0,0,0,0.6)';
    _hud.style.padding = '6px 10px';
    _hud.style.pointerEvents = 'none';
    _hud.style.display = 'none';
    _hud.style.whiteSpace = 'nowrap';
    document.body.appendChild(_hud);

    _msgDiv = document.createElement('div');
    _msgDiv.style.position = 'fixed';
    _msgDiv.style.left = '8px';
    _msgDiv.style.top = '8px';
    _msgDiv.style.zIndex = '6';
    _msgDiv.style.fontFamily = 'monospace';
    _msgDiv.style.fontSize = '13px';
    _msgDiv.style.color = '#fff';
    _msgDiv.style.background = 'rgba(0,0,0,0.5)';
    _msgDiv.style.padding = '4px 8px';
    _msgDiv.style.pointerEvents = 'none';
    _msgDiv.style.display = 'none';
    _msgDiv.style.maxWidth = '60vw';
    document.body.appendChild(_msgDiv);

    // dynamic meshes
    _buildDynamicMeshes();

    // input
    _attachInput();

    window.addEventListener('resize', _onResize);
  }

  function _buildDynamicMeshes() {
    var cylGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.55, 6, 1, false);
    cylGeo.translate(0, 0.275, 0);
    var headGeo = new THREE.SphereGeometry(0.14, 6, 4);
    headGeo.translate(0, 0.68, 0);

    var matBody = new THREE.MeshLambertMaterial({ vertexColors: false });
    _crowdMesh = new THREE.InstancedMesh(cylGeo, matBody.clone(), _MAX_CROWD);
    _crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _crowdMesh.count = 0;
    _scene.add(_crowdMesh);

    _crowdHeadMesh = new THREE.InstancedMesh(headGeo, matBody.clone(), _MAX_CROWD);
    _crowdHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _crowdHeadMesh.count = 0;
    _scene.add(_crowdHeadMesh);

    _policeMesh = new THREE.InstancedMesh(cylGeo, matBody.clone(), _MAX_POLICE);
    _policeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _policeMesh.count = 0;
    _scene.add(_policeMesh);

    _policeHeadMesh = new THREE.InstancedMesh(headGeo, matBody.clone(), _MAX_POLICE);
    _policeHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _policeHeadMesh.count = 0;
    _scene.add(_policeHeadMesh);

    // vehicles: box body + cab
    var bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    bodyGeo.translate(0, 0.5, 0);   /* base on the ground; scaled per instance */
    var cabGeo = new THREE.BoxGeometry(1, 1, 1);
    cabGeo.translate(0, 0.5, 0);

    var vehMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    _vehicleBodyMesh = new THREE.InstancedMesh(bodyGeo, vehMat.clone(), _MAX_VEH);
    _vehicleBodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _vehicleBodyMesh.count = 0;
    _scene.add(_vehicleBodyMesh);

    _vehicleCabMesh = new THREE.InstancedMesh(cabGeo, vehMat.clone(), _MAX_VEH);
    _vehicleCabMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _vehicleCabMesh.count = 0;
    _scene.add(_vehicleCabMesh);

    // init colors
    var i;
    var white = new THREE.Color(1, 1, 1);
    /* setColorAt sizes the colour buffer by mesh.count, which is 0 here: make full-size buffers */
    [[_crowdMesh, _MAX_CROWD], [_crowdHeadMesh, _MAX_CROWD], [_policeMesh, _MAX_POLICE], [_policeHeadMesh, _MAX_POLICE],
     [_vehicleBodyMesh, _MAX_VEH], [_vehicleCabMesh, _MAX_VEH]].forEach(function (m) {
      m[0].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m[1] * 3).fill(1), 3);
    });
    if (_crowdMesh.instanceColor === null) {
      for (i = 0; i < _MAX_CROWD; i++) _crowdMesh.setColorAt(i, white);
      for (i = 0; i < _MAX_CROWD; i++) _crowdHeadMesh.setColorAt(i, white);
    }
    if (_policeMesh.instanceColor === null) {
      for (i = 0; i < _MAX_POLICE; i++) _policeMesh.setColorAt(i, white);
      for (i = 0; i < _MAX_POLICE; i++) _policeHeadMesh.setColorAt(i, white);
    }
    if (_vehicleBodyMesh.instanceColor === null) {
      for (i = 0; i < _MAX_VEH; i++) _vehicleBodyMesh.setColorAt(i, white);
      for (i = 0; i < _MAX_VEH; i++) _vehicleCabMesh.setColorAt(i, white);
    }
  }

  // ---------- input ----------
  var _drag = false;
  var _lastX = 0;

  function _attachInput() {
    _canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) {
        _drag = true;
        _lastX = e.clientX;
        _lastMouseT = performance.now();
      }
    });
    window.addEventListener('mouseup', function () {
      _drag = false;
    });
    window.addEventListener('mousemove', function (e) {
      if (!_drag) return;
      var dx = e.clientX - _lastX;
      _lastX = e.clientX;
      _yaw -= dx * 0.006;
      _lastMouseT = performance.now();
    });
    _canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      _dist += (e.deltaY > 0 ? 0.6 : -0.6);
      if (_dist < 4) _dist = 4;
      if (_dist > 14) _dist = 14;
    }, { passive: false });
  }

  function _onResize() {
    if (!_renderer) return;
    _renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (_camera) {
      _camera.aspect = window.innerWidth / window.innerHeight;
      _camera.updateProjectionMatrix();
    }
  }

  // ---------- static city ----------
  function _tileColor(ch) {
    switch (ch) {
      case '.': return '#55595f';
      case 'a': return '#6a6d72';
      case 'P': return '#d9d4c8';
      case 'G': return '#6f9a52';
      case ',': return '#6f9a52';
      case 'W': return '#3f7fb5';
      case '#': return '#8a8f96';
      case 'S': return '#8a8f96';
      default: return '#d9d4c8';
    }
  }

  function _isBuilding(ch) {
    return ch === '#' || ch === 'S';
  }

  var _facadePalette = ['#b9b2a5', '#a7a29a', '#c8bfae', '#9aa3ad', '#bca58f'];

  function _buildGround(map) {
    if (!_groundCanvas) {
      _groundCanvas = document.createElement('canvas');
      _groundCtx = _groundCanvas.getContext('2d');
    }
    _groundCanvas.width = map.width;
    _groundCanvas.height = map.height;
    var ctx = _groundCtx;
    var img = ctx.createImageData(map.width, map.height);
    var d = img.data;
    var idx = 0;
    var i, j, ch, r, g, b;
    for (j = 0; j < map.height; j++) {
      var row = map.rows[j] || '';
      for (i = 0; i < map.width; i++) {
        ch = row.charAt(i) || '.';
        var hex = _tileColor(ch);
        r = parseInt(hex.substr(1, 2), 16);
        g = parseInt(hex.substr(3, 2), 16);
        b = parseInt(hex.substr(5, 2), 16);
        d[idx++] = r;
        d[idx++] = g;
        d[idx++] = b;
        d[idx++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    var big = document.createElement('canvas');   /* 4 px per tile: crisp kerbs instead of a blur */
    big.width = map.width * 4; big.height = map.height * 4;
    var bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(_groundCanvas, 0, 0, big.width, big.height);
    if (_groundTex) _groundTex.dispose();
    _groundTex = new THREE.CanvasTexture(big);
    _groundTex.minFilter = THREE.LinearMipmapLinearFilter;
    _groundTex.magFilter = THREE.LinearFilter;
    _groundTex.generateMipmaps = true;
    if (_renderer) _groundTex.anisotropy = Math.min(4, _renderer.capabilities.getMaxAnisotropy());

    if (_groundMesh) {
      _cityGroup.remove(_groundMesh);
      _disposeObj3(_groundMesh);
    }
    var geo = new THREE.PlaneGeometry(map.width, map.height);
    var mat = new THREE.MeshLambertMaterial({ map: _groundTex });
    _groundMesh = new THREE.Mesh(geo, mat);
    _groundMesh.rotation.x = -Math.PI / 2;
    _groundMesh.position.set(map.width / 2, 0, map.height / 2);
    _cityGroup.add(_groundMesh);
  }

  function _buildBuildings(map) {
    // collect runs
    var verts = [];
    var norms = [];
    var cols = [];
    var idxs = [];
    var vbase = 0;

    var facadeColor = new THREE.Color();
    var roofColor = new THREE.Color();
    var wallColor = new THREE.Color();
    var paletteIdx = 0;

    var j, i, x;
    for (j = 0; j < map.height; j++) {
      var row = map.rows[j] || '';
      i = 0;
      while (i < map.width) {
        var ch = row.charAt(i) || '.';
        if (!_isBuilding(ch)) { i++; continue; }
        var start = i;
        var h;
        try {
          h = (typeof Art !== 'undefined' && Art.heightAt) ? Art.heightAt(i, j) : 0;
        } catch (e) { h = 0; }
        if (!h || h <= 0) h = 0.7;
        // extend run
        while (i < map.width) {
          var ch2 = row.charAt(i) || '.';
          if (!_isBuilding(ch2)) break;
          var h2;
          try {
            h2 = (typeof Art !== 'undefined' && Art.heightAt) ? Art.heightAt(i, j) : 0;
          } catch (e2) { h2 = 0; }
          if (!h2 || h2 <= 0) h2 = 0.7;
          if (Math.abs(h2 - h) > 0.05) break;
          i++;
        }
        var len = i - start;
        var heightWorld = h * 2.4;
        if (heightWorld < 1.5) heightWorld = 1.5;

        facadeColor.set(_facadePalette[paletteIdx % _facadePalette.length]);
        paletteIdx++;
        // roofs slightly lighter
        roofColor.copy(facadeColor).multiplyScalar(1.08);
        // walls slightly darker
        wallColor.copy(facadeColor).multiplyScalar(0.82);

        var x0 = start;
        var x1 = start + len;
        var z0 = j;
        var z1 = j + 1;
        var y0 = 0;
        var y1 = heightWorld;

        // 6 faces box, each as 4 verts + 6 indices
        function pushQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, cr, cg, cb) {
          var base = vbase;
          verts.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
          norms.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
          cols.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);
          idxs.push(base, base + 1, base + 2, base, base + 2, base + 3);
          vbase += 4;
        }

        // wall colour repeated with slight variation by building
        var wc = wallColor;
        var rc = roofColor;

        // +z face (south) at z1
        pushQuad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, wc.r, wc.g, wc.b);
        // -z face (north) at z0
        pushQuad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, wc.r, wc.g, wc.b);
        // +x face (east) at x1
        pushQuad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, wc.r, wc.g, wc.b);
        // -x face (west) at x0
        pushQuad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, wc.r, wc.g, wc.b);
        // top (roof)
        pushQuad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, 0, 1, 0, rc.r, rc.g, rc.b);
        // bottom (skip, but keep for closure)
        // pushQuad(x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0, 0,-1,0, wc.r, wc.g, wc.b);

        // continue outer loop from i
      }
    }

    if (verts.length === 0) return;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(idxs);

    var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    var mesh = new THREE.Mesh(geo, mat);
    _cityGroup.add(mesh);
  }

  function _rebuildCity(map) {
    _clearGroup(_cityGroup);
    _groundMesh = null;
    _buildGround(map);
    _buildBuildings(map);
  }

  function _checkMap(map) {
    if (!map || !map.rows) return false;
    var rows = map.rows;
    var stamp = rows.length + ':' + (rows[0] ? rows[0].length : 0);
    // cheap change detection: reference + length + first/last row identity
    if (_mapRef === map && _mapRowsRef === rows && _mapStamp === stamp) return false;
    _mapRef = map;
    _mapRowsRef = rows;
    _mapStamp = stamp;
    return true;
  }

  // ---------- follow ----------
  function _findSquadTarget(G) {
    if (typeof POV === 'undefined' || !POV.active()) return null;
    var s;
    try { s = POV.controlled(); } catch (e) { return null; }
    if (s === undefined || s === null) return null;

    var officers = G.officers || [];
    for (var i = 0; i < officers.length; i++) {
      var o = officers[i];
      if (!o) continue;
      if (o.squad === s && !o.arrested) {
        return { x: o.x, z: o.y, inVehicle: false, squad: s, ang: null };
      }
    }
    var vehs = G.vehicles || [];
    for (var k = 0; k < vehs.length; k++) {
      var v = vehs[k];
      if (!v) continue;
      if (v.squad === s) {
        return { x: v.x, z: v.y, inVehicle: true, squad: s, ang: v.ang || 0 };
      }
    }
    // fallback: any officer
    if (officers.length) {
      var o0 = officers[0];
      if (o0) return { x: o0.x, z: o0.y, inVehicle: false, squad: s, ang: null };
    }
    return null;
  }

  function followPos(G) {
    var t = _findSquadTarget(G);
    if (!t) return { x: 0, y: 0, z: 0 };
    return { x: t.x, y: 0, z: t.z };
  }

  // ---------- dynamic instancing ----------
  function _setInstance(mesh, i, px, py, pz, ry, sx, sy, sz, col) {
    _obj3.position.set(px, py, pz);
    _obj3.rotation.set(0, ry, 0);
    _obj3.scale.set(sx, sy, sz);
    _obj3.updateMatrix();
    mesh.setMatrixAt(i, _obj3.matrix);
    if (col) mesh.setColorAt(i, col);
  }

  function _dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return dx * dx + dz * dz;
  }

  function _updateAgents(G, cx, cz) {
    var maxD2 = 70 * 70;
    var agents = G.agents || [];
    var ci = 0;
    var i, a;
    var col = _col;

    for (i = 0; i < agents.length && ci < _MAX_CROWD; i++) {
      a = agents[i];
      if (!a || !a.active) continue;
      if (a.arrested) continue;
      if (_dist2(a.x, a.y, cx, cz) > maxD2) continue;
      var t = (a.mood - 45) / 40;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      // blend blue #4a8fe7 -> red #d62839
      var r = (0.290 + (0.839 - 0.290) * t);
      var g = (0.561 + (0.157 - 0.561) * t);
      var b = (0.906 + (0.224 - 0.906) * t);
      col.setRGB(r, g, b);
      var ang = a.ang || 0;
      _setInstance(_crowdMesh, ci, a.x, 0, a.y, ang, 1, 1, 1, col);
      _setInstance(_crowdHeadMesh, ci, a.x, 0, a.y, ang, 1, 1, 1, col);
      ci++;
    }
    _crowdMesh.count = ci;
    _crowdHeadMesh.count = ci;
    _crowdMesh.instanceMatrix.needsUpdate = true;
    _crowdHeadMesh.instanceMatrix.needsUpdate = true;
    if (_crowdMesh.instanceColor) _crowdMesh.instanceColor.needsUpdate = true;
    if (_crowdHeadMesh.instanceColor) _crowdHeadMesh.instanceColor.needsUpdate = true;

    // police
    var officers = G.officers || [];
    var pi = 0;
    var pcol = _col;
    pcol.setRGB(0.114, 0.169, 0.325); // #1d2b53 approx
    for (i = 0; i < officers.length && pi < _MAX_POLICE; i++) {
      var o = officers[i];
      if (!o) continue;
      if (o.arrested) continue;
      if (_dist2(o.x, o.y, cx, cz) > maxD2) continue;
      var oang = o.ang || 0;
      _setInstance(_policeMesh, pi, o.x, 0, o.y, oang, 1, 1, 1, pcol);
      _setInstance(_policeHeadMesh, pi, o.x, 0, o.y, oang, 1, 1, 1, pcol);
      pi++;
    }
    _policeMesh.count = pi;
    _policeHeadMesh.count = pi;
    _policeMesh.instanceMatrix.needsUpdate = true;
    _policeHeadMesh.instanceMatrix.needsUpdate = true;
    if (_policeMesh.instanceColor) _policeMesh.instanceColor.needsUpdate = true;
    if (_policeHeadMesh.instanceColor) _policeHeadMesh.instanceColor.needsUpdate = true;
  }

  function _vehSpec(type) {
    switch (type) {
      case 'truck':
      case 'watertruck':
      case 'barriertruck':
      case 'fireengine':
        return { len: 2.3, wid: 0.8, col: type === 'fireengine' ? [0.75, 0.08, 0.06] : [0.22, 0.26, 0.34], roof: [0.1, 0.12, 0.18] };
      case 'van':
        return { len: 1.6, wid: 0.68, col: [0.94, 0.94, 0.96], roof: [0.25, 0.3, 0.42] };
      case 'ambulance':
        return { len: 1.6, wid: 0.68, col: [0.95, 0.95, 0.95], roof: [0.75, 0.1, 0.08] };
      case 'car':
      default:
        return { len: 1.5, wid: 0.66, col: [0.95, 0.95, 0.96], roof: [0.12, 0.16, 0.32] };
    }
  }

  function _updateVehicles(G, cx, cz) {
    var maxD2 = 70 * 70;
    var vi = 0;
    var i;
    var bodyCol = _col;

    var vehs = G.vehicles || [];
    for (i = 0; i < vehs.length && vi < _MAX_VEH; i++) {
      var v = vehs[i];
      if (!v) continue;
      if (_dist2(v.x, v.y, cx, cz) > maxD2) continue;
      var spec = _vehSpec(v.type);
      bodyCol.setRGB(spec.col[0], spec.col[1], spec.col[2]);
      _setInstance(_vehicleBodyMesh, vi, v.x, 0, v.y, -(v.ang || 0), spec.len, 0.55, spec.wid, bodyCol);
      bodyCol.setRGB(spec.roof[0], spec.roof[1], spec.roof[2]);
      _setInstance(_vehicleCabMesh, vi, v.x, 0.55, v.y, -(v.ang || 0), spec.len * 0.55, 0.25, spec.wid * 0.8, bodyCol);
      vi++;
    }

    // traffic
    if (typeof TRAFFIC !== 'undefined' && TRAFFIC.list) {
      var list = TRAFFIC.list() || [];
      for (i = 0; i < list.length && vi < _MAX_VEH; i++) {
        var c = list[i];
        if (!c) continue;
        if (_dist2(c.x, c.y, cx, cz) > maxD2) continue;
        if (c.col !== undefined) {
          if (typeof c.col === 'string') bodyCol.set(c.col);
          else if (c.col.r !== undefined) bodyCol.copy(c.col);
          else bodyCol.setRGB(0.6, 0.6, 0.62);
        } else {
          bodyCol.setRGB(0.6, 0.6, 0.62);
        }
        _setInstance(_vehicleBodyMesh, vi, c.x, 0, c.y, -(c.ang || 0), 1.5, 0.55, 0.66, bodyCol);
        bodyCol.multiplyScalar(0.5);
        _setInstance(_vehicleCabMesh, vi, c.x, 0.55, c.y, -(c.ang || 0), 1.5 * 0.55, 0.25, 0.66 * 0.8, bodyCol);
        vi++;
      }
    }

    _vehicleBodyMesh.count = vi;
    _vehicleCabMesh.count = vi;
    _vehicleBodyMesh.instanceMatrix.needsUpdate = true;
    _vehicleCabMesh.instanceMatrix.needsUpdate = true;
    if (_vehicleBodyMesh.instanceColor) _vehicleBodyMesh.instanceColor.needsUpdate = true;
    if (_vehicleCabMesh.instanceColor) _vehicleCabMesh.instanceColor.needsUpdate = true;
  }

  // ---------- HUD ----------
  function _tagStr(G, s) {
    try {
      if (typeof UNITTYPES !== 'undefined' && UNITTYPES.tag) {
        var t = UNITTYPES.tag(G, s);
        if (t) return String(t);
      }
    } catch (e) {}
    return 'Unit ' + s;
  }

  function _updateHUD(G) {
    if (!_hud) return;
    var s = null;
    try { s = POV.controlled(); } catch (e) {}
    var txt = '3D: ' + _tagStr(G, s) +
      '  [WASD] move  [mouse drag] look  [wheel] distance  [E] vehicle  [Space] shove  [F] arrest  [V] map view  [H] commander';
    if (_hud.textContent !== txt) _hud.textContent = txt;

    if (_msgDiv) {
      var msg = null;
      if (typeof UI !== 'undefined' && UI.msg && typeof UI.msg === 'string') msg = UI.msg;
      if (msg) {
        if (_msgDiv.textContent !== msg) _msgDiv.textContent = msg;
        _msgDiv.style.display = 'block';
      } else {
        _msgDiv.style.display = 'none';
      }
    }
  }

  // ---------- render ----------
  function _lerpTo(cur, target, alpha) {
    cur.x += (target.x - cur.x) * alpha;
    cur.y += (target.y - cur.y) * alpha;
    cur.z += (target.z - cur.z) * alpha;
  }

  function render(G, dt) {
    if (!_on) return;
    if (typeof POV === 'undefined' || !POV.active()) {
      _setActive(false);
      return;
    }
    if (!_inited) {
      _init();
      if (!_renderer) return;
    }

    if (!G || typeof MAP === 'undefined') return;
    var map = MAP;   /* the map is a global, not G.map */
    if (_checkMap(map)) {
      _rebuildCity(map);
    }

    var tinfo = _findSquadTarget(G);
    var tx, tz, inVeh, vang;
    if (tinfo) {
      tx = tinfo.x; tz = tinfo.z; inVeh = tinfo.inVehicle; vang = tinfo.ang;
    } else {
      tx = 0; tz = 0; inVeh = false; vang = 0;
    }

    // auto rotate yaw toward vehicle heading if in vehicle
    if (inVeh && vang !== null) {
      var now = performance.now();
      if (now - _lastMouseT > 2000) {
        var targetYaw = vang; // cam behind vehicle (cam = target - (cos yaw, sin yaw) * dist)
        // normalize
        var dy = targetYaw - _yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        var step = 2 * Math.max(0, Math.min(dt, 0.1));
        if (Math.abs(dy) < step) _yaw = targetYaw;
        else _yaw += (dy > 0 ? step : -step);
      }
    }

    var desiredX = tx - Math.cos(_yaw) * _dist;
    var desiredZ = tz - Math.sin(_yaw) * _dist;
    var desiredY = 3.2 + _dist * 0.25;

    var lookX = tx, lookY = 0.9, lookZ = tz;

    if (_lastTarget === null) {
      _smoothPos.x = desiredX; _smoothPos.y = desiredY; _smoothPos.z = desiredZ;
      _smoothLook.x = lookX; _smoothLook.y = lookY; _smoothLook.z = lookZ;
      _lastTarget = true;
    } else {
      var a = 1 - Math.exp(-8 * Math.max(0.0001, Math.min(dt, 0.2)));
      _v3a.set(desiredX, desiredY, desiredZ);
      _lerpTo(_smoothPos, _v3a, a);
      _v3b.set(lookX, lookY, lookZ);
      _lerpTo(_smoothLook, _v3b, a);
    }

    _camera.position.set(_smoothPos.x, _smoothPos.y, _smoothPos.z);
    _v3c.set(_smoothLook.x, _smoothLook.y, _smoothLook.z);
    _camera.lookAt(_v3c);

    _updateAgents(G, tx, tz);
    _updateVehicles(G, tx, tz);
    _updateHUD(G);

    _renderer.render(_scene, _camera);
  }

  // ---------- public ----------
  function _setActive(v) {
    _on = !!v;
    if (_canvas) _canvas.style.display = _on ? 'block' : 'none';
    if (_hud) _hud.style.display = _on ? 'block' : 'none';
    if (_msgDiv) _msgDiv.style.display = _on ? (_msgDiv.textContent ? 'block' : 'none') : 'none';
  }

  function toggle(G) {
    if (!_on) {
      if (typeof POV === 'undefined' || !POV.active()) {
        _on = false;
        return false;
      }
      if (!_inited) {
        _init();
        if (!_renderer) return false;
      }
      _lastTarget = null;
      _setActive(true);
      if (G && typeof MAP !== 'undefined') {
        if (_checkMap(MAP)) _rebuildCity(MAP);
        var t = _findSquadTarget(G);
        if (t) {
          _smoothPos.x = t.x - Math.cos(_yaw) * _dist;
          _smoothPos.y = 3.2 + _dist * 0.25;
          _smoothPos.z = t.z - Math.sin(_yaw) * _dist;
          _smoothLook.x = t.x;
          _smoothLook.y = 0.9;
          _smoothLook.z = t.z;
          _lastTarget = true;
        }
        _updateHUD(G);
      }
    } else {
      _setActive(false);
    }
    return _on;
  }

  function active() {
    return _on;
  }

  function yaw() {
    return _yaw;
  }

  return {
    toggle: toggle,
    active: active,
    render: render,
    yaw: yaw,
    followPos: followPos
  };
})();
