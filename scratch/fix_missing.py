import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

import feedparser
import re

def extract_image(entry, domain="DESIGN"):
    if hasattr(entry, 'media_content') and entry.media_content:
        for mc in entry.media_content:
            if mc.get('url'): return mc.get('url')
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        for mt in entry.media_thumbnail:
            if mt.get('url'): return mt.get('url')
    summary = getattr(entry, "summary", getattr(entry, "description", ""))
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary)
    if match and match.group(1): return match.group(1)
    if hasattr(entry, 'content') and entry.content:
        for c in entry.content:
            val = getattr(c, 'value', '')
            match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', val)
            if match and match.group(1): return match.group(1)
    return "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1600&q=80"

def fetch_fresh_batch():
    with open("data/sources.json", "r", encoding="utf-8") as f:
        sources = json.load(f)
    
    articles = []
    # Pick top sources to get guaranteed fresh content
    for src in sources[:20]:
        try:
            feed = feedparser.parse(src["url"])
            for entry in feed.entries[:3]:
                articles.append({
                    "title": getattr(entry, "title", ""),
                    "link": getattr(entry, "link", ""),
                    "summary": getattr(entry, "summary", getattr(entry, "description", "")),
                    "source": src["name"],
                    "domain": src["category"],
                    "image": extract_image(entry, src["category"])
                })
        except: pass
    return articles

def generate_backfill(date_str, articles_subset, missing_top, missing_pop):
    prompt = f"""
    You are a world-class curator.
    We need exactly {missing_top} topPicks and {missing_pop} popcorn items from the provided articles.
    
    CRITICAL SCHEMA RULE FOR FRONTEND COMPATIBILITY:
    - You must use `"title"` for the translated Korean title.
    - You must use `"content"` for the 2-3 sentence precise summary in Korean.
    
    Output strictly in this JSON format:
    {{
      "topPicks": [
        {{
          "title": "(Korean title)",
          "content": "(Korean summary)",
          "url": "(link)",
          "source": "(source)",
          "domain": "(domain)",
          "category": "리뷰",
          "creator_name": "Unknown",
          "creator_insight": "Insight in Korean",
          "tags": ["tag1", "tag2"],
          "execution_techniques": ["VisualTaxonomy"],
          "why": "Curator view in Korean",
          "depth": 0.95,
          "image": "(image url)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ],
      "popcorn": [
        {{
          "title": "(Korean title)",
          "content": "(Korean summary)",
          "url": "(link)",
          "source": "(source)",
          "domain": "POPCORN",
          "category": "바이럴",
          "tags": ["tag1"],
          "why": "Curator view in Korean",
          "depth": 0.5,
          "image": "(image url)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ]
    }}
    
    Candidate Articles:
    {json.dumps(articles_subset[:40], ensure_ascii=False, indent=2)}
    """
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a world-class curator."},
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"}
    )
    text = response.choices[0].message.content.strip()
    return json.loads(text)

import glob

pool = fetch_fresh_batch()

for p in sorted(glob.glob("data/daily/*.json")):
    filename = os.path.basename(p)
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    top = data.get("topPicks", [])
    pop = data.get("popcorn", [])
    
    missing_top = max(0, 11 - len(top))
    missing_pop = max(0, 3 - len(pop))
    
    if missing_top > 0 or missing_pop > 0:
        print(f"Generating for {filename}. Missing Top: {missing_top}, Pop: {missing_pop}")
        backfill = generate_backfill(filename.replace(".json", ""), pool, missing_top, missing_pop)
        
        # Merge
        for item in backfill.get("topPicks", []): top.append(item)
        for item in backfill.get("popcorn", []): pop.append(item)
        
        data["topPicks"] = top
        data["popcorn"] = pop
        
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Fixed {filename} - now has {len(top)} topPicks and {len(pop)} popcorn.")
