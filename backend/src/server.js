require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const supabase = require('./supabase');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

function requireDb(req, res, next) {
  if (!supabase) return res.status(503).json({ error: 'Supabase API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.' });
  next();
}
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'smart-library-api' }));

// Read endpoints preserve existing records. Never create a library automatically.
app.get('/api/libraries', requireDb, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('libraries')
      .select('id,name,library_code,admin_username,image_url,created_at').order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { next(e); }
});

const allowedTables = new Set(['books', 'members', 'issues', 'settings', 'holidays']);
function validLibraryId(req, res, next) {
  const id = req.params.libraryId || req.query.library_id || req.body.library_id;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'library_id is required.' });
  req.libraryId = id;
  next();
}
for (const table of allowedTables) {
  app.get(`/api/${table}`, requireDb, validLibraryId, async (req, res, next) => {
    try {
      let query = supabase.from(table).select('*').eq('library_id', req.libraryId);
      const orderColumn = ({books:'title',members:'name',issues:'issue_date',holidays:'holiday_date',settings:'library_id'})[table];
      if (orderColumn && table !== 'settings') query = query.order(orderColumn, { ascending: table === 'books' || table === 'members' || table === 'holidays' });
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e) { next(e); }
  });
}

// Generic insert/update/delete are intentionally limited to known tables and library scope.
// Production authentication/authorization should be added before exposing write endpoints publicly.
app.post('/api/:table', requireDb, async (req, res, next) => {
  try {
    const { table } = req.params;
    if (!allowedTables.has(table)) return res.status(404).json({ error: 'Unknown resource.' });
    const body = req.body || {};
    if (!body.library_id) return res.status(400).json({ error: 'library_id is required.' });
    const { data, error } = await supabase.from(table).insert(body).select('*').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { next(e); }
});
app.patch('/api/:table/:id', requireDb, async (req, res, next) => {
  try {
    const { table, id } = req.params;
    if (!allowedTables.has(table)) return res.status(404).json({ error: 'Unknown resource.' });
    const libraryId = req.body?.library_id || req.query.library_id;
    if (!libraryId) return res.status(400).json({ error: 'library_id is required.' });
    const patch = { ...req.body }; delete patch.library_id;
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('library_id', libraryId).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});
app.delete('/api/:table/:id', requireDb, async (req, res, next) => {
  try {
    const { table, id } = req.params;
    if (!allowedTables.has(table)) return res.status(404).json({ error: 'Unknown resource.' });
    const libraryId = req.query.library_id;
    if (!libraryId) return res.status(400).json({ error: 'library_id query parameter is required.' });
    const { error } = await supabase.from(table).delete().eq('id', id).eq('library_id', libraryId);
    if (error) throw error;
    res.status(204).end();
  } catch (e) { next(e); }
});

// Serve the original frontend, preserving its HTML/CSS/JS and existing business logic.
app.use(express.static(path.join(__dirname, '../../frontend')));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Smart Library running at http://localhost:${port}`));
