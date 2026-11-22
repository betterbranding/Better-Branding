import { supabase } from './supabase';
import type { AppState, Fit, PriceOffer, TableName } from './types';

export const PHOTO_BUCKET = 'move-furniture';

export interface PriceResult {
  name: string;
  brand: string;
  store: string;
  price: number | null;
  price_low: number | null;
  price_high: number | null;
  product_url: string;
  summary: string;
  confidence: string;
  offers: PriceOffer[];
  sources: Array<{ title: string; url: string }>;
}

// Each app table lives in Postgres with a move_ prefix and is protected by row-level security:
// only emails listed in move_allowed_users can read or write.
const TABLE: Record<TableName, string> = {
  tasks: 'move_tasks',
  budget: 'move_budget',
  items: 'move_items',
  furniture: 'move_furniture',
  photos: 'move_house_photos',
  fits: 'move_fits',
};

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export const api = {
  async isAllowed(): Promise<boolean> {
    const { data, error } = await supabase.rpc('move_is_allowed');
    if (error) throw new Error(error.message);
    return data === true;
  },

  async state(): Promise<AppState> {
    const [settings, tasks, budget, items, furniture, photos, fits] = await Promise.all([
      supabase.from('move_settings').select('key, value'),
      supabase.from(TABLE.tasks).select('*').order('due', { ascending: true, nullsFirst: false }).order('id'),
      supabase.from(TABLE.budget).select('*').order('id'),
      supabase.from(TABLE.items).select('*').order('id'),
      supabase.from(TABLE.furniture).select('*').order('created_at', { ascending: false }),
      supabase.from(TABLE.photos).select('*').order('sort').order('id'),
      supabase.from(TABLE.fits).select('*').order('created_at', { ascending: false }),
    ]);
    const rows = check(settings) as Array<{ key: string; value: string }>;
    return {
      settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      tasks: check(tasks) as AppState['tasks'],
      budget: check(budget) as AppState['budget'],
      items: check(items) as AppState['items'],
      furniture: check(furniture) as AppState['furniture'],
      photos: check(photos) as AppState['photos'],
      fits: check(fits) as AppState['fits'],
    };
  },

  async create<T>(table: TableName, row: object): Promise<T> {
    const { id: _ignored, ...clean } = row as { id?: number };
    return check(await supabase.from(TABLE[table]).insert(clean).select().single()) as T;
  },

  async update<T>(table: TableName, id: number, patch: object): Promise<T> {
    const { id: _ignored, ...clean } = patch as { id?: number };
    return check(await supabase.from(TABLE[table]).update(clean).eq('id', id).select().single()) as T;
  },

  async remove(table: TableName, id: number): Promise<void> {
    check(await supabase.from(TABLE[table]).delete().eq('id', id));
  },

  async setSetting(key: string, value: string): Promise<void> {
    check(await supabase.from('move_settings').upsert({ key, value }));
  },

  async uploadPhoto(blob: Blob, folder = ''): Promise<string> {
    const path = `${folder ? `${folder}/` : ''}${crypto.randomUUID()}.jpg`;
    check(await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    return path;
  },

  async removePhoto(path: string): Promise<void> {
    if (path) await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  },

  async photoUrls(paths: string[]): Promise<Record<string, string>> {
    if (paths.length === 0) return {};
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60 * 6);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
  },

  async photoBlob(path: string): Promise<Blob> {
    return check(await supabase.storage.from(PHOTO_BUCKET).download(path)) as Blob;
  },

  async findPrice(input: {
    image?: { data: string; mimeType: string };
    url?: string;
    name?: string;
    room?: string;
    price?: number;
    store?: string;
  }): Promise<PriceResult> {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/price', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error || `Price lookup failed (${res.status})`);
    return json as PriceResult;
  },

  /** Places a furniture piece into a house photo (or onto an earlier fit) with AI. Returns the saved fit. */
  async fit(input: { furniture_id: number; photo_id?: number; base_fit_id?: number }): Promise<Fit> {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/fit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error || `Virtual fit failed (${res.status})`);
    return json as Fit;
  },
};
