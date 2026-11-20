/* ---------- feedback on the app: button bottom right, pick a part of the page, list, votes, comments, export for Claude ----------
   Uses $, esc, ls, api, assetsShim, canvasBlob, showTab from app.js (loaded first). Name a block for feedback with data-fbn="Name"
   (data-fb is taken by the fireball buttons). Anything inside [data-fb-ignore] cannot be picked. Everyone logged in can manage it. */
(() => {
const PICKABLE = '[data-fbn],a,button,input,select,textarea,label,tr,li,img,canvas,h1,h2,h3,section,form,fieldset,table,header,nav,article,aside,dialog,.panel';
const BLOCK = '[data-fbn],section,form,fieldset,table,nav,article,aside,dialog,[role=dialog],.panel';
const IGNORE = 'data-fb-ignore', HOVER = 'data-fb-hover';
const KIND = { bug: 'Bug', idea: 'Idea', unclear: 'Unclear' };
const STATE = { new: 'New', doing: 'In progress', done: 'Done', rejected: 'Rejected' };
const isOpen = f => f.state === 'new' || f.state === 'doing';
const VIEW = { session: 'Session tab', history: 'History tab' };
const CODE = { session: 'index.html (#viewS) + app.js', history: 'index.html (#viewH) + app.js' };

/* --- naming and finding a part of the page --- */
const clean = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// text with spaces between nodes, without the ? help marks
function textOf(el) {
  const parts = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n && parts.length < 20; n = walk.nextNode()) if (!n.parentElement.closest('.tip')) parts.push(n.textContent);
  return parts.join(' ');
}
function pickable(t) {
  if (!(t instanceof Element) || t.closest(`[${IGNORE}]`)) return null;
  const el = t.closest(PICKABLE);
  return el && el !== document.body ? el : null;
}
function fieldName(el) {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  const lab = byFor || el.closest('label');
  return clean((lab && textOf(lab)) || el.getAttribute('aria-label') || el.placeholder || el.name || el.id);
}
function blockName(el) {
  const own = el.getAttribute('data-fbn') || el.getAttribute('aria-label');
  if (own) return clean(own);
  for (const h of el.querySelectorAll('h1,h2,h3,legend,caption')) if (h.parentElement && h.parentElement.closest(BLOCK) === el) return clean(textOf(h));
  return '';
}
function targetName(el) {
  if (el.matches('input,select,textarea')) return fieldName(el);
  if (el instanceof HTMLImageElement) return clean(el.alt) || 'image';
  if (el instanceof HTMLCanvasElement) return clean(el.getAttribute('aria-label')) || el.id || 'image';
  return clean(el.getAttribute('data-fbn') || el.getAttribute('aria-label') || textOf(el));
}
function describe(el) {
  const names = [];
  for (let b = el.closest(BLOCK); b && names.length < 2; b = b.parentElement && b.parentElement.closest(BLOCK)) {
    const n = blockName(b);
    if (n && !names.includes(n)) names.unshift(n);
  }
  const t = el.matches(BLOCK) ? '' : targetName(el);
  return { segment: names.join(' › '), target: t && !names.includes(t) ? t : '' };
}
function selectorOf(el) {
  const parts = [];
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift('#' + CSS.escape(e.id)); return parts.join(' > '); }
    let i = 1;
    for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++;
    parts.unshift(`${e.tagName.toLowerCase()}:nth-of-type(${i})`);
  }
  return ['body', ...parts].join(' > ');
}
const find = sel => { if (!sel) return null; try { return document.querySelector(sel); } catch { return null; } };
function flash(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.setAttribute('data-fb-flash', '');
  setTimeout(() => el.removeAttribute('data-fb-flash'), 3500);
}
const where = f => [f.segment, f.target && `“${f.target}”`].filter(Boolean).join(' › ');
const score = f => Object.values(f.votes || {}).reduce((a, v) => a + v, 0);
const ups = f => Object.values(f.votes || {}).filter(v => v > 0).length;
const downs = f => Object.values(f.votes || {}).filter(v => v < 0).length;
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(iso).toLocaleDateString(); };

/* --- state --- */
const voter = ls.get('pa.fbVoter', '') || (() => { const v = 'v' + Math.random().toString(36).slice(2, 12); ls.set('pa.fbVoter', v); return v; })();
const myName = () => ls.get('pa.fbName', '') || $('sOp').value.trim();
const view = () => ($('viewH').hidden ? 'session' : 'history');
let items = null, mode = 'closed', scope = 'view', filter = 'open', picked = null, notice = null, photos = [];
const talk = new Set(), imgUrl = {};

const root = document.createElement('div');
root.setAttribute(IGNORE, '');
root.innerHTML = '<div id="fbPanel" role="dialog" aria-label="Feedback on the app" hidden></div>'
  + '<div id="fbPick" role="dialog" aria-label="Pick a part of the page" hidden><b>Click the part of the page your feedback is about</b>'
  + '<span class="actions"><button type="button" data-act="whole">Whole page</button><button type="button" data-act="list">Cancel</button></span></div>'
  + '<button type="button" id="fbBtn" aria-expanded="false"></button>';
$('app').appendChild(root);
const panel = $('fbPanel');

async function load() {
  try { items = await api.json('GET', '/api/feedback'); } catch (e) { if (e.message !== 'passcode needed') notice = { ok: false, text: 'Feedback could not be loaded: ' + e.message }; }
  render();
}
const replace = doc => { items = (items || []).map(f => (f.id === doc.id ? doc : f)); };
async function act(fn) { try { await fn(); } catch (e) { if (e.message !== 'passcode needed') notice = { ok: false, text: e.message }; } render(); }

/* --- render --- */
function render() {
  const mine = (items || []).filter(f => f.view === view() && isOpen(f)).length;
  $('fbBtn').innerHTML = mode === 'closed' ? `Feedback${mine ? ` <span class="fbcount">${mine}</span>` : ''}` : 'Close';
  $('fbBtn').setAttribute('aria-label', `Feedback on the app${mine ? ` (${mine} open on this tab)` : ''}`);
  $('fbBtn').setAttribute('aria-expanded', String(mode !== 'closed'));
  $('fbBtn').hidden = mode === 'pick';
  $('fbPick').hidden = mode !== 'pick';
  panel.hidden = mode === 'closed' || mode === 'pick';
  if (panel.hidden) return;
  const note = notice ? `<div class="banner${notice.ok ? ' ok' : ''}" role="${notice.ok ? 'status' : 'alert'}">${esc(notice.text)}</div>` : '';
  if (mode === 'form') {
    panel.innerHTML = `<div class="panelhead"><h2>New feedback</h2></div>${note}
      <form id="fbForm" class="fbform">
        <div class="fbwhere"><span class="status">Part of the page</span><b>${esc(where(picked) || 'Whole page · ' + VIEW[picked.view])}</b>
          <button type="button" class="linkbtn" data-act="pick">Pick another part</button></div>
        <div class="field"><span>Type</span><div class="actions">${Object.entries(KIND).map(([k, l]) =>
          `<label class="fbkind"><input type="radio" name="kind" value="${k}"${k === 'idea' ? ' checked' : ''}> ${l}</label>`).join('')}</div></div>
        <label class="field">What should change<textarea name="text" rows="4" required placeholder="e.g. Show the PSI next to each session in the list"></textarea></label>
        <label class="field">Your name<input name="author" required value="${esc(myName())}"></label>
        <label class="field">Photo / screenshot (optional)<input name="files" type="file" accept="image/*" multiple></label>
        <div class="actions"><button class="primary" type="submit">Send feedback</button><button type="button" data-act="list">Back</button></div>
      </form>`;
    panel.querySelector('textarea').focus();
    return;
  }
  let list = (items || []).filter(f => (scope === 'view' ? f.view === view() : filter === 'all' || (filter === 'open') === isOpen(f)));
  list = scope === 'view' ? list.sort((a, b) => isOpen(b) - isOpen(a)) : list.sort((a, b) => score(b) - score(a) || String(b.createdAt).localeCompare(a.createdAt));
  const tab = (k, v, l) => `<button type="button" role="tab" data-act="${k}" data-v="${v}" aria-selected="${(k === 'scope' ? scope : filter) === v}">${l}</button>`;
  panel.innerHTML = `<div class="panelhead"><h2>Feedback</h2><div class="tabs" role="tablist">${tab('scope', 'view', 'This tab')}${tab('scope', 'all', 'All')}</div></div>${note}
    <div class="actions"><button type="button" class="primary" data-act="pick">+ Add feedback</button>
      ${scope === 'all' ? `<button type="button" data-act="export" title="Copy the open feedback as a brief for Claude Code">Copy for Claude</button>` : ''}</div>
    ${scope === 'all' ? `<div class="tabs fbfilter" role="tablist">${tab('filter', 'open', 'Open')}${tab('filter', 'closed', 'Done')}${tab('filter', 'all', 'All')}</div>` : ''}
    ${items === null ? '<p class="status">Loading…</p>' : list.length ? list.map(card).join('') : `<p class="status">${scope === 'view' ? 'Nobody has written anything about this tab yet.' : 'Nothing here.'}</p>`}`;
  panel.querySelectorAll('img[data-img]').forEach(showImg);
}
function card(f) {
  const mine = (f.votes || {})[voter] || 0;
  return `<article class="fbitem${isOpen(f) ? '' : ' closed'}" data-id="${esc(f.id)}">
    <div class="actions"><span class="fbchip k-${esc(f.kind)}">${esc(KIND[f.kind] || f.kind)}</span>
      <select data-act="state" aria-label="State">${Object.entries(STATE).map(([k, l]) => `<option value="${k}"${k === f.state ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <p>${esc(f.text)}</p>
    <span class="status">${esc(where(f) || 'Whole page')} · ${esc(VIEW[f.view] || f.view)} · ${esc(f.author)} · ${esc(ago(f.createdAt))}</span>
    ${(f.images || []).length ? `<div class="fbimgs">${f.images.map(id => `<a target="_blank" rel="noopener"><img data-img="${esc(id)}" alt="Photo with feedback"></a>`).join('')}</div>` : ''}
    <div class="actions">
      <button type="button" data-act="vote" data-v="1" aria-pressed="${mine > 0}" title="Agree">👍 ${ups(f)}</button>
      <button type="button" data-act="vote" data-v="-1" aria-pressed="${mine < 0}" title="Disagree">👎 ${downs(f)}</button>
      ${f.selector ? '<button type="button" data-act="show">Show</button>' : ''}
      <button type="button" data-act="talk">${f.comments.length ? `Comments (${f.comments.length})` : 'Comment'}</button>
      <button type="button" class="danger" data-act="del">Delete</button></div>
    ${talk.has(f.id) ? `<div class="fbtalk">${f.comments.map(c => `<p><b>${esc(c.author)}</b> <span class="status">${esc(ago(c.at))}</span><br>${esc(c.text)}</p>`).join('')}
      <form class="fbcomment"><textarea name="text" rows="2" required placeholder="Comment"></textarea>
        <input name="author" required placeholder="Your name" value="${esc(myName())}"><button type="submit">Send</button></form></div>` : ''}
  </article>`;
}
async function showImg(img) {
  const id = img.dataset.img;
  if (!imgUrl[id]) {
    const r = await api.raw('GET', '/api/image?id=' + encodeURIComponent(id)).catch(() => null);
    if (!r || !r.ok) { img.alt = 'Photo missing'; return; }
    imgUrl[id] = URL.createObjectURL(await r.blob());
  }
  img.src = imgUrl[id];
  img.parentElement.href = imgUrl[id];
}

/* --- pick mode: a click anywhere outside the widget picks that part and does nothing else --- */
let hovered = null;
const hover = el => { hovered && hovered.removeAttribute(HOVER); hovered = el; el && el.setAttribute(HOVER, ''); };
const inWidget = t => t instanceof Element && !!t.closest(`[${IGNORE}]`);
const onMove = e => { if (e.pointerType === 'mouse') hover(pickable(e.target)); };
const onBlock = e => { if (!inWidget(e.target)) { e.preventDefault(); e.stopPropagation(); } };
const onClick = e => { if (inWidget(e.target)) return; e.preventDefault(); e.stopPropagation(); const el = pickable(e.target); if (el) choose(el); };
const onKey = e => { if (e.key === 'Escape') setMode('list'); };
function setMode(m) {
  if (mode === 'pick' && m !== 'pick') {
    document.documentElement.removeAttribute('data-fb-picking');
    document.removeEventListener('pointermove', onMove, true);
    for (const t of ['pointerdown', 'mousedown']) document.removeEventListener(t, onBlock, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey);
  }
  if (m === 'pick' && mode !== 'pick') {
    document.documentElement.setAttribute('data-fb-picking', '');
    document.addEventListener('pointermove', onMove, true);
    for (const t of ['pointerdown', 'mousedown']) document.addEventListener(t, onBlock, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
  }
  hover(m === 'form' && picked && picked.el ? picked.el : null); // the picked part stays outlined while the form is open
  mode = m;
  render();
}
function choose(el) {
  picked = { el, view: view(), page: document.title + ' · ' + VIEW[view()], ...(el ? { ...describe(el), selector: selectorOf(el) } : { segment: '', target: '', selector: '' }) };
  notice = null;
  setMode('form');
}

/* --- photos: scaled down to a JPEG and stored like session images --- */
async function uploadPhoto(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return (await assetsShim.upload(await canvasBlob(c, 0.85))).id;
}

/* --- export: open feedback as a Markdown brief for Claude Code --- */
function markdown(list) {
  return [`# Feedback on Precision Session (${list.length})`, '',
    `Export ${new Date().toLocaleString()} from ${location.origin}`, '',
    'Brief for Claude Code: go through the team’s feedback on the app and change it in this repo accordingly.',
    'Each item has the tab (and where it lives in the code), the part of the page as the app named it and the CSS selector of what was clicked.',
    'Sorted by 👍 − 👎. If an item is unclear or clashes with another, ask before you start. At the end, say which # are done.', '',
    ...list.flatMap(f => [
      `## #${f.id} · ${KIND[f.kind]}: ${where(f) || 'whole page'}`, '',
      `- State: ${STATE[f.state]} · 👍 ${ups(f)} / 👎 ${downs(f)}`,
      `- Tab: ${VIEW[f.view] || f.view} → \`${CODE[f.view] || 'index.html + app.js'}\``,
      f.selector ? `- Selector: \`${f.selector}\`` : null,
      `- From: ${f.author}, ${new Date(f.createdAt).toLocaleString()}${f.viewport ? ` · window ${f.viewport}` : ''}`,
      f.images.length ? `- Photos: ${f.images.length} (open them in the app: Feedback → All)` : null, '',
      f.text.split('\n').map(l => '> ' + l).join('\n'),
      ...(f.comments.length ? ['', 'Comments:', ...f.comments.map(c => `- ${c.author}: ${c.text.replace(/\s*\n\s*/g, ' ')}`)] : []), '',
    ]).filter(l => l !== null)].join('\n');
}

/* --- events --- */
root.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const f = items && items.find(x => x.id === (b.closest('[data-id]') || {}).dataset?.id);
  const a = b.dataset.act;
  if (a === 'pick') setMode('pick');
  else if (a === 'whole') choose(null);
  else if (a === 'list') setMode('list');
  else if (a === 'scope') { scope = b.dataset.v; notice = null; render(); }
  else if (a === 'filter') { filter = b.dataset.v; render(); }
  else if (a === 'talk') { talk.has(f.id) ? talk.delete(f.id) : talk.add(f.id); render(); }
  else if (a === 'show') {
    if (f.view !== view()) { location.hash = f.view === 'history' ? 'history' : ''; showTab(location.hash.slice(1)); }
    requestAnimationFrame(() => { const el = find(f.selector); if (el) flash(el); else { notice = { ok: false, text: 'That part is no longer on the page, it may have changed since.' }; render(); } });
  }
  else if (a === 'vote') { const v = +b.dataset.v; act(async () => replace(await api.json('PATCH', '/api/feedback?id=' + encodeURIComponent(f.id), { op: 'vote', voter, value: f.votes[voter] === v ? 0 : v }))); }
  else if (a === 'del') { if (confirm('Delete this feedback with its comments and photos?')) act(async () => { await api.json('DELETE', '/api/feedback?id=' + encodeURIComponent(f.id)); items = items.filter(x => x !== f); }); }
  else if (a === 'export') {
    const open = items.filter(isOpen).sort((x, y) => score(y) - score(x));
    act(async () => {
      const md = markdown(open);
      try { await navigator.clipboard.writeText(md); notice = { ok: true, text: `Copied ${open.length} open items. Paste them to Claude Code.` }; }
      catch { // no clipboard access: download it instead
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = 'feedback.md'; a.click();
        notice = { ok: true, text: `Saved ${open.length} open items as feedback.md. Give the file to Claude Code.` };
      }
    });
  }
});
root.addEventListener('change', e => {
  if (e.target.dataset.act !== 'state') return;
  const id = e.target.closest('[data-id]').dataset.id;
  act(async () => replace(await api.json('PATCH', '/api/feedback?id=' + encodeURIComponent(id), { op: 'state', state: e.target.value })));
});
root.addEventListener('submit', e => {
  e.preventDefault();
  const fm = e.target, fd = new FormData(fm), btn = fm.querySelector('[type=submit]');
  ls.set('pa.fbName', String(fd.get('author')).trim());
  btn.disabled = true;
  // on failure the form stays as typed and shows the error, nothing is re-rendered
  const failed = err => {
    btn.disabled = false; btn.textContent = fm.id === 'fbForm' ? 'Send feedback' : 'Send';
    if (err.message === 'passcode needed') return;
    let m = fm.querySelector('.banner'); if (!m) { m = document.createElement('div'); m.className = 'banner'; m.setAttribute('role', 'alert'); fm.prepend(m); }
    m.textContent = 'Not sent: ' + err.message;
  };
  if (fm.id === 'fbForm') (async () => {
    btn.textContent = 'Sending…';
    const images = [];
    for (const file of fm.querySelector('[type=file]').files) images.push(await uploadPhoto(file));
    const { el, ...p } = picked;
    const doc = await api.json('POST', '/api/feedback', { ...p, viewport: `${innerWidth}×${innerHeight}`, kind: fd.get('kind'), text: fd.get('text'), author: fd.get('author'), images });
    items = [doc, ...(items || [])];
    notice = { ok: true, text: 'Thanks! Your feedback is sent, the others can see it and vote.' };
    picked = null; scope = 'view'; setMode('list');
  })().catch(failed);
  else (async () => {
    const id = fm.closest('[data-id]').dataset.id;
    replace(await api.json('PATCH', '/api/feedback?id=' + encodeURIComponent(id), { op: 'comment', text: fd.get('text'), author: fd.get('author') }));
    render();
  })().catch(failed);
});
// hovering an item outlines its part of the page
root.addEventListener('mouseover', e => { const a = e.target.closest('.fbitem'); const f = a && items.find(x => x.id === a.dataset.id); if (mode === 'list') hover(f && f.view === view() ? find(f.selector) : null); });
root.addEventListener('mouseleave', () => { if (mode === 'list') hover(null); });
$('fbBtn').onclick = () => { notice = null; setMode(mode === 'closed' ? 'list' : 'closed'); if (mode === 'list') load(); };
for (const t of ['tabS', 'tabH']) $(t).addEventListener('click', () => render());
// first load once the app is shown after login
new MutationObserver(() => { if (!$('app').hidden && items === null) load(); }).observe($('app'), { attributes: true, attributeFilter: ['hidden'] });
if (!$('app').hidden) load();
render();
})();
