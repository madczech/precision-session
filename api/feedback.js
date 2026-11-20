import { put, list, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { authed, ID_RE, readJson, fail } from './_lib.js';

// Feedback on the app itself (feedback.js). One blob per item: feedback/<id>.json with votes and comments inside.
// GET    /api/feedback          -> [{id, ...item}]
// POST   /api/feedback          -> create {view, page, segment, target, selector, viewport, kind, text, author, images}
// PATCH  /api/feedback?id=ID    -> {op:'vote', voter, value: 1|-1|0} | {op:'comment', author, text} | {op:'state', state}
// DELETE /api/feedback?id=ID    -> delete it and its photos
// Everyone with the team passcode may do all of it.

const KINDS = ['bug', 'idea', 'unclear'];
const STATES = ['new', 'doing', 'done', 'rejected'];
const IMG_RE = /^images\/[A-Za-z0-9_-]+\.jpg$/;
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const path = id => `feedback/${id}.json`;
const save = (id, doc) => put(path(id), JSON.stringify(doc), { access: 'private', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false });

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'GET') {
      const blobs = [];
      let cursor;
      do {
        const r = await list({ prefix: 'feedback/', cursor, limit: 1000 });
        blobs.push(...r.blobs);
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      const docs = await Promise.all(blobs.filter(b => b.pathname.endsWith('.json')).map(async b => {
        const id = b.pathname.slice('feedback/'.length, -'.json'.length);
        try { const d = await readJson(b.pathname); return d ? { ...d, id } : null; } catch { return null; }
      }));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(docs.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (req.method === 'POST') {
      const text = str(b.text, 4000);
      if (!text) return res.status(400).json({ error: 'Write what should change' });
      if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'Bad kind' });
      const images = Array.isArray(b.images) ? b.images.filter(x => typeof x === 'string' && IMG_RE.test(x)).slice(0, 10) : [];
      const id = Date.now().toString(36) + '-' + randomUUID().slice(0, 4);
      const doc = {
        view: str(b.view, 40), page: str(b.page, 120), segment: str(b.segment, 200), target: str(b.target, 200),
        selector: str(b.selector, 1000), viewport: str(b.viewport, 20), kind: b.kind, text,
        author: str(b.author, 60) || '?', images, state: 'new', votes: {}, comments: [], createdAt: new Date().toISOString(),
      };
      await save(id, doc);
      return res.status(200).json({ ...doc, id });
    }
    const id = String(req.query.id || '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad feedback id' });
    const doc = await readJson(path(id)).catch(() => null);
    if (!doc) return res.status(404).json({ error: 'This feedback no longer exists' });
    if (req.method === 'PATCH') {
      // shortcut: read-modify-write without a version check, two clicks in the same instant can lose one; add x-base-version like sessions if that bites
      if (b.op === 'vote') {
        const voter = str(b.voter, 40);
        if (!ID_RE.test(voter) || ![1, -1, 0].includes(b.value)) return res.status(400).json({ error: 'Bad vote' });
        if (b.value) doc.votes[voter] = b.value; else delete doc.votes[voter];
      } else if (b.op === 'comment') {
        const text = str(b.text, 2000);
        if (!text) return res.status(400).json({ error: 'Empty comment' });
        doc.comments.push({ author: str(b.author, 60) || '?', text, at: new Date().toISOString() });
      } else if (b.op === 'state') {
        if (!STATES.includes(b.state)) return res.status(400).json({ error: 'Bad state' });
        doc.state = b.state;
        doc.resolvedAt = b.state === 'done' || b.state === 'rejected' ? new Date().toISOString() : null;
      } else return res.status(400).json({ error: 'Unknown change' });
      await save(id, doc);
      return res.status(200).json({ ...doc, id });
    }
    if (req.method === 'DELETE') {
      const targets = [path(id), ...(doc.images || []).filter(x => IMG_RE.test(x))];
      const found = [];
      for (const p of targets) { const r = await list({ prefix: p, limit: 5 }); found.push(...r.blobs.filter(x => x.pathname === p).map(x => x.url)); }
      if (found.length) await del(found);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { return fail(res, e); }
}
