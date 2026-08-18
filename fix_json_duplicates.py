import json
import glob
import os

DAILY_DIR = "/Users/kk/Documents/Antigravity_Data/creative-insight-backfill/repo/data/daily"

def deduplicate_list(items, seen):
    unique = []
    for item in items:
        img = item.get("image", "").strip()
        if img:
            if img in seen:
                continue
            seen.add(img)
        unique.append(item)
    return unique

for p in glob.glob(os.path.join(DAILY_DIR, "*.json")):
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    changed = False
    seen = set()
    
    if "topPicks" in data:
        orig_len = len(data["topPicks"])
        data["topPicks"] = deduplicate_list(data["topPicks"], seen)
        if len(data["topPicks"]) != orig_len:
            changed = True
            
    if "popcorn" in data:
        orig_len = len(data["popcorn"])
        data["popcorn"] = deduplicate_list(data["popcorn"], seen)
        if len(data["popcorn"]) != orig_len:
            changed = True
            
    if changed:
        print(f"Fixed duplicates in {os.path.basename(p)}")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
