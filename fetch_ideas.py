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

def extract_image(entry):
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
    return ""

def fetch_rss(sources):
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
                articles.append({
                    "title": getattr(entry, "title", ""),
                    "link": getattr(entry, "link", ""),
                    "summary": getattr(entry, "summary", getattr(entry, "description", "")),
                    "source": name,
                    "domain": category,
                    "image": extract_image(entry)
                })
        except Exception as e:
            print(f"Failed to fetch {name}: {e}")
    return articles

def generate_daily_insight(date_str, articles_subset):
    print(f"Generating insight for {date_str} with {len(articles_subset)} articles...")
    
    prompt = f"""
    You are an expert design and art curator. I will provide you with a list of recent articles from various design/art sources.
    Your task is to select exactly 14 of the most inspiring and unique articles, and create a curated daily insight JSON.
    
    Output strictly in this JSON format:
    {{
      "date": "{date_str}",
      "focusQ": "Agent's Thought: [마인드 마이닝] ... (Write a deep, philosophical thought capturing the zeitgeist of today's curation in Korean, max 3 sentences)",
      "creator_message": "큐레이터의 메시지: ... (Write a welcoming curator message in Korean)",
      "session": {{
        "timestamp": "{datetime.datetime.now().isoformat()}",
        "considered": {len(articles_subset)},
        "selected": 14
      }},
      "topPicks": [
        {{
          "title_ko": "(Translate the article title to engaging Korean)",
          "summary": "(Write a 2-sentence summary in Korean)",
          "url": "(The article's original link)",
          "source": "(The source name)",
          "domain": "(The source category, e.g., FASHION, ART, FILM)",
          "category": "리뷰",
          "creator_name": "",
          "creator_insight": "",
          "tags": ["(tag1)", "(tag2)", "(tag3)"],
          "execution_techniques": ["(technique1)"],
          "why": "(Why is this inspiring? 1 sentence in Korean)",
          "social_proof": "",
          "depth": 0.85,
          "image": "(The article's image URL if provided, else empty string)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ]
    }}
    
    Here are the articles to choose from (pick 14):
    """
    
    for i, a in enumerate(articles_subset):
        img_str = f"\nImage: {a['image']}" if a.get('image') else ""
        prompt += f"\n[{i}] Title: {a['title']}\nLink: {a['link']}\nSource: {a['source']}\nCategory: {a['domain']}{img_str}\nSummary: {a['summary'][:200]}...\n"

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": "You are a professional JSON generator. Output strictly valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=4000
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"OpenAI error: {e}")
        return None

def update_manifest(date_str):
    with open(MANIFEST_FILE, "r") as f:
        manifest = json.load(f)
    if date_str not in manifest["dates"]:
        manifest["dates"].append(date_str)
        manifest["dates"].sort(reverse=True)
        with open(MANIFEST_FILE, "w") as f:
            json.dump(manifest, f, indent=2)

def main():
    # Set target date to current KST date
    kst = datetime.timezone(datetime.timedelta(hours=9))
    target_date = datetime.datetime.now(tz=kst).strftime("%Y-%m-%d")
    
    # Do not overwrite if already exists
    out_path = os.path.join(DAILY_DIR, f"{target_date}.json")
    if os.path.exists(out_path):
        print(f"Data for {target_date} already exists. Skipping.")
        return

    sources = load_sources()
    all_articles = fetch_rss(sources)
    
    if len(all_articles) < 14:
        print("Not enough articles fetched!")
        return
    
    random.shuffle(all_articles)
    
    # Pick a batch of 40 articles for the AI to choose 14 from
    batch = all_articles[:40]
        
    daily_json = generate_daily_insight(target_date, batch)
    if daily_json:
        # Ensure directory exists
        os.makedirs(DAILY_DIR, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(daily_json, f, ensure_ascii=False, indent=2)
        print(f"Saved {out_path}")
        update_manifest(target_date)
    else:
        print(f"Failed to generate for {target_date}")

if __name__ == "__main__":
    main()
