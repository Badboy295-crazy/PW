from playwright.sync_api import sync_playwright
import time

print("Launching Playwright Chromium for deltastudy.site/verify...")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
    page = context.new_page()
    page.goto("https://deltastudy.site/verify", wait_until="domcontentloaded")
    print("Page loaded. Waiting 15 seconds for Turnstile widget...")
    time.sleep(15)
    
    cookies = context.cookies()
    print("Retrieved Cookies:")
    for c in cookies:
        print(f"  {c['name']} = {c['value']}")
    browser.close()
