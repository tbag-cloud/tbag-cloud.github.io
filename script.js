// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';
const MAX_GUEST_FILE = 5 * 1024 * 1024;
const MAX_SYNC_FILE  = 50 * 1024 * 1024;
const SYNC_STORAGE_LIMIT = 1024 * 1024 * 1024;
const ADMIN_EMAILS = ['themiplayz1@gmail.com'];

// ── STATE ─────────────────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let _realMode = 'guest';
let devMode = false;
let devScenario = { drive: true, fullStorage: false, showAdmin: false, apiErrors: false };

Object.defineProperty(window, 'mode', {
  get() { return devMode ? 'synced' : _realMode; },
  set(v) { _realMode = v; },
  configurable: true
});

let currentUser = null;
let todos = [];
let attMap = {};
let filter = 'all';
let searchQ = '';
let editingId = null;
let editingValue = '';
let noteEditingId = null;
let confirmDeleteId = null;
let expandedIds = new Set();
let openAttIds = new Set();
let bulkMode = false;
let bulkSelection = new Set();
let focusedItemId = null;
let undoStack = [];
let currentTagFilter = '';
const MAX_UNDO = 20;

// Restore editing state from session storage (survives tab backgrounding)
try {
  const savedEditing = sessionStorage.getItem('todo_editing');
  if (savedEditing) {
    const parsed = JSON.parse(savedEditing);
    if (parsed.id) {
      editingId = parsed.id;
      editingValue = parsed.value || '';
    }
  }
} catch {}

// Save editing state when it changes
function saveEditingState() {
  try {
    if (editingId) {
      sessionStorage.setItem('todo_editing', JSON.stringify({ id: editingId, value: editingValue }));
    } else {
      sessionStorage.removeItem('todo_editing');
    }
  } catch {}
}

// Clear saved editing on save/cancel
function clearEditingState() {
  editingId = null;
  editingValue = '';
  try { sessionStorage.removeItem('todo_editing'); } catch {}
}
let globalUsage = null;
let siteNotice = null;
let adminPanelOpen = false;
let currentPage = 'todo';
let watchlistData = { manga: [], movies: [], series: [], anime: [] };
let watchlistCategories = [];
let watchlistSyncAvailable = true;

// Cached DOM refs (script.js level, used in updateStorageMeter etc.)
const _elStorageBar = document.getElementById('storageBar');
const _elStorageFill = document.getElementById('storageFill');
const _elStorageLabel = document.getElementById('storageLabel');
const _elStorageWarning = document.getElementById('storageWarning');
const _elBtnClearAtts = document.getElementById('btnClearAtts');

const LS_TODOS = 'todo_v3_todos';
const LS_ATTS  = 'todo_v3_atts';
const LS_GUEST = 'todo_v3_guest';
const LS_WATCHLIST = 'watchlist_v1';
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
  const m = t.metadata || {};
  return {
    id: t.id,
    text: t.text || '',
    desc: t.description || t.desc || '',
    priority: t.priority || 'medium',
    done: !!t.done,
    created: t.created_at || t.created || new Date().toISOString(),
    archived: !!m.archived,
    due: m.due || null,
    tags: Array.isArray(m.tags) ? m.tags : [],
    repeat: m.repeat || null,
    subtasks: Array.isArray(m.subtasks) ? m.subtasks : []
  };
}

function metaPayload(t) {
  return {
    archived: !!t.archived,
    due: t.due || null,
    tags: Array.isArray(t.tags) ? t.tags : [],
    repeat: t.repeat || null,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : []
  };
}

let toastTimer;
let undoToastTimer;
const _syncDot = document.getElementById('syncDot');
const _sidebarSyncDot = document.getElementById('sidebarSyncDot');
function toast(msg, col) {
  const el = document.getElementById('toast');
  el.textContent = '// ' + msg;
  el.className = 'toast show';
  el.style.color = col || 'var(--green)';
  clearTimeout(toastTimer);
  clearTimeout(undoToastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function undoableToast(msg) {
  const el = document.getElementById('toast');
  el.className = 'toast show clickable';
  el.style.color = 'var(--accent)';
  el.innerHTML = '// ' + esc(msg) + ' <button class="toast-undo">UNDO</button>';
  el.querySelector('.toast-undo').onclick = () => {
    el.classList.remove('show');
    clearTimeout(undoToastTimer);
    popUndo();
  };
  clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

function dot(s) {
  if (_syncDot) _syncDot.className = 'sync-dot ' + s;
  if (_sidebarSyncDot) _sidebarSyncDot.className = 'sync-dot ' + s;
}

// ── IMAGE COMPRESS ────────────────────────────────────────────────────────────
async function compressImage(file) {
  return new Promise(resolve => {
    if (!file || !file.type) { resolve(file); return; }
    if (!file.type.startsWith('image/')) { resolve(file); return; }
    if (!settings.compressEnabled) { resolve(file); return; }
    
    const quality = settings.compressQuality;
    const maxW = settings.compressMaxDimension;
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
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.warn('Image load failed, using original');
      resolve(file);
    };
    
    img.src = url;
  });
}

// ── STORAGE METER ─────────────────────────────────────────────────────────────
function updateStorageMeter() {
  if (!_elStorageBar || !_elStorageFill || !_elStorageLabel) return;
  _elStorageBar.className = 'storage-bar visible';

  if (_realMode === 'guest') {
    if (_elBtnClearAtts) _elBtnClearAtts.style.display = 'none';
    globalUsage = null;
    updateGlobalUsagePanel();
    let bytes = 0;
    try { bytes = (localStorage.getItem(LS_TODOS)||'').length + (localStorage.getItem(LS_ATTS)||'').length; } catch {}
    const max = devMode ? SYNC_STORAGE_LIMIT : 5000000;
    const pct = Math.min(100, (bytes / max) * 100);
    _elStorageFill.className = 'storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
    _elStorageFill.style.width = pct.toFixed(1) + '%';
    if (devMode) {
      _elStorageLabel.textContent = 'supabase storage: ' + fmtSize(bytes) + ' / 1GB (' + pct.toFixed(0) + '%)';
    } else {
      _elStorageLabel.textContent = 'local storage: ' + fmtSize(bytes) + ' / ~5MB' + (pct > 80 ? ' ⚠️' : '');
    }
    if (_elStorageWarning) {
      let warnMsg = '';
      if (devMode) {
        const dpct = bytes / SYNC_STORAGE_LIMIT;
        if (dpct > 0.8) warnMsg = '⚠️ Supabase storage is nearly full (' + fmtSize(bytes) + ' / 1GB). Clean up old files.';
        else if (dpct > 0.6) warnMsg = '⚡ Supabase storage is getting full (' + fmtSize(bytes) + ' / 1GB).';
      } else {
        const dpct = bytes / 5000000;
        if (dpct > 0.8) warnMsg = '⚠️ Local storage is nearly full (' + fmtSize(bytes) + ' / ~5MB). Consider clearing completed items or switching to synced mode.';
        else if (dpct > 0.6) warnMsg = '⚡ Local storage is getting full (' + fmtSize(bytes) + ' / ~5MB).';
      }
      _elStorageWarning.textContent = warnMsg;
      _elStorageWarning.className = 'storage-warning' + (warnMsg ? ' show' : '');
    }
  } else {
    sb.from('attachments').select('size').eq('user_id', currentUser.id).then(result => {
      const bytes = result.data ? result.data.reduce((s,a) => s + (a.size||0), 0) : 0;
      const pct = Math.min(100, (bytes / SYNC_STORAGE_LIMIT) * 100);
      _elStorageFill.className = 'storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
      _elStorageFill.style.width = pct.toFixed(1) + '%';
      _elStorageLabel.textContent = 'supabase storage: ' + fmtSize(bytes) + ' / 1GB (' + pct.toFixed(0) + '%)';
    }).catch(() => {
      const bytes = Object.values(attMap).flat().reduce((s,a) => s + (a.size||0), 0);
      const pct = Math.min(100, (bytes / SYNC_STORAGE_LIMIT) * 100);
      _elStorageFill.className = 'storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
      _elStorageFill.style.width = pct.toFixed(1) + '%';
      _elStorageLabel.textContent = 'supabase storage: ' + fmtSize(bytes) + ' / 1GB (' + pct.toFixed(0) + '%)';
    });

    const doneIds = new Set(todos.filter(t=>t.done).map(t=>t.id));
    const hasDoneAtts = Object.keys(attMap).some(id => doneIds.has(id) && attMap[id].length > 0);
    if (_elBtnClearAtts) _elBtnClearAtts.style.display = hasDoneAtts ? 'inline-block' : 'none';
    updateGlobalUsagePanel();
    if (_elStorageWarning) {
      const attBytes = Object.values(attMap).flat().reduce((s,a) => s + (a.size||0), 0);
      const driveBytes = (typeof driveFiles !== 'undefined' ? driveFiles : []).reduce((s,f) => s + (f.size||0), 0);
      const pct = (attBytes + driveBytes) / SYNC_STORAGE_LIMIT;
      let warnMsg = '';
      if (pct > 0.8) warnMsg = '⚠️ Supabase storage is nearly full (' + fmtSize(attBytes + driveBytes) + ' / 1GB). Clean up old files.';
      else if (pct > 0.6) warnMsg = '⚡ Supabase storage is getting full (' + fmtSize(attBytes + driveBytes) + ' / 1GB).';
      _elStorageWarning.textContent = warnMsg;
      _elStorageWarning.className = 'storage-warning' + (warnMsg ? ' show' : '');
    }
  }
  updatePageStats();
  updateSidebarCounts();
  updateSidebarStorage();
}

function updatePageStats() {
  const fmt = b => {
    if (b >= 1048576) return (b/1048576).toFixed(1) + 'MB';
    if (b >= 1024) return (b/1024).toFixed(1) + 'KB';
    return b + 'B';
  };
  const attCount = Object.values(window.attMap || {}).flat().length;
  const driveCount = (typeof driveFiles !== 'undefined' ? driveFiles : []).length;
  const todoCount = (typeof todos !== 'undefined' ? todos : []).length;
  const wlItems = typeof watchlistData !== 'undefined' ? Object.values(watchlistData).flat().length : 0;
  const wlCats = typeof watchlistCategories !== 'undefined' ? watchlistCategories.length : 0;

  let todoStats = '';
  if (_realMode === 'guest') {
    let bytes = 0;
    try { bytes = (localStorage.getItem(LS_TODOS)||'').length + (localStorage.getItem(LS_ATTS)||'').length; } catch {}
    todoStats = todoCount + ' item' + (todoCount===1?'':'s') + ' · ' + attCount + ' attachment' + (attCount===1?'':'s') + ' · ' + fmt(bytes);
  } else {
    const attBytes = Object.values(window.attMap || {}).flat().reduce((s,a) => s + (a.size||0), 0);
    const driveBytes = driveFiles.reduce((s,f) => s + (f.size||0), 0);
    todoStats = todoCount + ' item' + (todoCount===1?'':'s') + ' · ' + attCount + ' attachment' + (attCount===1?'':'s') + ' · ' + fmt(attBytes + driveBytes);
  }
  const ts = document.getElementById('todoStats');
  if (ts) ts.textContent = todoStats;

  const ds = document.getElementById('driveStats');
  if (ds) ds.textContent = driveCount + ' file' + (driveCount===1?'':'s') + ' · ' + fmt(driveFiles.reduce((s,f) => s + (f.size||0), 0));

  const ws = document.getElementById('watchlistStats');
  if (ws) ws.textContent = wlItems + ' item' + (wlItems===1?'':'s') + ' across ' + wlCats + ' categor' + (wlCats===1?'y':'ies');
}

function updateSidebarCounts() {
  const todoCount = (typeof todos !== 'undefined' ? todos : []).length;
  const driveCount = (typeof driveFiles !== 'undefined' ? driveFiles : []).length;
  const wlTotal = typeof watchlistData !== 'undefined' ? Object.values(watchlistData).flat().length : 0;
  const tc = document.getElementById('navCountTodo');
  if (tc) tc.textContent = todoCount || '';
  const dc = document.getElementById('navCountDrive');
  if (dc) dc.textContent = driveCount || '';
  const wc = document.getElementById('navCountWatchlist');
  if (wc) wc.textContent = wlTotal || '';
}

function updateSidebarStorage() {
  const el = document.getElementById('sidebarStorage');
  const fill = document.getElementById('sidebarStorageFill');
  const label = document.getElementById('sidebarStorageLabel');
  if (!el || !fill || !label) return;
  if (_realMode === 'guest') {
    let bytes = 0;
    try { bytes = (localStorage.getItem(LS_TODOS)||'').length + (localStorage.getItem(LS_ATTS)||'').length; } catch {}
    if (devMode) {
      const pct = Math.min(100, (bytes / SYNC_STORAGE_LIMIT) * 100);
      el.style.display = 'block';
      fill.style.width = pct.toFixed(1) + '%';
      fill.className = 'sidebar-storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
      label.textContent = 'storage ' + fmtSize(bytes) + ' / 1GB';
    } else {
      const max = 5000000;
      const pct = Math.min(100, (bytes / max) * 100);
      el.style.display = 'block';
      fill.style.width = pct.toFixed(1) + '%';
      fill.className = 'sidebar-storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
      label.textContent = 'local ' + fmtSize(bytes) + ' / ~5MB';
    }
  } else {
    const attBytes = Object.values(attMap || {}).flat().reduce((s,a) => s + (a.size||0), 0);
    const driveBytes = (typeof driveFiles !== 'undefined' ? driveFiles : []).reduce((s,f) => s + (f.size||0), 0);
    const max = 1073741824;
    const pct = Math.min(100, ((attBytes + driveBytes) / max) * 100);
    el.style.display = 'block';
    fill.style.width = pct.toFixed(1) + '%';
    fill.className = 'sidebar-storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
    label.textContent = 'storage ' + fmtSize(attBytes + driveBytes) + ' / 1GB';
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
sb.auth.onAuthStateChange((event, session) => {
  if (session) {
    mode = 'synced';
    currentUser = session.user;

    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = '';

    const badge = document.getElementById('modeBadge');
    badge.textContent = 'SYNCED'; badge.className = 'mode-badge synced-mode';
    document.getElementById('btnSignOut').style.display = 'inline-block';
    document.getElementById('btnUpgrade').style.display = 'none';
    dot('ok');

    const av = document.getElementById('userAvatar');
    const ph = document.getElementById('avatarPh');
    const sav = document.getElementById('sidebarAvatar');
    const sph = document.getElementById('sidebarAvatarPh');
    if (session.user.user_metadata?.avatar_url) {
      const url = session.user.user_metadata.avatar_url;
      av.src = url; av.style.display = 'inline-block'; ph.style.display = 'none';
      if (sav) { sav.src = url; sav.style.display = 'inline-block'; if (sph) sph.style.display = 'none'; }
    } else {
      av.removeAttribute('src'); av.style.display = 'none'; ph.style.display = 'flex';
      ph.textContent = (session.user.email||'?')[0].toUpperCase();
      if (sav) { sav.removeAttribute('src'); sav.style.display = 'none'; if (sph) { sph.style.display = 'flex'; sph.textContent = (session.user.email||'?')[0].toUpperCase(); } }
    }
    const sBadge = document.getElementById('sidebarModeBadge');
    if (sBadge) { sBadge.textContent = 'SYNCED'; sBadge.className = 'mode-badge synced-mode'; }
    const sEmail = document.getElementById('sidebarUserEmail');
    if (sEmail) sEmail.textContent = session.user.email || '';
    const sso = document.getElementById('sidebarSignOutBtn');
    if (sso) sso.style.display = 'inline-block';
    updateAdminAccess();

    // Avoid issuing more Supabase calls directly inside the auth callback.
    setTimeout(() => {
      loadSynced().catch(error => {
        dot('err');
        toast('load error: ' + error.message, 'var(--danger)');
      });
      setPage(pageFromHash(), { updateHash: false });
      if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
    }, 0);

  } else {
    if (localStorage.getItem(LS_GUEST) === '1') {
      enterGuestMode();
      return;
    }
    mode = 'guest'; currentUser = null;
    updateAdminAccess();
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';
    if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
    const sBadge = document.getElementById('sidebarModeBadge');
    if (sBadge) { sBadge.textContent = 'GUEST'; sBadge.className = 'mode-badge guest-mode'; }
    const sEmail = document.getElementById('sidebarUserEmail');
    if (sEmail) sEmail.textContent = '';
    const sso = document.getElementById('sidebarSignOutBtn');
    if (sso) sso.style.display = 'none';
    const sav = document.getElementById('sidebarAvatar');
    if (sav) { sav.removeAttribute('src'); sav.style.display = 'none'; }
    const sph = document.getElementById('sidebarAvatarPh');
    if (sph) { sph.style.display = 'flex'; sph.textContent = '?'; }
  }
});

document.getElementById('btnGoogle').addEventListener('click', () => {
  window.location.href = 'https://hxkjwebubmdqjzwmnvrh.supabase.co/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(window.location.href);
});
async function handleSignOut() {
  const { error } = await sb.auth.signOut();
  localStorage.removeItem(LS_GUEST);
  if (error) toast('sign out failed: ' + error.message, 'var(--danger)');
  if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
}
document.getElementById('btnSignOut').addEventListener('click', handleSignOut);
document.getElementById('sidebarSignOutBtn').addEventListener('click', handleSignOut);
function handleSwitchAccount() {
  localStorage.removeItem(LS_GUEST);
  if (_realMode === 'synced') {
    sb.auth.signOut();
  } else {
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
    const sb2 = document.getElementById('sidebar');
    if (sb2) sb2.style.display = 'none';
    if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
  }
}
document.getElementById('sidebarSwitchAcctBtn').addEventListener('click', handleSwitchAccount);
document.getElementById('btnGuest').addEventListener('click', enterGuestMode);
document.getElementById('btnUpgrade').addEventListener('click', () => {
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'block';
  const sb = document.getElementById('sidebar');
  if (sb) sb.style.display = 'none';
  if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
});

(async () => {
  loadSettings();
  // Handle hash - could be #todo#access_token or just #access_token
  let hash = window.location.hash;
  console.log('Full hash:', hash.substring(0, 80) + '...');
  
  // Extract token part (after the last #)
  const tokenPart = hash.includes('#access_token') 
    ? hash.substring(hash.indexOf('#access_token') + 1)
    : (hash.includes('access_token') ? hash.replace(/^#+/, '') : '');
  
  if (tokenPart.includes('access_token')) {
    const params = new URLSearchParams(tokenPart);
    const at = params.get('access_token');
    const rt = params.get('refresh_token');
    console.log('Token found - access:', at ? 'yes' : 'no', 'refresh:', rt ? 'yes' : 'no');
    
    if (at && rt) {
      try {
        await sb.auth.setSession({ access_token: at, refresh_token: rt });
        // Clean URL but keep page hash
        const pageHash = hash.includes('#todo') || hash.includes('#drive') || hash.includes('#watchlist') || hash.includes('#admin') 
          ? hash.match(/#(todo|drive|watchlist|admin)/)?.[0] || '' 
          : '';
        history.replaceState(null, '', window.location.pathname + pageHash);
      } catch (e) {
        console.error('setSession error:', e);
      }
    }
  }
  
  const { data: { session } } = await sb.auth.getSession();
  console.log('Session:', session ? 'exists' : 'none');
  
  if (!session) {
    if (localStorage.getItem(LS_GUEST) === '1') {
      enterGuestMode();
    } else {
      document.getElementById('authScreen').style.display = 'block';
      loadGuestWatchlist();
      renderWatchlist();
      setPage(pageFromHash(), { updateHash: false });
    }
  } else {
    mode = 'synced';
    currentUser = session.user;
    updateAdminAccess();
    loadGuestWatchlist();
    renderWatchlist();
    setPage(pageFromHash(), { updateHash: false });
    loadSynced().catch(error => {
      dot('err');
      toast('load error: ' + error.message, 'var(--danger)');
    });
  }
  if (typeof applyDefaults === 'function') applyDefaults();
  await loadSiteNotice().catch(() => {});
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
    }, 200);
  });
})();

async function removeStoragePaths(paths) {
  const clean = [...new Set(paths.filter(Boolean))];
  if (!clean.length) return;
  const { error } = await sb.storage.from('attachments').remove(clean);
  if (error) throw error;
}

// ── ATTACHMENTS ───────────────────────────────────────────────────────────────
async function uploadFile(todoId, rawFile) {
  const file = await compressImage(rawFile);
  if (file.size < rawFile.size) toast('compressed ' + rawFile.name + ': ' + fmtSize(rawFile.size) + ' → ' + fmtSize(file.size));

  if (_realMode === 'guest') {
    if (!devMode && file.size > MAX_GUEST_FILE) { toast('guest: max 5MB per file', 'var(--accent2)'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      (attMap[todoId] = attMap[todoId] || []).push({ id: uid(), name: file.name, size: file.size, mime: file.type, dataUrl: ev.target.result });
      saveGuest(); render(); toast('attached ' + file.name);
    };
    reader.readAsDataURL(file);
  } else {
    if (file.size > MAX_SYNC_FILE) { toast('max 50MB per file', 'var(--accent2)'); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = safeName.split('.').pop();
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
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
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

function showConfirm(msg) {
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'img-modal';
    m.style.cursor = 'default';
    m.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);padding:24px;max-width:400px;text-align:center;">'
      + '<p style="font-size:0.82rem;color:var(--text);line-height:1.7;margin-bottom:20px;">' + esc(msg) + '</p>'
      + '<div style="display:flex;gap:10px;justify-content:center;">'
      + '<button class="img-modal-dl" id="confirmYes" style="position:static;transform:none;">YES</button>'
      + '<button class="img-modal-close" id="confirmNo" style="position:static;">NO</button>'
      + '</div></div>';
    m.querySelector('#confirmYes').onclick = () => { m.remove(); resolve(true); };
    m.querySelector('#confirmNo').onclick = () => { m.remove(); resolve(false); };
    m.onclick = e => { if (e.target === m) { m.remove(); resolve(false); } };
    document.body.appendChild(m);
    document.getElementById('confirmNo').focus();
  });
}

function findAtt(id) {
  for (const arr of Object.values(attMap)) { const a = arr.find(a => a.id === id); if (a) return a; }
  return null;
}

async function getSignedUrl(path) {
  const { data } = await sb.storage.from('attachments').createSignedUrl(path, 120);
  return data?.signedUrl || null;
}

function buildAttPanel(todoId, atts) {
  const items = atts.map(a => {
    const isImg = (a.mime||'').startsWith('image/');
    if (isImg) {
      const imgSrc = a.dataUrl ? 'src="' + esc(a.dataUrl) + '"'
        : 'data-path="' + esc(a.path) + '" src="data:,"';
      return '<div class="att-card">'
        + '<img class="att-thumb att-img" loading="lazy" ' + imgSrc + ' alt="' + esc(a.name) + '" data-att="' + a.id + '">'
        + '<div class="att-overlay">'
        + '<span class="att-name" data-att="' + a.id + '">' + esc(a.name) + '</span>'
        + '<button class="att-rm" data-att="' + a.id + '" data-tid="' + todoId + '">×</button>'
        + '</div></div>';
    } else {
      return '<div class="att-card att-file" data-att="' + a.id + '">'
        + '<div class="att-file-icon">' + mimeIcon(a.mime||'') + '</div>'
        + '<div class="att-file-info">'
        + '<span class="att-name" data-att="' + a.id + '">' + esc(a.name) + '</span>'
        + '<span class="att-size">' + fmtSize(a.size||0) + '</span>'
        + '</div>'
        + '<button class="att-rm" data-att="' + a.id + '" data-tid="' + todoId + '">×</button>'
        + '</div>';
    }
  }).join('');

  const lim = mode === 'guest' ? 'max 5MB, images compressed' : 'max 50MB per file, images compressed';
  return '<div class="att-panel open">'
    + '<div class="att-gallery">' + items + '</div>'
    + '<div class="att-upload-row">'
    + '<label class="att-up-btn" for="fu-' + todoId + '">+ ATTACH FILE</label>'
    + '<input type="file" id="fu-' + todoId + '" class="file-input" data-tid="' + todoId + '" multiple>'
    + '<span class="att-prog" id="ap-' + todoId + '">uploading...</span>'
    + '<span class="compress-note">' + lim + '</span>'
    + '</div></div>';
}

async function loadSignedPreviews(container) {
  const imgs = [...container.querySelectorAll('.att-img[data-path], .att-thumb[data-path]')];
  const urls = await Promise.all(imgs.map(img => getSignedUrl(img.dataset.path)));
  urls.forEach((url, i) => { if (url) imgs[i].src = url; });
}

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
document.getElementById('sidebar').addEventListener('click', e => {
  const btn = e.target.closest('.sidebar-btn[data-page]');
  if (btn) setPage(btn.dataset.page);
});

document.addEventListener('click', e => {
  if (!e.target.closest('.menu-wrap')) closeAppMenu();
});
window.addEventListener('hashchange', () => setPage(pageFromHash(), { updateHash: false }));
document.getElementById('watchlistExportBtn').addEventListener('click', exportWatchlist);
document.getElementById('watchlistImportBtn').addEventListener('click', () => document.getElementById('watchlistImportFile').click());
document.getElementById('watchlistImportFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importWatchlistFile(file);
  e.target.value = '';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('service worker registered:', reg.scope))
      .catch(error => console.error('service worker registration failed:', error));
  });
}


