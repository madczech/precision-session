import { put } from '@vercel/blob';
import { authed, readJson, fail } from './_lib.js';

// GET /api/grid -> shared grid calibration (or null)
// PUT /api/grid -> save shared grid calibration (JSON body)
export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'GET') {
      const g = await readJson('config/grid.json').catch(() => null);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(g);
    }
    if (req.method === 'PUT') {
      const g = req.body;
      if (!g || !Array.isArray(g.corners) || g.corners.length !== 4) return res.status(400).json({ error: 'Grid needs 4 corners' });
      await put('config/grid.json', JSON.stringify(g), { access: 'private', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { return fail(res, e); }
}
