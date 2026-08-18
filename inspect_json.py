import json

with open("data/daily/2026-07-28.json", "r") as f:
    data = json.load(f)

print("topPicks:")
for item in data.get("topPicks", []):
    print("  ", item.get("title_ko"), "->", item.get("image"))

print("popcorn:")
for item in data.get("popcorn", []):
    print("  ", item.get("title_ko"), "->", item.get("image"))
