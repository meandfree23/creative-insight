import os
import json
import time
import datetime
import feedparser
import google.generativeai as genai
import random

# Use the environment variable for API Key
api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI") or os.environ.get("GOOGLE_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

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
import socket

# Prevent infinite hangs on unresponsive RSS feeds
socket.setdefaulttimeout(10)

import urllib.parse

def get_smart_fallback_image(domain, source_name):
    domain = (domain or "DESIGN").upper()
    source_name = source_name or "Creative Insight"
    
    # Beautiful dark aesthetic hex colors per domain
    colors = {
        "FILM": "0f172a",
        "MARKETING": "172554",
        "POPCORN": "4a044e",
        "DESIGN": "18181b",
        "ART": "3f3f46",
        "FASHION": "27272a",
        "SPATIAL": "1c1917",
        "TECH_ART": "020617",
        "ARCHITECTURE": "292524",
        "BRANDING": "1e1b4b",
        "UIUX": "0a0a0a"
    }
    bg_color = colors.get(domain, "1E1E1E")
    
    # Format text cleanly, e.g., "Nowness\n(FILM)"
    text = f"{source_name}\n({domain})"
    encoded_text = urllib.parse.quote(text)
    
    return f"https://placehold.co/800x600/{bg_color}/FFFFFF?text={encoded_text}&font=playfair-display"

def extract_image(entry, domain="DESIGN", source_name=""):
    # 1. Media Content
    if hasattr(entry, 'media_content') and entry.media_content:
        for mc in entry.media_content:
            if mc.get('url'): return mc.get('url')
    # 2. Media Thumbnail
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        for mt in entry.media_thumbnail:
            if mt.get('url'): return mt.get('url')
    # 3. Enclosures
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enc in entry.enclosures:
            if enc.get('href'): return enc.get('href')
    # 4. Links
    if hasattr(entry, 'links') and entry.links:
        for lk in entry.links:
            if lk.get('type', '').startswith('image/') and lk.get('href'):
                return lk.get('href')
    # 5. HTML img in summary or description
    summary = getattr(entry, "summary", getattr(entry, "description", ""))
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary)
    if match and match.group(1):
        return match.group(1)
    # 6. HTML img in full content
    if hasattr(entry, 'content') and entry.content:
        for c in entry.content:
            val = getattr(c, 'value', '')
            match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', val)
            if match and match.group(1):
                return match.group(1)
    # 7. Image attribute
    if hasattr(entry, 'image') and entry.image:
        if isinstance(entry.image, dict) and entry.image.get('href'):
            return entry.image.get('href')
    # Smart dynamic fallback only as last resort
    return get_smart_fallback_image(domain, source_name)

import glob

def load_existing_urls_and_titles():
    seen_urls = set()
    seen_titles = set()
    import datetime
    cutoff_date = datetime.date.today() - datetime.timedelta(days=30)
    for p in glob.glob(os.path.join(DAILY_DIR, "*.json")):
        basename = os.path.basename(p)
        try:
            file_date_str = basename.replace(".json", "")
            file_date = datetime.datetime.strptime(file_date_str, "%Y-%m-%d").date()
            if file_date < cutoff_date:
                continue
        except Exception:
            pass
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

import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse

def fetch_sitemap_urls(source_url):
    try:
        parsed_uri = urlparse(source_url)
        base_url = '{uri.scheme}://{uri.netloc}'.format(uri=parsed_uri)
        sitemap_url = base_url + '/sitemap.xml'
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        r = requests.get(sitemap_url, headers=headers, timeout=5)
        if r.status_code != 200:
            r = requests.get(base_url + '/robots.txt', headers=headers, timeout=5)
            if r.status_code == 200:
                for line in r.text.splitlines():
                    if line.lower().startswith('sitemap:'):
                        sitemap_url = line.split(':', 1)[1].strip()
                        break
        
        r = requests.get(sitemap_url, headers=headers, timeout=10)
        if r.status_code != 200:
            return []
            
        urls = []
        sitemaps = []
        soup = BeautifulSoup(r.content, 'xml')
        for loc in soup.find_all('loc'):
            url = loc.text.strip()
            if url.endswith('.xml'):
                sitemaps.append(url)
            elif '/20' in url or '/post/' in url or '/article/' in url:
                if not url.endswith(('.jpg', '.png', '.pdf', '.mp4')):
                    urls.append(url)
                    
        if not urls and sitemaps:
            import random
            # Prefer sitemaps that look like they contain posts
            post_sitemaps = [s for s in sitemaps if 'post' in s or 'article' in s]
            target_sitemap = random.choice(post_sitemaps) if post_sitemaps else random.choice(sitemaps)
            r2 = requests.get(target_sitemap, headers=headers, timeout=10)
            if r2.status_code == 200:
                soup2 = BeautifulSoup(r2.content, 'xml')
                for loc in soup2.find_all('loc'):
                    url = loc.text.strip()
                    if '/20' in url or '/post/' in url or '/article/' in url:
                        if not url.endswith(('.jpg', '.png', '.pdf', '.mp4')):
                            urls.append(url)
        return urls
    except Exception as e:
        return []

def scrape_metadata(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        r = requests.get(url, headers=headers, timeout=5)
        if r.status_code != 200: return None
        soup = BeautifulSoup(r.content, 'html.parser')
        
        title = soup.title.string if soup.title else ""
        og_title = soup.find("meta", property="og:title")
        if og_title: title = og_title.get("content", title)
            
        desc = ""
        og_desc = soup.find("meta", property="og:description")
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if og_desc: desc = og_desc.get("content", "")
        elif meta_desc: desc = meta_desc.get("content", "")
            
        image = ""
        og_img = soup.find("meta", property="og:image")
        if og_img: image = og_img.get("content", "")
            
        if not title: return None
        
        return {
            "title": title.strip(),
            "link": url,
            "summary": desc.strip(),
            "image": image,
            "published": "" 
        }
    except Exception as e:
        return None

def fetch_rss(sources):
    seen_urls, seen_titles = load_existing_urls_and_titles()
    batch_seen = set()
    articles = []
    
    # 30% of sources will be selected for Deep Sitemap Search to prevent extreme overhead
    sitemap_sources = random.sample(sources, max(1, int(len(sources)*0.3)))
    
    for src in sources:
        name = src.get("name", "Unknown Source")
        category = src.get("category", "General")
        url = src.get("url", "")
        if not url: continue
        print(f"Fetching {name}...")
        
        # 1. Standard RSS Fetch
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:10]:
                link = getattr(entry, "link", "").strip().lower()
                title = getattr(entry, "title", "").strip().lower()
                if not link or link in seen_urls or link in batch_seen or title in seen_titles:
                    continue
                batch_seen.add(link)
                
                img_url = extract_image(entry, domain=category, source_name=name)
                articles.append({
                    "title": getattr(entry, "title", ""),
                    "link": getattr(entry, "link", ""),
                    "summary": getattr(entry, "summary", getattr(entry, "description", "")),
                    "image": img_url,
                    "source": name,
                    "category": category,
                    "type": "rss"
                })
        except Exception as e:
            print(f"Failed to fetch RSS {name}: {e}")
            
        # 2. Deep Historical Search (Sitemap)
        if src in sitemap_sources:
            print(f"  -> Deep searching past data for {name}...")
            past_urls = fetch_sitemap_urls(url)
            if past_urls:
                samples = random.sample(past_urls, min(3, len(past_urls)))
                for p_url in samples:
                    if p_url.lower() in seen_urls or p_url.lower() in batch_seen: continue
                    batch_seen.add(p_url.lower())
                    meta = scrape_metadata(p_url)
                    if meta:
                        img_url = meta['image'] or get_smart_fallback_image(category, name)
                        articles.append({
                            "title": meta['title'],
                            "link": meta['link'],
                            "summary": meta['summary'],
                            "image": img_url,
                            "source": name,
                            "category": category,
                            "type": "sitemap"
                        })
    return articles

def generate_daily_insight(date_str, articles_subset):
    print(f"Generating insight for {date_str} with {len(articles_subset)} articles...")
    
    prompt = f"""
    You are a cynical, sharp-tongued Senior Creative Director and GQ/Vogue Editor-in-Chief.
    You despise fluffy, generic AI jargon (DO NOT USE words like "여정", "탐구", "교차점", "시너지", "잠재력", "혁신").
    Your writing must be professional, highly specific, slightly cynical, and extremely sharp.
    
    Curation Evaluation Formula:
    Score = (Trustworthiness + Relevance + Timeliness + Cinematic/Visual Quality + Marketing Insight + Originality) - Noise
    
    CRITICAL QUANTITATIVE RULE (HARD VOLUME):
    - You MUST output EXACTLY 12 to 15 items in `topPicks`, and EXACTLY 2 to 3 items in `popcorn`.
    - Do NOT drop articles just because they seem "average". It is your job as a Senior CD to extract a razor-sharp, profound creative angle even from an ordinary piece of news. Forcing the volume is mandatory.
    
    THEMATIC TABS (CRITICAL RULE):
    Instead of generic domains like DESIGN or ART, you MUST classify each article into one of the following highly specific curational themes for the "domain" field:
    - "Korean Code" (Trends or insights deeply relevant to the Korean market or culture)
    - "Cinema & Narrative" (Film, video, storytelling, camera work, directing)
    - "Design & Space" (Architecture, spatial design, typography, UI/UX, product design)
    - "Marketing & Brand" (Campaigns, brand strategy, consumer engagement)
    
    Sort and select items strictly by their evaluation score based on the following 6 criteria:
    1. Relevance & Importance: Why it is relevant to contemporary creators (왜 이 레퍼런스가 중요한지)
    2. Reference Perspective: What specific style, technique, or cultural perspective it offers (어떤 관점의 레퍼런스인지)
    3. Cinematic & Visual Value: Outstanding directing, camera work, or visual aesthetic worth saving (이미지/영상 연출 및 미학적으로 볼 가치가 높은지)
    4. Taste Alignment: Alignment with high-end aesthetic taste network (취향 북마크 네트워크와의 밀접성)
    5. Marketing & Planning Insight: Strategic value in brand campaigns, ad planning, and consumer engagement (마케팅, 브랜드 캠페인, 기획적 전략에 깊은 통찰을 주는지)
    6. Cross-Disciplinary Synergy: How this piece inspires OTHER creative disciplines e.g., how film inspires spatial design, how ads inspire tech art (이종 도메인 간의 영감 교차 연결성)
    
    Output strictly in this JSON format:
    {{
      "date": "{date_str}",
      "focusQ": "Agent's Thought: (Write a sharp, non-cliché, professional editorial synthesis in Korean. STRICTLY BAN: 여정, 탐구, 교차점, 시너지. Max 3 sentences.)",
      "creator_message": "큐레이터의 메시지: (Write a direct, cynical yet insightful editor's note in Korean. STRICTLY BAN generic AI buzzwords.)",
      "session": {{
        "timestamp": "{datetime.datetime.now().isoformat()}",
        "considered": {len(articles_subset)},
        "selected": "(Write the total number of items you selected as an integer)"
      }},
      "topPicks": [
        {{
          "title": "(Translate the article title to engaging, sophisticated Korean)",
          "content": "(Write a 2-3 sentence precise summary of the actual scraped article content in Korean)",
          "url": "(The article's original link)",
          "source": "(The source name)",
          "domain": "(MUST BE ONE OF: Korean Code, Cinema & Narrative, Design & Space, Marketing & Brand)",
          "category": "리뷰",
          "creator_name": "(Specific real-world artist, designer, architect, or creative lead behind this project)",
          "creator_insight": "(Specific, high-density creative insight in Korean directly connecting this specific figure to their unique project concept. Sharp and cynical tone.)",
          "tags": ["(tag1)", "(tag2)", "(tag3)"],
          "execution_techniques": ["(Extract 1-2 precise Visual Taxonomy style hashtags)"],
          "why": "(Write a compelling Curator View in Korean addressing why it matters. Sharp, professional tone.)",
          "social_proof": "",
          "depth": 0.95,
          "image": "(The article's image URL if provided, else empty string)",
          "pub_date": "{date_str}T08:00:00.000000"
        }}
      ],
      "popcorn": [
        {{
          "title": "(Select EXACTLY 3 highly engaging, viral, or entertaining items such as viral ad campaigns, funny shorts, behind-the-scenes, or trending pop-culture references, title in Korean)",
          "content": "(1-sentence snappy summary of the content in Korean)",
          "url": "(The article's original link)",
          "source": "(Source name)",
          "domain": "POPCORN",
          "category": "스낵/바이럴",
          "tags": ["(tag1)", "(tag2)"],
          "why": "(Why this is an entertaining or viral reference for video/marketing creators in Korean)",
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
        prompt += f"\n[{i}] Title: {a['title']}\nLink: {a['link']}\nSource: {a['source']}\nCategory: {a.get('category', a.get('domain', 'DESIGN'))}{img_str}\nSummary: {a['summary'][:200]}...\n"

    supported_models = []
    try:
        for m in genai.list_models():
            if "generateContent" in getattr(m, "supported_generation_methods", []):
                supported_models.append(m.name)
        print(f"Available models: {supported_models}")
    except Exception as e:
        print(f"Error listing models: {e}")

    # Prioritize models with standard high quotas (avoid 2.5 deprecated and 3.7 strict preview quota)
    candidate_models = []
    for cand in ["3.6-flash", "3.5-flash", "flash-latest", "3.1-flash-lite", "pro-latest", "3.7-flash"]:
        for name in supported_models:
            if cand in name and "2.5" not in name and name not in candidate_models:
                candidate_models.append(name)
    if not candidate_models and supported_models:
        candidate_models = [m for m in supported_models if "2.5" not in m] or supported_models

    print(f"Candidate Gemini models: {candidate_models}")

    for model_name in candidate_models:
        print(f"Attempting generation with model: {model_name}")
        model = genai.GenerativeModel(
            model_name,
            generation_config={"response_mime_type": "application/json"}
        )
        for attempt in range(2):
            try:
                response = model.generate_content(
                    "You are a professional JSON generator. Output strictly valid JSON.\n" + prompt
                )
                text = response.text.strip()
                if text.startswith("```"):
                    text = re.sub(r"^```(?:json)?\s*", "", text)
                    text = re.sub(r"\s*```$", "", text)
                return json.loads(text)
            except Exception as e:
                print(f"Gemini API error with {model_name} (attempt {attempt+1}): {e}")
                if "quota" in str(e).lower() or "429" in str(e) or "resource" in str(e).lower():
                    print(f"Quota/limit for {model_name}, moving to next candidate model...")
                    break
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
            success = process_date(d_str, sources=sources)
            if success:
                print(f"Successfully processed {d_str}. Pausing 15s before next date...")
                time.sleep(15)
            else:
                print(f"Failed to process {d_str}. Pausing 30s before next date...")
                time.sleep(30)

if __name__ == "__main__":
    main()
