// POST /api/fit — "virtual fit": places a wishlist furniture piece into a photo of the new house with Gemini image editing.
// Body: { furniture_id, photo_id } to start from a house photo, or { furniture_id, base_fit_id } to add another piece to an earlier fit.
// Runs with the caller's own Supabase session, so household-only row-level security still applies.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'move-furniture';

type Body = { furniture_id?: number; photo_id?: number; base_fit_id?: number };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function client(token: string): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !token) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function download(sb: SupabaseClient, path: string): Promise<{ data: string; mimeType: string } | null> {
  if (!path) return null;
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return { data: buf.toString('base64'), mimeType: data.type || 'image/jpeg' };
}

function fitPrompt(opts: { room: string; label: string; name: string; qty: number; hasPhoto: boolean; chained: boolean }): string {
  return [
    `IMAGE 1 is a real photo of the ${opts.label || opts.room || 'room'} in our new house${opts.chained ? ' (it already shows furniture we placed earlier)' : ''}.`,
    opts.hasPhoto
      ? `IMAGE 2 is a furniture piece we are thinking of buying: "${opts.name}".`
      : `We are thinking of buying this furniture piece: "${opts.name}".`,
    `Edit IMAGE 1 so ${opts.qty > 1 ? `${opts.qty} of this piece appear` : 'this piece appears'} in the room exactly where it would naturally be placed for this kind of furniture.`,
    opts.chained
      ? 'Keep every piece of furniture that was already added. Only remove existing furniture of the SAME kind if it is in the way.'
      : 'If existing furniture of the same kind is in that spot (for example another sofa, bed, table or chair), remove it and put this piece in its place. Leave other furnishings alone.',
    opts.hasPhoto ? 'Keep the piece\'s exact design, shape, color, material and number of sections from IMAGE 2.' : '',
    'Keep the room itself identical: same walls, paint, windows, doors, floors, fireplace, ceiling, lighting, camera angle and framing.',
    'Show the piece at its true real-world size relative to the room (standard doors are about 80 inches tall, ceilings about 9 feet), with correct perspective, contact shadows and lighting so it looks like an unedited real photo.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function generate(apiKey: string, model: string, parts: unknown[]): Promise<{ data: string; mimeType: string } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } }),
    });
    const out = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) return { error: out?.error?.message || `AI error ${res.status}` };
    const img = (out?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData || p.inline_data);
    const d = img?.inlineData ?? img?.inline_data;
    if (!d?.data) return { error: 'The AI didn’t return a picture. Try again.' };
    return { data: d.data, mimeType: d.mimeType ?? d.mime_type ?? 'image/png' };
  } catch {
    return { error: 'The AI took too long. Please try again.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<Response> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const sb = client(token);
  if (!sb) return json({ error: 'Not signed in.' }, 401);
  const { data: allowed } = await sb.rpc('move_is_allowed');
  if (allowed !== true) return json({ error: 'Not signed in.' }, 401);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI isn’t set up yet (missing Gemini key).' }, 500);

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.furniture_id || (!body.photo_id && !body.base_fit_id)) return json({ error: 'Pick a room photo and a piece.' }, 400);

  const { data: furn } = await sb.from('move_furniture').select('id, name, room, qty, image_path').eq('id', body.furniture_id).maybeSingle();
  if (!furn) return json({ error: 'That furniture piece no longer exists.' }, 404);

  let photoId = body.photo_id ?? null;
  let basePath = '';
  if (body.base_fit_id) {
    const { data: fit } = await sb.from('move_fits').select('id, photo_id, image_path').eq('id', body.base_fit_id).maybeSingle();
    if (!fit) return json({ error: 'That view no longer exists.' }, 404);
    photoId = fit.photo_id;
    basePath = fit.image_path;
  }
  const { data: photo } = await sb.from('move_house_photos').select('id, label, room, image_path').eq('id', photoId).maybeSingle();
  if (!photo) return json({ error: 'That room photo no longer exists.' }, 404);
  if (!basePath) basePath = photo.image_path;

  const [base, piece] = await Promise.all([download(sb, basePath), download(sb, furn.image_path)]);
  if (!base) return json({ error: 'Couldn’t load the room photo.' }, 500);

  const parts: unknown[] = [{ inline_data: { mime_type: base.mimeType, data: base.data } }];
  if (piece) parts.push({ inline_data: { mime_type: piece.mimeType, data: piece.data } });
  parts.push({
    text: fitPrompt({ room: photo.room, label: photo.label, name: furn.name, qty: furn.qty || 1, hasPhoto: !!piece, chained: !!body.base_fit_id }),
  });

  const primary = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
  let img = await generate(apiKey, primary, parts);
  if ('error' in img && primary !== 'gemini-3.1-flash-image') img = await generate(apiKey, 'gemini-3.1-flash-image', parts);
  if ('error' in img) {
    console.error('Fit failed:', img.error);
    return json({ error: img.error }, 502);
  }

  const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `fits/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(img.data, 'base64'), { contentType: img.mimeType, upsert: false });
  if (up.error) return json({ error: `Couldn’t save the picture: ${up.error.message}` }, 500);

  const { data: row, error } = await sb
    .from('move_fits')
    .insert({ photo_id: photo.id, furniture_id: furn.id, furniture_name: furn.name, base_fit_id: body.base_fit_id ?? null, image_path: path })
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);
  return json(row);
}
