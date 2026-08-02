import path from 'node:path';
import fs from 'node:fs';
import express, { Response } from 'express';
import { TodoAppKit, TodoContext } from './types';
import { SETUP_SQL, ONE_SHOT_MIGRATIONS } from './schema';
import { requireAuth } from './auth';
import { createEmailSender } from './email';
import { startJobs } from './jobs';
import { registerMeRoutes } from './routes/me';
import { registerListRoutes } from './routes/lists';
import { registerTaskRoutes } from './routes/tasks';
import { registerTodayRoutes } from './routes/today';
import { registerHistoryRoutes } from './routes/history';
import { registerNotificationRoutes } from './routes/notifications';
import { registerAiRoutes } from './routes/ai';

// The todo SPA is served by us, not by AppKit's StaticServer, so it never
// gets the injected runtime config. appkit-ui degrades gracefully without
// it, but we inject an equivalent empty config for parity so nothing warns.
const CONFIG_SCRIPT =
  `<script id="__appkit__" type="application/json">` +
  `{"appName":"todolist","queries":{},"endpoints":{},"plugins":{}}</script>` +
  `<script>window.__appkit__=JSON.parse(document.getElementById('__appkit__').textContent);</script>`;

export interface TodolistOptions {
  // Absolute path to the built client. The shell app owns the directory layout,
  // so it passes this in rather than us guessing from cwd.
  distPath: string;
}

function serveTodolistIndex(res: Response, distPath: string) {
  const indexPath = path.join(distPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    // Fail loudly rather than falling through to the shell's catch-all, which
    // would serve the landing page for /todolist routes.
    res
      .status(503)
      .type('text/plain')
      .send(`Todolist client build is missing (${distPath}). Run: npm run build:todolist`);
    return;
  }
  const html = fs.readFileSync(indexPath, 'utf-8').replace('<body>', `<body>${CONFIG_SCRIPT}`);
  res.type('html').send(html);
}

export async function setupTodolistRoutes(appkit: TodoAppKit, { distPath }: TodolistOptions) {
  try {
    await appkit.lakebase.query(SETUP_SQL);
    for (const m of ONE_SHOT_MIGRATIONS) {
      const done = await appkit.lakebase.query('SELECT 1 FROM todolist.app_meta WHERE key = $1', [m.key]);
      if (done.rows.length === 0) {
        await appkit.lakebase.query(m.sql);
        await appkit.lakebase.query('INSERT INTO todolist.app_meta (key, value) VALUES ($1, $2)', [m.key, 'done']);
        console.log(`[todolist] ran one-shot migration: ${m.key}`);
      }
    }
    console.log('[todolist] schema ready');
  } catch (err) {
    console.warn('[todolist] database setup failed:', (err as Error).message);
    console.warn('[todolist] routes will be registered but may return errors');
  }

  const ctx: TodoContext = { appkit, emailSender: createEmailSender() };

  // Registered via server.extend, which AppKit runs BEFORE its static
  // catch-all — so everything under /todolist takes precedence over the
  // shell's landing page without touching it.
  appkit.server.extend((app) => {
    app.use('/todolist/api', requireAuth);

    registerMeRoutes(app, ctx);
    registerListRoutes(app, ctx);
    registerTaskRoutes(app, ctx);
    registerTodayRoutes(app, ctx);
    registerHistoryRoutes(app, ctx);
    registerNotificationRoutes(app, ctx);
    registerAiRoutes(app, ctx);

    // Static assets (built with base '/todolist/') and the SPA fallback for
    // deep links like /todolist/history on hard refresh.
    app.use('/todolist', express.static(distPath, { index: false }));
    app.get(['/todolist', '/todolist/*'], (_req, res) => serveTodolistIndex(res, distPath));
  });

  startJobs(appkit, ctx.emailSender);
}
