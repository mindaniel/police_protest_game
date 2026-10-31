#!/usr/bin/env python3
"""osm2map.py - convert an Overpass API JSON export into a browser-game tile map."""
import json, math, sys, argparse
from collections import defaultdict, deque

WALKABLE = set('.aPG')

def load(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('elements', [])

class MapCtx:
    def __init__(self, lat0, lon0, mpt, w, h):
        self.lat0, self.lon0, self.mpt, self.w, self.h = lat0, lon0, mpt, w, h
        self.coslat = math.cos(math.radians(lat0))
        self.grid = [['#'] * w for _ in range(h)]
        self.roads = [[' '] * w for _ in range(h)]  # road strokes mask
        self.built = [[False] * w for _ in range(h)]  # tiles covered by a real building outline
        self.named_ways = []
        self.shops_osm = []
        self.trees = []

    rot = 0.0   # radians: map rotated so the main street grid is axis-aligned

    def to_tile(self, lat, lon):
        xm = (lon - self.lon0) * self.coslat * 111320.0
        ym = (self.lat0 - lat) * 110574.0
        if self.rot:
            c, s = math.cos(self.rot), math.sin(self.rot)
            xm, ym = xm * c - ym * s, xm * s + ym * c
        return xm / self.mpt + self.w / 2.0, ym / self.mpt + self.h / 2.0

    def geom_to_tiles(self, geom):
        return [self.to_tile(p['lat'], p['lon']) for p in geom]

def inside_poly(px, py, poly):
    n = len(poly)
    if n < 3: return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def raster_poly(ctx, rings, ch, allow_over_road=False):
    if not rings: return
    allpts = [p for r in rings for p in r]
    minx = max(0, int(math.floor(min(p[0] for p in allpts))) - 1)
    maxx = min(ctx.w - 1, int(math.ceil(max(p[0] for p in allpts))) + 1)
    miny = max(0, int(math.floor(min(p[1] for p in allpts))) - 1)
    maxy = min(ctx.h - 1, int(math.ceil(max(p[1] for p in allpts))) + 1)
    for ty in range(miny, maxy + 1):
        for tx in range(minx, maxx + 1):
            cx, cy = tx + 0.5, ty + 0.5
            cnt = 0
            for r in rings:
                if inside_poly(cx, cy, r): cnt += 1
            if cnt % 2 == 1:
                if not allow_over_road and ctx.roads[ty][tx] == 'R':
                    continue
                ctx.grid[ty][tx] = ch
                if ch == '#': ctx.built[ty][tx] = True

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0: return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def raster_stroke(ctx, pts, width_m, ch, is_road=True, min_tiles=2):
    if len(pts) < 2: return
    half = max(min_tiles / 2.0, (width_m / ctx.mpt) / 2.0)
    minx = max(0, int(math.floor(min(p[0] for p in pts) - half - 1)))
    maxx = min(ctx.w - 1, int(math.ceil(max(p[0] for p in pts) + half + 1)))
    miny = max(0, int(math.floor(min(p[1] for p in pts) - half - 1)))
    maxy = min(ctx.h - 1, int(math.ceil(max(p[1] for p in pts) + half + 1)))
    for ty in range(miny, maxy + 1):
        for tx in range(minx, maxx + 1):
            cx, cy = tx + 0.5, ty + 0.5
            for i in range(len(pts) - 1):
                d = seg_dist(cx, cy, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
                if d <= half:
                    ctx.grid[ty][tx] = ch
                    if is_road: ctx.roads[ty][tx] = 'R'
                    break

def way_tags(tags): return tags or {}

def is_poly_way(w):
    return w.get('tags', {}).get('area') == 'yes' or False

def closed_way(geom):
    if len(geom) < 4: return False
    p0, pn = geom[0], geom[-1]
    return abs(p0['lat'] - pn['lat']) < 1e-9 and abs(p0['lon'] - pn['lon']) < 1e-9

ROAD_WIDTHS = {
    'motorway': 18, 'trunk': 18, 'primary': 18, 'secondary': 15,
    'tertiary': 12, 'residential': 9, 'unclassified': 9,
    'living_street': 9, 'service': 6, 'pedestrian': 8,
    'footway': 3, 'path': 3, 'steps': 3, 'cycleway': 3,
}

def classify_highway(tags):
    hw = tags.get('highway')
    if not hw: return None
    if hw in ('construction', 'proposed', 'corridor', 'elevator', 'platform', 'bus_stop'): return None
    # pavements and crossings are mapped as separate paths next to roads; the road stroke covers them
    if hw in ('footway', 'path', 'cycleway') and (tags.get('footway') in ('sidewalk', 'crossing', 'traffic_island')
                                                   or tags.get('cycleway') in ('crossing', 'lane', 'track')
                                                   or tags.get('path') == 'sidewalk'):
        return None
    if tags.get('indoor') == 'yes' or tags.get('level', '0') not in ('0', ''): return None
    if tags.get('tunnel') == 'yes': return None
    w = ROAD_WIDTHS.get(hw, 6)
    if 'width' in tags:
        try: w = float(str(tags['width']).replace('m', '').strip())
        except: pass
    if tags.get('service') == 'alley':
        return ('.', 6, True)   # alleys: one car fits (min 2 tiles, see step5)
    if hw in ('footway', 'path', 'steps', 'cycleway'):
        wt = w / 4.0
        return ('a' if wt <= 1.0 else '.', w, False)
    if hw == 'pedestrian':
        return ('P', w, True)
    return ('.', w, True)

def add_named_ways(ctx, elements):
    for e in elements:
        if e.get('type') == 'way':
            t = e.get('tags') or {}
            if 'name' in t and 'highway' in t and 'geometry' in e:
                ctx.named_ways.append((t['name'], [ctx.to_tile(p['lat'], p['lon']) for p in e['geometry']]))

def step2_parks(ctx, elements):
    park_tags = lambda t: (
        t.get('leisure') in ('park', 'garden', 'playground') or
        t.get('landuse') in ('grass', 'recreation_ground') or
        (t.get('place') == 'square' and 'building' not in t)
    )
    for e in elements:
        if e.get('type') == 'way' and 'geometry' in e and park_tags(e.get('tags') or {}):
            if closed_way(e['geometry']):
                raster_poly(ctx, [ctx.geom_to_tiles(e['geometry'])], 'G')
        elif e.get('type') == 'relation' and park_tags(e.get('tags') or {}):
            outers, inners = [], []
            for m in e.get('members', []):
                if 'geometry' not in m: continue
                ring = ctx.geom_to_tiles(m['geometry'])
                if m.get('role') == 'inner': inners.append(ring)
                else: outers.append(ring)
            if outers:
                raster_poly(ctx, outers + inners, 'G')

def step3_pedestrian(ctx, elements):
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') != 'way' or 'geometry' not in e: continue
        is_ped = (
            (t.get('highway') == 'pedestrian' and t.get('area') == 'yes') or
            t.get('place') == 'square' or
            t.get('amenity') == 'marketplace' or
            (t.get('highway') == 'footway' and t.get('area') == 'yes')
        )
        if is_ped and closed_way(e['geometry']):
            raster_poly(ctx, [ctx.geom_to_tiles(e['geometry'])], 'P')

def step4_water(ctx, elements):
    water_poly_tags = lambda t: (
        t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or
        t.get('water') in ('river', 'canal')
    )
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') == 'way' and 'geometry' in e and water_poly_tags(t) and closed_way(e['geometry']):
            raster_poly(ctx, [ctx.geom_to_tiles(e['geometry'])], 'W')
        elif e.get('type') == 'relation' and water_poly_tags(t):
            outers, inners = [], []
            for m in e.get('members', []):
                if 'geometry' not in m: continue
                ring = ctx.geom_to_tiles(m['geometry'])
                if m.get('role') == 'inner': inners.append(ring)
                else: outers.append(ring)
            if outers: raster_poly(ctx, outers + inners, 'W')
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') != 'way' or 'geometry' not in e: continue
        ww = t.get('waterway')
        if ww == 'river':
            w = 8.0
            if 'width' in t:
                try: w = float(str(t['width']).replace('m', '').strip()) / ctx.mpt
                except: pass
            raster_stroke(ctx, ctx.geom_to_tiles(e['geometry']), w * ctx.mpt, 'W', is_road=False, min_tiles=4)
        elif ww == 'canal':
            raster_stroke(ctx, ctx.geom_to_tiles(e['geometry']), 4 * ctx.mpt, 'W', is_road=False, min_tiles=2)

def dominant_rotation(ctx, elements):
    """Length-weighted histogram of road directions (mod 90 deg) near the centre;
    returns the rotation that turns the strongest direction onto the x/y axes."""
    bins = [0.0] * 90
    rmax = max(ctx.w, ctx.h) * ctx.mpt * 0.6
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') != 'way' or 'geometry' not in e or not classify_highway(t): continue
        g = e['geometry']
        for i in range(len(g) - 1):
            x0 = (g[i]['lon'] - ctx.lon0) * ctx.coslat * 111320.0; y0 = (ctx.lat0 - g[i]['lat']) * 110574.0
            x1 = (g[i + 1]['lon'] - ctx.lon0) * ctx.coslat * 111320.0; y1 = (ctx.lat0 - g[i + 1]['lat']) * 110574.0
            if math.hypot((x0 + x1) / 2, (y0 + y1) / 2) > rmax: continue
            L = math.hypot(x1 - x0, y1 - y0)
            if L < 1: continue
            ang = math.degrees(math.atan2(y1 - y0, x1 - x0)) % 90.0
            bins[int(ang) % 90] += L
    # smooth over +-3 degrees and pick the peak
    sm = [sum(bins[(i + k) % 90] for k in range(-3, 4)) for i in range(90)]
    peak = max(range(90), key=lambda i: sm[i]) + 0.5
    if peak > 45: peak -= 90          # rotate by the smaller amount
    return -math.radians(peak)

def step5_roads(ctx, elements):
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') != 'way' or 'geometry' not in e: continue
        cls = classify_highway(t)
        if not cls: continue
        ch, wm, is_road = cls
        pts = ctx.geom_to_tiles(e['geometry'])
        # minimum widths so traffic works: real roads fit two cars side by side (3 tiles),
        # alleys/service roads and pedestrian streets one car (2), footpaths stay 1
        hw = t.get('highway')
        if ch == 'a': mt = 1
        elif hw in ('service', 'track', 'pedestrian') or ch == 'P': mt = 2
        else: mt = 3
        if ch == 'P':
            raster_stroke(ctx, pts, wm, 'P', is_road=True, min_tiles=mt)
        else:
            raster_stroke(ctx, pts, wm, ch, is_road=True, min_tiles=mt)
        if t.get('bridge') == 'yes':
            for ty in range(ctx.h):
                for tx in range(ctx.w):
                    pass  # handled by stroke overlay

def step6_buildings(ctx, elements):
    bld = lambda t: 'building' in t
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') == 'way' and 'geometry' in e and bld(t) and closed_way(e['geometry']):
            raster_poly(ctx, [ctx.geom_to_tiles(e['geometry'])], '#')
        elif e.get('type') == 'relation' and bld(t):
            outers, inners = [], []
            for m in e.get('members', []):
                if 'geometry' not in m: continue
                ring = ctx.geom_to_tiles(m['geometry'])
                if m.get('role') == 'inner': inners.append(ring)
                else: outers.append(ring)
            if outers: raster_poly(ctx, outers + inners, '#')

def step7_waterfront(ctx, dist=3):
    # unmapped land next to water is a walkable promenade, not a building
    g = ctx.grid
    for y in range(ctx.h):
        for x in range(ctx.w):
            if g[y][x] != '#' or ctx.built[y][x]: continue
            near = False
            for yy in range(max(0, y - dist), min(ctx.h, y + dist + 1)):
                for xx in range(max(0, x - dist), min(ctx.w, x + dist + 1)):
                    if g[yy][xx] == 'W': near = True; break
                if near: break
            if near: g[y][x] = 'G'

def step8_connectivity(ctx):
    w, h = ctx.w, ctx.h
    seen = [[False] * w for _ in range(h)]
    best = []
    for y in range(h):
        for x in range(w):
            if ctx.grid[y][x] in WALKABLE and not seen[y][x]:
                q = deque([(x, y)]); seen[y][x] = True; comp = []
                while q:
                    cx, cy = q.popleft(); comp.append((cx, cy))
                    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                        nx, ny = cx+dx, cy+dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and ctx.grid[ny][nx] in WALKABLE:
                            seen[ny][nx] = True; q.append((nx, ny))
                if len(comp) > len(best): best = comp
    keep = set(best)
    for y in range(h):
        for x in range(w):
            if ctx.grid[y][x] in WALKABLE and (x, y) not in keep:
                ctx.grid[y][x] = '#'

def step9_thin(ctx):
    w, h = ctx.w, ctx.h
    to_fix = []
    for y in range(1, h-1):
        for x in range(1, w-1):
            if ctx.grid[y][x] != '#': continue
            L = ctx.grid[y][x-1] in WALKABLE
            R = ctx.grid[y][x+1] in WALKABLE
            U = ctx.grid[y-1][x] in WALKABLE
            D = ctx.grid[y+1][x] in WALKABLE
            if L and R and not (U or D):
                to_fix.append((x, y))
            elif U and D and not (L or R):
                to_fix.append((x, y))
    for x, y in to_fix:
        ctx.grid[y][x] = '.'

def edge_openings(ctx):
    w, h = ctx.w, ctx.h
    runs = []
    def scan(side):
        cnt, run = 0, 0
        for i in range(w if side in ('top', 'bot') else h):
            x = i if side in ('top', 'bot') else (0 if side == 'left' else w-1)
            y = (0 if side == 'top' else h-1) if side in ('top','bot') else i
            if ctx.grid[y][x] in WALKABLE:
                run += 1
            else:
                if run >= 2: cnt += 1
                run = 0
        if run >= 2: cnt += 1
        return cnt
    for s in ('top', 'bot', 'left', 'right'):
        runs.append((s, scan(s)))
    total = sum(r[1] for r in runs)
    sides_ok = sum(1 for r in runs if r[1] > 0)
    if total >= 4 and sides_ok >= 3: return runs
    # extend nearest road to each missing edge
    for side, cnt in runs:
        if cnt > 0: continue
        # find nearest walkable tile to that edge
        best = None
        if side in ('top', 'bot'):
            edge_y = 0 if side == 'top' else h-1
            for y in range(h):
                for x in range(w):
                    if ctx.grid[y][x] in WALKABLE:
                        if best is None or abs(y - edge_y) < abs(best[1] - edge_y):
                            best = (x, y)
            if best:
                x, y = best
                step = -1 if side == 'bot' else 1
                cy = y
                while 0 <= cy < h:
                    for dx in (-1, 0):
                        nx = x + dx
                        if 0 <= nx < w: ctx.grid[cy][nx] = '.'
                    cy += step
        else:
            edge_x = 0 if side == 'left' else w-1
            for y in range(h):
                for x in range(w):
                    if ctx.grid[y][x] in WALKABLE:
                        if best is None or abs(x - edge_x) < abs(best[0] - edge_x):
                            best = (x, y)
            if best:
                x, y = best
                step = -1 if side == 'right' else 1
                cx = x
                while 0 <= cx < w:
                    for dy in (-1, 0):
                        ny = y + dy
                        if 0 <= ny < h: ctx.grid[ny][cx] = '.'
                    cx += step
    return runs

SHOP_TYPES = {
    'bakery': 'Bakery', 'supermarket': 'Supermarket', 'convenience': 'Corner Shop',
    'clothes': 'Clothes', 'shoes': 'Shoes', 'hairdresser': 'Hairdresser',
    'butcher': 'Butcher', 'greengrocer': 'Greengrocer', 'florist': 'Florist',
    'books': 'Bookshop', 'electronics': 'Electronics', 'mobile_phone': 'Phone Shop',
    'pharmacy': 'Pharmacy', 'bank': 'Bank', 'cafe': 'Cafe', 'restaurant': 'Restaurant',
    'bar': 'Bar', 'pub': 'Pub', 'fast_food': 'Fast Food', 'jewelry': 'Jeweller',
}
AMEN_SHOP = {'cafe', 'restaurant', 'bar', 'pub', 'bank', 'pharmacy', 'fast_food'}

def collect_shop_candidates(ctx, elements):
    cands = []
    def add(pt, name, kind):
        tx, ty = pt
        cands.append((tx, ty, name, kind))
    for e in elements:
        t = e.get('tags') or {}
        shop = t.get('shop')
        amen = t.get('amenity')
        if not (shop or amen in AMEN_SHOP): continue
        nm = t.get('name')
        if not nm:
            key = shop if shop else amen
            nm = SHOP_TYPES.get(key, 'Shop')
        street = t.get('addr:street')
        name = nm + (', ' + street if street else '')
        if e.get('type') == 'node' and 'lat' in e:
            tx, ty = ctx.to_tile(e['lat'], e['lon'])
            add((tx, ty), name, 'node')
        elif e.get('type') == 'way' and 'geometry' in e and closed_way(e['geometry']):
            pts = ctx.geom_to_tiles(e['geometry'])
            cx = sum(p[0] for p in pts[:-1]) / max(1, len(pts)-1)
            cy = sum(p[1] for p in pts[:-1]) / max(1, len(pts)-1)
            add((cx, cy), name, 'poly')

def nearest_street_name(ctx, x, y):
    best, bestd = None, 1e9
    for nm, pts in ctx.named_ways:
        for i in range(len(pts)-1):
            d = seg_dist(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
            if d < bestd: bestd, best = d, nm
    return best

def find_shop_front(ctx, cx, cy, max_dist=4):
    w, h = ctx.w, ctx.h
    best = None
    for dy in range(-max_dist, max_dist+1):
        for dx in range(-max_dist, max_dist+1):
            x, y = int(round(cx)) + dx, int(round(cy)) + dy
            if not (0 <= x < w-1 and 0 <= y < h): continue
            for ox, oy in ((1, 0), (0, 1)):
                x2, y2 = x + ox, y + oy
                if not (0 <= x2 < w and 0 <= y2 < h): continue
                if ctx.grid[y][x] == '#' and ctx.grid[y2][x2] == '#':
                    # check street front on same side
                    if ox == 1:
                        front = (y > 0 and ctx.grid[y-1][x] in WALKABLE) or (y > 0 and ctx.grid[y-1][x2] in WALKABLE)
                    else:
                        front = (x > 0 and ctx.grid[y][x-1] in WALKABLE) or (x > 0 and ctx.grid[y2][x-1] in WALKABLE)
                    if front:
                        d = abs(dx) + abs(dy)
                        if best is None or d < best[0]:
                            best = (d, x, y)
    return best

def step11_shops(ctx, elements):
    collect_shop_candidates(ctx, elements)
    w, h = ctx.w, ctx.h
    cands = []
    for cx, cy, name, kind in ctx.shops_osm:
        pass
    # redo: candidates from elements
    cands = []
    for e in elements:
        t = e.get('tags') or {}
        shop = t.get('shop'); amen = t.get('amenity')
        if not (shop or amen in AMEN_SHOP): continue
        nm = t.get('name')
        if not nm:
            key = shop if shop else amen
            nm = SHOP_TYPES.get(key, 'Shop')
        if 'addr:street' in t: nm += ', ' + t['addr:street']
        pts = None
        if e.get('type') == 'node' and 'lat' in e:
            pts = [ctx.to_tile(e['lat'], e['lon'])]
        elif e.get('type') == 'way' and 'geometry' in e and closed_way(e['geometry']):
            g = ctx.geom_to_tiles(e['geometry'])
            pts = [(sum(p[0] for p in g[:-1])/max(1,len(g)-1), sum(p[1] for p in g[:-1])/max(1,len(g)-1))]
        if pts:
            cands.append((pts[0][0], pts[0][1], nm))
    chosen = []
    placed = []
    cands.sort(key=lambda c: (c[0]-w/2)**2 + (c[1]-h/2)**2)
    for cx, cy, name in cands:
        if len(chosen) >= 22 and len(cands) > 22:
            if any((cx - px)**2 + (cy - py)**2 < 25 for px, py in placed):
                continue
        front = find_shop_front(ctx, cx, cy)
        if not front: continue
        _, fx, fy = front
        ok = True
        for sx, sy in placed:
            if abs(sx - fx) + abs(sy - fy) < 2:
                ok = False; break
        if not ok: continue
        if 'addr:street' not in name:
            street = nearest_street_name(ctx, fx, fy)
            if street: name = name + ', ' + street
        ctx.grid[fy][fx] = 'S'
        if fx+1 < w: ctx.grid[fy][fx+1] = 'S'
        chosen.append({'id': len(chosen)+1, 'name': name, 'x': fx, 'y': fy})
        placed.append((fx, fy))
        if len(chosen) >= 22: break
    osm_count = len(chosen)
    # generic fill
    generic_names = ['Cafe', 'Bakery', 'Newsagent', 'Corner Shop', 'Pub', 'Bookshop',
                     'Florist', 'Deli', 'Barber', 'Chemist', 'Phone Shop', 'Clothes']
    attempts = 0
    while len(chosen) < 16 and attempts < 2000:
        attempts += 1
        x = 1 + (attempts * 37) % (w - 3)
        y = 1 + (attempts * 53) % (h - 2)
        if ctx.grid[y][x] != '#': continue
        front = find_shop_front(ctx, x, y, 2)
        if not front: continue
        _, fx, fy = front
        if any(abs(sx-fx)+abs(sy-fy) < 2 for sx, sy in placed): continue
        nm = generic_names[len(chosen) % len(generic_names)]
        street = nearest_street_name(ctx, fx, fy)
        if street: nm += ', ' + street
        ctx.grid[fy][fx] = 'S'
        if fx+1 < w: ctx.grid[fy][fx+1] = 'S'
        chosen.append({'id': len(chosen)+1, 'name': nm, 'x': fx, 'y': fy})
        placed.append((fx, fy))
    ctx.shops = chosen
    return osm_count

def step12_plaza(ctx):
    w, h = ctx.w, ctx.h
    seen = [[False]*w for _ in range(h)]
    best = None; bestsize = 0; best_tiles = []
    for y in range(h):
        for x in range(w):
            if ctx.grid[y][x] == 'P' and not seen[y][x]:
                q = deque([(x, y)]); seen[y][x] = True; comp = []
                while q:
                    cx, cy = q.popleft(); comp.append((cx, cy))
                    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                        nx, ny = cx+dx, cy+dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and ctx.grid[ny][nx] == 'P':
                            seen[ny][nx] = True; q.append((nx, ny))
                if len(comp) > bestsize:
                    bestsize = len(comp); best_tiles = comp
    if bestsize >= 30 and best_tiles:
        cx = sum(t[0] for t in best_tiles) / bestsize
        cy = sum(t[1] for t in best_tiles) / bestsize
        bx = [t[0] for t in best_tiles]; by = [t[1] for t in best_tiles]
        r = max(5, int(math.ceil(max(max(bx)-min(bx), max(by)-min(by)) / 2.0)))
        px, py = min(best_tiles, key=lambda t: (t[0]-cx)**2 + (t[1]-cy)**2)
        return {'x': px, 'y': py, 'r': r}
    # most open junction
    bestscore, bestpt = -1, (w//2, h//2)
    for y in range(4, h-4):
        for x in range(4, w-4):
            sc = 0
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    if ctx.grid[y+dy][x+dx] in WALKABLE: sc += 1
            if sc > bestscore: bestscore, bestpt = sc, (x, y)
    px, py = bestpt
    for dy in range(-5, 6):
        for dx in range(-5, 6):
            if dx*dx + dy*dy <= 25:
                x, y = px+dx, py+dy
                if 0 <= x < w and 0 <= y < h and ctx.grid[y][x] == '.':
                    ctx.grid[y][x] = 'P'
    return {'x': px, 'y': py, 'r': 5}

def step13_trees(ctx, elements):
    w, h = ctx.w, ctx.h
    for e in elements:
        t = e.get('tags') or {}
        if e.get('type') == 'node' and t.get('natural') == 'tree' and 'lat' in e:
            tx, ty = ctx.to_tile(e['lat'], e['lon'])
            x, y = int(tx), int(ty)
            if 0 <= x < w and 0 <= y < h and ctx.grid[y][x] in WALKABLE:
                ctx.trees.append({'x': x, 'y': y})
                if len(ctx.trees) >= 200: break
    # edge of G areas
    for y in range(1, h-1):
        for x in range(1, w-1):
            if ctx.grid[y][x] == 'G' and (x + y) % 3 == 0:
                if any(ctx.grid[y+dy][x+dx] not in ('G',) for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))):
                    if len(ctx.trees) < 300:
                        ctx.trees.append({'x': x, 'y': y})

def write_js(ctx, name, mid, out):
    rows = [''.join(r) for r in ctx.grid]
    shops = ctx.shops[:22]
    lines = []
    lines.append('/* Generated by osm2map.py from OpenStreetMap data. (c) OpenStreetMap contributors, ODbL. */')
    lines.append('var REALMAPS = REALMAPS || [];')
    lines.append('REALMAPS.push({ id: %s, name: %s, attribution: "(c) OpenStreetMap contributors", w: %d, h: %d,' %
                 (json.dumps(mid), json.dumps(name), ctx.w, ctx.h))
    lines.append('  rows: [')
    for r in rows:
        lines.append('    ' + json.dumps(r) + ',')
    lines.append('  ],')
    lines.append('  shops: %s,' % json.dumps(shops))
    lines.append('  plaza: %s,' % json.dumps(ctx.plaza))
    lines.append('  decor: { trees: %s, terraces: [], metro: [] } });' % json.dumps(ctx.trees))
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('--name', required=True)
    ap.add_argument('--id', required=True)
    ap.add_argument('--lat', type=float, required=True)
    ap.add_argument('--lon', type=float, required=True)
    ap.add_argument('--mpt', type=float, default=4.0)
    ap.add_argument('--w', type=int, default=100)
    ap.add_argument('--h', type=int, default=64)
    ap.add_argument('--rotate', default='auto', help="'auto' (align the main street grid), 'none', or degrees")
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    elements = load(a.input)
    ctx = MapCtx(a.lat, a.lon, a.mpt, a.w, a.h)
    if a.rotate == 'auto':
        ctx.rot = dominant_rotation(ctx, elements)
    elif a.rotate != 'none':
        ctx.rot = math.radians(float(a.rotate))
    print('rotation: %.1f deg' % math.degrees(ctx.rot))
    add_named_ways(ctx, elements)

    step2_parks(ctx, elements)
    step3_pedestrian(ctx, elements)
    step4_water(ctx, elements)
    step5_roads(ctx, elements)
    step6_buildings(ctx, elements)
    step7_waterfront(ctx)
    step8_connectivity(ctx)
    step9_thin(ctx)
    openings = edge_openings(ctx)
    osm_shops = step11_shops(ctx, elements)
    ctx.plaza = step12_plaza(ctx)
    step13_trees(ctx, elements)
    write_js(ctx, a.name, a.id, a.out)

    # summary
    total = a.w * a.h
    counts = defaultdict(int)
    for row in ctx.grid:
        for c in row: counts[c] += 1
    print('Map: %s (%dx%d, %.1f m/tile)' % (a.name, a.w, a.h, a.mpt))
    for ch in ['.', 'a', 'P', 'G', '#', 'S', 'W']:
        print('  %s: %5d (%5.1f%%)' % (ch, counts[ch], 100.0 * counts[ch] / total))
    print('Shops: %d (OSM %d, generic %d)' % (len(ctx.shops), osm_shops, len(ctx.shops) - osm_shops))
    print('Plaza: x=%d y=%d r=%d' % (ctx.plaza['x'], ctx.plaza['y'], ctx.plaza['r']))
    print('Edge openings: %d sides, runs=%s' % (sum(1 for _, c in openings if c > 0), openings))
    print('Trees: %d' % len(ctx.trees))
    print('---')
    for row in ctx.grid:
        print(''.join(row))

if __name__ == '__main__':
    main()
