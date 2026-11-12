# Precision Session

Penalty Arena launcher accuracy log. Live at https://precision-session.vercel.app (team passcode required).

## What it does
- Session setup: fireball (FB 2 / 4 / 5), PSI, speed km/h, cylinder distance mm, R1, R2 and the machine calibration
  values for sectors A–E — all required. Calibration is editable in History; sessions saved before it existed may stay without it.
- Fixed protocol: 50 shots, 5 per sector, sectors 1 → 10 (5 × 2 grid, numbered row by row from top-left).
- Loads the 50 screenshots, detects the ball in the air in each (in the browser), assigns the sector,
  builds a stacked session image and per-sector results (5/5, hit rate, avg miss, spread).
- Or analyses a whole session video (Analyse video, or drop the video): it is read in this browser, nothing is uploaded.
  Every shot is found by the same method as the tested Python script: the goal is still, a ball launches, it is followed
  against the empty goal, and the impact frame is 3 frames before the net moves (or the last frame before the ball hits
  the post). All shots of a video form one session (pauses between sectors stay in it); only a break of 5 min or more starts
  a new session. Each session loads into the Session tab like screenshots, with the
  ball position from the video ("from video", unsure ones "check"). FB, PSI and cylinder mm are taken from the file
  name when it has them (e.g. `183mm-fb4-7psi.mp4`). MP4 / MOV with H.264 or HEVC; runs in a worker, so it keeps going
  when the window is in the background. About 4–5 minutes for 30 minutes of 1080p video.
- Saves sessions to shared History: trend by fireball, side-by-side compare, CSV/image export.
- Shots uploaded twice are flagged: every screenshot carries the camera timestamp in the top-right picture-in-picture,
  and two shots with the same timestamp are the same shot. Any shot can be deleted (shot list or the shot view) in the
  Session tab and in the History editor; later shots move up and their targets follow the plan. Undo until saved.
- Saved sessions can be edited from History: setup values, notes, shot targets, ball positions (click the stored image)
  and "no ball". Stats are recalculated with the grid the session was saved with; that grid can also be adjusted
  (drag its corners or take the shared grid), which re-measures every shot. Screenshots are not stored; loading the
  original screenshots into the editor again gives the full per-shot check (Auto / No ball / click the ball) and the
  session image is rebuilt on save.
- Saving is refused (and says so) if someone else saved the same session in between.

## Structure
- `index.html`, `style.css`, `app.js` — the whole front end (no build step).
- `video.js` — the video analysis (MP4 index reader, decoding, shot finder); runs as a Web Worker.
- `api/sessions.js`, `api/grid.js`, `api/image.js` — Vercel functions; data in a private Vercel Blob store.
- `api/_lib.js` — passcode check and helpers.

## Environment (set in Vercel, never in the repo)
- `APP_PASSCODE` — team passcode required by every API call.
- `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` — added by the connected Blob store.

## Deploy
Every push to `main` deploys to production on Vercel.
