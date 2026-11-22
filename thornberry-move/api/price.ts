// POST /api/price — identifies a piece of furniture from a photo and/or link and finds live prices with Gemini + Google Search.
// mode "cheaper" instead finds similar pieces that cost less than the current price.
// Only signed-in household members (move_allowed_users) can call it.
import { createClient } from '@supabase/supabase-js';

type Body = {
  image?: { data: string; mimeType: string };
  url?: string;
  name?: string;
  room?: string;
  mode?: 'price' | 'cheaper';
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

function cheaperPrompt(body: Body): string {
  const price = num(body.price);
  return [
    'You help a family furnish their new home in North Richland Hills, Texas (Dallas–Fort Worth) for less money.',
    body.image?.data ? 'The attached photo shows the furniture piece they like.' : '',
    body.url ? `Its product page is: ${body.url} — read it for the exact product, size, material, color and price.` : '',
    body.name ? `They describe it as: "${body.name}".` : '',
    body.room ? `It is for the ${body.room}.` : '',
    price ? `It currently costs $${price}${body.store ? ` at ${body.store}` : ''}.` : 'First find its current price.',
    'Use Google Search to find up to 4 SIMILAR pieces (same type, similar size, style, material and color) that cost LESS, sold by real US retailers',
    '(e.g. Wayfair, Amazon, Target, Walmart, Ashley, Rooms To Go, Costco, IKEA, Home Depot, Lowe\'s, Nebraska Furniture Mart, Overstock). Prefer ones that ship to or are sold near Dallas–Fort Worth.',
    'Only include items with a real, specific product page and a current price you actually found. Never invent links or prices.',
    'Respond with ONLY a JSON object, no other text, in this shape:',
    '{"item_price": current price of the original piece in USD as a number,',
    ' "offers": [{"store": "retailer", "name": "product name", "price": number, "url": "product page", "note": "short: how it differs from the original (size, color, pieces, material)"}] (cheapest first),',
    ' "summary": "one or two sentences comparing the options and which is the closest match for the money"}',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function POST(request: Request): Promise<Response> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAllowed(token))) return json({ error: 'Not signed in.' }, 401);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI pricing isn’t set up yet (missing Gemini key).' }, 500);

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.image?.data && !body.url && !body.name) return json({ error: 'Add a photo, link or name first.' }, 400);

  const cheaper = body.mode === 'cheaper';
  const prompt = cheaper
    ? cheaperPrompt(body)
    : [
    'You help a family furnish their new home in North Richland Hills, Texas (Dallas–Fort Worth).',
    body.image?.data ? 'Identify the furniture piece in the attached photo (brand and model if you can tell).' : '',
    body.url ? `The product page is: ${body.url} — read it for the exact product, price and details.` : '',
    body.name ? `They describe it as: "${body.name}".` : '',
    body.room ? `It is for the ${body.room}.` : '',
    'Use Google Search to find CURRENT prices for this exact item at US retailers (or the closest available match if the exact item cannot be found).',
    'Respond with ONLY a JSON object, no other text, in this shape:',
    '{"name": "short product name", "brand": "brand or empty", "store": "best place to buy", "price": best current price in USD as a number,',
    ' "price_low": lowest price found, "price_high": highest price found, "product_url": "link to the best offer",',
    ' "offers": [{"store": "retailer", "price": number, "url": "product page"}] (up to 4, cheapest first),',
    ' "summary": "one or two sentences: what it is (size/material/color) and whether the prices are for the exact item or similar ones",',
    ' "confidence": "exact" or "similar"}',
  ]
    .filter(Boolean)
    .join('\n');

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

  if (cheaper) {
    const itemPrice = num(body.price) ?? num(r.item_price);
    const found = (Array.isArray(r.offers) ? r.offers : [])
      .map((o: any) => ({ store: str(o?.store), name: str(o?.name), price: num(o?.price), url: str(o?.url), note: str(o?.note) }))
      .filter((o) => o.url.startsWith('http') && o.price && (!itemPrice || o.price < itemPrice - 0.5))
      .sort((a, b) => a.price! - b.price!)
      .slice(0, 5);
    const offers = (await liveLinks(found)).slice(0, 4);
    return json({
      name: '',
      brand: '',
      store: '',
      price: itemPrice,
      price_low: null,
      price_high: null,
      product_url: '',
      summary: offers.length ? str(r.summary) : 'No cheaper look-alikes found right now. This may already be a good price.',
      confidence: 'similar',
      offers,
      sources,
    });
  }

  const offers = (Array.isArray(r.offers) ? r.offers : [])
    .map((o: any) => ({ store: str(o?.store), price: num(o?.price), url: str(o?.url) }))
    .filter((o) => o.url.startsWith('http'))
    .slice(0, 4);
  return json({
    name: str(r.name),
    brand: str(r.brand),
    store: str(r.store),
    price: num(r.price),
    price_low: num(r.price_low),
    price_high: num(r.price_high),
    product_url: str(r.product_url).startsWith('http') ? str(r.product_url) : '',
    summary: str(r.summary),
    confidence: str(r.confidence),
    offers,
    sources,
  });
}
