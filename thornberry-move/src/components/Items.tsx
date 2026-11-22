import { Plus } from 'lucide-react';
import React, { useState } from 'react';
import { type Actions, type Item, ROOMS } from '../types';
import { groupBy, money } from '../utils';
import { CheckCircle, Chips, Fab, Field, Sheet } from './ui';

type Draft = { id?: number; name: string; room: string; qty: string; cost: string; bought: number; priority: string };

export const Items: React.FC<{ items: Item[]; actions: Actions }> = ({ items, actions }) => {
  const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);

  const rooms = [...new Set([...ROOMS.filter((r) => items.some((i) => i.room === r)), ...items.map((i) => i.room)])];
  const visible = items.filter((i) =>
    filter === 'all' ? true : filter === 'need' ? !i.bought : filter === 'must' ? i.priority === 'high' : i.room === filter,
  );
  const sections = groupBy(visible, (i) => i.room, ROOMS);
  const bought = items.filter((i) => i.bought);
  const toBuy = items.filter((i) => !i.bought).reduce((s, i) => s + i.qty * i.cost, 0);

  const save = () => {
    if (!draft) return;
    const row = {
      name: draft.name.trim(),
      room: draft.room,
      qty: Math.max(1, Number(draft.qty) || 1),
      cost: Number(draft.cost) || 0,
      bought: draft.bought,
      priority: draft.priority,
    };
    if (draft.id) actions.update('items', draft.id, row);
    else actions.create('items', row);
    setDraft(null);
  };

  return (
    <div className="tm-page">
      <div className="tm-card tm-mini-summary">
        <div>
          <small>Bought</small>
          <strong>
            {bought.length} of {items.length}
          </strong>
        </div>
        <div>
          <small>Left to buy</small>
          <strong>{money(toBuy)}</strong>
        </div>
        <div>
          <small>Must-haves left</small>
          <strong className="tm-red">{items.filter((i) => !i.bought && i.priority === 'high').length}</strong>
        </div>
      </div>
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'need', label: 'Still need' },
          { value: 'must', label: 'Must-haves' },
          ...rooms.map((r) => ({ value: r, label: r })),
        ]}
      />
      {sections.length === 0 && <div className="tm-empty">Nothing here yet.</div>}
      {sections.map(([room, rows]) => (
        <section key={room} className="tm-section">
          <div className="tm-section-head">
            <h3>{room}</h3>
            <span>{money(rows.reduce((s, i) => s + i.qty * i.cost, 0))}</span>
          </div>
          <ul className="tm-list">
            {rows.map((i) => (
              <li
                key={i.id}
                className={`tm-row ${i.bought ? 'is-done' : ''}`}
                onClick={() =>
                  setDraft({
                    id: i.id,
                    name: i.name,
                    room: i.room,
                    qty: String(i.qty),
                    cost: i.cost ? String(i.cost) : '',
                    bought: i.bought,
                    priority: i.priority,
                  })
                }
              >
                <CheckCircle
                  checked={!!i.bought}
                  label={`Mark ${i.name} ${i.bought ? 'not bought' : 'bought'}`}
                  onToggle={() => actions.update('items', i.id, { bought: i.bought ? 0 : 1 })}
                />
                <div className="tm-row-main">
                  <div className="tm-row-title">
                    {i.name}
                    {i.priority === 'high' && !i.bought && <span className="tm-tag">Must-have</span>}
                  </div>
                  <div className="tm-row-sub">
                    Qty {i.qty}
                    {i.cost > 0 && ` · ${money(i.cost, i.cost % 1 !== 0)} each`}
                  </div>
                </div>
                <strong className="tm-price">{money(i.qty * i.cost)}</strong>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Fab
        label="Add item"
        icon={<Plus size={18} strokeWidth={2.5} />}
        onClick={() =>
          setDraft({
            name: '',
            room: ROOMS.includes(filter) || rooms.includes(filter) ? filter : ROOMS[0],
            qty: '1',
            cost: '',
            bought: 0,
            priority: filter === 'must' ? 'high' : 'normal',
          })
        }
      />
      {draft && (
        <Sheet
          title={draft.id ? 'Edit item' : 'New item'}
          canSave={draft.name.trim().length > 0}
          onClose={() => setDraft(null)}
          onSave={save}
          onDelete={
            draft.id
              ? () => {
                  actions.remove('items', draft.id!);
                  setDraft(null);
                }
              : undefined
          }
        >
          <Field label="Item">
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Room">
            <select value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })}>
              {[...new Set([...ROOMS, ...rooms])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <div className="tm-grid-2">
            <Field label="Quantity">
              <input
                inputMode="numeric"
                value={draft.qty}
                onChange={(e) => setDraft({ ...draft, qty: e.target.value.replace(/[^0-9]/g, '') })}
              />
            </Field>
            <Field label="Price each ($)">
              <input
                inputMode="decimal"
                value={draft.cost}
                onChange={(e) => setDraft({ ...draft, cost: e.target.value.replace(/[^0-9.]/g, '') })}
              />
            </Field>
          </div>
          <label className="tm-toggle-row">
            <span>Must-have for move-in</span>
            <input
              type="checkbox"
              className="tm-switch"
              checked={draft.priority === 'high'}
              onChange={(e) => setDraft({ ...draft, priority: e.target.checked ? 'high' : 'normal' })}
            />
          </label>
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
