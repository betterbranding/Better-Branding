import { Plus } from 'lucide-react';
import React, { useState } from 'react';
import { type Actions, PHASES, type Task } from '../types';
import { daysUntil, groupBy, shortDate } from '../utils';
import { CheckCircle, Chips, Fab, Field, Sheet } from './ui';

type Draft = Omit<Task, 'id'> & { id?: number };

export const Checklist: React.FC<{ tasks: Task[]; actions: Actions }> = ({ tasks, actions }) => {
  const [filter, setFilter] = useState('todo');
  const [draft, setDraft] = useState<Draft | null>(null);

  const visible = tasks.filter((t) => (filter === 'all' ? true : filter === 'done' ? t.done : !t.done));
  const sections = groupBy(visible, (t) => t.phase, PHASES);
  const overdue = tasks.filter((t) => !t.done && t.due && daysUntil(t.due) < 0).length;

  const save = () => {
    if (!draft) return;
    const { id, ...row } = draft;
    const clean = { ...row, title: row.title.trim(), due: row.due || null };
    if (id) actions.update('tasks', id, clean);
    else actions.create('tasks', clean);
    setDraft(null);
  };

  return (
    <div className="tm-page">
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'todo', label: `To do · ${tasks.filter((t) => !t.done).length}` },
          { value: 'done', label: `Done · ${tasks.filter((t) => t.done).length}` },
          { value: 'all', label: 'All' },
        ]}
      />
      {overdue > 0 && filter !== 'done' && (
        <div className="tm-banner">
          {overdue} task{overdue === 1 ? ' is' : 's are'} past due
        </div>
      )}
      {sections.length === 0 && (
        <div className="tm-empty">{filter === 'done' ? 'Nothing checked off yet.' : 'All done. Nice work!'}</div>
      )}
      {sections.map(([phase, rows]) => {
        const all = tasks.filter((t) => t.phase === phase);
        return (
          <section key={phase} className="tm-section">
            <div className="tm-section-head">
              <h3>{phase}</h3>
              <span>
                {all.filter((t) => t.done).length}/{all.length}
              </span>
            </div>
            <ul className="tm-list">
              {rows.map((t) => {
                const late = !t.done && t.due && daysUntil(t.due) < 0;
                return (
                  <li key={t.id} className={`tm-row ${t.done ? 'is-done' : ''}`} onClick={() => setDraft({ ...t })}>
                    <CheckCircle
                      checked={!!t.done}
                      label={`Mark ${t.title} ${t.done ? 'not done' : 'done'}`}
                      onToggle={() => actions.update('tasks', t.id, { done: t.done ? 0 : 1 })}
                    />
                    <div className="tm-row-main">
                      <div className="tm-row-title">{t.title}</div>
                      {t.notes && <div className="tm-row-sub">{t.notes}</div>}
                    </div>
                    {t.due && <div className={`tm-due ${late ? 'is-late' : ''}`}>{shortDate(t.due)}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <Fab
        label="Add task"
        icon={<Plus size={18} strokeWidth={2.5} />}
        onClick={() => setDraft({ title: '', phase: PHASES[0], due: null, done: 0, notes: '' })}
      />
      {draft && (
        <Sheet
          title={draft.id ? 'Edit task' : 'New task'}
          canSave={draft.title.trim().length > 0}
          onClose={() => setDraft(null)}
          onSave={save}
          onDelete={
            draft.id
              ? () => {
                  actions.remove('tasks', draft.id!);
                  setDraft(null);
                }
              : undefined
          }
        >
          <Field label="Task">
            <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <div className="tm-grid-2">
            <Field label="When">
              <select value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: e.target.value })}>
                {PHASES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" value={draft.due ?? ''} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
        </Sheet>
      )}
    </div>
  );
};
