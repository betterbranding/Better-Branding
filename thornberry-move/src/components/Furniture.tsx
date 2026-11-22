import { Camera, ExternalLink, ImagePlus, Link2, Plus, TrendingDown } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, type PriceResult } from '../api';
import { type Actions, type Furniture as FurnitureRow, FURNITURE_ROOMS, type PriceOffer } from '../types';
import { groupBy, money } from '../utils';
import { CheckCircle, Chips, Fab, Field, Sheet } from './ui';

type Draft = {
  id?: number;
  name: string;
  room: string;
  url: string;
  image_path: string;
  qty: string;
  price: string;
  price_low: number | null;
  price_high: number | null;
  store: string;
  notes: string;
  ai_summary: string;
  offers: PriceOffer[];
  bought: number;
  photo?: Blob | null; // newly picked photo, not uploaded yet
  photoPreview?: string | null;
};

function blank(room: string): Draft {
  return {
    name: '',
    room,
    url: '',
    image_path: '',
    qty: '1',
    price: '',
    price_low: null,
    price_high: null,
    store: '',
    notes: '',
    ai_summary: '',
    offers: [],
    bought: 0,
  };
}

// Shrinks a photo to at most 1280px on its long side and re-encodes it as JPEG.
export async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85));
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function range(low: number | null, high: number | null): string {
  if (low && high && Math.round(low) !== Math.round(high)) return `${money(low)}–${money(high)}`;
  return '';
}

/** Lowest-priced offer that beats the item's own price, if any. */
function cheapest(f: { price: number; offers?: PriceOffer[] }): PriceOffer | null {
  if (!f.price) return null;
  const lower = (f.offers ?? []).filter((o) => o.price && o.price < f.price - 0.5);
  return lower.length ? lower.reduce((a, b) => (b.price! < a.price! ? b : a)) : null;
}

export const Furniture: React.FC<{ furniture: FurnitureRow[]; actions: Actions }> = ({ furniture, actions }) => {
  const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const paths = useMemo(() => furniture.map((f) => f.image_path).filter(Boolean).sort().join('|'), [furniture]);
  useEffect(() => {
    const missing = paths ? paths.split('|').filter((p) => !photoUrls[p]) : [];
    if (missing.length === 0) return;
    api
      .photoUrls(missing)
      .then((urls) => setPhotoUrls((prev) => ({ ...prev, ...urls })))
      .catch((err: unknown) => console.error('Photo links failed:', err));
  }, [paths]);

  const rooms = [...new Set([...FURNITURE_ROOMS.filter((r) => furniture.some((f) => f.room === r)), ...furniture.map((f) => f.room)])];
  const visible = furniture.filter((f) =>
    filter === 'all' ? true : filter === 'wish' ? !f.bought : filter === 'bought' ? !!f.bought : f.room === filter,
  );
  const sections = groupBy(visible, (f) => f.room, FURNITURE_ROOMS);
  const wishTotal = furniture.filter((f) => !f.bought).reduce((s, f) => s + f.qty * f.price, 0);
  const boughtTotal = furniture.filter((f) => f.bought).reduce((s, f) => s + f.qty * f.price, 0);

  const close = () => {
    if (draft?.photoPreview) URL.revokeObjectURL(draft.photoPreview);
    setDraft(null);
    setAiError(null);
    setLooking(false);
  };

  const open = (f: FurnitureRow) =>
    setDraft({
      id: f.id,
      name: f.name,
      room: f.room,
      url: f.url,
      image_path: f.image_path,
      qty: String(f.qty || 1),
      price: f.price ? String(f.price) : '',
      price_low: f.price_low,
      price_high: f.price_high,
      store: f.store,
      notes: f.notes,
      ai_summary: f.ai_summary,
      offers: f.offers ?? [],
      bought: f.bought,
    });

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !draft) return;
    const small = await shrink(file);
    if (draft.photoPreview) URL.revokeObjectURL(draft.photoPreview);
    setDraft({ ...draft, photo: small, photoPreview: URL.createObjectURL(small) });
  };

  const photoData = async (d: Draft) => {
    const blob = d.photo ?? (d.image_path ? await api.photoBlob(d.image_path) : null);
    return blob ? { data: await toBase64(blob), mimeType: blob.type || 'image/jpeg' } : undefined;
  };

  // Finds comparable pieces from other stores with live prices. Never changes the item's own link or store.
  const findComparisons = async () => {
    if (!draft) return;
    setLooking(true);
    setAiError(null);
    try {
      const r: PriceResult = await api.findPrice({
        image: await photoData(draft),
        url: draft.url.trim() || undefined,
        name: draft.name.trim() || undefined,
        room: draft.room,
        price: Number(draft.price) || undefined,
        store: draft.store.trim() || undefined,
      });
      const patch = { ai_summary: r.summary, offers: r.offers ?? [] };
      setDraft(
        (d) =>
          d && {
            ...d,
            ...patch,
            name: d.name.trim() || r.name || d.name,
            price: d.price || (r.price ? String(Math.round(r.price * 100) / 100) : ''),
          },
      );
      // Saved pieces keep their new comparisons right away, even without tapping Save.
      if (draft.id) actions.update('furniture', draft.id, patch);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      let image_path = draft.image_path;
      if (draft.photo) {
        image_path = await api.uploadPhoto(draft.photo);
        if (draft.photoPreview) setPhotoUrls((p) => ({ ...p, [image_path]: draft.photoPreview! }));
        if (draft.image_path) api.removePhoto(draft.image_path).catch(() => undefined);
      }
      const row = {
        name: draft.name.trim(),
        room: draft.room,
        url: draft.url.trim(),
        image_path,
        qty: Math.max(1, Number(draft.qty) || 1),
        price: Number(draft.price) || 0,
        price_low: draft.price_low,
        price_high: draft.price_high,
        store: draft.store.trim(),
        notes: draft.notes.trim(),
        ai_summary: draft.ai_summary,
        offers: draft.offers,
        bought: draft.bought,
      };
      if (draft.id) actions.update('furniture', draft.id, row);
      else actions.create('furniture', row);
      setDraft(null);
      setAiError(null);
    } catch (err) {
      setAiError(err instanceof Error ? `Couldn’t save: ${err.message}` : 'Couldn’t save.');
    } finally {
      setSaving(false);
    }
  };

  const preview = draft?.photoPreview || (draft?.image_path ? photoUrls[draft.image_path] : '');

  return (
    <div className="tm-page">
      <div className="tm-card tm-mini-summary">
        <div>
          <small>Wishlist</small>
          <strong>{furniture.filter((f) => !f.bought).length} pieces</strong>
        </div>
        <div>
          <small>Wishlist total</small>
          <strong>{money(wishTotal)}</strong>
        </div>
        <div>
          <small>Bought</small>
          <strong className="tm-red">{money(boughtTotal)}</strong>
        </div>
      </div>
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'wish', label: 'Wishlist' },
          { value: 'bought', label: 'Bought' },
          ...rooms.map((r) => ({ value: r, label: r })),
        ]}
      />
      {furniture.length === 0 && (
        <div className="tm-empty">
          Snap a photo or paste a link to start your furniture wishlist. AI will find comparable pieces and live prices.
        </div>
      )}
      {furniture.length > 0 && sections.length === 0 && <div className="tm-empty">Nothing here yet.</div>}
      {sections.map(([room, rows]) => (
        <section key={room} className="tm-section">
          <div className="tm-section-head">
            <h3>{room}</h3>
            <span>{money(rows.reduce((s, f) => s + f.qty * f.price, 0))}</span>
          </div>
          <ul className="tm-list">
            {rows.map((f) => (
              <li key={f.id} className={`tm-row tm-furn-row ${f.bought ? 'is-done' : ''}`} onClick={() => open(f)}>
                <CheckCircle
                  checked={!!f.bought}
                  label={`Mark ${f.name} ${f.bought ? 'not bought' : 'bought'}`}
                  onToggle={() => actions.update('furniture', f.id, { bought: f.bought ? 0 : 1 })}
                />
                <div className="tm-thumb">
                  {f.image_path && photoUrls[f.image_path] ? (
                    <img src={photoUrls[f.image_path]} alt="" loading="lazy" />
                  ) : (
                    <ImagePlus size={20} />
                  )}
                </div>
                <div className="tm-row-main">
                  <div className="tm-row-title">{f.name}</div>
                  <div className="tm-row-sub">
                    {[f.store, range(f.price_low, f.price_high), f.qty > 1 ? `Qty ${f.qty}` : ''].filter(Boolean).join(' · ') ||
                      'No price yet'}
                  </div>
                  {(() => {
                    const best = cheapest(f);
                    return best ? (
                      <div className="tm-save-line">
                        Save {money(f.price - best.price!)} · {best.store || host(best.url)} {money(best.price!)}
                      </div>
                    ) : null;
                  })()}
                </div>
                <div className="tm-row-end">
                  <strong className="tm-price">{f.price ? money(f.qty * f.price) : '—'}</strong>
                  {f.url && (
                    <a
                      className="tm-link-btn"
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Fab
        label="Add furniture"
        icon={<Plus size={18} strokeWidth={2.5} />}
        onClick={() => setDraft(blank(FURNITURE_ROOMS.includes(filter) || rooms.includes(filter) ? filter : FURNITURE_ROOMS[0]))}
      />
      {draft && (
        <Sheet
          title={draft.id ? 'Edit furniture' : 'Add furniture'}
          canSave={draft.name.trim().length > 0 && !saving && !looking}
          onClose={close}
          onSave={save}
          onDelete={
            draft.id
              ? () => {
                  actions.remove('furniture', draft.id!);
                  api.removePhoto(draft.image_path).catch(() => undefined);
                  close();
                }
              : undefined
          }
        >
          <button type="button" className="tm-photo-pick" onClick={() => fileInput.current?.click()}>
            {preview ? (
              <img src={preview} alt="Furniture photo" />
            ) : (
              <span>
                <Camera size={26} />
                Add a photo
              </span>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pickPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Field label="Link (optional)">
            <div className="tm-input-icon">
              <Link2 size={16} />
              <input
                inputMode="url"
                placeholder="Paste a product link"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </div>
          </Field>
          {(() => {
            const empty = !draft.photo && !draft.image_path && !draft.url.trim() && !draft.name.trim();
            return (
              <button type="button" className="tm-ai-btn tm-ai-btn-solid" disabled={looking || empty} onClick={findComparisons}>
                {looking ? <span className="tm-spinner tm-spinner-sm tm-spinner-light" /> : <TrendingDown size={17} />}
                {looking ? 'Comparing stores…' : 'Find comparisons'}
              </button>
            );
          })()}
          {aiError && <div className="tm-banner">{aiError}</div>}
          {draft.ai_summary && (
            <div className="tm-ai-result">
              <h4 className="tm-ai-head">Comparable pieces · live prices</h4>
              <p>{draft.ai_summary}</p>
              {draft.offers.length > 0 && (
                <ul>
                  {draft.offers.map((o, i) => (
                    <li key={i}>
                      <span className="tm-offer-main">
                        <a href={o.url} target="_blank" rel="noreferrer">
                          {o.store || host(o.url)}
                        </a>
                        {o.name && <small>{o.name}</small>}
                        {o.note && <small className="tm-offer-note">{o.note}</small>}
                      </span>
                      <span className="tm-offer-price">
                        <strong>{o.price ? money(o.price, o.price % 1 !== 0) : '—'}</strong>
                        {o.price && Number(draft.price) > o.price + 0.5 && <small>Save {money(Number(draft.price) - o.price)}</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field label="Name">
            <input value={draft.name} placeholder="e.g. Sectional sofa" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Room">
            <select value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })}>
              {[...new Set([...FURNITURE_ROOMS, ...rooms])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <div className="tm-grid-2">
            <Field label="Price each ($)">
              <input
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^0-9.]/g, '') })}
              />
            </Field>
            <Field label="Quantity">
              <input
                inputMode="numeric"
                value={draft.qty}
                onChange={(e) => setDraft({ ...draft, qty: e.target.value.replace(/[^0-9]/g, '') })}
              />
            </Field>
          </div>
          <Field label="Store">
            <input value={draft.store} onChange={(e) => setDraft({ ...draft, store: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <label className="tm-toggle-row">
            <span>Bought</span>
            <input
              type="checkbox"
              className="tm-switch"
              checked={!!draft.bought}
              onChange={(e) => setDraft({ ...draft, bought: e.target.checked ? 1 : 0 })}
            />
          </label>
        </Sheet>
      )}
    </div>
  );
};
