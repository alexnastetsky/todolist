import { createContext, useContext } from 'react';
import type { Me, Person } from './lib/api';

export interface AppState {
  me: Me;
  people: Person[];
  refreshMe: () => void;
  refreshPeople: () => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}
