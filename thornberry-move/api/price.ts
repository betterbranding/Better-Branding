// POST /api/price — identifies a piece of furniture from a photo and/or link and finds live prices with Gemini + Google Search.
// Only signed-in household members (move_allowed_users) can call it.
import { createClient } from '@supabase/supabase-js';

type Body = { image?: { data: string; mimeType: string }; url?: string; name?: string; room?: string };

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

export async function POST(request: Request): Promise<Response> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAllowed(token))) return json({ error: 'Not signed in.' }, 401);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI pricing isn’t set up yet (missing Gemini key).' }, 500);

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.image?.data && !body.url && !body.name) return json({ error: 'Add a photo, link or name first.' }, 400);

  const prompt = [
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

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

  const offers = (Array.isArray(r.offers) ? r.offers : [])
    .map((o: any) => ({ store: str(o?.store), price: num(o?.price), url: str(o?.url) }))
    .filter((o) => o.url.startsWith('http'))
    .slice(0, 4);
  const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => ({ title: str(c?.web?.title), url: str(c?.web?.uri) }))
    .filter((s: { url: string }) => s.url)
    .slice(0, 6);

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
