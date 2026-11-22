// Rooms: photos of 9008 Thornberry Dr plus an AI "virtual fit" that places wishlist furniture into each room.
import { Camera, Download, ImagePlus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { type Actions, type Fit, type Furniture, FURNITURE_ROOMS, type HousePhoto, type TableName } from '../types';
import { groupBy } from '../utils';
import { shrink } from './Furniture';
import { Chips, Fab, Field, Sheet } from './ui';

type Viewer = { photoId: number; fitId: number | null };
type NewPhoto = { label: string; room: string; blob: Blob | null; preview: string | null };

export const Rooms: React.FC<{
  photos: HousePhoto[];
  fits: Fit[];
  furniture: Furniture[];
  actions: Actions;
  onAdded: (table: TableName, row: object) => void;
}> = ({ photos, fits, furniture, actions, onAdded }) => {
  const [filter, setFilter] = useState('all');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<NewPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Signed links for every image on this tab (house photos, fits and furniture thumbnails).
  const paths = useMemo(
    () =>
      [...photos.map((p) => p.image_path), ...fits.map((f) => f.image_path), ...furniture.map((f) => f.image_path)]
        .filter(Boolean)
        .sort()
        .join('|'),
    [photos, fits, furniture],
  );
  useEffect(() => {
    const missing = paths ? paths.split('|').filter((p) => !urls[p]) : [];
    if (missing.length === 0) return;
    api
      .photoUrls(missing)
      .then((u) => setUrls((prev) => ({ ...prev, ...u })))
      .catch((err: unknown) => console.error('Photo links failed:', err));
  }, [paths]);

  const rooms = [...new Set([...FURNITURE_ROOMS.filter((r) => photos.some((p) => p.room === r)), ...photos.map((p) => p.room)])];
  const visible = photos.filter((p) => filter === 'all' || p.room === filter);
  const sections = groupBy(visible, (p) => p.room, FURNITURE_ROOMS);
  const fitsFor = (photoId: number) => fits.filter((f) => f.photo_id === photoId);

  const photo = viewer ? photos.find((p) => p.id === viewer.photoId) ?? null : null;
  const fit = viewer?.fitId ? fits.find((f) => f.id === viewer.fitId) ?? null : null;
  const shown = fit?.image_path ?? photo?.image_path ?? '';

  // Pieces for this room first, then everything else.
  const choices = useMemo(() => {
    if (!photo) return [];
    const same = furniture.filter((f) => f.room === photo.room);
    return [...same, ...furniture.filter((f) => f.room !== photo.room)];
  }, [photo?.id, furniture]);

  const openPhoto = (p: HousePhoto) => {
    setViewer({ photoId: p.id, fitId: null });
    setError(null);
    const first = furniture.find((f) => f.room === p.room) ?? furniture[0];
    setPick(first ? first.id : null);
  };

  const place = async (onTopOfFit: boolean) => {
    if (!photo || !pick || placing) return;
    const piece = furniture.find((f) => f.id === pick);
    setPlacing(piece?.name ?? 'your piece');
    setError(null);
    try {
      const row = await api.fit(onTopOfFit && fit ? { furniture_id: pick, base_fit_id: fit.id } : { furniture_id: pick, photo_id: photo.id });
      const u = await api.photoUrls([row.image_path]).catch(() => ({}) as Record<string, string>);
      setUrls((prev) => ({ ...prev, ...u }));
      onAdded('fits', row);
      setViewer({ photoId: photo.id, fitId: row.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Virtual fit failed. Try again.');
    } finally {
      setPlacing(null);
    }
  };

  const deleteFit = (f: Fit) => {
    if (!confirm(`Delete this view with “${f.furniture_name}”?`)) return;
    actions.remove('fits', f.id);
    api.removePhoto(f.image_path).catch(() => undefined);
    setViewer((v) => (v ? { ...v, fitId: null } : v));
  };

  const deletePhoto = (p: HousePhoto) => {
    if (!confirm(`Delete “${p.label}” and its virtual fits?`)) return;
    fitsFor(p.id).forEach((f) => api.removePhoto(f.image_path).catch(() => undefined));
    actions.remove('photos', p.id);
    api.removePhoto(p.image_path).catch(() => undefined);
    setViewer(null);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file || !adding) return;
    const small = await shrink(file);
    if (adding.preview) URL.revokeObjectURL(adding.preview);
    setAdding({ ...adding, blob: small, preview: URL.createObjectURL(small) });
  };

  const savePhoto = async () => {
    if (!adding?.blob) return;
    setSaving(true);
    try {
      const path = await api.uploadPhoto(adding.blob, 'house');
      actions.create('photos', {
        label: adding.label.trim() || adding.room,
        room: adding.room,
        image_path: path,
        source: 'Added by you',
        sort: 100 + photos.length,
      });
      if (adding.preview) URL.revokeObjectURL(adding.preview);
      setAdding(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tm-page">
      <div className="tm-card tm-rooms-intro">
        <Sparkles size={18} />
        <p>
          <strong>Virtual fit.</strong> Tap a room, pick a furniture piece, and AI places it in the photo at real size.
        </p>
      </div>
      {rooms.length > 1 && (
        <Chips
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All rooms' }, ...rooms.map((r) => ({ value: r, label: r }))]}
        />
      )}
      {photos.length === 0 && <div className="tm-empty">No room photos yet. Add one to try a virtual fit.</div>}
      {sections.map(([room, rows]) => (
        <section key={room} className="tm-section">
          <div className="tm-section-head">
            <h3>{room}</h3>
            <span>
              {rows.length} photo{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="tm-photo-grid">
            {rows.map((p) => {
              const n = fitsFor(p.id).length;
              const latest = fitsFor(p.id)[0];
              const src = urls[latest?.image_path ?? ''] ?? urls[p.image_path];
              return (
                <button key={p.id} type="button" className="tm-photo-tile" onClick={() => openPhoto(p)}>
                  {src ? <img src={src} alt={p.label} loading="lazy" /> : <span className="tm-photo-ph" />}
                  {n > 0 && <span className="tm-fit-badge">{n} fit{n === 1 ? '' : 's'}</span>}
                  <span className="tm-photo-label">{p.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {photos.length > 0 && <p className="tm-rooms-note">Room photos: Zillow, from the 2022 listing.</p>}
      <Fab
        label="Add room photo"
        icon={<Plus size={18} strokeWidth={2.5} />}
        onClick={() => setAdding({ label: '', room: rooms.includes(filter) ? filter : 'Living Room', blob: null, preview: null })}
      />

      {photo && (
        <div className="tm-overlay" onClick={() => !placing && setViewer(null)}>
          <div className="tm-sheet tm-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="tm-sheet-head">
              <h2>{photo.label}</h2>
              <button type="button" className="tm-icon-btn" aria-label="Close" onClick={() => !placing && setViewer(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="tm-viewer-stage">
              {urls[shown] ? <img src={urls[shown]} alt={fit ? `${photo.label} with ${fit.furniture_name}` : photo.label} /> : <span className="tm-photo-ph" />}
              {placing && (
                <div className="tm-viewer-busy">
                  <span className="tm-spinner" />
                  <strong>Placing {placing}…</strong>
                  <small>About 15–30 seconds</small>
                </div>
              )}
            </div>
            <div className="tm-viewer-caption">
              <span>{fit ? `With ${fit.furniture_name}` : `Original photo · ${photo.source || 'House photo'}`}</span>
              {fit && (
                <span className="tm-viewer-tools">
                  <a className="tm-link-btn" href={urls[fit.image_path]} target="_blank" rel="noreferrer" aria-label="Open full size">
                    <Download size={16} />
                  </a>
                  <button type="button" className="tm-link-btn" aria-label="Delete this view" onClick={() => deleteFit(fit)}>
                    <Trash2 size={16} />
                  </button>
                </span>
              )}
            </div>

            <div className="tm-strip">
              <button
                type="button"
                className={`tm-strip-item ${!fit ? 'is-active' : ''}`}
                onClick={() => setViewer({ photoId: photo.id, fitId: null })}
              >
                {urls[photo.image_path] ? <img src={urls[photo.image_path]} alt="" /> : <span className="tm-photo-ph" />}
                <small>Original</small>
              </button>
              {fitsFor(photo.id).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`tm-strip-item ${fit?.id === f.id ? 'is-active' : ''}`}
                  onClick={() => setViewer({ photoId: photo.id, fitId: f.id })}
                >
                  {urls[f.image_path] ? <img src={urls[f.image_path]} alt="" /> : <span className="tm-photo-ph" />}
                  <small>{f.furniture_name}</small>
                </button>
              ))}
            </div>

            <div className="tm-sheet-body">
              <h4 className="tm-ai-head">Try a piece here</h4>
              {furniture.length === 0 ? (
                <div className="tm-empty">Add pieces on the Furniture tab first.</div>
              ) : (
                <div className="tm-piece-row">
                  {choices.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`tm-piece ${pick === f.id ? 'is-active' : ''}`}
                      onClick={() => setPick(f.id)}
                    >
                      <span className="tm-piece-img">
                        {f.image_path && urls[f.image_path] ? <img src={urls[f.image_path]} alt="" loading="lazy" /> : <ImagePlus size={20} />}
                      </span>
                      <small>{f.name}</small>
                    </button>
                  ))}
                </div>
              )}
              {error && <div className="tm-banner">{error}</div>}
            </div>
            <div className="tm-sheet-foot">
              {fit && (
                <button type="button" className="tm-btn tm-btn-ghost" disabled={!pick || !!placing} onClick={() => place(true)}>
                  Add to this view
                </button>
              )}
              <button type="button" className="tm-btn tm-btn-red" disabled={!pick || !!placing} onClick={() => place(false)}>
                {fit ? 'Try on original' : 'Place it in the room'}
              </button>
            </div>
            {photo.source === 'Added by you' && (
              <button type="button" className="tm-viewer-delete" onClick={() => deletePhoto(photo)}>
                Delete this room photo
              </button>
            )}
          </div>
        </div>
      )}

      {adding && (
        <Sheet
          title="Add room photo"
          canSave={!!adding.blob && !saving}
          onClose={() => {
            if (adding.preview) URL.revokeObjectURL(adding.preview);
            setAdding(null);
          }}
          onSave={savePhoto}
        >
          <button type="button" className="tm-photo-pick" onClick={() => fileInput.current?.click()}>
            {adding.preview ? (
              <img src={adding.preview} alt="Room photo" />
            ) : (
              <span>
                <Camera size={26} />
                Take or choose a photo
              </span>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Field label="Name">
            <input value={adding.label} placeholder="e.g. Game room" onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
          </Field>
          <Field label="Room">
            <select value={adding.room} onChange={(e) => setAdding({ ...adding, room: e.target.value })}>
              {[...new Set([...FURNITURE_ROOMS, ...rooms])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        </Sheet>
      )}
    </div>
  );
};
