/* view3dx.js - 3D view details: road markings, kerbs, windows, shop fronts, lamps, walking legs, aim ring (DeepSeek) */
var VIEW3DX = (function () {
  'use strict';

  var _scene = null;
  var _crosshair = null;
  var _ringMesh = null;
  var _lastTarget = -1;

  // Leg instanced meshes
  var _legLeft = null, _legRight = null;
  var _legGeo = null, _legMatCrowd = null, _legMatPolice = null;
  var _maxCrowd = 3000, _maxPolice = 600;
  var _legLeftCrowd = null, _legRightCrowd = null;
  var _legLeftPolice = null, _legRightPolice = null;

  var _phaseCrowd = new Float32Array(_maxCrowd);
  var _phasePolice = new Float32Array(_maxPolice);
  var _lastPosPolice = new Float32Array(_maxPolice * 2);
  var _policePosInit = false;

  // Reusable
  var _m4 = new THREE.Matrix4();
  var _m4b = new THREE.Matrix4();
  var _m4c = new THREE.Matrix4();
  var _q = new THREE.Quaternion();
  var _qYaw = new THREE.Quaternion();
  var _qPitch = new THREE.Quaternion();
  var _v3 = new THREE.Vector3();
  var _v3b = new THREE.Vector3();
  var _v3c = new THREE.Vector3();
  var _euler = new THREE.Euler();
  var _color = new THREE.Color();
  var _obj = new THREE.Object3D();

  // ---------------------------------------------------------------
  // attach
  // ---------------------------------------------------------------
  function attach(scene) {
    _scene = scene;

    // Crosshair DOM
    if (!_crosshair) {
      _crosshair = document.createElement('div');
      _crosshair.style.cssText =
        'position:fixed;left:50%;top:50%;width:14px;height:14px;' +
        'margin-left:-7px;margin-top:-7px;border:1px solid #fff;' +
        'border-radius:50%;opacity:0.5;pointer-events:none;z-index:6;' +
        'box-sizing:border-box;display:none;';
      document.body.appendChild(_crosshair);
    }

    // Target ring
    if (!_ringMesh) {
      var ringGeo = new THREE.RingGeometry(0.3, 0.38, 24);
      var ringMat = new THREE.MeshBasicMaterial({
        color: 0xffd166,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.9
      });
      _ringMesh = new THREE.Mesh(ringGeo, ringMat);
      _ringMesh.rotation.x = -Math.PI / 2;
      _ringMesh.position.y = 0.02;
      _ringMesh.renderOrder = 999;
      _ringMesh.visible = false;
      _ringMesh.frustumCulled = false;
    }
    if (_ringMesh.parent !== _scene) {
      _scene.add(_ringMesh);
    }
  }

  // ---------------------------------------------------------------
  // crosshair show
  // ---------------------------------------------------------------
  function show(on) {
    if (_crosshair) {
      _crosshair.style.display = on ? 'block' : 'none';
    }
  }

  // ---------------------------------------------------------------
  // Hash helpers
  // ---------------------------------------------------------------
  function hash2(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h >>> 0) / 4294967296;
  }
  function hash3(x, y, z) {
    var h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------
  // buildCity
  // ---------------------------------------------------------------
  function buildCity(group, map) {
    if (!map || !map.rows) return;
    var W = map.width, H = map.height;
    var rows = map.rows;

    function tileAt(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return ' ';
      return rows[y].charAt(x);
    }
    function isBuilding(c) {
      return c === '#' || c === 'S';
    }
    function isRoad(c) {
      return c === '.';
    }

    // --- helper to build a merged BufferGeometry from quads ---
    // quads: array of {cx, cy, cz, w, h, rotY, color} — each quad in XY plane facing +Z by default
    // We'll accumulate positions, normals, colors, indices.
    var posArr = [], normArr = [], colArr = [], idxArr = [];
    var vCount = 0;

    function addQuad(px, py, pz, w, h, nx, ny, nz, r, g, b, ux, uy, uz) {
      // p = center, w/h = half extents times 2 actually full size
      var hw = w * 0.5, hh = h * 0.5;
      // ux,uy,uz = up vector for the quad (in-plane), right vector = cross(up, normal)
      var rxv = uy * nz - uz * ny;
      var ryv = uz * nx - ux * nz;
      var rzv = ux * ny - uy * nx;
      // vertices: -u -r, +u -r, +u +r, -u +r (u along up, r along right)
      var vx, vy, vz;
      // v0
      vx = px - ux * hh - rxv * hw; vy = py - uy * hh - ryv * hw; vz = pz - uz * hh - rzv * hw;
      posArr.push(vx, vy, vz); normArr.push(nx, ny, nz); colArr.push(r, g, b);
      // v1
      vx = px + ux * hh - rxv * hw; vy = py + uy * hh - ryv * hw; vz = pz + uz * hh - rzv * hw;
      posArr.push(vx, vy, vz); normArr.push(nx, ny, nz); colArr.push(r, g, b);
      // v2
      vx = px + ux * hh + rxv * hw; vy = py + uy * hh + ryv * hw; vz = pz + uz * hh + rzv * hw;
      posArr.push(vx, vy, vz); normArr.push(nx, ny, nz); colArr.push(r, g, b);
      // v3
      vx = px - ux * hh + rxv * hw; vy = py - uy * hh + ryv * hw; vz = pz - uz * hh + rzv * hw;
      posArr.push(vx, vy, vz); normArr.push(nx, ny, nz); colArr.push(r, g, b);

      idxArr.push(vCount, vCount + 1, vCount + 2, vCount, vCount + 2, vCount + 3);
      vCount += 4;
    }

    function addBox(cx, cy, cz, sx, sy, sz, r, g, b) {
      var hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
      // 6 faces, each addQuad with proper normal & up
      // +Z
      addQuad(cx, cy, cz + hz, sx, sy, 0, 0, 1, r, g, b, 0, 1, 0);
      // -Z
      addQuad(cx, cy, cz - hz, sx, sy, 0, 0, -1, r, g, b, 0, 1, 0);
      // +X
      addQuad(cx + hx, cy, cz, sz, sy, 1, 0, 0, r, g, b, 0, 1, 0);
      // -X
      addQuad(cx - hx, cy, cz, sz, sy, -1, 0, 0, r, g, b, 0, 1, 0);
      // +Y
      addQuad(cx, cy + hy, cz, sx, sz, 0, 1, 0, r, g, b, 0, 0, 1);
      // -Y
      addQuad(cx, cy - hy, cz, sx, sz, 0, -1, 0, r, g, b, 0, 0, 1);
    }

    function flushGeometry(material) {
      if (vCount === 0) return null;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
      if (colArr.length > 0) {
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
      }
      geo.setIndex(idxArr);
      posArr = []; normArr = []; colArr = []; idxArr = []; vCount = 0;
      return geo;
    }

    // ============================================================
    // A) Road markings — dashed centre lines
    // ============================================================
    var markPos = [], markIdx = [];
    var mV = 0;

    function addMarkQuad(px, py, pz, w, h, isXDir) {
      // flat quad on ground, Y-up
      var hw = w * 0.5, hh = h * 0.5;
      var x0, z0, x1, z1, x2, z2, x3, z3;
      if (isXDir) {
        x0 = px - hw; z0 = pz - hh; x1 = px + hw; z1 = pz - hh;
        x2 = px + hw; z2 = pz + hh; x3 = px - hw; z3 = pz + hh;
      } else {
        x0 = px - hh; z0 = pz - hw; x1 = px + hh; z1 = pz - hw;
        x2 = px + hh; z2 = pz + hw; x3 = px - hh; z3 = pz + hw;
      }
      markPos.push(x0, py, z0, x1, py, z1, x2, py, z2, x3, py, z3);
      markIdx.push(mV, mV + 2, mV + 1, mV, mV + 3, mV + 2);
      mV += 4;
    }

    /* Centre lines only: a road tile carries a dash when it is the middle row (or column) of
       a road band 3..8 tiles wide that runs the other way; junctions and plazas stay clear. */
    var y, x;
    function rd(xx, yy) { return xx >= 0 && yy >= 0 && xx < W && yy < H && rows[yy].charAt(xx) === '.'; }
    function runH(xx, yy) { var a = xx, b = xx; while (rd(a - 1, yy)) a--; while (rd(b + 1, yy)) b++; return [a, b]; }
    function runV(xx, yy) { var a = yy, b = yy; while (rd(xx, a - 1)) a--; while (rd(xx, b + 1)) b++; return [a, b]; }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (!rd(x, y)) continue;
        var h = runH(x, y), v = runV(x, y), hw = h[1] - h[0] + 1, vw = v[1] - v[0] + 1;
        if (hw > vw && vw >= 3 && vw <= 8 && y === ((v[0] + v[1]) >> 1) && (x & 1) === 0)
          addMarkQuad(x + 0.5, 0.01, (v[0] + v[1] + 1) / 2, 0.9, 0.08, true);   /* road runs along x */
        else if (vw > hw && hw >= 3 && hw <= 8 && x === ((h[0] + h[1]) >> 1) && (y & 1) === 0)
          addMarkQuad((h[0] + h[1] + 1) / 2, 0.01, y + 0.5, 0.9, 0.08, false); /* road runs along z */
      }
    }

    if (mV > 0) {
      var markGeo = new THREE.BufferGeometry();
      markGeo.setAttribute('position', new THREE.Float32BufferAttribute(markPos, 3));
      markGeo.setIndex(markIdx);
      markGeo.computeVertexNormals();
      var markMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
      var markMesh = new THREE.Mesh(markGeo, markMat);
      markMesh.frustumCulled = false;
      group.add(markMesh);
    }

    // ============================================================
    // B) Kerbs
    // ============================================================
    var kerbPos = [], kerbIdx = [], kerbNorm = [];
    var kV = 0;

    function addKerbBox(cx, cy, cz, sx, sy, sz) {
      // simple box with flat normals, shared vertex colors not needed (uniform)
      // +Z
      var hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
      function quad(px, py, pz, nx, ny, nz, ux, uy, uz, ww, hh) {
        var rxv = uy * nz - uz * ny;
        var ryv = uz * nx - ux * nz;
        var rzv = ux * ny - uy * nx;
        var hw = ww * 0.5, hh2 = hh * 0.5;
        var vx, vy, vz;
        vx = px - ux * hh2 - rxv * hw; vy = py - uy * hh2 - ryv * hw; vz = pz - uz * hh2 - rzv * hw;
        kerbPos.push(vx, vy, vz); kerbNorm.push(nx, ny, nz);
        vx = px + ux * hh2 - rxv * hw; vy = py + uy * hh2 - ryv * hw; vz = pz + uz * hh2 - rzv * hw;
        kerbPos.push(vx, vy, vz); kerbNorm.push(nx, ny, nz);
        vx = px + ux * hh2 + rxv * hw; vy = py + uy * hh2 + ryv * hw; vz = pz + uz * hh2 + rzv * hw;
        kerbPos.push(vx, vy, vz); kerbNorm.push(nx, ny, nz);
        vx = px - ux * hh2 + rxv * hw; vy = py - uy * hh2 + ryv * hw; vz = pz - uz * hh2 + rzv * hw;
        kerbPos.push(vx, vy, vz); kerbNorm.push(nx, ny, nz);
        kerbIdx.push(kV, kV + 1, kV + 2, kV, kV + 2, kV + 3);
        kV += 4;
      }
      quad(cx, cy, cz + hz, 0, 0, 1, 0, 1, 0, sx, sy);
      quad(cx, cy, cz - hz, 0, 0, -1, 0, 1, 0, sx, sy);
      quad(cx + hx, cy, cz, 1, 0, 0, 0, 1, 0, sz, sy);
      quad(cx - hx, cy, cz, -1, 0, 0, 0, 1, 0, sz, sy);
      quad(cx, cy + hy, cz, 0, 1, 0, 0, 0, 1, sx, sz);
      quad(cx, cy - hy, cz, 0, -1, 0, 0, 0, 1, sx, sz);
    }

    // Scan edges between road and pavement/plaza
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var c = tileAt(x, y);
        if (!isRoad(c)) continue;
        var yy, xx;
        // Check 4 neighbors
        var neigh = [
          [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]
        ];
        for (var ni = 0; ni < 4; ni++) {
          var nx = neigh[ni][0], ny2 = neigh[ni][1];
          if (nx < 0 || ny2 < 0 || nx >= W || ny2 >= H) continue;
          var nc = tileAt(nx, ny2);
          if (isRoad(nc) || isBuilding(nc) || nc === 'W') continue;
          // Edge between road tile (x,y) and pavement tile (nx,ny2)
          if (ny2 < y) {
            // edge at y = y (top of road tile)
            addKerbBox(x + 0.5, 0.03, y, 1.0, 0.06, 0.08);
          } else if (ny2 > y) {
            addKerbBox(x + 0.5, 0.03, y + 1, 1.0, 0.06, 0.08);
          } else if (nx < x) {
            addKerbBox(x, 0.03, y + 0.5, 0.08, 0.06, 1.0);
          } else {
            addKerbBox(x + 1, 0.03, y + 0.5, 0.08, 0.06, 1.0);
          }
        }
      }
    }

    if (kV > 0) {
      var kerbGeo = new THREE.BufferGeometry();
      kerbGeo.setAttribute('position', new THREE.Float32BufferAttribute(kerbPos, 3));
      kerbGeo.setAttribute('normal', new THREE.Float32BufferAttribute(kerbNorm, 3));
      kerbGeo.setIndex(kerbIdx);
      var kerbMat = new THREE.MeshLambertMaterial({ color: 0xc9c4b8 });
      var kerbMesh = new THREE.Mesh(kerbGeo, kerbMat);
      kerbMesh.frustumCulled = false;
      group.add(kerbMesh);
    }

    // ============================================================
    // C) Windows + shop fronts
    // ============================================================
    // We'll use a vertex-colored Lambert material for windows and a separate
    // mesh for awnings (also vertex-colored), and shop windows can go in the
    // window geometry (vertex color).

    var winPos = [], winNorm = [], winCol = [], winIdx = [];
    var wV = 0;
    var awnPos = [], awnNorm = [], awnCol = [], awnIdx = [];
    var aV = 0;

    var awningPalette = [
      [0.78, 0.20, 0.20], // red
      [0.20, 0.45, 0.75], // blue
      [0.20, 0.62, 0.35], // green
      [0.85, 0.65, 0.20], // yellow
      [0.55, 0.30, 0.65]  // purple
    ];

    function winQuad(px, py, pz, w, h, nx, ny, nz, r, g, b, ux, uy, uz) {
      var rxv = uy * nz - uz * ny;
      var ryv = uz * nx - ux * nz;
      var rzv = ux * ny - uy * nx;
      var hw = w * 0.5, hh = h * 0.5;
      var vx, vy, vz;
      vx = px - ux * hh - rxv * hw; vy = py - uy * hh - ryv * hw; vz = pz - uz * hh - rzv * hw;
      winPos.push(vx, vy, vz); winNorm.push(nx, ny, nz); winCol.push(r, g, b);
      vx = px + ux * hh - rxv * hw; vy = py + uy * hh - ryv * hw; vz = pz + uz * hh - rzv * hw;
      winPos.push(vx, vy, vz); winNorm.push(nx, ny, nz); winCol.push(r, g, b);
      vx = px + ux * hh + rxv * hw; vy = py + uy * hh + ryv * hw; vz = pz + uz * hh + rzv * hw;
      winPos.push(vx, vy, vz); winNorm.push(nx, ny, nz); winCol.push(r, g, b);
      vx = px - ux * hh + rxv * hw; vy = py - uy * hh + ryv * hw; vz = pz - uz * hh + rzv * hw;
      winPos.push(vx, vy, vz); winNorm.push(nx, ny, nz); winCol.push(r, g, b);
      winIdx.push(wV, wV + 1, wV + 2, wV, wV + 2, wV + 3);
      wV += 4;
    }

    function awnBox(cx, cy, cz, sx, sy, sz, r, g, b) {
      var hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
      function face(px, py, pz, nx, ny, nz, ux, uy, uz, ww, hh) {
        var rxv = uy * nz - uz * ny;
        var ryv = uz * nx - ux * nz;
        var rzv = ux * ny - uy * nx;
        var hw = ww * 0.5, hh2 = hh * 0.5;
        var vx, vy, vz;
        vx = px - ux * hh2 - rxv * hw; vy = py - uy * hh2 - ryv * hw; vz = pz - uz * hh2 - rzv * hw;
        awnPos.push(vx, vy, vz); awnNorm.push(nx, ny, nz); awnCol.push(r, g, b);
        vx = px + ux * hh2 - rxv * hw; vy = py + uy * hh2 - ryv * hw; vz = pz + uz * hh2 - rzv * hw;
        awnPos.push(vx, vy, vz); awnNorm.push(nx, ny, nz); awnCol.push(r, g, b);
        vx = px + ux * hh2 + rxv * hw; vy = py + uy * hh2 + ryv * hw; vz = pz + uz * hh2 + rzv * hw;
        awnPos.push(vx, vy, vz); awnNorm.push(nx, ny, nz); awnCol.push(r, g, b);
        vx = px - ux * hh2 + rxv * hw; vy = py - uy * hh2 + ryv * hw; vz = pz - uz * hh2 + rzv * hw;
        awnPos.push(vx, vy, vz); awnNorm.push(nx, ny, nz); awnCol.push(r, g, b);
        awnIdx.push(aV, aV + 1, aV + 2, aV, aV + 2, aV + 3);
        aV += 4;
      }
      face(cx, cy, cz + hz, 0, 0, 1, 0, 1, 0, sx, sy);
      face(cx, cy, cz - hz, 0, 0, -1, 0, 1, 0, sx, sy);
      face(cx + hx, cy, cz, 1, 0, 0, 0, 1, 0, sz, sy);
      face(cx - hx, cy, cz, -1, 0, 0, 0, 1, 0, sz, sy);
      face(cx, cy + hy, cz, 0, 1, 0, 0, 0, 1, sx, sz);
      face(cx, cy - hy, cz, 0, -1, 0, 0, 0, 1, sx, sz);
    }

    var darkR = 0x39 / 255, darkG = 0x42 / 255, darkB = 0x4e / 255;
    var litR = 0xe8 / 255, litG = 0xc9 / 255, litB = 0x7a / 255;
    var shopR = 0x9f / 255, shopG = 0xc3 / 255, shopB = 0xd6 / 255;

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var ct = tileAt(x, y);
        if (!isBuilding(ct)) continue;

        var bh;
        if (typeof Art !== 'undefined' && Art.heightAt) {
          bh = Math.max(1.5, Art.heightAt(x, y) * 2.4);
        } else {
          bh = 4.0;
        }

        // Check 4 faces
        var faces = [
          { nx: 0, ny: 0, nz: 1, ox: 0, oz: 0.5, tx: 1, tz: 0, hy: 0 },   // +Z (south)
          { nx: 0, ny: 0, nz: -1, ox: 0, oz: -0.5, tx: -1, tz: 0, hy: 0 }, // -Z (north)
          { nx: 1, ny: 0, nz: 0, ox: 0.5, oz: 0, tx: 0, tz: -1, hy: 0 },   // +X (east)
          { nx: -1, ny: 0, nz: 0, ox: -0.5, oz: 0, tx: 0, tz: 1, hy: 0 }   // -X (west)
        ];

        for (var fi = 0; fi < 4; fi++) {
          var f = faces[fi];
          var nxp = x + f.nx, nyp = y + f.nz;
          var nct = tileAt(nxp, nyp);
          if (isBuilding(nct)) continue; // interior face
          if (nct === ' ' && (nxp < 0 || nyp < 0 || nxp >= W || nyp >= H)) continue;

          var faceCx = x + 0.5 + f.ox;
          var faceCz = y + 0.5 + f.oz;

          // Up vector in world = (tx, 0, tz) for quads on vertical walls
          var ux = f.tx, uy = 0, uz = f.tz;

          // Windows per floor
          var floorY = 1.0;
          var floorIdx = 0;
          while (floorY + 0.3 <= bh - 0.4) {
            // window center y
            var wy = floorY + 0.3;
            var wxOff = 0.01 * f.nx;
            var wzOff = 0.01 * f.nz;
            var hsh = hash3(x * 7 + fi, y * 13, floorIdx);
            var isLit = hsh < 0.15;
            var wr, wg, wb;
            if (isLit) { wr = litR; wg = litG; wb = litB; }
            else { wr = darkR; wg = darkG; wb = darkB; }

            // Ground floor shop window for 'S'
            if (ct === 'S' && floorY < 1.5) {
              // handled separately below, but still draw regular upper windows
            }

            winQuad(
              faceCx + wxOff, wy, faceCz + wzOff,
              0.45, 0.6,
              f.nx, 0, f.nz,
              wr, wg, wb,
              ux, uy, uz
            );

            floorY += 1.2;
            floorIdx++;
          }

          // Shop front for 'S' on faces touching road or pavement/plaza
          if (ct === 'S') {
            var touchesStreet = (nct === '.' || nct === 'P' || nct === 'a' ||
              (nct !== '#' && nct !== 'S' && nct !== 'W' && nct !== ' ' && nct !== undefined));
            if (touchesStreet) {
              // Wide shop window at y 0.1..1.0 => center 0.55, height 0.8
              var swx = 0.01 * f.nx, swz = 0.01 * f.nz;
              winQuad(
                faceCx + swx, 0.55, faceCz + swz,
                0.8, 0.8,
                f.nx, 0, f.nz,
                shopR, shopG, shopB,
                ux, uy, uz
              );

              // Awning: box 0.9 wide (along tangent), 0.06 tall, 0.35 deep (along normal)
              // Position: at y 1.05, offset 0.175 out from wall in normal direction
              var awOff = 0.175 + 0.01;
              var awCx = faceCx + f.nx * awOff;
              var awCz = faceCz + f.nz * awOff;
              var awHash = hash2(x * 3 + fi, y * 5);
              var palIdx = Math.floor(awHash * 5) % 5;
              var pal = awningPalette[palIdx];
              // awning dimensions: sx/sz depend on face orientation
              var asx, asz;
              if (f.nx !== 0) { asx = 0.35; asz = 0.9; }
              else { asx = 0.9; asz = 0.35; }
              awnBox(awCx, 1.05, awCz, asx, 0.06, asz, pal[0], pal[1], pal[2]);
            }
          }
        }
      }
    }

    if (wV > 0) {
      var winGeo = new THREE.BufferGeometry();
      winGeo.setAttribute('position', new THREE.Float32BufferAttribute(winPos, 3));
      winGeo.setAttribute('normal', new THREE.Float32BufferAttribute(winNorm, 3));
      winGeo.setAttribute('color', new THREE.Float32BufferAttribute(winCol, 3));
      winGeo.setIndex(winIdx);
      var winMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      var winMesh = new THREE.Mesh(winGeo, winMat);
      winMesh.frustumCulled = false;
      group.add(winMesh);
    }

    if (aV > 0) {
      var awnGeo = new THREE.BufferGeometry();
      awnGeo.setAttribute('position', new THREE.Float32BufferAttribute(awnPos, 3));
      awnGeo.setAttribute('normal', new THREE.Float32BufferAttribute(awnNorm, 3));
      awnGeo.setAttribute('color', new THREE.Float32BufferAttribute(awnCol, 3));
      awnGeo.setIndex(awnIdx);
      var awnMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      var awnMesh = new THREE.Mesh(awnGeo, awnMat);
      awnMesh.frustumCulled = false;
      group.add(awnMesh);
    }

    // ============================================================
    // D) Street lamps
    // ============================================================
    var lampPos = [], lampNorm = [], lampIdx = [];
    var lV = 0;

    function lampBox(cx, cy, cz, sx, sy, sz) {
      var hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
      function face(px, py, pz, nx, ny, nz, ux, uy, uz, ww, hh) {
        var rxv = uy * nz - uz * ny;
        var ryv = uz * nx - ux * nz;
        var rzv = ux * ny - uy * nx;
        var hw = ww * 0.5, hh2 = hh * 0.5;
        var vx, vy, vz;
        vx = px - ux * hh2 - rxv * hw; vy = py - uy * hh2 - ryv * hw; vz = pz - uz * hh2 - rzv * hw;
        lampPos.push(vx, vy, vz); lampNorm.push(nx, ny, nz);
        vx = px + ux * hh2 - rxv * hw; vy = py + uy * hh2 - ryv * hw; vz = pz + uz * hh2 - rzv * hw;
        lampPos.push(vx, vy, vz); lampNorm.push(nx, ny, nz);
        vx = px + ux * hh2 + rxv * hw; vy = py + uy * hh2 + ryv * hw; vz = pz + uz * hh2 + rzv * hw;
        lampPos.push(vx, vy, vz); lampNorm.push(nx, ny, nz);
        vx = px - ux * hh2 + rxv * hw; vy = py - uy * hh2 + ryv * hw; vz = pz - uz * hh2 + rzv * hw;
        lampPos.push(vx, vy, vz); lampNorm.push(nx, ny, nz);
        lampIdx.push(lV, lV + 1, lV + 2, lV, lV + 2, lV + 3);
        lV += 4;
      }
      face(cx, cy, cz + hz, 0, 0, 1, 0, 1, 0, sx, sy);
      face(cx, cy, cz - hz, 0, 0, -1, 0, 1, 0, sx, sy);
      face(cx + hx, cy, cz, 1, 0, 0, 0, 1, 0, sz, sy);
      face(cx - hx, cy, cz, -1, 0, 0, 0, 1, 0, sz, sy);
      face(cx, cy + hy, cz, 0, 1, 0, 0, 0, 1, sx, sz);
      face(cx, cy - hy, cz, 0, -1, 0, 0, 0, 1, sx, sz);
    }

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var lc = tileAt(x, y);
        if (lc === '.' || isBuilding(lc) || lc === 'W' || lc === ' ' || lc === undefined) continue;
        // Check if next to a road
        var nearRoad = false;
        if (tileAt(x - 1, y) === '.') nearRoad = true;
        else if (tileAt(x + 1, y) === '.') nearRoad = true;
        else if (tileAt(x, y - 1) === '.') nearRoad = true;
        else if (tileAt(x, y + 1) === '.') nearRoad = true;
        if (!nearRoad) continue;

        var lampHash = hash2(x, y);
        if (lampHash > 1 / 14) continue;   /* sparse: about one lamp per 14 kerb tiles */

        // Determine offset toward road
        var lox = 0, loz = 0;
        if (tileAt(x, y + 1) === '.') loz = 0.35;
        else if (tileAt(x, y - 1) === '.') loz = -0.35;
        else if (tileAt(x + 1, y) === '.') lox = 0.35;
        else if (tileAt(x - 1, y) === '.') lox = -0.35;

        var lcx = x + 0.5 + lox;
        var lcz = y + 0.5 + loz;

        // Pole: 0.05 x 2.2 x 0.05, centered at y 1.1
        lampBox(lcx, 1.1, lcz, 0.05, 2.2, 0.05);
        // Head: small box 0.15 x 0.1 x 0.15 at y 2.25
        lampBox(lcx, 2.25, lcz, 0.15, 0.1, 0.15);
      }
    }

    if (lV > 0) {
      var lampGeo = new THREE.BufferGeometry();
      lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
      lampGeo.setAttribute('normal', new THREE.Float32BufferAttribute(lampNorm, 3));
      lampGeo.setIndex(lampIdx);
      var lampMat = new THREE.MeshLambertMaterial({ color: 0x2d3238 });
      var lampMesh = new THREE.Mesh(lampGeo, lampMat);
      lampMesh.frustumCulled = false;
      group.add(lampMesh);
    }
  }

  // ---------------------------------------------------------------
  // Leg mesh creation (lazy)
  // ---------------------------------------------------------------
  function ensureLegMeshes() {
    if (_legLeft) return;
    // Box 0.09 x 0.3 x 0.09, pivot at top (y=0 at top, extends down to -0.3)
    _legGeo = new THREE.BoxGeometry(0.09, 0.3, 0.09);
    _legGeo.translate(0, -0.15, 0); // pivot at top

    var matCrowd = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
    var matPolice = new THREE.MeshLambertMaterial({ color: 0x141c33 });

    _legLeftCrowd = new THREE.InstancedMesh(_legGeo, matCrowd, _maxCrowd);
    _legLeftCrowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _legLeftCrowd.frustumCulled = false;
    _legLeftCrowd.count = 0;

    _legRightCrowd = new THREE.InstancedMesh(_legGeo, matCrowd, _maxCrowd);
    _legRightCrowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _legRightCrowd.frustumCulled = false;
    _legRightCrowd.count = 0;

    _legLeftPolice = new THREE.InstancedMesh(_legGeo, matPolice, _maxPolice);
    _legLeftPolice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _legLeftPolice.frustumCulled = false;
    _legLeftPolice.count = 0;

    _legRightPolice = new THREE.InstancedMesh(_legGeo, matPolice, _maxPolice);
    _legRightPolice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _legRightPolice.frustumCulled = false;
    _legRightPolice.count = 0;

    _legLeft = _legLeftCrowd;
    _legRight = _legRightCrowd;
    _legLeftCrowd.name = 'legLCrowd';
    _legRightCrowd.name = 'legRCrowd';
    _legLeftPolice.name = 'legLPolice';
    _legRightPolice.name = 'legRPolice';

    if (_scene) {
      _scene.add(_legLeftCrowd);
      _scene.add(_legRightCrowd);
      _scene.add(_legLeftPolice);
      _scene.add(_legRightPolice);
    }
  }

  // ---------------------------------------------------------------
  // update
  // ---------------------------------------------------------------
  function update(G, dt, cx, cz) {
    if (!_scene) return;
    ensureLegMeshes();

    // Clamp dt
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;

    var agents = G.agents;
    var officers = G.officers;
    var i, n;

    // ---- Crowd ----
    var lcCount = 0, rcCount = 0;
    if (agents) {
      n = agents.length;
      if (n > _maxCrowd) n = _maxCrowd;
      for (i = 0; i < n; i++) {
        var a = agents[i];
        if (!a || !a.active || a.arrested) continue;
        var ax = a.x, az = a.y;
        var dx = ax - cx, dz = az - cz;
        if (dx * dx + dz * dz > 1225) continue; // 35^2

        var speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        _phaseCrowd[i] += speed * dt * 9;
        var swing = Math.sin(_phaseCrowd[i]) * 0.6 * Math.min(1, speed / 1.2);

        // Yaw: -atan2(vy, vx) - but world z = tile y, so yaw around Y is atan2(vx, vz)?
        // For a leg swinging forward/back in direction of travel:
        // The leg's local +Z should point in direction of travel in world XZ.
        // Direction of travel = (vx, vz) in world XZ (vx=a.vx, vz=a.vy).
        // Yaw = atan2(dirX, dirZ) so that local +Z maps to (dirX, dirZ).
        var yaw;
        if (speed > 0.01) {
          yaw = Math.atan2(a.vx, a.vy);
        } else {
          yaw = 0;
        }

        // Left leg
        _euler.set(swing, yaw, 0, 'YXZ');
        _q.setFromEuler(_euler);
        _v3.set(ax - 0.07, 0.3, az);
        _m4.compose(_v3, _q, _v3b.set(1, 1, 1));
        _legLeftCrowd.setMatrixAt(lcCount, _m4);

        // Right leg
        _euler.set(-swing, yaw, 0, 'YXZ');
        _q.setFromEuler(_euler);
        _v3.set(ax + 0.07, 0.3, az);
        _m4.compose(_v3, _q, _v3b.set(1, 1, 1));
        _legRightCrowd.setMatrixAt(rcCount, _m4);

        lcCount++;
        rcCount++;
      }
    }
    _legLeftCrowd.count = lcCount;
    _legRightCrowd.count = rcCount;
    if (lcCount > 0) {
      _legLeftCrowd.instanceMatrix.needsUpdate = true;
      _legRightCrowd.instanceMatrix.needsUpdate = true;
    }

    // ---- Police ----
    var lpcCount = 0, rpcCount = 0;
    if (officers) {
      n = officers.length;
      if (n > _maxPolice) n = _maxPolice;

      // Init last positions on first run
      if (!_policePosInit) {
        for (i = 0; i < n; i++) {
          var off = officers[i];
          if (off) {
            _lastPosPolice[i * 2] = off.x;
            _lastPosPolice[i * 2 + 1] = off.y;
          }
        }
        _policePosInit = true;
      }

      for (i = 0; i < n; i++) {
        var o = officers[i];
        if (!o) continue;
        var ox = o.x, oz = o.y;
        var odx = ox - cx, odz = oz - cz;
        if (odx * odx + odz * odz > 1225) {
          _lastPosPolice[i * 2] = ox;
          _lastPosPolice[i * 2 + 1] = oz;
          continue;
        }

        // Speed from last position
        var ldx = ox - _lastPosPolice[i * 2];
        var ldz = oz - _lastPosPolice[i * 2 + 1];
        var spd = Math.sqrt(ldx * ldx + ldz * ldz) / Math.max(dt, 0.001);
        // Clamp speed to avoid teleport spikes
        if (spd > 5) spd = 0;
        _lastPosPolice[i * 2] = ox;
        _lastPosPolice[i * 2 + 1] = oz;

        _phasePolice[i] += spd * dt * 9;
        var pswing = Math.sin(_phasePolice[i]) * 0.6 * Math.min(1, spd / 1.2);

        var pyaw = 0;
        if (spd > 0.05 && (Math.abs(ldx) > 0.0001 || Math.abs(ldz) > 0.0001)) {
          pyaw = Math.atan2(ldx, ldz);
        }

        // Left leg
        _euler.set(pswing, pyaw, 0, 'YXZ');
        _q.setFromEuler(_euler);
        _v3.set(ox - 0.07, 0.3, oz);
        _m4.compose(_v3, _q, _v3b.set(1, 1, 1));
        _legLeftPolice.setMatrixAt(lpcCount, _m4);

        // Right leg
        _euler.set(-pswing, pyaw, 0, 'YXZ');
        _q.setFromEuler(_euler);
        _v3.set(ox + 0.07, 0.3, oz);
        _m4.compose(_v3, _q, _v3b.set(1, 1, 1));
        _legRightPolice.setMatrixAt(rpcCount, _m4);

        lpcCount++;
        rpcCount++;
      }
    }
    _legLeftPolice.count = lpcCount;
    _legRightPolice.count = rpcCount;
    if (lpcCount > 0) {
      _legLeftPolice.instanceMatrix.needsUpdate = true;
      _legRightPolice.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------
  // target
  // ---------------------------------------------------------------
  function target(G, cx, cz, yaw) {
    var best = -1;
    var bestDist = 3.5 * 3.5;
    var agents = G.agents;
    if (!agents) {
      _hideRing();
      _lastTarget = -1;
      return -1;
    }

    var cosYaw = Math.cos(yaw);
    var sinYaw = Math.sin(yaw);
    var cosLimit = Math.cos(50 * Math.PI / 180);

    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (!a || !a.active || a.arrested) continue;
      var dx = a.x - cx;
      var dz = a.y - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 > bestDist) continue;
      if (d2 < 0.0001) {
        // Very close, assume in front
        best = i;
        bestDist = d2;
        continue;
      }
      var d = Math.sqrt(d2);
      var ndx = dx / d;
      var ndz = dz / d;
      var dot = ndx * cosYaw + ndz * sinYaw;
      if (dot < cosLimit) continue;
      if (d2 < bestDist) {
        bestDist = d2;
        best = i;
      }
    }

    _lastTarget = best;
    if (best >= 0 && _ringMesh) {
      var ba = agents[best];
      _ringMesh.position.x = ba.x;
      _ringMesh.position.z = ba.y;
      _ringMesh.visible = true;
    } else {
      _hideRing();
    }
    return best;
  }

  function _hideRing() {
    if (_ringMesh) _ringMesh.visible = false;
  }

  function lastTarget() {
    return _lastTarget;
  }

  // ---------------------------------------------------------------
  return {
    attach: attach,
    buildCity: buildCity,
    update: update,
    target: target,
    lastTarget: lastTarget,
    show: show
  };
})();
