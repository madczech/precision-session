# Precision Session

Penalty Arena launcher accuracy log. Live at https://precision-session.vercel.app (team passcode required).

## What it does
- Session setup: fireball (FB 2 / 4 / 5), PSI, speed km/h, cylinder distance mm, R1, R2 — all required.
- Fixed protocol: 50 shots, 5 per sector, sectors 1 → 10 (5 × 2 grid, numbered row by row from top-left).
- Loads the 50 screenshots, detects the ball in the air in each (in the browser), assigns the sector,
  builds a stacked session image and per-sector results (5/5, hit rate, avg miss, spread).
- Saves sessions to shared History: trend by fireball, side-by-side compare, CSV/image export.

## Structure
- `index.html`, `style.css`, `app.js` — the whole front end (no build step).
- `api/sessions.js`, `api/grid.js`, `api/image.js` — Vercel functions; data in a private Vercel Blob store.
- `api/_lib.js` — passcode check and helpers.

## Environment (set in Vercel, never in the repo)
- `APP_PASSCODE` — team passcode required by every API call.
- `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` — added by the connected Blob store.

## Deploy
Every push to `main` deploys to production on Vercel.
