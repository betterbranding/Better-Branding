import React from 'react';
import type { AppState, Tab } from '../types';
import { daysUntil, longDate, money } from '../utils';

const Bullseye: React.FC = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
    <circle cx="17" cy="17" r="16" fill="#fff" />
    <circle cx="17" cy="17" r="11" fill="#cc0000" />
    <circle cx="17" cy="17" r="6" fill="#fff" />
  </svg>
);

export const Header: React.FC<{ data: AppState; tab: Tab; onTab: (t: Tab) => void; onSignOut?: () => void }> = ({
  data,
  tab,
  onTab,
  onSignOut,
}) => {
  const moveDate = data.settings.move_date ?? '2026-12-15';
  const days = daysUntil(moveDate);
  const tasksDone = data.tasks.filter((t) => t.done).length;
  const itemsBought = data.items.filter((i) => i.bought).length;
  const spent =
    data.budget.reduce((s, b) => s + (b.actual || 0), 0) +
    data.items.filter((i) => i.bought).reduce((s, i) => s + i.qty * i.cost, 0) +
    data.furniture.filter((f) => f.bought).reduce((s, f) => s + f.qty * f.price, 0);
  const pct = data.tasks.length ? Math.round((tasksDone / data.tasks.length) * 100) : 0;

  const tabs: Array<{ id: Tab; label: string; count: string }> = [
    { id: 'checklist', label: 'To-Do', count: `${tasksDone}/${data.tasks.length}` },
    { id: 'budget', label: 'Budget', count: money(spent) },
    { id: 'items', label: 'Items', count: `${itemsBought}/${data.items.length}` },
    { id: 'furniture', label: 'Furniture', count: `${data.furniture.length}` },
  ];

  return (
    <header className="tm-header-wrap">
      <div className="tm-header">
        {onSignOut && (
          <button type="button" className="tm-signout" onClick={onSignOut}>
            Sign out
          </button>
        )}
        <div className="tm-brand">
          <Bullseye />
          <div>
            <div className="tm-brand-title">9008 Thornberry Dr</div>
            <div className="tm-brand-sub">North Richland Hills, TX</div>
          </div>
        </div>
        <div className="tm-countdown">
          {days > 0 ? (
            <>
              <span className="tm-days">{days}</span>
              <span className="tm-days-label">
                day{days === 1 ? '' : 's'} until move day
                <br />
                <strong>{longDate(moveDate)}</strong>
              </span>
            </>
          ) : days === 0 ? (
            <span className="tm-days-big">It’s moving day!</span>
          ) : (
            <span className="tm-days-big">Welcome home.</span>
          )}
        </div>
        <div className="tm-progress" aria-label={`${pct}% of to-dos complete`}>
          <div className="tm-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="tm-progress-label">{pct}% of to-dos complete</div>
      </div>
      <nav className="tm-tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`tm-tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => onTab(t.id)}>
            <span>{t.label}</span>
            <small>{t.count}</small>
          </button>
        ))}
      </nav>
    </header>
  );
};
