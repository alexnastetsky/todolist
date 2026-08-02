import { Request, Response } from 'express';

// Duplicated from pool-routes on purpose: the todolist module must not import
// world cup code so it can be lifted out into its own app wholesale.
export function getUserEmail(req: Request): string | null {
  const header = req.header('x-forwarded-email');
  if (header) return header.toLowerCase();
  // Local development only — the Apps proxy always sets the header in prod.
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_USER_EMAIL) {
    return process.env.DEV_USER_EMAIL.toLowerCase();
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: () => void) {
  // Per-user live data; never let a browser or edge cache serve one user's
  // lists to another.
  res.set('Cache-Control', 'no-store');
  const email = getUserEmail(req);
  if (!email) {
    res.status(401).json({ error: 'No user identity (x-forwarded-email missing)' });
    return;
  }
  res.locals.email = email;
  next();
}

export function handleError(res: Response, context: string, err: unknown) {
  console.error(`[todolist] ${context}:`, err);
  res.status(500).json({ error: context });
}
