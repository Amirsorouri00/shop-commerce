import { createServer } from 'node:http';

/**
 * OG meta-tag service.
 *
 * This exists because we gave up SSR. Both frontends are static exports with no server, so a
 * link shared to Telegram or Instagram would produce no preview card — and for a product
 * people discover by pasting links between chats, that is a real loss.
 *
 * The recovery is deliberately narrow: this answers *crawlers* with meta tags and nothing
 * else. Humans are redirected to the static app. It is a few hundred lines instead of a Node
 * runtime for the whole front end.
 */

const PORT = Number(process.env['OG_PORT'] ?? 4001);
const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';
const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:3000';

/**
 * Crawler detection.
 *
 * Matching user agents is imperfect, but the failure mode is benign in both directions: a
 * missed crawler sees the same redirect a human does, and a misdetected human gets a tiny
 * HTML page that immediately redirects them.
 */
const CRAWLER_PATTERN =
  /bot|crawler|spider|facebookexternalhit|twitterbot|telegrambot|whatsapp|slackbot|linkedinbot|discordbot|preview|embed/i;

function isCrawler(userAgent: string | undefined): boolean {
  return userAgent !== undefined && CRAWLER_PATTERN.test(userAgent);
}

/** Escape anything interpolated into the HTML. Product titles are third-party text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface PreviewData {
  title: string;
  description: string;
  image?: string;
  url: string;
}

function renderMeta(data: PreviewData): string {
  const title = escapeHtml(data.title);
  const description = escapeHtml(data.description);
  const url = escapeHtml(data.url);
  const image = data.image ? escapeHtml(data.image) : undefined;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="سفارش از خارج">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="fa_IR">
${image ? `<meta property="og:image" content="${image}">` : ''}

<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${image ? `<meta name="twitter:image" content="${image}">` : ''}

<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>
<p><a href="${url}">${title}</a></p>
</body>
</html>`;
}

const DEFAULT_PREVIEW: Omit<PreviewData, 'url'> = {
  title: 'سفارش کالا از آمازون با تحویل در ایران',
  description:
    'پیوند کالا را بفرستید، قیمت نهایی را به تومان ببینید و سفارش را تا درب منزل دریافت کنید.',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const target = `${WEB_URL}${url.pathname}${url.search}`;

  // Humans go straight to the app; only crawlers get the meta page.
  if (!isCrawler(req.headers['user-agent'])) {
    res.writeHead(302, { location: target });
    res.end();
    return;
  }

  let preview: PreviewData = { ...DEFAULT_PREVIEW, url: target };

  // A shared order link gets a specific card. Only public, non-identifying fields are
  // exposed — a preview card is visible to everyone in a group chat, so it must never
  // contain a name, an address, or an amount.
  const orderId = url.searchParams.get('id');
  if (url.pathname.startsWith('/track') && orderId) {
    try {
      const response = await fetch(`${API_URL}/v1/public/orders/${orderId}/preview`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const data = (await response.json()) as { title?: string; imageUrl?: string };
        preview = {
          title: data.title ? `پیگیری سفارش: ${data.title}` : DEFAULT_PREVIEW.title,
          description: 'وضعیت این سفارش را دنبال کنید.',
          ...(data.imageUrl ? { image: data.imageUrl } : {}),
          url: target,
        };
      }
    } catch {
      // A slow or failing API must not stop the crawler getting *a* card.
    }
  }

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
  res.end(renderMeta(preview));
});

server.listen(PORT, () => {
  console.log(`OG meta service listening on :${PORT} -> ${WEB_URL}`);
});
