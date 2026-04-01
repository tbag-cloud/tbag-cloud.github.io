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
let editingValue = '';
let confirmDeleteId = null;
let expandedIds = new Set();
let openAttIds = new Set();

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
let watchlistExpanded = new Set();
let watchlistComposerOpen = false;
let watchlistComposerMode = 'add';
let watchlistSyncAvailable = true;

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

// ── IMAGE COMPRESS ────────────────────────────────────────────────────────────
async function compressImage(file, maxW=1600, quality=0.82) {
  return new Promise(resolve => {
    if (!file || !file.type) { resolve(file); return; }
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
    updateAdminAccess();

    // Avoid issuing more Supabase calls directly inside the auth callback.
    setTimeout(() => {
      loadSynced().catch(error => {
        dot('err');
        toast('load error: ' + error.message, 'var(--danger)');
      });
      setPage(pageFromHash(), { updateHash: false });
    }, 0);

  } else {
    mode = 'guest'; currentUser = null;
    updateAdminAccess();
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
  }
});

document.getElementById('btnGoogle').onclick = function() {
  window.location.href = 'https://hxkjwebubmdqjzwmnvrh.supabase.co/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(window.location.href);
};
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
    setPage(pageFromHash(), { updateHash: false });
  } else {
    mode = 'synced';
    currentUser = session.user;
    updateAdminAccess();
    setPage(pageFromHash(), { updateHash: false });
  }
  await loadSiteNotice();
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
window.addEventListener('hashchange', () => setPage(pageFromHash(), { updateHash: false }));
document.getElementById('watchlistQuickAdd').addEventListener('click', quickAddWatchlistItem);
document.getElementById('watchlistExportBtn').addEventListener('click', exportWatchlist);
document.getElementById('watchlistImportBtn').addEventListener('click', () => document.getElementById('watchlistImportFile').click());
document.getElementById('watchlistImportFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importWatchlistFile(file);
  e.target.value = '';
});
document.getElementById('watchlistCategoryComposerClose').addEventListener('click', closeCategoryComposer);
document.getElementById('watchlistCategoryComposerSave').addEventListener('click', async () => {
  await saveWatchlistCategory();
});
document.getElementById('watchlistCategoryDeleteClose').addEventListener('click', closeDeleteCategoryComposer);
document.getElementById('watchlistCategoryDeleteConfirm').addEventListener('click', async () => {
  const key = document.getElementById('watchlistDeleteCategoryKey').value;
  if (key) await removeWatchlistCategory(key);
});
document.getElementById('watchlistComposerClose').addEventListener('click', closeWatchlistComposer);
document.getElementById('watchlistComposerSave').addEventListener('click', async () => {
  await saveWatchlistComposer();
});
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
document.getElementById('watchlistGroups').addEventListener('click', async e => {
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
  if (action === 'delete') await deleteWatchlistItem(category, id);
  else if (action === 'edit') editWatchlistItem(category, id);
  else if (action === 'cycle') await cycleWatchlistStatus(category, id);
  else if (action === 'finish') await finishWatchlistItem(category, id);
  else if (action === 'step') await stepWatchlist(category, id, 'progress', Number(step || 0));
  else if (action === 'season') await stepWatchlist(category, id, 'season', Number(step || 0));
  else if (action === 'episode') await stepWatchlist(category, id, 'episode', Number(step || 0));
  else if (action === 'toggle-progress') {
    watchlistExpanded.has(id) ? watchlistExpanded.delete(id) : watchlistExpanded.add(id);
    renderWatchlist();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('service worker registered:', reg.scope))
      .catch(error => console.error('service worker registration failed:', error));
  });
}

loadGuestWatchlist();
renderWatchlistCategoryOptions();
renderWatchlist();
setPage(pageFromHash(), { updateHash: false });
