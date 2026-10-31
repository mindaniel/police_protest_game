"""osmget.py OUT.json lat lon width_m height_m - download an area from Overpass in 3x3 chunks (merged, retried)."""
import sys, json, math, time, urllib.request, urllib.parse
out, lat, lon, wm, hm = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
dlat = hm / 2 / 110574.0 * 1.15; dlon = wm / 2 / (111320.0 * math.cos(math.radians(lat))) * 1.15
S, N, W, E = lat - dlat, lat + dlat, lon - dlon, lon + dlon
seen, els = set(), []
def q(s, w, n, e):
    b = "(%f,%f,%f,%f)" % (s, w, n, e)
    parts = ["way%s[highway]" % b, "way%s[building]" % b, "relation%s[building]" % b, "way%s[leisure]" % b, "way%s[landuse]" % b,
             "way%s[natural]" % b, "way%s[waterway]" % b, "relation%s[natural=water]" % b, "node%s[shop]" % b, "node%s[amenity]" % b,
             "node%s[historic]" % b, "node%s[tourism]" % b, "node%s[natural=tree]" % b, "way%s[amenity]" % b, "way%s[historic]" % b,
             "way%s[tourism]" % b, "relation%s[amenity]" % b, "relation%s[tourism]" % b]
    return "[out:json][timeout:180];(" + ";".join(parts) + ";);out geom;"
for i in range(3):
    for j in range(3):
        s = S + (N - S) * i / 3; n = S + (N - S) * (i + 1) / 3; w = W + (E - W) * j / 3; e = W + (E - W) * (j + 1) / 3
        for attempt in range(4):
            try:
                d = urllib.request.urlopen(urllib.request.Request("https://overpass-api.de/api/interpreter",
                    data=urllib.parse.urlencode({"data": q(s, w, n, e)}).encode(), headers={"User-Agent": "ppg-mapgen"}), timeout=240).read()
                for el in json.loads(d)["elements"]:
                    k = (el["type"], el["id"])
                    if k not in seen: seen.add(k); els.append(el)
                print("chunk", i, j, "ok", len(els)); break
            except Exception as ex:
                print("chunk", i, j, "retry", ex); time.sleep(20 * (attempt + 1))
        else:
            sys.exit("chunk failed")
        time.sleep(3)
json.dump({"elements": els}, open(out, "w")); print("saved", out, len(els))
