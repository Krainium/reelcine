package main

  import (
      "encoding/json"
      "fmt"
      "io"
      "log"
      "math/rand"
      "net/http"
      "os"
      "path/filepath"
      "regexp"
      "strings"
      "sync"
      "time"
  )

  const (
      ua    = "Instagram 433.0.0.47.68 Android (31/12; 420dpi; 1080x2400; samsung; SM-G991B; beyond1; exynos2100; en_US)"
      appID = "936619743392459"
      docID = "8845758582119845"
  )

  var (
      outputDir  = "./downloads"
      httpClient = &http.Client{Timeout: 120 * time.Second}
  )

  var downloads = make(map[string]*ProgressUpdate)
  var dlMu sync.Mutex

  type MediaInfo struct {
      URL          string
      ThumbnailURL string
      Caption      string
      Username     string
  }

  type ProgressUpdate struct {
      ID           string  `json:"id"`
      Percent      float64 `json:"percent"`
      Downloaded   int64   `json:"downloaded"`
      Total        int64   `json:"total"`
      Speed        string  `json:"speed"`
      Status       string  `json:"status"`
      Filename     string  `json:"filename,omitempty"`
      ThumbnailURL string  `json:"thumbnailUrl,omitempty"`
      Caption      string  `json:"caption,omitempty"`
      Error        string  `json:"error,omitempty"`
  }

  func corsMiddleware(next http.Handler) http.Handler {
      return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
          w.Header().Set("Access-Control-Allow-Origin", "*")
          w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
          w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
          if r.Method == "OPTIONS" {
              w.WriteHeader(204)
              return
          }
          next.ServeHTTP(w, r)
      })
  }

  func extractShortcode(link string) string {
      re := regexp.MustCompile(`(?:reel|reels|p|tv|share)/([A-Za-z0-9_-]+)`)
      if m := re.FindStringSubmatch(link); len(m) > 1 {
          return m[1]
      }
      re2 := regexp.MustCompile(`instagram\.com/([A-Za-z0-9_-]{5,})`)
      if m := re2.FindStringSubmatch(link); len(m) > 1 {
          return m[1]
      }
      return ""
  }

  func resolveFinalURL(raw string) string {
      req, _ := http.NewRequest("GET", raw, nil)
      req.Header.Set("User-Agent", ua)
      resp, err := httpClient.Do(req)
      if err != nil {
          return raw
      }
      defer resp.Body.Close()
      return resp.Request.URL.String()
  }

  func sanitizeFilePart(s string) string {
      re := regexp.MustCompile(`[^\w\s\-]`)
      clean := re.ReplaceAllString(s, "")
      clean = strings.TrimSpace(clean)
      clean = regexp.MustCompile(`\s+`).ReplaceAllString(clean, "_")
      if len([]rune(clean)) > 55 {
          clean = string([]rune(clean)[:55])
      }
      return clean
  }

  func deriveFilename(info MediaInfo, shortcode string) string {
      ext := getExtFromURL(info.URL)
      if info.Caption != "" {
          part := sanitizeFilePart(info.Caption)
          if len(part) > 8 {
              return part + "_" + shortcode + ext
          }
      }
      if info.Username != "" {
          return info.Username + "_" + shortcode + ext
      }
      return shortcode + ext
  }

  func getMediaInfo(shortcode string) (MediaInfo, error) {
      var info MediaInfo
      pageURL := fmt.Sprintf("https://www.instagram.com/reel/%s/", shortcode)

      pReq, _ := http.NewRequest("GET", pageURL, nil)
      pReq.Header.Set("User-Agent", ua)
      pReq.Header.Set("X-IG-App-ID", appID)
      pReq.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

      pResp, err := httpClient.Do(pReq)
      if err != nil {
          return info, err
      }
      defer pResp.Body.Close()

      body, _ := io.ReadAll(pResp.Body)
      bodyStr := string(body)

      var csrf string
      for _, c := range pResp.Cookies() {
          if c.Name == "csrftoken" {
              csrf = c.Value
              break
          }
      }

      rulingURL := fmt.Sprintf("https://i.instagram.com/api/v1/web/get_ruling_for_content/?content_type=MEDIA&target_id=%s", shortcode)
      rReq, _ := http.NewRequest("GET", rulingURL, nil)
      rReq.Header.Set("User-Agent", ua)
      rReq.Header.Set("X-IG-App-ID", appID)
      go httpClient.Do(rReq) //nolint:errcheck

      vars := map[string]interface{}{
          "shortcode":             shortcode,
          "child_comment_count":   3,
          "fetch_comment_count":   40,
          "parent_comment_count":  24,
          "has_threaded_comments": true,
      }
      vj, _ := json.Marshal(vars)

      gReq, _ := http.NewRequest("GET", "https://www.instagram.com/graphql/query/", nil)
      q := gReq.URL.Query()
      q.Set("doc_id", docID)
      q.Set("variables", string(vj))
      gReq.URL.RawQuery = q.Encode()
      gReq.Header.Set("User-Agent", ua)
      gReq.Header.Set("X-IG-App-ID", appID)
      gReq.Header.Set("X-CSRFToken", csrf)
      gReq.Header.Set("X-Requested-With", "XMLHttpRequest")
      gReq.Header.Set("Referer", pageURL)
      gReq.Header.Set("Origin", "https://www.instagram.com")
      gReq.Header.Set("Accept", "*/*")

      gResp, err := httpClient.Do(gReq)
      if err == nil && gResp.StatusCode == 200 {
          gb, _ := io.ReadAll(gResp.Body)
          gResp.Body.Close()

          var gd struct {
              Data struct {
                  XdtShortcodeMedia map[string]interface{} `json:"xdt_shortcode_media"`
              } `json:"data"`
          }
          if json.Unmarshal(gb, &gd) == nil && gd.Data.XdtShortcodeMedia != nil {
              m := gd.Data.XdtShortcodeMedia
              if owner, ok := m["owner"].(map[string]interface{}); ok {
                  if u, ok := owner["username"].(string); ok {
                      info.Username = u
                  }
              }
              if cap, ok := m["edge_media_to_caption"].(map[string]interface{}); ok {
                  if edges, ok := cap["edges"].([]interface{}); ok && len(edges) > 0 {
                      if edge, ok := edges[0].(map[string]interface{}); ok {
                          if node, ok := edge["node"].(map[string]interface{}); ok {
                              if txt, ok := node["text"].(string); ok {
                                  lines := strings.Split(txt, "\n")
                                  info.Caption = strings.TrimSpace(lines[0])
                              }
                          }
                      }
                  }
              }
              if v, ok := m["display_url"].(string); ok && v != "" {
                  info.ThumbnailURL = strings.ReplaceAll(v, `\u0026`, "&")
              }
              if v, ok := m["video_url"].(string); ok && v != "" {
                  info.URL = strings.ReplaceAll(v, `\u0026`, "&")
              } else if vs, ok := m["video_versions"].([]interface{}); ok && len(vs) > 0 {
                  if f, ok := vs[0].(map[string]interface{}); ok {
                      if u, ok := f["url"].(string); ok && u != "" {
                          info.URL = strings.ReplaceAll(u, `\u0026`, "&")
                      }
                  }
              }
              if info.URL == "" {
                  if v, ok := m["display_url"].(string); ok && v != "" {
                      info.URL = strings.ReplaceAll(v, `\u0026`, "&")
                  } else if iv, ok := m["image_versions2"].(map[string]interface{}); ok {
                      if c, ok := iv["candidates"].([]interface{}); ok && len(c) > 0 {
                          if first, ok := c[0].(map[string]interface{}); ok {
                              if u, ok := first["url"].(string); ok && u != "" {
                                  info.URL = strings.ReplaceAll(u, `\u0026`, "&")
                              }
                          }
                      }
                  }
              }
              if info.URL != "" {
                  return info, nil
              }
          }

          re := regexp.MustCompile(`"video_url":"(https?://[^"]+\.mp4[^"]*)"|"display_url":"(https?://[^"]+)"`)
          if matched := re.FindStringSubmatch(string(gb)); len(matched) > 1 {
              u := matched[1]
              if u == "" {
                  u = matched[2]
              }
              info.URL = strings.ReplaceAll(u, `\u0026`, "&")
              if info.URL != "" {
                  return info, nil
              }
          }
      }

      sRe := regexp.MustCompile(`window\._sharedData\s*=\s*({.+?});`)
      if m := sRe.FindStringSubmatch(bodyStr); len(m) > 1 {
          var sh struct {
              EntryData struct {
                  PostPage []struct {
                      Graphql struct {
                          ShortcodeMedia map[string]interface{} `json:"shortcode_media"`
                      } `json:"graphql"`
                  } `json:"PostPage"`
              } `json:"entry_data"`
          }
          if json.Unmarshal([]byte(m[1]), &sh) == nil {
              for _, p := range sh.EntryData.PostPage {
                  if p.Graphql.ShortcodeMedia != nil {
                      sm := p.Graphql.ShortcodeMedia
                      if v, ok := sm["video_url"].(string); ok && v != "" {
                          info.URL = strings.ReplaceAll(v, `\u0026`, "&")
                      } else if v, ok := sm["display_url"].(string); ok && v != "" {
                          info.URL = strings.ReplaceAll(v, `\u0026`, "&")
                      }
                      if v, ok := sm["display_url"].(string); ok && v != "" {
                          info.ThumbnailURL = strings.ReplaceAll(v, `\u0026`, "&")
                      }
                      if info.URL != "" {
                          return info, nil
                      }
                  }
              }
          }
      }

      re2 := regexp.MustCompile(`"video_url":"(https?://[^"]+\.mp4[^"]*)"|"display_url":"(https?://[^"]+)"`)
      if m := re2.FindStringSubmatch(bodyStr); len(m) > 1 {
          u := m[1]
          if u == "" {
              u = m[2]
          }
          info.URL = strings.ReplaceAll(u, `\u0026`, "&")
          if info.URL != "" {
              return info, nil
          }
      }

      return info, fmt.Errorf("could not extract media URL")
  }

  func updateProgress(id string, pct float64, dl, tot int64, status, fname string) {
      dlMu.Lock()
      defer dlMu.Unlock()
      if d, ok := downloads[id]; ok {
          d.Percent = pct
          d.Downloaded = dl
          d.Total = tot
          d.Status = status
          if fname != "" {
              d.Filename = fname
          }
      }
  }

  func formatSpeed(bps float64) string {
      if bps < 1024 {
          return fmt.Sprintf("%.0f B/s", bps)
      } else if bps < 1024*1024 {
          return fmt.Sprintf("%.1f KB/s", bps/1024)
      }
      return fmt.Sprintf("%.2f MB/s", bps/(1024*1024))
  }

  func getExtFromURL(mediaURL string) string {
      lower := strings.ToLower(mediaURL)
      if strings.Contains(lower, ".jpg") || strings.Contains(lower, ".jpeg") || strings.Contains(lower, ".png") || strings.Contains(lower, "/images/") {
          return ".jpg"
      }
      return ".mp4"
  }

  func performDownload(igURL, id string) {
      os.MkdirAll(outputDir, 0755)
      updateProgress(id, 1, 0, 0, "resolving", "")

      resolved := resolveFinalURL(igURL)
      sc := extractShortcode(resolved)
      if sc == "" {
          updateProgress(id, 0, 0, 0, "error", "")
          dlMu.Lock()
          downloads[id].Error = "invalid instagram link"
          dlMu.Unlock()
          return
      }

      updateProgress(id, 8, 0, 0, "fetching media info", "")
      mediaInfo, err := getMediaInfo(sc)
      if err != nil {
          updateProgress(id, 0, 0, 0, "error", "")
          dlMu.Lock()
          downloads[id].Error = err.Error()
          dlMu.Unlock()
          return
      }

      fname := deriveFilename(mediaInfo, sc)
      murl := mediaInfo.URL
      outPath := filepath.Join(outputDir, fname)

      updateProgress(id, 12, 0, 0, "downloading", fname)
      dlMu.Lock()
      if d, ok := downloads[id]; ok {
          d.ThumbnailURL = mediaInfo.ThumbnailURL
          d.Caption = mediaInfo.Caption
      }
      dlMu.Unlock()

      req, err := http.NewRequest("GET", murl, nil)
      if err != nil {
          updateProgress(id, 0, 0, 0, "error", "")
          dlMu.Lock()
          downloads[id].Error = err.Error()
          dlMu.Unlock()
          return
      }
      req.Header.Set("User-Agent", ua)
      req.Header.Set("Accept", "*/*")
      req.Header.Set("Referer", "https://www.instagram.com/")

      resp, err := httpClient.Do(req)
      if err != nil {
          updateProgress(id, 0, 0, 0, "error", "")
          dlMu.Lock()
          downloads[id].Error = err.Error()
          dlMu.Unlock()
          return
      }
      defer resp.Body.Close()

      if resp.StatusCode != 200 {
          updateProgress(id, 0, 0, 0, "error", "")
          dlMu.Lock()
          downloads[id].Error = fmt.Sprintf("http %d", resp.StatusCode)
          dlMu.Unlock()
          return
      }

      total := resp.ContentLength
      if total < 0 {
          total = 0
      }

      out, err := os.Create(outPath)
      if err != nil {
          updateProgress(id, 0, 0, 0, "error", "")
          dlMu.Lock()
          downloads[id].Error = err.Error()
          dlMu.Unlock()
          return
      }
      defer out.Close()

      lastT := time.Now()
      var lastBytes int64
      buf := make([]byte, 32*1024)
      var downloaded int64

      for {
          n, rerr := resp.Body.Read(buf)
          if n > 0 {
              if _, werr := out.Write(buf[:n]); werr != nil {
                  break
              }
              downloaded += int64(n)
              now := time.Now()
              dt := now.Sub(lastT).Seconds()
              var spd float64
              if dt > 0.25 {
                  spd = float64(downloaded-lastBytes) / dt
                  lastBytes = downloaded
                  lastT = now
              }
              pct := 0.0
              if total > 0 {
                  pct = float64(downloaded) / float64(total) * 100
              }
              updateProgress(id, pct, downloaded, total, "downloading", fname)
              if spd > 0 {
                  spdStr := formatSpeed(spd)
                  dlMu.Lock()
                  if d, ok := downloads[id]; ok {
                      d.Speed = spdStr
                  }
                  dlMu.Unlock()
              }
          }
          if rerr != nil {
              break
          }
      }

      finalPct := 100.0
      if total > 0 {
          finalPct = float64(downloaded) / float64(total) * 100
      }
      updateProgress(id, finalPct, downloaded, total, "done", fname)
  }

  func startDownload(igURL string) string {
      id := fmt.Sprintf("%d-%04d", time.Now().Unix(), rand.Intn(10000))
      dlMu.Lock()
      downloads[id] = &ProgressUpdate{ID: id, Status: "starting", Percent: 0}
      dlMu.Unlock()
      go performDownload(igURL, id)
      return id
  }

  func main() {
      rand.Seed(time.Now().UnixNano()) //nolint:staticcheck
      os.MkdirAll(outputDir, 0755)

      mux := http.NewServeMux()

      mux.HandleFunc("/api/start", func(w http.ResponseWriter, r *http.Request) {
          if r.Method != "POST" {
              http.Error(w, "POST only", 405)
              return
          }
          var req struct {
              URL string `json:"url"`
          }
          if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
              http.Error(w, "bad request", 400)
              return
          }
          id := startDownload(req.URL)
          w.Header().Set("Content-Type", "application/json")
          json.NewEncoder(w).Encode(map[string]string{"id": id})
      })

      mux.HandleFunc("/api/progress", func(w http.ResponseWriter, r *http.Request) {
          id := r.URL.Query().Get("id")
          if id == "" {
              http.Error(w, "missing id", 400)
              return
          }
          w.Header().Set("Content-Type", "text/event-stream")
          w.Header().Set("Cache-Control", "no-cache")
          w.Header().Set("Connection", "keep-alive")
          flusher, ok := w.(http.Flusher)
          if !ok {
              http.Error(w, "stream unsupported", 500)
              return
          }
          for {
              dlMu.Lock()
              d, ok := downloads[id]
              dlMu.Unlock()
              if !ok {
                  break
              }
              b, _ := json.Marshal(d)
              fmt.Fprintf(w, "data: %s\n\n", b)
              flusher.Flush()
              if d.Status == "done" || d.Status == "error" {
                  break
              }
              time.Sleep(160 * time.Millisecond)
          }
      })

      mux.HandleFunc("/api/file", func(w http.ResponseWriter, r *http.Request) {
          id := r.URL.Query().Get("id")
          dlMu.Lock()
          d, ok := downloads[id]
          dlMu.Unlock()
          if !ok || d.Filename == "" {
              http.Error(w, "not found", 404)
              return
          }
          path := filepath.Join(outputDir, d.Filename)
          w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, d.Filename))
          http.ServeFile(w, r, path)
      })

      mux.HandleFunc("/api/thumb", func(w http.ResponseWriter, r *http.Request) {
          id := r.URL.Query().Get("id")
          dlMu.Lock()
          d, ok := downloads[id]
          dlMu.Unlock()
          if !ok || d.ThumbnailURL == "" {
              http.Error(w, "not found", 404)
              return
          }
          req, err := http.NewRequest("GET", d.ThumbnailURL, nil)
          if err != nil {
              http.Error(w, "bad url", 500)
              return
          }
          req.Header.Set("User-Agent", ua)
          req.Header.Set("Referer", "https://www.instagram.com/")
          resp, err := httpClient.Do(req)
          if err != nil {
              http.Error(w, "fetch failed", 502)
              return
          }
          if resp.StatusCode != 200 {
              resp.Body.Close()
              http.Error(w, "upstream error", 502)
              return
          }
          defer resp.Body.Close()
          w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
          w.Header().Set("Cache-Control", "public, max-age=86400")
          io.Copy(w, resp.Body)
      })

      mux.HandleFunc("/api/file-by-name", func(w http.ResponseWriter, r *http.Request) {
          name := r.URL.Query().Get("name")
          if name == "" || strings.Contains(name, "..") || strings.Contains(name, "/") {
              http.Error(w, "invalid name", 400)
              return
          }
          filePath := filepath.Join(outputDir, name)
          if _, err := os.Stat(filePath); os.IsNotExist(err) {
              http.Error(w, "file not found", 404)
              return
          }
          w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
          http.ServeFile(w, r, filePath)
      })

      if len(os.Args) > 1 {
          link := os.Args[1]
          fmt.Println("CINER pure downloader")
          resolved := resolveFinalURL(link)
          sc := extractShortcode(resolved)
          if sc == "" {
              fmt.Println("bad link")
              return
          }
          fmt.Println("shortcode:", sc)
          mediaInfo, err := getMediaInfo(sc)
          if err != nil {
              fmt.Println("error:", err)
              return
          }
          out := filepath.Join(outputDir, deriveFilename(mediaInfo, sc))
          fmt.Println("downloading to", out)
          req, _ := http.NewRequest("GET", mediaInfo.URL, nil)
          req.Header.Set("User-Agent", ua)
          resp, err := httpClient.Do(req)
          if err != nil {
              fmt.Println(err)
              return
          }
          defer resp.Body.Close()
          os.MkdirAll(outputDir, 0755)
          f, _ := os.Create(out)
          defer f.Close()
          total := resp.ContentLength
          var cur int64
          buf := make([]byte, 32*1024)
          for {
              n, e := resp.Body.Read(buf)
              if n > 0 {
                  f.Write(buf[:n])
                  cur += int64(n)
                  if total > 0 {
                      p := float64(cur) / float64(total) * 100
                      bar := int(p / 100 * 36)
                      fmt.Printf("\r[%s%s] %.1f%%", strings.Repeat("=", bar), strings.Repeat(" ", 36-bar), p)
                  }
              }
              if e != nil {
                  break
              }
          }
          fmt.Println("\nSaved:", out)
          return
      }

      fs := http.FileServer(http.Dir("./frontend/out"))
      mux.Handle("/", fs)

      fmt.Println("REELCINE starting on :7777 — open http://localhost:7777")
      log.Fatal(http.ListenAndServe(":7777", corsMiddleware(mux)))
  }
  