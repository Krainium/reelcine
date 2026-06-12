export const runtime = 'edge';

  const UA = 'Instagram 433.0.0.47.68 Android (31/12; 420dpi; 1080x2400; samsung; SM-G991B; beyond1; exynos2100; en_US)';
  const APP_ID = '936619743392459';
  const DOC_ID = '8845758582119845';

  function extractShortcode(url: string): string {
    const m1 = url.match(/(?:reel|reels|p|tv|share)\/([A-Za-z0-9_-]+)/);
    if (m1?.[1]) return m1[1];
    const m2 = url.match(/instagram\.com\/([A-Za-z0-9_-]{5,})/);
    return m2?.[1] || '';
  }

  function sanitize(s: string): string {
    return s.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 55);
  }

  function getExt(u: string): string {
    const l = u.toLowerCase();
    return l.includes('.jpg') || l.includes('.jpeg') || l.includes('.png') || l.includes('/images/') ? '.jpg' : '.mp4';
  }

  export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const igUrl = searchParams.get('url') || '';

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (d: Record<string, unknown>) => {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`));
        };

        try {
          send({ status: 'resolving', percent: 5 });

          const sc = extractShortcode(igUrl);
          if (!sc) throw new Error('invalid instagram link');

          send({ status: 'fetching', percent: 18 });

          const pageURL = `https://www.instagram.com/reel/${sc}/`;
          const pageRes = await fetch(pageURL, {
            headers: {
              'User-Agent': UA,
              'X-IG-App-ID': APP_ID,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          const setCookie = pageRes.headers.get('set-cookie') || '';
          const csrf = setCookie.match(/csrftoken=([^;,\s]+)/)?.[1] || '';
          const pageHtml = await pageRes.text();

          send({ status: 'querying', percent: 38 });

          const vars = { shortcode: sc, child_comment_count: 3, fetch_comment_count: 40, parent_comment_count: 24, has_threaded_comments: true };
          const params = new URLSearchParams({ doc_id: DOC_ID, variables: JSON.stringify(vars) });

          const gRes = await fetch(`https://www.instagram.com/graphql/query/?${params}`, {
            headers: {
              'User-Agent': UA,
              'X-IG-App-ID': APP_ID,
              'X-CSRFToken': csrf,
              'X-Requested-With': 'XMLHttpRequest',
              Referer: pageURL,
              Origin: 'https://www.instagram.com',
              Accept: '*/*',
            },
          });

          send({ status: 'extracting', percent: 65 });

          let cdnUrl = '';
          let thumbnailUrl = '';
          let caption = '';
          let username = '';

          if (gRes.ok) {
            const gData = await gRes.json().catch(() => null);
            const m = gData?.data?.xdt_shortcode_media;
            if (m) {
              username = (m?.owner?.username as string) || '';
              caption = ((m?.edge_media_to_caption?.edges?.[0]?.node?.text as string) || '').split('\n')[0].trim();
              thumbnailUrl = ((m?.display_url as string) || '').replace(/\\u0026/g, '&');
              if (m?.video_url) cdnUrl = (m.video_url as string).replace(/\\u0026/g, '&');
              else if (m?.video_versions?.[0]?.url) cdnUrl = (m.video_versions[0].url as string).replace(/\\u0026/g, '&');
              else if (m?.display_url) cdnUrl = (m.display_url as string).replace(/\\u0026/g, '&');
            }
          }

          // Regex fallback on page HTML
          if (!cdnUrl) {
            const vm = pageHtml.match(/"video_url":"(https?:\/\/[^"]+\.mp4[^"]*)"|"display_url":"(https?:\/\/[^"]+)"/);
            if (vm) cdnUrl = (vm[1] || vm[2]).replace(/\\u0026/g, '&');
          }

          if (!cdnUrl) throw new Error('could not extract media URL — link may be private or expired');

          const ext = getExt(cdnUrl);
          let filename = '';
          if (caption) { const s = sanitize(caption); if (s.length > 8) filename = `${s}_${sc}${ext}`; }
          if (!filename && username) filename = `${username}_${sc}${ext}`;
          if (!filename) filename = `${sc}${ext}`;

          send({ status: 'done', percent: 100, filename, thumbnailUrl, cdnUrl, caption });
        } catch (e: unknown) {
          send({ status: 'error', percent: 0, error: e instanceof Error ? e.message : 'extraction failed' });
        }

        ctrl.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  