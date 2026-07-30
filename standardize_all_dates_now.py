import os
import glob
import json
import time
from openai import OpenAI

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
REPO_DIR = "/Users/kk/Documents/Antigravity_Data/creative-insight-backfill/repo"
DAILY_DIR = os.path.join(REPO_DIR, "data", "daily")

json_files = sorted(glob.glob(os.path.join(DAILY_DIR, "*.json")))

print(f"Auditing {len(json_files)} daily files for standardization (10-12 topPicks, 3 popcorn)...")

targets = []
for p in json_files:
    fname = os.path.basename(p)
    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
    tp_len = len(d.get("topPicks", []))
    pop_len = len(d.get("popcorn", []))
    if tp_len < 10 or pop_len < 3:
        targets.append((p, fname, tp_len, pop_len))

print(f"Found {len(targets)} files needing top-up.")
for t in targets:
    print(f"  Target: {t[1]} (current topPicks: {t[2]}, popcorn: {t[3]})")

if targets:
    # Load candidate pool from RSS sources directly using feedparser
    import feedparser
    with open(os.path.join(REPO_DIR, "data", "sources.json"), "r", encoding="utf-8") as sf:
        sources = json.load(sf)
    
    print("Fetching fresh candidate pool from RSS sources...")
    candidates = []
    for src in sources[:40]: # top 40 sources for quick rich pool
        url = src.get("url", "")
        if not url: continue
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:10]:
                link = getattr(entry, "link", "")
                title = getattr(entry, "title", "")
                summary = getattr(entry, "summary", getattr(entry, "description", ""))
                if title and link:
                    candidates.append({
                        "title": title,
                        "link": link,
                        "summary": summary,
                        "source": src.get("name", "Unknown"),
                        "domain": src.get("category", "DESIGN")
                    })
        except Exception:
            pass
    
    print(f"Candidate pool size: {len(candidates)} articles.")
    
    for filepath, fname, tp_c, pop_c in targets:
        date_str = fname.replace(".json", "")
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        need_tp = 10 - tp_c if tp_c < 10 else 0
        need_pop = 3 - pop_c if pop_c < 3 else 0
        
        print(f"Standardizing {fname}: adding {need_tp} topPicks, {need_pop} popcorn...")
        
        prompt = f"""
        Article candidates:
        {json.dumps(candidates[:40], ensure_ascii=False)}
        
        Target date: {date_str}
        
        Generate {need_tp if need_tp > 0 else 2} topPicks and {need_pop if need_pop > 0 else 1} popcorn items.
        
        Format JSON:
        {{
          "topPicks": [
            {{
              "title_ko": "Korean translated title",
              "summary": "2-sentence Korean summary",
              "url": "Article URL",
              "source": "Source Name",
              "domain": "DESIGN",
              "category": "리뷰",
              "creator_name": "Specific real master/creator name",
              "creator_insight": "Authentic creator quote in Korean",
              "tags": ["tag1", "tag2"],
              "execution_techniques": ["#BiophilicForm"],
              "why": "Curator view in Korean",
              "social_proof": "",
              "depth": 0.95,
              "image": "https://picsum.photos/800/600",
              "pub_date": "{date_str}T08:00:00.000000"
            }}
          ],
          "popcorn": [
            {{
              "title_ko": "Korean title for popcorn",
              "summary": "1-sentence summary",
              "url": "Article URL",
              "source": "Source Name",
              "domain": "POPCORN",
              "category": "바이럴",
              "tags": ["pop"],
              "why": "Why viral",
              "depth": 0.5,
              "image": "https://picsum.photos/800/600",
              "pub_date": "{date_str}T08:00:00.000000"
            }}
          ]
        }}
        """
        
        try:
            res = client.chat.completions.create(
                model="gpt-4o-2024-08-06",
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7
            )
            rj = json.loads(res.choices[0].message.content)
            
            if need_tp > 0 and rj.get("topPicks"):
                data["topPicks"] = data.get("topPicks", []) + rj["topPicks"][:need_tp]
            if need_pop > 0 and rj.get("popcorn"):
                data["popcorn"] = data.get("popcorn", []) + rj["popcorn"][:need_pop]
                
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"Updated {fname} -> final topPicks: {len(data['topPicks'])}, popcorn: {len(data['popcorn'])}")
        except Exception as e:
            print(f"Error on {fname}: {e}")

print("Standardization complete for all past dates!")
