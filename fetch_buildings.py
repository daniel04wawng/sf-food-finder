"""One-time fetch of OSM building footprints for downtown SF.

Queries Overpass API, converts each building way/relation to a lat/lng polygon
with a height (from tags, else estimated from levels, else 15m default), and
writes a compact JSON to web/public/buildings.json for the 3D city view.
"""

import json
import sys
import time
from pathlib import Path

import requests

OUT_PATH = Path(__file__).parent / "web" / "public" / "buildings.json"
OVERPASS = "https://overpass-api.de/api/interpreter"

# SF bounding box — covers downtown, SOMA, Mission, Financial, Hayes
# (tight bbox to keep building count manageable for browser rendering)
BBOX = (37.768, -122.425, 37.805, -122.385)  # south, west, north, east — tight over downtown/SOMA/FiDi/Mission

QUERY = f"""
[out:json][timeout:60];
(
  way["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body geom;
"""


def est_height(tags: dict) -> float:
    if "height" in tags:
        try:
            return float(tags["height"].rstrip("m").strip())
        except Exception:
            pass
    if "building:levels" in tags:
        try:
            return float(tags["building:levels"]) * 3.5
        except Exception:
            pass
    btype = tags.get("building", "")
    if btype in ("skyscraper",):
        return 120.0
    if btype in ("office", "commercial"):
        return 35.0
    if btype in ("apartments",):
        return 25.0
    if btype in ("residential", "house"):
        return 10.0
    return 15.0


def main():
    print(f"Fetching OSM buildings for bbox {BBOX}…")
    r = requests.post(
        OVERPASS,
        data={"data": QUERY},
        headers={"User-Agent": "SF-Free-Food-Finder/0.1 (daniel@abundant.ai)"},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    print(f"  got {len(data['elements'])} elements")

    def poly_area_m2(poly):
        # rough planar area in m² using equirectangular approx
        if len(poly) < 3:
            return 0.0
        lat0 = sum(p[0] for p in poly) / len(poly)
        mpd_lat = 111_320
        mpd_lng = 111_320 * abs(__import__("math").cos(__import__("math").radians(lat0)))
        pts = [(p[1] * mpd_lng, p[0] * mpd_lat) for p in poly]
        s = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            s += x1 * y2 - x2 * y1
        return abs(s) / 2.0

    out = []
    for el in data["elements"]:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom or len(geom) < 3:
            continue
        poly = [(p["lat"], p["lon"]) for p in geom]
        # Skip tiny sheds / garages — keeps render fast
        if poly_area_m2(poly) < 80:
            continue
        tags = el.get("tags", {})
        out.append([
            round(est_height(tags), 1),
            # Compact positional array; downstream will zip into pairs
            [[round(lat, 5), round(lng, 5)] for lat, lng in poly],
        ])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({"bbox": BBOX, "b": out}, separators=(",", ":")))
    print(f"✓ Wrote {len(out)} buildings → {OUT_PATH}")


if __name__ == "__main__":
    main()
