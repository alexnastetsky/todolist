import { createBrowserRouter, RouterProvider, Link, NavLink, Outlet } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { api, type Me, type Person } from './lib/api';
import { AppContext } from './AppContext';
import { NotificationBell } from './components/NotificationBell';
import { TodayPage } from './pages/TodayPage';
import { ListsPage } from './pages/ListsPage';
import { ListPage } from './pages/ListPage';
import { SomedayPage } from './pages/SomedayPage';
import { HistoryPage } from './pages/HistoryPage';
import { ArchivePage } from './pages/ArchivePage';
import { SettingsPage } from './pages/SettingsPage';
import { TaskPage } from './pages/TaskPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(() => {
    api
      .get<Me>('/me')
      .then((m) => {
        setMe(m);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const refreshPeople = useCallback(() => {
    api
      .get<Person[]>('/people')
      .then(setPeople)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshMe();
    refreshPeople();
    // Light poll keeps the unread badge honest while the tab stays open.
    const t = setInterval(refreshMe, 60_000);
    return () => clearInterval(t);
  }, [refreshMe, refreshPeople]);

  // Full-screen error only when we have nothing to show. If a background
  // refresh fails while the app is already rendered, keep the working UI —
  // the next poll (or an auth reload) recovers on its own.
  if (error && !me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="font-medium">Could not load Todos</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <button
            type="button"
            className="mt-3 px-3 py-1.5 rounded-md border text-sm font-medium hover:bg-muted transition-colors"
            onClick={() => {
              setError(null);
              refreshMe();
              refreshPeople();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="min-h-screen p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ me, people, refreshMe, refreshPeople }}>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b px-3 md:px-6 py-2.5 md:py-3 flex items-center gap-x-3 sticky top-0 bg-background z-10">
          <h1 className="text-base md:text-lg font-semibold text-foreground shrink-0">
            <Link to="/" className="hover:opacity-80 transition-opacity">
              ✓ Todos
            </Link>
          </h1>
          <nav className="flex gap-1 overflow-x-auto">
            <NavLink to="/" end className={navLinkClass}>
              Today
            </NavLink>
            <NavLink to="/lists" className={navLinkClass}>
              Lists
            </NavLink>
            <NavLink to="/someday" className={navLinkClass}>
              Someday
            </NavLink>
            <NavLink to="/history" className={navLinkClass}>
              History
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <NotificationBell />
            <NavLink to="/settings" className={navLinkClass} title="Settings">
              ⚙
            </NavLink>
          </div>
        </header>
        <main className="flex-1 w-full max-w-3xl mx-auto px-3 md:px-6 py-4 pb-16">
          <Outlet />
        </main>
      </div>
    </AppContext.Provider>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <Root />,
      children: [
        { path: '/', element: <TodayPage /> },
        { path: '/lists', element: <ListsPage /> },
        { path: '/list/:id', element: <ListPage /> },
        { path: '/someday', element: <SomedayPage /> },
        { path: '/history', element: <HistoryPage /> },
        { path: '/archive', element: <ArchivePage /> },
        { path: '/settings', element: <SettingsPage /> },
        { path: '/task/:id', element: <TaskPage /> },
      ],
    },
  ],
  { basename: '/todolist' }
);

export default function App() {
  return <RouterProvider router={router} />;
}
