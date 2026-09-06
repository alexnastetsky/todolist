import { useEffect, useState } from 'react';

// Tracks browser connectivity. navigator.onLine only reports whether a network
// interface exists, so it is reliable for "definitely offline" and optimistic
// about "online" — which is the right bias here: the API layer already surfaces
// a real failure when a request can't complete.
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
