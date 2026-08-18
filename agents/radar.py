import os
import json
import random
import feedparser
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI") or os.environ.get("GOOGLE_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

SOURCES_FILE = "data/sources.json"

CATEGORIES = ["DESIGN", "TECH_ART", "UIUX", "BRANDING", "ART", "ARCHITECTURE"]

def discover_new_sources():
    print("Initiating Radar Agent: Brainstorming new sources...")
    target_category = random.choice(CATEGORIES)
    
    prompt = f"""
    You are an AI Radar Agent specialized in discovering high-quality creative data sources.
    Instead of guessing custom domain RSS feeds that often 404, you MUST construct valid RSS feeds from proven platforms:
    - Medium Tag: https://medium.com/feed/tag/[tag-name]
    - Substack: https://[publication].substack.com/feed
    - Vimeo Channel: https://vimeo.com/channels/[channelname]/videos/rss
    - Reddit: https://www.reddit.com/r/[subreddit]/.rss
    
    Suggest 5 highly specific, niche, and professional feeds for the category: {target_category}.
    Return ONLY a JSON array of objects with keys: "name", "url", and "category".
    Ensure "category" is {target_category}.
    """
    
    supported_models = []
    try:
        for m in genai.list_models():
            if "generateContent" in getattr(m, "supported_generation_methods", []):
                supported_models.append(m.name)
        print(f"Available models: {supported_models}")
    except Exception as e:
        print(f"Error listing models: {e}")

    # Prioritize 3.7-flash, 3.6-flash, 3.5-flash (Google requires 3.6+ for new users)
    chosen_model = "models/gemini-3.6-flash"
    for cand in ["3.7-flash", "3.6-flash", "3.5-flash", "flash-latest", "3.1-flash", "flash"]:
        match = next((name for name in supported_models if cand in name and "2.5" not in name), None)
        if match:
            chosen_model = match
            break
    if not match and supported_models:
        non_25 = [m for m in supported_models if "2.5" not in m]
        chosen_model = non_25[0] if non_25 else supported_models[0]

    print(f"Selected Gemini model: {chosen_model}")
    model = genai.GenerativeModel(
        chosen_model,
        generation_config={"response_mime_type": "application/json"}
    )
    
    try:
        response = model.generate_content(
            "You are a helpful assistant that outputs only valid JSON arrays.\n" + prompt
        )
        content = response.text.strip()
        # Handle cases where GPT wraps array in an object
        parsed = json.loads(content)
        if isinstance(parsed, dict) and "sources" in parsed:
            suggestions = parsed["sources"]
        elif isinstance(parsed, dict):
            # Try to find the first array value
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
            feed = feedparser.parse(url)
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
