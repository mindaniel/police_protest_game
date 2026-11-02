#!/usr/bin/env python3
"""Render a GLB/GLTF model to a transparent PNG matching the game's oblique camera,
and emit maps/sprites/ID.js for the game to load.

Usage:
  python tools/sprite/render_sprite.py MODEL --id eiffel --match "Eiffel" \
      --height-m 330 --px-per-tile 24 [--rotate-deg 0] \
      [--map paris_eiffel --x 120.5 --y 88.0] [--credit "text"] \
      [--elev-deg 0] [--metalness-max 0.6] [--tint "#7a6a5a"]
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import pathlib

from playwright.sync_api import sync_playwright

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def read_model(path):
    path = pathlib.Path(path)
    if not path.exists():
        sys.exit("Model not found: %s" % path)
    ext = path.suffix.lower()
    files = {}
    if ext == ".glb":
        return path.read_bytes(), {}, path
    if ext != ".gltf":
        sys.exit("Unsupported model extension: %s" % ext)
    root = path.parent
    files["__main__"] = (path.name, path.read_bytes())
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        sys.exit("Cannot parse gltf: %s" % e)
    refs = set()
    for b in doc.get("buffers", []):
        if "uri" in b and not b["uri"].startswith("data:"):
            refs.add(b["uri"])
    for im in doc.get("images", []):
        if "uri" in im and not im["uri"].startswith("data:"):
            refs.add(im["uri"])
    for r in refs:
        fn = pathlib.PurePosixPath(r).name
        full = root / fn
        if not full.exists():
            full = root / r
        if not full.exists():
            sys.exit("Missing referenced file: %s" % r)
        files[fn] = (full.name, full.read_bytes())
    return path.read_bytes(), files, path


def data_url(name, raw):
    mt, _ = mimetypes.guess_type(name)
    if mt is None:
        mt = "application/octet-stream"
    return "data:%s;base64,%s" % (mt, base64.b64encode(raw).decode("ascii"))


HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
canvas{display:block}
</style>
<script type="importmap">
{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
}}
</script>
</head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

window.__renderSprite = function(cfg) {
  return new Promise(function(resolve, reject) {
    try {
      const loader = new GLTFLoader();
      if (cfg.files && Object.keys(cfg.files).length) {
        const mgr = new THREE.LoadingManager();
        mgr.setURLModifier(function(url) {
          // url may be "foo.bin" or a path; match by basename
          var base = url.split(/[\\/]/).pop();
          if (cfg.files[base]) return cfg.files[base];
          return url;
        });
        loader.manager = mgr;
      }
      const bin = Uint8Array.from(atob(cfg.glbB64), c => c.charCodeAt(0));
      loader.parse(bin.buffer, '', function(gltf) {
        try { doRender(gltf, cfg, resolve, reject); }
        catch (e) { reject(String(e && e.stack || e)); }
      }, function(err) { reject(String(err)); });
    } catch (e) { reject(String(e && e.stack || e)); }
  });
};

function doRender(gltf, cfg, resolve, reject) {
  const root = gltf.scene || gltf.scenes[0];

  // Rotate around vertical (three Y) axis.
  const rot = (cfg.rotateDeg || 0) * Math.PI / 180;
  if (rot) {
    const m = new THREE.Matrix4().makeRotationY(rot);
    root.applyMatrix4(m);
  }

  // Compute bounding box, normalize to height in metres.
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  if (!isFinite(box.min.x) || box.isEmpty()) { reject("Empty bounding box"); return; }
  const heightM = cfg.heightM;
  const heightTiles = heightM / 3.5;
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = heightTiles / Math.max(size.y, 1e-6);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  // base center at origin, ground y=0
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  // ------- Material fixes (metalness clamp + tint) -------
  const metalMax = (typeof cfg.metalnessMax === 'number') ? cfg.metalnessMax : 0.6;
  const tintHex = cfg.tint || null;
  const tintColor = tintHex ? new THREE.Color(tintHex) : null;
  root.traverse(function(o) {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (typeof mat.metalness === 'number' && mat.metalness > metalMax) {
        mat.metalness = metalMax;
      }
      // If there is no color texture, apply tint (if any) so the material isn't pure black
      const hasMap = !!mat.map;
      if (!hasMap && tintColor && mat.color) {
        mat.color.copy(tintColor);
      }
      if (tintColor && mat.emissive && !hasMap && !cfg.noEmissive) {
        // nudge emissive slightly to avoid pitch-black on non-metallic PBR with bad lighting
      }
      mat.needsUpdate = true;
    }
  });

  // ------- Camera mode selection -------
  const elevDeg = (typeof cfg.elevDeg === 'number') ? cfg.elevDeg : 0;
  const useSideView = elevDeg > 0;

  if (!useSideView) {
    // Apply oblique shear: z' = z - 0.5625 * y
    const shear = new THREE.Matrix4();
    shear.set(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, -0.5625, 1, 0,
      0, 0, 0, 1
    );
    root.applyMatrix4(shear);
    root.updateMatrixWorld(true);
  }

  // Bounding box in (possibly sheared) space
  const shearedBox = new THREE.Box3().setFromObject(root);
  const sMin = shearedBox.min, sMax = shearedBox.max;
  const minX = sMin.x, maxX = sMax.x;
  const minZ = sMin.z, maxZ = sMax.z;

  const marginFrac = 0.02;
  const widthTiles = maxX - minX;
  const spanTiles = maxZ - minZ;
  const widthPad = widthTiles * (1 + 2 * marginFrac);
  const heightPad = spanTiles * (1 + 2 * marginFrac);

  const ppt = cfg.pxPerTile;
  let imgW, imgH;

  // Renderer setup
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();

  // Environment map (PMREM + RoomEnvironment) to give metallic materials something to reflect
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    if (roomEnv.dispose) roomEnv.dispose();
  } catch (e) {
    console.warn('Environment map setup failed:', e);
  }

  // Lighting (keep hemi + directional lights regardless of mode)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x666677, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  // south-east above: +Z is south, +X is east
  dir.position.set(1, 1.5, 1);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dir2.position.set(-1, 1.0, -1);
  scene.add(dir2);

  let cam;

  if (!useSideView) {
    // ----- Oblique top-down shear mode (unchanged) -----
    imgW = Math.max(1, Math.min(4096, Math.round(widthPad * ppt)));
    imgH = Math.max(1, Math.min(4096, Math.round(heightPad * ppt)));
    renderer.setSize(imgW, imgH, false);

    const camX = (minX + maxX) / 2;
    const camZ = (minZ + maxZ) / 2;
    cam = new THREE.OrthographicCamera(
      -widthPad / 2, widthPad / 2,
      heightPad / 2, -heightPad / 2,
      0.01, 5000
    );
    cam.position.set(camX, 1000, camZ);
    cam.up.set(0, 0, -1);
    cam.lookAt(camX, 0, camZ);
    cam.updateProjectionMatrix();
  } else {
    // ----- Side view (classic RPG sprite) mode -----
    // Camera on the south side, looking north, at elevation E above horizon.
    // up = world Y. No shear.
    const E = elevDeg * Math.PI / 180.0;
    const sinE = Math.sin(E);
    const cosE = Math.cos(E);

    // Horizontal extent of the model along X (east-west) and Z (north-south).
    const halfW = widthTiles / 2;
    const halfD = (maxZ - minZ) / 2;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Vertical extent: model height (in tiles). We know root was normalized so
    // model occupies Y from 0 to heightTiles.
    const modelH = heightTiles;
    const modelYcenter = modelH / 2;

    // Screen height of the model in tiles, accounting for elevation:
    //   projected_height ≈ modelH * cos(E) + modelDepth * sin(E)
    // where modelDepth is the Z extent of the model. Use the true (unscaled) Z extent
    // of the model in world units after transforms — but we already have it in tiles.
    const modelDepth = (maxZ - minZ);
    const screenHeightTiles = modelH * cosE + modelDepth * sinE;

    // Required horizontal span: model width along X.
    const spanXTiles = widthTiles;

    const widthPadSide = spanXTiles * (1 + 2 * marginFrac);
    const heightPadSide = Math.max(screenHeightTiles, modelH * 0.5) * (1 + 2 * marginFrac);

    imgW = Math.max(1, Math.min(4096, Math.round(widthPadSide * ppt)));
    imgH = Math.max(1, Math.min(4096, Math.round(heightPadSide * ppt)));
    renderer.setSize(imgW, imgH, false);

    // Camera: placed on the south side (positive Z), raised by elevation.
    // distance chosen large enough that orthographic near/far covers model.
    const dist = Math.max(modelH, widthTiles, modelDepth) * 4 + 10;
    const camX = centerX;
    const camY = modelYcenter + dist * sinE;
    const camZ = centerZ + dist * cosE;
    // Looking at the model's vertical center.
    const lookAtX = centerX;
    const lookAtY = modelYcenter;
    const lookAtZ = centerZ;

    cam = new THREE.OrthographicCamera(
      -widthPadSide / 2, widthPadSide / 2,
      heightPadSide / 2, -heightPadSide / 2,
      0.01, dist * 4 + modelH * 4 + 50
    );
    cam.position.set(camX, camY, camZ);
    cam.up.set(0, 1, 0);
    cam.lookAt(lookAtX, lookAtY, lookAtZ);
    cam.updateProjectionMatrix();

    // Store for anchor projection later
    cam.userData.lookAt = { x: lookAtX, y: lookAtY, z: lookAtZ };
  }

  scene.add(root);

  renderer.render(scene, cam);

  const canvas = renderer.domElement;
  const dataURL = canvas.toDataURL("image/png");

  // Project world point to pixel coords.
  const _v = new THREE.Vector3();
  function worldToPixel(x, y, z) {
    _v.set(x, y, z);
    // Project using camera matrices
    _v.project(cam);
    // NDC in [-1,1]; convert to pixels
    return {
      px: (_v.x + 1) * 0.5 * imgW,
      py: (1 - _v.y) * 0.5 * imgH
    };
  }

  // Anchor: model base centre. Base centre in world space:
  //   After normalization, base is at y=0 and x/z centered at (0, 0) in root-space.
  //   In shear mode the sheared position of (0,0,0) is (0,0,0).
  //   In side mode no shear, so base centre is at (0, 0, 0) in world space too.
  const anchor = worldToPixel(0, 0, 0);

  renderer.dispose();

  resolve({
    dataURL: dataURL,
    width: imgW,
    height: imgH,
    ax: anchor.px,
    ay: anchor.py
  });
}
</script>
</body></html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--id", required=True)
    ap.add_argument("--match", default=None)
    ap.add_argument("--height-m", type=float, required=True)
    ap.add_argument("--px-per-tile", type=int, default=24)
    ap.add_argument("--rotate-deg", type=float, default=0.0)
    ap.add_argument("--elev-deg", type=float, default=0.0)
    ap.add_argument("--metalness-max", type=float, default=0.6)
    ap.add_argument("--tint", default=None)
    ap.add_argument("--map", default=None)
    ap.add_argument("--x", type=float, default=None)
    ap.add_argument("--y", type=float, default=None)
    ap.add_argument("--credit", default="")
    args = ap.parse_args()

    raw, files, path = read_model(args.model)
    files_map = {}
    for k, (name, data) in files.items():
        if k == "__main__":
            continue
        files_map[k] = data_url(name, data)
        files_map[name] = files_map[k]

    glb_b64 = base64.b64encode(raw).decode("ascii")

    cfg = {
        "glbB64": glb_b64,
        "files": files_map,
        "heightM": args.height_m,
        "pxPerTile": args.px_per_tile,
        "rotateDeg": args.rotate_deg,
        "elevDeg": args.elev_deg,
        "metalnessMax": args.metalness_max,
        "tint": args.tint,
    }

    out_dir = pathlib.Path("tools/sprite/out")
    out_dir.mkdir(parents=True, exist_ok=True)
    sprites_dir = pathlib.Path("maps/sprites")
    sprites_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(executable_path=EDGE, headless=True)
        except Exception:
            browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 1024})
        page.on("console", lambda m: print("[page]", m.type, m.text)); page.on("pageerror", lambda e: print("[pageerror]", e))   # surface page errors
        page.set_content(HTML)
        # wait for module to be ready
        page.wait_for_function("typeof window.__renderSprite === 'function'", timeout=30000)
        result = page.evaluate("cfg => window.__renderSprite(cfg)", cfg)
        browser.close()

    data_url_png = result["dataURL"]
    b64 = data_url_png.split(",", 1)[1]
    img_bytes = base64.b64decode(b64)

    png_path = out_dir / (args.id + ".png")
    png_path.write_bytes(img_bytes)

    matches = [args.match] if args.match else [args.id]

    js = []
    js.append("var LANDMARK_SPRITES = LANDMARK_SPRITES || {};")
    js.append("LANDMARK_SPRITES[%s] = {" % json.dumps(args.id))
    js.append("  match: %s," % json.dumps(matches))
    js.append("  src: %s," % json.dumps(data_url_png))
    js.append("  pxPerTile: %d," % args.px_per_tile)
    js.append("  ax: %s," % json.dumps(round(result["ax"], 2)))
    js.append("  ay: %s," % json.dumps(round(result["ay"], 2)))
    js.append("  map: %s," % json.dumps(args.map))
    js.append("  x: %s," % json.dumps(args.x))
    js.append("  y: %s," % json.dumps(args.y))
    js.append("  credit: %s" % json.dumps(args.credit))
    js.append("};")
    js_path = sprites_dir / (args.id + ".js")
    js_path.write_text("\n".join(js) + "\n", encoding="utf-8")

    print("Image: %s  (%dx%d px)" % (png_path, result["width"], result["height"]))
    print("Anchor: (%.2f, %.2f)" % (result["ax"], result["ay"]))
    print("Sprite JS: %s" % js_path)


if __name__ == "__main__":
    main()
