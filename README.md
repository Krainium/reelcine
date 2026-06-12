# 📽 ReelCine

  paste an Instagram link, watch a 3D film reel spin while it downloads, save your file.

  works for reels, posts, and IGTV. no yt-dlp, no ffmpeg, nothing external — just a single Go binary.

  ---

  ## quick start

  ```bash
  git clone https://github.com/Krainium/reelcine
  cd reelcine
  go build -o reelcine ./main.go
  cd frontend && npm install && npm run build && cd ..
  ./reelcine
  ```

  open **http://localhost:7777**

  ---

  ## CLI mode

  drop a link straight in:

  ```
  $ ./reelcine https://www.instagram.com/reel/DYxWZWBSo6y/
  CINER pure downloader
  shortcode: DYxWZWBSo6y
  downloading to downloads/Claude_is_getting_crazyyy_DYxWZWBSo6y.mp4
  [====================================] 100.0%
  Saved: downloads/Claude_is_getting_crazyyy_DYxWZWBSo6y.mp4
  ```

  files land in `./downloads/` — named after the caption, not some random hash.

  ---

  ## what it does

  - 🎞 **3D capture room** — Three.js film reel spins, reacts to download % in realtime
  - 📡 **live SSE progress** — true server push, not polling, 160ms updates
  - 🖼 **thumbnail preview** — shows the post thumbnail behind the 3D scene
  - 💾 **caption-based filenames** — saves as `Claude_is_getting_crazyyy_DYxWZWBSo6y.mp4`
  - 📂 **archive** — last 10 downloads remembered in localStorage, re-download anytime
  - ⚡ **one binary, one port** — Go serves the UI and API together on :7777

  ---

  ## stack

  | layer | what |
  |---|---|
  | backend | Go 1.21 — stdlib only |
  | frontend | Next.js 15 + React |
  | 3D | React Three Fiber / Three.js |
  | animation | Framer Motion |
  | realtime | SSE (EventSource) |
  | styles | Tailwind CSS v4 |

  ---

  ## API

  ```
  POST /api/start         { "url": "..." }   →  { "id": "..." }
  GET  /api/progress?id=  SSE stream — JSON every 160ms (percent, speed, status, filename)
  GET  /api/file?id=      serves the downloaded file
  GET  /api/file-by-name?name=   re-download by filename (archive)
  GET  /api/thumb?id=     proxied thumbnail — no CORS issues
  ```

  ---

  ## VPS deploy

  ```bash
  go build -o reelcine ./main.go
  cd frontend && npm install && npm run build && cd ..
  nohup ./reelcine > reelcine.log 2>&1 &
  ```

  ## Vercel (frontend only)

  set env var `NEXT_PUBLIC_API_BASE=http://your-vps-ip:7777` and deploy the `frontend/` folder.

  ---

  MIT license. personal use.
  