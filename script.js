// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';
const MAX_GUEST_FILE = 5 * 1024 * 1024;
const MAX_SYNC_FILE  = 1024 * 1024 * 1024;
const SYNC_STORAGE_LIMIT = 1024 * 1024 * 1024;
const DATABASE_LIMIT_ESTIMATE = 500 * 1024 * 1024;
const ADMIN_EMAILS = ['themiplayz1@gmail.com'];

// ── STATE ─────────────────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let mode = 'guest';
let currentUser = null;
let todos = [];
let attMap = {};
let filter = 'all';
let searchQ = '';
let editingId = null;
let confirmDeleteId = null;
let expandedIds = new Set();
let openAttIds = new Set();
let globalUsage = null;
let siteNotice = null;
let adminPanelOpen = false;
let currentPage = 'todo';
let watchlistData = { manga: [], movies: [], series: [], anime: [] };
let watchlistCategories = [];
let watchlistExpanded = new Set();
let watchlistComposerOpen = false;
let watchlistComposerMode = 'add';

const LS_TODOS = 'todo_v3_todos';
const LS_ATTS  = 'todo_v3_atts';
const LS_WATCHLIST = 'watchlist_v1';
const LS_WATCHLIST_CATEGORIES = 'watchlist_v1_categories';
const DEFAULT_WATCHLIST_CATEGORIES = [
  { key: 'manga', label: 'Manga', kicker: 'READING' },
  { key: 'movies', label: 'Films', kicker: 'MOVIES' },
  { key: 'series', label: 'Series', kicker: 'SHOWS' },
  { key: 'anime', label: 'Anime', kicker: 'ANIME' }
];

// ── UTILS ─────────────────────────────────────────────────────────────────────
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}).toUpperCase();
const fmtSize = b => {
  if (b < 1024) return b + 'B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + 'KB';
  if (b < 1024 ** 3) return (b / (1024 ** 2)).toFixed(1) + 'MB';
  return (b / (1024 ** 3)).toFixed(2) + 'GB';
};
const mimeIcon = m => m.startsWith('image/')?'🖼':m==='application/pdf'?'📄':m.startsWith('video/')?'🎬':m.startsWith('audio/')?'🎵':m.includes('zip')?'🗜':'📎';
const fmtCount = n => new Intl.NumberFormat('en-GB').format(n || 0);

// Normalize DB row → JS object
function normalize(t) {
  return {
    id: t.id,
    text: t.text || '',
    desc: t.description || t.desc || '',
    priority: t.priority || 'medium',
    done: !!t.done,
    created: t.created_at || t.created || new Date().toISOString()
  };
}

let toastTimer;
function toast(msg, col) {
  const el = document.getElementById('toast');
  el.textContent = '// ' + msg;
  el.style.color = col || 'var(--green)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function dot(s) { document.getElementById('syncDot').className = 'sync-dot ' + s; }
function isAdminUser() { return !!currentUser?.email && ADMIN_EMAILS.includes(currentUser.email.toLowerCase()); }
function renderUsageList(elId, rows, emptyText) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.textContent = emptyText;
    return;
  }
  el.innerHTML = rows.map(row =>
    '<div class="row"><span class="k">' + esc(row.key) + '</span><span class="v">' + esc(row.value) + '</span></div>'
  ).join('');
}
function updateSiteBanner() {
  const banner = document.getElementById('siteBanner');
  if (!banner) return;
  if (!siteNotice?.enabled || !siteNotice?.message?.trim()) {
    banner.style.display = 'none';
    return;
  }
  banner.classList.remove('maintenance', 'announcement');
  banner.classList.add(siteNotice.maintenance ? 'maintenance' : 'announcement');
  document.getElementById('siteBannerTitle').textContent = siteNotice.maintenance ? 'MAINTENANCE NOTICE' : 'ANNOUNCEMENT';
  document.getElementById('siteBannerText').textContent = siteNotice.message;
  banner.style.display = 'block';
}
function updateAdminPanelState() {
  const panel = document.getElementById('globalUsagePanel');
  const body = document.getElementById('adminPanelBody');
  if (!panel || !body) return;
  panel.classList.toggle('open', adminPanelOpen);
  body.style.display = adminPanelOpen ? 'block' : 'none';
}
function updateGlobalUsagePanel() {
  const panel = document.getElementById('globalUsagePanel');
  if (!panel) return;
  if (mode !== 'synced' || !isAdminUser() || !globalUsage) {
    panel.style.display = 'none';
    return;
  }
  document.getElementById('globalAttachmentBytes').textContent = fmtSize(globalUsage.total_attachment_bytes || 0);
  document.getElementById('globalTodoCount').textContent = fmtCount(globalUsage.total_todo_count || 0);
  document.getElementById('globalAttachmentCount').textContent = fmtCount(globalUsage.total_attachment_count || 0);
  document.getElementById('globalUserCount').textContent = fmtCount(globalUsage.total_user_count || 0);
  renderUsageList('topStorageUsers', (globalUsage.top_storage_users || []).map(user => ({
    key: user.email || user.user_id || 'unknown',
    value: fmtSize(user.total_bytes || 0) + ' · ' + fmtCount(user.attachment_count || 0) + ' files'
  })), 'No attachment data');
  renderUsageList('fileTypeBreakdown', (globalUsage.file_type_breakdown || []).map(type => ({
    key: type.mime_type || 'unknown',
    value: fmtCount(type.file_count || 0) + ' · ' + fmtSize(type.total_bytes || 0)
  })), 'No file types yet');
  document.getElementById('noticeEnabled').checked = !!siteNotice?.enabled;
  document.getElementById('noticeText').value = siteNotice?.message || '';
  document.getElementById('noticeModeAnnouncement').checked = !siteNotice?.maintenance;
  document.getElementById('noticeModeMaintenance').checked = !!siteNotice?.maintenance;
  panel.style.display = 'block';
  updateAdminPanelState();
}

async function loadGlobalUsage() {
  if (mode !== 'synced' || !isAdminUser()) {
    globalUsage = null;
    updateGlobalUsagePanel();
    return;
  }
  const { data, error } = await sb.rpc('get_global_usage_totals');
  if (error) {
    globalUsage = null;
    updateGlobalUsagePanel();
    return;
  }
  globalUsage = Array.isArray(data) ? data[0] : data;
  updateGlobalUsagePanel();
}
async function loadSiteNotice() {
  const { data, error } = await sb.rpc('get_public_notice');
  if (error) {
    siteNotice = null;
    updateSiteBanner();
    return;
  }
  siteNotice = Array.isArray(data) ? data[0] : data;
  updateSiteBanner();
  updateGlobalUsagePanel();
}
async function saveSiteNotice() {
  if (!isAdminUser()) return;
  const enabled = document.getElementById('noticeEnabled').checked;
  const message = document.getElementById('noticeText').value.trim();
  const maintenance = document.getElementById('noticeModeMaintenance').checked;
  const { error } = await sb.rpc('set_public_notice', {
    p_enabled: enabled,
    p_message: message,
    p_maintenance: maintenance
  });
  if (error) {
    toast('notice save failed: ' + error.message, 'var(--danger)');
    return;
  }
  siteNotice = { enabled, message, maintenance };
  updateSiteBanner();
  updateGlobalUsagePanel();
  toast('notice saved');
}

// ── APP PAGES ────────────────────────────────────────────────────────────────
function closeAppMenu() {
  const menu = document.getElementById('appMenu');
  if (menu) menu.style.display = 'none';
}

function updatePageMenuState() {
  document.querySelectorAll('.app-menu-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === currentPage);
  });
}

function updateWatchlistStats() {
  document.getElementById('statsLabel').textContent = '';
}

function setPage(page) {
  currentPage = page === 'watchlist' ? 'watchlist' : 'todo';
  document.getElementById('todoPage').style.display = currentPage === 'todo' ? 'block' : 'none';
  document.getElementById('watchlistPage').style.display = currentPage === 'watchlist' ? 'block' : 'none';
  document.getElementById('todoToolbar').style.display = currentPage === 'todo' ? 'flex' : 'none';
  const title = document.querySelector('h1 span');
  if (title) title.textContent = currentPage === 'todo' ? 'TODO' : 'WATCHLIST';
  updatePageMenuState();
  closeAppMenu();
  if (currentPage === 'todo') render();
  else updateWatchlistStats();
}

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

function loadWatchlist() {
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

function saveWatchlist() {
  ensureWatchlistDataShape();
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(watchlistData));
  renderWatchlist();
}

function updateWatchlistComposerFields() {
  const category = document.getElementById('watchlistCategory').value;
  const episodicToggle = document.getElementById('watchlistEpisodicInput');
  episodicToggle.disabled = category === 'movies' || category === 'manga';
  if (category === 'manga') episodicToggle.checked = false;
}

function openCategoryComposer() {
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

function removeWatchlistCategory(categoryKey) {
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
  saveWatchlistCategories();
  saveWatchlist();
  renderWatchlistCategoryOptions();
  closeDeleteCategoryComposer();
  toast('category deleted');
}

function getWatchlistItem(category, id) {
  return (watchlistData[category] || []).find(item => item.id === id);
}

function cycleWatchlistStatus(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  const states = ['Not Started', 'In Progress'];
  const current = states.indexOf(item.status || 'Not Started');
  item.status = states[(current + 1) % states.length];
  saveWatchlist();
  toast('watchlist updated');
}

function finishWatchlistItem(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  item.status = category === 'movies' ? 'Watched' : 'Finished';
  saveWatchlist();
  toast(category === 'movies' ? 'marked as watched' : 'marked as finished');
}

function stepWatchlist(category, id, field, step) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  item[field] = Math.max(0, (item[field] || (field === 'season' || field === 'episode' ? 1 : 0)) + step);
  if (field === 'season' || field === 'episode') item[field] = Math.max(1, item[field]);
  saveWatchlist();
}

function deleteWatchlistItem(category, id) {
  const item = getWatchlistItem(category, id);
  if (!item) return;
  if (!confirm('Delete "' + item.title + '" from your watchlist?')) return;
  watchlistData[category] = (watchlistData[category] || []).filter(entry => entry.id !== id);
  saveWatchlist();
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

function saveWatchlistCategory() {
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
  saveWatchlistCategories();
  renderWatchlistCategoryOptions();
  renderWatchlist();
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
  reader.onload = event => {
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
      saveWatchlistCategories();
      saveWatchlist();
      renderWatchlistCategoryOptions();
      closeCategoryComposer();
      closeDeleteCategoryComposer();
      closeWatchlistComposer();
      toast('watchlist imported');
    } catch (error) {
      toast('watchlist import failed', 'var(--danger)');
    }
  };
  reader.readAsText(file);
}

function saveWatchlistComposer() {
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

  item.title = title;
  item.url = document.getElementById('watchlistUrlInput').value.trim();
  item.status = 'Not Started';
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
  saveWatchlist();
  closeWatchlistComposer();
  toast(existingIndex >= 0 ? 'watchlist item updated' : 'added to watchlist');
}

// ── IMAGE COMPRESS ────────────────────────────────────────────────────────────
async function compressImage(file, maxW=1600, quality=0.82) {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let {width:w, height:h} = img;
      if (w <= maxW && h <= maxW) { resolve(file); return; }
      const ratio = Math.min(maxW/w, maxW/h);
      w = Math.round(w*ratio); h = Math.round(h*ratio);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(blob => {
        if (!blob || blob.size >= file.size) { resolve(file); return; }
        resolve(new File([blob], file.name, {type: blob.type || file.type}));
      }, file.type || 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── STORAGE METER ─────────────────────────────────────────────────────────────
function updateStorageMeter() {
  const bar = document.getElementById('storageBar');
  const fill = document.getElementById('storageFill');
  const label = document.getElementById('storageLabel');
  const dbBar = document.getElementById('dbStorageBar');
  const dbFill = document.getElementById('dbStorageFill');
  const dbLabel = document.getElementById('dbStorageLabel');
  bar.className = 'storage-bar visible';

  if (mode === 'guest') {
    document.getElementById('btnClearAtts').style.display = 'none';
    dbBar.className = 'storage-bar';
    globalUsage = null;
    updateGlobalUsagePanel();
    let bytes = 0;
    try { bytes = (localStorage.getItem(LS_TODOS)||'').length + (localStorage.getItem(LS_ATTS)||'').length; } catch {}
    const pct = Math.min(100, (bytes / 5000000) * 100);
    fill.className = 'storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
    fill.style.width = pct.toFixed(1) + '%';
    label.textContent = 'local storage: ' + fmtSize(bytes) + ' / ~5MB';
  } else {
    const bytes = Object.values(attMap).flat().reduce((s,a) => s + (a.size||0), 0);
    const pct = Math.min(100, (bytes / SYNC_STORAGE_LIMIT) * 100);
    fill.className = 'storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
    fill.style.width = pct.toFixed(1) + '%';
    label.textContent = 'supabase storage: ' + fmtSize(bytes) + ' / 1GB (' + pct.toFixed(0) + '%)';

    const todoBytes = new Blob([JSON.stringify(todos)]).size;
    const dbPct = Math.min(100, (todoBytes / DATABASE_LIMIT_ESTIMATE) * 100);
    dbBar.className = 'storage-bar visible';
    dbFill.className = 'storage-fill' + (dbPct > 80 ? ' full' : dbPct > 60 ? ' warn' : '');
    dbFill.style.width = dbPct.toFixed(1) + '%';
    dbLabel.textContent = 'database estimate (todos): ' + fmtSize(todoBytes) + ' / ~500MB (' + dbPct.toFixed(0) + '%)';

    // Show clear-done-attachments button if relevant
    const doneIds = new Set(todos.filter(t=>t.done).map(t=>t.id));
    const hasDoneAtts = Object.keys(attMap).some(id => doneIds.has(id) && attMap[id].length > 0);
    document.getElementById('btnClearAtts').style.display = hasDoneAtts ? 'inline-block' : 'none';
    updateGlobalUsagePanel();
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
sb.auth.onAuthStateChange((event, session) => {
  if (session) {
    mode = 'synced';
    currentUser = session.user;

    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';

    const badge = document.getElementById('modeBadge');
    badge.textContent = 'SYNCED'; badge.className = 'mode-badge synced-mode';
    document.getElementById('btnSignOut').style.display = 'inline-block';
    document.getElementById('btnUpgrade').style.display = 'none';
    dot('ok');

    const av = document.getElementById('userAvatar');
    const ph = document.getElementById('avatarPh');
    if (session.user.user_metadata?.avatar_url) {
      av.src = session.user.user_metadata.avatar_url;
      av.style.display = 'inline-block'; ph.style.display = 'none';
    } else {
      av.removeAttribute('src');
      av.style.display = 'none';
      ph.style.display = 'flex';
      ph.textContent = (session.user.email||'?')[0].toUpperCase();
    }

    // Avoid issuing more Supabase calls directly inside the auth callback.
    setTimeout(() => {
      loadSynced().catch(error => {
        dot('err');
        toast('load error: ' + error.message, 'var(--danger)');
      });
    }, 0);

  } else {
    mode = 'guest'; currentUser = null;
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
  }
});

document.getElementById('btnGoogle').addEventListener('click', () =>
  sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } })
);
document.getElementById('btnSignOut').addEventListener('click', async () => {
  const { error } = await sb.auth.signOut();
  if (error) toast('sign out failed: ' + error.message, 'var(--danger)');
});
document.getElementById('btnGuest').addEventListener('click', enterGuestMode);
document.getElementById('btnUpgrade').addEventListener('click', () => {
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'block';
});

(async () => {
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.replace(/^#+/, ''));
    const at = params.get('access_token'), rt = params.get('refresh_token');
    if (at && rt) {
      await sb.auth.setSession({ access_token: at, refresh_token: rt });
      history.replaceState(null, '', window.location.pathname);
    }
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    document.getElementById('authScreen').style.display = 'block';
  }
  await loadSiteNotice();
})();

// ── GUEST MODE ────────────────────────────────────────────────────────────────
function enterGuestMode() {
  mode = 'guest'; currentUser = null;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('modeBadge').textContent = 'GUEST';
  document.getElementById('modeBadge').className = 'mode-badge guest-mode';
  document.getElementById('btnUpgrade').style.display = 'inline-block';
  document.getElementById('btnSignOut').style.display = 'none';
  document.getElementById('userAvatar').style.display = 'none';
  document.getElementById('avatarPh').textContent = '?';
  dot('');
  try { todos = JSON.parse(localStorage.getItem(LS_TODOS) || '[]'); } catch { todos = []; }
  try { attMap = JSON.parse(localStorage.getItem(LS_ATTS) || '{}'); } catch { attMap = {}; }
  globalUsage = null;
  render(); updateStorageMeter();
}

function saveGuest() {
  try {
    localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    localStorage.setItem(LS_ATTS, JSON.stringify(attMap));
  } catch(e) { toast('storage full', 'var(--accent2)'); }
  updateStorageMeter();
}

// ── LOAD SYNCED ───────────────────────────────────────────────────────────────
async function loadSynced() {
  dot('syncing');
  const { data: tData, error: tErr } = await sb.from('todos').select('*').eq('user_id', currentUser.id);
  const { data: aData, error: aErr } = await sb.from('attachments').select('*').eq('user_id', currentUser.id);

  if (tErr) { dot('err'); toast('load error: ' + tErr.message, 'var(--danger)'); return; }
  if (aErr) { dot('err'); toast('attachments load error: ' + aErr.message, 'var(--danger)'); return; }

  todos = (tData || [])
    .map(normalize)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  attMap = {};
  (aData || [])
    .sort((a, b) => new Date(a.created_at || a.created || 0) - new Date(b.created_at || b.created || 0))
    .forEach(a => {
    (attMap[a.todo_id] = attMap[a.todo_id] || []).push({
      id: a.id, name: a.name, size: a.size, mime: a.mime_type, path: a.path, todoId: a.todo_id
    });
  });

  dot('ok'); render(); updateStorageMeter();
  await loadGlobalUsage();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function addTodo(text, priority, desc) {
  text = text.trim(); if (!text) return;
  if (mode === 'guest') {
    todos.unshift({ id: uid(), text, desc: desc.trim(), priority, done: false, created: new Date().toISOString() });
    saveGuest(); render();
  } else {
    dot('syncing');
    const { error } = await sb.from('todos').insert({
      user_id: currentUser.id, text, description: desc.trim(), priority, done: false
    });
    if (error) { dot('err'); toast('add failed: ' + error.message, 'var(--danger)'); return; }
    await loadSynced();
  }
}

async function toggleDone(id) {
  const t = todos.find(t => t.id === id); if (!t) return;
  t.done = !t.done;
  if (mode === 'guest') { saveGuest(); render(); }
  else {
    render();
    dot('syncing');
    const { error } = await sb.from('todos').update({ done: t.done }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { t.done = !t.done; dot('err'); render(); } else dot('ok');
  }
}

async function removeStoragePaths(paths) {
  const clean = [...new Set(paths.filter(Boolean))];
  if (!clean.length) return;
  const { error } = await sb.storage.from('attachments').remove(clean);
  if (error) throw error;
}

async function deleteTodo(id) {
  confirmDeleteId = null;
  if (mode === 'guest') {
    todos = todos.filter(t => t.id !== id); delete attMap[id]; saveGuest(); render();
  } else {
    dot('syncing');
    try {
      await removeStoragePaths((attMap[id] || []).map(a => a.path));
      const { error: attErr } = await sb.from('attachments').delete().eq('todo_id', id).eq('user_id', currentUser.id);
      if (attErr) throw attErr;
      const { error } = await sb.from('todos').delete().eq('id', id).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('delete failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced();
  }
}

async function commitEdit(id, text, desc) {
  text = text.trim(); if (!text) { editingId = null; render(); return; }
  if (mode === 'guest') {
    const t = todos.find(t => t.id === id);
    if (t) { t.text = text; t.desc = desc.trim(); }
    editingId = null; saveGuest(); render();
  } else {
    dot('syncing');
    const { error } = await sb.from('todos').update({ text, description: desc.trim() }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { dot('err'); toast('save failed', 'var(--danger)'); return; }
    editingId = null; await loadSynced();
  }
}

async function clearDone() {
  const ids = todos.filter(t => t.done).map(t => t.id); if (!ids.length) return;
  if (mode === 'guest') {
    todos = todos.filter(t => !t.done); ids.forEach(id => delete attMap[id]); saveGuest(); render(); toast('completed cleared');
  } else {
    dot('syncing');
    try {
      await removeStoragePaths(ids.flatMap(id => (attMap[id] || []).map(a => a.path)));
      const { error: attErr } = await sb.from('attachments').delete().in('todo_id', ids).eq('user_id', currentUser.id);
      if (attErr) throw attErr;
      const { error } = await sb.from('todos').delete().in('id', ids).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('clear failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced(); toast('completed cleared');
  }
}

async function clearDoneAttachments() {
  const doneIds = new Set(todos.filter(t => t.done).map(t => t.id));
  const affected = Object.keys(attMap).filter(id => doneIds.has(id));
  if (!affected.length) { toast('no attachments on completed tasks'); return; }
  if (!confirm('Delete all attachments from completed tasks?')) return;
  if (mode === 'guest') {
    affected.forEach(id => delete attMap[id]); saveGuest(); render(); toast('cleared');
  } else {
    dot('syncing');
    try {
      await removeStoragePaths(affected.flatMap(id => (attMap[id] || []).map(a => a.path)));
      const { error } = await sb.from('attachments').delete().in('todo_id', affected).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('clear failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced(); toast('cleared attachments from completed tasks');
  }
}

// ── ATTACHMENTS ───────────────────────────────────────────────────────────────
async function uploadFile(todoId, rawFile) {
  const file = await compressImage(rawFile);
  if (file.size < rawFile.size) toast('compressed ' + rawFile.name + ': ' + fmtSize(rawFile.size) + ' → ' + fmtSize(file.size));

  if (mode === 'guest') {
    if (file.size > MAX_GUEST_FILE) { toast('guest: max 5MB per file', 'var(--accent2)'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      (attMap[todoId] = attMap[todoId] || []).push({ id: uid(), name: file.name, size: file.size, mime: file.type, dataUrl: ev.target.result });
      saveGuest(); render(); toast('attached ' + file.name);
    };
    reader.readAsDataURL(file);
  } else {
    if (file.size > MAX_SYNC_FILE) { toast('max 50MB per file', 'var(--accent2)'); return; }
    const ext = file.name.split('.').pop();
    const path = currentUser.id + '/' + todoId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext;
    dot('syncing');
    const { error: upErr } = await sb.storage.from('attachments').upload(path, file);
    if (upErr) { dot('err'); toast('upload failed: ' + upErr.message, 'var(--danger)'); return; }
    const { error: dbErr } = await sb.from('attachments').insert({
      todo_id: todoId, user_id: currentUser.id, name: file.name, size: file.size, mime_type: file.type, path
    });
    if (dbErr) {
      await removeStoragePaths([path]).catch(() => {});
      dot('err'); toast('record failed: ' + dbErr.message, 'var(--danger)'); return;
    }
    dot('ok'); toast('uploaded ' + file.name); await loadSynced();
  }
}

async function deleteAttachment(attId, todoId) {
  if (mode === 'guest') {
    if (attMap[todoId]) attMap[todoId] = attMap[todoId].filter(a => a.id !== attId);
    saveGuest(); render(); toast('removed');
  } else {
    const a = findAtt(attId); if (!a) return;
    dot('syncing');
    try {
      await removeStoragePaths([a.path]);
      const { error } = await sb.from('attachments').delete().eq('id', attId).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('remove failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced(); toast('removed');
  }
}

async function openAttachment(attId) {
  const a = findAtt(attId); if (!a) return;
  if (a.dataUrl) {
    if (a.mime && a.mime.startsWith('image/')) showImgModal(a.dataUrl, a.name, a);
    else downloadDataUrl(a);
    return;
  }
  if (a.path) {
    const { data } = await sb.storage.from('attachments').createSignedUrl(a.path, 120);
    if (data?.signedUrl) {
      if (a.mime && a.mime.startsWith('image/')) showImgModal(data.signedUrl, a.name, a);
      else openExternalSafe(data.signedUrl);
    }
  }
}

function openExternalSafe(url) {
  const win = window.open(url, '_blank', 'noopener');
  if (win) win.opener = null;
}

function showImgModal(src, name, att) {
  const m = document.createElement('div');
  m.className = 'img-modal';
  m.innerHTML = '<img src="' + esc(src) + '" alt="' + esc(name) + '">'
    + '<button class="img-modal-close">✕ CLOSE</button>'
    + '<button class="img-modal-dl">⬇ DOWNLOAD</button>';
  m.querySelector('.img-modal-close').onclick = () => m.remove();
  m.querySelector('.img-modal-dl').onclick = e => { e.stopPropagation(); if (att.dataUrl) downloadDataUrl(att); else openExternalSafe(src); };
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
}

function downloadDataUrl(a) {
  const link = document.createElement('a');
  link.href = a.dataUrl; link.download = a.name;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function findAtt(id) {
  for (const arr of Object.values(attMap)) { const a = arr.find(a => a.id === id); if (a) return a; }
  return null;
}

async function getSignedUrl(path) {
  const { data } = await sb.storage.from('attachments').createSignedUrl(path, 300);
  return data?.signedUrl || null;
}

async function importSyncedTodos(importedTodos, importedAtts, merge) {
  const skippedAttachments = Object.values(importedAtts).reduce((count, atts) => count + atts.length, 0);

  if (!merge) {
    await removeStoragePaths(Object.values(attMap).flat().map(a => a.path));
    const { error: attErr } = await sb.from('attachments').delete().eq('user_id', currentUser.id);
    if (attErr) throw attErr;
    const { error: todoErr } = await sb.from('todos').delete().eq('user_id', currentUser.id);
    if (todoErr) throw todoErr;
  }

  for (const todo of importedTodos) {
    const normalized = normalize(todo);
    const payload = {
      user_id: currentUser.id,
      text: normalized.text,
      description: normalized.desc,
      priority: normalized.priority,
      done: normalized.done
    };
    if (merge && todos.some(t => t.id === normalized.id)) continue;

    const { error } = await sb.from('todos').insert(payload);
    if (error) throw error;
  }

  await loadSynced();
  toast((merge ? 'merged ' : 'imported ') + importedTodos.length + ' tasks'
    + (skippedAttachments ? ' · attachments skipped in sync mode' : ''));
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function getFiltered() {
  let list = filter === 'active' ? todos.filter(t => !t.done)
    : filter === 'done' ? todos.filter(t => t.done)
    : filter === 'high' ? todos.filter(t => t.priority === 'high')
    : todos;
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(t => t.text.toLowerCase().includes(q) || (t.desc||'').toLowerCase().includes(q));
  }
  return list;
}

function render() {
  const list = getFiltered();
  const done = todos.filter(t => t.done).length;
  if (currentPage === 'todo') {
    document.getElementById('statsLabel').textContent = (todos.length - done) + ' active · ' + done + ' done' + (searchQ ? ' · ' + list.length + ' results' : '');
  }
  const bb = document.getElementById('bottomBar');
  bb.style.display = todos.length ? 'flex' : 'none';
  document.getElementById('bottomCount').textContent = todos.length + ' total';

  const tl = document.getElementById('todoList');
  if (!list.length) {
    tl.innerHTML = '<div class="empty"><div class="big">' + (searchQ ? '🔍' : filter === 'done' ? '☐' : '◈') + '</div><p>'
      + (searchQ ? 'no results for "' + esc(searchQ) + '"' : filter === 'done' ? 'nothing done yet' : filter === 'active' ? 'all caught up' : filter === 'high' ? 'no high priority' : 'add your first task')
      + '</p></div>';
    return;
  }
  tl.innerHTML = '';
  list.forEach(t => tl.appendChild(buildItem(t)));
  bindEvents(tl);
  if (mode === 'synced') loadSignedPreviews(tl);
}

function buildItem(t) {
  const isEdit = editingId === t.id;
  const isConfirmDel = confirmDeleteId === t.id;
  const isExpanded = expandedIds.has(t.id);
  const isAttOpen = openAttIds.has(t.id);
  const hasDesc = !!(t.desc && t.desc.trim());
  const atts = attMap[t.id] || [];

  const div = document.createElement('div');
  div.className = 'todo-item' + (t.done ? ' done' : '');
  div.dataset.id = t.id;

  let body;
  if (isEdit) {
    body = '<input class="edit-inp" value="' + esc(t.text) + '" data-id="' + t.id + '">'
      + '<textarea class="edit-desc-ta" data-id="' + t.id + '" rows="2" placeholder="description...">' + esc(t.desc||'') + '</textarea>';
  } else {
    const attBadge = atts.length ? ' · 📎 ' + atts.length : '';
    const descBtn = '<button class="expand-btn' + (hasDesc ? ' vis' : '') + (isExpanded ? ' open' : '') + '" data-role="desc" data-id="' + t.id + '"><i class="arr">▶</i> ' + (hasDesc ? (isExpanded ? 'hide' : 'notes') : '+ note') + '</button>';
    const attLabel = isAttOpen ? 'hide' : (atts.length ? 'files (' + atts.length + ')' : 'files');
    const attBtn = '<button class="expand-btn' + (atts.length ? ' vis' : '') + (isAttOpen ? ' open' : '') + '" data-role="att" data-id="' + t.id + '"><i class="arr">▶</i> ' + attLabel + '</button>';
    body = '<span class="todo-text">' + esc(t.text) + '</span>'
      + '<div class="todo-meta">' + t.priority.toUpperCase() + ' · ' + fmtDate(t.created) + attBadge + '</div>'
      + '<div class="expand-row">' + descBtn + attBtn + '</div>'
      + (hasDesc ? '<div class="todo-desc' + (isExpanded ? ' open' : '') + '">' + esc(t.desc) + '</div>' : '')
      + (isAttOpen ? buildAttPanel(t.id, atts) : '');
  }

  let actions;
  if (isEdit) {
    actions = '<button class="act save-btn" data-id="' + t.id + '">SAVE</button><button class="act cancel-btn">×</button>';
  } else if (isConfirmDel) {
    actions = '<span class="del-confirm"><span>sure?</span>'
      + '<button class="act del-yes" data-id="' + t.id + '">YES</button>'
      + '<button class="act del-no">NO</button></span>';
  } else {
    actions = '<button class="act edit-btn" data-id="' + t.id + '">EDIT</button>'
      + '<button class="act del confirm-del-btn" data-id="' + t.id + '">DEL</button>';
  }

  div.innerHTML = '<div class="pbar ' + t.priority + '"></div>'
    + '<div class="check-area" data-id="' + t.id + '"><div class="check-box"></div></div>'
    + '<div class="todo-body">' + body + '</div>'
    + '<div class="todo-actions">' + actions + '</div>';
  return div;
}

function buildAttPanel(todoId, atts) {
  const items = atts.map(a => {
    const isImg = (a.mime||'').startsWith('image/');
    return '<div class="att-row">'
      + '<span class="att-icon">' + mimeIcon(a.mime||'') + '</span>'
      + '<span class="att-name" data-att="' + a.id + '">' + esc(a.name) + '</span>'
      + '<span class="att-size">' + fmtSize(a.size||0) + '</span>'
      + '<button class="att-rm" data-att="' + a.id + '" data-tid="' + todoId + '">×</button>'
      + '</div>'
      + (isImg && a.dataUrl ? '<img class="att-img" src="' + esc(a.dataUrl) + '" alt="' + esc(a.name) + '" data-att="' + a.id + '">' : '')
      + (isImg && a.path ? '<img class="att-img" data-path="' + esc(a.path) + '" src="" alt="' + esc(a.name) + '" data-att="' + a.id + '">' : '');
  }).join('');

  const lim = mode === 'guest' ? 'max 5MB, images compressed' : 'max 50MB per file, images compressed';
  return '<div class="att-panel open">'
    + '<div class="att-list">' + items + '</div>'
    + '<div class="att-upload-row">'
    + '<label class="att-up-btn" for="fu-' + todoId + '">+ ATTACH FILE</label>'
    + '<input type="file" id="fu-' + todoId + '" class="file-input" data-tid="' + todoId + '" multiple>'
    + '<span class="att-prog" id="ap-' + todoId + '">uploading...</span>'
    + '<span class="compress-note">' + lim + '</span>'
    + '</div></div>';
}

async function loadSignedPreviews(container) {
  for (const img of container.querySelectorAll('.att-img[data-path]')) {
    const url = await getSignedUrl(img.dataset.path);
    if (url) img.src = url;
  }
}

function bindEvents(tl) {
  tl.querySelectorAll('.todo-item').forEach(item => {
    const btns = item.querySelectorAll('.expand-btn:not(.vis)');
    item.addEventListener('mouseenter', () => btns.forEach(b => b.style.opacity = '1'));
    item.addEventListener('mouseleave', () => btns.forEach(b => b.style.opacity = ''));
  });
  tl.querySelectorAll('.check-area').forEach(el => el.addEventListener('click', () => toggleDone(el.dataset.id)));
  tl.querySelectorAll('.edit-btn').forEach(el => el.addEventListener('click', () => {
    editingId = el.dataset.id; confirmDeleteId = null; render();
    requestAnimationFrame(() => { const i = document.querySelector('.edit-inp'); if (i) { i.focus(); i.select(); } });
  }));
  tl.querySelectorAll('.confirm-del-btn').forEach(el => el.addEventListener('click', () => {
    confirmDeleteId = el.dataset.id; editingId = null; render();
  }));
  tl.querySelectorAll('.del-yes').forEach(el => el.addEventListener('click', () => deleteTodo(el.dataset.id)));
  tl.querySelectorAll('.del-no').forEach(el => el.addEventListener('click', () => { confirmDeleteId = null; render(); }));
  tl.querySelectorAll('.save-btn').forEach(el => el.addEventListener('click', () => {
    const inp = tl.querySelector('.edit-inp'), desc = tl.querySelector('.edit-desc-ta');
    if (inp) commitEdit(el.dataset.id, inp.value, desc?.value || '');
  }));
  tl.querySelectorAll('.cancel-btn').forEach(el => el.addEventListener('click', () => { editingId = null; render(); }));
  tl.querySelectorAll('.edit-inp').forEach(inp => inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { editingId = null; render(); }
    if (e.key === 'Enter' && !e.shiftKey) { const desc = tl.querySelector('.edit-desc-ta'); commitEdit(inp.dataset.id, inp.value, desc?.value||''); }
  }));
  tl.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = btn.dataset.id, role = btn.dataset.role;
    if (role === 'desc') {
      if (!btn.classList.contains('vis') && !expandedIds.has(id)) {
        editingId = id; render();
        requestAnimationFrame(() => { const ta = document.querySelector('.edit-desc-ta'); if (ta) ta.focus(); });
        return;
      }
      expandedIds.has(id) ? expandedIds.delete(id) : expandedIds.add(id);
    } else {
      openAttIds.has(id) ? openAttIds.delete(id) : openAttIds.add(id);
    }
    render();
  }));
  tl.querySelectorAll('.att-name').forEach(el => el.addEventListener('click', () => openAttachment(el.dataset.att)));
  tl.querySelectorAll('.att-img').forEach(img => img.addEventListener('click', () => openAttachment(img.dataset.att)));
  tl.querySelectorAll('.att-rm').forEach(btn => btn.addEventListener('click', () => deleteAttachment(btn.dataset.att, btn.dataset.tid)));
  tl.querySelectorAll('.file-input').forEach(inp => inp.addEventListener('change', async () => {
    const tid = inp.dataset.tid;
    const prog = document.getElementById('ap-' + tid);
    if (prog) prog.style.display = 'inline';
    for (const f of inp.files) await uploadFile(tid, f);
    if (prog) prog.style.display = 'none';
    inp.value = '';
  }));
}

// ── ADD FORM ──────────────────────────────────────────────────────────────────
const newDesc = document.getElementById('newDesc');
newDesc.addEventListener('input', () => { newDesc.style.height = 'auto'; newDesc.style.height = Math.min(newDesc.scrollHeight, 120) + 'px'; });
function doAdd() {
  const text = document.getElementById('newTask').value.trim(); if (!text) return;
  addTodo(text, document.getElementById('newPri').value, newDesc.value);
  document.getElementById('newTask').value = ''; newDesc.value = ''; newDesc.style.height = 'auto';
  document.getElementById('newTask').focus();
}
document.getElementById('btnAdd').addEventListener('click', doAdd);
document.getElementById('newTask').addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

// ── SEARCH ────────────────────────────────────────────────────────────────────
document.getElementById('searchInp').addEventListener('input', e => {
  searchQ = e.target.value.trim();
  document.getElementById('searchClear').className = 'search-clear' + (searchQ ? ' vis' : '');
  render();
});
document.getElementById('searchClear').addEventListener('click', () => {
  searchQ = ''; document.getElementById('searchInp').value = '';
  document.getElementById('searchClear').className = 'search-clear'; render();
});

// ── FILTERS ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', () => {
  filter = btn.dataset.f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); render();
}));
document.getElementById('btnClear').addEventListener('click', clearDone);
document.getElementById('btnClearAtts').addEventListener('click', clearDoneAttachments);
document.getElementById('saveNoticeBtn').addEventListener('click', saveSiteNotice);
document.getElementById('adminPanelToggle').addEventListener('click', () => {
  adminPanelOpen = !adminPanelOpen;
  updateAdminPanelState();
});
document.getElementById('menuToggle').addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('appMenu');
  menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
});
document.querySelectorAll('.app-menu-item').forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
document.addEventListener('click', e => {
  if (!e.target.closest('.menu-wrap')) closeAppMenu();
});
document.getElementById('watchlistQuickAdd').addEventListener('click', quickAddWatchlistItem);
document.getElementById('watchlistExportBtn').addEventListener('click', exportWatchlist);
document.getElementById('watchlistImportBtn').addEventListener('click', () => document.getElementById('watchlistImportFile').click());
document.getElementById('watchlistImportFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importWatchlistFile(file);
  e.target.value = '';
});
document.getElementById('watchlistCategoryComposerClose').addEventListener('click', closeCategoryComposer);
document.getElementById('watchlistCategoryComposerSave').addEventListener('click', saveWatchlistCategory);
document.getElementById('watchlistCategoryDeleteClose').addEventListener('click', closeDeleteCategoryComposer);
document.getElementById('watchlistCategoryDeleteConfirm').addEventListener('click', () => {
  const key = document.getElementById('watchlistDeleteCategoryKey').value;
  if (key) removeWatchlistCategory(key);
});
document.getElementById('watchlistComposerClose').addEventListener('click', closeWatchlistComposer);
document.getElementById('watchlistComposerSave').addEventListener('click', saveWatchlistComposer);
document.getElementById('watchlistCategory').addEventListener('change', () => {
  const key = document.getElementById('watchlistCategory').value;
  const category = watchlistCategories.find(entry => entry.key === key);
  document.getElementById('watchlistComposerTitle').textContent = (watchlistComposerMode === 'edit' ? 'Edit ' : 'Add to ') + (category?.label || key);
  updateWatchlistComposerFields();
});
document.getElementById('watchlistEpisodicInput').addEventListener('change', updateWatchlistComposerFields);
document.getElementById('watchlistDeleteModeMove').addEventListener('change', () => {
  document.getElementById('watchlistDeleteMoveField').style.display = document.getElementById('watchlistDeleteModeMove').checked ? 'flex' : 'none';
});
document.getElementById('watchlistDeleteModeDelete').addEventListener('change', () => {
  document.getElementById('watchlistDeleteMoveField').style.display = document.getElementById('watchlistDeleteModeMove').checked ? 'flex' : 'none';
});
document.getElementById('watchlistGroups').addEventListener('click', e => {
  const addBtn = e.target.closest('.watchlist-add-btn');
  if (addBtn) {
    addWatchlistItem(addBtn.dataset.cat);
    return;
  }
  const deleteCategoryBtn = e.target.closest('[data-cat-del]');
  if (deleteCategoryBtn) {
    openDeleteCategoryComposer(deleteCategoryBtn.dataset.catDel);
    return;
  }
  const btn = e.target.closest('[data-wl-action]');
  if (!btn) return;
  const { wlAction: action, wlCat: category, wlId: id, step } = btn.dataset;
  if (action === 'delete') deleteWatchlistItem(category, id);
  else if (action === 'edit') editWatchlistItem(category, id);
  else if (action === 'cycle') cycleWatchlistStatus(category, id);
  else if (action === 'finish') finishWatchlistItem(category, id);
  else if (action === 'step') stepWatchlist(category, id, 'progress', Number(step || 0));
  else if (action === 'season') stepWatchlist(category, id, 'season', Number(step || 0));
  else if (action === 'episode') stepWatchlist(category, id, 'episode', Number(step || 0));
  else if (action === 'toggle-progress') {
    watchlistExpanded.has(id) ? watchlistExpanded.delete(id) : watchlistExpanded.add(id);
    renderWatchlist();
  }
});

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
document.getElementById('btnExport').addEventListener('click', () => {
  try {
    const blob = new Blob([JSON.stringify({ version: 3, exported: new Date().toISOString(), todos, attachments: attMap }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'todos_' + new Date().toISOString().slice(0,10) + '.json' });
    a.click(); URL.revokeObjectURL(a.href);
    toast('exported ' + todos.length + ' tasks');
  } catch(e) { toast('export failed', 'var(--danger)'); }
});

document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const merge = confirm('OK = Merge (keep existing)\nCancel = Replace all');
  if (!merge && !confirm('⚠️ Replace ALL current tasks?')) { e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const importedTodos = Array.isArray(data) ? data : (data.todos || []);
      const importedAtts = data.attachments || {};
      if (mode === 'guest' && merge) {
        const ex = new Set(todos.map(t => t.id));
        todos = [...importedTodos.filter(t => !ex.has(t.id)), ...todos];
        for (const [tid, atts] of Object.entries(importedAtts)) {
          if (!attMap[tid]) attMap[tid] = [];
          const exA = new Set(attMap[tid].map(a => a.id));
          attMap[tid] = [...attMap[tid], ...atts.filter(a => !exA.has(a.id))];
        }
        toast('merged ' + importedTodos.length + ' tasks');
      } else if (mode === 'guest') {
        todos = [...importedTodos]; attMap = { ...importedAtts };
        toast('replaced with ' + todos.length + ' tasks');
      }
      if (mode === 'guest') { saveGuest(); render(); }
      else { await importSyncedTodos(importedTodos, importedAtts, merge); }
    } catch(err) { toast('import failed: ' + err.message, 'var(--danger)'); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('service worker registered:', reg.scope))
      .catch(error => console.error('service worker registration failed:', error));
  });
}

loadWatchlistCategories();
renderWatchlistCategoryOptions();
loadWatchlist();
renderWatchlist();
setPage('todo');
