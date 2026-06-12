export const runtime = 'edge';

  const UA = 'Instagram 433.0.0.47.68 Android (31/12; 420dpi; 1080x2400; samsung; SM-G991B; beyond1; exynos2100; en_US)';

  export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url') || '';

    if (!url.startsWith('https://')) {
      return new Response('invalid url', { status: 400 });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.instagram.com/',
      },
    });

    if (!res.ok) return new Response('fetch failed', { status: 502 });

    const headers = new Headers();
    headers.set('Content-Type', res.headers.get('Content-Type') || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(res.body, { headers });
  }
  