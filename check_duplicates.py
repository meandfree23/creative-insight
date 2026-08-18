import os
import json
import glob
from collections import defaultdict

DAILY_DIR = "/Users/kk/Documents/Antigravity_Data/creative-insight-backfill/repo/data/daily"
image_to_files = defaultdict(list)
for p in glob.glob(os.path.join(DAILY_DIR, "*.json")):
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        picks = (data.get("topPicks") or []) + (data.get("popcorn") or []) + (data.get("items") or [])
        for item in picks:
            if item.get("image"):
                image_to_files[item["image"]].append(os.path.basename(p))
    except Exception:
        pass

for img, files in image_to_files.items():
    if len(files) > 1:
        print(f"{img}: {files}")
