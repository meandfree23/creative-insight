import json
import feedparser
from fetch_ideas import load_sources

def count_unique_articles():
    sources = load_sources()
    urls = set()
    images = set()
    for src in sources:
        url = src.get("url")
        if not url: continue
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                link = getattr(entry, "link", "").strip().lower()
                urls.add(link)
                # Just roughly count entries
        except Exception:
            pass
    print(f"Total unique article URLs available in RSS feeds: {len(urls)}")

if __name__ == "__main__":
    count_unique_articles()
