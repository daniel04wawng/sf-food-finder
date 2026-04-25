"""SF Free Food Finder scraper.

Collects event URLs from Luma, Cerebral Valley, Eventbrite, and Meetup,
parses JSON-LD structured data on each event page, filters to SF tech
events with free food, geocodes via Nominatim, and writes the result to
web/public/events.json in the schema the frontend expects.
"""

import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

OUT_PATH = Path(__file__).parent / "web" / "public" / "events.json"
CACHE_PATH = Path(__file__).parent / ".geocache.json"

NOMINATIM = "https://nominatim.openstreetmap.org/search"
UA = "SF-Free-Food-Finder/0.1 (contact: daniel@abundant.ai)"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

SF_BBOX = {"min_lat": 37.70, "max_lat": 37.83, "min_lng": -122.53, "max_lng": -122.35}

FOOD_EMOJI = {
    "pizza": "🍕 pizza",
    "tacos": "🌮 tacos",
    "burritos": "🌯 burritos",
    "sushi": "🍣 sushi",
    "ramen": "🍜 ramen",
    "noodle": "🍜 noodles",
    "boba": "🧋 boba",
    "bubble tea": "🧋 boba",
    "coffee": "☕ coffee",
    "espresso": "☕ espresso",
    "beer": "🍺 beer",
    "wine": "🍷 wine",
    "cocktails": "🍸 cocktails",
    "drinks": "🥤 drinks",
    "free drinks": "🥤 drinks",
    "lunch": "🥗 lunch",
    "dinner": "🍽️ dinner",
    "breakfast": "🥐 breakfast",
    "brunch": "🥞 brunch",
    "snacks": "🍿 snacks",
    "sandwiches": "🥪 sandwiches",
    "bagels": "🥯 bagels",
    "donuts": "🍩 donuts",
    "pastries": "🥐 pastries",
    "cookies": "🍪 cookies",
    "ice cream": "🍦 ice cream",
    "appetizers": "🧀 apps",
    "refreshments": "🥤 refreshments",
    "happy hour": "🍺 happy hour",
    "hackathon": "💻 hackathon meals",
    "catered": "🍴 catered",
    "food truck": "🚚 food truck",
    "buffet": "🍴 buffet",
    "bbq": "🍖 bbq",
    "food": "🍱 food",
    "meal": "🍱 meal",
    "meals": "🍱 meals",
    "complimentary": "🎁 complimentary",
}

REMOTE_WORDS = ["remote", "virtual", "online event", "zoom", "webinar", "livestream"]

# Generic keywords that are too common to trust on page chrome; only count if in title+description.
WEAK_KEYWORDS = {"food", "meal", "meals", "snacks", "refreshments", "appetizers",
                 "complimentary", "drinks", "free drinks"}


def load_keywords():
    with open(Path(__file__).parent / "keywords.txt") as f:
        return [ln.strip().lower() for ln in f if ln.strip() and not ln.startswith("#")]


def load_geocache():
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_geocache(cache):
    CACHE_PATH.write_text(json.dumps(cache, indent=2))


def fetch(url, retries=2):
    for i in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.ok:
                return r
        except Exception as e:
            print(f"  fetch error: {e}", file=sys.stderr)
        time.sleep(1.5)
    return None


def parse_jsonld(soup):
    """Find the first Event-typed entry in any JSON-LD script."""
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.text or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except Exception:
            try:
                data = json.loads(raw.strip().rstrip(",").rstrip(";"))
            except Exception:
                continue
        items = data if isinstance(data, list) else [data]
        more = []
        for it in items:
            if isinstance(it, dict) and "@graph" in it:
                more.extend(it["@graph"])
        for it in items + more:
            if not isinstance(it, dict):
                continue
            t = it.get("@type", "")
            if isinstance(t, list):
                t_str = ",".join(str(x) for x in t)
            else:
                t_str = str(t)
            if "Event" in t_str:
                return it
    return None


def extract_location(ld):
    """Return (venue_name, address_string, coords_or_None)."""
    loc = ld.get("location") if ld else None
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    if not loc:
        return None, None, None
    if isinstance(loc, str):
        return loc, loc, None
    if isinstance(loc, dict):
        name = loc.get("name") or ""
        # Embedded geo coordinates (Luma provides these)
        coords = None
        geo = loc.get("geo")
        if isinstance(geo, dict):
            try:
                coords = (float(geo["latitude"]), float(geo["longitude"]))
            except Exception:
                coords = None
        if coords is None and "latitude" in loc and "longitude" in loc:
            try:
                coords = (float(loc["latitude"]), float(loc["longitude"]))
            except Exception:
                coords = None

        addr = loc.get("address")
        if isinstance(addr, dict):
            parts = [
                addr.get("streetAddress"),
                addr.get("addressLocality"),
                addr.get("addressRegion"),
                addr.get("postalCode"),
            ]
            full = ", ".join(p for p in parts if p)
            return name or full, full or name, coords
        if isinstance(addr, str):
            return name or addr, addr, coords
        return name, name, coords
    return None, None, None


def geocode(address, cache):
    if not address:
        return None
    key = address.strip().lower()
    if key in cache:
        v = cache[key]
        return tuple(v) if v else None
    try:
        r = requests.get(
            NOMINATIM,
            params={"q": address, "format": "json", "limit": 1, "countrycodes": "us"},
            headers={"User-Agent": UA},
            timeout=10,
        )
        time.sleep(1.1)  # Nominatim policy: max 1 req/sec
        if r.ok:
            j = r.json()
            if j:
                result = (float(j[0]["lat"]), float(j[0]["lon"]))
                cache[key] = list(result)
                return result
    except Exception as e:
        print(f"  geocode error: {e}", file=sys.stderr)
    cache[key] = None
    return None


def in_sf_bbox(lat, lng):
    return (
        SF_BBOX["min_lat"] < lat < SF_BBOX["max_lat"]
        and SF_BBOX["min_lng"] < lng < SF_BBOX["max_lng"]
    )


def is_remote(text):
    t = text.lower()
    return any(w in t for w in REMOTE_WORDS)


def match_food(text, keywords):
    t = text.lower()
    matched = []
    for k in keywords:
        if k in t and k not in matched:
            matched.append(k)
    return matched


def food_types_from_keywords(matched):
    types = []
    seen = set()
    for k in matched:
        label = FOOD_EMOJI.get(k, f"• {k}")
        if label not in seen:
            seen.add(label)
            types.append(label)
    return types[:5]


def extract_eventbrite(html, page_text, url, keywords, source):
    """Eventbrite embeds data as inline JSON in script tags (not JSON-LD)."""

    def grab(pattern, text=html):
        m = re.search(pattern, text)
        return m.group(1) if m else None

    start = grab(r'"startDate":"([^"]+)"')
    end = grab(r'"endDate":"([^"]+)"') or start
    name = grab(r'"name":"([^"]+)","summary":')  # event name typically precedes summary
    summary = grab(r'"summary":"([^"]+)"') or ""
    venue_name = grab(r'"venue":\{"id":"\d+","name":"([^"]+)"')
    lat = grab(r'"venue":\{[^}]*"latitude":"([\d.\-]+)"')
    lng = grab(r'"venue":\{[^}]*"longitude":"([\d.\-]+)"')
    is_online = grab(r'"isOnline":(true|false)')

    if not (start and name and lat and lng):
        return None
    if is_online == "true":
        return None

    try:
        lat_f, lng_f = float(lat), float(lng)
    except Exception:
        return None
    if not in_sf_bbox(lat_f, lng_f):
        return None

    # Unescape basic JSON escapes
    def unesc(s):
        return s.encode().decode("unicode_escape") if s else s

    title = unesc(name)
    description = unesc(summary)
    # Only match keywords in the actual event text, not the page chrome.
    matched = match_food(f"{title}\n{description}", keywords)
    if not matched:
        return None

    eid = hashlib.md5(url.encode()).hexdigest()[:10]
    return {
        "id": f"{source.lower()}-{eid}",
        "source": source,
        "title": title[:120],
        "venue": (unesc(venue_name) or "")[:100],
        "lat": lat_f,
        "lng": lng_f,
        "start": start,
        "end": end,
        "url": url,
        "foodTypes": food_types_from_keywords(matched),
        "keywords": matched[:10],
        "description": description[:500],
    }


def ld_to_event(ld, page_text, source, url, keywords, geocache):
    if not ld:
        return None
    title = (ld.get("name") or "").strip()
    start = ld.get("startDate")
    end = ld.get("endDate") or start
    if not title or not start:
        return None

    venue_name, address, coords = extract_location(ld)

    description = ld.get("description") or ""
    if isinstance(description, list):
        description = " ".join(str(x) for x in description)

    # Trust JSON-LD attendance mode; fall back to heuristic on title+desc only
    attendance = str(ld.get("eventAttendanceMode") or "")
    if "OnlineEventAttendanceMode" in attendance:
        return None
    if "OfflineEventAttendanceMode" not in attendance and is_remote(f"{title}\n{description}"):
        return None

    # Match weak keywords only in structured text; strong keywords can hit page_text.
    structured = f"{title}\n{description}".lower()
    chrome = page_text.lower()
    matched = []
    for k in keywords:
        if k in structured:
            if k not in matched:
                matched.append(k)
        elif k not in WEAK_KEYWORDS and k in chrome:
            if k not in matched:
                matched.append(k)
    if not matched:
        return None

    # Prefer embedded geo coords; fall back to Nominatim geocoding on address
    if not coords and address and address.lower() != "register to see address":
        coords = geocode(address, geocache)
    if not coords:
        return None
    lat, lng = coords
    if not in_sf_bbox(lat, lng):
        return None

    eid = hashlib.md5(url.encode()).hexdigest()[:10]
    return {
        "id": f"{source.lower().replace(' ', '-')}-{eid}",
        "source": source,
        "title": title[:120],
        "venue": (venue_name or address)[:100],
        "lat": lat,
        "lng": lng,
        "start": start,
        "end": end,
        "url": url,
        "foodTypes": food_types_from_keywords(matched),
        "keywords": matched[:10],
        "description": description[:500],
    }


# ---------- Discovery per source ----------


def discover_luma():
    urls = set()
    r = fetch("https://lu.ma/sf")
    if not r:
        return urls
    soup = BeautifulSoup(r.text, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/") and "?" not in href and len(href.split("/")) == 2 and href not in ("/", "/discover", "/signin"):
            urls.add("https://lu.ma" + href)
    return urls


def discover_eventbrite():
    urls = set()
    base_urls = [
        "https://www.eventbrite.com/d/ca--san-francisco/free--tech--events/",
        "https://www.eventbrite.com/d/ca--san-francisco/free--events/",
        "https://www.eventbrite.com/d/ca--san-francisco/free--business--events/",
        "https://www.eventbrite.com/d/ca--san-francisco/free--networking--events/",
    ]
    for u in base_urls:
        for page in range(1, 3):  # first 2 pages
            target = u if page == 1 else f"{u}?page={page}"
            r = fetch(target)
            if not r:
                continue
            soup = BeautifulSoup(r.text, "lxml")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/e/" in href and "eventbrite.com" in href:
                    urls.add(href.split("?")[0])
    return urls


def discover_partiful():
    urls = set()
    r = fetch("https://partiful.com/discover")
    if not r:
        return urls
    for m in re.finditer(r'href="(/e/[a-zA-Z0-9_-]+)"', r.text):
        urls.add("https://partiful.com" + m.group(1))
    return urls


def discover_meetup():
    urls = set()
    r = fetch("https://www.meetup.com/find/us--ca--san-francisco/technology/")
    if not r:
        return urls
    soup = BeautifulSoup(r.text, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/events/" in href and "meetup.com" in href:
            urls.add(href.split("?")[0])
    return urls


def discover_cerebral_valley():
    # CV requires JS; we use Selenium if available, else skip.
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.chrome.options import Options
        from webdriver_manager.chrome import ChromeDriverManager
    except Exception:
        print("  selenium not available, skipping Cerebral Valley")
        return set()

    urls = set()
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument(f"user-agent={HEADERS['User-Agent']}")
    try:
        driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
        driver.get("https://cerebralvalley.ai/events?location=SF+%26+Bay+Area")
        time.sleep(3)
        soup = BeautifulSoup(driver.page_source, "lxml")
        driver.quit()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if any(s in href for s in ["lu.ma", "luma.com", "eventbrite.com", "partiful.com"]):
                urls.add(href)
    except Exception as e:
        print(f"  cerebral valley selenium error: {e}")
    return urls


# ---------- Main ----------


def classify_source(url):
    if "lu.ma" in url or "luma.com" in url:
        return "Luma"
    if "eventbrite.com" in url:
        return "Eventbrite"
    if "meetup.com" in url:
        return "Meetup"
    if "cerebralvalley.ai" in url:
        return "Cerebral Valley"
    if "partiful.com" in url:
        return "Partiful"
    return "Luma"  # default


def main():
    keywords = load_keywords()
    print(f"Loaded {len(keywords)} food keywords")

    print("\n=== Discovering event URLs ===")
    discovered = {
        "Luma": discover_luma(),
        "Eventbrite": discover_eventbrite(),
        "Meetup": discover_meetup(),
        "Cerebral Valley": discover_cerebral_valley(),
        "Partiful": discover_partiful(),
    }
    for src, urls in discovered.items():
        print(f"  {src}: {len(urls)} urls")

    # Flatten, dedupe
    all_urls = []
    seen = set()
    for src, urls in discovered.items():
        for u in urls:
            if u in seen:
                continue
            seen.add(u)
            # Source attribution: if CV link points to luma/eventbrite, keep as that source
            true_src = src if src in ("Luma", "Eventbrite", "Meetup", "Partiful") else classify_source(u)
            all_urls.append((true_src, u))

    print(f"\n{len(all_urls)} unique events to check")

    geocache = load_geocache()
    events = []

    for i, (source, url) in enumerate(all_urls, 1):
        print(f"[{i}/{len(all_urls)}] {source:15s} {url[:70]}", end=" ")
        r = fetch(url)
        if not r:
            print("✗ fetch")
            continue
        soup = BeautifulSoup(r.text, "lxml")
        page_text = soup.get_text(" ", strip=True)
        ev = None
        if source == "Eventbrite":
            ev = extract_eventbrite(r.text, page_text, url, keywords, source)
        if ev is None:
            ld = parse_jsonld(soup)
            ev = ld_to_event(ld, page_text, source, url, keywords, geocache)
        if ev:
            print(f"✓ {ev['title'][:40]} ({', '.join(ev['foodTypes'][:2])})")
            events.append(ev)
        else:
            print("—")
        # Persist cache periodically
        if i % 10 == 0:
            save_geocache(geocache)

    save_geocache(geocache)

    # Dedupe by (title, start)
    unique = {}
    for e in events:
        k = (e["title"], e["start"])
        if k not in unique:
            unique[k] = e
    events = list(unique.values())
    events.sort(key=lambda e: e["start"])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(events, indent=2, ensure_ascii=False))

    print(f"\n✓ Wrote {len(events)} events → {OUT_PATH}")


if __name__ == "__main__":
    main()
