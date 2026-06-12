export const runtime = 'edge';

  const UA = 'Instagram 433.0.0.47.68 Android (31/12; 420dpi; 1080x2400; samsung; SM-G991B; beyond1; exynos2100; en_US)';

  export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url') || '';
    const name = searchParams.get('name') || 'download';

    if (!url.startsWith('https://')) {
      return new Response('invalid url', { status: 400 });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.instagram.com/',
        Accept: '*/*',
      },
    });

    if (!res.ok) {
      return new Response(`upstream ${res.status}`, { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${name}"`);
    const ct = res.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    const cl = res.headers.get('Content-Length');
    if (cl) headers.set('Content-Length', cl);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'private, no-store');

    return new Response(res.body, { headers });
  }
  