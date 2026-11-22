import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { type Actions, BUDGET_CATEGORIES, type BudgetLine, type Furniture, type Item } from '../types';
import { daysUntil, groupBy, money, shortDate } from '../utils';
import { Fab, Field, Sheet } from './ui';

type Draft = { id?: number; name: string; category: string; estimated: string; actual: string; paid: number; due: string };

export const Budget: React.FC<{
  lines: BudgetLine[];
  items: Item[];
  furniture: Furniture[];
  totalBudget: number | null;
  actions: Actions;
  onOpenItems: () => void;
  onOpenFurniture: () => void;
}> = ({ lines, items, furniture, totalBudget, actions, onOpenItems, onOpenFurniture }) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState('');

  const itemsPlanned = items.reduce((s, i) => s + i.qty * i.cost, 0);
  const itemsSpent = items.filter((i) => i.bought).reduce((s, i) => s + i.qty * i.cost, 0);
  // Furniture counts toward the plan once it's bought; the rest of the wishlist is shown separately.
  const furnitureSpent = furniture.filter((f) => f.bought).reduce((s, f) => s + f.qty * f.price, 0);
  const furnitureWish = furniture.filter((f) => !f.bought).reduce((s, f) => s + f.qty * f.price, 0);
  const planned = lines.reduce((s, l) => s + l.estimated, 0) + itemsPlanned + furnitureSpent;
  const spent = lines.reduce((s, l) => s + l.actual, 0) + itemsSpent + furnitureSpent;
  const base = totalBudget ?? planned;
  const spentPct = base > 0 ? Math.min(100, (spent / base) * 100) : 0;
  const plannedPct = base > 0 ? Math.min(100, (planned / base) * 100) : 0;
  // Within each category, soonest due first; undated lines last.
  const sorted = [...lines].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id - b.id);
  const sections = groupBy(sorted, (l) => l.category, BUDGET_CATEGORIES);
  const isLate = (l: BudgetLine) => !l.paid && !!l.due && daysUntil(l.due) < 0;
  const lateCount = lines.filter(isLate).length;
  const dueSoon = lines.filter((l) => !l.paid && l.due && daysUntil(l.due) >= 0 && daysUntil(l.due) <= 7).length;

  const edit = (l: BudgetLine) =>
    setDraft({
      id: l.id,
      name: l.name,
      category: l.category,
      estimated: l.estimated ? String(l.estimated) : '',
      actual: l.actual ? String(l.actual) : '',
      paid: l.paid,
      due: l.due ?? '',
    });

  const confirmDelete = (id: number, name: string) => {
    if (window.confirm(`Delete "${name}" from the budget?`)) {
      actions.remove('budget', id);
      setDraft(null);
    }
  };

  const saveTotal = () => {
    const n = Number(totalInput.replace(/[^0-9.]/g, ''));
    if (totalInput.trim() && !Number.isNaN(n)) actions.setSetting('total_budget', String(n));
    setEditingTotal(false);
  };

  const save = () => {
    if (!draft) return;
    const row = {
      name: draft.name.trim(),
      category: draft.category,
      estimated: Number(draft.estimated) || 0,
      actual: Number(draft.actual) || 0,
      paid: draft.paid,
      due: draft.due || null,
    };
    if (draft.id) actions.update('budget', draft.id, row);
    else actions.create('budget', row);
    setDraft(null);
  };

  return (
    <div className="tm-page">
      <div className="tm-card tm-summary">
        <div className="tm-summary-top">
          <div>
            <div className="tm-eyebrow">Total move budget</div>
            {editingTotal ? (
              <form
                className="tm-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveTotal();
                }}
              >
                <input
                  autoFocus
                  inputMode="decimal"
                  placeholder="e.g. 5000"
                  value={totalInput}
                  onChange={(e) => setTotalInput(e.target.value)}
                  onBlur={saveTotal}
                />
              </form>
            ) : (
              <button
                type="button"
                className="tm-total"
                onClick={() => {
                  setTotalInput(totalBudget ? String(totalBudget) : '');
                  setEditingTotal(true);
                }}
              >
                {totalBudget !== null ? money(totalBudget) : 'Set budget'}
                <Pencil size={16} className="tm-muted-icon" />
              </button>
            )}
          </div>
        </div>
        <div className="tm-bar">
          <div className="tm-bar-planned" style={{ width: `${plannedPct}%` }} />
          <div className="tm-bar-spent" style={{ width: `${spentPct}%` }} />
        </div>
        <div className="tm-stats">
          <div>
            <span className="tm-dot tm-dot-red" />
            <small>Spent</small>
            <strong>{money(spent)}</strong>
          </div>
          <div>
            <span className="tm-dot tm-dot-pink" />
            <small>Planned</small>
            <strong>{money(planned)}</strong>
          </div>
          <div>
            <small>{totalBudget !== null ? 'Left in budget' : 'Left to spend'}</small>
            <strong className={totalBudget !== null && totalBudget - spent < 0 ? 'tm-red' : ''}>
              {money((totalBudget ?? planned) - spent)}
            </strong>
          </div>
        </div>
        {totalBudget !== null && planned > totalBudget && (
          <div className="tm-banner">Plan is {money(planned - totalBudget)} over budget</div>
        )}
      </div>

      {lateCount > 0 && (
        <div className="tm-banner">
          {lateCount} payment{lateCount === 1 ? ' is' : 's are'} past due
        </div>
      )}
      {lateCount === 0 && dueSoon > 0 && (
        <div className="tm-banner tm-banner-soft">
          {dueSoon} payment{dueSoon === 1 ? '' : 's'} due in the next 7 days
        </div>
      )}

      {sections.map(([category, rows]) => (
        <section key={category} className="tm-section">
          <div className="tm-section-head">
            <h3>{category}</h3>
            <span>{money(rows.reduce((s, r) => s + (r.actual || r.estimated), 0))}</span>
          </div>
          <ul className="tm-list">
            {rows.map((l) => (
              <li key={l.id} className="tm-row" onClick={() => edit(l)}>
                <div className="tm-row-main">
                  <div className="tm-row-title">{l.name}</div>
                  <div className="tm-row-sub">
                    {l.due && (
                      <span className={`tm-due ${isLate(l) ? 'is-late' : ''}`}>
                        {isLate(l) ? 'Overdue' : 'Due'} {shortDate(l.due)} ·{' '}
                      </span>
                    )}
                    Est. {money(l.estimated)}
                    {l.actual > 0 && ` · Actual ${money(l.actual)}`}
                  </div>
                </div>
                <div className="tm-row-end">
                  <strong>{money(l.actual || l.estimated)}</strong>
                  {l.paid ? <span className="tm-tag tm-tag-dark">Paid</span> : null}
                </div>
                <div className="tm-row-actions">
                  <button
                    type="button"
                    className="tm-icon-btn"
                    aria-label={`Edit ${l.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit(l);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="tm-icon-btn tm-icon-btn-danger"
                    aria-label={`Delete ${l.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(l.id, l.name);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="tm-section">
        <div className="tm-section-head">
          <h3>Items needed</h3>
          <span>{money(itemsPlanned)}</span>
        </div>
        <ul className="tm-list">
          <li className="tm-row" onClick={onOpenItems}>
            <div className="tm-row-main">
              <div className="tm-row-title">New-home shopping list</div>
              <div className="tm-row-sub">
                {money(itemsSpent)} bought · {money(itemsPlanned - itemsSpent)} to go
              </div>
            </div>
            <ChevronRight size={18} className="tm-muted-icon" />
          </li>
        </ul>
      </section>

      <section className="tm-section">
        <div className="tm-section-head">
          <h3>Furniture</h3>
          <span>{money(furnitureSpent)}</span>
        </div>
        <ul className="tm-list">
          <li className="tm-row" onClick={onOpenFurniture}>
            <div className="tm-row-main">
              <div className="tm-row-title">Furniture wishlist</div>
              <div className="tm-row-sub">
                {money(furnitureSpent)} bought · {money(furnitureWish)} on the wishlist
              </div>
            </div>
            <ChevronRight size={18} className="tm-muted-icon" />
          </li>
        </ul>
      </section>

      <Fab
        label="Add expense"
        icon={<Plus size={18} strokeWidth={2.5} />}
        onClick={() => setDraft({ name: '', category: BUDGET_CATEGORIES[0], estimated: '', actual: '', paid: 0, due: '' })}
      />
      {draft && (
        <Sheet
          title={draft.id ? 'Edit expense' : 'New expense'}
          canSave={draft.name.trim().length > 0}
          onClose={() => setDraft(null)}
          onSave={save}
          onDelete={draft.id ? () => confirmDelete(draft.id!, draft.name) : undefined}
        >
          <Field label="Expense">
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {BUDGET_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <div className="tm-grid-2">
            <Field label="Estimated ($)">
              <input
                inputMode="decimal"
                value={draft.estimated}
                onChange={(e) => setDraft({ ...draft, estimated: e.target.value.replace(/[^0-9.]/g, '') })}
              />
            </Field>
            <Field label="Actual ($)">
              <input
                inputMode="decimal"
                value={draft.actual}
                onChange={(e) => setDraft({ ...draft, actual: e.target.value.replace(/[^0-9.]/g, '') })}
              />
            </Field>
          </div>
          <Field label="Due date">
            <input type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
          </Field>
          <label className="tm-toggle-row">
            <span>Paid</span>
            <input
              type="checkbox"
              className="tm-switch"
              checked={!!draft.paid}
              onChange={(e) => setDraft({ ...draft, paid: e.target.checked ? 1 : 0 })}
            />
          </label>
        </Sheet>
      )}
    </div>
  );
};
