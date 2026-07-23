import undetected_chromedriver as uc
import time

print("Launching undetected Chrome browser for real Turnstile token...")
options = uc.ChromeOptions()
options.add_argument('--window-size=1920,1080')

try:
    driver = uc.Chrome(options=options, headless=False)
    driver.get("https://deltastudy.site/verify")
    print("Navigated to deltastudy.site/verify. Waiting 15 seconds...")
    time.sleep(15)
    
    cookies = driver.get_cookies()
    print("Extracted Cookies:")
    for c in cookies:
        print(f"  {c['name']} = {c['value']}")
    driver.quit()
except Exception as e:
    print("Error:", e)
