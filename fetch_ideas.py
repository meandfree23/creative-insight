import os
import json
import time
import datetime
import feedparser
from openai import OpenAI
import random

# Use the environment variable for API Key
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

REPO_DIR = os.getcwd()
DATA_DIR = os.path.join(REPO_DIR, "data")
DAILY_DIR = os.path.join(DATA_DIR, "daily")
SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")
MANIFEST_FILE = os.path.join(DATA_DIR, "manifest.json")

def load_sources():
    with open(SOURCES_FILE, "r") as f:
        return json.load(f)

import re
import hashlib

DOMAIN_FALLBACKS = {
    "DESIGN": [
        "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80"
    ],
    "ART": [
        "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=800&q=80"
    ],
    "ARCHITECTURE": [
        "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=800&q=80"
    ],
    "FASHION": [
        "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80"
    ],
    "BRANDING": [
        "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80"
    ],
    "POPCORN": [
        "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=800&q=80"
    ]
}

def get_smart_fallback_image(domain, seed_text=""):
    domain = (domain or "DESIGN").upper()
    pool = DOMAIN_FALLBACKS.get(domain, DOMAIN_FALLBACKS["DESIGN"])
    hash_val = int(hashlib.md5((seed_text or "default").encode('utf-8')).hexdigest(), 16)
    return pool[hash_val % len(pool)]

def extract_image(entry, domain="DESIGN"):
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        return entry.media_thumbnail[0].get('url', '')
    if hasattr(entry, 'media_content') and entry.media_content:
        return entry.media_content[0].get('url', '')
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enc in entry.enclosures:
            if enc.get('type', '').startswith('image/'):
                return enc.get('href', '')
    summary = getattr(entry, "summary", getattr(entry, "description", ""))
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary)
    if match:
        return match.group(1)
    if hasattr(entry, 'content') and entry.content:
        for c in entry.content:
            match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', getattr(c, 'value', ''))
            if match:
                return match.group(1)
    # Smart dynamic fallback based on domain and title seed
    title = getattr(entry, "title", "")
    return get_smart_fallback_image(domain, title)

import glob

def load_existing_urls_and_titles():
    seen_urls = set()
    seen_titles = set()
    for p in glob.glob(os.path.join(DAILY_DIR, "*.json")):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            picks = (data.get("topPicks") or []) + (data.get("popcorn") or []) + (data.get("items") or [])
            for item in picks:
                if item.get("url"):
                    seen_urls.add(item["url"].strip().lower())
                if item.get("title_ko"):
                    seen_titles.add(item["title_ko"].strip().lower())
                if item.get("title"):
                    seen_titles.add(item["title"].strip().lower())
        except Exception:
            pass
    return seen_urls, seen_titles

def fetch_rss(sources):
    seen_urls, seen_titles = load_existing_urls_and_titles()
    batch_seen = set()
    articles = []
    for src in sources:
        name = src.get("name", "Unknown Source")
        category = src.get("category", "General")
        url = src.get("url", "")
        if not url: continue
        print(f"Fetching {name}...")
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:10]: # limit per source
                link = getattr(entry, "link", "").strip().lower()
                title = getattr(entry, "title", "").strip().lower()
                if not link or link in seen_urls or link in batch_seen or title in seen_titles:
                    continue # DEDUPLICATION SHIELD: Skip already collected articles!
                batch_seen.add(link)
                
                img_url = extract_image(entry)
                if not img_url:
                    continue # Skip articles without images
                articles.append({
                    "title": getattr(entry, "title", ""),
                    "link": getattr(entry, "link", ""),
                    "summary": getattr(entry, "summary", getattr(entry, "description", "")),
                    "source": name,
                    "domain": category,
                    "image": img_url
                })
        except Exception as e:
            print(f"Failed to fetch {name}: {e}")
    return articles

def generate_daily_insight(date_str, articles_subset):
    print(f"Generating insight for {date_str} with {len(articles_subset)} articles...")
    
    prompt = f"""
    You are a world-class design, art, and creative director curator.
    Your evaluation must follow a strict, systematic scoring formula to select the top articles out of the candidates:
    
    Curation Evaluation Formula:
    Score = (Trustworthiness + Relevance + Timeliness + Visual/Video Quality + Cultural Insight + Originality + Cross-Disciplinary Synergy) - Noise
    
    CRITICAL QUANTITATIVE RULE:
    - topPicks MUST contain EXACTLY 10 to 12 items. Do NOT return fewer than 10 or more than 12 items for topPicks.
    - popcorn MUST contain EXACTLY 3 items.
    
    Sort and select items strictly by their evaluation score based on the following 6 criteria:
    1. Relevance & Importance: Why it is relevant to contemporary creators (왜 이 레퍼런스가 중요한지)
    2. Reference Perspective: What specific style, technique, or cultural perspective it offers (어떤 관점의 레퍼런스인지)
    3. Visual & Asset Value: Outstanding image/video visual aesthetic worth saving (이미지/영상으로 볼 가치가 높은지)
    4. Taste Alignment: Alignment with high-end aesthetic taste network (취향 북마크 네트워크와의 밀접성)
    5. Zeitgeist Value: High value in reading contemporary creative trends and culture (동시대 흐름을 읽는 데 도움이 되는지)
    6. Cross-Disciplinary Synergy: How this piece inspires OTHER creative disciplines e.g., how architecture inspires fashion, how 3D motion inspires spatial design (이종 도메인 간의 영감 교차 연결성)
    
    Output strictly in this JSON format:
    {{
      "date": "{date_str}",
      "focusQ": "Agent's Thought: (Write a deep, philosophical synthesis capturing the contemporary creative zeitgeist and cross-disciplinary synergy in Korean, max 3 sentences)",
      "creator_message": "큐레이터의 메시지: (Write a welcoming curator message in Korean reflecting today's theme)",
      "session": {{
        "timestamp": "{datetime.datetime.now().isoformat()}",
        "considered": {len(articles_subset)},
        "selected": 14
      }},
      "topPicks": [
        {{
          "title_ko": "(Translate the article title to engaging, sophisticated Korean)",
          "summary": "(Write a 2-sentence precise summary in Korean)",
          "url": "(The article's original link)",
          "source": "(The source name)",
          "domain": "(The source category, e.g., FASHION, ART, FILM, DESIGN, PHOTOGRAPHY)",
          "category": "리뷰",
          "creator_name": "(Specific real-world artist, designer, architect, or creative lead behind this project, e.g. Bruno King, Clara Bergoënd, Pavel Rotts, Frank Gehry, Yinka Ilori)",
          "creator_insight": "(Specific, high-density creative insight in Korean directly connecting this specific figure to their unique project concept, technique, or artistic statement, e.g., '타이포그래피의 역사적 맥락을 현대적 디자인으로 풀이내는 점이 인상적입니다.')",
          "tags": ["(tag1)", "(tag2)", "(tag3)"],
          "execution_techniques": ["(Extract 1-2 precise Visual Taxonomy style hashtags e.g. KineticStructure, Glassmorphism, Neubrutalism, BiophilicForm, SubtractiveSculpture, DigitalEmbossing)"],
          "why": "(Write a compelling Curator View in Korean addressing: 1) Why relevant, 2) Reference perspective, 3) Visual value, 4) Cross-Disciplinary Connection: 다른 도메인/산업으로의 영감 확장 포인트)",
          "social_proof": "",
          "depth": 0.95,
          "image": "(The article's image URL if provided, else empty string)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ],
      "popcorn": [
        {{
          "title_ko": "(Select EXACTLY 3 trending/viral/pop-culture items from the remaining articles, title in Korean)",
          "summary": "(1-sentence summary in Korean)",
          "url": "(The article's original link)",
          "source": "(Source name)",
          "domain": "POPCORN",
          "category": "바이럴",
          "tags": ["(tag1)"],
          "why": "(Why this is pop/viral reference in Korean)",
          "depth": 0.5,
          "image": "(Image URL if provided, else empty string)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ],
      "macro_keywords": [
        {{
          "word": "(Extract 5-8 Korean macro trend phrases capturing today's zeitgeist and subtle nuances e.g. 다층적 미학 융합, 감성적 모듈화, 디지털 물성 회복)",
          "is_hot": true
        }}
      ]
    }}
    
    Here are the articles to choose from (pick 14):
    """
    
    for i, a in enumerate(articles_subset):
        img_str = f"\nImage: {a['image']}" if a.get('image') else ""
        prompt += f"\n[{i}] Title: {a['title']}\nLink: {a['link']}\nSource: {a['source']}\nCategory: {a['domain']}{img_str}\nSummary: {a['summary'][:200]}...\n"

    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="gpt-4o-2024-08-06",
                response_format={ "type": "json_object" },
                messages=[
                    {"role": "system", "content": "You are a professional JSON generator. Output strictly valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=10000
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            print(f"OpenAI error on attempt {attempt+1}: {e}")
            time.sleep(5)
    return None

def update_manifest(date_str):
    with open(MANIFEST_FILE, "r") as f:
        manifest = json.load(f)
    if date_str not in manifest["dates"]:
        manifest["dates"].append(date_str)
        manifest["dates"].sort(reverse=True)
        with open(MANIFEST_FILE, "w") as f:
            json.dump(manifest, f, indent=2)

import sys
def process_date(target_date, sources=None):
    out_path = os.path.join(DAILY_DIR, f"{target_date}.json")
    if os.path.exists(out_path) and target_date != "ver.1":
        print(f"Data for {target_date} already exists. Skipping.")
        return True

    if sources is None:
        sources = load_sources()
    all_articles = fetch_rss(sources)
    
    if len(all_articles) < 14:
        print(f"Not enough articles fetched for {target_date}!")
        return False
    
    random.shuffle(all_articles)
    batch = all_articles[:40]
        
    daily_json = generate_daily_insight(target_date, batch)
    if daily_json:
        os.makedirs(DAILY_DIR, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(daily_json, f, ensure_ascii=False, indent=2)
        print(f"Saved {out_path}")
        update_manifest(target_date)
        return True
    else:
        print(f"Failed to generate for {target_date}")
        return False

def main():
    kst = datetime.timezone(datetime.timedelta(hours=9))
    today_str = datetime.datetime.now(tz=kst).strftime("%Y-%m-%d")
    
    if len(sys.argv) > 1 and sys.argv[1] and sys.argv[1] != "auto":
        target_date = sys.argv[1]
        process_date(target_date)
    else:
        # Auto mode: check all missing dates up to today
        with open(MANIFEST_FILE, "r") as f:
            manifest = json.load(f)
        existing_dates = set(manifest.get("dates", []))
        
        # Check from 2026-07-17 up to today
        start_date = datetime.date(2026, 7, 17)
        today_date = datetime.datetime.now(tz=kst).date()
        
        missing_dates = []
        curr = start_date
        while curr <= today_date:
            d_str = curr.strftime("%Y-%m-%d")
            if d_str not in existing_dates or not os.path.exists(os.path.join(DAILY_DIR, f"{d_str}.json")):
                missing_dates.append(d_str)
            curr += datetime.timedelta(days=1)
            
        if not missing_dates:
            print(f"All dates up to {today_str} are updated.")
            return
            
        print(f"Found {len(missing_dates)} missing dates: {missing_dates}. Processing in single batch...")
        sources = load_sources()
        for d_str in missing_dates:
            process_date(d_str, sources=sources)

if __name__ == "__main__":
    main()
