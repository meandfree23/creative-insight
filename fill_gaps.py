import os
import json
import glob
import sys
import feedparser
import re
import urllib.parse
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

DAILY_DIR = "data/daily"

def load_sources():
    with open("data/sources.json", "r", encoding="utf-8") as f:
        return json.load(f)

# Hardcode the new spatial/tech sources to only fetch these for backfill
BACKFILL_SOURCES = [
    {"name": "Dezeen", "url": "https://www.dezeen.com/feed/", "category": "SPATIAL"},
    {"name": "ArchDaily", "url": "https://www.archdaily.com/rss.xml", "category": "SPATIAL"},
    {"name": "Frame Web", "url": "https://frameweb.com/rss", "category": "SPATIAL"},
    {"name": "Yellowtrace", "url": "https://www.yellowtrace.com.au/feed/", "category": "SPATIAL"},
    {"name": "Retail Design Blog", "url": "https://retaildesignblog.net/feed/", "category": "SPATIAL"},
    {"name": "Smashing Magazine", "url": "https://www.smashingmagazine.com/feed/", "category": "UIUX"},
    {"name": "UX Collective", "url": "https://uxdesign.cc/feed", "category": "UIUX"},
    {"name": "Adweek", "url": "https://www.adweek.com/feed/", "category": "BRANDING"},
    {"name": "UnderConsideration: Brand New", "url": "https://www.underconsideration.com/brandnew/index.xml", "category": "BRANDING"},
    {"name": "The Drum", "url": "https://www.thedrum.com/rss", "category": "BRANDING"},
    {"name": "Creative Applications", "url": "https://www.creativeapplications.net/feed/", "category": "TECH_ART"},
    {"name": "80 Level", "url": "https://80.lv/rss", "category": "TECH_ART"}
]

DOMAIN_FALLBACKS = {
    "SPATIAL": [
        "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1600&q=80",
        "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1600&q=80",
        "https://images.unsplash.com/photo-1541888081622-1db3e61c5df6?w=1600&q=80",
        "https://images.unsplash.com/photo-1600607688969-a5bfcd64bd40?w=1600&q=80",
        "https://images.unsplash.com/photo-1503174971373-b1f69850bded?w=1600&q=80"
    ],
    "TECH_ART": [
        "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1600&q=80",
        "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80",
        "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=1600&q=80"
    ],
    "BRANDING": [
        "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1600&q=80",
        "https://images.unsplash.com/photo-1542744094-3a31f272c490?w=1600&q=80"
    ],
    "UIUX": [
        "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=1600&q=80",
        "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?w=1600&q=80"
    ],
    "DESIGN": [
        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1600&q=80"
    ]
}

def get_smart_fallback_image(domain, title=""):
    import hashlib
    hash_val = int(hashlib.md5(title.encode('utf-8')).hexdigest(), 16)
    pool = DOMAIN_FALLBACKS.get(domain, DOMAIN_FALLBACKS["DESIGN"])
    return pool[hash_val % len(pool)]

def extract_image(entry, domain="DESIGN"):
    if hasattr(entry, 'media_content') and entry.media_content:
        for mc in entry.media_content:
            if mc.get('url'): return mc.get('url')
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        for mt in entry.media_thumbnail:
            if mt.get('url'): return mt.get('url')
    summary = getattr(entry, "summary", getattr(entry, "description", ""))
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary)
    if match and match.group(1):
        return match.group(1)
    if hasattr(entry, 'content') and entry.content:
        for c in entry.content:
            val = getattr(c, 'value', '')
            match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', val)
            if match and match.group(1):
                return match.group(1)
    title = getattr(entry, "title", "")
    return get_smart_fallback_image(domain, title)

def fetch_rss(sources, seen_urls, seen_images):
    batch_seen = set()
    articles = []
    import random
    
    for src in sources:
        name = src.get("name", "Unknown Source")
        category = src.get("category", "General")
        url = src.get("url", "")
        if not url: continue
        print(f"Fetching {name}...")
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]: 
                link = getattr(entry, "link", "").strip().lower()
                title = getattr(entry, "title", "").strip().lower()
                if not link or link in seen_urls or link in batch_seen:
                    continue
                
                img_url = extract_image(entry, domain=category)
                if not img_url:
                    continue
                    
                img_url_clean = img_url.strip()
                if img_url_clean in seen_images:
                    continue
                    
                batch_seen.add(link)
                articles.append({
                    "title": getattr(entry, "title", ""),
                    "link": getattr(entry, "link", ""),
                    "summary": getattr(entry, "summary", getattr(entry, "description", "")),
                    "source": name,
                    "domain": category,
                    "image": img_url_clean
                })
        except Exception as e:
            pass
    random.shuffle(articles)
    return articles

def generate_backfill(date_str, articles_subset, missing_top, missing_pop):
    print(f"Generating backfill for {date_str} (TopPicks: {missing_top}, Popcorn: {missing_pop})")
    prompt = f"""
    You are a world-class curator.
    We need exactly {missing_top} topPicks and {missing_pop} popcorn items from the provided articles to backfill our daily curation.
    
    CRITICAL SCHEMA RULE FOR FRONTEND COMPATIBILITY:
    - You must use `"title"` for the translated Korean title.
    - You must use `"content"` for the 2-3 sentence precise summary in Korean.
    
    Output strictly in this JSON format:
    {{
      "topPicks": [
        {{
          "title": "(Translate the article title to engaging Korean)",
          "content": "(Write a 2-3 sentence precise summary of the actual scraped article content in Korean)",
          "url": "(The article's original link)",
          "source": "(The source name)",
          "domain": "(The source category)",
          "category": "리뷰",
          "creator_name": "(Specific real-world artist, designer, architect behind this project)",
          "creator_insight": "(Creative insight in Korean)",
          "tags": ["(tag1)", "(tag2)"],
          "execution_techniques": ["(Style hashtag)"],
          "why": "(Curator View in Korean)",
          "depth": 0.95,
          "image": "(The article's image URL)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ],
      "popcorn": [
        {{
          "title": "(Translate title to Korean)",
          "content": "(1-sentence summary in Korean)",
          "url": "(The article's original link)",
          "source": "(Source name)",
          "domain": "POPCORN",
          "category": "바이럴",
          "tags": ["(tag1)"],
          "why": "(Why this is pop/viral reference in Korean)",
          "depth": 0.5,
          "image": "(Image URL)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ]
    }}
    
    Candidate Articles:
    {json.dumps(articles_subset[:30], ensure_ascii=False, indent=2)}
    """
    try:
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
    except Exception as e:
        print(f"Error generating for {date_str}: {e}")
        return None

def process():
    seen_urls = set()
    seen_images = set()
    seen_titles = set()
    
    files = sorted(glob.glob(os.path.join(DAILY_DIR, "*.json")))
    
    # 1. Deduplicate & Schema Convert
    for p in files:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        for key in ["topPicks", "popcorn", "items"]:
            if key in data and data[key]:
                new_list = []
                for item in data[key]:
                    url = item.get("url", "").strip().lower()
                    img = item.get("image", "").strip()
                    title = item.get("title", "").strip().lower()
                    
                    if url in seen_urls or img in seen_images or title in seen_titles:
                        continue # Skip duplicate
                    
                    seen_urls.add(url)
                    seen_images.add(img)
                    seen_titles.add(title)
                    
                    # Schema Conversion for frontend compatibility
                    if "title_ko" in item:
                        item["title_en"] = item.get("title", "")
                        item["title"] = item.get("title_ko", "")
                    if "summary" in item and "content" not in item:
                        item["content"] = item["summary"]
                        
                    new_list.append(item)
                data[key] = new_list
                
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
    # 2. Backfill
    articles_pool = fetch_rss(BACKFILL_SOURCES, seen_urls, seen_images)
    
    for p in files:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        top = data.get("topPicks", [])
        pop = data.get("popcorn", [])
        
        missing_top = max(0, 11 - len(top))
        missing_pop = max(0, 3 - len(pop))
        
        if missing_top > 0 or missing_pop > 0:
            date_str = os.path.basename(p).replace(".json", "")
            if not articles_pool:
                print("Pool exhausted!")
                articles_pool = fetch_rss(BACKFILL_SOURCES, seen_urls, seen_images) # Refetch
                
            batch = articles_pool[:30]
            articles_pool = articles_pool[30:] # consume
            
            backfill_data = generate_backfill(date_str, batch, missing_top, missing_pop)
            if backfill_data:
                for item in backfill_data.get("topPicks", []):
                    top.append(item)
                    seen_urls.add(item.get("url", "").lower())
                    seen_images.add(item.get("image", ""))
                for item in backfill_data.get("popcorn", []):
                    pop.append(item)
                    seen_urls.add(item.get("url", "").lower())
                    seen_images.add(item.get("image", ""))
                    
                data["topPicks"] = top
                data["popcorn"] = pop
                
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print(f"Updated {p} with backfill.")

if __name__ == "__main__":
    process()
