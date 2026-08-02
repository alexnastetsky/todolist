# todolist

A collaborative todo app: multi-list, assignment, 3-level sharing, accomplishment
history, in-app and email notifications, and natural-language capture backed by a
Databricks Model Serving endpoint.

## This repo is a module, not an app

It has no `package.json`, no build config, and no deploy config. It is mounted at
`/todolist` by the **`home`** shell app, which owns the dependencies, the build,
and the Databricks App deployment. Clone `home` and work there — this repo lives
at `apps/todolist` inside it as a git submodule.

- `server/` — Express routes registered through `appkit.server.extend`, plus the
  Postgres schema (`todolist`), email sending, background jobs, and AI capture.
  Entry point: `setupTodolistRoutes(appkit, { distPath })`.
- `client/` — React SPA built with Vite `base: '/todolist/'` and a React Router
  `basename` of `/todolist`.

The shell passes `distPath` in, so this module never assumes where it sits on
disk. The `/todolist` URL prefix, however, is baked into the routes, the Vite
base, the router basename, and `client/public/manifest.webmanifest`.

## Changing something here

Commit and push in this repo first, then commit the updated submodule pointer in
`home`. Build and test from `home` (`npm run build:todolist`, `npm run dev`).
