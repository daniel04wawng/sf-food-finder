import requests
from bs4 import BeautifulSoup
import time

# Selenium imports for JavaScript-heavy sites
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

# Common headers to look more like a real browser
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

def load_keywords():
    """Load food keywords from keywords.txt"""
    with open('keywords.txt', 'r') as f:
        keywords = [line.strip().lower() for line in f if line.strip() and not line.startswith('#')]
    return keywords

def check_for_food(text, keywords):
    """Check if any food keywords appear in the text"""
    text_lower = text.lower()
    found_keywords = []
    for keyword in keywords:
        if keyword in text_lower:
            found_keywords.append(keyword)
    return found_keywords


def is_remote_event(text):
    """Check if event is remote/virtual (we want to skip these)"""
    text_lower = text.lower()
    remote_keywords = ['remote', 'virtual', 'online event', 'zoom', 'webinar', 'livestream']
    for keyword in remote_keywords:
        if keyword in text_lower:
            return True
    return False

def scrape_luma(keywords):
    """Scrape Luma SF events"""
    print("\n" + "="*60)
    print("SCRAPING LUMA")
    print("="*60)
    
    url = "https://lu.ma/sf"
    response = requests.get(url, headers=HEADERS)
    soup = BeautifulSoup(response.text, 'lxml')

    links = soup.find_all('a')

    # Filter for event links (skip navigation links)
    skip_links = ['/', '/discover', '/signin', '/sf/map']
    event_links = []
    
    for link in links:
        href = link.get('href')
        if href and href.startswith('/') and href not in skip_links:
            if '?' not in href and len(href.split('/')) == 2:
                event_links.append(href)
    
    print(f"Found {len(event_links)} Luma events to check")
    
    events_with_food = []
    
    for i, event_link in enumerate(event_links):
        event_url = "https://lu.ma" + event_link
        print(f"[{i+1}/{len(event_links)}] {event_url}", end=" ")
        
        try:
            event_response = requests.get(event_url, headers=HEADERS)
            event_soup = BeautifulSoup(event_response.text, 'lxml')
            
            title_tag = event_soup.find('title')
            title = title_tag.text if title_tag else 'No title'
            
            # Get meta description
            desc_tag = event_soup.find('meta', {'name': 'description'})
            description = desc_tag.get('content', '') if desc_tag else ''
            
            # Also get full page text (catches more content!)
            page_text = event_soup.get_text(separator=' ', strip=True)
            
            # Combine everything for searching
            full_text = f"{title} {description} {page_text}"
            
            # Skip remote events
            if is_remote_event(full_text):
                print("⊘ REMOTE (skipped)")
                continue
            
            found = check_for_food(full_text, keywords)
            
            if found:
                print(f"✓ FOOD: {', '.join(found)}")
                events_with_food.append({
                    'source': 'Luma',
                    'url': event_url,
                    'title': title.replace(' · Luma', ''),
                    'description': description,
                    'keywords': found
                })
            else:
                print("✗")
            
            time.sleep(0.5)  # Be nice to the server
                
        except Exception as e:
            print(f"Error: {e}")
    
    return events_with_food


def scrape_eventbrite(keywords):
    """Scrape Eventbrite SF FREE events"""
    print("\n" + "="*60)
    print("SCRAPING EVENTBRITE (FREE EVENTS ONLY)")
    print("="*60)
    
    # URLs for free events in SF (tech and general)
    urls = [
        "https://www.eventbrite.com/d/ca--san-francisco/free--events/",
        "https://www.eventbrite.com/d/ca--san-francisco/free--tech--events/"
    ]
    
    event_links = []
    
    for url in urls:
        print(f"Fetching: {url}")
        response = requests.get(url, headers=HEADERS)
        soup = BeautifulSoup(response.text, 'lxml')
        
        # Find event links (Eventbrite uses /e/ for events)
        for link in soup.find_all('a', href=True):
            href = link.get('href')
            if href and '/e/' in href and 'eventbrite.com' in href:
                # Clean the URL (remove query params)
                clean_url = href.split('?')[0]
                if clean_url not in event_links:
                    event_links.append(clean_url)
    
    print(f"Found {len(event_links)} Eventbrite events to check")
    
    events_with_food = []
    
    for i, event_url in enumerate(event_links[:20]):  # Limit to 20 for speed
        print(f"[{i+1}/{min(len(event_links), 20)}] {event_url[:60]}...", end=" ")
        
        try:
            event_response = requests.get(event_url, headers=HEADERS)
            event_soup = BeautifulSoup(event_response.text, 'lxml')
            
            title_tag = event_soup.find('title')
            title = title_tag.text if title_tag else 'No title'
            
            # Get meta description
            desc_tag = event_soup.find('meta', {'name': 'description'})
            description = desc_tag.get('content', '') if desc_tag else ''
            
            # Get og:description (usually has event details)
            og_desc = event_soup.find('meta', {'property': 'og:description'})
            if og_desc:
                description += ' ' + og_desc.get('content', '')
            
            # Look for event description in specific elements (avoid nav/footer)
            # Eventbrite puts descriptions in divs with specific classes
            event_content = ""
            for div in event_soup.find_all(['div', 'section', 'article']):
                class_name = ' '.join(div.get('class', []))
                # Look for content areas, skip navigation
                if any(x in class_name.lower() for x in ['description', 'detail', 'content', 'about', 'summary']):
                    event_content += div.get_text(separator=' ', strip=True) + ' '
            
            # Combine title, description, and event content only
            full_text = f"{title} {description} {event_content}"
            
            # Skip remote events
            if is_remote_event(full_text):
                print("⊘ REMOTE (skipped)")
                continue
            
            found = check_for_food(full_text, keywords)
            
            if found:
                print(f"✓ FOOD: {', '.join(found)}")
                events_with_food.append({
                    'source': 'Eventbrite',
                    'url': event_url,
                    'title': title.replace(' | Eventbrite', ''),
                    'description': description,
                    'keywords': found
                })
            else:
                print("✗")
            
            time.sleep(0.5)  # Be nice to the server
                
        except Exception as e:
            print(f"Error: {e}")
    
    return events_with_food


def scrape_cerebral_valley(keywords):
    """Scrape Cerebral Valley AI events using Selenium (JavaScript required)"""
    print("\n" + "="*60)
    print("SCRAPING CEREBRAL VALLEY (using Selenium)")
    print("="*60)
    
    # Set up Chrome in headless mode (no visible browser window)
    chrome_options = Options()
    chrome_options.add_argument("--headless")  # Run without opening browser
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument(f"user-agent={HEADERS['User-Agent']}")
    
    try:
        # Auto-download and set up ChromeDriver
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # Filter for SF Bay Area events
        url = "https://cerebralvalley.ai/events?location=SF+%26+Bay+Area"
        print(f"Loading {url} with Selenium...")
        driver.get(url)
        
        # Wait for events to load (up to 10 seconds)
        time.sleep(3)  # Give JavaScript time to load
        
        # Get page source after JavaScript has run
        soup = BeautifulSoup(driver.page_source, 'lxml')
        
        # Close the browser
        driver.quit()
        
    except Exception as e:
        print(f"Selenium error: {e}")
        print("Make sure Chrome is installed!")
        return []
    
    # Find event links - CV links to external sites like Luma, Eventbrite, etc.
    event_links = []
    for link in soup.find_all('a', href=True):
        href = link.get('href')
        if href:
            # Look for external event links (lu.ma, eventbrite, partiful, etc.)
            if any(site in href for site in ['lu.ma', 'luma.com', 'eventbrite.com', 'partiful.com']):
                if href not in event_links:
                    event_links.append(href)
            # Also check for their own event pages (CV uses /e/ for events)
            elif '/e/' in href:
                full_url = href if href.startswith('http') else 'https://cerebralvalley.ai' + href
                if full_url not in event_links:
                    event_links.append(full_url)
    
    print(f"Found {len(event_links)} Cerebral Valley events to check")
    
    # Debug: show first few links found
    if event_links:
        print("Sample links found:")
        for link in event_links[:5]:
            print(f"  - {link[:70]}...")
    
    events_with_food = []
    
    for i, event_url in enumerate(event_links[:20]):  # Limit to 20 for speed
        print(f"[{i+1}/{min(len(event_links), 20)}] {event_url[:60]}...", end=" ")
        
        try:
            event_response = requests.get(event_url, headers=HEADERS)
            event_soup = BeautifulSoup(event_response.text, 'lxml')
            
            title_tag = event_soup.find('title')
            title = title_tag.text if title_tag else 'No title'
            
            desc_tag = event_soup.find('meta', {'name': 'description'})
            description = desc_tag.get('content', '') if desc_tag else ''
            
            # Also check og:description
            og_desc = event_soup.find('meta', {'property': 'og:description'})
            if og_desc:
                description += ' ' + og_desc.get('content', '')
            
            # Also get full page text
            page_text = event_soup.get_text(separator=' ', strip=True)
            
            full_text = f"{title} {description} {page_text}"
            
            # Skip remote events
            if is_remote_event(full_text):
                print("⊘ REMOTE (skipped)")
                continue
            
            found = check_for_food(full_text, keywords)
            
            if found:
                print(f"✓ FOOD: {', '.join(found)}")
                events_with_food.append({
                    'source': 'Cerebral Valley',
                    'url': event_url,
                    'title': title,
                    'description': description,
                    'keywords': found
                })
            else:
                print("✗")
            
            time.sleep(0.5)
                
        except Exception as e:
            print(f"Error: {e}")
    
    return events_with_food


def scrape_meetup(keywords):
    """Scrape Meetup SF tech events"""
    print("\n" + "="*60)
    print("SCRAPING MEETUP")
    print("="*60)
    
    url = "https://www.meetup.com/find/us--ca--san-francisco/technology/"
    response = requests.get(url, headers=HEADERS)
    soup = BeautifulSoup(response.text, 'lxml')
    
    # Find event links (Meetup uses /events/ in URLs)
    event_links = []
    for link in soup.find_all('a', href=True):
        href = link.get('href')
        if href and '/events/' in href and 'meetup.com' in href:
            if href not in event_links:
                event_links.append(href)
    
    print(f"Found {len(event_links)} Meetup events to check")
    
    events_with_food = []
    
    for i, event_url in enumerate(event_links[:20]):  # Limit to 20 for speed
        print(f"[{i+1}/{min(len(event_links), 20)}] {event_url[:60]}...", end=" ")
        
        try:
            event_response = requests.get(event_url, headers=HEADERS)
            event_soup = BeautifulSoup(event_response.text, 'lxml')
            
            title_tag = event_soup.find('title')
            title = title_tag.text if title_tag else 'No title'
            
            desc_tag = event_soup.find('meta', {'name': 'description'})
            description = desc_tag.get('content', '') if desc_tag else ''
            
            # Also check og:description
            og_desc = event_soup.find('meta', {'property': 'og:description'})
            if og_desc:
                description += ' ' + og_desc.get('content', '')
            
            # Also get full page text
            page_text = event_soup.get_text(separator=' ', strip=True)
            
            full_text = f"{title} {description} {page_text}"
            
            # Skip remote events
            if is_remote_event(full_text):
                print("⊘ REMOTE (skipped)")
                continue
            
            found = check_for_food(full_text, keywords)
            
            if found:
                print(f"✓ FOOD: {', '.join(found)}")
                events_with_food.append({
                    'source': 'Meetup',
                    'url': event_url,
                    'title': title.replace(' | Meetup', ''),
                    'description': description,
                    'keywords': found
                })
            else:
                print("✗")
            
            time.sleep(0.5)
                
        except Exception as e:
            print(f"Error: {e}")
    
    return events_with_food


def save_results(events):
    """Save all events to file"""
    if not events:
        print("\nNo events with food found!")
        return
        
    with open('data/events_with_food.txt', 'w', encoding='utf-8') as f:
        f.write("SF EVENTS WITH FREE FOOD\n")
        f.write("=" * 60 + "\n\n")
        for event in events:
            f.write(f"[{event['source']}]\n")
            f.write(f"Title: {event['title']}\n")
            f.write(f"URL: {event['url']}\n")
            f.write(f"Keywords Found: {', '.join(event['keywords'])}\n")
            f.write(f"Description: {event['description']}\n")
            f.write("\n" + "-" * 60 + "\n\n")
    print(f"\n✓ Saved to data/events_with_food.txt")


def main():
    """Run all scrapers"""
    print("🍕 SF FREE FOOD FINDER 🍕")
    
    keywords = load_keywords()
    print(f"Loaded {len(keywords)} food keywords: {', '.join(keywords[:5])}...")
    
    all_events = []
    
    # Scrape each site
    all_events.extend(scrape_luma(keywords))
    all_events.extend(scrape_eventbrite(keywords))
    all_events.extend(scrape_cerebral_valley(keywords))
    all_events.extend(scrape_meetup(keywords))
    
    # Print summary
    print("\n" + "="*60)
    print(f"FINAL SUMMARY: Found {len(all_events)} events with food!")
    print("="*60)
    
    for event in all_events:
        print(f"\n🍕 [{event['source']}] {event['title']}")
        print(f"   URL: {event['url']}")
        print(f"   Keywords: {', '.join(event['keywords'])}")
    
    # Save results
    save_results(all_events)


def test_single(site_name):
    """Test a single scraper"""
    keywords = load_keywords()
    print(f"Loaded {len(keywords)} keywords")
    
    scrapers = {
        'luma': scrape_luma,
        'eventbrite': scrape_eventbrite,
        'cerebral': scrape_cerebral_valley,
        'meetup': scrape_meetup
    }
    
    if site_name in scrapers:
        events = scrapers[site_name](keywords)
        print(f"\nFound {len(events)} events with food!")
        for event in events:
            print(f"\n🍕 {event['title']}")
            print(f"   URL: {event['url']}")
    else:
        print(f"Unknown site: {site_name}")
        print(f"Options: {', '.join(scrapers.keys())}")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        # Test single site: python scraper.py luma
        test_single(sys.argv[1])
    else:
        # Run all
        main()