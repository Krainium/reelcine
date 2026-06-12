# 📽 ReelCine

  **Web view: [https://reelcine.vercel.app](https://reelcine.vercel.app)**

  paste any Instagram video or image link, view  the 3D film reel spin while it extracts, save your file.

  works for reels, posts, and IGTV. extraction runs on Vercel edge — no external dependencies needed.

  ---

  ## quick start

  ```bash
  git clone https://github.com/Krainium/reelcine
  cd reelcine/frontend
  npm install
  npm run dev
  ```

  open **http://localhost:3000**

  ---

  ## demo

  paste this link and hit CAPTURE:

  ```
  https://www.instagram.com/reels/DZafF3uNUFY/
  ```

  the 3D film reel starts spinning immediately. progress comes in through an SSE stream.
  when it hits 100% the SAVE FILE button appears — one click downloads the video.

  terminal output during a capture:

  ```
  resolving  →  5%
  fetching   →  18%
  querying   →  38%
  extracting →  65%
  done       →  100%  →  filename.mp4 ready
  ```

  ---

  ## what it does

  - 🎞 **3D capture room** — Three.js film reel spins, reacts to progress in realtime
  - 📡 **live SSE** — true server push via EventSource, not polling
  - 🖼 **thumbnail preview** — shows the post thumbnail behind the 3D scene
  - 💾 **caption-based filenames** — saves as `caption_shortcode.mp4`, not a random hash
  - 📂 **archive** — last 10 captures stored in localStorage, re-download anytime
  - ⚡ **serverless** — fully on Vercel edge
  - 🌐 **proxy endpoints** — thumbnail and file download go through edge functions, no CORS issues

  ---

  ## stack

  | layer | what |
  |---|---|
  | backend | Next.js API routes — Vercel Edge Runtime |
  | frontend | Next.js 16 + React 19 |
  | 3D | React Three Fiber / Three.js |
  | animation | Framer Motion |
  | realtime | SSE (EventSource) |
  | styles | Tailwind CSS v4 |
  | deploy | Vercel |

  ---

  ## API

  ```
  GET  /api/capture?url=       SSE stream — extracts media (percent, status, cdnUrl, thumbnailUrl, filename)
  GET  /api/proxy?url=&name=   streams the file from Instagram CDN through Vercel edge
  GET  /api/thumb?url=         proxied thumbnail — no browser CORS issues
  ```

  ---

  ## Environment deploy

  ```bash
  # deploy to Vercel
  npm i -g vercel
  cd frontend
  vercel --prod
  ```

  no environment variables needed — extraction runs entirely on the edge.
  
