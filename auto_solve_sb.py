"""
DeltaStudy Auto Cookie Solver — Origin IP Bypass (Cloudflare Bypass)
===================================================================
KEY INSIGHT: Cloudflare Turnstile is enforced at Cloudflare's EDGE only.
The origin server (75.2.60.68) serves routes on deltastudy.site.

No browser, no captcha, no proxy needed!
"""

import os
import ssl
import socket
import json
import time
import urllib.request
import urllib.parse
import urllib.error

ORIGIN_IP = "75.2.60.68"        # AWS origin IP (bypasses Cloudflare edge)
BASE_DOMAIN = "deltastudy.site"
BASE_URL = f"https://{BASE_DOMAIN}"

# ─── DNS Override: route all deltastudy.site traffic to origin directly ─────
_original_getaddrinfo = socket.getaddrinfo

def _bypass_dns(host, port, *args, **kwargs):
    if host and "deltastudy.site" in host:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ORIGIN_IP, port))]
    return _original_getaddrinfo(host, port, *args, **kwargs)

socket.getaddrinfo = _bypass_dns

# ─── SSL context: ignore cert (IP mismatch expected) ────────────────────────
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

_opener = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=_ssl_ctx)
)

COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Host": BASE_DOMAIN,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}


def get(path: str, extra_headers: dict = None) -> tuple:
    """GET request directly to origin. Returns (status, headers_dict, body_bytes)."""
    headers = {**COMMON_HEADERS, **(extra_headers or {})}
    req = urllib.request.Request(BASE_URL + path, headers=headers)
    try:
        resp = _opener.open(req, timeout=15)
        return resp.status, dict(resp.info()), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def collect_cookies(headers: dict) -> dict:
    """Extract all name=value pairs from Set-Cookie headers."""
    cookies = {}
    raw = headers.get("set-cookie", "") or headers.get("Set-Cookie", "")
    if not raw:
        return cookies
    for entry in raw.split(","):
        part = entry.strip().split(";")[0].strip()
        if "=" in part:
            k, v = part.split("=", 1)
            cookies[k.strip()] = v.strip()
    return cookies


def main():
    kv_url = os.environ.get("UPSTASH_REDIS_REST_URL")
    kv_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")

    if not kv_url or not kv_token:
        print("ERROR: Upstash credentials missing!")
        exit(1)

    print(f"Origin IP bypass active: {BASE_DOMAIN} → {ORIGIN_IP}")
    print("Cloudflare edge bypassed — no Turnstile required!\n")

    # Step 1: Visit homepage to collect any initial session cookies
    print("Step 1: Visiting homepage via origin...")
    status, headers, body = get("/")
    print(f"  / → {status}")
    cookies = collect_cookies(headers)
    print(f"  Cookies from /: {cookies}")

    # Step 2: Visit a few key pages to accumulate session state
    for path in ["/verify", "/study"]:
        print(f"Step 2: Visiting {path} via origin...")
        status, headers, body = get(path, extra_headers={
            "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items())
        })
        print(f"  {path} → {status}")
        new_cookies = collect_cookies(headers)
        cookies.update(new_cookies)
        if new_cookies:
            print(f"  New cookies: {new_cookies}")

    # Step 3: Build cookies string
    if cookies:
        cookies["delta_cf_verified"] = "1"
    else:
        cookies["delta_cf_verified"] = "1"
        print("  No session cookies from origin — adding bypass marker.")

    cookies_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
    print(f"\nFinal cookies string: {cookies_str[:200]}")

    # Step 4: Save to Upstash — include origin bypass flag
    payload = {
        "cookies": cookies_str,
        "originBypass": True,          # Mirror should use direct IP too!
        "originIp": ORIGIN_IP,
        "adminIp": "origin-bypass",
        "updatedAt": int(time.time() * 1000),
    }

    print("\nSaving to Upstash...")
    req = urllib.request.Request(
        f"{kv_url}/set/pi_cookies",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {kv_token}",
            "Content-Type": "application/json",
        },
    )
    res_obj = urllib.request.urlopen(req, timeout=10)
    res_body = res_obj.read()
    if res_obj.status == 200:
        print("SUCCESS! Bypass data saved to Upstash.")
    else:
        print(f"ERROR: {res_obj.status} — {res_body}")
        exit(1)


if __name__ == "__main__":
    main()
