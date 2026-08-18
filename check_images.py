import os
import json
import glob
from collections import Counter

DAILY_DIR = "/Users/kk/Documents/Antigravity_Data/creative-insight-backfill/repo/data/daily"
images = []
for p in glob.glob(os.path.join(DAILY_DIR, "*.json")):
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        picks = (data.get("topPicks") or []) + (data.get("popcorn") or []) + (data.get("items") or [])
        for item in picks:
            if item.get("image"):
                images.append(item["image"])
    except Exception:
        pass

c = Counter(images)
print(f"Total items with images: {len(images)}")
print("Most common images:")
for img, count in c.most_common(10):
    print(f"{count} times: {img}")
