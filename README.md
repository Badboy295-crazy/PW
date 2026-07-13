# PWThor Mirror & Cloudflare Bypass Proxy

This project mirrors the target site `https://pwthor.live/` to your Vercel deployment with automatic Cloudflare cookie synchronization using Scrape.do.

---

## 1. Environment Variables Required on Vercel

Before using the mirror, make sure to add the following **Environment Variables** in your Vercel Project Settings (`https://vercel.com/badboy295-crazys-projects/pw/settings/environment-variables`):

1. `UPSTASH_REDIS_REST_URL` or `KV_REST_API_URL`
   * URL of your Upstash Redis / Vercel KV Database.
2. `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_TOKEN`
   * Authorization token of your Upstash Redis / Vercel KV Database.
3. `SCRAPEDO_TOKEN`
   * API Token for [Scrape.do](https://scrape.do/) (needed for Cloudflare bypass on `/api/cron-solve`).
4. `CRON_SECRET` *(Optional)*
   * Secret key to secure `/api/cron-solve` requests.

---

## 2. Automatic Cookie Solving Setup

The endpoint `/api/cron-solve` bypasses Cloudflare bot protection using Scrape.do's JS-rendering engine, retrieves a valid `cf_clearance` cookie, and saves it in your database.

### Setup Vercel Cron Job:
Add a `crons` rule to `vercel.json` if you want Vercel to trigger it automatically every 15-30 minutes:
```json
  "crons": [
    {
      "path": "/api/cron-solve",
      "schedule": "*/15 * * * *"
    }
  ]
```

---

## 3. Manual Session Sync

If the database cookies expire or automatic sync fails, you can sync your browser's session cookies manually:
1. Go to `https://pw-olive-three.vercel.app/verify`.
2. Follow the instructions to drag the **Sync PWThor Cookie** bookmarklet to your Bookmarks Bar.
3. Visit `https://pwthor.live/`, solve the Cloudflare challenge, and click the bookmarklet in your bookmarks bar. It will automatically upload the valid cookie session to your Upstash KV database.
