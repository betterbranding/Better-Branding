// POST /api/price — finds comparable furniture with live prices using Gemini + Google Search.
// Returns live prices for COMPARABLE pieces from other stores (never the original product itself).
// Only signed-in household members (move_allowed_users) can call it.
import { createClient } from '@supabase/supabase-js';

type Body = {
  image?: { data: string; mimeType: string };
  url?: string;
  name?: string;
  room?: string;
  price?: number;
  store?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function isAllowed(token: string): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !token) return false;
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc('move_is_allowed');
  return !error && data === true;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json|```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI did not return a price.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Drops links that clearly don't exist (404/410). Stores that block bots are kept. */
async function liveLinks<T extends { url: string }>(offers: T[]): Promise<T[]> {
  const checks = await Promise.all(
    offers.map(async (o) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(o.url, {
          method: 'GET',
          redirect: 'follow',
          signal: ctrl.signal,
          headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' },
        });
        clearTimeout(timer);
        return r.status !== 404 && r.status !== 410;
      } catch {
        return true;
      }
    }),
  );
  return offers.filter((_, i) => checks[i]);
}

function comparePrompt(body: Body): string {
  const price = num(body.price);
  const origHost = body.url ? hostOf(body.url) : '';
  return [
    'You help a family furnish their new home in North Richland Hills, Texas (Dallas–Fort Worth) for less money.',
    body.image?.data ? 'The attached photo shows the ORIGINAL furniture piece they like.' : '',
    body.url ? `The ORIGINAL piece's product page is: ${body.url} — read it for the exact product, size, material, color and price.` : '',
    body.name ? `They describe it as: "${body.name}".` : '',
    body.room ? `It is for the ${body.room}.` : '',
    price ? `The original costs $${price}${body.store ? ` at ${body.store}` : ''}.` : 'Also find the original piece\'s current price.',
    'TASK: Use Google Search to find up to 5 COMPARABLE pieces — DIFFERENT products from OTHER brands/retailers that look and function like the original',
    '(same type, similar size, style, material and color) — with their CURRENT live prices from real US retailers',
    '(e.g. Wayfair, Amazon, Target, Walmart, Ashley, Rooms To Go, Costco, IKEA, Home Depot, Lowe\'s, Nebraska Furniture Mart, Overstock, Macy\'s, Pottery Barn, West Elm). Prefer ones sold near or shipping to Dallas–Fort Worth.',
    `Do NOT include the original product itself at any store${body.store ? `, and do NOT include anything from ${body.store}` : ''}${origHost ? ` or ${origHost}` : ''}.`,
    'Focus on options that cost LESS than the original. Only if fewer than 3 cheaper ones exist, add close matches at about the same price.',
    'Only include items with a real, specific product page and a current price you actually found. Never invent links or prices.',
    'Respond with ONLY a JSON object, no other text, in this shape:',
    '{"item_name": "short name of the original piece (brand + model if known)", "item_price": current price of the original in USD as a number or null,',
    ' "offers": [{"store": "retailer", "name": "product name", "price": number, "url": "product page", "note": "short: how it differs from the original (size, color, pieces, material)"}] (cheapest first),',
    ' "summary": "one or two sentences comparing the options and which is the closest match for the money"}',
  ]
    .filter(Boolean)
    .join('\n');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export async function POST(request: Request): Promise<Response> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAllowed(token))) return json({ error: 'Not signed in.' }, 401);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI pricing isn’t set up yet (missing Gemini key).' }, 500);

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.image?.data && !body.url && !body.name) return json({ error: 'Add a photo, link or name first.' }, 400);

  const prompt = comparePrompt(body);

  const parts: unknown[] = [];
  if (body.image?.data) parts.push({ inline_data: { mime_type: body.image.mimeType || 'image/jpeg', data: body.image.data } });
  parts.push({ text: prompt });

  const tools: unknown[] = [{ google_search: {} }];
  if (body.url) tools.push({ url_context: {} });

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], tools, generationConfig: { temperature: 0.2 } }),
  });
  const out = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    console.error('Gemini error', res.status, JSON.stringify(out).slice(0, 500));
    return json({ error: out?.error?.message ? `AI error: ${out.error.message}` : 'AI lookup failed.' }, 502);
  }

  const candidate = out?.candidates?.[0];
  const text: string = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  let r: Record<string, unknown>;
  try {
    r = parseJson(text);
  } catch (err) {
    console.error('Unparseable AI reply:', text.slice(0, 500));
    return json({ error: 'AI couldn’t find a price. Try a clearer photo or a product link.' }, 502);
  }

  const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => ({ title: str(c?.web?.title), url: str(c?.web?.uri) }))
    .filter((s: { url: string }) => s.url)
    .slice(0, 6);

  const itemPrice = num(body.price) ?? num(r.item_price);
  const origHost = body.url ? hostOf(body.url) : '';
  const origStore = str(body.store).toLowerCase();
  const found = (Array.isArray(r.offers) ? r.offers : [])
    .map((o: any) => ({ store: str(o?.store), name: str(o?.name), price: num(o?.price), url: str(o?.url), note: str(o?.note) }))
    .filter((o) => o.url.startsWith('http') && o.price)
    // Comparisons only: never the original's own page or store.
    .filter((o) => !(origHost && hostOf(o.url) === origHost) && !(origStore && o.store.toLowerCase() === origStore))
    // Keep cheaper options plus close matches up to ~10% above the original.
    .filter((o) => !itemPrice || o.price! <= itemPrice * 1.1)
    .sort((a, b) => a.price! - b.price!)
    .slice(0, 6);
  const offers = (await liveLinks(found)).slice(0, 5);
  return json({
    name: str(r.item_name),
    brand: '',
    store: '',
    price: itemPrice,
    price_low: null,
    price_high: null,
    product_url: '',
    summary: offers.length ? str(r.summary) : 'No comparable pieces found right now. Try adding a link or a clearer photo.',
    confidence: 'similar',
    offers,
    sources,
  });
}
