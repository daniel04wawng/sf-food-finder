"""Agentic event discovery.

Replaces scraper.py. Uses Exa (Twitter/X + web search) to find candidate events,
hands each page/tweet to Claude Haiku, and asks it to extract a structured
FoodEvent (or reject). Geocodes via Nominatim, filters to SF, writes to
web/public/events.json.

Env vars required:
  ANTHROPIC_API_KEY  — https://console.anthropic.com
  EXA_API_KEY        — https://dashboard.exa.ai
"""

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

# Reuse helpers from scraper
sys.path.insert(0, str(Path(__file__).parent))
from scraper import (  # noqa: E402
    SF_BBOX,
    OUT_PATH,
    CACHE_PATH,
    FOOD_EMOJI,
    UA,
    load_geocache,
    save_geocache,
    geocode,
    in_sf_bbox,
)

load_dotenv()

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY")
EXA_KEY = os.getenv("EXA_API_KEY")

if not ANTHROPIC_KEY:
    print("ERROR: set ANTHROPIC_API_KEY in .env", file=sys.stderr)
    sys.exit(1)
if not EXA_KEY:
    print("ERROR: set EXA_API_KEY in .env", file=sys.stderr)
    sys.exit(1)

from anthropic import Anthropic  # noqa: E402
from exa_py import Exa  # noqa: E402

client = Anthropic(api_key=ANTHROPIC_KEY)
exa = Exa(api_key=EXA_KEY)

MODEL = "claude-haiku-4-5"  # cheap + fast for extraction

# ---- Search queries -----------------------------------------------------

SF_EVENT_QUERIES = [
    "SF tech event free pizza tonight",
    "San Francisco AI hackathon free food",
    "SOMA happy hour free drinks tech meetup",
    "San Francisco AI happy hour this week",
    "SF startup dinner founders free",
    "SF breakfast AI founders meetup",
    "San Francisco tech meetup catered lunch",
    "Cerebral Valley event San Francisco free food",
    "lu.ma San Francisco AI event pizza",
]

TWITTER_QUERIES = [
    "SF free food tech event",
    "San Francisco pizza hackathon tonight",
    "AI happy hour SF free drinks",
    "SF founders dinner free",
    "San Francisco tech meetup catered",
]

# ---- Exa search wrappers ------------------------------------------------


def exa_search_web(query: str, num: int = 10):
    print(f"  🔎 web: {query!r}")
    try:
        r = exa.search_and_contents(
            query,
            num_results=num,
            type="neural",
            use_autoprompt=True,
            text={"max_characters": 3500},
            start_published_date=(
                datetime.now(timezone.utc) - timedelta(days=30)
            ).isoformat(),
        )
        return [
            {
                "url": x.url,
                "title": getattr(x, "title", "") or "",
                "text": getattr(x, "text", "") or "",
                "published": getattr(x, "published_date", None),
            }
            for x in r.results
        ]
    except Exception as e:
        print(f"    exa web error: {e}")
        return []


def exa_search_twitter(query: str, num: int = 10):
    print(f"  🐦 twitter: {query!r}")
    try:
        r = exa.search_and_contents(
            query,
            num_results=num,
            type="keyword",
            include_domains=["twitter.com", "x.com"],
            text={"max_characters": 2000},
            start_published_date=(
                datetime.now(timezone.utc) - timedelta(days=14)
            ).isoformat(),
        )
        return [
            {
                "url": x.url,
                "title": getattr(x, "title", "") or "",
                "text": getattr(x, "text", "") or "",
                "published": getattr(x, "published_date", None),
            }
            for x in r.results
        ]
    except Exception as e:
        print(f"    exa twitter error: {e}")
        return []


# ---- Claude extraction --------------------------------------------------

EXTRACTION_SYSTEM = """You are an expert at reading event descriptions (Luma, \
Eventbrite, tweets, Meetup, blog posts) and extracting structured data about \
tech events in San Francisco that offer FREE FOOD.

You will be given the text of a single page or tweet. Decide:

1. Is this a specific, upcoming, in-person tech/startup/AI/dev event in San \
   Francisco (not a past event, not remote/virtual)?
2. Does it explicitly mention free food, drinks, breakfast, lunch, dinner, \
   snacks, happy hour, pizza, tacos, coffee, catering, etc.?

If BOTH are yes, call the `submit_event` tool with all fields filled in.
If not, call the `reject` tool with a short reason.

Rules:
- Dates MUST be ISO-8601 with timezone (e.g. 2026-04-25T18:00:00-07:00).
- Use PT (-07:00 / -08:00 depending on DST) if no tz is specified and the \
  venue is in SF.
- `venue_address` should be a full geocodable address when possible. If only \
  a neighborhood is given (e.g. "SOMA"), use the neighborhood name + \
  "San Francisco, CA".
- Prefer specific `food_keywords` over generic ones (e.g. "pizza", "tacos", \
  "breakfast") rather than just "food". Also include one or two generic tags \
  if appropriate ("happy hour", "catered").
- If the event is vague ("some food served", "light refreshments"), still \
  extract it as long as free food is promised.
- Never invent data; if something is unknown, reject.
"""

TOOLS = [
    {
        "name": "submit_event",
        "description": "Submit a structured tech event with free food in SF.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title"},
                "venue_name": {"type": "string"},
                "venue_address": {
                    "type": "string",
                    "description": "Full street address if possible, else neighborhood + city",
                },
                "start": {
                    "type": "string",
                    "description": "ISO-8601 start datetime with timezone",
                },
                "end": {
                    "type": "string",
                    "description": "ISO-8601 end datetime with timezone",
                },
                "description": {"type": "string"},
                "food_keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Food/drink keywords mentioned, e.g. ['pizza','beer','happy hour']",
                },
            },
            "required": [
                "title",
                "venue_name",
                "venue_address",
                "start",
                "end",
                "description",
                "food_keywords",
            ],
        },
    },
    {
        "name": "reject",
        "description": "Reject this page — not a qualifying SF tech event with free food.",
        "input_schema": {
            "type": "object",
            "properties": {"reason": {"type": "string"}},
            "required": ["reason"],
        },
    },
]


def extract_with_claude(url: str, title: str, text: str):
    """Ask Claude to extract a structured event or reject."""
    if not text.strip():
        return None, "empty"
    user_msg = (
        f"URL: {url}\n"
        f"Title: {title}\n\n"
        f"--- PAGE TEXT ---\n{text[:4000]}"
    )
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=EXTRACTION_SYSTEM,
            tools=TOOLS,
            tool_choice={"type": "any"},
            messages=[{"role": "user", "content": user_msg}],
        )
    except Exception as e:
        return None, f"api error: {e}"

    for block in resp.content:
        if block.type == "tool_use":
            if block.name == "submit_event":
                return block.input, None
            elif block.name == "reject":
                return None, block.input.get("reason", "rejected")
    return None, "no tool call"


# ---- Build FoodEvent ----------------------------------------------------


def food_types_from_keywords(kw_list):
    out = []
    seen = set()
    for k in kw_list:
        k = k.lower().strip()
        label = FOOD_EMOJI.get(k) or f"• {k}"
        if label not in seen:
            seen.add(label)
            out.append(label)
    return out[:5]


def classify_source(url: str):
    u = url.lower()
    if "twitter.com" in u or "x.com" in u:
        return "X"
    if "lu.ma" in u or "luma.com" in u:
        return "Luma"
    if "eventbrite.com" in u:
        return "Eventbrite"
    if "meetup.com" in u:
        return "Meetup"
    if "cerebralvalley.ai" in u:
        return "Cerebral Valley"
    if "partiful.com" in u:
        return "Partiful"
    return "Luma"


def to_food_event(extracted: dict, url: str, geocache: dict):
    coords = geocode(extracted["venue_address"], geocache)
    if not coords:
        return None, "no geocode"
    lat, lng = coords
    if not in_sf_bbox(lat, lng):
        return None, f"outside SF bbox ({lat:.3f}, {lng:.3f})"

    source = classify_source(url)
    eid = hashlib.md5(url.encode()).hexdigest()[:10]
    return (
        {
            "id": f"{source.lower().replace(' ', '-')}-{eid}",
            "source": source,
            "title": extracted["title"][:120],
            "venue": extracted["venue_name"][:100],
            "lat": lat,
            "lng": lng,
            "start": extracted["start"],
            "end": extracted.get("end") or extracted["start"],
            "url": url,
            "foodTypes": food_types_from_keywords(extracted.get("food_keywords", [])),
            "keywords": extracted.get("food_keywords", [])[:10],
            "description": (extracted.get("description") or "")[:500],
        },
        None,
    )


# ---- Main ---------------------------------------------------------------


def main():
    print("🤖 agentic discovery run\n")

    # 1. Gather candidates
    candidates: list[dict] = []
    print("=== Web search ===")
    for q in SF_EVENT_QUERIES:
        candidates.extend(exa_search_web(q, num=8))
        time.sleep(0.5)
    print(f"\n=== Twitter / X search ===")
    for q in TWITTER_QUERIES:
        candidates.extend(exa_search_twitter(q, num=8))
        time.sleep(0.5)

    # Dedupe by URL
    seen = set()
    unique = []
    for c in candidates:
        u = c["url"].split("?")[0]
        if u in seen:
            continue
        seen.add(u)
        unique.append(c)
    print(f"\nTotal candidates after dedupe: {len(unique)}")

    # 2. Extract per candidate
    geocache = load_geocache()
    events = []
    for i, c in enumerate(unique, 1):
        url = c["url"]
        print(f"[{i}/{len(unique)}] {url[:70]}", end=" ")
        extracted, err = extract_with_claude(url, c.get("title", ""), c.get("text", ""))
        if err:
            print(f"— {err[:50]}")
            continue
        ev, err = to_food_event(extracted, url, geocache)
        if err:
            print(f"— {err[:50]}")
            continue
        print(f"✓ {ev['title'][:40]} ({', '.join(ev['foodTypes'][:2])})")
        events.append(ev)
        if i % 8 == 0:
            save_geocache(geocache)

    save_geocache(geocache)

    # 3. Dedupe by (title, start)
    dedup = {}
    for e in events:
        k = (e["title"].lower(), e["start"][:16])
        if k not in dedup:
            dedup[k] = e
    events = sorted(dedup.values(), key=lambda e: e["start"])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(events, indent=2, ensure_ascii=False))
    print(f"\n✓ Wrote {len(events)} events → {OUT_PATH}")


if __name__ == "__main__":
    main()
