import json
with open("data/daily/2026-07-31.json", "r") as f:
    data = json.load(f)
for section in ["topPicks", "popcorn"]:
    for item in data.get(section, []):
        print(f"{item.get('title_ko')} -> {item.get('image')}")
