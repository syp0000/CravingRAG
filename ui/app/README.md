# CravingRAG web app

This folder contains the React interface used by both versions of the demo.

- The public gallery reads precomputed results from `public/gallery.json`.
- The invite-only live app sends searches to the Python server in `ui/server.py`.

Run the frontend during development:

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run lint
npm test
npm run build
```

The Vite development server proxies API requests to `http://localhost:8642`. Start the
Python server from the repository root when testing the live search flow.
