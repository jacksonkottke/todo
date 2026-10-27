// Phone app for Jackson's to-do lists. Reads and writes the same JSON files in the private
// briefings repo as the Briefings new-tab extension and Claude, with the same rules:
// union by id, the copy with the later `updated` wins, deleted items stay as { deleted: true }.
// The token and a cached copy of each list live only in this browser's localStorage.
(function () {
  'use strict';

  const LISTS = [
    { key: 'todos', path: '_todos/todos.json', tab: 'To-Do', title: 'To-Do', noun: 'to-do', message: 'Update to-dos (phone)' },
    { key: 'jen', path: '_todos/jen.json', tab: 'Jen', title: '1:1 With Jen', noun: 'topic', message: 'Update 1:1 with Jen (phone)' },
    { key: 'supervisors', path: '_todos/supervisors.json', tab: 'Supervisors', title: 'For the Supervisors', noun: 'topic', message: 'Update supervisor topics (phone)' },
  ];
  const SYNC_MS = 60 * 1000;
  const OLD_DAYS = 7;

  // ---------- storage ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('todo:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('todo:' + k, JSON.stringify(v)); } catch (e) { /* unavailable */ } },
  };

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => ymd(new Date());
  const addDays = (k, n) => { const d = parseYmd(k); d.setDate(d.getDate() + n); return ymd(d); };
  const dayDiff = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
  function dayName(k) {
    const diff = dayDiff(k, todayKey());
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (diff === 1) return 'Tomorrow';
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (parseYmd(k).getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return parseYmd(k).toLocaleDateString([], opts);
  }
  function shortDay(k, from) {
    const diff = dayDiff(k, from);
    if (diff === -1 && from === todayKey()) return 'yesterday';
    if (diff > -7) return parseYmd(k).toLocaleDateString([], { weekday: 'long' });
    return parseYmd(k).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...children.filter((c) => c != null && c !== false));
    return node;
  }

  const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;
  function richText(text) {
    const out = [];
    let last = 0;
    for (const m of String(text).matchAll(LINK_RE)) {
      let url = m[2] || m[3];
      let end = m.index + m[0].length;
      if (m[3]) {
        const trail = url.match(/[.,;:!?'")\]]+$/);
        if (trail) { url = url.slice(0, -trail[0].length); end -= trail[0].length; }
      }
      let shown = m[1];
      if (!shown) {
        try { const u = new URL(url); shown = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 || u.search ? '/…' : ''); }
        catch (e) { continue; }
      }
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, shown));
      last = end;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // `updated` is normally milliseconds, but a few machine edits wrote ISO strings; compare either.
  const ms = (v) => typeof v === 'number' ? v : (typeof v === 'string' ? (Date.parse(v) || 0) : 0);
  const stamp = (it) => ms(it.updated) || ms(it.created);
  function merge(a, b) {
    const byId = new Map();
    for (const it of [...(a || []), ...(b || [])]) {
      if (!it || !it.id) continue;
      const have = byId.get(it.id);
      if (!have || stamp(it) > stamp(have)) byId.set(it.id, it);
    }
    return [...byId.values()];
  }
  const canon = (list) => JSON.stringify([...list].sort((x, y) => x.id.localeCompare(y.id)));
  const same = (a, b) => canon(a) === canon(b);

  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  // ---------- state ----------
  const settings = () => Object.assign({ repo: 'jacksonkottke/briefings', branch: 'main', token: '' }, store.get('settings') || {});
  let current = LISTS.find((l) => l.key === store.get('tab')) || LISTS[0];
  let day = todayKey();
  let shownToday = day;
  const status = {}; // per list: local | syncing | synced | offline | readonly | error
  const busy = {};
  let pushTimer = null;
  let editing = null;

  const itemsOf = (l) => store.get('list:' + l.key) || [];
  const saveItems = (l, items) => store.set('list:' + l.key, items);
  const live = (l) => itemsOf(l).filter((i) => !i.deleted);
  const doneBy = (i, d) => i.done && i.doneOn && i.doneOn <= d;

  // Same view rule as the new-tab page: today and past days show everything planned up to that
  // day that was still open at its end, plus what was checked off that day; future days show
  // what's planned for them.
  function visible(l, d) {
    const all = live(l);
    const list = d > todayKey()
      ? all.filter((i) => i.date === d)
      : all.filter((i) => i.date <= d && (!i.done || (i.doneOn || '') >= d));
    return list.sort((a, b) => (doneBy(a, d) - doneBy(b, d)) || String(a.date).localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  }
  const openToday = (l) => visible(l, todayKey()).filter((i) => !doneBy(i, todayKey())).length;

  // ---------- GitHub ----------
  async function api(gh, l, method, body) {
    const url = 'https://api.github.com/repos/' + gh.repo + '/contents/' + l.path +
      (method === 'GET' ? '?ref=' + encodeURIComponent(gh.branch) + '&t=' + Date.now() : '');
    return fetch(url, {
      method, cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + gh.token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async function pull(gh, l) {
    const res = await api(gh, l, 'GET');
    if (res.status === 404) return { items: [], sha: null, missing: true };
    if (!res.ok) throw Object.assign(new Error('pull'), { status: res.status });
    const json = await res.json();
    const data = JSON.parse(b64decode(json.content || '') || '{}');
    return { items: Array.isArray(data.items) ? data.items : [], sha: json.sha };
  }

  async function sync(l) {
    if (busy[l.key]) return;
    const gh = settings();
    if (!gh.token) { status[l.key] = 'local'; renderStatus(); return; }
    busy[l.key] = true;
    status[l.key] = 'syncing';
    renderStatus();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await pull(gh, l);
        const local = itemsOf(l);
        const merged = merge(remote.items, local);
        if (!same(merged, local)) { saveItems(l, merged); render(); }
        if ((remote.sha && same(merged, remote.items)) || (!remote.sha && !merged.length)) break;
        const sorted = [...merged].sort((a, b) => (a.created || 0) - (b.created || 0));
        const text = JSON.stringify({ version: 1, items: sorted }, null, 2) + '\n';
        const res = await api(gh, l, 'PUT', { message: l.message, content: b64encode(text), branch: gh.branch, ...(remote.sha ? { sha: remote.sha } : {}) });
        if (res.ok) break;
        if (res.status === 409 || res.status === 422) continue; // someone else wrote first; merge again
        throw Object.assign(new Error('push'), { status: res.status });
      }
      status[l.key] = 'synced';
    } catch (e) {
      status[l.key] = e.status === 403 || e.status === 404 ? 'readonly' : e.status ? 'error' : 'offline';
    } finally {
      busy[l.key] = false;
      renderStatus();
      renderTabs();
    }
  }
  const syncAll = () => LISTS.forEach(sync);
  function schedulePush(l) { clearTimeout(pushTimer); pushTimer = setTimeout(() => sync(l), 1200); }

  // ---------- changes ----------
  function mutate(l, fn) {
    const list = itemsOf(l);
    fn(list);
    saveItems(l, list);
    render();
    schedulePush(l);
  }
  const touch = (it) => { it.updated = Date.now(); };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const find = (list, id) => list.find((i) => i.id === id);

  const add = (text, date) => mutate(current, (list) => list.push({ id: newId(), text, date, done: false, doneOn: null, created: Date.now(), updated: Date.now() }));
  const toggle = (id, done) => mutate(current, (list) => {
    const it = find(list, id);
    if (it) { it.done = done; it.doneOn = done ? (day > todayKey() ? todayKey() : day) : null; touch(it); }
  });
  const update = (id, fields) => mutate(current, (list) => { const it = find(list, id); if (it) { Object.assign(it, fields); touch(it); } });
  const remove = (id) => mutate(current, (list) => { const it = find(list, id); if (it) { it.deleted = true; touch(it); } });

  // ---------- render ----------
  function renderTabs() {
    $('tabs').replaceChildren(...LISTS.map((l) => {
      const n = openToday(l);
      return el('button', {
        type: 'button', class: 'tab', 'aria-current': l === current ? 'page' : 'false',
        onclick: () => { current = l; store.set('tab', l.key); render(); renderStatus(); window.scrollTo(0, 0); },
      }, el('span', { class: 'tab__n', 'aria-label': n + ' open' }, n ? String(n) : ''), l.tab);
    }));
  }

  function renderStatus() {
    const s = status[current.key];
    const msg = {
      local: 'Not connected. Tap the gear to connect to GitHub.',
      offline: 'Can’t reach GitHub. Changes are saved on this phone and will sync later.',
      readonly: 'Not syncing: the token can’t read or write the repo. Check it in Settings (the gear).',
      error: 'Not syncing: GitHub returned an error. Check the token in Settings (the gear).',
    }[s] || '';
    $('sync').textContent = msg;
    $('sync').hidden = !msg;
    $('refresh').classList.toggle('is-spinning', LISTS.some((l) => busy[l.key]));
  }

  function render() {
    const today = todayKey();
    const list = visible(current, day);
    const left = list.filter((i) => !doneBy(i, day)).length;
    $('title').textContent = current.title;
    document.title = current.title;
    $('day').textContent = dayName(day);
    $('pick').value = day;
    $('today').hidden = day === today;
    $('count').textContent = list.length ? (left ? left + ' left' : 'All done') : '';
    $('add-text').placeholder = day === today ? 'Add a ' + current.noun : 'Add for ' + dayName(day);

    $('list').replaceChildren(...list.map((item) => {
      const id = 'i-' + item.id;
      const checked = doneBy(item, day);
      const carried = day <= today && item.date < day && !checked;
      const age = dayDiff(day, item.date);
      return el('li', { class: 'item' + (checked ? ' is-done' : '') },
        el('input', { type: 'checkbox', id, checked, 'aria-label': 'Done: ' + item.text, onchange: (e) => toggle(item.id, e.target.checked) }),
        el('div', { class: 'item__main', onclick: () => openEdit(item) },
          el('div', { class: 'item__text' }, ...richText(item.text || '')),
          (carried || item.by === 'claude') ? el('div', { class: 'chips' },
            carried ? el('span', { class: 'chip' + (age > OLD_DAYS ? ' chip--old' : '') }, 'from ' + shortDay(item.date, day) + (age > OLD_DAYS ? ' · ' + age + ' days' : '')) : null,
            item.by === 'claude' ? el('span', { class: 'chip' }, 'Claude') : null) : null));
    }));
    $('empty').hidden = list.length > 0;
    $('empty').textContent = day < today ? 'Nothing was planned or finished this day.' : 'Nothing here yet.';
    renderTabs();
  }

  // ---------- edit sheet ----------
  function openEdit(item) {
    editing = item.id;
    $('edit-text').value = item.text || '';
    $('edit-date').value = item.date;
    $('edit').showModal();
  }
  $('edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('edit-text').value.replace(/\s*\n\s*/g, ' ').trim();
    const date = $('edit-date').value;
    const it = find(itemsOf(current), editing);
    if (it && text && date && (text !== it.text || date !== it.date)) update(editing, { text, date });
    $('edit').close();
  });
  $('edit-cancel').addEventListener('click', () => $('edit').close());
  $('edit-delete').addEventListener('click', () => { remove(editing); $('edit').close(); });

  // ---------- settings sheet ----------
  function openSettings() {
    const s = settings();
    $('f-token').value = '';
    $('f-token').placeholder = s.token ? 'Saved. Leave blank to keep it.' : 'github_pat_…';
    $('f-repo').value = s.repo;
    $('f-branch').value = s.branch;
    $('f-error').hidden = true;
    $('f-forget').hidden = !s.token;
    $('f-cancel').hidden = !s.token;
    $('settings').showModal();
  }
  $('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const prev = settings();
    const next = { token: $('f-token').value.trim() || prev.token, repo: $('f-repo').value.trim() || prev.repo, branch: $('f-branch').value.trim() || 'main' };
    const err = $('f-error');
    if (!next.token) { err.textContent = 'Paste a GitHub token first.'; err.hidden = false; return; }
    $('f-save').disabled = true;
    try {
      const res = await api(next, LISTS[0], 'GET');
      if (res.status === 401) throw new Error('GitHub didn’t accept that token.');
      if (res.status === 403 || res.status === 404) throw new Error('That token can’t read ' + next.repo + ' (or the branch is wrong).');
      if (!res.ok) throw new Error('GitHub returned an error (' + res.status + ').');
      store.set('settings', next);
      $('settings').close();
      syncAll();
    } catch (ex) {
      err.textContent = ex instanceof TypeError ? 'Can’t reach GitHub right now.' : ex.message;
      err.hidden = false;
    } finally {
      $('f-save').disabled = false;
    }
  });
  $('f-cancel').addEventListener('click', () => $('settings').close());
  $('f-forget').addEventListener('click', () => {
    const s = settings();
    s.token = '';
    store.set('settings', s);
    $('settings').close();
    LISTS.forEach((l) => { status[l.key] = 'local'; });
    renderStatus();
  });

  // ---------- wiring ----------
  const goTo = (d) => { day = d; render(); };
  $('prev').addEventListener('click', () => goTo(addDays(day, -1)));
  $('next').addEventListener('click', () => goTo(addDays(day, 1)));
  $('today').addEventListener('click', () => goTo(todayKey()));
  $('pick').addEventListener('change', (e) => { if (e.target.value) goTo(e.target.value); });
  $('refresh').addEventListener('click', syncAll);
  $('open-settings').addEventListener('click', openSettings);
  $('add').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('add-text').value.trim();
    if (!text) return;
    $('add-text').value = '';
    add(text, day);
  });

  setInterval(() => {
    const now = todayKey();
    if (now !== shownToday) { if (day === shownToday) day = now; shownToday = now; render(); }
  }, 30 * 1000);
  setInterval(() => { if (document.visibilityState === 'visible') syncAll(); }, SYNC_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (todayKey() !== shownToday) { day = shownToday = todayKey(); } render(); syncAll(); }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  render();
  if (!settings().token) { LISTS.forEach((l) => { status[l.key] = 'local'; }); renderStatus(); openSettings(); }
  else syncAll();
})();
