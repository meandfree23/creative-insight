import os
import json
import random
import feedparser
import google.generativeai as genai

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI") or os.environ.get("GOOGLE_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

SOURCES_FILE = "data/sources.json"

CATEGORIES = [
    "KOREAN_TREND", "TREND_RESEARCH", "BRANDING", "MARKETING", 
    "TECH_ART", "SPATIAL", "MOTION_FILM", "DESIGN", "UIUX", "ART"
]

def pick_weighted_category(sources):
    """
    Pick category with inverse weighting: categories with fewer sources get picked more often
    to organically heal catalog imbalances (e.g. KOREAN_TREND, TREND_RESEARCH).
    """
    counts = {cat: 0 for cat in CATEGORIES}
    for s in sources:
        cat = s.get("category")
        if cat in counts:
            counts[cat] += 1
        elif cat == "FILM":
            counts["MOTION_FILM"] += 1
        elif cat == "ARCHITECTURE":
            counts["SPATIAL"] += 1
            
    # Compute inverse weights (fewer sources = higher probability)
    max_c = max(counts.values()) if counts else 10
    weights = [max(1, max_c - counts[cat] + 2) for cat in CATEGORIES]
    chosen = random.choices(CATEGORIES, weights=weights, k=1)[0]
    print(f"Target category selected by Radar Agent: {chosen} (Current source count: {counts.get(chosen, 0)})")
    return chosen

def discover_new_sources():
    print("Initiating Radar Agent: Brainstorming new sources...")
    with open(SOURCES_FILE, "r", encoding="utf-8") as f:
        existing_sources = json.load(f)
        
    target_category = pick_weighted_category(existing_sources)
    
    category_hint = ""
    if target_category == "KOREAN_TREND":
        category_hint = """
    This category is specifically about the KOREAN market (Korean design, consumer culture, branding, ad campaigns).
    You MUST suggest real Korean-language sources with active RSS feeds.
    Examples of valid Korean feed formats:
    - Naver Blog RSS: https://rss.blog.naver.com/[blog_id].xml
    - Tistory RSS: https://[blog_name].tistory.com/rss
    - Medium Korean Tags: https://medium.com/feed/tag/korea, https://medium.com/feed/tag/korean-design
    - Korean design/marketing news: e.g. OpenAds, MadTimes, Design Jungle, etc.
    Do NOT suggest generic English design blogs for this category.
    """
    elif target_category == "TREND_RESEARCH":
        category_hint = """
    This category is for forecasting, consumer insight, zeitgeist culture, and future retail/tech trends.
    Examples: Substack publications on culture/strategy, Medium tags (consumer-trends, future-trends),
    trend research blogs, Reddit (r/futurology, r/socialmedia).
    """
    elif target_category == "MARKETING":
        category_hint = """
    This category is for marketing, advertising activations, brand strategy, and creative campaigns.
    Examples: Adweek/AdAge feeds, Substack brand strategy newsletters, Medium tags (marketing-strategy, branding).
    """
    elif target_category == "SPATIAL":
        category_hint = """
    This category is for spatial scenography, exhibition media, architectural installations, and physical branding.
    Examples: Frame Web, ArchDaily, Designboom, Gooood, Yellowtrace feeds.
    """
    elif target_category == "TECH_ART":
        category_hint = """
    This category is for interactive media art, creative coding, kinetic installations, and generative visuals.
    Examples: CreativeApplications, Reddit (r/generative, r/touchdesigner), Vimeo channels on projection mapping/kinetic art.
    """
    elif target_category == "MOTION_FILM":
        category_hint = """
    This category is for short film, motion design, cinematic camera work, and commercial directing.
    Examples: Vimeo channels, Stash Media, Motionographer, Director's Notes, Short of the Week.
    """

    prompt = f"""
    You are an autonomous AI Radar Agent specialized in discovering high-quality creative data sources with active RSS feeds.
    Target Category: {target_category}
    {category_hint}
    
    Requirements:
    1. Every suggested source MUST have a real, valid, working RSS or Atom feed URL.
    2. Suggest 5 highly specific, niche, and professional feeds.
    3. Return ONLY a valid JSON array of objects with keys: "name", "url", and "category".
    4. Ensure "category" is strictly "{target_category}".
    """
    
    supported_models = []
    try:
        for m in genai.list_models():
            if "generateContent" in getattr(m, "supported_generation_methods", []):
                supported_models.append(m.name)
        print(f"Available models: {supported_models}")
    except Exception as e:
        print(f"Error listing models: {e}")

    candidate_models = []
    for cand in ["3.6-flash", "3.5-flash", "flash-latest", "3.1-flash-lite", "pro-latest", "3.7-flash"]:
        for name in supported_models:
            if cand in name and "2.5" not in name and name not in candidate_models:
                candidate_models.append(name)
    if not candidate_models and supported_models:
        candidate_models = [m for m in supported_models if "2.5" not in m] or supported_models

    print(f"Candidate Gemini models: {candidate_models}")

    content = ""
    for model_name in candidate_models:
        model = genai.GenerativeModel(
            model_name,
            generation_config={"response_mime_type": "application/json"}
        )
        try:
            response = model.generate_content(
                "You are a helpful assistant that outputs only valid JSON arrays.\n" + prompt
            )
            content = response.text.strip()
            if content:
                break
        except Exception as e:
            print(f"Error with {model_name}: {e}")
            continue

    if not content:
        return []

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict) and "sources" in parsed:
            suggestions = parsed["sources"]
        elif isinstance(parsed, dict):
            for val in parsed.values():
                if isinstance(val, list):
                    suggestions = val
                    break
            else:
                suggestions = []
        else:
            suggestions = parsed
            
        if not isinstance(suggestions, list):
            print("Failed to parse suggestions as a list.")
            return []
            
        return suggestions
    except Exception as e:
        print(f"Error parsing LLM output: {e}")
        return []

def validate_and_add(suggestions):
    with open(SOURCES_FILE, "r", encoding="utf-8") as f:
        sources = json.load(f)
    
    existing_urls = {s["url"].lower() for s in sources}
    added_count = 0
    
    for s in suggestions:
        url = s.get("url", "")
        name = s.get("name", "Unknown")
        category = s.get("category", "DESIGN")
        
        if not url or url.lower() in existing_urls:
            continue
            
        print(f"Validating RSS feed: {name} ({url})...")
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            feed = feedparser.parse(url, request_headers=headers)
            if feed.entries and len(feed.entries) > 0:
                print(f"  -> SUCCESS! Found {len(feed.entries)} entries. Adding to registry.")
                sources.append({"name": name, "url": url, "category": category})
                existing_urls.add(url.lower())
                added_count += 1
            else:
                print("  -> FAILED: Feed is empty or invalid.")
        except Exception as e:
            print(f"  -> ERROR: {e}")
            
    if added_count > 0:
        with open(SOURCES_FILE, "w", encoding="utf-8") as f:
            json.dump(sources, f, ensure_ascii=False, indent=2)
        print(f"Radar Agent successfully added {added_count} new sources!")
    else:
        print("Radar Agent found no new valid sources this run.")

if __name__ == "__main__":
    new_suggestions = discover_new_sources()
    if new_suggestions:
        validate_and_add(new_suggestions)
