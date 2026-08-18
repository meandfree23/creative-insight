import os
import glob
import json
import subprocess

# 1. Time machine to July 29th
subprocess.run(["git", "checkout", "9f0b199", "--", "data/daily/"], check=True)
print("Restored data/daily/ to commit 9f0b199 (up to July 29th)")

# 2. Delete any files from July 30th onwards
files = glob.glob("data/daily/*.json")
for p in files:
    filename = os.path.basename(p)
    if filename >= "2026-07-30.json" and filename != "ver.1.json":
        os.remove(p)
        print(f"Removed {filename} to allow fresh research.")

# 3. Schema Migration
files = glob.glob("data/daily/*.json")
for p in files:
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    for key in ["topPicks", "popcorn", "items"]:
        if key in data and data[key]:
            for item in data[key]:
                if "title_ko" in item:
                    item["title_en"] = item.get("title", "")
                    item["title"] = item.get("title_ko", "")
                if "summary" in item and "content" not in item:
                    item["content"] = item["summary"]
                    
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
print("Schema migrated for all historical files.")
