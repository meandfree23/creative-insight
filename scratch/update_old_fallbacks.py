import os
import json
import glob
import sys

# Add current directory to path to import fetch_ideas
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fetch_ideas

DAILY_DIR = "data/daily"

updated_count = 0
file_count = 0

for p in glob.glob(os.path.join(DAILY_DIR, "*.json")):
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    changed = False
    
    for key in ["topPicks", "popcorn", "items"]:
        if key in data:
            for item in data[key]:
                img = item.get("image", "")
                # If image is missing or is one of the old unsplash fallback photos
                if not img or img.startswith("https://images.unsplash.com/photo-"):
                    domain = item.get("domain", "DESIGN")
                    source = item.get("source", "Creative Insight")
                    new_img = fetch_ideas.get_smart_fallback_image(domain, source)
                    item["image"] = new_img
                    changed = True
                    updated_count += 1
                    
    if changed:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        file_count += 1
        print(f"Updated {p}")

print(f"\nDone! Replaced {updated_count} unusable images across {file_count} daily files.")
