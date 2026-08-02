import os
import json
import random
import feedparser
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

SOURCES_FILE = "data/sources.json"

CATEGORIES = ["DESIGN", "TECH_ART", "UIUX", "BRANDING", "ART", "ARCHITECTURE"]

def discover_new_sources():
    print("Initiating Radar Agent: Brainstorming new sources...")
    target_category = random.choice(CATEGORIES)
    
    prompt = f"""
    You are an AI Radar Agent specialized in discovering high-quality creative data sources.
    Suggest 5 valid and active RSS feed URLs for high-quality websites, blogs, or communities related to: {target_category}.
    Focus on design, creative coding, UI/UX, or contemporary art.
    Do NOT suggest generic news sites like CNN or BBC.
    Return ONLY a JSON array of objects with keys: "name", "url", and "category".
    Ensure the "url" is a direct link to the RSS/XML feed.
    Ensure "category" is {target_category}.
    """
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a helpful assistant that outputs only valid JSON arrays."},
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"}
    )
    
    try:
        content = response.choices[0].message.content.strip()
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
