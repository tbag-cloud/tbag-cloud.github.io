// ── WATCHLIST ────────────────────────────────────────────────────────────────
function emptyWatchlistState() {
  return Object.fromEntries(DEFAULT_WATCHLIST_CATEGORIES.map(c => [c.key, []]));
}

function defaultWatchlistCategories() {
  return DEFAULT_WATCHLIST_CATEGORIES.map(c => ({ ...c }));
}

function ensureWatchlistDataShape() {
  watchlistCategories.forEach(c => {
    if (!Array.isArray(watchlistData[c.key])) watchlistData[c.key] = [];
  });
}

function loadGuestWatchlist() {
  watchlistCategories = defaultWatchlistCategories();
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_WATCHLIST) || '{}');
    watchlistData = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v : []])
    );
  } catch {
    watchlistData = emptyWatchlistState();
  }
  migrateWatchlistItems();
  ensureWatchlistDataShape();
}

function saveGuestWatchlist() {
  ensureWatchlistDataShape();
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(watchlistData));
  renderWatchlist();
}

// Migrate old items (status/trackMode) to new { done, progress } shape
function migrateWatchlistItems() {
  Object.values(watchlistData).forEach(items => {
    (items || []).forEach(item => {
      if (item.status !== undefined) {
        item.done = item.status === 'Finished' || item.status === 'Watched';
        delete item.status;
      }
      if (item.trackMode !== undefined) {
        delete item.trackMode;
      }
      if (item.note !== undefined) delete item.note;
    });
  });
}

// ── SYNC ────────────────────────────────────────────────────────────────────
function serializeWatchlistItemRows() {
  return Object.entries(watchlistData).flatMap(([cat, items]) =>
    (items || []).map(item => ({
      user_id: currentUser.id,
      id: item.id,
      category_key: cat,
      title: item.title || '',
      url: item.url || '',
      status: item.done ? (cat === 'movies' ? 'Watched' : 'Finished') : 'Not Started',
      priority: item.priority || 'medium',
      progress: item.progress ?? null,
      season: item.season ?? null
    }))
  );
}

function hydrateWatchlistItems(rows) {
  const next = {};
  rows.forEach(row => {
    (next[row.category_key] = next[row.category_key] || []).push({
      id: row.id,
      title: row.title || '',
      url: row.url || '',
      done: row.status === 'Finished' || row.status === 'Watched',
      priority: row.priority || 'medium',
      progress: row.progress ?? null,
      season: row.season ?? null
    });
  });
  return next;
}

function isMissingWatchlistTable(error) {
  return error && (error.code === '42P01' || /watchlist_/i.test(error.message || ''));
}

async function loadSyncedWatchlist() {
  if (!currentUser) return;
  watchlistCategories = defaultWatchlistCategories();
  const { data: itemRows, error: itemErr } = await sb
    .from('watchlist_items')
    .select('*')
    .eq('user_id', currentUser.id);
  if (itemErr) throw itemErr;
  watchlistData = hydrateWatchlistItems(itemRows || []);
  ensureWatchlistDataShape();
  renderWatchlist();
}

async function saveSyncedWatchlistState() {
  if (!currentUser || !watchlistSyncAvailable) return;
  ensureWatchlistDataShape();
  const itemRows = serializeWatchlistItemRows();
  dot('syncing');
  const { error: clearErr } = await sb.from('watchlist_items').delete().eq('user_id', currentUser.id);
  if (clearErr) throw clearErr;
  if (itemRows.length) {
    const { error } = await sb.from('watchlist_items').insert(itemRows);
    if (error) throw error;
  }
  dot('ok');
}

async function saveWatchlistState() {
  if ((typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) || !watchlistSyncAvailable) {
    saveGuestWatchlist();
    return;
  }
  try {
    await saveSyncedWatchlistState();
    renderWatchlist();
  } catch (error) {
    dot('err');
    if (isMissingWatchlistTable(error)) {
      watchlistSyncAvailable = false;
      toast('watchlist sync unavailable - run watchlist SQL', 'var(--danger)');
      saveGuestWatchlist();
      return;
    }
    toast('watchlist sync failed: ' + error.message, 'var(--danger)');
  }
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function watchlistMeta(c, item) {
  if (c === 'manga') return item.progress ? 'page ' + item.progress : 'manga';
  if (c === 'movies') return '';
  if (c === 'series') return 'S' + (item.season || 1) + ' E' + (item.progress || 1);
  if (c === 'anime') return item.progress ? 'episode ' + item.progress : 'anime';
  return '';
}

function watchlistPriorityRank(item) {
  return item.priority === 'high' ? 0 : item.priority === 'medium' ? 1 : 2;
}

function buildWatchlistCard(cat, item) {
  const escCat = esc(cat), escId = esc(item.id);
  const meta = watchlistMeta(cat, item);
  const showProgress = cat === 'manga' || cat === 'series' || cat === 'anime';
  const stepMin = cat === 'manga' ? 0 : 1;

  let titleHtml = esc(item.title || 'Untitled');
  if (item.url) titleHtml = '<a class="wl-link" href="' + esc(item.url) + '" target="_blank" rel="noopener">' + titleHtml + '</a>';

  return '<div class="wl-card' + (item.done ? ' done' : '') + '" data-wlid="' + escId + '">'
    + '<div class="wl-card-top">'
    + '<span class="wl-check" role="button" tabindex="0" data-wl-cat="' + escCat + '" data-wl-id="' + escId + '">' + (item.done ? '✓' : '○') + '</span>'
    + '<span class="wl-title">' + titleHtml + '</span>'
    + '<button class="wl-del" data-wl-cat="' + escCat + '" data-wl-id="' + escId + '" title="delete">×</button>'
    + '</div>'
    + ((meta || item.priority !== 'medium')
      ? '<div class="wl-meta">'
        + (meta ? '<span class="wl-meta-text">' + esc(meta) + '</span>' : '')
        + (item.priority !== 'medium' ? '<span class="wl-prio ' + esc(item.priority) + '">' + (item.priority === 'high' ? 'HIGH' : 'LOW') + '</span>' : '')
        + '</div>'
      : '')
    + (showProgress
      ? '<div class="wl-progress">'
        + '<button class="wl-step" data-wl-cat="' + escCat + '" data-wl-id="' + escId + '" data-delta="-1">−</button>'
        + '<span class="wl-prog-val">' + (item.progress ?? stepMin) + '</span>'
        + '<button class="wl-step" data-wl-cat="' + escCat + '" data-wl-id="' + escId + '" data-delta="1">+</button>'
        + '</div>'
      : '')
    + '</div>';
}

function buildAddRow(cat, label) {
  return '<div class="wl-add-row" data-cat="' + esc(cat) + '">'
    + '<div class="wl-add-row-main">'
    + '<input class="wl-add-inp" data-cat="' + esc(cat) + '" placeholder="add ' + esc(label.toLowerCase()) + '..." maxlength="180">'
    + (cat === 'series' ? '<input class="wl-add-season" data-cat="' + esc(cat) + '" type="number" min="1" value="1" title="season">' : '')
    + '<select class="wl-add-pri" data-cat="' + esc(cat) + '">'
    + '<option value="medium">MED</option><option value="high">HIGH</option><option value="low">LOW</option>'
    + '</select>'
    + '<button class="wl-add-go" data-cat="' + esc(cat) + '">ADD</button>'
    + '<button class="wl-add-cancel" data-cat="' + esc(cat) + '">×</button>'
    + '</div>'
    + '<input class="wl-add-url" data-cat="' + esc(cat) + '" placeholder="link (optional)">'
    + '</div>';
}

function renderWatchlist() {
  const groups = document.getElementById('watchlistGroups');
  if (!groups) return;
  groups.innerHTML = watchlistCategories.map(c => {
    const items = [...(watchlistData[c.key] || [])].sort((a, b) => {
      const p = watchlistPriorityRank(a) - watchlistPriorityRank(b);
      if (p !== 0) return p;
      return (b.id || '').localeCompare(a.id || '');
    });
    return '<div class="wl-group" data-wl-group="' + esc(c.key) + '">'
      + '<div class="wl-group-head">'
      + '<div><div class="wl-kicker">' + esc(c.kicker || 'CUSTOM') + '</div><h3>' + esc(c.label) + '</h3></div>'
      + '<button class="wl-add-btn" data-cat="' + esc(c.key) + '">+ ADD</button>'
      + '</div>'
      + (items.length ? items.map(item => buildWatchlistCard(c.key, item)).join('') : '<div class="wl-empty">nothing here</div>')
      + '</div>';
  }).join('');
}

// ── ACTIONS ─────────────────────────────────────────────────────────────────
function getWatchlistItem(cat, id) {
  return (watchlistData[cat] || []).find(i => i.id === id);
}

async function toggleWatchlistItem(cat, id) {
  const item = getWatchlistItem(cat, id);
  if (!item) return;
  item.done = !item.done;
  await saveWatchlistState();
}

async function stepWatchlist(cat, id, delta) {
  const item = getWatchlistItem(cat, id);
  if (!item) return;
  const min = cat === 'manga' ? 0 : 1;
  item.progress = Math.max(min, (item.progress ?? min) + delta);
  await saveWatchlistState();
}

async function deleteWatchlistItem(cat, id) {
  watchlistData[cat] = (watchlistData[cat] || []).filter(i => i.id !== id);
  await saveWatchlistState();
}

function showAddRow(cat) {
  const existing = document.querySelector('.wl-add-row[data-cat="' + cat + '"]');
  if (existing) { existing.querySelector('.wl-add-inp').focus(); return; }
  const group = document.querySelector('.wl-group[data-wl-group="' + cat + '"]');
  if (!group) return;
  const head = group.querySelector('.wl-group-head');
  if (!head) return;
  const label = watchlistCategories.find(c => c.key === cat)?.label || cat;
  const row = document.createElement('div');
  row.innerHTML = buildAddRow(cat, label);
  const el = row.firstElementChild;
  head.after(el);
  el.querySelector('.wl-add-inp').focus();
}

async function commitAddRow(cat) {
  const row = document.querySelector('.wl-add-row[data-cat="' + cat + '"]');
  if (!row) return;
  const inp = row.querySelector('.wl-add-inp');
  const title = inp.value.trim();
  if (!title) return;
  const pri = row.querySelector('.wl-add-pri').value;
  const url = row.querySelector('.wl-add-url').value.trim().replace(/^javascript\s*:/i, '');
  const seasonEl = row.querySelector('.wl-add-season');
  const season = seasonEl ? Math.max(1, parseInt(seasonEl.value, 10) || 1) : null;
  watchlistData[cat] = watchlistData[cat] || [];
  const progDefault = cat === 'manga' ? 0 : cat === 'series' || cat === 'anime' ? 1 : null;
  watchlistData[cat].unshift({ id: uid(), title, url, done: false, priority: pri, progress: progDefault, season });
  await saveWatchlistState();
}

function cancelAddRow(cat) {
  const row = document.querySelector('.wl-add-row[data-cat="' + cat + '"]');
  if (row) row.remove();
}

// ── EXPORT / IMPORT ─────────────────────────────────────────────────────────
function exportWatchlist() {
  const payload = { version: 2, exported: new Date().toISOString(), items: watchlistData };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'watchlist_' + new Date().toISOString().slice(0, 10) + '.json'
  });
  link.click();
  URL.revokeObjectURL(link.href);
  toast('watchlist exported');
}

function importWatchlistFile(file) {
  const reader = new FileReader();
  reader.onload = async event => {
    try {
      const parsed = JSON.parse(event.target.result);
      const nextItems = parsed.items || (parsed.categories ? {} : null);
      if (!nextItems || typeof nextItems !== 'object') throw new Error('invalid watchlist file');
      watchlistData = Object.fromEntries(
        Object.entries(nextItems).map(([k, v]) => [k, Array.isArray(v) ? v : []])
      );
      migrateWatchlistItems();
      ensureWatchlistDataShape();
      await saveWatchlistState();
      toast('watchlist imported');
    } catch (error) {
      toast('watchlist import failed', 'var(--danger)');
    }
  };
  reader.readAsText(file);
}

// ── EVENT DELEGATION ────────────────────────────────────────────────────────
document.getElementById('watchlistGroups').addEventListener('click', e => {
  const btn = e.target.closest('[data-wl-cat]');
  if (!btn) {
    // + ADD button
    const addBtn = e.target.closest('.wl-add-btn');
    if (addBtn) { showAddRow(addBtn.dataset.cat); return; }
    // Cancel add
    const cancelBtn = e.target.closest('.wl-add-cancel');
    if (cancelBtn) { cancelAddRow(cancelBtn.dataset.cat); return; }
    // ADD go button
    const goBtn = e.target.closest('.wl-add-go');
    if (goBtn) { commitAddRow(goBtn.dataset.cat); return; }
    return;
  }
  const cat = btn.dataset.wlCat, id = btn.dataset.wlId;
  if (btn.classList.contains('wl-check')) { toggleWatchlistItem(cat, id); return; }
  if (btn.classList.contains('wl-del')) { deleteWatchlistItem(cat, id); return; }
  if (btn.classList.contains('wl-step')) { stepWatchlist(cat, id, Number(btn.dataset.delta)); return; }
});

document.getElementById('watchlistGroups').addEventListener('keydown', e => {
  const inp = e.target.closest('.wl-add-inp');
  if (!inp) return;
  if (e.key === 'Enter') { commitAddRow(inp.dataset.cat); return; }
  if (e.key === 'Escape') { cancelAddRow(inp.dataset.cat); return; }
});

document.getElementById('watchlistExportBtn').addEventListener('click', exportWatchlist);
document.getElementById('watchlistImportBtn').addEventListener('click', () => document.getElementById('watchlistImportFile').click());
document.getElementById('watchlistImportFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importWatchlistFile(file);
  e.target.value = '';
});
