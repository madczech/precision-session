import { put, get, list, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { authed, fail } from './_lib.js';

const PATH_RE = /^images\/[A-Za-z0-9_-]+\.jpg$/;

// POST   /api/image            body {data: base64 jpeg} -> {id: "images/<uuid>.jpg"}
// GET    /api/image?id=...     -> the jpeg
// DELETE /api/image?id=...     -> remove it

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'POST') {
      const data = req.body && req.body.data;
      if (typeof data !== 'string' || !data.length) return res.status(400).json({ error: 'No image data' });
      const buf = Buffer.from(data, 'base64');
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ error: 'Image must be a JPEG' });
      const id = `images/${randomUUID()}.jpg`;
      await put(id, buf, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false });
      return res.status(200).json({ id });
    }
    const id = String(req.query.id || '');
    if (!PATH_RE.test(id)) return res.status(400).json({ error: 'Bad image id' });
    if (req.method === 'GET') {
      const r = await get(id, { access: 'private' });
      if (!r || r.statusCode !== 200) return res.status(404).json({ error: 'Not found' });
      const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).send(buf);
    }
    if (req.method === 'DELETE') {
      const r = await list({ prefix: id, limit: 5 });
      const urls = r.blobs.filter(b => b.pathname === id).map(b => b.url);
      if (urls.length) await del(urls);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { return fail(res, e); }
}
