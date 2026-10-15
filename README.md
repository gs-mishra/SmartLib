# Smart Library Full-Stack Structure

This package reorganizes the uploaded Smart Library project into `frontend/` and `backend/` while preserving the original HTML, CSS, application logic, Supabase data model, holiday feature, and calendar styling.

## Important about your existing data

The frontend is configured to use the existing Supabase project values documented in the supplied project README. The existing tables and rows are not recreated or deleted. Do not run `SUPABASE_SCHEMA.sql` against a database that already contains your data.

The original application currently uses its existing Supabase JS data wrapper for its established workflows. The Express REST API is included with health, library-read, and scoped resource endpoints, plus a small `frontend/js/api-client.js` helper for REST calls. The legacy application workflows have intentionally not been rewritten wholesale, because doing so without regression tests could change checkout, return, fine, QR, and holiday behavior. Migrate each workflow to the REST API in a tested follow-up before claiming that every UI action is routed through Express.

## Folder structure

```
Smart-Library/
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   ├── js/app.js
│   ├── js/supabase-db.js
│   ├── js/supabase-config.js
│   ├── js/api-client.js
│   ├── manifest.json
│   ├── service-worker.js
│   └── SQL / setup documentation
└── backend/
    ├── package.json
    ├── .env.example
    └── src/
        ├── server.js
        └── supabase.js
```

## Run locally

1. Install Node.js LTS.
2. Extract this ZIP.
3. Open a terminal in `backend/`.
4. Install packages:

   ```bash
   npm install
   ```

5. Copy `.env.example` to `.env`.
6. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` using your existing Supabase project. Get the service role/secret key from Supabase project API settings. **Never put this key in frontend code, GitHub, or a public repository.**
7. Set `FRONTEND_ORIGIN=http://localhost:3000`.
8. Start:

   ```bash
   npm run dev
   ```

9. Open `http://localhost:3000`.
10. Check `http://localhost:3000/api/health` for `{"ok":true,...}`.

## REST endpoints included

- `GET /api/health`
- `GET /api/libraries`
- `GET /api/books?library_id=EXISTING_LIBRARY_UUID`
- `GET /api/members?library_id=EXISTING_LIBRARY_UUID`
- `GET /api/issues?library_id=EXISTING_LIBRARY_UUID`
- `GET /api/settings?library_id=EXISTING_LIBRARY_UUID`
- `GET /api/holidays?library_id=EXISTING_LIBRARY_UUID`
- `POST /api/:table`
- `PATCH /api/:table/:id`
- `DELETE /api/:table/:id?library_id=EXISTING_LIBRARY_UUID`

Supported resource tables: `books`, `members`, `issues`, `settings`, `holidays`.

## Security and production notes

- The service-role key bypasses Supabase RLS and must remain on the server.
- The generic write endpoints are development scaffolding, not production-secure authorization. Do not expose them publicly until proper authentication, role checks, schema validation, rate limiting, and per-library authorization are implemented.
- The existing legacy login logic hashes passwords in browser JavaScript and compares stored hashes. This is not equivalent to a secure authentication system. Do not use this deployment for sensitive/production use without migrating authentication to a secure server-side flow.
- Restrict CORS to your real frontend origin before deployment.
- The API filters records by the provided `library_id`; this alone is not authorization. Production APIs must derive the allowed library from a verified session rather than trust a client-supplied ID.
- Test checkout/return, available-copy triggers, fines, and holiday due-date handling against a test library before deploying.

## Existing library data

Your previously reported database contains two libraries and associated records. Choose the existing library in the UI. Do not register a duplicate library and do not re-run schema creation SQL. If libraries fail to load, verify Supabase project credentials and RLS permissions first.


## Fix: library dropdown loading

The login dropdown now requests `GET /api/libraries` from the Express backend first, then maps the returned Supabase rows into the frontend's expected field names. This fixes the case where `/api/libraries` returns existing libraries but the browser-side Supabase query cannot read them due to RLS.

Run the app through the Node server (`cd backend && npm install && npm run dev`) and open `http://localhost:3000`. Do not open `frontend/index.html` directly from the file system. The API response deliberately does not expose stored admin password hashes. Admin authentication still uses the existing login flow and must be tested against your Supabase RLS policies.
