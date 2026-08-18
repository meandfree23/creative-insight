import json
import feedparser
import socket

# Set a global timeout so it doesn't hang forever!
socket.setdefaulttimeout(5)

with open("data/sources.json", "r") as f:
    sources = json.load(f)

print(f"Testing {len(sources)} sources...")
for s in sources:
    url = s.get("url")
    name = s.get("name")
    print(f"Testing {name}: {url}")
    try:
        feed = feedparser.parse(url)
        print(f"  -> SUCCESS ({len(feed.entries)} entries)")
    except Exception as e:
        print(f"  -> FAILED: {e}")
