import { put, list, del } from '@vercel/blob';
import { authed, ID_RE, readJson, fail } from './_lib.js';

// GET    /api/sessions          -> [{_id, ...session}]
// PUT    /api/sessions?id=ID    -> save / replace one session (JSON body)
// DELETE /api/sessions?id=ID    -> delete one session (and its stored image)
export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'GET') {
      const blobs = [];
      let cursor;
      do {
        const r = await list({ prefix: 'sessions/', cursor, limit: 1000 });
        blobs.push(...r.blobs);
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      const docs = await Promise.all(
        blobs.filter(b => b.pathname.endsWith('.json')).map(async b => {
          const id = b.pathname.slice('sessions/'.length, -'.json'.length);
          try { const d = await readJson(b.pathname); return d ? { _id: id, ...d } : null; } catch { return null; }
        })
      );
      const out = docs.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    }
    const id = String(req.query.id || '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad session id' });
    if (req.method === 'PUT') {
      const doc = req.body;
      if (!doc || typeof doc !== 'object' || ![2, 4, 5].includes(doc.fireball)) return res.status(400).json({ error: 'Session needs a fireball (2, 4 or 5)' });
      await put(`sessions/${id}.json`, JSON.stringify(doc), { access: 'private', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false });
      return res.status(200).json({ ok: true, id });
    }
    if (req.method === 'DELETE') {
      const doc = await readJson(`sessions/${id}.json`).catch(() => null);
      const targets = [`sessions/${id}.json`];
      if (doc && doc.imageId && /^images\/[A-Za-z0-9_-]+\.jpg$/.test(doc.imageId)) targets.push(doc.imageId);
      const found = [];
      for (const p of targets) { const r = await list({ prefix: p, limit: 5 }); found.push(...r.blobs.filter(b => b.pathname === p).map(b => b.url)); }
      if (found.length) await del(found);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { return fail(res, e); }
}
