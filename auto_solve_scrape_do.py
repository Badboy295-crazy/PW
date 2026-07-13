import os
import time
import re
import requests

def solve():
    scrape_do_token = os.environ.get('SCRAPEDO_TOKEN')
    kv_url = os.environ.get('UPSTASH_REDIS_REST_URL')
    kv_token = os.environ.get('UPSTASH_REDIS_REST_TOKEN')

    if not scrape_do_token or not kv_url or not kv_token:
        print("Error: Missing required environment variables (SCRAPEDO_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN).")
        exit(1)

    target_url = "https://deltastudy.site/verify"
    # Call Scrape.do with render=true and customWait=8000 to execute Cloudflare JS
    scrape_do_url = f"https://api.scrape.do?token={scrape_do_token}&url={target_url}&pureCookies=true&render=true&customWait=8000"

    print("Triggering Scrape.do to solve Cloudflare Turnstile (with 8s render delay)...")
    try:
        response = requests.get(scrape_do_url, timeout=45)
        if response.status_code != 200:
            print(f"Scrape.do API error: {response.status_code} - {response.text}")
            exit(1)

        # Extract Set-Cookie headers
        set_cookie_headers = []
        for key, value in response.headers.items():
            if key.lower() in ['set-cookie', 'x-set-cookie']:
                set_cookie_headers.append(value)

        print("Received Set-Cookie headers from Scrape.do.")

        # Parse cookies properly
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
        print("Parsed Cookies String:", cookies_str)

        if not cookies_str or 'delta_cf_verified' not in cookies_str:
            print("Error: delta_cf_verified cookie not found in the response. Turnstile may have failed to solve.")
            exit(1)

        # Save to Upstash
        payload = {
            "cookies": cookies_str,
            "adminIp": "104.28.166.255", # Static IP placeholder
            "updatedAt": int(time.time() * 1000)
        }

        print("Saving fresh cookies to Upstash database...")
        kv_res = requests.post(
            f"{kv_url}/set/pi_cookies",
            headers={"Authorization": f" fBearer {kv_token}" if not kv_token.startswith("Bearer") else kv_token},
            json=payload
        )

        # If it failed, try with standard bearer prefix
        if kv_res.status_code != 200:
            kv_res = requests.post(
                f"{kv_url}/set/pi_cookies",
                headers={"Authorization": f"Bearer {kv_token}"},
                json=payload
            )

        if kv_res.status_code == 200:
            print("Success! Cookies successfully saved to database.")
        else:
            print("Error: Failed to save to Upstash:", kv_res.text)
            exit(1)

    except Exception as e:
        print("Exception occurred during execution:", e)
        exit(1)

if __name__ == '__main__':
    solve()
