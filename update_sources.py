import json
import os

SOURCES_FILE = "/Users/kk/Documents/Antigravity_Data/creative-insight-backfill/repo/data/sources.json"

with open(SOURCES_FILE, "r") as f:
    sources = json.load(f)

# Update existing sources with categories based on URL/name heuristics
for s in sources:
    url = s.get("url", "").lower()
    name = s.get("name", "").lower()
    
    if "arch" in url or "arch" in name or "space" in url:
        s["category"] = "SPATIAL"
    elif "film" in url or "film" in name or "video" in url or "motion" in url or "nowness" in url or "stash" in url or "vimeo" in url or "dailymotion" in url:
        s["category"] = "MOTION_FILM"
    elif "photo" in url or "photo" in name or "lens" in url:
        s["category"] = "PHOTOGRAPHY"
    elif "art" in url or "art" in name or "juxtapoz" in url or "colossal" in url or "booooooom" in url or "gallery" in url:
        s["category"] = "ART"
    else:
        s["category"] = "DESIGN"

# Add new spatial and expansion sources
new_sources = [
    # Spatial Design / Experiential
    {"name": "Dezeen", "url": "https://www.dezeen.com/feed/", "category": "SPATIAL"},
    {"name": "ArchDaily", "url": "https://www.archdaily.com/rss.xml", "category": "SPATIAL"},
    {"name": "Frame Web", "url": "https://frameweb.com/rss", "category": "SPATIAL"},
    {"name": "Yellowtrace", "url": "https://www.yellowtrace.com.au/feed/", "category": "SPATIAL"},
    {"name": "Retail Design Blog", "url": "https://retaildesignblog.net/feed/", "category": "SPATIAL"},
    
    # UI/UX & Digital Product
    {"name": "Smashing Magazine", "url": "https://www.smashingmagazine.com/feed", "category": "UIUX"},
    {"name": "UX Collective", "url": "https://uxdesign.cc/feed", "category": "UIUX"},
    
    # Branding & Advertising
    {"name": "Adweek", "url": "https://www.adweek.com/feed/", "category": "BRANDING"},
    {"name": "UnderConsideration: Brand New", "url": "https://feeds.feedburner.com/brandnew", "category": "BRANDING"},
    {"name": "The Drum", "url": "https://www.thedrum.com/rss", "category": "BRANDING"},
    
    # Tech Art & Generative AI
    {"name": "Creative Applications", "url": "https://www.creativeapplications.net/feed/", "category": "TECH_ART"},
    
    # 3D & Motion
    {"name": "80 Level", "url": "https://80.lv/feed/", "category": "MOTION_FILM"}
]

# Deduplicate by URL
existing_urls = {s["url"] for s in sources}
for ns in new_sources:
    if ns["url"] not in existing_urls:
        sources.append(ns)
        existing_urls.add(ns["url"])

with open(SOURCES_FILE, "w") as f:
    json.dump(sources, f, indent=4)
print(f"Updated sources.json with {len(sources)} total feeds.")
