import json
import logging
import base64
import urllib.parse
import re
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync

logger = logging.getLogger(__name__)

def fetch_liveuamap():
    logger.info("Starting Liveuamap scraper with Playwright Stealth...")
    
    regions = [
        {"name": "Ukraine", "url": "https://liveuamap.com"},
        {"name": "Middle East", "url": "https://mideast.liveuamap.com"},
        {"name": "Israel-Palestine", "url": "https://israelpalestine.liveuamap.com"},
        {"name": "Syria", "url": "https://syria.liveuamap.com"}
    ]
    
    all_markers = []
    seen_ids = set()
    
    with sync_playwright() as p:
        # Launching with a real user agent to bypass Turnstile
        browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            color_scheme="dark"
        )
        page = context.new_page()
        stealth_sync(page)
        
        for region in regions:
            try:
                logger.info(f"Scraping Liveuamap region: {region['name']}")
                page.goto(region["url"], timeout=60000, wait_until="domcontentloaded")
                
                # Wait for the map canvas or markers script to load, max 10s wait
                try:
                    page.wait_for_timeout(5000)
                except (TimeoutError, OSError):  # non-critical: page load delay
                    pass
                
                # Read the in-page `ovens` object directly (more robust than
                # regex-scraping the HTML). As of 2026 Liveuamap ships it as a
                # dict {last, venues:[...], fields}; older builds shipped a bare
                # list of markers. Normalize both to a list of marker dicts.
                ovens = None
                try:
                    ovens = page.evaluate("() => (typeof ovens !== 'undefined') ? ovens : null")
                except Exception as e:  # JS eval failed (page not ready / blocked)
                    logger.debug(f"Could not evaluate ovens for {region['name']}: {e}")

                if ovens is None:
                    # Fallback: pull `var ovens = ...;` straight from the HTML and
                    # decode the (sometimes base64+urlencoded) payload.
                    html = page.content()
                    m = re.search(r"var\s+ovens\s*=\s*(.*?);(?!function)", html, re.DOTALL)
                    if m:
                        json_str = m.group(1).strip()
                        if json_str.startswith("'") or json_str.startswith('"'):
                            json_str = json_str.strip('"\'')
                            try:
                                json_str = base64.b64decode(urllib.parse.unquote(json_str)).decode('utf-8')
                            except (ValueError, UnicodeDecodeError):
                                pass  # not base64-encoded; use as-is
                        try:
                            ovens = json.loads(json_str)
                        except (json.JSONDecodeError, ValueError) as e:
                            logger.error(f"Error parsing ovens JSON for {region['name']}: {e}")

                if ovens is None:
                    logger.warning(f"Could not find 'ovens' data for {region['name']}")
                    continue

                # Normalize to the list of marker dicts.
                if isinstance(ovens, dict):
                    markers = ovens.get("venues") or []
                elif isinstance(ovens, list):
                    markers = ovens
                else:
                    markers = []

                for marker in markers:
                    if not isinstance(marker, dict):
                        continue
                    mid = marker.get("id")
                    if mid and mid not in seen_ids:
                        # lat/lng now arrive as strings ("33.3722600") — coerce
                        # to float and skip markers without usable coordinates.
                        try:
                            lat = float(marker.get("lat"))
                            lng = float(marker.get("lng"))
                        except (TypeError, ValueError):
                            continue
                        seen_ids.add(mid)
                        all_markers.append({
                            "id": mid,
                            "type": "liveuamap",
                            # field renames: title is now `name` (was `s`);
                            # link is now `source` (was `link`).
                            "title": marker.get("name") or marker.get("s", "") or marker.get("title", "") or "Unknown Event",
                            "lat": lat,
                            "lng": lng,
                            # prefer the human "time" string; keep epoch too.
                            "timestamp": marker.get("time", "") or marker.get("timestamp", ""),
                            "link": marker.get("source") or marker.get("link") or region["url"],
                            "region": region["name"]
                        })

            except Exception as e:
                logger.error(f"Error scraping Liveuamap {region['name']}: {e}")
                
        browser.close()
        
    logger.info(f"Liveuamap scraper finished, extracted {len(all_markers)} unique markers.")
    return all_markers

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    res = fetch_liveuamap()
    print(json.dumps(res[:3], indent=2))
