import json

NEW_SOURCES = [
    {"name": "Reddit /r/Design", "url": "https://www.reddit.com/r/Design/top/.rss?t=day", "category": "DESIGN"},
    {"name": "Reddit /r/CreativeCoding", "url": "https://www.reddit.com/r/CreativeCoding/top/.rss?t=day", "category": "TECH_ART"},
    {"name": "Reddit /r/web_design", "url": "https://www.reddit.com/r/web_design/top/.rss?t=day", "category": "UIUX"},
    {"name": "Reddit /r/graphic_design", "url": "https://www.reddit.com/r/graphic_design/top/.rss?t=day", "category": "DESIGN"},
    {"name": "Medium Design Tag", "url": "https://medium.com/feed/tag/design", "category": "DESIGN"},
    {"name": "Medium UI/UX Tag", "url": "https://medium.com/feed/tag/ui-ux", "category": "UIUX"},
    {"name": "Medium Branding Tag", "url": "https://medium.com/feed/tag/branding", "category": "BRANDING"},
    {"name": "Medium Creative Coding Tag", "url": "https://medium.com/feed/tag/creative-coding", "category": "TECH_ART"},
    {"name": "UX Collective", "url": "https://uxdesign.cc/feed", "category": "UIUX"},
    {"name": "Muzli (Medium)", "url": "https://medium.com/feed/muzli-design-inspiration", "category": "UIUX"},
    {"name": "Vimeo Staff Picks", "url": "https://vimeo.com/channels/staffpicks/videos/rss", "category": "ART"},
    {"name": "Substack - Dense Discovery", "url": "https://www.densediscovery.com/feed", "category": "TECH_ART"},
    {"name": "Sidebar.io", "url": "https://sidebar.io/feed.xml", "category": "DESIGN"},
    {"name": "A List Apart", "url": "https://alistapart.com/main/feed/", "category": "UIUX"}
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

print(f"Added {added} new community sources to sources.json.")
