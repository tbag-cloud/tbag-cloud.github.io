// ── WATCHLIST ────────────────────────────────────────────────────────────────
function emptyWatchlistState() {
  return Object.fromEntries(DEFAULT_WATCHLIST_CATEGORIES.map(category => [category.key, []]));
}

function defaultWatchlistCategories() {
  return DEFAULT_WATCHLIST_CATEGORIES.map(category => ({ ...category }));
}

function isDefaultWatchlistCategory(key) {
  return DEFAULT_WATCHLIST_CATEGORIES.some(category => category.key === key);
}

function loadWatchlistCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_WATCHLIST_CATEGORIES) || 'null');
    const dynamic = Array.isArray(parsed) && parsed.length ? parsed : defaultWatchlistCategories();
    watchlistCategories = dynamic.filter(category => category && category.key && category.label);
  } catch {
    watchlistCategories = defaultWatchlistCategories();
  }
}

function ensureWatchlistDataShape() {
  watchlistCategories.forEach(category => {
    if (!Array.isArray(watchlistData[category.key])) watchlistData[category.key] = [];
  });
}

function saveWatchlistCategories() {
  localStorage.setItem(LS_WATCHLIST_CATEGORIES, JSON.stringify(watchlistCategories));
}

function renderWatchlistCategoryOptions() {
  const select = document.getElementById('watchlistCategory');
  if (!select) return;
  select.innerHTML = watchlistCategories.map(category =>
    '<option value="' + esc(category.key) + '">' + esc(category.label) + '</option>'
  ).join('');
}

function renderWatchlistDeleteTargets(categoryKey) {
  const select = document.getElementById('watchlistDeleteTarget');
  if (!select) return;
  const options = watchlistCategories.filter(category => category.key !== categoryKey);
  select.innerHTML = options.map(category =>
    '<option value="' + esc(category.key) + '">' + esc(category.label) + '</option>'
  ).join('');
}

function loadGuestWatchlist() {
  loadWatchlistCategories();
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_WATCHLIST) || '{}');
    watchlistData = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value : []])
    );
  } catch {
    watchlistData = emptyWatchlistState();
  }
  ensureWatchlistDataShape();
}

function saveGuestWatchlist() {
  saveWatchlistCategories();
  ensureWatchlistDataShape();
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(watchlistData));
  renderWatchlist();
}

function serializeWatchlistCategoryRows() {
  return watchlistCategories.map((category, index) => ({
    user_id: currentUser.id,
    category_key: category.key,
    label: category.label,
    kicker: category.kicker || 'CUSTOM',
    sort_order: index
  }));
}

function serializeWatchlistItemRows() {
  return Object.entries(watchlistData).flatMap(([categoryKey, items]) =>
    (items || []).map(item => ({
      user_id: currentUser.id,
      id: item.id,
      category_key: categoryKey,
      title: item.title || '',
      url: item.url || '',
      status: item.status || 'Not Started',
      priority: item.priority || 'medium',
      track_mode: item.trackMode || null,
      season: item.season ?? null,
      episode: item.episode ?? null,
      progress: item.progress ?? null
    }))
  );
}

function hydrateWatchlistCategories(rows) {
  return rows
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(row => ({
      key: row.category_key,
      label: row.label,
      kicker: row.kicker || 'CUSTOM'
    }));
}

function hydrateWatchlistItems(rows) {
  const next = {};
  rows.forEach(row => {
    (next[row.category_key] = next[row.category_key] || []).push({
      id: row.id,
      title: row.title || '',
      url: row.url || '',
      status: row.status || 'Not Started',
      priority: row.priority || 'medium',
      ...(row.track_mode ? { trackMode: row.track_mode } : {}),
      ...(row.season !== null && row.season !== undefined ? { season: row.season } : {}),
      ...(row.episode !== null && row.episode !== undefined ? { episode: row.episode } : {}),
      ...(row.progress !== null && row.progress !== undefined ? { progress: row.progress } : {})
    });
  });
  return next;
}

function hasWatchlistContent() {
  return watchlistCategories.some(category => !isDefaultWatchlistCategory(category.key))
    || Object.values(watchlistData).some(items => Array.isArray(items) && items.length);
}

function isMissingWatchlistTable(error) {
  return error && (error.code === '42P01' || /watchlist_/i.test(error.message || ''));
}

async function ensureSyncedWatchlistDefaults() {
  const rows = serializeWatchlistCategoryRows();
  if (!rows.length) return;
  const { error } = await sb.from('watchlist_categories').upsert(rows, { onConflict: 'user_id,category_key' });
  if (error) throw error;
}

async function loadSyncedWatchlist() {
  if (!currentUser) return;
  const { data: categoryRows, error: categoryErr } = await sb
    .from('watchlist_categories')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order');
  if (categoryErr) throw categoryErr;

  if (!categoryRows?.length) {
    loadGuestWatchlist();
    if (hasWatchlistContent()) {
      await saveSyncedWatchlistState();
    } else {
      watchlistCategories = defaultWatchlistCategories();
      watchlistData = emptyWatchlistState();
      await ensureSyncedWatchlistDefaults();
    }
  } else {
    watchlistCategories = hydrateWatchlistCategories(categoryRows);
  }

  const { data: itemRows, error: itemErr } = await sb
    .from('watchlist_items')
    .select('*')
    .eq('user_id', currentUser.id);
  if (itemErr) throw itemErr;

  watchlistData = hydrateWatchlistItems(itemRows || []);
  ensureWatchlistDataShape();
  renderWatchlistCategoryOptions();
  renderWatchlist();
}

async function saveSyncedWatchlistState() {
  if (!currentUser || !watchlistSyncAvailable) return;
  ensureWatchlistDataShape();

  const categoryRows = serializeWatchlistCategoryRows();
  const itemRows = serializeWatchlistItemRows();
  dot('syncing');

  const { error: clearItemsErr } = await sb.from('watchlist_items').delete().eq('user_id', currentUser.id);
  if (clearItemsErr) throw clearItemsErr;

  const { error: clearCategoriesErr } = await sb.from('watchlist_categories').delete().eq('user_id', currentUser.id);
  if (clearCategoriesErr) throw clearCategoriesErr;

  if (categoryRows.length) {
    const { error } = await sb.from('watchlist_categories').insert(categoryRows);
    if (error) throw error;
  }

  if (itemRows.length) {
    const { error } = await sb.from('watchlist_items').insert(itemRows);
    if (error) throw error;
  }

  dot('ok');
}

async function saveWatchlistState() {
  if (mode === 'guest' || !watchlistSyncAvailable) {
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

function updateWatchlistComposerFields() {
  const category = document.getElementById('watchlistCategory').value;
  const episodicToggle = document.getElementById('watchlistEpisodicInput');
  episodicToggle.disabled = category === 'movies' || category === 'manga';
  if (category === 'manga') episodicToggle.checked = false;
}

function openCategoryComposer() {
  closeDeleteCategoryComposer();
  closeWatchlistComposer();
  document.getElementById('watchlistCategoryComposer').style.display = 'block';
  document.getElementById('watchlistCategoryNameInput').value = '';
  document.getElementById('watchlistCategoryKickerInput').value = 'CUSTOM';
  document.getElementById('watchlistCategoryNameInput').focus();
}

function closeCategoryComposer() {
  document.getElementById('watchlistCategoryComposer').style.display = 'none';
}

function openDeleteCategoryComposer(categoryKey) {
  if (isDefaultWatchlistCategory(categoryKey)) {
    toast('default categories stay locked', 'var(--danger)');
    return;
  }
  closeCategoryComposer();
  closeWatchlistComposer();
  const category = watchlistCategories.find(entry => entry.key === categoryKey);
  if (!category) return;
  const count = (watchlistData[categoryKey] || []).length;
  document.getElementById('watchlistDeleteCategoryKey').value = categoryKey;
  document.getElementById('watchlistDeleteTitle').textContent = 'Delete ' + category.label;
  document.getElementById('watchlistDeleteCopy').textContent = count
    ? 'This category has ' + count + ' item' + (count === 1 ? '' : 's') + '. Choose whether to move them first or delete them with the category.'
    : 'This category is empty, so deleting it just removes the section.';
  document.getElementById('watchlistDeleteOptions').style.display = count ? 'flex' : 'none';
  document.getElementById('watchlistDeleteModeMove').checked = true;
  document.getElementById('watchlistDeleteModeDelete').checked = false;
  renderWatchlistDeleteTargets(categoryKey);
  document.getElementById('watchlistDeleteMoveField').style.display = count ? 'flex' : 'none';
  document.getElementById('watchlistCategoryDeleteComposer').style.display = 'block';
}

function closeDeleteCategoryComposer() {
  document.getElementById('watchlistCategoryDeleteComposer').style.display = 'none';
  document.getElementById('watchlistDeleteCategoryKey').value = '';
}

function openWatchlistComposer(category) {
  closeCategoryComposer();
  closeDeleteCategoryComposer();
  const composer = document.getElementById('watchlistComposer');
  composer.style.display = 'block';
  watchlistComposerOpen = true;
  watchlistComposerMode = 'add';
  const targetCategory = category || watchlistCategories[0]?.key || 'series';
  document.getElementById('watchlistOriginalCategory').value = targetCategory;
  document.getElementById('watchlistCategory').value = targetCategory;
  document.getElementById('watchlistComposerTitle').textContent = 'Add to ' + (watchlistCategories.find(c => c.key === targetCategory)?.label || targetCategory);
  document.getElementById('watchlistTitleInput').value = '';
  document.getElementById('watchlistUrlInput').value = '';
  document.getElementById('watchlistPriorityInput').value = 'medium';
  document.getElementById('watchlistEpisodicInput').checked = targetCategory === 'series' || targetCategory === 'anime';
  updateWatchlistComposerFields();
  document.getElementById('watchlistTitleInput').focus();
}

function closeWatchlistComposer() {
  watchlistComposerOpen = false;
  watchlistComposerMode = 'add';
  document.getElementById('watchlistEditId').value = '';
  document.getElementById('watchlistOriginalCategory').value = '';
  document.getElementById('watchlistComposer').style.display = 'none';
}

function getWatchlistState(item) {
  if (item.status === 'Finished' || item.status === 'Watched') return 'done';
  if (item.status === 'In Progress') return 'in-progress';
  return 'queued';
}

function getWatchlistTone(item) {
  const state = getWatchlistState(item);
  return state === 'done' ? 'good' : state === 'in-progress' ? 'warn' : 'muted';
}

function watchlistMeta(category, item) {
  if (category === 'manga') return 'page ' + (item.progress || 0);
  if (category === 'movies') return 'movie';
  if (category === 'series') return item.trackMode === 'episodic'
    ? 'S' + (item.season || 1) + ' · E' + (item.episode || 1)
    : 'series';
  if (category === 'anime') return item.trackMode === 'episodic'
    ? 'episode ' + (item.episode || 1)
    : 'anime';
  return category;
}

function watchlistPriority(item) {
  return item.priority || 'medium';
}

function watchlistPriorityLabel(item) {
  const priority = watchlistPriority(item);
  return priority === 'high' ? 'HIGH PRIORITY' : priority === 'low' ? 'LOW PRIORITY' : 'MED PRIORITY';
}

function watchlistPriorityRank(item) {
  const priority = watchlistPriority(item);
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function watchlistStateLabel(category, item) {
  const state = getWatchlistState(item);
  if (state === 'done') return category === 'movies' ? 'WATCHED' : 'FINISHED';
  if (state === 'in-progress') return category === 'manga' ? 'READING' : 'WATCHING';
  return 'PLANNED';
}

function buildWatchlistActions(category, item) {
  const finishLabel = category === 'movies' ? 'MARK WATCHED' : 'MARK FINISHED';
  const changeBtn = '<button class="watchlist-mini" data-wl-action="cycle" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" type="button">CHANGE STATUS</button>';
  const finishBtn = '<button class="watchlist-mini" data-wl-action="finish" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" type="button">' + finishLabel + '</button>';
  const editBtn = '<button class="watchlist-mini" data-wl-action="edit" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" type="button">EDIT</button>';
  if (category === 'manga') {
    return '<button class="watchlist-mini" data-wl-action="step" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="-1" type="button">-1</button>'
      + '<button class="watchlist-mini" data-wl-action="step" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="1" type="button">+1</button>'
      + changeBtn + finishBtn + editBtn;
  }
  if (category === 'movies') {
    return changeBtn + finishBtn + editBtn;
  }
  if (item.trackMode === 'episodic') {
    if (category === 'series') {
      return '<button class="watchlist-mini" data-wl-action="season" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="-1" type="button">S-</button>'
        + '<button class="watchlist-mini" data-wl-action="season" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="1" type="button">S+</button>'
        + '<button class="watchlist-mini" data-wl-action="episode" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="-1" type="button">E-</button>'
        + '<button class="watchlist-mini" data-wl-action="episode" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="1" type="button">E+</button>'
        + changeBtn + finishBtn + editBtn;
    }
    return '<button class="watchlist-mini" data-wl-action="episode" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="-1" type="button">EP-</button>'
      + '<button class="watchlist-mini" data-wl-action="episode" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" data-step="1" type="button">EP+</button>'
      + changeBtn + finishBtn + editBtn;
  }
  return changeBtn + finishBtn + editBtn;
}

function buildWatchlistCard(category, item) {
  const stateLabel = watchlistStateLabel(category, item);
  const progressOpen = watchlistExpanded.has(item.id);
  return '<article class="watchlist-card" data-wl-id="' + item.id + '">'
    + '<div class="watchlist-card-tools">'
    + '<button class="watchlist-edit" data-wl-action="toggle-progress" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" type="button">' + (progressOpen ? 'HIDE' : 'SHOW') + '</button>'
    + '<button class="watchlist-delete" data-wl-action="delete" data-wl-cat="' + category + '" data-wl-id="' + item.id + '" type="button">DEL</button>'
    + '</div>'
    + '<div class="watchlist-title">' + esc(item.title || 'Untitled') + '</div>'
    + '<div class="watchlist-meta">'
    + '<span class="watchlist-chip ' + getWatchlistTone(item) + '">' + esc(stateLabel) + '</span>'
    + '<span class="watchlist-chip priority-' + esc(watchlistPriority(item)) + '">' + esc(watchlistPriorityLabel(item)) + '</span>'
    + '</div>'
    + '<div class="watchlist-submeta">' + esc(watchlistMeta(category, item)) + '</div>'
    + '<div class="watchlist-progress-panel' + (progressOpen ? ' open' : '') + '">' + buildWatchlistActions(category, item) + '</div>'
    + '<div class="watchlist-actions">'
    + (item.url ? '<a class="watchlist-link" href="' + esc(item.url) + '" target="_blank" rel="noopener">OPEN</a>' : '<span class="watchlist-link">NO LINK</span>')
    + '</div>'
    + '</article>';
}

function renderWatchlist() {
  const groups = document.getElementById('watchlistGroups');
  if (!groups) return;
  groups.innerHTML = watchlistCategories.map(category => {
    const items = [...(watchlistData[category.key] || [])].sort((a, b) => {
      const prio = watchlistPriorityRank(a) - watchlistPriorityRank(b);
      if (prio !== 0) return prio;
      return (b.id || '').localeCompare(a.id || '');
    });
    return '<section class="watchlist-group">'
      + '<div class="watchlist-group-head">'
      + '<div><div class="watchlist-group-kicker">' + esc(category.kicker || 'CUSTOM') + '</div><h3>' + esc(category.label) + '</h3></div>'
      + '<div class="watchlist-group-actions">'
      + '<button class="watchlist-add-btn" data-cat="' + esc(category.key) + '" type="button">+ ADD</button>'
      + (!isDefaultWatchlistCategory(category.key)
        ? '<button class="watchlist-mini" data-cat-del="' + esc(category.key) + '" type="button">DELETE CATEGORY</button>'
        : '')
      + '</div>'
      + '</div>'
      + '<div class="watchlist-grid" id="watchlist-' + esc(category.key) + '">'
      + (items.length ? items.map(item => buildWatchlistCard(category.key, item)).join('') : '<div class="watchlist-empty">nothing here yet</div>')
      + '</div></section>';
  }).join('');
  updateWatchlistStats();
}

async function removeWatchlistCategory(categoryKey) {
  const count = (watchlistData[categoryKey] || []).length;
  const moveMode = count && document.getElementById('watchlistDeleteModeMove').checked;
  const targetKey = document.getElementById('watchlistDeleteTarget').value;
  if (moveMode) {
    if (!targetKey || targetKey === categoryKey) {
      toast('pick a category to move into', 'var(--danger)');
      return;
    }
    watchlistData[targetKey] = [...(watchlistData[targetKey] || []), ...(watchlistData[categoryKey] || [])];
  }
  delete watchlistData[categoryKey];
  watchlistCategories = watchlistCategories.filter(entry => entry.key !== categoryKey);
  renderWatchlistCategoryOptions();
  closeDeleteCategoryComposer();
  await saveWatchlistState();
  toast('category deleted');
}

function getWatchlistItem(category, id) {
  return (watchlistData[category] || []).find(item => item.id === id);
}

async function cycleWatchlistStatus(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  const states = ['Not Started', 'In Progress'];
  const current = states.indexOf(item.status || 'Not Started');
  item.status = states[(current + 1) % states.length];
  await saveWatchlistState();
  toast('watchlist updated');
}

async function finishWatchlistItem(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  item.status = category === 'movies' ? 'Watched' : 'Finished';
  await saveWatchlistState();
  toast(category === 'movies' ? 'marked as watched' : 'marked as finished');
}

async function stepWatchlist(category, id, field, step) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  item[field] = Math.max(0, (item[field] || (field === 'season' || field === 'episode' ? 1 : 0)) + step);
  if (field === 'season' || field === 'episode') item[field] = Math.max(1, item[field]);
  await saveWatchlistState();
}

async function deleteWatchlistItem(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  if (!confirm('Delete "' + item.title + '" from your watchlist?')) return;
  watchlistData[category] = (watchlistData[category] || []).filter(entry => entry.id !== id);
  await saveWatchlistState();
  toast('watchlist item deleted', 'var(--accent2)');
}

function editWatchlistItem(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  const composer = document.getElementById('watchlistComposer');
  composer.style.display = 'block';
  watchlistComposerOpen = true;
  watchlistComposerMode = 'edit';
  document.getElementById('watchlistEditId').value = item.id;
  document.getElementById('watchlistOriginalCategory').value = category;
  document.getElementById('watchlistCategory').value = category;
  document.getElementById('watchlistComposerTitle').textContent = 'Edit ' + (watchlistCategories.find(entry => entry.key === category)?.label || category);
  document.getElementById('watchlistTitleInput').value = item.title || '';
  document.getElementById('watchlistUrlInput').value = item.url || '';
  document.getElementById('watchlistPriorityInput').value = watchlistPriority(item);
  document.getElementById('watchlistEpisodicInput').checked = !!item.trackMode;
  updateWatchlistComposerFields();
  document.getElementById('watchlistTitleInput').focus();
}

function addWatchlistItem(category) {
  openWatchlistComposer(category);
}

function quickAddWatchlistItem() {
  openCategoryComposer();
}

async function saveWatchlistCategory() {
  const raw = document.getElementById('watchlistCategoryNameInput').value.trim();
  if (!raw) {
    toast('category name needed', 'var(--danger)');
    document.getElementById('watchlistCategoryNameInput').focus();
    return;
  }
  const label = raw;
  const keyBase = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const key = keyBase || ('category-' + uid());
  if (watchlistCategories.some(category => category.key === key || category.label.toLowerCase() === label.toLowerCase())) {
    toast('category already exists', 'var(--danger)');
    return;
  }
  const kickerRaw = document.getElementById('watchlistCategoryKickerInput').value.trim();
  watchlistCategories.push({ key, label, kicker: (kickerRaw || 'CUSTOM').toUpperCase().slice(0, 20) });
  watchlistData[key] = [];
  renderWatchlistCategoryOptions();
  await saveWatchlistState();
  closeCategoryComposer();
  toast('category added');
}

function exportWatchlist() {
  const payload = {
    version: 1,
    exported: new Date().toISOString(),
    categories: watchlistCategories,
    items: watchlistData
  };
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
      const nextCategories = Array.isArray(parsed.categories) ? parsed.categories.filter(category => category?.key && category?.label) : null;
      const nextItems = parsed.items && typeof parsed.items === 'object' ? parsed.items : null;
      if (!nextCategories || !nextItems) throw new Error('invalid watchlist file');
      watchlistCategories = nextCategories;
      watchlistData = Object.fromEntries(
        Object.entries(nextItems).map(([key, value]) => [key, Array.isArray(value) ? value : []])
      );
      ensureWatchlistDataShape();
      renderWatchlistCategoryOptions();
      closeCategoryComposer();
      closeDeleteCategoryComposer();
      closeWatchlistComposer();
      await saveWatchlistState();
      toast('watchlist imported');
    } catch (error) {
      toast('watchlist import failed', 'var(--danger)');
    }
  };
  reader.readAsText(file);
}

async function saveWatchlistComposer() {
  const category = document.getElementById('watchlistCategory').value;
  const title = document.getElementById('watchlistTitleInput').value.trim();
  if (!title) {
    toast('title needed', 'var(--danger)');
    document.getElementById('watchlistTitleInput').focus();
    return;
  }
  const editId = document.getElementById('watchlistEditId').value;
  const originalCategory = document.getElementById('watchlistOriginalCategory').value || category;
  const sourceCategory = editId ? originalCategory : category;
  const existingIndex = editId ? (watchlistData[sourceCategory] || []).findIndex(item => item.id === editId) : -1;
  const item = existingIndex >= 0 ? watchlistData[sourceCategory][existingIndex] : { id: uid() };
  const existingStatus = existingIndex >= 0 ? (item.status || 'Not Started') : 'Not Started';

  item.title = title;
  item.url = document.getElementById('watchlistUrlInput').value.trim();
  item.status = existingStatus;
  item.priority = document.getElementById('watchlistPriorityInput').value;
  delete item.note;
  delete item.trackMode;
  delete item.season;
  delete item.episode;
  delete item.progress;
  delete item.alreadyWatching;

  if (category === 'manga') {
    item.progress = existingIndex >= 0 ? (item.progress || 0) : 0;
  } else if (document.getElementById('watchlistEpisodicInput').checked) {
    item.trackMode = 'episodic';
    if (category === 'series') item.season = existingIndex >= 0 ? (item.season || 1) : 1;
    item.episode = existingIndex >= 0 ? (item.episode || 1) : 1;
  }

  if (existingIndex >= 0 && sourceCategory !== category) {
    watchlistData[sourceCategory] = (watchlistData[sourceCategory] || []).filter(entry => entry.id !== editId);
    watchlistData[category].unshift(item);
  } else if (existingIndex < 0) {
    watchlistData[category].unshift(item);
  }
  await saveWatchlistState();
  closeWatchlistComposer();
  toast(existingIndex >= 0 ? 'watchlist item updated' : 'added to watchlist');
}
