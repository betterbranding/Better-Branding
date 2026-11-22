// main.tsx: Thornberry Move — to-dos, budget, shopping list and furniture wishlist for the 12/15 move.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import './app.css';
import { api } from './api';
import { Budget } from './components/Budget';
import { Checklist } from './components/Checklist';
import { Header } from './components/Header';
import { Furniture } from './components/Furniture';
import { Items } from './components/Items';
import { Rooms } from './components/Rooms';
import { Login } from './Login';
import { configured, supabase } from './supabase';
import type { Actions, AppState, Tab, TableName } from './types';

type Row = { id: number };

function withRows(d: AppState, table: TableName, fn: (rows: Row[]) => Row[]): AppState {
  return { ...d, [table]: fn(d[table] as Row[]) } as AppState;
}

const Spinner: React.FC = () => (
  <div className="tm-loading">
    <span className="tm-spinner" />
  </div>
);

const Planner: React.FC<{ onSignOut: () => void }> = ({ onSignOut }) => {
  const [data, setData] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('checklist');

  const load = useCallback(() => {
    api
      .state()
      .then((s) => {
        setData(s);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        console.error('Failed to load move plan:', err);
        setLoadError('Couldn’t load your move plan.');
      });
  }, []);

  useEffect(load, [load]);

  // Pick up changes the other person made when the tab regains focus.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const fail = useCallback(
    (err: unknown) => {
      console.error('Save failed:', err);
      setToast('Couldn’t save that change. Reloading…');
      setTimeout(() => setToast(null), 3000);
      load();
    },
    [load],
  );

  const actions: Actions = useMemo(
    () => ({
      create: (table, row) => {
        const tempId = -Date.now();
        setData((d) => d && withRows(d, table, (rows) => [...rows, { ...row, id: tempId }]));
        api
          .create<Row>(table, row)
          .then((saved) => setData((d) => d && withRows(d, table, (rows) => rows.map((r) => (r.id === tempId ? saved : r)))))
          .catch(fail);
      },
      update: (table, id, patch) => {
        setData((d) => d && withRows(d, table, (rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r))));
        api.update(table, id, patch).catch(fail);
      },
      remove: (table, id) => {
        setData((d) => d && withRows(d, table, (rows) => rows.filter((r) => r.id !== id)));
        api.remove(table, id).catch(fail);
      },
      setSetting: (key, value) => {
        setData((d) => d && { ...d, settings: { ...d.settings, [key]: value } });
        api.setSetting(key, value).catch(fail);
      },
    }),
    [fail],
  );

  if (!data) {
    return loadError ? (
      <div className="tm-loading">
        <p>{loadError}</p>
        <button type="button" className="tm-btn tm-btn-red" onClick={load}>
          Try again
        </button>
      </div>
    ) : (
      <Spinner />
    );
  }

  const totalBudget = data.settings.total_budget ? Number(data.settings.total_budget) : null;

  return (
    <div className="tm-app">
      <Header data={data} tab={tab} onTab={setTab} onSignOut={onSignOut} />
      <main>
        {tab === 'checklist' && <Checklist tasks={data.tasks} actions={actions} />}
        {tab === 'budget' && (
          <Budget
            lines={data.budget}
            items={data.items}
            furniture={data.furniture}
            totalBudget={totalBudget}
            actions={actions}
            onOpenItems={() => setTab('items')}
            onOpenFurniture={() => setTab('furniture')}
          />
        )}
        {tab === 'items' && <Items items={data.items} actions={actions} />}
        {tab === 'furniture' && <Furniture furniture={data.furniture} actions={actions} />}
        {tab === 'rooms' && (
          <Rooms
            photos={data.photos}
            fits={data.fits}
            furniture={data.furniture}
            actions={actions}
            onAdded={(table, row) => setData((d) => d && withRows(d, table, (rows) => [row as Row, ...rows]))}
          />
        )}
      </main>
      {toast && <div className="tm-toast">{toast}</div>}
    </div>
  );
};

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setAllowed(null);
    if (!session) return;
    api
      .isAllowed()
      .then(setAllowed)
      .catch((err: unknown) => {
        console.error('Access check failed:', err);
        setAllowed(false);
      });
  }, [session?.user?.id]);

  const signIn = useCallback(async () => {
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (error) setMessage(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  if (!configured) {
    return <Login onGoogle={() => undefined} message="This app isn’t connected to its database yet." />;
  }
  if (session === undefined) return <Spinner />;
  if (!session) return <Login onGoogle={signIn} message={message} />;
  if (allowed === null) return <Spinner />;
  if (!allowed) return <Login onGoogle={signIn} denied={session.user.email ?? 'This account'} onSignOut={signOut} />;
  return <Planner onSignOut={signOut} />;
};

createRoot(document.getElementById('root')!).render(<App />);
