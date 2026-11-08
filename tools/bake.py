"""Bake a map's building and road shapes so the game loads them instead of computing them.

    python tools/bake.py paris_central      -> maps/paris_central.bake.js

Needs Playwright and Edge (runs the game headless with the real code). Re-run after editing the map;
a stale bake is ignored by the game (signature check), never wrong.
"""
import json, os, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def bake(name):
    url = "file:///" + ROOT.replace("\\", "/") + "/index.html?map=" + name + "&nobake=1"
    with sync_playwright() as p:
        c = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=EDGE, headless=True,
                                                 args=["--allow-file-access-from-files"])
        pg = c.pages[0]
        pg.add_init_script("window.BAKED = [];")   # never reuse an old bake
        pg.goto(url)
        time.sleep(3)
        pg.keyboard.press("Enter")
        data = None
        for _ in range(240):
            data = pg.evaluate("() => { var d = Art.bakeData && Art.bakeData(); return d ? JSON.stringify(d) : null; }")
            if data:
                break
            time.sleep(0.5)
        c.close()
    if not data:
        sys.exit("map did not build (name right?)")
    out = os.path.join(ROOT, "maps", name + ".bake.js")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* Baked shapes for %s, made by tools/bake.py. Delete or re-run after map edits. */\n" % name)
        f.write("var BAKED = BAKED || [];\nBAKED.push(" + data + ");\n")
    print(out, round(os.path.getsize(out) / 1e6, 1), "MB")


if __name__ == "__main__":
    for n in sys.argv[1:] or ["paris_central"]:
        bake(n)
