import os
import time
import re
import json
import urllib.request
import urllib.parse
import urllib.error

def solve():
    scrape_do_token = os.environ.get('SCRAPEDO_TOKEN') or 'ba70ac83bc71441481a4f6f1f6d469b26be12eca8fd'
    kv_url = os.environ.get('UPSTASH_REDIS_REST_URL') or 'https://global-willing-cod-31627.upstash.io'
    kv_token = os.environ.get('UPSTASH_REDIS_REST_TOKEN') or 'AXeLASQgYjJhODFiNzItMTY2Yi00MzhkLTliMTctNmIwYjhhNTdmMTU3MWRjMmRlNjBmNzVkNDEzYThjYThjNjA4Nzk5YzVhMjQ='

    if not scrape_do_token or not kv_url or not kv_token:
        print("Error: Missing required environment variables (SCRAPEDO_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN).")
        exit(1)

    target_url = "https://deltastudy.site/verify"
    max_attempts = 4
    success = False
    cookies_str = ""
    for attempt in range(1, max_attempts + 1):
        use_super = "&super=true" if attempt >= 3 else ""
        scrape_do_url = f"https://api.scrape.do?token={scrape_do_token}&url={urllib.parse.quote(target_url)}&pureCookies=true&render=true&customWait=15000{use_super}"
        print(f"Attempt {attempt}/{max_attempts} (super={attempt >= 3}): Triggering Scrape.do solver (15s render delay)...")
        try:
            req = urllib.request.Request(scrape_do_url)
            # Short timeout of 60s per attempt to avoid hanging
            with urllib.request.urlopen(req, timeout=60) as response:
                res_headers = dict(response.info())

            set_cookie_headers = []
            for key, value in res_headers.items():
                if key.lower() in ['set-cookie', 'x-set-cookie']:
                    set_cookie_headers.append(value)

            target_cookies = []
            for header in set_cookie_headers:
                parts = re.split(r',(?=[^;]*=)', header) if ',' in header else [header]
                for part in parts:
                    cookie_parts = part.split(';')
                    if cookie_parts:
                        main_cookie = cookie_parts[0].strip()
                        if '=' in main_cookie:
                            name = main_cookie.split('=')[0].strip()
                            if name.lower() not in ['path', 'domain', 'expires', 'secure', 'samesite', 'httponly', 'max-age']:
                                if main_cookie not in target_cookies:
                                    target_cookies.append(main_cookie)

            cookies_str = "; ".join(target_cookies)
            print(f"Parsed Cookies: {cookies_str}")

            if cookies_str and 'delta_cf_verified' in cookies_str:
                print("Success! Found delta_cf_verified cookie.")
                success = True
                break
            else:
                print("Warning: delta_cf_verified cookie not found in response. Cloudflare Turnstile block wasn't solved.")
        except urllib.error.HTTPError as e:
            print(f"Attempt {attempt} HTTPError: {e.code} - {e.read().decode('utf-8', errors='ignore')}")
        except Exception as e:
            print(f"Attempt {attempt} Exception: {e}")
        
        if attempt < max_attempts:
            print("Waiting 5 seconds before retrying...")
            time.sleep(5)

    if not success:
        print(f"Error: Failed to solve Turnstile after {max_attempts} attempts.")
        exit(1)

    # Save to Upstash
    payload = {
        "cookies": cookies_str,
        "adminIp": "104.28.166.255", # Legacy placeholder
        "updatedAt": int(time.time() * 1000)
    }

    print("Saving fresh cookies to Upstash database...")
    req = urllib.request.Request(
        f"{kv_url}/set/pw_cookies",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {kv_token}",
            "Content-Type": "application/json"
        }
    )
    
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            if res.status == 200:
                print("Success! Cookies successfully saved to database.")
            else:
                print("Error: Failed to save to Upstash status:", res.status)
                exit(1)
    except urllib.error.HTTPError as e:
        print("Error: Failed to save to Upstash:", e.code, e.read().decode('utf-8', errors='ignore'))
        exit(1)
    except Exception as e:
        print("Exception saving to Upstash:", e)
        exit(1)

if __name__ == '__main__':
    solve()
