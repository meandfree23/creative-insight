import json

NEW_SOURCES = [
    {"name": "Directors Notes", "url": "https://directorsnotes.com/feed/", "category": "FILM"},
    {"name": "Short of the Week", "url": "https://www.shortoftheweek.com/feed", "category": "FILM"},
    {"name": "Stash Magazine", "url": "https://www.stashmedia.tv/feed/", "category": "FILM"},
    {"name": "Nowness", "url": "https://www.nowness.com/feed", "category": "FILM"},
    {"name": "LBBOnline", "url": "https://www.lbbonline.com/news/rss", "category": "MARKETING"},
    {"name": "Ad Age", "url": "https://adage.com/rss", "category": "MARKETING"},
    {"name": "Campaign Live", "url": "https://www.campaignlive.com/rss/news", "category": "MARKETING"},
    {"name": "Branding in Asia", "url": "https://www.brandinginasia.com/feed/", "category": "MARKETING"},
    {"name": "Shots", "url": "https://shots.net/rss", "category": "FILM"},
    {"name": "Booooooom TV", "url": "https://tv.booooooom.com/feed/", "category": "FILM"}
]

with open("data/sources.json", "r", encoding="utf-8") as f:
    sources = json.load(f)

existing_urls = {s["url"] for s in sources}
added = 0
for s in NEW_SOURCES:
    if s["url"] not in existing_urls:
        sources.append(s)
        added += 1

with open("data/sources.json", "w", encoding="utf-8") as f:
    json.dump(sources, f, ensure_ascii=False, indent=2)

print(f"Added {added} new video & marketing sources to sources.json.")
