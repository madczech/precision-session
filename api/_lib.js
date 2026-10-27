import { get } from '@vercel/blob';

// Every request must carry the team passcode (env APP_PASSCODE).
export function authed(req, res) {
  const pass = process.env.APP_PASSCODE;
  const given = req.headers['x-passcode'];
  if (!pass || !given || given !== pass) {
    res.status(401).json({ error: 'Wrong or missing passcode' });
    return false;
  }
  return true;
}

export const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export async function readJson(pathname) {
  const r = await get(pathname, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  const text = await new Response(r.stream).text();
  return JSON.parse(text);
}

export function fail(res, e) {
  console.error(e);
  res.status(500).json({ error: (e && e.message) || 'Storage error' });
}
